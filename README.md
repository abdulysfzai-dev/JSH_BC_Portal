# JSH Trade Portal

Customer ordering portal for JSH, connected to Business Central (BC).

- `app/`: the portal front end (currently runs on demo data)
- `api/`: Azure Functions back end. Signs in to BC as an app (client credentials) and exposes a small, locked-down API to the portal.
- `staticwebapp.config.json`: Azure Static Web Apps settings and security headers

## Data rule (enforced in `api/src/lib/bc.js`)
The portal only **reads** from BC. The single allowed write is `POST salesOrders`, triggered by a signed-in user's Submit. Anything else (PATCH, DELETE, other POSTs, bulk calls) is refused in code.

## Azure setup (one-off)
1. Azure portal → **Create a resource** → **Static Web App**
   - Subscription/resource group: JSH's. Name: `jsh-trade-portal`. Plan: **Free** for now (switch to Standard before the live trial).
   - Source: **GitHub** → this repo → branch `main`
   - Build presets: **Custom**. App location: `app`. Api location: `api`. Output location: leave empty.
2. When it's created, open it → **Settings → Environment variables** → add:

| Name | Value |
|---|---|
| `BC_TENANT_ID` | JSH's Directory (tenant) ID |
| `BC_CLIENT_ID` | App registration's Application (client) ID |
| `BC_CLIENT_SECRET` | The client secret **value** |
| `BC_ENVIRONMENT` | BC sandbox environment name, exactly as in the BC admin centre |
| `BC_COMPANY_ID` | Leave empty at first. Get it from `/api/health` (step 4) |
| `SESSION_SECRET` | Any random string of 40+ characters (generate one in your password manager) |
| `PORTAL_USERS` | The JSON list of portal sign-ins (supplied separately) |
| `ALLOW_ORDER_CREATE` | `false` until we're ready to test order creation in the sandbox |

3. Save. The site restarts with the new settings.
4. Open `https://<your-site>/api/health`. Every check should say `ok`. Sign in to the portal as admin, then reload `/api/health` to see company names and IDs. Copy the right ID into `BC_COMPANY_ID` and save.

## API (all need a signed-in portal user except `health` and `auth/login`)
| Route | What it does | BC call |
|---|---|---|
| `GET /api/health` | Connection check | token, companies, sample reads |
| `POST /api/auth/login` | Portal sign-in | none |
| `GET /api/customers` | Admin: all; customer: own record | standard `customers` |
| `GET /api/items` | Item list (unblocked) | standard `items` |
| `GET /api/orders` | Sales orders + lines, status translated to BC terms | standard `salesOrders` |
| `POST /api/orders/new-number` | New portal order no. (`WEB-YYMMDD-XXXXX`) | none |
| `POST /api/orders` | Create sales order (Submit only, duplicate-safe, prices from BC) | standard `salesOrders` POST |
| `GET /api/invoices` | Posted invoices with balance | standard `salesInvoices` |
| `GET /api/shipments` | QBT lots | custom API (pending) |

Note: in the standard API, sales order status `Draft` = BC **Open** and `Open` = BC **Released**. The back end translates this.

## Adding a portal user
`cd api && node tools/hash-password.js <username> <password> customer "<Full name>" <BC customer no.>`. This prints one JSON entry to add to `PORTAL_USERS`.

## Coming next
- Custom APIs: price list by Customer Price Group, order status + Order reviewed, QBT shipments, portal order no. field
- Wire the front end to live data (Demo / Sandbox / Production switch)
- Customer sign-in on Microsoft Entra External ID
