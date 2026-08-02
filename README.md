# NaviPay

NaviPay is a local-only commerce sandbox. A user enters a plain request such as `I want a keyboard`, `I want a mouse`, or `I want earphones`, then presses **Run purchase**. The server interprets the intent, finds an in-stock fixture from the seeded merchant catalog, reserves one unit, checks and debits a seeded fake XSGD wallet, credits the fake merchant, creates an order, simulates fulfillment and delivery, and returns a confirmed receipt plus redacted audit evidence.

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

1. Enter a plain request in the single request field, such as `I want a keyboard`, then press **Run purchase** once.
2. Follow the quiet four-part progress summary as NaviPay finds an item, pays from the fake wallet, prepares the order, and delivers it. There are no stage-by-stage controls on the normal path.
3. See the outcome at a glance: the requested item, selected merchant, amount spent, starting and remaining fake balance, order status, and delivery status.
4. If the request needs a choice or a payment result needs confirmation, NaviPay explains what to do in the **Advanced details** section. The same section contains optional inventory, ledger, chain, adapter, references, and audit evidence for inspection.

The customer and address are deliberately labeled simulated and are stored as replaceable fixtures in `src/sandbox.js`. The fake wallet is named **NaviPay Demo Wallet**, owned by **Demo Customer**, and starts with a seeded XSGD balance of XSGD 500.00.

## Local fake environments

- **Merchant catalog**: `CATALOG` in `src/sandbox.js` contains merchant IDs, local merchant domains, SKUs, variant IDs, prices, tax and shipping, quantities, and product categories for keyboards, mice, and earphones.
- **Inventory**: `LocalInventoryAdapter` supports one-unit stock leases with expiry, reserve, commit, release, out-of-stock handling, and idempotent operation references. Reservation happens before any wallet debit.
- **Wallet**: `LocalWalletTransferAdapter` operates on the seeded wallet and writes an atomic double-entry ledger. A transfer has a wallet debit and merchant credit leg, a stable operation reference, replay lookup, insufficient-funds handling, decline handling, unknown-result handling, and compensation support. The wallet balance is the spendable source. It is not inferred from chain evidence.
- **Merchant credit**: `LocalMerchantCreditAdapter` confirms that the ledger credit reached the selected merchant before order creation.
- **Order**: `LocalOrderAdapter` creates an idempotent order only after confirmed payment and committed inventory.
- **Fulfillment and delivery**: `LocalFulfillmentAdapter` and `LocalDeliveryAdapter` write independent statuses. A delivery failure leaves the confirmed payment, merchant credit, order, and receipt confirmed.

All adapter responses are normalized server-side. The browser receives status, references, and safe evidence only, never raw provider payloads or credentials.

## API boundary

- `POST /api/purchases/run` with `{ "request": "I want a mouse" }` runs the complete bounded lifecycle. Send an `Idempotency-Key` header.
- `POST /api/tasks/:id/run` resumes a run waiting for an explicit candidate selection.
- `POST /api/tasks/:id/payment/reconcile` with `{ "resolution": "authorized" }` or `{ "resolution": "declined" }` resolves an unknown wallet result without retrying the transfer.
- `GET /api/tasks`, `GET /api/tasks/:id`, `GET /api/tasks/:id/receipt`, and `GET /api/tasks/:id/audit` expose persisted safe views.
- `GET /api/wallet` exposes the seeded fake balance and ledger evidence. `GET /api/catalog` exposes safe catalog and stock facts.
- `POST /api/reset` clears local purchase history and restores the seeded wallet and inventory.

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

The local adapters are intentionally narrow replacement points. A future approved organizer integration can implement the canonical methods in `src/sandbox.js` for discovery, funding lookup, inventory reservation, wallet transfer, merchant credit, order, fulfillment, or delivery. Normalize provider status, timeout, and reference data inside that adapter, keep credentials in the provider process, and preserve the server-owned operation IDs, exact quote, inventory-before-payment invariant, idempotency, compensation, and redacted browser contract. The local fixtures remain the default until an approved provider contract and credentials exist.

## Deliberate boundary

This is one local operator and one modular Node application. It is not a generalized marketplace, social login system, production wallet, custody service, KYC system, real-money payment integration, live inventory feed, or multi-merchant consumer product.
