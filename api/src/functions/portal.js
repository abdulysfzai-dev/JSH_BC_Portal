"use strict";
const crypto = require("crypto");
const { app } = require("@azure/functions");
const { bc, getToken, config, lit } = require("../lib/bc");
const { login } = require("../lib/session");
const { json, handler, currentUser, scopeCustomer } = require("../lib/http");

const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
const ORDER_FIELDS = ["id", "number", "externalDocumentNumber", "orderDate", "requestedDeliveryDate", "customerNumber", "customerName", "status", "fullyShipped", "totalAmountExcludingTax", "totalTaxAmount", "totalAmountIncludingTax", "lastModifiedDateTime"];
const LINE_FIELDS = ["sequence", "lineType", "lineObjectNumber", "description", "unitOfMeasureCode", "quantity", "unitPrice", "netAmount", "amountIncludingTax", "shippedQuantity", "invoicedQuantity"];

// ---------- Health: is the BC connection working? ----------
// Anyone gets yes/no checks. A signed-in admin also gets company names/ids and sample counts.
app.http("health", {
  route: "health", methods: ["GET"], authLevel: "anonymous",
  handler: async (request, context) => {
    const c = config(); const user = currentUser(request); const admin = user && user.role === "admin";
    const out = {
      time: new Date().toISOString(),
      settings: { BC_TENANT_ID: !!c.tenant, BC_CLIENT_ID: !!c.clientId, BC_CLIENT_SECRET: !!c.secret, BC_ENVIRONMENT: c.env || false, BC_COMPANY_ID: !!c.companyId, SESSION_SECRET: !!process.env.SESSION_SECRET, PORTAL_USERS: (() => { try { return JSON.parse(process.env.PORTAL_USERS || "[]").length; } catch { return "invalid JSON"; } })(), ALLOW_ORDER_CREATE: process.env.ALLOW_ORDER_CREATE === "true" },
      checks: {}
    };
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
    }
    return json(200, out);
  }
});

// ---------- Sign in ----------
app.http("login", {
  route: "auth/login", methods: ["POST"], authLevel: "anonymous",
  handler: handler(async request => {
    const b = await request.json().catch(() => ({}));
    await new Promise(r => setTimeout(r, 300)); // slows down password guessing
    const s = login(b.username, b.password);
    if (!s) return json(401, { error: "That username and password don't match." });
    return json(200, s);
  }, { auth: false })
});

app.http("me", { route: "auth/me", methods: ["GET"], authLevel: "anonymous", handler: handler(async (req, ctx, user) => json(200, { user })) });

// ---------- Customers ----------
app.http("customers", {
  route: "customers", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async (request, ctx, user) => {
    const fields = "number,displayName,email,phoneNumber,addressLine1,addressLine2,city,state,postalCode,paymentTermsId,blocked";
    if (user.role === "admin") {
      const r = await bc("GET", `/customers?$select=${fields}&$orderby=number&$top=200`);
      return json(200, { value: r.value });
    }
    const r = await bc("GET", `/customers?$filter=number eq ${lit(user.customerNo)}&$select=${fields}`);
    return json(200, { value: r.value });
  })
});

// ---------- Items (standard API; the custom price-list API will replace this for customers) ----------
app.http("items", {
  route: "items", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async () => {
    const r = await bc("GET", "/items?$filter=blocked eq false&$select=id,number,displayName,itemCategoryCode,baseUnitOfMeasureCode,unitPrice,inventory,gtin&$orderby=number&$top=500");
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
    return json(200, { value, note: "Order reviewed is a custom field: it arrives with the custom order-status API." });
  })
});

// ---------- Portal order number ----------
// Unique and readable: WEB-YYMMDD-XXXX. Replaced by a BC number series once the custom API exists.
app.http("order-number", {
  route: "orders/new-number", methods: ["POST"], authLevel: "anonymous",
  handler: handler(async () => {
    const d = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    return json(200, { portalOrderNo: `WEB-${d}-${crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5)}` });
  })
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
    const portalNo = String(b.portalOrderNo || "");
    if (!/^WEB-\d{6}-[0-9A-F]{5}$/.test(portalNo)) return json(400, { error: "Invalid portal order number." });
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (!lines.length || lines.length > 200) return json(400, { error: "An order needs between 1 and 200 lines." });
    for (const l of lines) {
      if (!/^[A-Za-z0-9._\-\/ ]{1,20}$/.test(String(l.itemNo || ""))) return json(400, { error: `Invalid item number: ${l.itemNo}` });
      const q = Number(l.quantity); if (!(q > 0 && q <= 100000 && Number.isFinite(q))) return json(400, { error: `Invalid quantity for ${l.itemNo}` });
    }
    // Interim link: portal no. (and customer PO) in External Document No. Moves to a custom field with the custom API.
    const po = String((b.header && b.header.customerPO) || "").replace(/[^\w\-\/ .]/g, "").slice(0, 20);
    const extDoc = (po ? `${portalNo}/${po}` : portalNo).slice(0, 35);

    // Double-submit guard: if this portal order is already in BC, return it instead of creating another.
    const existing = await bc("GET", `/salesOrders?$filter=customerNumber eq ${lit(customerNo)} and startswith(externalDocumentNumber,${lit(portalNo)})&$select=number,externalDocumentNumber,status`);
    if (existing.value.length) return json(200, { duplicate: true, number: existing.value[0].number, portalOrderNo: portalNo });

    // Every item must exist and not be blocked. (The custom price-list check slots in here.)
    const nos = [...new Set(lines.map(l => String(l.itemNo)))];
    const items = await bc("GET", `/items?$filter=${nos.map(n => `number eq ${lit(n)}`).join(" or ")}&$select=number,blocked`);
    const ok = new Set(items.value.filter(i => !i.blocked).map(i => i.number));
    const bad = nos.filter(n => !ok.has(n));
    if (bad.length) return json(400, { error: `These items can't be ordered: ${bad.join(", ")}` });

    const h = b.header || {};
    const body = {
      customerNumber: customerNo,
      externalDocumentNumber: extDoc,
      orderDate: new Date().toISOString().slice(0, 10),
      ...(h.requestedDeliveryDate && /^\d{4}-\d{2}-\d{2}$/.test(h.requestedDeliveryDate) ? { requestedDeliveryDate: h.requestedDeliveryDate } : {}),
      // Prices come from BC, never from the browser.
      salesOrderLines: lines.map(l => ({ lineType: "Item", lineObjectNumber: String(l.itemNo), quantity: Number(l.quantity) }))
    };
    const created = await bc("POST", "/salesOrders", body);
    ctx.log(`Order ${created.number} created by ${user.username} for ${customerNo} (portal ${portalNo})`);
    return json(201, { number: created.number, id: created.id, portalOrderNo: portalNo, status: created.status === "Draft" ? "Open" : created.status, totalAmountIncludingTax: created.totalAmountIncludingTax });
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

// ---------- Shipments (QBT custom API) ----------
app.http("shipments", {
  route: "shipments", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async () => json(501, { error: "Waiting for the custom QBT API." }))
});
