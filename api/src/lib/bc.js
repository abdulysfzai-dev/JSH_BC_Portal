// Business Central connector (service-to-service, OAuth client credentials).
// The client secret only ever lives in Azure app settings. It is never sent to the browser.
"use strict";

const REQUIRED = ["BC_TENANT_ID", "BC_CLIENT_ID", "BC_CLIENT_SECRET", "BC_ENVIRONMENT"];

// DATA RULE: the portal may only READ from BC, plus create a sales order on a user's Submit.
// Any other write is refused here, whatever code asks for it.
const ALLOWED_WRITES = [
  { method: "POST", path: /^\/salesOrders$/ }
];

class BcError extends Error {
  constructor(status, message, detail) { super(message); this.status = status; this.detail = detail; }
}

function config() {
  const missing = REQUIRED.filter(k => !process.env[k]);
  return {
    missing,
    tenant: process.env.BC_TENANT_ID,
    clientId: process.env.BC_CLIENT_ID,
    secret: process.env.BC_CLIENT_SECRET,
    env: process.env.BC_ENVIRONMENT,
    companyId: process.env.BC_COMPANY_ID || "",
    // Overrides exist only for local testing against a mock server.
    apiRoot: process.env.BC_API_ROOT || "https://api.businesscentral.dynamics.com",
    tokenUrl: process.env.BC_TOKEN_URL || `https://login.microsoftonline.com/${process.env.BC_TENANT_ID}/oauth2/v2.0/token`
  };
}

let tokenCache = { value: null, expiresAt: 0 };

async function getToken() {
  const c = config();
  if (c.missing.length) throw new BcError(500, `Missing app settings: ${c.missing.join(", ")}`);
  if (tokenCache.value && Date.now() < tokenCache.expiresAt - 120000) return tokenCache.value;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: c.clientId,
    client_secret: c.secret,
    scope: "https://api.businesscentral.dynamics.com/.default"
  });
  const res = await fetch(c.tokenUrl, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new BcError(502, "Could not get a token from Microsoft Entra", json.error_description || json.error);
  tokenCache = { value: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

function apiBase() {
  const c = config();
  return `${c.apiRoot}/v2.0/${encodeURIComponent(c.tenant)}/${encodeURIComponent(c.env)}/api/v2.0`;
}

// path is relative to the company, e.g. "/salesOrders?$top=5". Use { company: false } for "/companies".
async function bc(method, path, body, opts = {}) {
  const c = config();
  if (method !== "GET") {
    const bare = path.split("?")[0];
    if (!ALLOWED_WRITES.some(r => r.method === method && r.path.test(bare))) {
      throw new BcError(403, `Blocked by portal data rule: ${method} ${bare} is not allowed`);
    }
  }
  const useCompany = opts.company !== false;
  if (useCompany && !c.companyId) throw new BcError(500, "Missing app setting: BC_COMPANY_ID");
  const url = apiBase() + (useCompany ? `/companies(${c.companyId})` : "") + path;
  const token = await getToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json && json.error ? json.error.message : `BC returned ${res.status}`;
    throw new BcError(res.status === 401 || res.status === 403 ? 502 : res.status, msg, json && json.error ? json.error.code : undefined);
  }
  return json;
}

// OData string literal escaping: a single quote becomes two.
const lit = v => `'${String(v).replace(/'/g, "''")}'`;

module.exports = { bc, getToken, config, apiBase, lit, BcError, ALLOWED_WRITES };
