# JSH Trade Portal Connector (BC extension)

Object range **99700–99749**. Additive only: no existing object, field, code or layout is changed, and there are **no event subscribers**. Nothing hooks into release, posting or approval.

## What it adds
| Object | ID | What |
|---|---|---|
| Table ext. Sales Header | 99700 | `Portal Order Placed By` (Text 100), `Portal Order Notes` (Text 250), read-only |
| Table ext. Sales Shipment Header / Sales Invoice Header | 99701 / 99702 | Same fields, same numbers, so BC copies them on posting |
| Page ext. Sales Order, Sales Order List, Posted Sales Invoice, Posted Sales Shipment | 99700–99703 | Shows the fields (added at the end of General; hidden column on the list) |
| API page `portalSalesOrders` | 99710 | Create an order (header + lines in one call); read status, **Order Reviewed**, Your Reference, Placed By, Notes. No modify, no delete |
| API page `portalSalesOrderLines` | 99711 | Item lines; prices come from BC, never from the portal |
| Permission set `JSHP PORTAL API` | 99700 | Assign to the portal's Entra app |
| Permission sets `JSHP PORTAL USER` / `JSHP PORTAL ADMIN` | 99701 / 99702 | Staff who invite / whoever sets up the connection (and the job queue user) |
| Setup page `JSH Trade Portal Setup` | 99720 | Portal URL, shared key (isolated storage), confirmations on/off, start date |
| Codeunit `JSHP Confirm Notifier` | 99721 | Job queue: finds Released + Reviewed portal orders, tells the portal once, logs it. Read-only on sales orders |
| Action **Invite to Portal** on Customer card/list | 99704 / 99705 | Pick the customer's email and/or its contacts; sends invites with the Customer Price Group |
| Tables: setup, notification log, invite buffer (temporary) | 99720–99722 | |

API address: `/api/JSHealth/portal/v1.0/companies({id})/portalSalesOrders`

**Order Reviewed** is JSHealthXero's field 50031 on Sales Header. It's read by field number, so this extension has no dependency on JSHealthXero.

## Install in the sandbox
1. Open this folder in VS Code with the AL Language extension.
2. `launch.json`: point at the sandbox **AUSandbox4Nov26** → **AL: Download Symbols**.
3. **Ctrl+F5** (publish without debugging). Fix anything the compiler flags. Compiled against BC 24 or later.
4. BC → **Microsoft Entra Applications** → JSH Trade Portal → add permission set **JSHP PORTAL API**.
5. Azure → Static Web App → Environment variables → `PORTAL_ORDER_API` = `true` → Apply.
6. Portal `/connection.html` → the `portalSalesOrders (connector)` check should be **ok**.

## Connect BC to the portal (Invite button + confirmations)
1. Make a random key of 40+ characters (password manager). Azure → `BC_PORTAL_KEY` = that key → Apply.
2. BC → **Extension Management** → JSH Trade Portal Connector → **Configure** → turn on **Allow HttpClient Requests** (sandboxes block outgoing calls by default).
3. BC → search **JSH Trade Portal Setup** → Portal URL = the portal address → **Set Portal Key** → paste the same key.
4. Tick **Send Order Confirmations**; leave **Only Orders Dated From** = today so older orders never email.
5. BC → **Job Queue Entries** → New: Object Type = Codeunit, Object ID = **99721**, recurring every **5 minutes**, all weekdays → **Set Status to Ready**.
6. Test: release a portal order and set Order Reviewed = Reviewed → **Send Confirmations Now** on the setup page → check the **Notification Log** and the inbox.
7. Customer card → **Invite to Portal** → tick people → OK.

## Remove
Uninstall the extension (choose to delete data if you want the two fields gone). Set `PORTAL_ORDER_API` back to `false` first; the portal then returns to the standard API.
