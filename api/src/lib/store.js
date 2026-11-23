// Portal's own data in Azure Table Storage: users, one-time links (invite / reset), order log.
// Business data stays in BC. This only holds what BC doesn't: sign-ins and who placed what.
"use strict";
const crypto = require("crypto");
const { TableClient } = require("@azure/data-tables");

const clients = {};
function table(name) {
  const cs = process.env.STORAGE_CONNECTION;
  if (!cs) throw new Error("STORAGE_CONNECTION app setting is missing");
  if (!clients[name]) {
    const c = TableClient.fromConnectionString(cs, name, { allowInsecureConnection: /UseDevelopmentStorage|127\.0\.0\.1|localhost/.test(cs) });
    clients[name] = c.createTable().catch(e => { if (e.statusCode !== 409) throw e; }).then(() => c);
  }
  return clients[name];
}
const enabled = () => !!process.env.STORAGE_CONNECTION;
const keyOf = email => String(email || "").trim().toLowerCase();
const sha = s => crypto.createHash("sha256").update(s).digest("hex");

// ---------- users ----------
async function getUser(email) {
  if (!enabled()) return null;
  try { const e = await (await table("PortalUsers")).getEntity("user", keyOf(email)); return fromEntity(e); }
  catch (e) { if (e.statusCode === 404) return null; throw e; }
}
function fromEntity(e) {
  return { email: e.rowKey, name: e.name || "", phone: e.phone || "", role: e.role || "customer", customerNo: e.customerNo || "", status: e.status || "invited", hash: e.hash || "", createdAt: e.createdAt || "", invitedBy: e.invitedBy || "", lastLogin: e.lastLogin || "", tokenVersion: e.tokenVersion || 0 };
}
async function saveUser(u) {
  const t = await table("PortalUsers");
  await t.upsertEntity({ partitionKey: "user", rowKey: keyOf(u.email), name: u.name || "", phone: u.phone || "", role: u.role || "customer", customerNo: u.customerNo || "", status: u.status || "invited", hash: u.hash || "", createdAt: u.createdAt || new Date().toISOString(), invitedBy: u.invitedBy || "", lastLogin: u.lastLogin || "", tokenVersion: u.tokenVersion || 0 }, "Replace");
}
async function listUsers() {
  const t = await table("PortalUsers"); const out = [];
  for await (const e of t.listEntities({ queryOptions: { filter: "PartitionKey eq 'user'" } })) out.push(fromEntity(e));
  return out;
}

// ---------- one-time links ----------
// Only a hash of each token is stored, so a leaked table can't be used to sign in.
async function createToken(kind, email, hours) {
  const token = crypto.randomBytes(32).toString("base64url");
  const t = await table("PortalTokens");
  // One live link per person and kind: older links stop working.
  for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${kind}' and email eq '${keyOf(email).replace(/'/g, "''")}'` } })) await t.deleteEntity(kind, e.rowKey).catch(() => {});
  await t.createEntity({ partitionKey: kind, rowKey: sha(token), email: keyOf(email), expires: new Date(Date.now() + hours * 3600e3).toISOString() });
  return token;
}
async function readToken(kind, token) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(String(token || ""))) return null;
  try {
    const e = await (await table("PortalTokens")).getEntity(kind, sha(token));
    if (new Date(e.expires) < new Date()) return null;
    return { email: e.email, expires: e.expires };
  } catch (e) { if (e.statusCode === 404) return null; throw e; }
}
async function useToken(kind, token) { await (await table("PortalTokens")).deleteEntity(kind, sha(token)).catch(() => {}); }

// ---------- order log: who placed which portal order ----------
async function logOrder(o) {
  const t = await table("PortalOrders");
  await t.upsertEntity({ partitionKey: o.customerNo, rowKey: o.portalNo, soNo: o.soNo, placedByName: o.name || "", placedByEmail: o.email || "", placedAt: new Date().toISOString(), customerPO: o.po || "" }, "Replace");
}
async function orderLog(customerNo) {
  if (!enabled()) return {};
  const t = await table("PortalOrders"); const out = {};
  const q = customerNo ? { queryOptions: { filter: `PartitionKey eq '${String(customerNo).replace(/'/g, "''")}'` } } : undefined;
  for await (const e of t.listEntities(q)) out[e.rowKey] = { name: e.placedByName, email: e.placedByEmail, at: e.placedAt };
  return out;
}

module.exports = { enabled, getUser, saveUser, listUsers, createToken, readToken, useToken, logOrder, orderLog, keyOf };
