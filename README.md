# NaviPay

NaviPay is a local-only commerce sandbox with a truthful agentic contract. A user enters one purchase instruction such as `Find an Apple Magic Keyboard` and presses **Run purchase**. The default judgeable agent mode is a checked-in **recorded replay** containing model-shaped proposals with explicit offline provenance. The server policy engine and deterministic local adapters remain authoritative. **Deterministic fallback** is available with `agentMode: "deterministic_fallback"` and makes no model call. The frontend keeps the primary path to one instruction, a calm customer status view, a receipt, and a compact mode disclosure. The read-only reviewer route exposes Funding, Discovery, Issuance, and Execution evidence separately from the customer surface.

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
npm run test:ui
```

For the organizer, reviewer, and developer view of the lifecycle, authority boundaries, projection model, failure semantics, and extension points, see [docs/architecture.md](docs/architecture.md).

The public repository contains the application source, tests, and deterministic local HTML fixtures. Runtime state is deliberately excluded: `.data/` is ignored and contains only local wallet, inventory, and task state. Use `NAVIPAY_DATA_FILE` for an isolated local state file, and inject any future provider secret through server-side deployment configuration rather than committing it.

## Product walkthrough

1. Enter a purchase instruction such as `I want a keyboard` and press **Run purchase** once. NaviPay starts with the seeded local catalog and local merchant gateway. Example requests are semantic buttons, and optional browser discovery is available in a clearly labelled collapsed section with no checkout authority.
2. NaviPay applies bounded budget parsing and hard brand/category constraints, then ranks valid in-stock candidates with a deterministic policy. A clear winner within the XSGD 1,000 task ceiling is selected automatically. An exact out-of-stock brand is never silently replaced by another brand.
3. NaviPay cross-checks browser identity and quote amounts against the authoritative seeded local catalog, then automatically reserves inventory, verifies the fake wallet, transfers fake funds, confirms merchant credit, creates the order, fulfills it, delivers it, issues the receipt, and records the audit trail. The reviewer projection groups those internal steps into Funding, Discovery, Issuance, and Execution. The Funding evidence is explicitly local mock evidence, and Execution explicitly identifies the checkout as a local simulation rather than real browser checkout.
4. See the receipt first, with the item, merchant, exact price breakdown, payment state, order, preparation, delivery, safe references, issue time, and one concise local-demo disclosure. The header Payment summary contains only safe task payment facts and the task-scoped balance. A task with no financial snapshot shows no invented balance and never falls back to the current global wallet.
5. NaviPay pauses only for a genuine tie or ambiguity, malformed/stale/blocked discovery, no available or over-cap item, insufficient fake funds, an unknown payment result, or another safety exception. The server-owned outcome states what happened, what did not happen, and the bounded next action. **More about this purchase** keeps selection, payment, order, delivery, and activity evidence collapsed until opened. Failure states never render a success-looking receipt.

The customer and address are deliberately labeled simulated and are stored as replaceable fixtures in `src/sandbox.js`. The fake wallet is named **NaviPay Demo Wallet**, owned by **Demo Customer**, and starts with a seeded XSGD balance of XSGD 500.00. Issuer authorization and capture are the only default purchase debit path. The fake issuer is funded by that wallet, and the direct wallet transfer path exists only for explicit legacy test mode.

## Competition issuance and checkout demonstration

This is the exact local-only demonstration for the approved issuance and execution milestones. Every card, gateway, merchant response, webhook, order, and delivery result below is simulated. No PAN, CVV, merchant credential, or real payment network is used. Airwallex is reserved for a future Singapore/SGD pilot and StraitsX for future exact-XSGD diligence; neither is a current dependency.

1. Start NaviPay with `npm start`, open <http://127.0.0.1:3000>, and leave the target site blank so the seeded merchant catalog is the authoritative local source.
2. Enter `Find an Apple Magic Keyboard` and press **Run purchase**. NaviPay reserves one unit before payment, verifies the seeded fake wallet, issues a disposable one-use card scoped to Orchard Electronics, XSGD 171.72, and MCC 5732, and starts a fresh bounded checkout worker profile.
3. Observe the three stages, then open **Virtual card** for the safe masked reference, checkout submission, issuer authorization and capture references, and **Card retired** status. The confirmed order, delivery, and final receipt are shown on the primary path. The card credential is injected only inside the isolated checkout capability and never appears in the task, projection, audit, worker record, log, or browser UI.
4. Repeat the same flow through the API to inspect the safe contract:

   ```sh
   curl -sS -X POST http://127.0.0.1:3000/api/purchases/run \
     -H 'content-type: application/json' -H 'Idempotency-Key: competition-success' \
     -d '{"request":"Find an Apple Magic Keyboard"}'
   ```

   The response contains only card status and masked reference, issuer authorization and capture references, order, delivery, receipt, redacted evidence, and the persisted lifecycle. It contains no card credential or raw merchant payload.
5. Use API scenario fixtures to replay safe execution outcomes: `decline`, `unknown`, `timeout`, `wrong-merchant`, `amount-overage`, `expired-card`, `browser-crash`, and `duplicate`. For `unknown` or `timeout`, call `POST /api/tasks/:id/payment/reconcile` with `{"resolution":"authorized"}` or `{"resolution":"declined"}`. NaviPay never retries an unknown capture. For a confirmed task, `POST /api/tasks/:id/payment/refund` and `/payment/reverse` exercise the simulated refund and reversal webhook fixtures.
6. Open <http://127.0.0.1:3000/merchant-checkout/> to inspect the purpose-built local merchant checkout page. Its product, cart, delivery, and card fields are a fixture only. Discovery remains read-only and cannot invoke this checkout worker or gateway.

The local checkout worker records only a fresh profile identifier, approved local origin, bounded action metadata, and cleanup status in persisted state. The issuer lifecycle persists issue, status, authorize, capture, reconcile, retire, revoke, expiry, scope, stable operation IDs, and idempotency records while keeping the disposable credential in an isolated in-memory capability.

## Local fake environments

- **Merchant catalog**: `CATALOG` in `src/sandbox.js` contains merchant IDs, local merchant domains, SKUs, variant IDs, prices, tax and shipping, quantities, and product categories for keyboards, mice, and earphones. It remains the reliable default and test oracle.
- **Inventory**: `LocalInventoryAdapter` supports one-unit stock leases with expiry, reserve, commit, release, out-of-stock handling, and idempotent operation references. Reservation happens before any wallet debit.
- **Wallet**: `LocalWalletTransferAdapter` operates on the seeded wallet and writes an atomic double-entry ledger. A transfer has a wallet debit and merchant credit leg, a stable operation reference, replay lookup, insufficient-funds handling, decline handling, unknown-result handling, and compensation support. The wallet balance is the spendable source. It is not inferred from chain evidence.
- **Issuer and checkout**: `src/issuer.js` persists the fake issuer card lifecycle and `src/checkout-worker.js` creates a fresh bounded profile per task. `LocalMerchantCheckoutAdapter` submits product, cart, delivery, and isolated card data to the local gateway, which authorizes and captures through the issuer. The issuer capture performs the single fake-wallet debit.
- **Merchant credit**: `LocalMerchantCreditAdapter` confirms that the ledger credit reached the selected merchant before order creation. It is bookkeeping after issuer capture, not a second debit.
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
4. Press **Run purchase**.
5. Observe the **Local browser fixture** badge, the automatically selected Apple Magic Keyboard, why it won, source URL, observed time, and the three-stage tracker. No selection click is needed for a unique winner; evidence remains in collapsed Advanced details.
6. Repeat with `I want a mouse` and `I want earphones` to exercise automatic mouse and earphone paths. A replay containing tied candidates pauses in **Advanced details**; a no-match or unsafe browser result is labelled and handled through the seeded fallback. Stop both local processes with Ctrl-C.

The script serves `fixtures/competition-site/index.html` on port 43123 and starts NaviPay with Playwright discovery enabled, explicitly allowlisted to `127.0.0.1`. The target-site field never grants permission: a user URL is accepted only when its http or https scheme and host are already on that server-side allowlist. The worker sends no credentials and performs only bounded GET or HEAD reads. It never clicks search, checkout, order, or payment controls. The fixture's search form and product cards mirror the competition interaction while its normalized candidate payload is the deterministic replay seam.

If the optional `playwright` package or its browser is unavailable, the same steps show **Seeded catalog fallback** and explain that browser discovery was unavailable. The default `npm start` path shows **Seeded catalog** and never attempts browser discovery. Browser evidence is read-only and never has payment or checkout authority. NaviPay proceeds automatically only after a unique in-stock winner is ranked and the server matches its identity and quote amounts to the approved local quote. Discovery itself never reserves inventory, authorizes payment, creates an order, or invokes checkout. Approved merchant adapters remain mandatory for the authoritative quote, inventory, order, fulfillment, and payment boundaries.

The adapter runs in a separate worker process, permits only GET and HEAD requests, and enforces page, tab, redirect, response-size, candidate, and deadline limits. It sends no credentials, uses no proxy, performs no arbitrary page evaluation, and has no checkout, order, inventory, or payment capability. If navigation is blocked, data is malformed or stale, a limit is exceeded, or the worker fails, NaviPay returns an unavailable discovery status with a safe reason code and uses the explicitly labelled seeded catalog fallback. Playwright is an optional local development tool and is not required for the default product or CI.

## API boundary

Every sandbox task response includes the legacy `task` object for deliberate compatibility and a versioned server-owned `projection` read model. The customer projection contains only interpreted request data, recommendation rationale and catalog evidence, the locked quote and expiry, inventory reservation, financial snapshots, payment, merchant credit, order, fulfillment, delivery, receipt, safe operations, a redacted timeline, versioned `customerOutcome`, bounded `nextActions`, and a compact recorded-replay or deterministic-fallback disclosure. It never includes model proposals, raw reasoning, tool payloads, provider payloads, credentials, or full customer address details. `GET /api/tasks/:id/projection` retrieves the same projection after a reload; list responses include `projections`.

The read-only reviewer contract is available at `GET /api/tasks/:id/reviewer` (with `GET /api/runs/:runId/reviewer` as an equivalent run lookup). It contains the four auditable stages, mode badge, signed replay-bundle or fallback provenance, a bounded safe context summary, typed model proposal, authoritative server policy decision, safe tool facts, evidence references and hashes, budgets, retries, checkpoints, event summaries, and final outcome. It never exposes the raw prompt, page text, provider payload, credential, or operator mutation control. `GET /api/tasks/:id/events` returns normalized append-only event identities without event payloads.

Financial projections explicitly persist `balanceBeforeMinor`, `balanceAfterPaymentMinor`, `finalBalanceMinor`, `netChargedMinor`, `netRefundedMinor`, compensation status and references, and a financial `outcome`. These are task-scoped snapshots and never fall back to the current global wallet balance. Locked quotes also persist quote and cart IDs, a line snapshot, quote expiry/status, budget status, and a stable snapshot hash; inventory reservations and order confirmation validate that snapshot.

### Capture receipt and later settlement

The refund regression was reproduced through the browser contract: a successful mouse purchase followed by `POST /api/tasks/:id/payment/refund` returned a current task payment of `refunded` and financial `netChargedMinor: 0`, while `GET /api/tasks/:id/receipt` still reported `paymentStatus: authorized`, `finalBalanceMinor: 37850`, and `netChargedMinor: 12150`. Those values described the original capture, but the receipt did not label them as an immutable snapshot, so the read models appeared to conflict.

The receipt now keeps those original capture values unchanged and labels them with `captureSnapshot`. A safe `adjustment` records the current refund or reversal status, current payment status, requested and recorded timestamps, amount, net charged and net refunded amounts, safe adjustment and ledger references, and the compensation outcome. A failed compensation records zero refunded and leaves the current payment as the original authorized capture with `netChargedMinor` unchanged. `GET /api/tasks/:id/receipt`, the task projection, and the frontend use the same redacted receipt projection. Audit events expose the adjustment reference, ledger transaction reference, status, and timestamp without provider payloads. Order, fulfillment, and delivery remain confirmed or independently failed; a payment adjustment does not rewrite commerce history.

- `POST /api/purchases/run` with `{ "request": "I want a mouse" }` runs the complete bounded lifecycle. Send an `Idempotency-Key` header.
- `POST /api/tasks/:id/run` resumes a run waiting for an explicit candidate selection after a genuine ambiguity or tie.
- `POST /api/tasks/:id/payment/reconcile` with `{ "resolution": "authorized" }` or `{ "resolution": "declined" }` resolves an unknown issuer capture without retrying checkout or the transfer.
- `GET /api/tasks`, `GET /api/tasks/:id`, `GET /api/tasks/:id/receipt`, `GET /api/tasks/:id/audit`, and `GET /api/tasks/:id/card` expose persisted safe views.
- `GET /api/cards/:cardId`, `GET /api/checkout/sessions/:sessionId`, and `GET /api/checkout/webhooks` expose only safe issuer and local gateway status fixtures. `POST /api/tasks/:id/payment/refund` and `/payment/reverse` are idempotent simulated post-capture actions.
- `GET /api/wallet` exposes the seeded fake balance and ledger evidence. `GET /api/catalog` exposes safe catalog and stock facts.
- `POST /api/reset` clears local purchase history and restores the seeded wallet and inventory.

`GET /api/discovery` and the `discovery` field in task-list and purchase-run responses expose the server-owned, read-only discovery configuration projection. It reports whether the seeded catalog or local browser fixture is active, whether fallback is available, and the safe explanation shown by the UI. It never returns configured URLs, allowlists, worker details, credentials, or provider payloads. The selected candidate projection exposes only the validated source URL, observed timestamp, and match rationale for Advanced details.

`POST /api/purchases/run` accepts `{ "request": "Find an Apple Magic Keyboard", "targetSite": "http://127.0.0.1:43123/competition-site/" }`. An absent target uses the configured challenge site when one is enabled. A malformed target is rejected; a syntactically valid but unapproved target is never fetched and produces an understandable unavailable/fallback result. The server-side allowlist is configured with `NAVIPAY_DISCOVERY_ALLOWLIST`; configured challenge URLs use `NAVIPAY_DISCOVERY_URLS` or `NAVIPAY_CHALLENGE_SITE_URL`.

The server entrypoint is `src/server.js`. The product orchestration and adapter contracts are in `src/sandbox.js`. The JSON store is in `src/store.js`.

## Bounded one-instruction authorization policy

The primary purchase endpoint treats the instruction as a local authorization request, not as unrestricted shopping permission. NaviPay preserves the original text and a normalized envelope containing the brand, product, category, quantity, explicit budget or default XSGD 1,000 ceiling, currency, approved seeded merchant scope, and one-purchase purpose. Hard brand, product, and category constraints are never substituted.

A purchase can receive an `AUTHORIZATION_APPROVED` decision only when the request is valid, one unique in-stock candidate is selected, the authoritative quote is fresh and internally consistent, the exact XSGD total is within budget, inventory is reserved, the local mock KYC gate is approved, the simulated wallet covers the total, the merchant and category are allowlisted, and no local risk or policy block is active. A tie, missing product type, exact out-of-stock result, stale quote, over-budget total, KYC or funding gate, duplicate, or policy violation receives a persisted redacted pause or rejection decision. Card issuance, capture, ledger debit, and order creation are downstream of that decision.

The default local demo may bootstrap the pending mock KYC fixture through a deterministic simulated approval when a concrete one-instruction run starts, so the visible demo remains automatic. This is not identity verification and cannot authorize real funds. The explicit `pending-kyc` and `rejected-kyc` fixtures exercise the hard stop without issuing a card. The authorization decision and envelope are safe browser projections and contain no PAN, CVV, provider payload, or secret.

This policy is a local-only simulation. The seeded merchant, fake wallet, mock KYC, local funding, issuer, checkout worker, order, fulfillment, and delivery adapters are replaceable seams for future provider adapters. No real provider credentials, KYC claims, funds, external checkout, Amazon scraping, or live StraitsX calls are enabled.

## Recovery scenarios

The server supports deterministic local scenarios for integration testing: `no-match`, `over-budget`, `ambiguity`, `ambiguous-same-brand`, `missing-product-type`, `pending-kyc`, `rejected-kyc`, `insufficient-funding`, `merchant-category-violation`, `policy-block`, `risk-block`, `duplicate-instruction`, `stale-quote`, `low-balance`, `insufficient-funds`, `payment-decline`, `decline`, `unknown-payment`, `unknown`, `timeout`, `wrong-merchant`, `amount-overage`, `expired-card`, `duplicate`, `browser-crash`, `card-issued-before-checkout`, `order-failure`, `order-commit-failure`, `merchant-credit-failure`, `out-of-stock`, `fulfillment-failure`, `delivery-failure`, `funding-failure`, and `discovery-failure`. They are API fixtures, not user-facing product controls.

- No-match, over-budget, ambiguity, exact out-of-stock, low-balance, and payment decline outcomes stop before an unconfirmed payment and show explicit task-scoped results.
- Insufficient funds and payment decline release the reservation and create no ledger entries.
- Unknown payment holds the reservation and blocks retries. Reconciliation either applies the one idempotent transfer or releases the reservation.
- Merchant-credit, order, and inventory-commit failures compensate an already confirmed wallet transfer and release stock without leaving a confirmed order. Compensation is itself a double-entry operation.
- Checkpoint fixtures use persisted task snapshots and do not change the default seed for other runs.
- Delivery and fulfillment failures do not rewrite a confirmed payment or order as failed. Their independent statuses remain visible on the receipt and task.
- Repeating an idempotency key replays the persisted response. Repeating an adapter operation uses its persisted operation, reservation, transfer, order, or delivery reference and does not duplicate side effects.

## Persistence and compatibility

`src/store.js` uses version 2 state with an explicit migration from the previous version 1 task/audit store. It persists tasks, progress, operations, wallet transfers, ledger legs, reservations, orders, delivery records, issuer metadata, checkout sessions, refunds, funding and KYC state, agent runs, normalized append-only agent events, checkpoints, and idempotency responses. JSON writes use a restricted directory, a restricted temporary file, fsync, and atomic rename. A task can therefore be inspected and safely resumed after a process restart. This remains a single-process local JSON store and does not claim production concurrency.

## XSGD funding and local KYC gate

Funding is a separate provider-neutral seam in `src/funding.js`. The contract is intentionally small: `createFundingIntent`, `getFundingStatus`, `receiveProviderEvent`, and `reconcileReference`. The canonical normalized record contains only `status` (`pending`, `confirmed`, `failed`, `expired`, or `reversed`), provider reference, network, asset, amount in minor units, safe confirmation evidence, expiry, and safe credit references. `LocalMockXsgdFundingProvider` is the default and uses deterministic `mock://` deposit instructions. It makes no network call, creates no blockchain transaction, and never represents a live XSGD provider.

Funding is gated by the provider-neutral KYC seam in `src/kyc.js`. `KycProviderContract` normalizes `getStatus`, `receiveDecision`, and `reconcileReference` to `approved`, `pending`, or `rejected`. `LocalMockKycProvider` is an explicit local decision simulator only. It stores status, decision references, timestamps, and an allowlisted reason code, never identity documents or raw provider payloads. An approved KYC status is required both when creating an intent and immediately before crediting the authoritative fake wallet.

The local demonstration is:

```sh
# inspect the pending local KYC gate and wallet
curl -sS http://127.0.0.1:3000/api/funding

# approve the local-only gate - this is not identity verification
curl -sS -X POST http://127.0.0.1:3000/api/funding/kyc/simulate \\
  -H 'content-type: application/json' -H 'Idempotency-Key: demo-kyc-approve' \\
  -H 'X-NaviPay-Local-Simulation: true' -d '{"action":"approve"}'

# create deterministic mock deposit instructions
curl -sS -X POST http://127.0.0.1:3000/api/funding/intents \\
  -H 'content-type: application/json' -H 'Idempotency-Key: demo-funding-create' \\
  -d '{"amount":"25.00"}'

# use the returned intent ID to exercise confirm, fail, expire, or reverse
curl -sS -X POST http://127.0.0.1:3000/api/funding/intents/FUNDING_ID/simulate \\
  -H 'content-type: application/json' -H 'Idempotency-Key: demo-funding-confirm' \\
  -H 'X-NaviPay-Local-Simulation: true' -d '{"action":"confirm"}'
```

`GET /api/funding` and `GET /api/funding/intents/:id` expose the safe funding projection, including current available fake balance, XSGD, the simulated Avalanche Fuji network, deposit instructions, status, provider reference, confirmation reference, KYC status, and the local-only disclosure. The simulation routes require the exact `X-NaviPay-Local-Simulation: true` header. Provider webhook routes (`/api/funding/webhooks` and `/api/funding/kyc/webhooks`) require the matching provider ID (`local-mock-xsgd-avalanche` for funding or `local-mock-kyc` for KYC), that header for the local provider, or a server-side `NAVIPAY_FUNDING_WEBHOOK_SECRET` or `NAVIPAY_KYC_WEBHOOK_SECRET`; no default secret is shipped. Reference reconciliation is available at `POST /api/funding/reconcile` and `/api/funding/kyc/reconcile`, or the corresponding `/references/:providerReference/reconcile` routes. These routes use stable reference-derived idempotency fallbacks and return normalized safe status only. Duplicate event IDs and idempotency keys are persisted, and confirmed funding adds exactly one pair of `funding` ledger legs. A reversal adds exactly one pair of `funding_reversal` legs. Failure and expiry add no credit.

A future StraitsX and Avalanche implementation must not be inferred from this mock. Before enabling one, obtain official provider documentation and credentials for the exact following fields: intent creation endpoint and authentication scheme; supported XSGD asset identifier and decimal precision; Avalanche network and chain ID; destination or custody model and whether a memo/tag is required; exact amount and fee semantics; provider reference format; status and terminal-state mapping; confirmation-count or finality policy; webhook endpoint, signature algorithm, timestamp/replay rules, event IDs, and delivery retry semantics; reference reconciliation endpoint; expiry, failure, reversal, settlement, limits, KYC/AML, and refund behavior. The KYC adapter additionally requires the official verification decision states, decision/reference schema, document handling and retention rules, webhook signature, manual-review transitions, sanctions/AML prerequisites, and approved account or customer identifier semantics. NaviPay currently has no live endpoint, custody, KYC, settlement, or provider authentication implementation. Future credentials must be injected server-side through environment or deployment configuration such as `NAVIPAY_FUNDING_WEBHOOK_SECRET`; never put keys in task state, browser code, fixtures, or tests.

## Future organizer adapters

The local adapters are intentionally narrow replacement points. A future approved organizer integration can implement the canonical methods in `src/sandbox.js` for discovery, funding lookup, inventory reservation, wallet transfer, merchant credit, order, fulfillment, or delivery. Normalize provider status, timeout, and reference data inside that adapter, keep credentials in the provider process, and preserve the server-owned operation IDs, exact quote, inventory-before-payment invariant, idempotency, compensation, and redacted browser contract. The local fixtures remain the default until an approved provider contract and credentials exist. Adapters must return normalized facts to the service; projection builders are the only boundary used by browser read APIs.

StraitsX and Amazon are future boundaries, not current integrations. StraitsX would require the official XSGD funding, custody, webhook, settlement, and KYC contracts described above. Amazon is not scraped or accessed; any future Amazon support would require an approved official API or partner contract, terms-compliant catalog and order capabilities, and a separate adapter. No live provider endpoint, Amazon credential, or external checkout is included here.

## Agent mode and future boundaries

The checked-in `fixtures/agent-replay-v1.json` is a versioned, SHA-256 integrity-checked response bundle used by the default recorded replay gateway. It contains model-shaped typed proposals only. `src/model-gateway.js` defines the provider-neutral seam; hosted and local model adapters are extension points and are not enabled in P0. The deterministic fallback gateway is credential-free and network-free.

Funding evidence in an agent run is a local mock event. It does not prove an Avalanche transaction or real XSGD. Issuance uses the existing local fake issuer, and Execution uses the existing local checkout simulation. Real browser checkout, hosted model calls, live XSGD, real cards, custody, provider credentials, and external merchant automation remain P1/P2 work.

## Deliberate boundary

This is one local operator and one modular Node application. It is not a generalized marketplace, social login system, production wallet, custody service, KYC system, real-money payment integration, live inventory feed, or multi-merchant consumer product.
