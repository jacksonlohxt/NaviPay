# NaviPay architecture

This document is for organizers, reviewers, and developers. It describes the current local implementation and its safety boundaries. It is not customer-facing product copy.

## Scope and authority

NaviPay is one Node.js process with a durable JSON store. The server is the authority for request interpretation, catalog choice, price, inventory, funding eligibility, payment state, order state, fulfillment, delivery, receipt, and redacted browser projections. The browser submits a plain-language instruction and renders server-owned facts. It never chooses a price, creates a payment credential, or writes lifecycle state.

The default commerce authority is the seeded local catalog and the local merchant gateway in `src/sandbox.js`. Optional Playwright discovery is read-only evidence. It is server-allowlisted, bounded, and cross-checked against the seeded catalog before it can influence a purchase. It cannot reserve stock, authorize payment, place an order, or deliver anything.

The service retains the legacy task shape for compatibility and exposes a versioned safe projection for browser reads. Projection builders redact sensitive fields before data reaches `public/app.js`. The browser-facing projection includes a versioned `customerOutcome` read model and bounded `nextActions`; these are the only source for default customer outcome copy and supported next steps. It also includes only a compact agent mode disclosure and four-stage customer status. Model proposals, observations, tool facts, and policy evidence stay in the separate read-only reviewer projection.

P0 agent runs use `src/agent-contract.js`, `src/model-gateway.js`, and `src/agentic.js`. The default gateway is the offline `recorded_replay` gateway backed by the signed and versioned `fixtures/agent-replay-v1.json` bundle. `deterministic_fallback` is a network-free provider-neutral fallback. Both produce advisory typed proposals; neither can invoke an adapter or authorize a side effect. The server policy engine and existing local adapters remain authoritative.

## End-to-end request flow

The normal `POST /api/purchases/run` path is synchronous in the local demo, but each boundary persists an operation and audit event so the resulting task can be reloaded.

1. **Request.** The browser sends `request`, an optional read-only `targetSite`, and an idempotency key. `NaviPaySandboxService.startPurchase` fingerprints the request, creates a task, and protects replay with persisted idempotency records.
2. **Discovery.** `LocalDiscoveryAdapter` normalizes the supported product intent and ranks seeded merchant candidates by category, brand, and keyword match. Browser candidates, when enabled, are recommendations only. No side effect occurs here.
3. **Quote.** The service selects a clear eligible candidate or persists `awaiting_selection`, `no_match`, `out_of_stock`, or `over_budget`. It locks the authoritative item, merchant, variant, quantity, shipping, tax, currency, total, expiry, quote ID, cart ID, and snapshot hash. The browser never supplies a total.
4. **Inventory.** `LocalInventoryAdapter` reserves one unit before payment and creates a lease. It commits, releases, or expires that reservation idempotently. An exact out-of-stock request is not substituted with another brand.
5. **Funding and KYC boundary.** The local funding adapter reads the seeded fake wallet balance. The separate local KYC provider stores only an allowlisted status and safe reference. The default demo may bootstrap the mock gate for a concrete purchase, while explicit pending and rejected fixtures stop safely. This is not identity verification, sanctions screening, custody, or a live funding decision.
6. **Scoped card.** `LocalFakeIssuerAdapter` creates a one-use card metadata record scoped to the selected merchant, domain, exact amount ceiling, XSGD currency, category code, expiry, and one successful capture. The credential is a process-local capability and is never persisted in the task, audit, projection, or logs.
7. **Checkout.** `LocalCheckoutWorker` creates a fresh bounded local profile. `LocalMerchantCheckoutAdapter` submits the locked item, cart, delivery fixture, and isolated card capability to the local merchant gateway. This is a deterministic fixture, not a live merchant site or external checkout.
8. **Authorization.** The issuer validates the exact merchant, amount, currency, category, expiry, and one-use state. A decline is terminal. An unknown result becomes a durable reconciliation state and is never retried blindly.
9. **Ledger.** A successful capture debits the fake wallet and credits the selected merchant with one balanced pair of local ledger legs. The transfer has a stable reference and idempotency record. Merchant credit confirms the existing transfer; it is not a second debit.
10. **Order.** `LocalOrderAdapter` creates an idempotent order from confirmed payment, the locked quote, and the committed reservation. Inventory commit or order confirmation failures compensate a confirmed payment and release stock rather than leaving an unconfirmed order.
11. **Fulfillment.** `LocalFulfillmentAdapter` independently marks the order ready or records a fulfillment failure. A fulfillment failure does not change a confirmed payment.
12. **Delivery.** `LocalDeliveryAdapter` independently records delivered or failed delivery, a simulated carrier, a tracking reference, and the fixture address label. Delivery failure does not rewrite payment or order history.
13. **Receipt.** The service persists an immutable capture snapshot plus the current refund or reversal adjustment. The receipt is served through `GET /api/tasks/:id/receipt` and is the primary customer success artifact.

The reviewer groups these internal boundaries into four auditable stages: **Funding** records local mock funding evidence before discovery without claiming live credit; **Discovery** records bounded candidate and quote evidence; **Issuance** records server-approved one-use instrument scope; and **Execution** records the local simulated checkout, ledger, order, fulfillment, delivery, and receipt. Execution is explicitly not real browser checkout.

The visible customer path puts the outcome and receipt first, followed by item, merchant, total, order, preparation, delivery, and a server-authorized next action. It intentionally compresses implementation boundaries into Find item, Payment, and Order. Detailed evidence remains behind collapsed customer-question groups and the separate payment drawer; the default customer DOM does not render operator funding controls or raw implementation terminology.

## Data model and projections

`src/store.js` owns version 2 JSON state and migrates version 1 state. It persists tasks, progress, idempotency records, operations, audits, wallets, ledger legs, merchant credits, inventory leases, issuer metadata, checkout sessions, orders, fulfillment, delivery, receipts, and payment adjustments. Writes use restricted files, a temporary file, fsync, and atomic rename.

A task contains the original request and normalized intent, authorization envelope and decision, scenario, quote and locked snapshot, inventory reservation, funding observation, card metadata, checkout and payment outcome, financial snapshot, order, fulfillment, delivery, receipt, progress, automation status, failure, and an opaque `agentRunId`. The safe agent run is persisted separately from the legacy task. It contains only bounded personal context, typed proposal, safe observations, the authoritative policy decision, four stages, budgets, and a checkpoint. No raw prompt, page content, provider payload, or credential is persisted in the agent contract.

The browser projection is built in `projectTask` and related safe projection helpers in `src/sandbox.js`. It includes:

- interpreted request and safe candidate evidence;
- locked quote, line and total facts, expiry, budget status, and snapshot identifiers;
- reservation status;
- task-owned financial values: before payment, after payment, final balance, net charged, net refunded, and compensation status;
- safe payment and card lifecycle status;
- order, fulfillment, delivery, tracking, receipt, safe operation references, and timeline;
- `customerOutcome` version 1 with a plain-language status, title, message, and compact payment/order/preparation/delivery/receipt side-effects summary;
- bounded `nextActions` entries with versioned stable IDs, customer labels, enabled state, and policy reasons. Supported IDs are `new_purchase`, `choose_item`, `reconcile_payment`, `view_receipt`, and `view_details`;
- only redacted customer and provider-adjacent facts.

A task financial snapshot is authoritative for that task. The current global wallet is not a fallback for a failed or pre-payment task. A global wallet read is separate evidence. Initial fulfillment and delivery are `not_started`; they become pending only when their boundary begins.

`GET /api/tasks/:id/reviewer`, `GET /api/runs/:runId/reviewer`, and `GET /api/tasks/:id/events` are read-only reviewer contracts. The reviewer shows mode and provenance, safe context summary, typed proposal, policy decision, safe tool facts, evidence references and hashes, budgets, retries, checkpoint, stage transitions, and final outcome. It does not include raw payloads or operator controls. `agentEvents` are normalized append-only envelopes with sequence and hash identities; `agentCheckpoints` support restart inspection. `rebuildAgentProjections` rebuilds the customer and reviewer read models from those agent events plus authoritative task facts.

## Failure, recovery, reconciliation, and refund semantics

Every boundary returns a normalized status and records an operation. Side effects are protected by idempotency keys and stable references.

- **No match, invalid request, over limit, stale price, out of stock, policy block, pending or rejected local gate, and insufficient balance:** stop before an unconfirmed payment. No card capture, ledger debit, confirmed order, or receipt is created. Reservations are released where one existed.
- **Declined payment:** the card is retired or stopped as appropriate, the reservation is released, and no ledger legs are created.
- **Unknown payment:** persist `reconciliation_required`, keep the reservation while the result is unresolved, and show explicit approved or declined actions. `POST /api/tasks/:id/payment/reconcile` resolves the existing outcome without retrying checkout or creating a second transfer.
- **Merchant credit, order, or inventory commit failure:** compensate a confirmed fake-wallet transfer when necessary, release stock, and preserve a truthful failure or compensated state. A confirmed payment is not silently forgotten.
- **Fulfillment or delivery failure:** retain confirmed payment and order facts, show the independent problem, and keep the receipt available.
- **Refund and reversal:** `POST /api/tasks/:id/payment/refund` and `/payment/reverse` are idempotent local post-capture actions. The immutable capture snapshot stays unchanged. A current adjustment records payment status, net charged, net refunded, compensation result, and safe references. Order, fulfillment, and delivery history are not rewritten.
- **Reload and restart:** persisted tasks and projections reload from the JSON store. Unknown payment remains a stop state. Credentials do not survive as browser data or persisted secrets; any pre-capture recovery must re-establish a safe isolated capability or stop rather than reuse an unverified credential.

## Security and redaction rules

No live funds, custody, KYC, customer identity, PAN, CVV, provider secret, merchant credential, raw webhook, raw provider payload, or live delivery exists in this repository. Customer and delivery address data are replaceable fixtures. The recorded replay bundle is an offline integrity-checked fixture, not a live model response. Funding evidence uses local mock labels only, and checkout remains the existing local simulation. Hosted models, live XSGD, real card issuance, and real browser checkout remain future work.

The issuer credential is held only by the isolated checkout capability. Task records, projections, audit events, logs, fixtures, and browser code receive card status, masked reference, and safe lifecycle references only. Source URLs are emitted only after server-side allowlist validation. Target URLs with usernames or passwords are rejected. Browser discovery uses bounded reads and no credentials.

Provider IDs and references may appear as safe, short references in technical evidence. They do not prove a live provider interaction. The funding and KYC routes require explicit local simulation authorization or the configured server-side secret. Future provider payloads must be normalized and redacted at the adapter boundary.

## Extension points

Replaceable contracts live in `src/sandbox.js`, `src/issuer.js`, `src/checkout-worker.js`, `src/funding.js`, and `src/kyc.js`:

- discovery/search can be replaced by an approved read-only catalog or merchant adapter;
- quote and inventory can map to a provider cart, pricing, and reservation API;
- funding and KYC can map to separately approved provider contracts;
- the local issuer and checkout worker can map to a provider-controlled single-use card and merchant checkout boundary;
- ledger and merchant credit can map to an approved settlement or wallet system;
- order, fulfillment, and delivery can map to merchant and carrier APIs;
- `JsonStore` can later map to a transactional database.

A replacement must return normalized facts, preserve server-owned quote and scope, reserve inventory before capture, enforce exact amount/currency/merchant/category limits, keep credentials provider-controlled, support idempotency, and define unknown/reconciliation/refund behavior. Provider claims must not be inferred from this local demo. In particular, NaviPay has no live XSGD provider, live card issuer, live merchant checkout, live ledger, or live delivery integration.

## Run and test the local demo

From the repository root:

```sh
npm install
npm start
```

Open <http://127.0.0.1:3000>, enter `buy a Logitech mouse`, and press **Run purchase**. Use the **Payment** summary for task-scoped payment facts. Use the collapsed purchase details only when reviewing selection, payment, order, or activity evidence. `POST /api/reset` or a separate `NAVIPAY_DATA_FILE` restores an isolated seeded wallet and inventory fixture.

Validation commands:

```sh
npm test
npm run check
npm run test:ui
```

The API scenario fixtures in `README.md` cover no match, ambiguity, over limit, out of stock, insufficient balance, declined and unknown payment, refund, reversal, fulfillment failure, delivery failure, and recovery. The default customer UI does not expose scenario controls or raw implementation jargon.
