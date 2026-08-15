# NaviPay

> **Current stage: P0 local-only commerce sandbox and truthful agentic contract.**
>
> NaviPay turns one bounded plain-language purchase instruction into an
> inspectable local commerce run. Every wallet, catalog item, merchant, card,
> checkout, funding event, KYC decision, order, fulfillment update, delivery
> update, and model response in this repository is simulated or recorded
> locally.

**Simulation only. No real money, order, custody, KYC, card issuance, merchant
checkout, or delivery is used.** A local test or testnet reference is not
customer funds or proof of a live provider event.

## Project index

Start with these documents before changing the product:

- [Product requirements document](docs/prd.md) - authoritative P0 promise,
  scope, surfaces, four-stage model, truthfulness rules, accessibility gates,
  non-goals, and unresolved Captain decisions.
- [Market research](docs/research/market-research.md) - consolidated market,
  product critique, post-purchase UX, discovery, virtual-card, and local-safe
  opportunity evidence.
- [Technical implementation reference](docs/research/technical-implementation.md)
  - current architecture, adapter-first boundaries, model and browser
  contracts, provider diligence, ledger semantics, readiness, testing, and
  no-go conditions.
- [Architecture](docs/architecture.md) - current server authority, lifecycle,
  projections, recovery, redaction, extension points, and local runbook.
- [Acceptance tracks](docs/acceptance-tracks.md) - Customer, Developer, and
  market-research-informed browser contracts.

The PRD defines what NaviPay is allowed to claim. The research documents explain
why the local product is shaped this way and which future paths remain gated.
The architecture and source files define exact current behavior. Contributors
should preserve the local default, task-owned financial truth, redaction,
idempotency, unknown-payment recovery, and explicit simulation disclosure.

## Current local contract

- Primary purchase: `POST /api/purchases/run`
- Candidate recovery: `POST /api/tasks/:id/run`
- Unknown-payment recovery: `POST /api/tasks/:id/payment/reconcile`
- Receipt: `GET /api/tasks/:id/receipt`
- Reviewer proof: `GET /api/tasks/:id/reviewer` and `GET /api/runs/:runId/reviewer`
- Safe task projection: `GET /api/tasks/:id/projection`
- Local reset: `POST /api/reset`

The default agent modes are an offline recorded replay and a deterministic
fallback. Both are advisory. Server policy and local adapters authorize every
side effect. Optional browser discovery is read-only, bounded, allowlisted, and
unable to invoke checkout or payment.

## Run and validate

Requirements: Node.js 20 or newer and npm. From the repository root:

```sh
npm install
npm start
```

Open <http://127.0.0.1:3000> and enter an example such as `buy a Logitech
mouse` or `Find an Apple Magic Keyboard`.

For an isolated local state file, use a separate terminal:

```sh
mkdir -p .data
NAVIPAY_DATA_FILE="$PWD/.data/navipay-review.json" npm start
```

Or reset the seeded local wallet and inventory through the local API:

```sh
curl -sS -X POST http://127.0.0.1:3000/api/reset
```

Validation commands:

```sh
npm test
npm run check
npm run test:ui
```

`npm test` covers lifecycle, ledger, inventory, recovery, persistence,
funding/KYC, issuer/checkout, agent contracts, projections, HTTP, and frontend
contracts. `npm run check` validates JavaScript syntax. `npm run test:ui` runs
Chrome UI assertions across idle, running, success, failure, unknown,
reconciliation, drawer, refund/reversal, and narrow states.

## Optional read-only browser evidence

This is a local fixture demonstration, not live merchant browsing or checkout.
It requires the optional Playwright dependency and Chromium:

```sh
npm install --no-save playwright
npx playwright install chromium
npm run demo:playwright
```

The worker reads an explicitly allowlisted local fixture with bounded GET/HEAD
requests only. It sends no credentials and cannot reserve stock, issue a card,
place an order, or authorize payment. If the optional dependency is unavailable,
NaviPay reports the labelled seeded-catalog fallback.

## Safety boundary

Do not add provider credentials, private keys, PAN/CVV, identity documents, raw
provider payloads, or local data to source control. Future StraitsX/XSGD,
0xGasless x402/Fuji, card, merchant, model, custody, and live-money paths are
separate decision-gated adapters. The repository currently has no evidence of a
provider key, 0xGasless account, Fuji allocation, StraitsX capability, live LLM,
card issuer, merchant, or organizer integration.
