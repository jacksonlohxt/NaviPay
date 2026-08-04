# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

## NaviPay local sandbox

- Run the single-host product with `npm start`; the server entrypoint and API routes are authoritative in `src/server.js`.
- Run `npm test` for lifecycle, ledger, inventory, recovery, persistence, and HTTP coverage, and `npm run check` for syntax validation.
- The product orchestration, seeded merchant catalog, fake wallet ledger, inventory leases, order, fulfillment, delivery, receipt, audit, and replaceable adapter contracts live in `src/sandbox.js`. The earlier control-plane contract remains in `src/domain.js` for compatibility tests.
- The primary browser contract is `POST /api/purchases/run`; `POST /api/tasks/:id/run` resumes a persisted run that needs candidate selection, and `POST /api/tasks/:id/payment/reconcile` resolves an unknown fake-wallet result without retrying it. Receipts are persisted on the task and exposed at `/api/tasks/:id/receipt`.
- `src/store.js` migrates version 1 local JSON state to the current version 2 shape. Use `POST /api/reset` or a separate `NAVIPAY_DATA_FILE` when testing a clean wallet and inventory fixture.
- `src/sandbox.js` owns the version 1 safe task projection and persisted financial snapshot semantics; browser read APIs expose `projection` alongside the deliberately retained legacy task shape. Use `GET /api/tasks/:id/projection` when testing reload-safe redaction.
- The optional local-only browser discovery prototype is implemented in `src/playwright-discovery.js` and its separate worker process; `targetSite` is accepted only for server-allowlisted hosts, and selected browser candidates are matched to the seeded authoritative catalog before purchase. The seeded `LocalDiscoveryAdapter` remains the default fallback. The competition replay fixture and exact commands are documented in the README.
- The default sandbox debit path is the persisted local issuer lifecycle in `src/issuer.js` plus `LocalMerchantCheckoutAdapter` and `src/checkout-worker.js`; card capabilities are process-local and never part of task or projection data. `npm test` covers legacy compatibility as well as the issuer-backed checkout path, and the exact competition demonstration is documented in the README.
- The separate credential-free XSGD funding and mock KYC seams are authoritative in `src/funding.js`, `src/kyc.js`, and the funding routes in `src/server.js`; funding is gated by persisted approved mock KYC and credits the fake wallet through persisted funding ledger legs exactly once. Webhook and reference-reconciliation routes require exact provider IDs, strict local authorization, and stable idempotency fallbacks. Official-provider prerequisites and safe route authorization are documented in the README.
- `src/sandbox.js` persists the bounded one-instruction `authorizationEnvelope` and redacted `authorizationDecision`; card issuance is downstream of unique hard-constraint matching, a fresh exact quote, inventory, mock KYC, simulated funding, local merchant scope, and risk checks. Explicit policy fixtures include `pending-kyc`, `rejected-kyc`, `insufficient-funding`, `ambiguous-same-brand`, and `stale-quote`; the README documents the default local mock KYC bootstrap.
- Task projections use task-owned financial snapshots and lifecycle statuses (`not_started`, `skipped`, or explicit outcomes), never the current global wallet as a fallback. Quote IDs, cart IDs, line snapshots, expiry, budget status, and stable snapshot hashes are persisted with inventory reservations; `test/truthfulness.test.js` covers no-match isolation, hard constraints, checkpoint recovery, and commit compensation.
- The primary UI path is seeded local commerce and the mock KYC/funding disclosure is collapsed; optional browser evidence is explicitly read-only and collapsed. The receipt is the primary success artifact and contains immutable capture snapshots plus a safe current refund/reversal adjustment, alongside price, balance, payment, order, fulfillment, delivery, and reference snapshots.
