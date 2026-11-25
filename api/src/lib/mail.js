// Email through Microsoft Graph, sent as the JSH mailbox in MAIL_SENDER.
// Uses the same app registration as BC; needs the Mail.Send application permission, limited to that mailbox.
"use strict";
const { config } = require("./bc");

let cache = { value: null, expiresAt: 0 };
async function graphToken() {
  const c = config();
  if (cache.value && Date.now() < cache.expiresAt - 120000) return cache.value;
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.secret, scope: "https://graph.microsoft.com/.default" });
  const res = await fetch(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, { method: "POST", body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Couldn't get a mail token: " + (j.error_description || j.error));
  cache = { value: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
  return cache.value;
}
const enabled = () => !!process.env.MAIL_SENDER;
const staff = () => String(process.env.NOTIFY_STAFF || "").split(/[;,]/).map(s => s.trim()).filter(Boolean);

async function send({ to, cc = [], subject, html }) {
  if (!enabled()) return { sent: false, reason: "MAIL_SENDER not set" };
  const list = a => [...new Set(a.filter(Boolean))].map(address => ({ emailAddress: { address } }));
  const token = await graphToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MAIL_SENDER)}/sendMail`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: list([].concat(to)), ccRecipients: list(cc) }, saveToSentItems: true })
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error("Email not sent: " + ((j.error && j.error.message) || res.status)); }
  return { sent: true };
}

// ---------- templates ----------
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n) || 0);
function frame(title, inner) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#fbf9ff;font-family:Segoe UI,Arial,sans-serif;color:#1d1a2b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #ece7f5">
  <tr><td style="padding:26px 28px 18px;border-bottom:1px solid #ece7f5">${process.env.PORTAL_URL ? `<img src="${esc(process.env.PORTAL_URL.replace(/\/$/, ""))}/jsh-logo.png" alt="JSH Health Vitamins" width="180" style="display:block;width:180px;height:auto;border:0">` : `<span style="font-size:20px;font-weight:700;letter-spacing:.2em">JSHEALTH</span>`}<div style="margin-top:8px;font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:#5b5670">Trade Portal</div></td></tr>
  <tr><td style="padding:28px"><h1 style="margin:0 0 14px;font-size:22px">${esc(title)}</h1>${inner}</td></tr>
  <tr><td style="padding:16px 28px;background:#f6f3fb;color:#8f8aa3;font-size:12px">This email was sent by the JSH Trade Portal. Please don't reply to it.</td></tr>
  </table></td></tr></table></body></html>`;
}
const button = (href, label) => `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#111111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;display:inline-block">${esc(label)}</a></p><p style="font-size:12px;color:#8f8aa3;word-break:break-all">Or paste this link into your browser: ${esc(href)}</p>`;

const templates = {
  invite: ({ name, customerName, link }) => ({
    subject: "You're invited to the JSH Trade Portal",
    html: frame("You're invited", `<p>Hi${name ? " " + esc(name) : ""},</p><p>You've been invited to order online for <b>${esc(customerName)}</b> on the JSH Trade Portal: place orders, follow them through to delivery, and download invoices.</p>${button(link, "Set up my account")}<p style="color:#5b5670">This link works once and expires in 7 days.</p>`)
  }),
  reset: ({ name, link }) => ({
    subject: "Reset your JSH Trade Portal password",
    html: frame("Reset your password", `<p>Hi${name ? " " + esc(name) : ""},</p><p>Someone (hopefully you) asked to reset the password for your JSH Trade Portal account.</p>${button(link, "Choose a new password")}<p style="color:#5b5670">This link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>`)
  }),
  orderConfirmed: ({ portalNo, soNo, customerName, po, lines, link }) => ({
    subject: `Order ${portalNo} confirmed (${customerName})`,
    html: frame(`Order ${portalNo} is confirmed`, `<p>Good news: JSH has reviewed and confirmed your order. We'll let you know when it ships.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;margin:12px 0">
      <tr><td style="color:#8f8aa3;padding:4px 0">Portal order</td><td><b>${esc(portalNo)}</b></td></tr>
      <tr><td style="color:#8f8aa3;padding:4px 0">JSH sales order</td><td><b>${esc(soNo)}</b></td></tr>
      <tr><td style="color:#8f8aa3;padding:4px 0">Customer</td><td>${esc(customerName)}</td></tr>
      ${po ? `<tr><td style="color:#8f8aa3;padding:4px 0">Your PO</td><td>${esc(po)}</td></tr>` : ""}</table>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">
      <tr style="background:#f6f3fb"><th align="left">Item</th><th align="left">Description</th><th align="right">Qty</th></tr>
      ${lines.map(l => `<tr style="border-bottom:1px solid #ece7f5"><td>${esc(l.itemNo)}</td><td>${esc(l.description || "")}</td><td align="right">${esc(l.quantity)}</td></tr>`).join("")}
      </table><p style="color:#5b5670">Your order can no longer be changed in the portal.</p>${button(link, "View in the portal")}`)
  }),
  orderPlaced: ({ portalNo, soNo, customerName, placedBy, po, lines, total, link }) => ({
    subject: `Order ${portalNo} received (${customerName})`,
    html: frame(`Order ${portalNo} received`, `<p>Thanks, we've received your order. JSH will review and confirm it shortly.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;margin:12px 0">
      <tr><td style="color:#8f8aa3;padding:4px 0">Portal order</td><td><b>${esc(portalNo)}</b></td></tr>
      <tr><td style="color:#8f8aa3;padding:4px 0">JSH sales order</td><td><b>${esc(soNo)}</b></td></tr>
      <tr><td style="color:#8f8aa3;padding:4px 0">Customer</td><td>${esc(customerName)}</td></tr>
      ${po ? `<tr><td style="color:#8f8aa3;padding:4px 0">Your PO</td><td>${esc(po)}</td></tr>` : ""}
      <tr><td style="color:#8f8aa3;padding:4px 0">Placed by</td><td>${esc(placedBy)}</td></tr></table>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">
      <tr style="background:#f6f3fb"><th align="left">Item</th><th align="left">Description</th><th align="right">Qty</th></tr>
      ${lines.map(l => `<tr style="border-bottom:1px solid #ece7f5"><td>${esc(l.itemNo)}</td><td>${esc(l.description || "")}</td><td align="right">${esc(l.quantity)}</td></tr>`).join("")}
      </table>${total != null ? `<p style="text-align:right;font-size:16px"><b>Total inc GST: ${money(total)}</b></p>` : ""}${button(link, "View in the portal")}`)
  })
};

module.exports = { send, enabled, staff, templates };
