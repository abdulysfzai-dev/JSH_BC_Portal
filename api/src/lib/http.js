"use strict";
const crypto = require("crypto");
const { verify } = require("./session");
const { BcError } = require("./bc");

const json = (status, body) => ({ status, jsonBody: body, headers: { "Cache-Control": "no-store" } });

async function currentUser(request) {
  const h = request.headers.get("x-portal-token") || "";
  try { return await verify(h); } catch { return null; }
}

// Business Central calls (e.g. the "Invite to Portal" button) sign in with a shared key instead of a user.
function isBcCaller(request) {
  const want = process.env.BC_PORTAL_KEY || "";
  const got = request.headers.get("x-bc-key") || "";
  return want.length >= 32 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// Wraps a handler: checks sign-in (and role), turns errors into clean JSON.
// allowBc: also accept a call from BC with the shared key (treated as an admin called "Business Central").
function handler(fn, { auth = true, role, allowBc = false } = {}) {
  return async (request, context) => {
    try {
      let user = null;
      if (auth) {
        if (allowBc && isBcCaller(request)) user = { username: "business-central", email: "", name: "Business Central", role: "admin", customerNo: "" };
        else user = await currentUser(request);
        if (!user) return json(401, { error: "Please sign in again." });
        if (role && user.role !== role) return json(403, { error: "You don't have access to this." });
      }
      return await fn(request, context, user);
    } catch (e) {
      context.error(e);
      if (e instanceof BcError) return json(e.status || 500, { error: e.message, detail: e.detail });
      return json(500, { error: e.message || "Something went wrong." });
    }
  };
}

// Customers may only see their own customer number. Admins may pass ?customerNo=.
function scopeCustomer(request, user) {
  if (user.role === "admin") return request.query.get("customerNo") || "";
  return user.customerNo;
}

// Small in-memory brake on repeated attempts (per instance). Enough to slow down guessing.
const hits = new Map();
function tooMany(key, max, minutes) {
  const now = Date.now(), win = minutes * 60e3;
  const list = (hits.get(key) || []).filter(t => now - t < win);
  list.push(now); hits.set(key, list);
  return list.length > max;
}

// The site's own address, for links in emails.
function siteUrl(request) {
  if (process.env.PORTAL_URL) return process.env.PORTAL_URL.replace(/\/$/, "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  return `https://${host}`;
}

module.exports = { json, handler, currentUser, scopeCustomer, tooMany, siteUrl, isBcCaller };
