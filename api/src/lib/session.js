// Trial sign-in: users live in the PORTAL_USERS app setting with scrypt-hashed passwords.
// Sessions are HMAC-signed tokens. Phase 2 replaces this with Microsoft Entra External ID.
"use strict";
const crypto = require("crypto");

const SESSION_HOURS = 10;

function users() {
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

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET app setting is missing or shorter than 32 characters");
  return s;
}

const b64 = s => Buffer.from(s).toString("base64url");

function sign(payload) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + SESSION_HOURS * 3600e3 }));
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const want = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!p.exp || p.exp < Date.now()) return null;
  // Re-check the user still exists and is active, so disabling a user takes effect at once.
  const u = users().find(x => x.username === p.username);
  if (!u || u.active === false) return null;
  return { username: u.username, name: u.name, role: u.role, customerNo: u.customerNo || "" };
}

function login(username, password) {
  const u = users().find(x => String(x.username).toLowerCase() === String(username || "").toLowerCase());
  if (!u || u.active === false || !verifyPassword(String(password || ""), u.hash)) return null;
  const user = { username: u.username, name: u.name, role: u.role, customerNo: u.customerNo || "" };
  return { token: sign({ username: u.username }), user };
}

module.exports = { login, verify, hashPassword, verifyPassword, users };
