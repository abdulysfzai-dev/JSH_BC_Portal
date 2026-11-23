// Sign-in and sessions.
// Users live in Table Storage (invited customers, JSH admins). The PORTAL_USERS app setting stays as a
// break-glass list (e.g. the first admin) and is checked only when no stored user matches.
"use strict";
const crypto = require("crypto");
const store = require("./store");

const SESSION_HOURS = 10;

function envUsers() {
  try { return JSON.parse(process.env.PORTAL_USERS || "[]"); } catch { return []; }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const h = crypto.scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${h}`;
}
function verifyPassword(password, stored) {
  const [alg, salt, h] = String(stored || "").split("$");
  if (alg !== "scrypt" || !salt || !h) return false;
  const test = crypto.scryptSync(password, salt, 32);
  const want = Buffer.from(h, "hex");
  return want.length === test.length && crypto.timingSafeEqual(want, test);
}
function passwordProblem(p) {
  p = String(p || "");
  if (p.length < 10) return "Use at least 10 characters.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Use a mix of letters and numbers.";
  return "";
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET app setting is missing or shorter than 32 characters");
  return s;
}
const mac = body => crypto.createHmac("sha256", secret()).update(body).digest("base64url");
function sign(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString("base64url");
  return `${body}.${mac(body)}`;
}
const publicUser = u => ({ username: u.email || u.username, email: u.email || "", name: u.name, phone: u.phone || "", role: u.role, customerNo: u.customerNo || "" });

async function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, m] = token.split(".");
  const want = mac(body);
  if (!m || m.length !== want.length || !crypto.timingSafeEqual(Buffer.from(m), Buffer.from(want))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!p.exp || p.exp < Date.now()) return null;
  // Re-check the user on every call, so disabling someone or resetting a password takes effect at once.
  if (p.src === "store") {
    const u = await store.getUser(p.sub);
    if (!u || u.status !== "active" || (u.tokenVersion || 0) !== (p.v || 0)) return null;
    return publicUser(u);
  }
  const u = envUsers().find(x => x.username === p.sub);
  if (!u || u.active === false) return null;
  return publicUser(u);
}

async function login(username, password) {
  const id = String(username || "").trim();
  const su = id.includes("@") ? await store.getUser(id) : null;
  if (su) {
    if (su.status !== "active" || !verifyPassword(String(password || ""), su.hash)) return null;
    su.lastLogin = new Date().toISOString(); await store.saveUser(su).catch(() => {});
    return { token: sign({ sub: su.email, src: "store", v: su.tokenVersion || 0 }), user: publicUser(su) };
  }
  const u = envUsers().find(x => String(x.username).toLowerCase() === id.toLowerCase());
  if (!u || u.active === false || !verifyPassword(String(password || ""), u.hash)) return null;
  return { token: sign({ sub: u.username, src: "env" }), user: publicUser(u) };
}
function sessionFor(u) { return { token: sign({ sub: u.email, src: "store", v: u.tokenVersion || 0 }), user: publicUser(u) }; }

module.exports = { login, verify, hashPassword, verifyPassword, passwordProblem, sessionFor, envUsers };
