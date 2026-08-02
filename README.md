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

This catalog is deliberately small and local. It is not a live marketplace, does not check real inventory, and does not scrape arbitrary websites. Results carry a `DEMO / MOCK` disclosure and are only quote candidates. Selecting one locks the merchant, item, variant, total, currency, and expiry in the persisted task before policy, issuance, checkout, outcome, and audit continue through the existing backend lifecycle.

The replaceable discovery boundary is `MockDiscoveryAdapter` in `src/adapters.js`. A future approved live source can implement the same adapter contract and normalize its response there, while keeping credentials inside the provider process and preserving the server-side quote lock, cap, policy, scoped instrument, idempotency, and reconciliation safeguards. The local adapter remains the default.

## Fresh-start product walkthrough

1. Start with `npm start`, then open the operator workspace. The persistent task list shows the current run and prior outcomes after refresh or server restart.
2. Enter **I want Apple earphones**, then choose **Create request task**. The server stores the raw request and parsed intent before lifecycle work begins. The direct merchant, item, and amount path remains available under **Use the direct merchant, item, and amount path** for exact preselected purchases.
3. Select the new task in **Persisted runs** if needed. Use **Open assigned task**, verify funding, and choose **Discover ranked candidates**. Select an AirPods result or an alternative, inspect the evidence and expiry, then lock one exact quote before continuing through policy, issuance, and the one checkout action.
4. At funding, inspect the separate on-chain evidence and card-spendable settlement fields. The latter is a mock issuer-ledger fact and is never inferred from the chain observation.
5. Review the exact merchant, item, variant, price, currency, availability, evidence, and expiry before locking the quote. Policy enforces the ceiling before issuing a provider-controlled, one-use instrument.
6. Inspect **Redacted evidence** at any stage. It is an append-only task timeline without credentials or wallet keys. Completed and safely stopped tasks remain in history.
7. Use **Safely replay as new task** only for a completed or safely stopped task. An unresolved unknown checkout cannot be replayed. Use **Reset local demo** only when you intentionally want to discard this local history.

## Competition demo script

The console is designed for a short, reliable presentation:

1. Start with the seeded **Assigned purchase brief**. Point out the single task, XSGD currency, immutable XSGD 1,000 ceiling, and visible `DEMO / MOCK PROVIDERS` disclosure.
2. Select **Happy path** in the Judge scenarios card, then choose **Start selected scenario** if a previous run is already complete. The header button replays the selected scenario without leaving the page.
3. Click **Open assigned task**. Explain that opening records operator intent, but does not authorize payment.
4. Click **Verify fixture funding**. Show the separate on-chain evidence and mock card-spendable settlement truths.
5. Continue to discovery, select the recommended Harbor Supply quote, and click **Lock selected quote**. Call out that merchant, item, amount, currency, and expiry become immutable.
6. Run **server policy approval**. The 1,000 XSGD ceiling is checked before issuance.
7. Issue the **mock scoped instrument**, continue to execution, and click **Authorize payment once**. Show the captured authorization, retired one-use authority, and redacted append-only audit trail.
8. Use **Reset local demo** to return to a known seeded entry before another presentation.

Every action is backed by the JSON API and persisted locally. Refreshing the page or restarting the server keeps the current run. Repeating an action with the same idempotency key replays the stored result without calling an adapter twice.

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

The focused tests cover deterministic request parsing and catalog ranking, natural request candidate selection and quote locking, the complete lifecycle, separated funding and settlement evidence, quote immutability, the XSGD ceiling, idempotency, all deterministic failure and reconciliation paths, scoped checkout-result validation, reset behavior, and persistent store recovery boundaries.

## Architecture and extension points

- `src/domain.js` owns the server-side six-stage state machine, policy checks, idempotency records, quote lock, one-use instrument invariant, reconciliation, and audit events.
- `src/adapters.js` defines deterministic request parsing, local-catalog ranking, and replaceable funding, discovery, issuer, and checkout contracts. The default adapters return local fixtures and never need credentials. The discovery contract receives either a normalized natural request intent or the preserved direct task purchase and returns candidates; the issuer and checkout contracts receive only the locked scope.
- `src/store.js` provides the single-host persistent store, atomic writes, reset behavior, and state-shape validation. No database service is required for this MVP.
- `src/server.js` serves the JSON API and static operator console from one origin. The API is the integration boundary for a future brief.
- `public/` contains the responsive six-stage operator experience: entry, funding, discovery and quote lock, issuance, execution, and outcome/audit.

When the official competition requirements arrive, replace the narrowest adapter implementation rather than the workspace or state machine. Implement the funding verifier, discovery provider, issuer, and checkout provider behind the contracts in `src/adapters.js`, normalize external responses at that boundary, and keep credentials inside the provider adapter process. Update the task brief and candidate normalization only where the official contract requires it. Keep policy decisions in `src/domain.js`, and preserve the task ceiling, exact quote lock, one-checkout rule, reconciliation stop, and redacted audit output until the new brief explicitly changes them. Live integrations should be opt-in and credentialed; mock mode remains the safe local default.

The operator console never receives sensitive payment credentials, wallet keys, identity documents, or model transcripts. Funding evidence and card-spendable settlement remain separate fields and separate audit facts.

## Deliberate MVP boundary

This slice does not include social login, consumer wallet features, a generic marketplace, reviews, subscriptions, generalized shopping, multi-task queues, policy editing, production custody, production KYC, or live provider integrations. Live adapters can be added behind the discovery contract after an approved source is available, without changing the domain lifecycle.
