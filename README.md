# NaviPay

NaviPay is a local-only, mock-first purchase control plane. It demonstrates one bounded XSGD purchase from funding evidence through a task-scoped instrument, one checkout, and a redacted audit timeline.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm install
npm start
```

Open <http://127.0.0.1:3000>. The app seeds a fresh happy-path task when the local store is empty. It needs no provider credentials, RPC access, merchant account, or external service.

The local JSON store is written to `.data/navipay.json` with an atomic, permission-restricted replacement. Set `NAVIPAY_DATA_FILE` to use another location. Use **Reset local demo** in the console, or delete the file while the server is stopped, to clear local runs and seed a new happy path.

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

The focused tests cover the complete lifecycle, separated funding and settlement evidence, quote immutability, the XSGD ceiling, idempotency, all deterministic failure and reconciliation paths, scoped checkout-result validation, reset behavior, and persistent store recovery boundaries.

## Architecture and extension points

- `src/domain.js` owns the server-side six-stage state machine, policy checks, idempotency records, quote lock, one-use instrument invariant, reconciliation, and audit events.
- `src/adapters.js` defines replaceable funding, discovery, issuer, and checkout contracts. The default adapters return deterministic local fixtures and never need credentials.
- `src/store.js` provides the single-host persistent store, atomic writes, reset behavior, and state-shape validation. No database service is required for this MVP.
- `src/server.js` serves the JSON API and static operator console from one origin. The API is the integration boundary for a future brief.
- `public/` contains the responsive six-stage operator experience: entry, funding, discovery and quote lock, issuance, execution, and outcome/audit.

When the official problem arrives, adapt the narrowest surface possible: update the task brief and normalized candidate fixture, then add provider implementations behind the existing adapter contracts. Keep policy decisions in `src/domain.js`, keep secrets inside provider adapters, and preserve the task ceiling, exact quote lock, one-checkout rule, reconciliation stop, and redacted audit output until the new brief explicitly changes them.

The operator console never receives sensitive payment credentials, wallet keys, identity documents, or model transcripts. Funding evidence and card-spendable settlement remain separate fields and separate audit facts.

## Deliberate MVP boundary

This slice does not include social login, consumer wallet features, generalized shopping, multi-task queues, policy editing, production custody, production KYC, or live provider integrations. Live adapters can be added behind the contracts without changing the domain lifecycle.
