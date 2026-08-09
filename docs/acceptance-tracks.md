# NaviPay acceptance tracks

NaviPay remains one local application with one server-owned task projection. The tracks below describe separate acceptance lenses, not separate products or data models.

## Shared contract

- Purchase runs use the existing `POST /api/purchases/run` path and persisted task projection.
- Customer outcome, next actions, receipt facts, payment state, order, fulfillment, and delivery remain shared canonical facts.
- The presentation preference is stored as `navipay.presentation-mode` in the browser only. A fresh browser defaults to `customer`.
- The mode switch changes presentation only. It is not authentication, authorization, payment approval, custody, or a security boundary.
- Developer evidence comes from the existing safe task projection, audit route, wallet read model, and read-only reviewer projection. It must never include credentials, PAN, CVV, private keys, secrets, or raw provider payloads.

## Track 1: customer mode

Customer mode is the default and the primary launch path.

Acceptance focus:

- One plain request and one calm result.
- Visible simulation boundary: `Simulation only. No real money, order, or delivery is used.`
- Four lifecycle boundaries during active work: `Purchase`, `Order`, `Fulfillment`, and `Delivery`.
- Terminal result foregrounds outcome, item, merchant, exact total, payment/order/delivery status, receipt, and next useful action.
- Technical evidence remains secondary, collapsed, or absent from the customer presentation.
- Unknown payment says no automatic retry and does not claim a paid receipt or confirmed order.
- Delivery failure keeps payment and order confirmed while delivery needs attention.
- No PAN, CVV, private key, raw provider payload, MCC, ledger, webhook, issuer detail, or operation identifier is exposed in customer content.

Primary browser selectors:

- `[data-presentation-mode="customer"]`
- `.receipt-panel`
- `.receipt-status-row`
- `.terminal-disclosure`

## Track 2: developer mode

Developer mode presents the same run with safe, read-only evidence for local review.

Acceptance focus:

- The selected mode is obvious through the accessible `aria-pressed` mode controls.
- The same task and receipt remain visible rather than a second app or dashboard appearing.
- Evidence includes interpreted request, candidates and rationale, quote freshness, inventory reservation, funding and mock KYC boundary, authorization, payment and issuer state, order/fulfillment/delivery records, safe references, reconciliation and replay state, activity, and simulation provenance.
- Evidence is server-owned and redacted. Local fixtures are clearly labelled as simulation and never presented as live providers.
- Switching back to customer mode removes developer evidence without changing the task or projection.
- A refresh safely preserves the browser presentation preference when browser storage is available.

Primary browser selectors:

- `[data-presentation-mode="developer"]`
- `.developer-evidence`
- `.developer-lifecycle`
- `.developer-group`

## Track 3: market-research-informed implementation

This track validates the information architecture decisions from the NaviPay research and visual audits without adding a marketplace, permanent chat shell, live-money mode, or provider integration.

Acceptance focus:

- Discovery, quote, reservation, payment, order, fulfillment, delivery, receipt, and evidence remain separate boundaries.
- Active progress uses the four customer-facing lifecycle labels and plain milestones.
- Completed customer work has one canonical receipt/order card plus its outcome banner. The terminal tracker and duplicate purchase summaries are not rendered.
- The payment drawer stays secondary and exposes only safe payment context and task-scoped balance.
- No-match, over-budget, out-of-stock, declined, processing, unknown-payment, delivery-pending, delivery-failure, refund, and reversal states remain truthful.
- The simulation disclosure stays visible without making backend vocabulary the primary experience.
- Desktop and narrow layouts have no horizontal overflow and preserve the same task-owned facts after reload.

The executable coverage for all three tracks is split between `test/acceptance-tracks.test.js`, the supporting contract tests in `test/frontend.test.js`, the public UI assertions in `scripts/browser-e2e-runner.js`, and the shared projection and lifecycle tests under `test/`.

## Validation commands

```text
npm test
npm run check
npm run test:ui
```
