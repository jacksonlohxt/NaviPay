# NaviPay Product Requirements Document

**Status:** Authoritative product contract for the current local-only P0 stage

**Reviewed:** 2026-08-15

**Product owner:** Captain, with maintainers responsible for implementation fidelity

**Current release boundary:** P0 local simulation is the finished stage. It is not a live-money, KYC, custody, card-issuance, merchant-checkout, delivery, or hosted-model release.

## 1. Product promise

NaviPay turns one bounded plain-language purchase instruction into a server-owned, inspectable local commerce run. The product must make the request, selected item, exact local quote, simulated payment, order lifecycle, receipt, recovery state, and evidence understandable without implying that a fixture is a real provider event.

The product promise is:

> One instruction, one bounded local run, one truthful result.

The current P0 demonstrates local orchestration and evidence. It does **not** prove live money, live XSGD, KYC or AML verification, custody, wallet ownership, card issuance, merchant checkout, order fulfillment, delivery, or a live LLM. A green test suite proves local invariants only.

This document is the product-level authority. Exact HTTP schemas and implementation behavior remain authoritative in [the architecture reference](architecture.md), [the acceptance tracks](acceptance-tracks.md), [the server routes](../src/server.js), [the sandbox service](../src/sandbox.js), and the tests under [`test/`](../test/).

## 2. Users and jobs

| User | Job to be done | Required surface |
| --- | --- | --- |
| Customer or demo participant | State one purchase request and understand what happened without learning payment or adapter terminology. | Customer mode, outcome, receipt, payment/order/delivery status, safe next action, simulation disclosure. |
| Captain, organizer, or reviewer | Prove which boundaries ran, what was local, what was proposed, what policy allowed, and how an exception recovered. | Read-only reviewer projection with four stages, provenance, policy evidence, checkpoints, and safe references. |
| Contributor or engineer | Reproduce a deterministic run, inspect contracts, add a fixture, and verify that a failure cannot become false success. | Repository docs, local run commands, seeded catalog, tests, safe developer evidence. |
| Local demo operator | Reset fixtures, add simulated funds or stock, and inspect local recovery without exposing mutation controls to Customer mode. | Developer presentation and loopback-authorized simulation controls. This is not authentication or role security. |

## 3. P0 goals

1. Complete one bounded purchase from request to local receipt with server-owned facts.
2. Keep the server authoritative for request interpretation, quote, budget, inventory, KYC/funding gate, authorization, payment, order, fulfillment, delivery, receipt, and projections.
3. Make the distinction between advisory agent proposals and authorized side effects reviewable.
4. Preserve truth through reload, idempotent replay, unknown payment, compensation, refund, reversal, and delivery failure.
5. Keep credentials, private keys, raw provider payloads, identity documents, and unsafe model or page data out of ordinary task, browser, audit, and reviewer projections.
6. Give Customer mode a calm receipt-first experience and give reviewers a compact proof surface.
7. Keep the default runtime offline, deterministic, resettable, and safe to run without credentials or external services.

## 4. Finished P0 scope

P0 is the current finished local simulation. It includes:

- One instruction, one purchase purpose, XSGD display currency, one-unit policy, and a local task ceiling of XSGD 1,000.
- Deterministic request parsing, hard brand/category/product/quantity/budget checks, and a seeded local catalog.
- Local quote arithmetic for item price, shipping, tax, total, quote ID, cart ID, expiry, budget status, and snapshot hash.
- Inventory reservation before payment, with lease, commit, release, expiry, and idempotent references.
- A credential-free local funding seam and mock KYC seam. These are local eligibility fixtures, not identity or source-of-funds verification.
- A process-local one-use issuer capability scoped to merchant, domain, amount, currency, category, expiry, and one successful capture.
- A bounded local checkout callback and local merchant gateway. This is a simulated checkout, not a real browser checkout or external merchant.
- Balanced fake-wallet ledger legs, merchant-credit confirmation, idempotent order creation, independent fulfillment and delivery, and a persisted receipt.
- Task-owned financial snapshots, redacted customer projection, bounded next actions, receipt capture facts, and safe current refund or reversal adjustment.
- Recorded agent replay and deterministic fallback. Both are offline and advisory. Neither is a live model response.
- Optional Playwright discovery that is server-allowlisted, bounded, credential-free, GET/HEAD-only, read-only, recommendation-only, and matched to the seeded authoritative catalog before purchase.
- A read-only reviewer projection with Funding, Discovery, Issuance, and Execution evidence.

### P0 does not prove

The following must never be inferred from the local implementation, a local reference, a mock status, a testnet label, or a passing test:

- live money, live XSGD, a blockchain transaction, finality, or custody;
- verified identity, KYC/KYB, AML, sanctions screening, Travel Rule compliance, or wallet ownership;
- a provider key, provider account, 0xGasless account, StraitsX capability, Fuji token allocation, faucet allocation, or organizer points;
- a real card issuer, virtual card, PAN, CVV, network authorization, 3DS, or card settlement;
- an external merchant, merchant order, live inventory, carrier, support owner, or delivery;
- a hosted model, live LLM, model-provider approval, or model training/retention policy;
- a production database, multi-user access control, distributed idempotency, or operational durability.

Testnet tokens, faucet allocations, organizer points, and provider demo credits are not customer funds. If a future provider proof is added, it must carry its own environment and economic-ownership disclosure.

## 5. The four-stage product model

The reviewer model groups the run into four auditable stages. The current local implementation has more granular internal checkpoints. Those checkpoints must map to exactly one of these stages and must not be narrated as separate live integrations.

### 5.1 Funding

**Purpose:** establish the local or future provider funding fact required by the run.

P0 requirements:

- Show a local mock funding observation or an explicitly labelled pre-funded fixture.
- Keep mock KYC status separate from funding balance and chain-looking evidence.
- Keep the fake wallet, local ledger, and any mock `Avalanche Fuji` label separate from live chain or provider facts.
- Do not create an external deposit, wallet address, custody record, or provider credit.
- A submitted, pending, failed, or ambiguous funding event cannot credit the local wallet as confirmed. Local simulation routes are idempotent and explicitly authorized.

Future provider requirements are decision-gated. A provider funding adapter must bind an approved account, exact asset, exact network, token contract, amount, status, callback or status lookup, fees, and reconciliation reference before any internal ledger credit. A provider business balance is not automatically a customer balance.

### 5.2 Discovery

**Purpose:** find and explain the item that matches the instruction, without creating a payment side effect.

P0 requirements:

- Use the seeded catalog as the default authority.
- Enforce hard constraints before ranking or fallback. A named brand, product, category, quantity, or budget cannot be silently substituted.
- Persist the candidate evidence, selection reason, quote arithmetic, freshness, and authoritative locked snapshot.
- Pause for a genuine tie or required candidate choice before inventory or payment.
- Optional browser evidence is read-only and cannot reserve stock, issue a capability, invoke checkout, or write an order.

A future discovery API or browser adapter must return normalized identity, variant, merchant, price, shipping, tax, total, currency, availability, observed time, expiry, source, and evidence hash. Search authority is not quote, inventory, order, or payment authority.

### 5.3 Issuance

**Purpose:** create a narrowly scoped local capability only after the server has locked the exact purchase scope.

P0 requirements:

- Issue only after quote, inventory, local funding/KYC gates, and deterministic policy checks pass.
- Scope the local capability to the task, merchant/domain, exact amount, currency, category, expiry, and one successful capture.
- Persist only safe card metadata and references. PAN-like and CVV-like values remain process-local and never appear in task state, logs, browser responses, fixtures, model context, or audit payloads.
- Retire or revoke the local capability on capture, decline, unknown recovery, expiry, failure, or safe cancellation.

P0 local issuance is a simulation of a capability boundary. It does not prove card issuance, PCI compliance, network controls, 3DS, or an issuer relationship.

### 5.4 Execution

**Purpose:** execute the locked local purchase and record what actually happened.

P0 requirements:

- Use the local checkout worker and local merchant gateway only.
- Validate merchant, item, amount, currency, category, expiry, one-use state, and operation identity at the issuer boundary.
- Capture the fake-wallet debit once and create balanced local ledger legs. Merchant credit confirms the existing transfer and is never a second debit.
- Create an order only after confirmed local payment and committed inventory under the local contract.
- Keep fulfillment and delivery independent from payment and order. A delivery failure does not rewrite a confirmed payment or order.
- Persist a receipt with immutable capture facts and a separate current refund or reversal adjustment.
- Treat an unknown payment as a durable stop. Reconciliation continues from the existing operation and never retries checkout or creates a second debit.

A future merchant API or browser worker requires a separately approved execution boundary. Read-only discovery must never be widened into checkout by configuration alone.

## 6. Customer surface requirements

Customer mode is the default presentation and is not an authorization boundary. It must be built from the server-owned customer projection.

### Idle

- One plain instruction field and one primary run action.
- One short disclosure: `Simulation only. No real money, order, or delivery is used.`
- Optional product evidence is collapsed and clearly read-only.
- No wallet dashboard, provider setup, card controls, or technical timeline.

### Active or awaiting selection

- Show the instruction and a coarse truthful progress state.
- Show plain-language milestones, not adapter logs or model chain-of-thought.
- On ambiguity, show candidates with item, merchant, variant, total, availability, and one reason. State that nothing has been reserved or paid before selection.
- Disable duplicate submission while the same run is active.

### Terminal success

The success view has no more than two primary surfaces:

1. An outcome sentence that says what happened.
2. One canonical receipt/order card with item, merchant, exact total, payment status, order status, delivery status, issue time, and safe next action.

The receipt is the primary success artifact. Price details, selection rationale, safe references, and technical activity remain secondary or collapsed. The completed view must not become a banking dashboard or duplicate the same item and status in multiple primary cards.

### Exceptions

| State | Required customer truth |
| --- | --- |
| No match | No qualifying local item. No reservation, payment, order, or receipt. |
| Over budget | The candidate or total exceeds the allowed local budget. Nothing was reserved or paid. |
| Out of stock | The exact requested item is unavailable. Do not substitute another brand without a new decision. |
| Insufficient funds | The total exceeds the available simulated balance. Nothing was paid. Recovery must be a new purchase, never an automatic retry of the failed task. |
| Declined | Payment was declined. No ledger debit, confirmed order, or receipt. |
| Payment unknown | Payment status needs confirmation. No automatic retry will occur. Do not show final balance, paid status, confirmed order, or receipt. |
| Delivery failure | Payment and order remain confirmed. Delivery needs attention. Do not call the purchase failed. |
| Refund or reversal | Preserve the immutable original capture and show a separate current adjustment. Do not rewrite order history. |

### Customer redaction

Customer mode must not show PAN, CVV, private key, seed phrase, identity document, raw provider payload, MCC, ledger-leg terminology, webhook payload, issuer secret, model secret, raw page content, or an unredacted address. A safe payment label or masked reference may be shown in a secondary payment view when it helps support or explanation.

## 7. Developer and reviewer surfaces

Developer mode presents the same run with safe local evidence and simulation controls. It changes presentation only. It is not authentication, account access, authorization, custody, payment approval, or a security boundary.

The read-only reviewer projection should expose:

- run and task IDs, mode, provenance, schema and policy versions, and safe hashes;
- Funding, Discovery, Issuance, and Execution statuses and transitions;
- bounded context summary, typed proposal, tool registry, policy decision, safe observations, tool facts, evidence references, budgets, retries, checkpoints, and final outcome;
- quote, inventory, funding/KYC boundary, issuer scope, checkout, payment, ledger, order, fulfillment, delivery, receipt, compensation, adjustment, and reconciliation facts;
- explicit local labels such as `recorded replay`, `deterministic fallback`, `local mock funding`, and `local checkout simulation`.

It must not expose raw prompts, chain-of-thought, raw page text, provider payloads, credentials, private keys, or mutation controls. Local simulation controls such as top-up, restock, reset, refund, reversal, or fixture reconciliation must remain separated from proof and clearly marked as local operations.

## 8. Agent and model boundary

The default P0 modes are:

- `recorded_replay`: checked-in, integrity-checked response bundle; no network and no live model call;
- `deterministic_fallback`: network-free deterministic planning and policy path.

Both modes produce advisory, typed proposals. The model gateway, if later enabled, may propose structured intent, a candidate choice, a read-only observation, a registered tool call, a pause, or a bounded checkout action. It may not:

- set the authoritative price, total, balance, inventory, currency, quote expiry, card scope, or order state;
- issue or capture a card, debit a wallet, create an order, credit funding, approve KYC, or resolve unknown payment without authoritative evidence;
- select an arbitrary URL, recipient, merchant, selector, HTTP method, credential, private key, or provider;
- override hard constraints, delegation, budget, quote freshness, risk, or a no-retry state.

The server policy engine and local adapters remain authoritative. Any future hosted or local model requires explicit server-only configuration, structured-output validation, timeout and turn budgets, prompt-injection handling, retention approval, provenance, and a labelled fallback. The coding-agent harness model is not a NaviPay model integration.

## 9. Truthfulness, recovery, and financial requirements

### Core invariants

- The browser never chooses the authoritative price, quote, balance, merchant, inventory, payment scope, or lifecycle state.
- A quote is locked before payment capability issuance, and inventory is reserved before capture.
- Failed pre-capture states create no confirmed payment, order, or receipt.
- A successful local capture creates one debit and one matching merchant credit.
- Every side effect has a stable operation ID and idempotency key.
- Replaying an idempotency key returns the original response; reusing it with different input is rejected.
- Unknown effects are reconciled by status or explicit local fixture semantics, never by blind retry.
- Compensation is an explicit new fact. It does not erase the original payment attempt.
- Fulfillment and delivery are independent states.
- Task projections use task-owned snapshots and never use the current global wallet as a fallback for final task truth.
- Original receipt capture facts remain immutable beside current adjustments.
- Reload and process restart preserve safe state and never restore a credential to the browser.

### Recovery matrix

| Fault | Required P0 behavior | Future provider extension |
| --- | --- | --- |
| Duplicate request | Persisted idempotent replay; no second task or side effect. | Cross-process idempotency and request inbox. |
| Ambiguous selection | Pause before reservation and payment; require candidate choice. | Confidence and approval policy for provider candidates. |
| Stale quote | Stop before issue or capture; require fresh quote and policy. | Provider revalidation and quote version. |
| Out of stock or over budget | Stop and release any temporary reservation. | Provider reservation and expiry lookup. |
| Declined payment | Retire local capability, release reservation, no debit/order/receipt. | Provider status, void, and reconciliation. |
| Unknown payment | Keep safe unresolved state and reservation policy; no retry. | Signed event or provider lookup, durable unknown queue, actor policy. |
| Post-capture order/inventory failure | Compensate where local contract permits; preserve charge and compensation truth. | Durable saga and provider refund/void semantics. |
| Fulfillment or delivery failure | Preserve payment and order; show delivery or preparation attention. | Independent operations and support ownership. |
| Reload or restart | Rebuild projections from persisted facts; stop if a capability cannot be safely recreated. | Checkpoint, outbox, worker lease, and provider operation reconciliation. |

## 10. Balance vocabulary

Every balance shown in a task must carry its scope, currency, source, and status. These terms must not be conflated:

| Term | Meaning | P0 treatment | Future treatment |
| --- | --- | --- | --- |
| Task balance before | Task-owned snapshot immediately before the purchase effect. | Safe when known; label as simulated. | Reconcile to the approved account and operation. |
| Provider balance | Balance reported by a funding, issuer, or custody provider. | Does not exist. | Restricted reviewer/operator fact until account semantics are approved. |
| On-chain observation | Token amount or transfer evidence observed on a named chain and contract. | Mock chain evidence only; never spendable by implication. | Verify chain, contract, event, recipient, amount, and finality. |
| NaviPay ledger balance | Internal double-entry balance after posted local or approved external events. | Fake wallet and local ledger only. | Separate pending, available, held, captured, refunded, and reconciled accounts. |
| Spendable balance | Amount currently available for the exact policy and payment source. | Seeded fake wallet balance. | Require authoritative provider semantics and timestamp. |
| Held or reserved amount | Amount reserved by a payment, inventory lease, or provider authorization. | Local reservation and operation facts. | Reconcile hold, capture, release, and expiry. |
| Captured amount | Definitive amount captured for this task. | Local fake capture only. | Provider capture plus independent reconciliation. |
| Refunded or reversed amount | A later adjustment against a capture. | Local adjustment only. | Provider event and internal ledger adjustment. |
| Final balance | Balance after all known effects are definitive. | Never show as final during unknown payment. | Only after provider and ledger reconciliation policy says final. |

XSGD, SGD, USD, USDC, AVAX, and testnet assets are distinct currencies or assets. Testnet tokens, faucet tokens, points, and provider demo credits are not customer funds.

## 11. Security and privacy

### Current local boundary

- The executable server binds to loopback for the local demo.
- Local simulation and webhook-shaped routes require explicit local authorization where documented.
- The JSON store is single-process local persistence with restricted writes and atomic replacement. It is not a multi-tenant or distributed financial store.
- Card-like values stay in a process-local capability map. Safe metadata only is persisted.
- Browser discovery is GET/HEAD-only, bounded, allowlisted, credential-free, and recommendation-only.
- Projections and audit evidence are redacted, HTML-escaped, and designed not to contain credentials or raw provider content.

### Future provider boundary

No provider key, model key, card credential, private key, KYC document, signing key, raw webhook, or raw provider payload may enter source, fixtures, local data, browser code, model context, ordinary logs, or customer/reviewer projections. Future secrets must be server-only, injected by a secret manager, separated by environment and provider, rotated, and excluded from error messages.

Provider modes require authenticated principals, role and tenant boundaries, CSRF or equivalent command protection, signed callback verification, timestamp and replay checks, event deduplication, status lookup, durable idempotency, a transactional ledger, and a kill switch. These are not P0 claims and are no-go requirements for shared or live deployment.

Page text is untrusted data. Prompt injection, redirects, hidden fields, cookies, login, CAPTCHA, 3DS, OTP, and arbitrary merchant actions are stop conditions, not reasons to bypass controls.

## 12. Accessibility and responsive requirements

- All status colors have text equivalents and accessible names.
- Run, reconciliation, refund, reversal, and mode changes expose state through appropriate live regions without claiming success before server truth.
- Customer and Developer controls are keyboard reachable with visible focus.
- A modal payment drawer must contain focus, make the background inert or otherwise unreachable, close on Escape, and restore focus to its opener. A declaration of `aria-modal` alone is insufficient.
- Narrow layouts must preserve item, merchant, amount, exception copy, and next action without horizontal overflow.
- Reduced motion must not remove state meaning.
- Customer reading order is outcome, receipt/order, action, then collapsed evidence. Reviewer reading order is outcome, four stages, proof summary, detailed evidence, then controls.

Accessibility and visual evaluation is part of the product gate, not a polish-only activity.

## 13. Test and evaluation gates

### Required local commands

From the repository root:

```sh
npm install
npm start
npm test
npm run check
npm run test:ui
```

`npm start` runs the single local host. Use `NAVIPAY_DATA_FILE` or `POST /api/reset` for an isolated fixture. `npm test` covers lifecycle, ledger, inventory, recovery, persistence, funding/KYC, issuer/checkout, agent contracts, projections, HTTP, and frontend contracts. `npm run check` validates JavaScript syntax. `npm run test:ui` runs Chrome UI assertions across idle, running, success, failure, unknown, reconciliation, drawer, refund/reversal, and narrow states.

### Minimum scenario gate

A release candidate must prove, with a clean local state and safe browser/API evidence:

- happy path to receipt;
- no match, over budget, out of stock, ambiguity, insufficient funds, and decline with no false side effects;
- unknown payment after reload with no automatic retry and exactly one reconciliation;
- merchant/order compensation and delivery failure preserving payment truth;
- idempotent replay and changed-input rejection;
- refund and reversal preserving immutable capture facts;
- reviewer projection rebuild and redaction;
- no PAN, CVV, private key, raw provider payload, model secret, or unredacted address in ordinary outputs;
- desktop and narrow layout without horizontal overflow;
- payment drawer focus containment and focus restoration;
- no unapproved outbound network call in the local-only browser proof, except explicitly documented static assets.

### Future provider gate

Provider mode is not enabled by a key alone. It requires recorded capability discovery, environment separation, account and customer binding, exact token/network configuration, readiness checks, signed callbacks or status lookup, reconciliation, secret review, no-double-charge proof, failure drills, and named Captain, provider, legal, compliance, security, and operations approval.

## 14. Roadmap and explicit decision table

The following decisions are intentionally unresolved. Recommendations in research documents do not select a product policy.

| Decision | Options held open | Current boundary |
| --- | --- | --- |
| Live mode | Stay local-only; controlled provider sandbox; general live mode. | Local-only. No live switch exists. |
| Funding and custody | No NaviPay balance; provider-held account; self-custody/smart account; constrained hybrid. | Seeded fake wallet only. |
| StraitsX/XSGD | Exact XSGD diligence; approved SGD pilot with explicit conversion; another approved rail; local-only. | No StraitsX account, key, or access is evidenced. SGD is not XSGD. |
| 0xGasless and Fuji | Separate tiny x402 testnet settlement proof; provider settlement as canonical purchase debit; no provider proof. | Candidate only. Keep any Fuji proof separate from the local receipt unless a new accounting decision selects it as the one payment effect. |
| Issuer and card | Local fake issuer; approved provider virtual card; provider-hosted tokenized flow; no live card. | Local fake issuer only. |
| Merchant execution | Local gateway simulation; bounded local browser fixture; approved merchant API; approved external browser checkout. | Local gateway simulation. Optional discovery cannot checkout. |
| Model runtime | Recorded replay; deterministic fallback; approved local model; approved hosted model. | Replay and deterministic fallback only. |
| Identity/delegation | Demo fixture; authenticated consumer; business/KYB; agent platform acting for a customer. | Demo customer fixture, no real identity. |
| Challenge policy | Stop; authenticated user step-up; provider-hosted 3DS/OTP. | Local scenarios stop or reconcile. No 3DS claim. |
| Balance authority | Local ledger; provider balance; card limit; reconciled multi-ledger model. | Task-owned fake wallet snapshot and local ledger. |
| Unknown-payment actor | Provider lookup; operator-only; customer status check plus provider authority. | Explicit local fixture resolution, not a live precedent. |
| Delivery/support owner | NaviPay; merchant/carrier handoff; references only. | Simulated local delivery; no live support owner. |
| Customer/operator access | Presentation-only demo toggle; separate operator surface; role-based access. | Presentation-only toggle, never security. |
| EEB | The Captain's future-expansion label `EEB`, or another meaning after authoritative context. | **Unresolved. No acronym expansion or product interpretation is assigned here.** |

Any future live or provider change must record the selected option, evidence, owner, rollout mode, and rollback path before implementation.

## 15. Explicit non-goals

P0 does not include:

- live funds, live XSGD, custody, withdrawals, bank accounts, or customer balances;
- real KYC/KYB, identity documents, AML, sanctions, Travel Rule, or compliance claims;
- real cards, issuer programs, PAN/CVV handling, PCI scope, 3DS, or network settlement;
- live merchant checkout, Amazon purchase automation, marketplace order authority, live inventory, carrier, support, returns, or delivery;
- a hosted or local live LLM, general-purpose browser agent, prompt transcript, or model authority over side effects;
- multi-line carts, subscriptions, promotions, coupons, marketplace settlement, or production notifications;
- production concurrency, multi-tenancy, authentication, disaster recovery, or an operational SLA;
- automatic retry of an unknown payment, merchant bypass, CAPTCHA bypass, stealth browsing, or silent merchant substitution;
- a provider integration selected merely because its public documentation or marketing names a capability;
- an expansion of the product label `EEB` without an authoritative Captain decision.

## 16. Product change rule

Before changing the product, contributors must:

1. read this PRD and [the technical architecture reference](architecture.md);
2. classify the requested behavior as current local, documented provider capability, organizer claim, hypothesis, recommendation, or unresolved decision;
3. preserve the server authority, task-owned financial truth, redaction, idempotency, unknown-result, and disclosure invariants;
4. update the relevant acceptance tests and reviewer/customer evidence requirements;
5. do not add provider credentials, dependencies, fixtures, generated files, or runtime behavior unless the approved scope explicitly includes them.

When this PRD conflicts with an exact route or schema, the implementation and tests are authoritative for the current local behavior, while this document is authoritative for the intended product boundary and non-goals.
