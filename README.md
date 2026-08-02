# NaviPay

NaviPay is a local-only, mock-first purchase control plane. It demonstrates one bounded XSGD purchase from funding evidence through a scoped instrument, one checkout, and a redacted audit timeline.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm install
npm start
```

Open <http://127.0.0.1:3000>. The app seeds a task automatically and needs no provider credentials, RPC access, merchant account, or external services.

The local JSON store is written to `.data/navipay.json` with an atomic replacement. Set `NAVIPAY_DATA_FILE` to use another location, or delete the file to start with a clean local run.

## Test and validate

```sh
npm test
npm run check
```

The focused tests cover the complete lifecycle, funding and settlement separation, quote immutability, the XSGD 1,000 ceiling, idempotency, provider declines, and unknown checkout reconciliation.

## Demo paths

The console keeps `DEMO / MOCK PROVIDERS` visible in the header and on every consequential stage. The scenario selector can start isolated deterministic runs for:

- Happy path: verified fixture evidence, quote lock, policy approval, scoped issuance, captured checkout.
- Over-cap policy failure: a quote above the immutable XSGD 1,000 task ceiling is declined before issuance.
- Unknown checkout: the task stops in reconciliation and never retries automatically.
- Merchant decline and issuer failure: terminal provider failure paths with audit evidence.

## Architecture

- `src/domain.js` owns the server-side state machine, policy checks, idempotency records, scoped instrument invariant, reconciliation, and audit events.
- `src/adapters.js` contains replaceable funding, discovery, issuer, and checkout contracts with deterministic mock implementations.
- `src/store.js` provides the single-host persistent store. No database service is required for this MVP.
- `src/server.js` serves the JSON API and the static operator console from one origin.
- `public/` contains the accessible six-stage operator experience: entry, funding, discovery and quote lock, issuance, execution, and outcome/audit.

The operator console never receives sensitive payment credentials, wallet keys, identity documents, or model transcripts. Funding evidence and card-spendable settlement are separate fields and separate audit facts.

## Deliberate MVP boundary

This slice does not include social login, consumer wallet features, generalized shopping, multi-task queues, policy editing, production custody, production KYC, or live provider integrations. Live adapters can be added behind the contracts without changing the domain lifecycle.
