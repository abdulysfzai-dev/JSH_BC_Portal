// Price list (JSH custom API) and QBT shipments (JSH custom API). Both read-only.
"use strict";
const { app } = require("@azure/functions");
const { bc, bcAll, lit } = require("../lib/bc");
const store = require("../lib/store");
const { json, handler, scopeCustomer } = require("../lib/http");

const cache = new Map();
async function cached(key, ms, fn) { const c = cache.get(key); if (c && Date.now() - c.t < ms) return c.v; const v = await fn(); cache.set(key, { t: Date.now(), v }); return v; }

// All items, slim, for descriptions and categories. JSH has many items, so page through them all.
const allItems = () => cached("items:all", 15 * 60e3, async () => {
  const list = await bcAll("/items?$select=number,displayName,itemCategoryCode,baseUnitOfMeasureCode,blocked,gtin");
  return new Map(list.map(i => [i.number, i]));
});

// QBT may use the warehouse's own codes. Map a QBT line to a BC item: by item no., else by GTIN (barcode).
async function resolveItemNo(qbtItemNo, gtin) {
  const items = await allItems();
  if (items.has(qbtItemNo)) return qbtItemNo;
  if (gtin) { for (const [no, it] of items) if (it.gtin && it.gtin === gtin) return no; }
  return qbtItemNo;
}

async function qbtFor(soNumbers) {
  const bySo = {};
  for (let k = 0; k < soNumbers.length; k += 15) {
    const part = soNumbers.slice(k, k + 15);
    const filter = part.map(n => `orderNumber eq ${lit(n)}`).join(" or ");
    const r = await bcAll(`/qbtHeaders?$filter=${filter}&$expand=qbtLines`, { custom: true });
    for (const h of r) {
      const lines = [];
      for (const l of h.qbtLines || []) lines.push({ itemNo: await resolveItemNo(l.itemNumber, l.gtin), qbtItemNo: l.itemNumber, gtin: l.gtin || "", lotNo: l.batchNumber || "", qty: l.shippingQuantity, expiry: l.expiryDate && l.expiryDate !== "0001-01-01" ? l.expiryDate : "" });
      (bySo[h.orderNumber] = bySo[h.orderNumber] || []).push({ shipmentNo: String(h.shipmentNumber), date: h.shipmentDate, carrier: h.carrier || "", tracking: h.trackingNumber || "", completed: !!h.completed, lines });
    }
  }
  return bySo;
}

async function priceGroupOf(customerNo) {
  const s = await store.getCustomerSettings().catch(() => ({}));
  return (s[customerNo] && s[customerNo].priceGroup) || "";
}

// The customer's price list: Active sale lines for their Customer Price Group, valid today, one line per item.
async function priceListFor(customerNo) {
  const group = await priceGroupOf(customerNo);
  if (!group) return { group: "", lines: [] };
  const raw = await cached("pl:" + group, 5 * 60e3, () => bcAll(`/salesPriceListLines?$filter=sourceNumber eq ${lit(group)}`, { custom: true }));
  const today = new Date().toISOString().slice(0, 10);
  const isGroup = t => /price.*group/i.test(String(t).replace(/_x0020_/g, " "));
  const valid = raw.filter(l => isGroup(l.sourceType) && l.sourceNumber === group && /sale/i.test(l.priceType) && /item/i.test(l.assetType) && /active/i.test(l.status)
    && (!l.startingDate || l.startingDate === "0001-01-01" || l.startingDate <= today)
    && (!l.endingDate || l.endingDate === "0001-01-01" || l.endingDate >= today));
  const items = await allItems();
  const best = new Map();
  for (const l of valid) {
    const cur = best.get(l.itemNumber);
    // Prefer the line with the lowest minimum quantity, then the most recent start date.
    if (!cur || l.minimumQuantity < cur.minimumQuantity || (l.minimumQuantity === cur.minimumQuantity && l.startingDate > cur.startingDate)) best.set(l.itemNumber, l);
  }
  const lines = [...best.values()].map(l => {
    const it = items.get(l.itemNumber) || {};
    return { itemNo: l.itemNumber, description: it.displayName || l.itemNumber, category: it.itemCategoryCode || "Other", uom: l.unitOfMeasureCode || it.baseUnitOfMeasureCode || "", unitPrice: l.unitPrice, minQty: Math.max(1, l.minimumQuantity || 0), discount: l.lineDiscountPercent || 0, blocked: !!it.blocked };
  }).filter(l => !l.blocked).sort((a, b) => a.description.localeCompare(b.description));
  return { group, lines };
}

app.http("pricelist", {
  route: "pricelist", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async (request, ctx, user) => {
    const cust = scopeCustomer(request, user);
    if (!cust) return json(400, { error: "Choose a customer." });
    const pl = await priceListFor(cust);
    if (!pl.group) return json(200, { group: "", lines: [], note: "No price group is set for this customer yet." });
    return json(200, pl);
  })
});

app.http("customer-pricegroup", {
  route: "customers/pricegroup", methods: ["POST"], authLevel: "anonymous",
  handler: handler(async request => {
    const b = await request.json().catch(() => ({}));
    const no = String(b.customerNo || "").slice(0, 20), grp = String(b.priceGroup || "").trim().slice(0, 20);
    if (!no) return json(400, { error: "Missing customer." });
    const c = await bc("GET", `/customers?$filter=number eq ${lit(no)}&$select=number`);
    if (!c.value.length) return json(404, { error: `Customer ${no} wasn't found in Business Central.` });
    await store.setCustomerPriceGroup(no, grp);
    let count = 0;
    if (grp) { cache.delete("pl:" + grp); count = (await priceListFor(no)).lines.length; }
    return json(200, { ok: true, customerNo: no, priceGroup: grp, items: count });
  }, { role: "admin", allowBc: true })
});

// QBT shipments for the customer's orders. The SO list is worked out here, never taken from the browser.
app.http("shipments", {
  route: "shipments", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async (request, ctx, user) => {
    const cust = scopeCustomer(request, user);
    const f = cust ? `$filter=customerNumber eq ${lit(cust)}&` : "";
    const [o, i] = await Promise.all([
      bc("GET", `/salesOrders?${f}$select=number&$top=200&$orderby=orderDate desc`),
      bc("GET", `/salesInvoices?${f}$select=orderNumber&$top=200&$orderby=invoiceDate desc`)
    ]);
    const sos = [...new Set([...o.value.map(x => x.number), ...i.value.map(x => x.orderNumber)].filter(Boolean))];
    // QBT holds the BC sales order number in orderNumber.
    const bySo = await qbtFor(sos);
    return json(200, { bySo });
  })
});

// Admin lookup: what BC and QBT hold for one order (by SO no. or portal no.). Read-only.
app.http("diag-order", {
  route: "diag/order", methods: ["GET"], authLevel: "anonymous",
  handler: handler(async request => {
    const q = String(request.query.get("no") || "").trim().slice(0, 35);
    if (!q) return json(400, { error: "Give an order number (SO… or JSH…)." });
    const out = { searched: q };
    const so = await bc("GET", `/salesOrders?$filter=number eq ${lit(q)} or startswith(externalDocumentNumber,${lit(q)})&$select=number,externalDocumentNumber,customerNumber,status&$expand=salesOrderLines($select=lineType,lineObjectNumber,description,quantity,shippedQuantity)`);
    out.salesOrders = so.value;
    const inv = await bc("GET", `/salesInvoices?$filter=orderNumber eq ${lit(q)} or startswith(externalDocumentNumber,${lit(q)})&$select=number,orderNumber,externalDocumentNumber`);
    out.postedInvoices = inv.value;
    const soNos = [...new Set([q, ...so.value.map(x => x.number), ...inv.value.map(x => x.orderNumber)].filter(Boolean))];
    out.qbtSearchedFor = soNos;
    out.qbtByOrderNumber = await bcAll(`/qbtHeaders?$filter=${soNos.map(n => `orderNumber eq ${lit(n)}`).join(" or ")}&$expand=qbtLines`, { custom: true });
    out.qbtByWholesaleOrderNumber = await bcAll(`/qbtHeaders?$filter=${soNos.map(n => `wholeSaleOrderNumber eq ${lit(n)}`).join(" or ")}&$expand=qbtLines`, { custom: true }).catch(e => ({ error: e.message }));
    out.portalWouldShow = await qbtFor(soNos);
    return json(200, out);
  }, { role: "admin" })
});

module.exports = { priceListFor, priceGroupOf };
