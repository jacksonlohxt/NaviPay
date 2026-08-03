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
- The optional local-only browser discovery prototype is implemented in `src/playwright-discovery.js` and its separate worker process; the seeded `LocalDiscoveryAdapter` remains the default fallback. Configuration and safety limits are documented in the README.
