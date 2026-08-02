# NaviPay

NaviPay is a local-only, mock-first purchase control plane. It accepts a natural shopping request, ranks a deterministic local catalog, and demonstrates one bounded XSGD purchase from funding evidence through a task-scoped instrument, one checkout, and a redacted audit timeline.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm install
npm start
```

Open <http://127.0.0.1:3000>. The app seeds a fresh happy-path task when the local store is empty. It needs no provider credentials, RPC access, merchant account, or external service.

The local JSON store is written to `.data/navipay.json` with an atomic, permission-restricted replacement. Set `NAVIPAY_DATA_FILE` to use another location. **Reset local demo** is an explicit destructive control: it clears local tasks and audit history, then seeds one new happy path. A safe replay creates a separate task and preserves the original record.

## Natural request discovery

Enter **I want Apple earphones** in the purchase-request field. NaviPay deterministically normalizes the text into the brand `Apple`, product category `earphones`, and keywords `apple` and `earphones`. The mock discovery adapter ranks seeded examples such as Apple AirPods 4, Apple AirPods Pro 2, Sony WF-C700N, Samsung Galaxy Buds3, Soundcore Liberty 4 NC, and Bose QuietComfort Ultra Earbuds. Each candidate includes its merchant, item, variant, XSGD total, availability, relevance explanation, expiry, and local-catalog evidence.

This catalog is deliberately small and local. It is not a live marketplace, does not check real inventory, and does not scrape arbitrary websites. Results carry a `DEMO / MOCK` disclosure and are only quote candidates. A clear in-budget recommendation is selected by the server and locked automatically; an ambiguous or over-cap run pauses with the ranked candidates visible so the operator can choose before lock. The server then owns policy, issuance, checkout, receipt, persistence, and redacted audit transitions as one run.

The replaceable discovery boundary is `MockDiscoveryAdapter` in `src/adapters.js`. A future approved live source can implement the same adapter contract and normalize its response there, while keeping credentials inside the provider process and preserving the server-side quote lock, cap, policy, scoped instrument, idempotency, and reconciliation safeguards. The local adapter remains the default.

## Fresh-start product walkthrough

1. Start with `npm start`, then open the operator workspace. The persistent task list shows the current run and prior outcomes after refresh or server restart.
2. Enter **I want Apple earphones**, then choose **Create request task**. The browser calls `POST /api/purchases/run`; the backend stores the raw request and parsed intent, verifies funding, discovers and ranks local candidates, auto-selects Apple AirPods 4, locks the quote, passes policy, issues one scoped mock authority, executes one checkout, and returns a persisted receipt.
3. The page shows the interpreted intent, selected recommendation, exact quote, backend-owned progress timeline, final receipt, history entry, and redacted audit evidence. There are no Continue buttons for the happy path.
4. If a request is genuinely ambiguous, or a quote exceeds the immutable ceiling, the run pauses at ranked candidates. Choose a candidate and **Confirm selection and finish run**; the server resumes the same bounded lifecycle. An unknown checkout instead stops for explicit reconciliation and is never retried.
5. At any point, inspect the separate on-chain evidence and card-spendable settlement fields. The latter is a mock issuer-ledger fact and is never inferred from the chain observation.
6. Use **Safely replay as new task** only for a completed or safely stopped task. An unresolved unknown checkout cannot be replayed. Use **Reset local demo** only when you intentionally want to discard this local history.

## Competition demo script

The console is designed for a short, reliable presentation:

1. Start with the seeded task or enter **I want Apple earphones**. Point out the single task authority, XSGD currency, immutable XSGD 1,000 ceiling, and visible `DEMO / MOCK PROVIDERS` disclosure.
2. Submit the request once. The backend-driven run completes the happy path without lifecycle clicks. Show the interpreted intent, Apple AirPods 4 recommendation, progress timeline, receipt, and append-only redacted audit.
3. Select a Judge scenario only when demonstrating an exception. Unknown checkout presents reconciliation choices; over-cap and ambiguous runs present candidates before lock; funding, discovery, issuer, and merchant errors stop safely.
4. Use **Reset local demo** to return to a known local state before another presentation.

Every consequential transition is backed by the JSON API and persisted locally. Refreshing the page or restarting the server keeps the current run. Repeating an action with the same idempotency key replays the stored result without calling an adapter twice.

## Scenario walkthrough

The Judge scenarios selector creates isolated deterministic runs. All scenarios are credential-free:

- **Happy path**: funding verified, quote locked, policy approved, scoped authority issued, checkout authorized and captured.
- **Over-cap policy failure**: a XSGD 1,250 quote is locked and declined by server policy before issuance. The ceiling cannot be bypassed in the UI or API.
- **Unknown checkout / reconcile**: checkout returns no definitive result. NaviPay marks the authority pending reconciliation and blocks replay. Resolve it as authorized or declined; neither choice retries checkout.
- **Merchant decline**: the mock merchant declines once. The task is terminal, the authority is retired, and no retry is offered.
- **Issuer failure**: the issuer adapter fails after policy approval. No instrument is exposed and the task stops with an audit event.
- **Funding verifier failure**: the funding adapter fails before discovery.
- **Discovery failure**: funding succeeds, then the catalog adapter fails before a quote exists.

## Test and validate

```sh
npm test
npm run check
```

The focused tests cover deterministic request parsing and catalog ranking, the one-call Apple request-to-receipt orchestration, automatic selection, ambiguity and over-cap pauses, quote locking, receipt and audit persistence after reload, idempotency, all deterministic failure and reconciliation paths, scoped checkout-result validation, reset behavior, and persistent store recovery boundaries. The browser console uses the same `POST /api/purchases/run` contract rather than faking lifecycle progress.

## Architecture and extension points

- `src/domain.js` owns the server-side six-stage state machine, the `startPurchase` / `orchestrateTask` bounded run, policy checks, idempotency records, quote recommendation and lock, one-use instrument invariant, receipt, reconciliation, and audit events.
- `src/adapters.js` defines deterministic request parsing, local-catalog ranking, and replaceable funding, discovery, issuer, and checkout contracts. The default adapters return local fixtures and never need credentials. The discovery contract receives either a normalized natural request intent or the preserved direct task purchase and returns candidates; the issuer and checkout contracts receive only the locked scope.
- `POST /api/purchases/run` is the browser integration boundary. `POST /api/tasks/:id/run` resumes an ambiguous or over-cap task after an explicit candidate choice. Both are idempotent and return the persisted task plus run status.
- `src/store.js` provides the single-host persistent store, atomic writes, reset behavior, and state-shape validation. No database service is required for this MVP.
- `src/server.js` serves the JSON API and static operator console from one origin. The API is the integration boundary for a future brief.
- `public/` contains the responsive six-stage operator experience: entry, funding, discovery and quote lock, issuance, execution, and outcome/audit.

When the official competition requirements arrive, replace the narrowest adapter implementation rather than the workspace or state machine. Implement the funding verifier, discovery provider, issuer, and checkout provider behind the contracts in `src/adapters.js`, normalize external responses at that boundary, and keep credentials inside the provider adapter process. Update the task brief and candidate normalization only where the official contract requires it. Keep policy decisions in `src/domain.js`, and preserve the task ceiling, exact quote lock, one-checkout rule, reconciliation stop, and redacted audit output until the new brief explicitly changes them. Live integrations should be opt-in and credentialed; mock mode remains the safe local default.

The operator console never receives sensitive payment credentials, wallet keys, identity documents, or model transcripts. Funding evidence and card-spendable settlement remain separate fields and separate audit facts.

## Deliberate MVP boundary

This slice does not include social login, consumer wallet features, a generic marketplace, reviews, subscriptions, generalized shopping, multi-task queues, policy editing, production custody, production KYC, or live provider integrations. Live adapters can be added behind the discovery contract after an approved source is available, without changing the domain lifecycle.
