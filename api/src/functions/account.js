// Sign-in, invites, forgot password, and user admin.
"use strict";
const { app } = require("@azure/functions");
const { bc, lit } = require("../lib/bc");
const store = require("../lib/store");
const mail = require("../lib/mail");
const { login, hashPassword, passwordProblem, sessionFor } = require("../lib/session");
const { json, handler, tooMany, siteUrl } = require("../lib/http");

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const ip = r => (r.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
const needStore = () => store.enabled() ? null : json(503, { error: "User storage isn't set up yet (STORAGE_CONNECTION)." });

// ---------- sign in ----------
app.http("login", {
  route: "auth/login", methods: ["POST"], authLevel: "anonymous",
  handler: handler(async request => {
    const b = await request.json().catch(() => ({}));
    if (tooMany("login:" + ip(request), 20, 15) || tooMany("login:" + String(b.username || "").toLowerCase(), 8, 15)) return json(429, { error: "Too many attempts. Wait 15 minutes and try again." });
    await new Promise(r => setTimeout(r, 300));
    const s = await login(b.username, b.password);
    if (!s) return json(401, { error: "That email and password don't match." });
    return json(200, s);
  }, { auth: false })
});
app.http("me", { route: "auth/me", methods: ["GET"], authLevel: "anonymous", handler: handler(async (req, ctx, user) => json(200, { user })) });

// ---------- forgot password ----------
// Always answers the same way, so it can't be used to find out who has an account.
app.http("forgot", {
  route: "auth/forgot", methods: ["POST"], authLevel: "anonymous",
  handler: handler(async (request, ctx) => {
    const ns = needStore(); if (ns) return ns;
    const b = await request.json().catch(() => ({}));
    const email = store.keyOf(b.email);
    const done = json(200, { ok: true, message: "If that email has an account, a reset link is on its way." });
    if (!EMAIL_RE.test(email) || tooMany("forgot:" + ip(request), 10, 60) || tooMany("forgot:" + email, 3, 60)) return done;
    const u = await store.getUser(email);
    if (!u || u.status !== "active") return done;
    const token = await store.createToken("reset", email, 1);
    const link = `${siteUrl(request)}/account.html?reset=${token}`;
    try { await mail.send({ to: email, ...mail.templates.reset({ name: u.name, link }) }); } catch (e) { ctx.error(e); }
    return done;
  }, { auth: false })
});

// ---------- read a one-time link (invite or reset) ----------
app.http("link-check", {
  route: "auth/link", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async request => {
    const ns = needStore(); if (ns) return ns;
    const kind = request.query.get("kind") === "reset" ? "reset" : "invite";
    const t = await store.readToken(kind, request.query.get("token"));
    if (!t) return json(404, { error: kind === "reset" ? "This reset link has expired or was already used. Ask for a new one." : "This invite has expired or was already used. Ask JSH to send a new one." });
    const u = await store.getUser(t.email);
    if (!u || u.status === "disabled") return json(404, { error: "This account is disabled. Contact JSH." });
    return json(200, { email: u.email, name: u.name, phone: u.phone, customerNo: u.customerNo, customerName: u.customerName || "" });
  }, { auth: false })
});

// ---------- accept invite: name, phone, password ----------
app.http("accept", {
  route: "auth/accept", methods: ["POST"], authLevel: "anonymous",
  handler: handler(async request => {
    const ns = needStore(); if (ns) return ns;
    const b = await request.json().catch(() => ({}));
    if (tooMany("accept:" + ip(request), 20, 15)) return json(429, { error: "Too many attempts. Wait 15 minutes." });
    const t = await store.readToken("invite", b.token);
    if (!t) return json(404, { error: "This invite has expired or was already used. Ask JSH to send a new one." });
    const name = clean(b.name, 80), phone = clean(b.phone, 30);
    if (name.length < 2) return json(400, { error: "Enter your full name." });
    if (!/^[+\d][\d\s()-]{5,}$/.test(phone)) return json(400, { error: "Enter a valid mobile or phone number." });
    const pp = passwordProblem(b.password); if (pp) return json(400, { error: pp });
    const u = await store.getUser(t.email);
    if (!u || u.status === "disabled") return json(404, { error: "This account is disabled. Contact JSH." });
    Object.assign(u, { name, phone, hash: hashPassword(String(b.password)), status: "active", tokenVersion: (u.tokenVersion || 0) + 1 });
    await store.saveUser(u); await store.useToken("invite", b.token);
    return json(200, sessionFor(u));
  }, { auth: false })
});

// ---------- reset password ----------
app.http("reset", {
  route: "auth/reset", methods: ["POST"], authLevel: "anonymous",
  handler: handler(async request => {
    const ns = needStore(); if (ns) return ns;
    const b = await request.json().catch(() => ({}));
    if (tooMany("reset:" + ip(request), 20, 15)) return json(429, { error: "Too many attempts. Wait 15 minutes." });
    const t = await store.readToken("reset", b.token);
    if (!t) return json(404, { error: "This reset link has expired or was already used. Ask for a new one." });
    const pp = passwordProblem(b.password); if (pp) return json(400, { error: pp });
    const u = await store.getUser(t.email);
    if (!u || u.status !== "active") return json(404, { error: "This account isn't active. Contact JSH." });
    u.hash = hashPassword(String(b.password)); u.tokenVersion = (u.tokenVersion || 0) + 1; // signs out every other session
    await store.saveUser(u); await store.useToken("reset", b.token);
    return json(200, sessionFor(u));
  }, { auth: false })
});

// ---------- invite / re-invite (admin in the portal, or the BC "Invite to Portal" button) ----------
app.http("invite", {
  route: "invites", methods: ["POST"], authLevel: "anonymous",
  handler: handler(async (request, ctx, user) => {
    const ns = needStore(); if (ns) return ns;
    const b = await request.json().catch(() => ({}));
    const email = store.keyOf(b.email);
    if (!EMAIL_RE.test(email)) return json(400, { error: "Enter a valid email address." });
    const role = b.role === "admin" ? "admin" : "customer";
    if (role === "admin" && user.username === "business-central") return json(403, { error: "Admins can only be invited from the portal." });
    let customerNo = "", customerName = "";
    if (role === "customer") {
      customerNo = clean(b.customerNo, 20);
      if (!customerNo) return json(400, { error: "Choose the customer this person orders for." });
      const c = await bc("GET", `/customers?$filter=number eq ${lit(customerNo)}&$select=number,displayName,blocked`);
      if (!c.value.length) return json(404, { error: `Customer ${customerNo} wasn't found in Business Central.` });
      customerName = c.value[0].displayName;
    }
    let u = await store.getUser(email);
    if (u && u.customerNo && u.customerNo !== customerNo && role === "customer") return json(409, { error: `${email} already has an account for customer ${u.customerNo}.` });
    if (!u) u = { email, name: clean(b.name, 80), phone: clean(b.phone, 30), role, customerNo, status: "invited", invitedBy: user.name, createdAt: new Date().toISOString() };
    else { u.role = role; u.customerNo = customerNo; if (u.status === "disabled") u.status = u.hash ? "active" : "invited"; if (!u.name && b.name) u.name = clean(b.name, 80); u.invitedBy = user.name; }
    await store.saveUser(u);
    // BC's Invite button sends the customer's Customer Price Group: keep the portal's mapping in step.
    if (role === "customer" && b.priceGroup !== undefined && String(b.priceGroup).trim()) await store.setCustomerPriceGroup(customerNo, clean(b.priceGroup, 20));
    const token = await store.createToken("invite", email, 24 * 7); // re-inviting cancels any earlier link
    const link = `${siteUrl(request)}/account.html?invite=${token}`;
    let emailed = false, mailError = "";
    try { emailed = (await mail.send({ to: email, ...mail.templates.invite({ name: u.name, customerName: customerName || "JSH", link }) })).sent; } catch (e) { mailError = e.message; ctx.error(e); }
    ctx.log(`Invite for ${email} (${customerNo || "admin"}) by ${user.name}`);
    // The link is only returned to a signed-in portal admin, so they can send it by hand if email isn't set up.
    return json(200, { ok: true, email, customerNo, emailed, mailError, ...(user.username !== "business-central" ? { link } : {}) });
  }, { role: "admin", allowBc: true })
});

// ---------- user admin ----------
app.http("users-list", {
  route: "users", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async () => {
    const ns = needStore(); if (ns) return ns;
    const list = (await store.listUsers()).map(u => ({ email: u.email, name: u.name, phone: u.phone, role: u.role, customerNo: u.customerNo, status: u.status, invitedBy: u.invitedBy, createdAt: u.createdAt, lastLogin: u.lastLogin }));
    return json(200, { value: list.sort((a, b) => a.customerNo.localeCompare(b.customerNo) || a.email.localeCompare(b.email)) });
  }, { role: "admin" })
});
app.http("users-status", {
  route: "users/status", methods: ["POST"], authLevel: "anonymous",
  handler: handler(async (request, ctx, user) => {
    const ns = needStore(); if (ns) return ns;
    const b = await request.json().catch(() => ({}));
    const u = await store.getUser(b.email); if (!u) return json(404, { error: "User not found." });
    if (u.email === user.email) return json(400, { error: "You can't disable yourself." });
    if (b.status === "disabled") { u.status = "disabled"; u.tokenVersion = (u.tokenVersion || 0) + 1; }
    else if (b.status === "active") u.status = u.hash ? "active" : "invited";
    else return json(400, { error: "Unknown status." });
    await store.saveUser(u);
    return json(200, { ok: true, status: u.status });
  }, { role: "admin" })
});

// ---------- test email (admin) ----------
app.http("mail-test", {
  route: "mail/test", methods: ["POST"], authLevel: "anonymous",
  handler: handler(async request => {
    const b = await request.json().catch(() => ({}));
    const to = store.keyOf(b.to);
    if (!EMAIL_RE.test(to)) return json(400, { error: "Enter a valid email address." });
    if (!mail.enabled()) return json(400, { error: "MAIL_SENDER isn't set in Azure." });
    try {
      await mail.send({ to, subject: "JSH Trade Portal test email", html: `<p>This is a test email from the JSH Trade Portal, sent as ${process.env.MAIL_SENDER} at ${new Date().toISOString()}.</p><p>If you can read this, portal email works.</p>` });
      return json(200, { ok: true, message: `Sent to ${to} from ${process.env.MAIL_SENDER}. Check the inbox and junk folder.` });
    } catch (e) { return json(200, { ok: false, message: e.message }); }
  }, { role: "admin" })
});
