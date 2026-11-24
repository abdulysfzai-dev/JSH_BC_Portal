# JSH Trade Portal Connector (BC extension)

Object range **99700–99749**. Additive only: no existing object, field, code or layout is changed, and there are no event subscribers.

## What it adds
| Object | ID | What |
|---|---|---|
| Table ext. Sales Header | 99700 | `Portal Order Placed By` (Text 100), `Portal Order Notes` (Text 250), read-only |
| Table ext. Sales Shipment Header / Sales Invoice Header | 99701 / 99702 | Same fields, same numbers, so BC copies them on posting |
| Page ext. Sales Order, Sales Order List, Posted Sales Invoice, Posted Sales Shipment | 99700–99703 | Shows the fields (added at the end of General; hidden column on the list) |
| API page `portalSalesOrders` | 99710 | Create an order (header + lines in one call); read status, **Order Reviewed**, Your Reference, Placed By, Notes. No modify, no delete |
| API page `portalSalesOrderLines` | 99711 | Item lines; prices come from BC, never from the portal |
| Permission set `JSHP PORTAL API` | 99700 | Assign to the portal's Entra app |

API address: `/api/JSHealth/portal/v1.0/companies({id})/portalSalesOrders`

**Order Reviewed** is JSHealthXero's field 50031 on Sales Header. It's read by field number, so this extension has no dependency on JSHealthXero.

## Install in the sandbox
1. Open this folder in VS Code with the AL Language extension.
2. `launch.json`: point at the sandbox **AUSandbox4Nov26** → **AL: Download Symbols**.
3. **Ctrl+F5** (publish without debugging). Fix anything the compiler flags. Compiled against BC 24 or later.
4. BC → **Microsoft Entra Applications** → JSH Trade Portal → add permission set **JSHP PORTAL API**.
5. Azure → Static Web App → Environment variables → `PORTAL_ORDER_API` = `true` → Apply.
6. Portal `/connection.html` → the `portalSalesOrders (connector)` check should be **ok**.

## Remove
Uninstall the extension (choose to delete data if you want the two fields gone). Set `PORTAL_ORDER_API` back to `false` first; the portal then returns to the standard API.
