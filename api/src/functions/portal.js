"use strict";
const crypto = require("crypto");
const { app } = require("@azure/functions");
const { bc, bcBinary, getToken, config, lit } = require("../lib/bc");
const store = require("../lib/store");
const mail = require("../lib/mail");
const { priceListFor } = require("./catalog");
const { json, handler, currentUser, scopeCustomer, siteUrl } = require("../lib/http");

const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
const ORDER_FIELDS = ["id", "number", "externalDocumentNumber", "orderDate", "requestedDeliveryDate", "customerNumber", "customerName", "status", "fullyShipped", "totalAmountExcludingTax", "totalTaxAmount", "totalAmountIncludingTax", "lastModifiedDateTime"];
const LINE_FIELDS = ["sequence", "lineType", "lineObjectNumber", "description", "unitOfMeasureCode", "quantity", "unitPrice", "netAmount", "amountIncludingTax", "shippedQuantity", "invoicedQuantity"];

// ---------- Ping: is the back end there? (no BC calls, used on page load) ----------
app.http("ping", { route: "ping", methods: ["GET"], authLevel: "anonymous", handler: async () => json(200, { ok: true, live: !!process.env.BC_CLIENT_ID }) });

// Short in-memory cache for slow-changing lists (customers, items). Per instance, 5 minutes.
const cache = new Map();
async function cached(key, ms, fn) { const c = cache.get(key); if (c && Date.now() - c.t < ms) return c.v; const v = await fn(); cache.set(key, { t: Date.now(), v }); return v; }

// ---------- Health: is the BC connection working? ----------
// Anyone gets yes/no checks. A signed-in admin also gets company names/ids and sample counts.
app.http("health", {
  route: "health", methods: ["GET"], authLevel: "anonymous",
  handler: async (request, context) => {
    const c = config(); const user = await currentUser(request); const admin = user && user.role === "admin";
    const out = {
      time: new Date().toISOString(),
      settings: { BC_TENANT_ID: !!c.tenant, BC_CLIENT_ID: !!c.clientId, BC_CLIENT_SECRET: !!c.secret, BC_ENVIRONMENT: c.env || false, BC_COMPANY_ID: !!c.companyId, SESSION_SECRET: !!process.env.SESSION_SECRET, PORTAL_USERS: (() => { try { return JSON.parse(process.env.PORTAL_USERS || "[]").length; } catch { return "invalid JSON"; } })(), ALLOW_ORDER_CREATE: process.env.ALLOW_ORDER_CREATE === "true", STORAGE_CONNECTION: !!process.env.STORAGE_CONNECTION, MAIL_SENDER: process.env.MAIL_SENDER || false, NOTIFY_STAFF: mail.staff().length, BC_PORTAL_KEY: (process.env.BC_PORTAL_KEY || "").length >= 32 },
      checks: {}
    };
    if (process.env.STORAGE_CONNECTION) { try { await store.listUsers(); out.checks.storage = "ok"; } catch (e) { out.checks.storage = `failed: ${e.message}`; } }
    try { await getToken(); out.checks.token = "ok"; } catch (e) { out.checks.token = `failed: ${e.message}${e.detail ? " (" + e.detail + ")" : ""}`; return json(200, out); }
    try {
      const r = await bc("GET", "/companies?$select=id,name,displayName", null, { company: false });
      out.checks.companies = `ok (${r.value.length})`;
      if (admin) out.companies = r.value;
      else out.hint = "Sign in as admin and reload to see company names and IDs.";
    } catch (e) { out.checks.companies = `failed: ${e.message}`; return json(200, out); }
    if (c.companyId) {
      for (const [k, p] of [["customers", "/customers?$top=3&$select=number,displayName"], ["items", "/items?$top=3&$select=number,displayName,unitPrice"], ["salesOrders", "/salesOrders?$top=3&$select=number,customerNumber,status"], ["salesInvoices", "/salesInvoices?$top=3&$select=number,customerNumber,status,remainingAmount"]]) {
        try { const r = await bc("GET", p); out.checks[k] = `ok (${r.value.length} sample)`; if (admin) (out.samples = out.samples || {})[k] = r.value; }
        catch (e) { out.checks[k] = `failed: ${e.message}`; }
      }
      // JSH custom APIs (read-only)
      for (const [k, p] of [["salesPriceListLines (custom)", "/salesPriceListLines?$top=3"], ["qbtHeaders + qbtLines (custom)", "/qbtHeaders?$top=2&$expand=qbtLines"]]) {
        try { const r = await bc("GET", p, null, { custom: true }); out.checks[k] = `ok (${r.value.length} sample)`; if (admin) (out.samples = out.samples || {})[k] = r.value; }
        catch (e) { out.checks[k] = `failed: ${e.message}`; }
      }
    }
    return json(200, out);
  }
});

// ---------- Customers ----------
app.http("customers", {
  route: "customers", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async (request, ctx, user) => {
    const fields = "number,displayName,email,phoneNumber,addressLine1,addressLine2,city,state,postalCode,paymentTermsId,blocked";
    if (user.role === "admin") {
      const r = await cached("customers:all", 300e3, () => bc("GET", `/customers?$select=${fields}&$orderby=number&$top=200`));
      const st = await store.getCustomerSettings().catch(() => ({}));
      return json(200, { value: r.value.map(c => ({ ...c, priceGroup: (st[c.number] || {}).priceGroup || "" })) });
    }
    const r = await cached("customers:" + user.customerNo, 300e3, () => bc("GET", `/customers?$filter=number eq ${lit(user.customerNo)}&$select=${fields}`));
    const st = await store.getCustomerSettings().catch(() => ({}));
    return json(200, { value: r.value.map(c => ({ ...c, priceGroup: (st[c.number] || {}).priceGroup || "" })) });
  })
});

// ---------- Items (standard API; the custom price-list API will replace this for customers) ----------
app.http("items", {
  route: "items", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async () => {
    // "inventory" left out on purpose: BC calculates it per item, which makes the list slow.
    const r = await cached("items", 300e3, () => bc("GET", "/items?$filter=blocked eq false&$select=id,number,displayName,itemCategoryCode,baseUnitOfMeasureCode,unitPrice&$orderby=number&$top=500"));
    return json(200, { value: r.value, note: "Standard items list. Customer-specific prices arrive with the custom price-list API." });
  })
});

// ---------- Sales orders (read) ----------
app.http("orders-list", {
  route: "orders", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async (request, ctx, user) => {
    const cust = scopeCustomer(request, user);
    const filter = cust ? `&$filter=customerNumber eq ${lit(cust)}` : "";
    const r = await bc("GET", `/salesOrders?$select=${ORDER_FIELDS.join(",")}&$expand=salesOrderLines($select=${LINE_FIELDS.join(",")})&$orderby=orderDate desc&$top=100${filter}`);
    // Standard API: status "Draft" = BC Open, "Open" = BC Released. Translate so the portal speaks BC.
    const value = r.value.map(o => ({ ...pick(o, ORDER_FIELDS), bcStatus: o.status === "Draft" ? "Open" : o.status === "Open" ? "Released" : o.status, lines: (o.salesOrderLines || []).map(l => pick(l, LINE_FIELDS)) }));
    const log = await store.orderLog(cust).catch(() => ({}));
    value.forEach(o => { const m = /^(JSH\d{4,})/.exec(o.externalDocumentNumber || ""); const l = m && log[m[1]]; if (l) o.placedBy = l.name; });
    return json(200, { value, note: "Order reviewed is a custom field: it arrives with the custom order-status API." });
  })
});

// ---------- Portal order number: JSH0001, JSH0002, ... ----------
// Next number = highest JSHnnnn found in External Document No. on open orders and posted invoices, plus one.
// Assigned on the server at the moment of Submit, so two users can't both take the same number.
const PORTAL_RE = /^JSH(\d{4,})(?:\/|$)/;
async function highestPortalNo() {
  const f = "$filter=startswith(externalDocumentNumber,'JSH')&$select=externalDocumentNumber&$top=1000";
  const [o, i] = await Promise.all([bc("GET", `/salesOrders?${f}`), bc("GET", `/salesInvoices?${f}`)]);
  let max = 0;
  for (const r of [...o.value, ...i.value]) { const m = PORTAL_RE.exec(r.externalDocumentNumber || ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return max;
}
const fmtPortalNo = n => "JSH" + String(n).padStart(4, "0");
let numberLock = Promise.resolve();
const recentSubmits = new Map(); // draftId -> result, guards against double Submit

app.http("order-number", {
  route: "orders/next-number", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async () => json(200, { next: fmtPortalNo((await highestPortalNo()) + 1) }))
});

// ---------- Create sales order: the ONLY write. Runs only on a signed-in user's Submit. ----------
app.http("orders-create", {
  route: "orders", methods: ["POST"], authLevel: "anonymous",
  handler: handler(async (request, ctx, user) => {
    if (process.env.ALLOW_ORDER_CREATE !== "true") return json(403, { error: "Order creation is switched off in this environment (ALLOW_ORDER_CREATE)." });
    if (user.role !== "customer" && process.env.ALLOW_ADMIN_ORDERS !== "true") return json(403, { error: "Only customer users can place orders." });
    const b = await request.json().catch(() => null);
    const customerNo = user.role === "customer" ? user.customerNo : (b && b.customerNo);
    if (!b || !customerNo) return json(400, { error: "Missing order details." });
    const draftId = String(b.draftId || "").slice(0, 40);
    if (draftId && recentSubmits.has(draftId)) return json(200, { duplicate: true, ...recentSubmits.get(draftId) });
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (!lines.length || lines.length > 200) return json(400, { error: "An order needs between 1 and 200 lines." });
    for (const l of lines) {
      if (!/^[A-Za-z0-9._\-\/ ]{1,20}$/.test(String(l.itemNo || ""))) return json(400, { error: `Invalid item number: ${l.itemNo}` });
      const q = Number(l.quantity); if (!(q > 0 && q <= 100000 && Number.isFinite(q))) return json(400, { error: `Invalid quantity for ${l.itemNo}` });
    }
    // Interim: the customer PO rides along in External Document No. until "Your Reference" is available through the custom API.
    const po = String((b.header && b.header.customerPO) || "").replace(/[^\w\-\/ .]/g, "").slice(0, 25);

    // Every line must be on the customer's own price list (Customer Price Group), checked here, not trusted from the browser.
    const pl = await priceListFor(customerNo);
    if (!pl.group) return json(400, { error: "Your price list isn't set up in the portal yet. Contact JSH." });
    const byItem = new Map(pl.lines.map(l => [l.itemNo, l]));
    const bad = [...new Set(lines.map(l => String(l.itemNo)))].filter(n => !byItem.has(n));
    if (bad.length) return json(400, { error: `These items aren't on your price list: ${bad.join(", ")}` });

    const h = b.header || {};
    // Take the next number and create the order inside one lock, so numbers never collide on this instance.
    const run = numberLock.then(async () => {
      const portalNo = fmtPortalNo((await highestPortalNo()) + 1);
      const extDoc = (po ? `${portalNo}/${po}` : portalNo).slice(0, 35);
      const body = {
      customerNumber: customerNo,
      externalDocumentNumber: extDoc,
      orderDate: new Date().toISOString().slice(0, 10),
      ...(h.requestedDeliveryDate && /^\d{4}-\d{2}-\d{2}$/.test(h.requestedDeliveryDate) ? { requestedDeliveryDate: h.requestedDeliveryDate } : {}),
      // Prices come from BC, never from the browser.
      salesOrderLines: lines.map(l => ({ lineType: "Item", lineObjectNumber: String(l.itemNo), quantity: Number(l.quantity), ...(byItem.get(String(l.itemNo)).uom ? { unitOfMeasureCode: byItem.get(String(l.itemNo)).uom } : {}) }))
    };
      const created = await bc("POST", "/salesOrders?$expand=salesOrderLines", body);
      return { created, portalNo };
    });
    numberLock = run.catch(() => {});
    const { created, portalNo } = await run;
    ctx.log(`Order ${created.number} created by ${user.username} for ${customerNo} (portal ${portalNo})`);
    const result = { number: created.number, id: created.id, portalOrderNo: portalNo, status: created.status === "Draft" ? "Open" : created.status, totalAmountIncludingTax: created.totalAmountIncludingTax };
    // Record who placed it, then email the customer and JSH staff. A failed email never fails the order.
    if (store.enabled()) await store.logOrder({ customerNo, portalNo, soNo: created.number, name: user.name, email: user.email, po }).catch(e => ctx.error(e));
    try {
      const custName = created.customerName || customerNo;
      const t = mail.templates.orderPlaced({ portalNo, soNo: created.number, customerName: custName, placedBy: user.name, po, lines: (created.salesOrderLines || lines.map(l => ({ lineObjectNumber: l.itemNo, quantity: l.quantity }))).map(l => ({ itemNo: l.lineObjectNumber, description: l.description, quantity: l.quantity })), total: created.totalAmountIncludingTax, link: siteUrl(request) });
      const r = await mail.send({ to: user.email || mail.staff()[0], cc: mail.staff(), ...t });
      result.emailed = r.sent;
    } catch (e) { ctx.error(e); result.emailed = false; }
    if (draftId) { recentSubmits.set(draftId, result); setTimeout(() => recentSubmits.delete(draftId), 15 * 60e3); }
    return json(201, result);
  })
});

// ---------- Posted sales invoices ----------
app.http("invoices", {
  route: "invoices", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async (request, ctx, user) => {
    const cust = scopeCustomer(request, user);
    const filter = cust ? `&$filter=customerNumber eq ${lit(cust)}` : "";
    const r = await bc("GET", `/salesInvoices?$select=id,number,invoiceDate,dueDate,orderNumber,externalDocumentNumber,customerNumber,customerName,totalAmountIncludingTax,remainingAmount,status&$expand=salesInvoiceLines($select=sequence,lineType,lineObjectNumber,description,unitOfMeasureCode,quantity,unitPrice)&$orderby=invoiceDate desc&$top=100${filter}`);
    return json(200, { value: r.value.map(({ salesInvoiceLines, ...v }) => ({ ...v, lines: salesInvoiceLines || [] })) });
  })
});

// ---------- Invoice PDF, rendered by BC with its own invoice layout ----------
app.http("invoice-pdf", {
  route: "invoices/{id}/pdf", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async (request, ctx, user) => {
    const id = String(request.params.id || "");
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return json(400, { error: "Invalid invoice." });
    const inv = await bc("GET", `/salesInvoices(${id})?$select=number,customerNumber`);
    if (user.role !== "admin" && inv.customerNumber !== user.customerNo) return json(404, { error: "Invoice not found." });
    const pdf = await bcBinary(`/salesInvoices(${id})/pdfDocument/pdfDocumentContent`);
    return { status: 200, body: pdf, headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Invoice-${String(inv.number).replace(/[^\w-]/g, "")}.pdf"`, "Cache-Control": "no-store" } };
  })
});


