"use strict";
const { verify } = require("./session");
const { BcError } = require("./bc");

const json = (status, body) => ({ status, jsonBody: body, headers: { "Cache-Control": "no-store" } });

function currentUser(request) {
  const h = request.headers.get("x-portal-token") || "";
  try { return verify(h); } catch { return null; }
}

// Wraps a handler: checks sign-in (and role), turns errors into clean JSON.
function handler(fn, { auth = true, role } = {}) {
  return async (request, context) => {
    try {
      let user = null;
      if (auth) {
        user = currentUser(request);
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

module.exports = { json, handler, currentUser, scopeCustomer };
