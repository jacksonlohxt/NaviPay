# NaviPay

NaviPay is a local-only commerce sandbox. A user enters a purchase instruction such as `Find an Apple Magic Keyboard` and an optional approved target commerce site, then presses **Discover and purchase**. The server interprets the intent, reads a bounded local replay merchant through a separate read-only Playwright worker, returns normalized candidates and match evidence, then uses the selected candidate with the seeded fake quote, inventory, XSGD wallet, order, fulfillment, delivery, receipt, and audit flow.

Everything in this repository is simulated. No real money, wallet keys, merchant credentials, inventory, customer identity, or delivery network is used.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm install
npm start
```

Open <http://127.0.0.1:3000>. The app starts with an empty purchase history and a seeded fake wallet. Enter one of the example requests and run it. State is persisted in `.data/navipay.json`; set `NAVIPAY_DATA_FILE` to use another local file.

```sh
npm test
npm run check
```

## Product walkthrough

1. Enter a purchase instruction such as `I want a keyboard` and, when using browser discovery, enter the approved target site URL in **Target commerce site**. Press **Discover and purchase** once.
2. NaviPay ranks valid in-stock candidates with a deterministic policy: brand match, category match, distinct keyword matches, then a unique top score. A clear winner within the XSGD 1,000 task ceiling is selected automatically. The calm view shows the selected item, why it won, the discovery source, and source evidence.
3. NaviPay cross-checks browser identity and quote amounts against the authoritative seeded local catalog, then automatically reserves inventory, verifies the fake wallet, transfers fake funds, confirms merchant credit, creates the order, fulfills it, delivers it, issues the receipt, and records the audit trail. The quiet four-part progress summary shows this work without stage-by-stage controls.
4. See the outcome at a glance: the interpreted request, selected merchant and rationale, quote breakdown, wallet before/after-payment/final balance, inventory, payment, order, fulfillment, delivery, and receipt status.
5. NaviPay pauses only for a genuine tie or ambiguity, malformed/stale/blocked discovery, no available or over-cap item, insufficient fake funds, an unknown payment result, or another safety exception. **Advanced details** explains the issue and available action. Technical references, ledger legs, operations, chain evidence, and the safe activity timeline stay expandable.

The customer and address are deliberately labeled simulated and are stored as replaceable fixtures in `src/sandbox.js`. The fake wallet is named **NaviPay Demo Wallet**, owned by **Demo Customer**, and starts with a seeded XSGD balance of XSGD 500.00.

## Local fake environments

- **Merchant catalog**: `CATALOG` in `src/sandbox.js` contains merchant IDs, local merchant domains, SKUs, variant IDs, prices, tax and shipping, quantities, and product categories for keyboards, mice, and earphones. It remains the reliable default and test oracle.
- **Inventory**: `LocalInventoryAdapter` supports one-unit stock leases with expiry, reserve, commit, release, out-of-stock handling, and idempotent operation references. Reservation happens before any wallet debit.
- **Wallet**: `LocalWalletTransferAdapter` operates on the seeded wallet and writes an atomic double-entry ledger. A transfer has a wallet debit and merchant credit leg, a stable operation reference, replay lookup, insufficient-funds handling, decline handling, unknown-result handling, and compensation support. The wallet balance is the spendable source. It is not inferred from chain evidence.
- **Merchant credit**: `LocalMerchantCreditAdapter` confirms that the ledger credit reached the selected merchant before order creation.
- **Order**: `LocalOrderAdapter` creates an idempotent order only after confirmed payment and committed inventory.
- **Fulfillment and delivery**: `LocalFulfillmentAdapter` and `LocalDeliveryAdapter` write independent statuses. A delivery failure leaves the confirmed payment, merchant credit, order, and receipt confirmed.

All adapter responses are normalized server-side. The browser receives status, references, and safe evidence only, never raw provider payloads or credentials.

## Competition-style local browser discovery test

The default is still the seeded catalog and does not require Playwright. To run the competition-style replay merchant and bounded browser worker:

```sh
npm install
npm install --no-save playwright
npx playwright install chromium
npm run demo:playwright
```

Then perform this exact test:

1. Open <http://127.0.0.1:3000>.
2. Enter `Find an Apple Magic Keyboard` in **Purchase instruction**.
3. Enter `http://127.0.0.1:43123/competition-site/` in **Target commerce site**. This is the local replay merchant served by the demo command.
4. Press **Discover and purchase**.
5. Observe the **Local browser fixture** badge, the automatically selected Apple Magic Keyboard, why it won, source URL, observed time, and progress. No Advanced details or selection click is needed.
6. Repeat with `I want a mouse` and `I want earphones` to exercise automatic mouse and earphone paths. A replay containing tied candidates pauses in **Advanced details**; a no-match or unsafe browser result is labelled and handled through the seeded fallback. Stop both local processes with Ctrl-C.

The script serves `fixtures/competition-site/index.html` on port 43123 and starts NaviPay with Playwright discovery enabled, explicitly allowlisted to `127.0.0.1`. The target-site field never grants permission: a user URL is accepted only when its http or https scheme and host are already on that server-side allowlist. The worker sends no credentials and performs only bounded GET or HEAD reads. It never clicks search, checkout, order, or payment controls. The fixture's search form and product cards mirror the competition interaction while its normalized candidate payload is the deterministic replay seam.

If the optional `playwright` package or its browser is unavailable, the same steps show **Seeded catalog fallback** and explain that browser discovery was unavailable. The default `npm start` path shows **Seeded catalog** and never attempts browser discovery. Browser evidence is read-only and never has payment or checkout authority. NaviPay proceeds automatically only after a unique in-stock winner is ranked and the server matches its identity and quote amounts to the approved local quote. Discovery itself never reserves inventory, authorizes payment, creates an order, or invokes checkout. Approved merchant adapters remain mandatory for the authoritative quote, inventory, order, fulfillment, and payment boundaries.

The adapter runs in a separate worker process, permits only GET and HEAD requests, and enforces page, tab, redirect, response-size, candidate, and deadline limits. It sends no credentials, uses no proxy, performs no arbitrary page evaluation, and has no checkout, order, inventory, or payment capability. If navigation is blocked, data is malformed or stale, a limit is exceeded, or the worker fails, NaviPay returns an unavailable discovery status with a safe reason code and uses the explicitly labelled seeded catalog fallback. Playwright is an optional local development tool and is not required for the default product or CI.

## API boundary

Every sandbox task response includes the legacy `task` object for deliberate compatibility and a versioned server-owned `projection` read model. The projection is the browser contract and contains only interpreted request data, recommendation rationale and catalog evidence, the locked quote and expiry, inventory reservation, financial snapshots, payment, merchant credit, order, fulfillment, delivery, receipt, safe operations, and a redacted timeline. It never includes provider payloads, credentials, or full customer address details. `GET /api/tasks/:id/projection` retrieves the same projection after a reload; list responses include `projections`.

Financial projections explicitly persist `balanceBeforeMinor`, `balanceAfterPaymentMinor`, `finalBalanceMinor`, `netChargedMinor`, compensation status and references, and a financial `outcome`. This keeps compensation and unknown-payment reconciliation truthful after process restart.

- `POST /api/purchases/run` with `{ "request": "I want a mouse" }` runs the complete bounded lifecycle. Send an `Idempotency-Key` header.
- `POST /api/tasks/:id/run` resumes a run waiting for an explicit candidate selection after a genuine ambiguity or tie.
- `POST /api/tasks/:id/payment/reconcile` with `{ "resolution": "authorized" }` or `{ "resolution": "declined" }` resolves an unknown wallet result without retrying the transfer.
- `GET /api/tasks`, `GET /api/tasks/:id`, `GET /api/tasks/:id/receipt`, and `GET /api/tasks/:id/audit` expose persisted safe views.
- `GET /api/wallet` exposes the seeded fake balance and ledger evidence. `GET /api/catalog` exposes safe catalog and stock facts.
- `POST /api/reset` clears local purchase history and restores the seeded wallet and inventory.

`GET /api/discovery` and the `discovery` field in task-list and purchase-run responses expose the server-owned, read-only discovery configuration projection. It reports whether the seeded catalog or local browser fixture is active, whether fallback is available, and the safe explanation shown by the UI. It never returns configured URLs, allowlists, worker details, credentials, or provider payloads. The selected candidate projection exposes only the validated source URL, observed timestamp, and match rationale for Advanced details.

`POST /api/purchases/run` accepts `{ "request": "Find an Apple Magic Keyboard", "targetSite": "http://127.0.0.1:43123/competition-site/" }`. An absent target uses the configured challenge site when one is enabled. A malformed target is rejected; a syntactically valid but unapproved target is never fetched and produces an understandable unavailable/fallback result. The server-side allowlist is configured with `NAVIPAY_DISCOVERY_ALLOWLIST`; configured challenge URLs use `NAVIPAY_DISCOVERY_URLS` or `NAVIPAY_CHALLENGE_SITE_URL`.

The server entrypoint is `src/server.js`. The product orchestration and adapter contracts are in `src/sandbox.js`. The JSON store is in `src/store.js`.

## Recovery scenarios

The server supports deterministic local scenarios for integration testing: `insufficient-funds`, `payment-decline`, `unknown-payment`, `order-failure`, `merchant-credit-failure`, `out-of-stock`, `fulfillment-failure`, `delivery-failure`, `funding-failure`, and `discovery-failure`. They are API fixtures, not user-facing product controls.

- Insufficient funds and payment decline release the reservation and create no ledger entries.
- Unknown payment holds the reservation and blocks retries. Reconciliation either applies the one idempotent transfer or releases the reservation.
- Merchant-credit and order failures compensate an already confirmed wallet transfer and release reserved stock. Compensation is itself a double-entry operation.
- Delivery and fulfillment failures do not rewrite a confirmed payment or order as failed. Their independent statuses remain visible on the receipt and task.
- Repeating an idempotency key replays the persisted response. Repeating an adapter operation uses its persisted operation, reservation, transfer, order, or delivery reference and does not duplicate side effects.

## Persistence and compatibility

`src/store.js` uses version 2 state with an explicit migration from the previous version 1 task/audit store. It persists tasks, progress, operations, wallet transfers, ledger legs, reservations, orders, delivery records, and idempotency responses. JSON writes use a restricted directory, a restricted temporary file, fsync, and atomic rename. A task can therefore be inspected and safely resumed after a process restart.

## Future organizer adapters

The local adapters are intentionally narrow replacement points. A future approved organizer integration can implement the canonical methods in `src/sandbox.js` for discovery, funding lookup, inventory reservation, wallet transfer, merchant credit, order, fulfillment, or delivery. Normalize provider status, timeout, and reference data inside that adapter, keep credentials in the provider process, and preserve the server-owned operation IDs, exact quote, inventory-before-payment invariant, idempotency, compensation, and redacted browser contract. The local fixtures remain the default until an approved provider contract and credentials exist. Adapters must return normalized facts to the service; projection builders are the only boundary used by browser read APIs.

## Deliberate boundary

This is one local operator and one modular Node application. It is not a generalized marketplace, social login system, production wallet, custody service, KYC system, real-money payment integration, live inventory feed, or multi-merchant consumer product.
