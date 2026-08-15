# NaviPay market research and product inspiration

**Status:** Committed synthesis for the current P0 local product

**Evidence window:** 2026-07-28 through 2026-08-13 UTC, with local product critique observations from 2026-08-12

**Synthesis date:** 2026-08-15

**Scope:** Market patterns, product critique, post-purchase UX, discovery boundaries, virtual-card behavior, and local-safe opportunities. This is research, not provider approval or implementation authorization.

## 1. Executive synthesis

NaviPay should borrow market information architecture and trust boundaries, not branded shells. The strongest local product is a calm purchase assistant that turns one instruction into a bounded, simulated order record:

1. Restate what NaviPay understood.
2. Show the selected local item, merchant, exact total, and why it won.
3. Disclose simulation before and after the run.
4. Show separate purchase, order, fulfillment, and delivery facts while work is active or needs attention.
5. Make the receipt the primary success artifact.
6. Keep technical evidence, safe payment references, and the activity trail one deliberate expansion away.

The local P0 is already strong on server authority, quote and inventory truth, unknown-payment recovery, task-owned financial snapshots, redaction, and receipt adjustments. The most important remaining local opportunities are accessible payment-drawer behavior, a discoverable but safe insufficient-funds handoff, a compact reviewer hierarchy, and clearer original-versus-current payment wording.

No market source establishes that NaviPay has a provider account, API key, XSGD access, card issuer, merchant, live model, or organizer integration. Provider and live-mode decisions remain separate from local UX recommendations.

## 2. Evidence classification

This synthesis uses five labels:

- **Observed market pattern:** behavior or information hierarchy visible in an official product or help source.
- **Documented provider capability:** a provider's public documentation describes a feature. It does not establish NaviPay access, eligibility, approval, or fit.
- **Provider or organizer claim:** a marketing statement or task assertion requiring direct confirmation.
- **Observed local behavior:** behavior reported by local source inspection, tests, or browser evaluation at a dated revision. Older reports can describe earlier revisions.
- **Recommendation or hypothesis:** a proposed NaviPay choice. It is not an implementation decision.

The research corpus contained overlapping market, UX, backend, discovery, identity, XSGD, card, architecture, E2E, and hackathon reports. They were reconciled rather than concatenated. Older architecture audits describe pre-commerce revisions and are historical where current source and tests show later local capabilities. Test totals differ because reports inspected successive revisions. Current repository behavior and current validation commands take precedence for P0.

## 3. Product position and target experience

### Product thesis

NaviPay's defensible product is a truthful orchestration layer, not a marketplace, bank, card dashboard, or autonomous real-money buyer. Its value is making authority handoffs explicit and recoverable:

- instruction to bounded intent;
- read-only discovery to authoritative quote;
- quote to inventory reservation;
- local funding and mock KYC boundary to authorization;
- scoped one-use capability to local execution;
- capture to ledger, merchant credit, order, fulfillment, delivery, and receipt;
- unknown or partial outcome to a safe reconciliation state.

### Target customer result

The customer should be able to answer, in this order:

1. Did it happen?
2. What item and merchant were involved?
3. What was the exact total?
4. What is the order and delivery state?
5. What can I safely do next?
6. Where is the receipt?

A safe payment label or task-scoped simulated balance is secondary. KYC, funding, MCC, issuer, ledger, webhook, adapter, raw provider, and model details are not customer post-purchase content.

## 4. Market patterns worth borrowing

| Source or pattern | Observed evidence | NaviPay use |
| --- | --- | --- |
| [Amazon Rufus, now Alexa for Shopping](https://www.aboutamazon.com/news/retail/amazon-rufus) | Broad shopping intent can be refined conversationally, compared, and contextualized. | Keep one instruction and add a compact `I understood` line. Do not add a permanent chat shell. |
| [Google Shopping agentic checkout](https://blog.google/products-and-platforms/products/shopping/agentic-checkout-holiday-ai-shopping/) | Structured price, inventory, and comparison views are separated from permission and confirmation of purchase and shipping. | Make candidate comparison structured and keep discovery separate from purchase authority. |
| [Visa Intelligent Commerce](https://www.visa.com/en-us/solutions/intelligent-commerce) and [Trusted Agent Protocol](https://developer.visa.com/capabilities/trusted-agent-protocol/overview) | Agent intent, consumer recognition, permission, scope, authentication, and merchant visibility are treated as trust primitives. | Model a server-owned authorization envelope and reviewer summary. Do not copy Visa branding or claim network access. |
| [Google virtual-card help](https://support.google.com/googlepay/answer/11234179?hl=en) | Virtual card details may differ by merchant or transaction and may require verification. The user-facing concept is a safe payment reference, not a credential reveal. | Show a one-use payment label or masked reference only. Keep PAN/CVV absent. |
| [Shop Help order tracking](https://help.shop.app/en/shop/delivery-tracking/track-orders) | Tracking combines order status, updates, carrier, tracking number, approximate location, and support actions; tracking may be unavailable. | Treat delivery as an operational workspace. Show a next update or explicit unavailable state, never an endless spinner or fake live link. |
| [Apple Shipping and Pickup](https://www.apple.com/shop/help/shipping_delivery) and [Order Status](https://www.apple.com/shop/order/list) | Order acknowledgement, item summary, delivery estimate, tracking, and returns/support are durable post-purchase jobs. | Make the receipt/order card the durable record. Payment internals are secondary. |
| [Google Pay purchase history](https://support.google.com/googlepay/answer/11828789?hl=en) | A transaction or receipt is the place to find more information, support, return, refund, or cancellation paths. | Put safe next actions next to the receipt, only when an owner and route exist. |
| [Afterpay help](https://www.afterpay.com/en-US/help) | Managing orders, returns/refunds, payments, and support are organized as customer jobs. | Borrow order/support hierarchy, not an installment or banking dashboard. |
| Issuer patterns from [Ramp Agent Cards](https://docs.ramp.com/developer-api/v1/agent-cards), [Lithic cards](https://docs.lithic.com/docs/cards), and [Airwallex controls](https://www.airwallex.com/docs/issuing/card-controls/authorization-controls) | Merchant, amount, category, expiry, transaction count, and authorization controls recur across programmable-card products. | Keep these as backend scope fields and reviewer evidence. Use plain customer language such as `one-use payment method`. |

These observations support patterns, not NaviPay capabilities. A source page describing a provider feature does not prove geography, currency, account access, sandbox access, or permission to use that feature for an agent purchase.

## 5. What NaviPay should borrow and reject

### Borrow

- **Purchase contract:** interpreted request, selected item, merchant, total, rationale, simulation state, and next safe action.
- **Structured comparison:** two or three decision-relevant rows only when there is a genuine choice.
- **Permission boundary:** a visible server-owned scope containing purpose, merchant, amount, currency, category, expiry, and one-use policy.
- **Operational receipt:** item, merchant, total, order, fulfillment, delivery, issue time, and safe next action.
- **Lifecycle truth:** separate payment, order, fulfillment, delivery, adjustment, and reconciliation states.
- **Scoped payment reference:** safe label, masked reference, and support-safe reference without credentials.
- **Reviewer proof:** proposal, policy decision, tool fact, local/provider mode, checkpoint, and safe event identities.
- **Known missing states:** tracking unavailable, payment unknown, no order, no receipt, not started, and no match.

### Reject

- Permanent chat as the product shell. It obscures the purchase contract and adds no authority proof.
- A marketplace dashboard, wallet portfolio, or generic banking navigation for a one-purchase P0.
- A single green `payment complete` state that hides authorization, capture, settlement, refund, reversal, or order truth.
- Silent merchant or brand substitution, unlimited replacement cards, or blind retries after unknown payment.
- PAN/CVV panels, model transcripts, raw page text, ledger jargon, MCC, webhook payloads, provider payloads, or KYC documents in Customer mode.
- Amazon scraping, CAPTCHA workarounds, stealth browsing, login automation, or treating product search as checkout permission.
- Provider branding or marketing language as if it were NaviPay access or approval.
- A fake blockchain receipt, testnet token, faucet allocation, organizer points, or mock provider event presented as customer funds.
- A dense operator console in the primary customer path.

## 6. Product critique and current local UX findings

The dated product critique and visual audits observed a credible local sandbox with important browser-level gaps. These findings are local product findings, not live-payment risk claims.

### Strengths to preserve

- Persistent local simulation disclosure at idle and terminal states.
- Receipt-first Customer mode with no raw credentials or provider payloads.
- Separate payment, order, fulfillment, delivery, refund, reversal, and unknown states.
- Server-owned projections, task-owned financial snapshots, and no blind retry for unknown payment.
- Local Developer evidence with mock controls separated from Customer presentation.
- Narrow layouts without horizontal overflow in the reported browser checks.
- Local issuer capability values held in a process-local boundary rather than persisted or projected.

### Findings to carry into the PRD and implementation backlog

| Finding | Evidence class | Product implication |
| --- | --- | --- |
| Payment drawer focus escaped outside a declared modal during repeated Tab presses. | Observed local browser behavior, 2026-08-12 and 2026-08-13 reports. | A payment-adjacent dialog must trap focus, make the background unreachable, and restore focus on close. This is a local accessibility gate. |
| Refund and reversal HTTP routes exist, while the shipped browser had no payment-action controls and a dead listener. | Observed local source and browser behavior. | Keep the surface policy unresolved. Do not infer browser authority from a route. Either add explicit Developer-only actions after a decision or document API-only behavior. |
| Developer mode exposed a long evidence dump with open groups and simulation resources before reviewer proof. | Observed local browser behavior. | Put outcome and four-stage proof first; collapse deep evidence and move scenario controls last. |
| Insufficient funds was truthful but did not explain the safe handoff to simulated top-up and a new purchase. | Observed local browser behavior. | Add a safe handoff or state that recovery is operator-only. Never retry the failed task automatically. |
| Refunded or reversed runs retained a `Purchase confirmed` heading beside a current adjusted payment status. | Observed local browser behavior. | Label immutable history as `Original purchase` and current payment adjustment separately. |
| Idle Payment Summary could read as an empty payment object. | Observed local browser behavior. | Keep the action clearly non-actionable until a task exists, or hide it at idle. |
| Customer mode is a presentation preference, not an access boundary. | Observed source behavior. | Never describe Customer/Developer mode as authentication, role separation, custody, or authorization. |

The critique reports also surfaced local backend follow-ups at their audited revisions, including unknown final-balance presentation, provider-specific KYC/funding secret separation, explicit quantity parsing, actual adapter-result reconciliation, receipt adjustment consistency, reservation expiry, and stale compatibility suites. These are engineering backlog items when still present in current code, not claims that the reports' old revisions describe today's repository.

## 7. Journey and receipt implications

### Idle

One instruction, one run action, one sentence about simulation, and optional read-only product evidence. No wallet dashboard or provider setup.

### Active

Use coarse `Purchase`, `Order`, `Fulfillment`, and `Delivery` language. Add one plain milestone such as `Quote locked`, `Inventory reserved`, or `Waiting for payment confirmation`. Do not expose adapter logs or false percentage completion.

### Ambiguous discovery

Show candidates with item, merchant, variant, total, stock, and match reason. State that nothing has been reserved or paid. Require selection before issuance or payment.

### Completed receipt

The maximum primary surface is:

```text
Purchase complete
Apple Magic Keyboard from Orchard Electronics
Total: XSGD 171.72
Payment: Paid   Order: Confirmed   Delivery: Delivered
[View delivery details] [New purchase]
```

The receipt itself should contain the price breakdown, order reference, issue time, and simulation disclosure. Quote/cart IDs, capture references, ranking rationale, and activity belong in collapsed evidence. Do not show a terminal progress tracker once the result is known.

### Delivery pending or failed

Keep payment and order separate from delivery. Use `Order confirmed` plus `Delivery waiting for an update` or `Purchase confirmed, delivery needs attention`. Do not invent carrier links, support owners, return windows, or refunds.

### Unknown payment

Show the attempted item, merchant, and quoted total, then:

```text
Payment status needs confirmation
No automatic retry will occur.
Order: No order
No receipt was issued.
```

Do not show paid, final balance, confirmed order, delivered delivery, or a confirmed receipt until definitive local or provider truth exists.

### Refund or reversal

The original capture snapshot remains immutable. A current adjustment says refunded or reversed, with net charged and returned amounts. Commerce history, fulfillment, and delivery facts are not silently rewritten.

## 8. Ranked local-safe opportunities

These recommendations are deliberately separate from live/provider decisions.

| Rank | Opportunity | Why it matters | Acceptance signal |
| ---: | --- | --- | --- |
| 1 | Payment drawer accessibility | A declared modal that leaks focus is an accessibility and orientation failure. | Focus remains inside for repeated Tab presses; Escape closes and restores opener focus. |
| 2 | Primary purchase contract | Interpreted request and selection rationale are trust-critical but too easy to miss. | Unique match shows `I understood` and `Why this item`; ambiguity shows comparison before side effects. |
| 3 | Unknown and insufficient-funds handoff | Recovery is safe in the backend but not always discoverable in Customer mode. | Unknown shows no retry; insufficient funds explains a new purchase and any Developer-only local top-up path. |
| 4 | Reviewer hierarchy | Deep evidence and controls compete with proof. | Four stages and outcome appear before collapsed details and scenario controls. |
| 5 | Adjusted receipt language | Original and current payment facts can appear contradictory. | `Original purchase` and current adjustment have distinct labels and values. |
| 6 | Delivery detail | Market tracking patterns make next update and missing tracking explicit. | Local delivery shows simulated provenance and known next state without fake external authority. |
| 7 | Offline local proof | External static assets can weaken a strict local-only network claim. | Browser proof has an explicit static-asset policy and no provider or merchant request. |
| 8 | Local evidence replay | Reviewers benefit from deterministic scenario and checkpoint evidence. | A resettable run produces the same safe outcome without credentials or network. |

## 9. Local recommendations versus live/provider decisions

### Safe to pursue in P0

- Receipt hierarchy, outcome copy, status vocabulary, no-match and unknown-state truth.
- Focus containment, keyboard behavior, reduced motion, no-overflow checks, and accessible live regions.
- Server-owned rationale, quote freshness display, task-scoped balance labels, and safe side-effect summaries.
- Reviewer grouping, collapsed technical evidence, and explicit replay/fallback provenance.
- Local fixtures for ambiguity, insufficient funds, delivery failure, refund, reversal, and restart.
- Provider-neutral contract fixtures and onboarding checklists with no keys or outbound calls.

### Decision-gated

- Any live mode, real account, real money, custody, KYC, card, merchant, delivery, model, provider API, or customer support path.
- StraitsX exact XSGD funding and card settlement. Public documentation and marketing are diligence evidence, not access.
- Airwallex Singapore/SGD as a contrast pilot. SGD is not XSGD and requires an explicit conversion and ledger decision.
- 0xGasless direct x402 on Avalanche Fuji. A separate tiny testnet settlement proof may be considered, but testnet tokens, faucet allocations, and organizer points are not customer funds and must not silently become the local purchase payment.
- Any browser checkout beyond the local gateway, including the meaning of a provider sandbox success.
- Customer/operator roles, unknown-payment actor, refund/reversal browser controls, delivery support, balance authority, and future expansion label `EEB`.

## 10. Source register

Dates are access or research dates recorded by the supplied reports. Provider and product claims remain classified as such.

### Market, agent, and post-purchase sources

- Amazon Rufus, accessed 2026-08-02: <https://www.aboutamazon.com/news/retail/amazon-rufus>
- Google Shopping agentic checkout, published 2025-11-13 and accessed in the research window: <https://blog.google/products-and-platforms/products/shopping/agentic-checkout-holiday-ai-shopping/>
- Visa Intelligent Commerce: <https://www.visa.com/en-us/solutions/intelligent-commerce>
- Visa Trusted Agent Protocol: <https://developer.visa.com/capabilities/trusted-agent-protocol/overview>
- Google Pay virtual cards: <https://support.google.com/googlepay/answer/11234179?hl=en>
- Google Pay purchase history: <https://support.google.com/googlepay/answer/11828789?hl=en>
- Shopify Shop tracking: <https://help.shop.app/en/shop/delivery-tracking/track-orders>
- Shopify Shop order status: <https://help.shop.app/en/shop/delivery-tracking/view-order-status>
- Apple Shipping and Pickup: <https://www.apple.com/shop/help/shipping_delivery>
- Apple Order Status: <https://www.apple.com/shop/order/list>
- Afterpay Help: <https://www.afterpay.com/en-US/help>
- Google Shopping and structured comparison evidence: <https://blog.google/products-and-platforms/products/shopping/agentic-checkout-holiday-ai-shopping/>

### Discovery and commerce boundaries

- Amazon Creators API introduction: <https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction>
- Amazon Creators API onboarding: <https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/register-for-creators-api>
- Amazon SearchItems and OffersV2: <https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items>, <https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/offersV2>
- Amazon Associates policies and agreement: <https://affiliate-program.amazon.com/help/operating/policies>, <https://affiliate-program.amazon.com/help/operating/agreement/>
- eBay Browse API: <https://developer.ebay.com/develop/api/buy/browse_api>
- Shopify Storefront API: <https://shopify.dev/docs/api/storefront>
- Google Merchant API: <https://developers.google.com/merchant/api/overview>
- Playwright: <https://playwright.dev/docs/intro>
- Browser Use: <https://docs.browser-use.com/cloud/quickstart>
- Medusa: <https://github.com/medusajs/medusa>
- Saleor checkout lifecycle: <https://docs.saleor.io/developer/checkout/lifecycle>
- Vendure payment and order concepts: <https://docs.vendure.io/current/core/core-concepts/payment>, <https://docs.vendure.io/current/core/core-concepts/orders>

### Card and payment pattern sources

- Google virtual cards: <https://support.google.com/googlepay/answer/11234179?hl=en>
- Ramp Agent Cards: <https://docs.ramp.com/developer-api/v1/agent-cards>
- Lithic cards: <https://docs.lithic.com/docs/cards>
- Airwallex authorization controls: <https://www.airwallex.com/docs/issuing/card-controls/authorization-controls>
- Stripe virtual cards and controls: <https://docs.stripe.com/issuing/cards/virtual>, <https://docs.stripe.com/issuing/controls/spending-controls>
- StraitsX card platform, provider claim requiring diligence: <https://www.straitsx.com/platform/card-issuance>

### Identity, standards, and network context

- MAS Payment Services Act: <https://www.mas.gov.sg/regulation/acts/payment-services-act>
- MAS Notice PSN02: <https://www.mas.gov.sg/regulation/notices/psn02-notice-on-prevention-of-money-laundering-and-countering-the-financing-of-terrorism>
- FATF Recommendations: <https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html>
- FATF virtual-asset guidance: <https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-vasps.html>
- FATF Travel Rule: <https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Travel-rule.html>
- Avalanche Primary Network: <https://build.avax.network/docs/primary-network>
- Avalanche C-Chain RPC: <https://build.avax.network/docs/rpcs/c-chain>

## 11. How to use this reference

Use this document to make local UX and product decisions, not to infer provider access. Before changing the purchase experience, read [the PRD](../prd.md), classify the evidence, and check the current architecture and tests. A recommendation may be implemented locally only when it preserves the current simulation disclosure, server authority, task-owned financial truth, redaction, idempotency, and no-blind-retry rules.
