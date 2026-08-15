# NaviPay technical implementation reference

**Status:** Committed implementation and integration-readiness reference

**Reviewed:** 2026-08-15

**Evidence window:** 2026-08-04 through 2026-08-13 UTC for provider, network, and architecture research

**Scope:** Current local architecture, adapter-first future boundaries, model and browser boundaries, payment and ledger truth, provider diligence, and no-go gates. This document does not authorize a provider integration or a runtime change.

## 1. Evidence and authority

Use these labels throughout implementation reviews:

- **Observed local:** present in the current repository, tests, or a loopback run.
- **Documented provider capability:** described by official public provider documentation. It does not prove NaviPay access or eligibility.
- **Official network fact:** described by official Avalanche or standards documentation.
- **Organizer claim:** asserted by a brief or organizer handoff but not independently verified.
- **Recommendation:** a proposed adapter or control design.
- **Unknown:** not established. Unknown must remain unknown in code, UI, and docs.

The current repository authority is [the server](../../src/server.js), [the sandbox service](../../src/sandbox.js), [the store](../../src/store.js), [the issuer](../../src/issuer.js), [the checkout worker](../../src/checkout-worker.js), [the model gateway](../../src/model-gateway.js), [the agent contract](../../src/agent-contract.js), [the agent orchestration](../../src/agentic.js), and the tests under [`test/`](../../test/). Product boundaries are in [the PRD](../prd.md) and [the architecture document](../architecture.md).

## 2. Current P0 architecture

NaviPay is a one-process Node.js local sandbox bound to loopback. The browser submits a bounded instruction and renders server-owned projections. The server owns interpretation, quote, inventory, funding eligibility, policy, payment, order, fulfillment, delivery, receipt, and redaction.

```text
Browser
  -> HTTP boundary: src/server.js
  -> authoritative service: src/sandbox.js
  -> local adapters and policy
     -> seeded discovery/catalog
     -> mock funding and KYC
     -> inventory lease
     -> local issuer capability
     -> local checkout worker and merchant gateway
     -> fake wallet and balanced ledger
     -> merchant credit, order, fulfillment, delivery
  -> version 2 JSON store: src/store.js
  -> customer projection and reviewer projection
```

### Server authority

The browser may submit a request, select an explicitly presented candidate, request safe reconciliation, and read projections. It may not choose a price, amount, balance, merchant, quote expiry, inventory result, payment credential, policy decision, adapter, order, or delivery status. The browser does not turn optional discovery evidence into checkout authority.

`POST /api/purchases/run` is the primary purchase contract. `POST /api/tasks/:id/run` resumes a persisted run that needs candidate selection. `POST /api/tasks/:id/payment/reconcile` resolves a local unknown result without retrying checkout. Receipts and reviewer projections are read models, not mutation authorities.

### Persistence

The version 2 local JSON store migrates version 1 shape and atomically writes a restricted temporary file before rename. It is suitable for one local process and deterministic recovery tests. It is not a transactional multi-process ledger, distributed idempotency boundary, outbox, backup system, tenant store, or production durability claim.

The safe local persistence model includes tasks, operations, idempotency, wallet transfers, double-entry ledger legs, inventory reservations, orders, fulfillment, delivery, issuer metadata, checkout sessions, refunds, funding/KYC records, agent runs, events, and checkpoints. Raw card capability values are not persisted.

## 3. Current local contracts

### Discovery and quote

`LocalDiscoveryAdapter` ranks the seeded catalog using hard constraints, category, brand, keywords, stock, and stable order. A candidate includes merchant and item identity, variant, price components, total, currency, stock, match reasons, and simulated evidence. The authoritative service locks the selected candidate into a quote/cart snapshot with expiry, budget status, and a hash.

Optional Playwright discovery is a separate read-only evidence path. The worker is bounded, allowlisted, credential-free, GET/HEAD-only, and recommendation-only. The server matches a browser candidate to the seeded authoritative catalog before it can affect a purchase. It cannot reserve stock, issue a card, invoke checkout, place an order, or deliver anything.

### Funding and mock KYC

The local funding seam returns a seeded fake wallet balance and separate mock chain-looking evidence. The funding-intent simulator can create pending, confirmed, failed, expired, and reversed local events and credit the fake wallet exactly once after a local mock KYC gate. It does not call a network, create an address, prove a deposit, or establish custody.

The local KYC provider stores a normalized mock status and safe reference, not identity documents. A normal local purchase may bootstrap a simulated approval for the demo. Pending and rejected fixtures remain hard stops. This is not identity verification, sanctions screening, source-of-funds evidence, or provider approval.

### Issuer and checkout

The local issuer creates safe metadata for a one-use capability scoped to task, merchant/domain, exact amount, currency, category, expiry, and one successful capture. PAN-like and CVV-like values live in a process-local capability map and are accessible only through the issuer callback boundary.

The local checkout worker creates fresh per-task profile metadata, passes the capability to the local gateway callback, records safe status and cleanup, and clears the local reference. It does not launch a browser, submit an external form, or cross a PCI boundary. The merchant checkout fixture is read-only and explicitly says the local gateway owns capture outcomes.

### Payment, ledger, order, and delivery

The issuer capture invokes the fake wallet capture path once. A successful local payment writes balanced wallet debit and merchant-credit legs under a stable operation. Merchant-credit confirmation verifies that existing transfer and is not a second debit. An idempotent order follows confirmed payment and local inventory rules. Fulfillment and delivery are independent records. A delivery failure preserves payment and order truth.

The receipt stores immutable capture facts plus a current refund or reversal adjustment. A refund or reversal does not rewrite the original capture snapshot, order history, fulfillment, or delivery history.

## 4. Four-stage implementation model

The product reviewer model is Funding, Discovery, Issuance, and Execution. Each stage has local and future provider semantics, and they must not be conflated.

| Stage | Current local proof | Future adapter boundary |
| --- | --- | --- |
| Funding | Seeded fake wallet, mock KYC, local funding intent/events, separate mock chain evidence, exact-once local ledger credit. | Approved customer/account binding, KYC/KYB, exact asset/network/contract, provider balance, signed event or status lookup, internal ledger reconciliation. |
| Discovery | Seeded catalog and optional read-only browser evidence. | Approved merchant/catalog API or permitted public read-only source, normalized identity, quote, inventory evidence, freshness, and terms. |
| Issuance | Process-local one-use capability with exact scope and redaction. | Approved issuer program, account/funding source, secure capability broker, card controls, 3DS/challenge, status, lifecycle, refund, and webhook/reconciliation. |
| Execution | Local callback gateway, fake-wallet capture, merchant credit, order, fulfillment, delivery, receipt. | Approved merchant API or bounded checkout worker, one canonical capture, order authority, signed events, status lookup, reconciliation, and support/returns owner. |

The local stage model is a proof of orchestration. It is not a claim that all four real-world capabilities are present.

## 5. Adapter-first future architecture

Keep the current service and projections stable while replacing one boundary at a time. Future providers must normalize facts before they reach the orchestration domain.

```text
Customer API              Reviewer API              Operator API
      |                         |                         |
      +----------- safe projection boundary ------------+
                            |
                    server run coordinator
                            |
               deterministic policy engine
                 /          |             \
          model gateway  tool registry    event writer
                 |          |               |
          advisory model  adapters       checkpoints
                            |
      +---------------------+-----------------------+
      |                     |                       |
 funding/KYC          discovery/quote       issuer/checkout
      |                     |                       |
 chain/ledger          inventory/order      merchant/payment
                            |
                 signed callbacks and lookup
                            |
                durable inbox/outbox/reconcile
```

### Normalized adapter rules

Every provider adapter should:

- accept a server-created operation ID, idempotency key, deadline, and immutable scope hash;
- return normalized status, timestamps, safe references, provider mode, environment, and evidence class;
- keep raw provider payloads, keys, credentials, signatures, and restricted PII inside the adapter boundary;
- distinguish `confirmed`, `declined`, `unknown`, `unavailable`, and `conflict`;
- expose capability and readiness separately from configuration presence;
- support status lookup or documented reconciliation before any retry after timeout;
- be injectable in tests with deterministic recorded fixtures;
- fail closed when the provider omits a control that NaviPay policy requires.

### Proposed normalized contracts

These are internal proposals, not undocumented provider API names.

```text
FundingAdapter
  capabilities() -> assets, networks, statuses, environments
  getCustomerStatus(customerRef)
  createFundingIntent(scope, idempotencyKey)
  getFundingStatus(providerRef)
  ingestWebhook(rawRequest) -> normalized event
  reconcile(providerRef, operationId)

DiscoveryAdapter
  discover(request, limits) -> candidates and evidence
  revalidate(candidateRef, quotePolicy)

IssuerAdapter
  issue(scope, idempotencyKey) -> safe card ref and opaque capability
  status(cardRef)
  authorize(request) -> authorized | declined | unknown
  capture(authRef, idempotencyKey)
  refund(captureRef, idempotencyKey)
  reverse(authRef, idempotencyKey)
  retire(cardRef)
  reconcile(operationRef)

MerchantAdapter
  quote(request)
  reserve(quote, idempotencyKey)
  checkout(scope, opaqueCapability)
  getOrder(orderRef)
  refundOrCancel(orderRef, policy)

OnchainPaymentAdapter
  capabilities()
  readiness()
  getAgent(agentRef)
  getBalance(agentRef, chain, token)
  prepare(scope, idempotencyKey)
  settle(operationRef)
  reconcile(operationRef, payloadHash, txHash?)
```

A provider adapter does not gain authority because its public documentation names a capability. Provider access, program eligibility, legal model, environment, and account binding must be evidenced separately.

## 6. Model gateway and agent boundary

The P0 model gateway supports checked-in recorded replay and deterministic fallback. The replay bundle is an integrity-checked fixture, not a keyed signature and not a live model response. The deterministic parser, server policy, and local adapters remain authoritative.

A future `ModelGateway` may support `recorded_replay`, `deterministic_fallback`, an approved local model, or an approved hosted model. The gateway must validate closed structured output, enforce token, wall-clock, turn, and tool budgets, record mode and provenance, and convert failures to a labelled fallback or pause.

### Safe model context

Context may include:

- versioned system safety rules;
- bounded agent role and registered tool schemas;
- simulated or approved preferences, hard constraints, budget, delegation purpose, and safe address/profile references;
- the task instruction and server-owned safe snapshots;
- sanitized, explicitly untrusted page observations.

Context may not include PAN, CVV, private keys, seed phrases, provider secrets, raw KYC documents, unrestricted cookies, authorization headers, raw webhook bodies, raw page instructions, or unrestricted browser control.

### Model permissions

The model may propose intent, candidate selection, read-only observations, registered tool calls, pauses, or a bounded next action. Deterministic services must authorize customer/session/delegation, quote, amount, currency, merchant, inventory, funding, KYC, issuer scope, checkout action, ledger effect, order, refund, reversal, and reconciliation.

Merchant page text is untrusted. A prompt injection must be recorded as an observation safety event, not treated as a system instruction. No model output may widen a tool schema, recipient, origin, budget, quote, or credential scope.

## 7. Discovery is not checkout

### Discovery

Discovery is read-only evidence collection. A future live source must have an approved domain or API, stable product and merchant identity, complete price components, currency, availability, quote age, source attribution, rate limits, terms, and a revalidation path. Public search, affiliate, shopping, or browser results do not grant order or payment authority.

The discovery worker must enforce method, origin, redirect, DNS, response size, page, tab, deadline, and content limits in the worker. It must block credentials, cookies, service-worker effects, downloads, arbitrary page evaluation, private IP access, and cross-origin drift. It returns normalized candidates only.

### Checkout

Checkout is a distinct side-effecting capability. A future bounded worker must use a fresh isolated context or provider-hosted secure element, an exact approved origin, fixed server-owned actions, a quote and cart fingerprint, a single submit capability, and explicit result verification. It must stop for login, CAPTCHA, OTP, 3DS, amount drift, merchant drift, item/variant drift, domain change, or unknown submit outcome.

The model may select from registered actions, but cannot choose arbitrary URLs, selectors, JavaScript, HTTP methods, credentials, or recipient addresses. A browser worker must return safe action metadata and normalized result facts. It must redact fields from DOM snapshots, screenshots, traces, network logs, console output, and exceptions.

## 8. Issuer and payment boundary

P0 uses one local canonical payment effect: local issuer capture debits the fake wallet once. A future provider mode must choose exactly one canonical purchase debit.

Valid future choices include:

- provider card capture is the canonical external purchase effect, with provider balance and NaviPay ledger reconciliation; or
- an on-chain/provider transfer is the canonical settlement effect, with local issuer and fake-wallet capture disabled for that run; or
- an explicitly named legacy local payment mode remains separate.

Never run local issuer capture and external settlement for the same purchase and call both one payment. Never fall back from an unknown external effect to a new local debit or new provider authorization.

A future issuer contract must represent issue, status, authorization, capture, refund, reversal/void, retire/revoke, 3DS or challenge, webhook, and reconciliation. Provider controls actually applied must be returned and verified. If merchant-ID lock or one-use semantics are unavailable, the adapter must not claim them.

## 9. StraitsX and XSGD diligence

The public research recorded these facts, all of which are either documented provider material or unresolved diligence, not NaviPay access:

- The [StraitsX XSGD page](https://www.straitsx.com/xsgd), accessed 2026-08-04, lists an Avalanche mainnet XSGD contract and chain ID 43114 in public product material.
- StraitsX documentation describes Business Account and developer-role prerequisites for sandbox keys, production business verification/KYC, API approval, customer profile models, callbacks, idempotent requests, and status/reconciliation patterns.
- Public references show `XSGD_AVAX` capability examples and production-only blockchain deposit-address references in the reviewed material. No public Fuji XSGD inbound deposit sandbox was established.
- Public sandbox material covers mock bank-transfer or PayNow collection and profile verification transitions. That is not an XSGD Avalanche deposit proof.
- Public FAQs say provider balances may be business-level rather than per-end-user. NaviPay would need an approved internal ledger and fund-flow model.
- StraitsX card pages and card API research describe provider claims or gated documentation for virtual cards, RHA, limits, 3DS, simulation, webhooks, settlement, and reconciliation. No NaviPay account, key, card program, or capability is evidenced.

The onboarding questions are: exact approved integration model, account/customer binding, KYC/KYB status, custody and address attribution, XSGD asset and network, sandbox versus production support, callback signature and retry semantics, balance ownership, fees, limits, conversion, card issuance, merchant authorization, refunds, and legal/compliance responsibilities.

A public XSGD contract address is not a provider account, a balance, a deposit address, a sandbox allocation, a customer fund, or proof of custody.

## 10. 0xGasless x402 and Avalanche Fuji candidate

The 2026-08-13 0xGasless research found official public documentation for `@0xgasless/agent`, x402, and Fuji. It did not verify an organizer account, API key, agent, tier, allocation, recipient, or capability in NaviPay.

### Candidate flow

The smallest candidate is a separate testnet settlement proof:

```text
server policy
  -> provider-managed 0xGasless agent
  -> short-lived x402 EIP-3009 authorization
  -> facilitator settlement
  -> Fuji receipt and Transfer-log verification
  -> separate reviewer proof
```

Official provider documentation describes a direct Agent SDK, provider-managed signing, x402 EIP-3009 `TransferWithAuthorization`, facilitator settlement, policy checks before signing, and no native AVAX requirement for the direct facilitator path. This is a provider capability claim, not NaviPay access.

The same research records provider-documented Fuji values:

- Avalanche Fuji C-Chain, EVM chain ID 43113, RPC `https://api.avax-test.network/ext/bc/C/rpc`.
- Provider-documented Fuji USDC address `0x5425890298aed601595a70AB815c96711a31Bc65`.
- Provider-documented Fuji XSGD test deployment `0xd769410dc8772695A7f55a304d2125320a65c2a5`.
- Provider documentation describes six-decimal EIP-3009 tokens and an XSGD EIP-712 domain in the reviewed material.

These values must be treated as documented provider capability until runtime capability discovery and independent chain reads verify the exact organizer environment. Do not use a mainnet contract on Fuji. Do not treat a faucet allocation, organizer points, testnet token balance, or provider demo credit as customer funds.

### Candidate controls

A future adapter must verify before signing:

- provider mode, project, stable agent identity, custody model, tier, token policy, and revocation status;
- chain ID 43113 and C-Chain network identity;
- token address, bytecode, symbol, decimals, settlement primitive, EIP-712 domain, and provider `/tokens` capability;
- an exact server-allowlisted recipient, never a model or page-selected address;
- atomic amount conversion from local display units to six-decimal provider units;
- provider balance and sponsor/facilitator readiness;
- short validity window and a fresh nonce;
- operation ID, payload hash, and reconciliation record before the external effect.

A future result is `confirmed` only after a successful receipt on the expected chain and a matching token Transfer event for payer, exact recipient, exact token, and exact atomic amount. A provider response or transaction hash alone is insufficient.

### Accounting boundary

The safest first proof keeps two artifacts separate:

1. The existing NaviPay local receipt for the simulated item, fake wallet, local issuer, local order, and local delivery.
2. A Fuji testnet settlement proof showing provider mode, chain, token, recipient label, amount, hash, block, receipt/log verification, and testnet disclosure.

Binding Fuji settlement to the NaviPay receipt requires a Captain decision that selects it as the canonical payment effect and disables the local issuer/fake-wallet effect for that run. This report does not make that choice.

### x402 no-go conditions

Do not enable the candidate if the provider identity, key, agent, tier, token, chain, recipient, balance, primitive, sponsor, or reconciliation contract is unknown. Do not retry after signing or settlement timeout with a new nonce. Do not automatically fall back to a local debit after a possible provider side effect.

Public sources: [0xGasless documentation](https://docs.0xgasless.com/), [Agent SDK quickstart](https://docs.0xgasless.com/erc8004/quickstart/), [x402](https://docs.0xgasless.com/x402/), [facilitator API](https://docs.0xgasless.com/x402/facilitator-api/), [supported chains](https://docs.0xgasless.com/x402/supported-chains/), [official Agent SDK repository](https://github.com/0xgasless/agent-sdk), [Avalanche Primary Network](https://build.avax.network/docs/primary-network), and [Avalanche C-Chain RPC](https://build.avax.network/docs/rpcs/c-chain).

## 11. Token, chain, and settlement verification

Never configure an asset by symbol alone. Use a complete tuple:

```text
asset symbol
network name
EVM chain ID
network ID where relevant
contract address
bytecode present
symbol and decimals from contract
settlement primitive
EIP-712 domain if applicable
provider capability response
recipient or account binding
observation timestamp
```

For Avalanche C-Chain, verify `eth_chainId` and `net_version`, then verify contract code, `symbol()`, `decimals()`, expected event signatures, receipt status, and Transfer logs. Distinguish chain accepted, provider credited, internally posted, held, captured, and reconciled. Use the provider completion callback or status lookup when provider custody is involved. Do not invent a universal confirmation count.

For any external settlement:

- represent display currency and atomic units separately;
- use integer arithmetic and explicit decimals;
- reject wrong chain, wrong contract, wrong recipient, wrong payer, wrong amount, wrong token, unsupported settlement mode, stale quote, or missing proof;
- persist payload hash and safe references, not raw signatures or secrets;
- retain a restricted reconciliation record after task completion.

## 12. Secret handling and feature flags

Provider mode must be opt-in, server-only, and fail closed. Suggested future configuration names are illustrative, not current variables:

```text
NAVIPAY_ENV=local|provider_sandbox|provider_fuji|provider_production
NAVIPAY_LIVE_MODE_ENABLED=false
NAVIPAY_FUNDING_PROVIDER=local_mock|approved_provider
NAVIPAY_ISSUER_PROVIDER=local_fake|approved_issuer
NAVIPAY_MERCHANT_PROVIDER=seeded_local|approved_api|approved_browser
NAVIPAY_AGENT_MODE=recorded_replay|deterministic_fallback|approved_model
NAVIPAY_PROVIDER_API_KEY=server-secret
NAVIPAY_PROVIDER_WEBHOOK_SECRET=server-secret
NAVIPAY_MODEL_API_KEY=server-secret
NAVIPAY_X402_ENABLED=false
NAVIPAY_X402_CHAIN_ID=43113
NAVIPAY_X402_TOKEN_ADDRESS=provider-confirmed
NAVIPAY_X402_RECIPIENT=server-allowlisted
NAVIPAY_KILL_SWITCH=true
```

These values must never be accepted from the browser. Local, provider sandbox/Fuji, and production use separate secrets, data files, agent IDs, recipient allowlists, callback endpoints, and deployment instances. A readiness endpoint may expose safe booleans and reason codes, never secrets, raw provider URLs, signatures, or unrestricted account identifiers.

Readiness should distinguish:

- configured versus authenticated;
- account/customer ready versus merely reachable;
- KYC/KYB ready;
- asset/network/token ready;
- issuer/card ready;
- merchant execution ready;
- webhook/reconciliation ready;
- balance sufficient versus unknown;
- kill switch enabled versus disabled;
- fallback available.

A key present is not readiness. A provider HTTP 200 is not purchase readiness.

## 13. Ledger and balance semantics

Use task-owned snapshots in customer projections. Do not merge the current global wallet into a task whose payment result is unknown, failed, pre-payment, compensated, or otherwise not definitive.

P0 local facts include:

- seeded fake wallet balance;
- local funding credit legs;
- local payment debit and merchant-credit legs;
- local inventory reservation and release;
- task balance before and after local payment when definitive;
- compensation, refund, or reversal adjustment.

A future provider model must separate at least:

```text
provider or custody balance
NaviPay internal pending balance
NaviPay internal available balance
task reserve
provider authorization hold
captured amount
fees and conversion
refund or reversal receivable
final reconciled balance
```

Every journal entry needs operation ID, task ID, account, asset/currency, integer amount, source event, provider reference, effective time, and immutable metadata. External provider business balance, on-chain observation, card limit, internal ledger, and customer-visible spendable balance are different facts until a written accounting and custody decision says otherwise.

## 14. Idempotency, unknown outcomes, and reconciliation

### Identities

Keep these identities independent:

- browser run key and NaviPay task/run ID;
- adapter operation ID and idempotency key;
- provider event ID and provider reference;
- checkout attempt ID and merchant order ID;
- card authorization ID and capture ID;
- blockchain transaction hash plus Transfer log index;
- x402 payload hash plus EIP-3009 nonce.

### Rules

- Persist an operation record before an external side effect where possible.
- Reuse the same idempotency key after timeout when the provider documents that behavior.
- A same-key same-input request returns the original result. A same-key changed-input request is rejected.
- Unknown after submit is not declined, failed, or success. Query merchant/provider status and chain evidence without creating a new effect.
- A local unknown reconciliation input is a fixture control. A future provider result must come from provider lookup or authenticated event evidence, not a customer or model assertion.
- Compensation is separate from the original operation and must itself be idempotent.
- Reconciliation remains available after card retirement or task completion for late refunds, reversals, force-posts, or provider events.
- Never use local fallback as a post-side-effect recovery for a possible provider settlement.

## 15. Security and privacy controls

### P0 controls

- Loopback binding and explicit local simulation authorization for local mutation routes.
- No provider credentials, raw model credentials, PAN/CVV, private keys, identity documents, or raw provider payloads.
- Process-local card capability and fresh local checkout metadata.
- Read-only discovery worker with URL, method, response, redirect, tab, byte, and time bounds.
- HTML escaping and redacted customer/reviewer projections.
- Separate Customer, Developer, and reviewer vocabulary. Developer mode is not authorization.
- Deterministic local fixtures for decline, unknown, compensation, refund, reversal, and restart.

### Future controls

- authenticated principal, session, device, tenant, and role model;
- delegated agent identity with purpose, audience, amount, merchant, asset, expiry, nonce, and revocation;
- step-up policy for high-risk or changed scope;
- provider-specific KYC/KYB, sanctions, source-of-funds, Travel Rule, and risk boundaries;
- signed callbacks with timestamp, body binding, replay protection, event deduplication, and status lookup;
- transactional persistence, inbox/outbox, workers, locks, circuit breakers, and reconciliation queues;
- PCI review or provider-hosted tokenized card fields;
- DNS/SSRF controls, egress allowlist, browser process isolation, retention/deletion, secret rotation, audit access review, and incident response.

## 16. Test matrix

### Current local gate

Run from the repository root:

```sh
npm install
npm start
npm test
npm run check
npm run test:ui
```

Use a separate `NAVIPAY_DATA_FILE` or `POST /api/reset` for clean state. The current test and UI suites are the local acceptance gate.

### Scenario matrix

| Area | Cases | Required assertion |
| --- | --- | --- |
| Request and discovery | clear match, no match, hard brand, quantity, budget, ambiguity, stale quote, read-only browser fallback | No hidden substitution or downstream side effect before a valid quote. |
| Funding/KYC | local approval, pending, rejected, duplicate funding event, wrong asset/network, reversal | Local status is explicit; only confirmed local fixture credit is posted once. |
| Issuance | exact scope, merchant mismatch, amount overage, expired capability, one-use reuse, process restart | No credential leaves capability boundary; scope cannot widen. |
| Payment | success, decline, insufficient funds, unknown, authorized/declined reconciliation, compensation | One canonical local debit; unknown never retries; ledger stays balanced. |
| Order lifecycle | merchant credit failure, order failure, inventory commit failure, fulfillment failure, delivery failure | Compensation and independent order/delivery truth are preserved. |
| Receipt | success, refund, reversal, reload | Capture snapshot is immutable; current adjustment is separate and safe. |
| Agent | replay, deterministic fallback, invalid proposal, prompt injection, policy deny, checkpoint rebuild | Mode/provenance is accurate; proposal cannot authorize side effects. |
| HTTP and access | idempotency replay, changed input, local simulation header, provider identity mismatch, broad legacy response | Safe errors, stable replay, no secrets, no future access claim. |
| UI/accessibility | idle, running, selection, unknown, insufficient funds, drawer, refund/reversal, narrow, focus loop | Outcome truth, no jargon leakage, focus containment, no horizontal overflow. |

### Future provider gate

Add recorded provider fixtures before any network call. Test missing and invalid keys, wrong environment, account not ready, KYC pending, wrong token/network, wrong recipient, insufficient balance, provider 429/5xx, signed callback failure, duplicate/out-of-order event, stale quote, 3DS/OTP, browser crash, unknown settlement, failed receipt, Transfer-log mismatch, refund after retirement, and reconciliation after restart.

## 17. Staged implementation order

### Stage 0: preserve local truth

- Keep the local default and existing public purchase route.
- Fix or document any known task-owned balance, KYC/funding secret, receipt adjustment, quantity, reservation expiry, and focus issues found in current validation.
- Keep local mock fixtures and recorded replay as the regression oracle.

### Stage 1: contract fixtures and readiness

- Define versioned provider-neutral DTOs and capability registry.
- Add local recorded provider fixtures and redaction tests.
- Add safe readiness projection and environment/mode labels.
- Add provider-shaped ledger, webhook inbox, operation, and reconciliation fixtures without credentials.

### Stage 2: optional model and local execution proof

- Keep replay/fallback default.
- If the Captain selects a real browser proof standard, build a separate local checkout worker and local merchant page with fixed actions and opaque capability handoff.
- Do not widen read-only discovery. Add structured model mode only behind the existing advisory boundary.

### Stage 3: controlled provider sandbox

Only after provider, organizer, legal, compliance, security, and operations answers are recorded:

- implement account/KYC/funding adapter;
- implement exact asset/network/callback/reconciliation contract;
- implement issuer/card adapter and secure capability broker;
- implement approved merchant API or bounded browser execution;
- prove one canonical payment effect and no-double-charge behavior;
- keep local mode as a separate fallback deployment.

### Stage 4: live launch review

Require formal approval for identity, delegation, custody, card program, settlement, merchant terms, support, returns, data retention, security, observability, incident response, kill switch, and customer copy. A provider sandbox success is not production readiness.

## 18. Provider and organizer onboarding checklist

### 0xGasless and Fuji candidate

- [ ] Confirm exact product and package: `@0xgasless/agent`, AgentKit, Core, server wallet, or private wrapper.
- [ ] Confirm package version, API base URL, facilitator, project ID, stable agent ID, tier, custody model, and revocation contact.
- [ ] Confirm whether the proof is x402 EIP-3009, ERC-4337, ERC-7702, or another primitive.
- [ ] Confirm Fuji chain ID 43113 and the exact runtime token address, decimals, settlement mode, and EIP-712 domain.
- [ ] Confirm agent token balance, sponsor/facilitator readiness, and any AVAX requirement.
- [ ] Confirm one fixed recipient, its purpose, ownership, and EOA/contract status.
- [ ] Confirm whether organizer allocation, points, faucet tokens, or testnet tokens have any unit or redemption meaning. Treat them as non-customer funds.
- [ ] Approve a tiny separate settlement proof before any receipt binding.
- [ ] Verify receipt and Transfer log independently. Define timeout and unknown handling.

### StraitsX and XSGD

- [ ] Obtain Business Account, developer role, sandbox key, and approved integration model.
- [ ] Ask specifically for exact XSGD Avalanche inbound support, not generic SGD, USDC, XUSD, or another network.
- [ ] Confirm sandbox versus production deposit-address support, account/customer binding, custody, address attribution, and ledger ownership.
- [ ] Confirm CP/CP+, third-party/first-party/regular flow, KYC/KYB statuses, RFI, restricted jurisdictions, and funding gate.
- [ ] Confirm exact network, chain ID, token contract, decimals, callback event, signatures, retry policy, status lookup, idempotency, fees, limits, finality, reversal, and refunds.
- [ ] Confirm card program, issuer, XSGD-to-card settlement, one-use/merchant controls, 3DS, PCI boundary, webhooks, and external merchant test path.
- [ ] Complete legal, compliance, custody, security, treasury, and data-retention review.

### Any issuer or merchant adapter

- [ ] Name the issuer, sponsor, jurisdiction, account, and exact enabled capabilities.
- [ ] Prove issue, status, authorize, capture, refund, reversal, revoke, challenge, webhook, and reconciliation semantics.
- [ ] Prove provider controls actually match the requested merchant, amount, currency, category, expiry, and capture count.
- [ ] Define secure capability injection and PCI responsibility.
- [ ] Name the approved merchant/source, terms, quote, inventory, order, fulfillment, delivery, support, returns, and refund owner.
- [ ] Run success, decline, timeout, duplicate, unknown, force-post, 3DS/OTP, price drift, merchant drift, provider outage, and restart drills.

### Hosted or local model

- [ ] Name provider, model, endpoint class, region, data retention, structured output/tool support, and secret owner.
- [ ] Keep model context free of credentials and raw payment/page data.
- [ ] Record model mode, model ID/version, prompt/schema hashes, proposal, policy result, and fallback reason.
- [ ] Prove timeout, invalid output, prompt injection, tool denial, rate limit, and outage behavior.

## 19. Explicit no-go conditions

Do not enable provider or live mode when any of the following is true:

- only a key or marketing page exists, without account, capability, environment, and contract evidence;
- asset, network, token contract, decimals, or recipient is not verified;
- provider balance, custody, account binding, or economic ownership is unknown;
- KYC/KYB, sanctions, source-of-funds, or delegation policy is undefined for the proposed flow;
- signed callbacks, status lookup, idempotency, reconciliation, or unknown-result ownership is missing;
- an issuer or merchant sandbox is being mistaken for external checkout authority;
- PAN/CVV, private keys, raw signatures, provider payloads, or identity data would enter ordinary app state or logs;
- the system could double debit by combining local capture and provider settlement;
- the system could retry a possible side effect with a new key or nonce;
- the browser could choose a recipient, origin, amount, selector, payment credential, or policy;
- testnet tokens, faucet allocations, organizer points, or provider credits would be presented as customer funds;
- legal, compliance, security, operations, provider, or Captain approval is absent;
- the product would need to expand `EEB` without authoritative meaning.

## 20. Public source register

### StraitsX, XSGD, and Avalanche

- StraitsX XSGD, accessed 2026-08-04: <https://www.straitsx.com/xsgd>
- StraitsX getting started, environments, authentication, and FAQs: <https://docs.straitsx.com/docs/getting-started>, <https://docs.straitsx.com/docs/sandbox-production-environments>, <https://docs.straitsx.com/docs/authentication-methods>, <https://docs.straitsx.com/docs/common-faqs>
- StraitsX integration models: <https://docs.straitsx.com/docs/first-party-transfer>, <https://docs.straitsx.com/docs/third-party-transfer>, <https://docs.straitsx.com/docs/regular-transfer>, <https://docs.straitsx.com/docs/integration-model-faqs>
- StraitsX customer profiles and statuses: <https://docs.straitsx.com/docs/customer-profile-creation>, <https://docs.straitsx.com/docs/customer-profile-statuses>, <https://docs.straitsx.com/docs/cp-cp-plus>
- StraitsX callbacks and safety: <https://docs.straitsx.com/docs/callback-configuration>, <https://docs.straitsx.com/docs/transaction-status>, <https://docs.straitsx.com/docs/idempotent-requests>, <https://docs.straitsx.com/docs/transaction-safety>
- StraitsX blockchain references: <https://docs.straitsx.com/reference/get-a-list-of-supported-blockchains>, <https://docs.straitsx.com/reference/create-deposit-address>, <https://docs.straitsx.com/reference/get-deposit-addresses>
- StraitsX card platform claim: <https://www.straitsx.com/platform/card-issuance>
- Avalanche Primary Network: <https://build.avax.network/docs/primary-network>
- Avalanche C-Chain RPC: <https://build.avax.network/docs/rpcs/c-chain>
- Avalanche consensus: <https://build.avax.network/docs/primary-network/avalanche-consensus>

### 0xGasless and Fuji

- 0xGasless documentation: <https://docs.0xgasless.com/>
- Agent SDK quickstart and lifecycle: <https://docs.0xgasless.com/erc8004/quickstart/>, <https://docs.0xgasless.com/erc8004/agents/>
- 0xGasless payments and x402: <https://docs.0xgasless.com/erc8004/payments/>, <https://docs.0xgasless.com/x402/>
- Facilitator API and supported chains: <https://docs.0xgasless.com/x402/facilitator-api/>, <https://docs.0xgasless.com/x402/supported-chains/>
- Official Agent SDK repository: <https://github.com/0xgasless/agent-sdk>
- Avalanche C-Chain network setup: <https://build.avax.network/academy/blockchain/x402-payment-infrastructure/04-x402-on-avalanche/02-network-setup>
- Avalanche faucet warning: <https://support.avax.network/en/articles/6110239-is-there-an-avax-faucet>

### Card, checkout, identity, and discovery

- Stripe Issuing virtual cards and controls: <https://docs.stripe.com/issuing/cards/virtual>, <https://docs.stripe.com/issuing/controls/spending-controls>, <https://docs.stripe.com/issuing/controls/real-time-authorizations>
- Airwallex authorization controls: <https://www.airwallex.com/docs/issuing/card-controls/authorization-controls>
- Lithic cards and simulations: <https://docs.lithic.com/docs/cards>, <https://docs.lithic.com/docs/simulating-transactions>
- Ramp Agent Cards: <https://docs.ramp.com/developer-api/v1/agent-cards>
- Playwright browser contexts: <https://playwright.dev/docs/browser-contexts>
- Amazon Creators API and policies: <https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction>, <https://affiliate-program.amazon.com/help/operating/policies>
- eBay Browse API: <https://developer.ebay.com/develop/api/buy/browse_api>
- Shopify Storefront API: <https://shopify.dev/docs/api/storefront>
- MAS Payment Services Act: <https://www.mas.gov.sg/regulation/acts/payment-services-act>
- MAS PSN02: <https://www.mas.gov.sg/regulation/notices/psn02-notice-on-prevention-of-money-laundering-and-countering-the-financing-of-terrorism>
- FATF virtual-assets guidance: <https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-vasps.html>
- FATF Travel Rule: <https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Travel-rule.html>

## 21. How to use this reference

Read this document after [the PRD](../prd.md) and [the architecture reference](../architecture.md), before adding code, dependencies, credentials, provider configuration, or a new adapter. Treat the source register as evidence to revisit, not as an access grant. Preserve the local default until every applicable no-go condition is closed with direct evidence and an explicit Captain decision.
