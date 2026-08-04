const crypto = require('node:crypto');
const { AdapterError } = require('./adapters');
const { createConfiguredDiscoveryAdapter, DISCOVERY_SOURCE, DISCOVERY_RANKING_POLICY, PlaywrightDiscoveryAdapter, isExplicitlyAllowlistedUrl, normalizeTargetUrl, selectClearWinner } = require('./playwright-discovery');
const { CURRENCY } = require('./domain');
const { LocalFakeIssuerAdapter } = require('./issuer');
const { LocalCheckoutWorker } = require('./checkout-worker');

const SANDBOX_MODE = 'simulated local sandbox';
const DEFAULT_ADAPTER_TIMEOUT_MS = 5000;
const TASK_CEILING_MINOR = 100000;
const DEMO_WALLET = Object.freeze({
  id: 'wallet-demo-customer',
  name: 'NaviPay Demo Wallet',
  ownerName: 'Demo Customer',
  currency: CURRENCY,
  initialBalanceMinor: 50000
});
const DEMO_CUSTOMER = Object.freeze({
  id: 'customer-demo',
  name: 'Demo Customer',
  address: {
    label: 'Fixture delivery address',
    lines: ['123 Orchard Road', '#04-01', 'Singapore 238888'],
    country: 'Singapore'
  },
  disclosure: 'Simulated customer and fixture address - replaceable local demo data.'
});
const SANDBOX_SCENARIOS = new Set([
  'happy',
  'insufficient-funds',
  'payment-decline',
  'unknown-payment',
  'order-failure',
  'delivery-failure',
  'fulfillment-failure',
  'out-of-stock',
  'merchant-credit-failure',
  'funding-failure',
  'discovery-failure',
  'decline',
  'merchant-decline',
  'checkout-failure',
  'unknown',
  'unknown-checkout',
  'checkout-unknown',
  'capture-unknown',
  'timeout',
  'checkout-timeout',
  'wrong-merchant',
  'mcc-mismatch',
  'currency-mismatch',
  'amount-overage',
  'overage',
  'expired-card',
  'duplicate',
  'refund',
  'reversal',
  'browser-crash',
  'worker-cleanup',
  'legacy-direct-wallet'
]);

const CATALOG = Object.freeze([
  {
    merchantId: 'merchant-harbor-supply',
    merchant: 'Harbor Supply',
    merchantDomain: 'harbor-supply.local',
    sku: 'sku-logitech-mx-keys-mini',
    variantId: 'variant-wireless-compact',
    brand: 'Logitech',
    productCategory: 'keyboards',
    item: 'Logitech MX Keys Mini',
    variant: 'Wireless compact keyboard',
    priceMinor: 12900,
    shippingMinor: 350,
    taxMinor: 1060,
    quantity: 5,
    keywords: ['logitech', 'keyboard', 'keyboards', 'wireless', 'compact']
  },
  {
    merchantId: 'merchant-orchard-electronics',
    merchant: 'Orchard Electronics',
    merchantDomain: 'orchard-electronics.local',
    sku: 'sku-apple-magic-keyboard',
    variantId: 'variant-usb-c-rechargeable',
    brand: 'Apple',
    productCategory: 'keyboards',
    item: 'Apple Magic Keyboard',
    variant: 'Wireless keyboard with USB-C charging',
    priceMinor: 15900,
    shippingMinor: 0,
    taxMinor: 1272,
    quantity: 3,
    keywords: ['apple', 'magic', 'keyboard', 'keyboards', 'wireless']
  },
  {
    merchantId: 'merchant-circuit-market',
    merchant: 'Circuit Market',
    merchantDomain: 'circuit-market.local',
    sku: 'sku-keychron-k2',
    variantId: 'variant-hot-swap',
    brand: 'Keychron',
    productCategory: 'keyboards',
    item: 'Keychron K2',
    variant: 'Hot-swap mechanical keyboard',
    priceMinor: 14900,
    shippingMinor: 450,
    taxMinor: 1228,
    quantity: 2,
    keywords: ['keychron', 'keyboard', 'keyboards', 'mechanical', 'wireless']
  },
  {
    merchantId: 'merchant-harbor-supply',
    merchant: 'Harbor Supply',
    merchantDomain: 'harbor-supply.local',
    sku: 'sku-logitech-mx-master-3s',
    variantId: 'variant-graphite',
    brand: 'Logitech',
    productCategory: 'mice',
    item: 'Logitech MX Master 3S',
    variant: 'Wireless ergonomic mouse, graphite',
    priceMinor: 10900,
    shippingMinor: 350,
    taxMinor: 900,
    quantity: 4,
    keywords: ['logitech', 'mouse', 'mice', 'wireless', 'ergonomic']
  },
  {
    merchantId: 'merchant-circuit-market',
    merchant: 'Circuit Market',
    merchantDomain: 'circuit-market.local',
    sku: 'sku-razer-deathadder-v3',
    variantId: 'variant-wired-black',
    brand: 'Razer',
    productCategory: 'mice',
    item: 'Razer DeathAdder V3',
    variant: 'Wired gaming mouse',
    priceMinor: 8900,
    shippingMinor: 350,
    taxMinor: 740,
    quantity: 0,
    keywords: ['razer', 'mouse', 'mice', 'gaming', 'wired']
  },
  {
    merchantId: 'merchant-orchard-electronics',
    merchant: 'Orchard Electronics',
    merchantDomain: 'orchard-electronics.local',
    sku: 'sku-apple-airpods-4',
    variantId: 'variant-usbc-anc',
    brand: 'Apple',
    productCategory: 'earphones',
    item: 'Apple AirPods 4',
    variant: 'Active Noise Cancellation, USB-C case',
    priceMinor: 22900,
    shippingMinor: 0,
    taxMinor: 1832,
    quantity: 4,
    keywords: ['apple', 'airpods', 'earphone', 'earphones', 'earbuds', 'wireless', 'bluetooth']
  },
  {
    merchantId: 'merchant-audio-corner',
    merchant: 'Audio Corner',
    merchantDomain: 'audio-corner.local',
    sku: 'sku-sony-wf-c700n',
    variantId: 'variant-noise-cancel',
    brand: 'Sony',
    productCategory: 'earphones',
    item: 'Sony WF-C700N',
    variant: 'Noise cancelling wireless earbuds',
    priceMinor: 11900,
    shippingMinor: 350,
    taxMinor: 980,
    quantity: 3,
    keywords: ['sony', 'earphone', 'earphones', 'earbuds', 'wireless', 'noise']
  }
]);

const STOP_WORDS = new Set(['a', 'an', 'and', 'buy', 'for', 'get', 'i', 'like', 'me', 'my', 'of', 'please', 'some', 'the', 'to', 'want', 'would']);
const CATEGORY_ALIASES = [
  ['keyboards', ['keyboard', 'keyboards']],
  ['mice', ['mouse', 'mice']],
  ['earphones', ['earphone', 'earphones', 'earbud', 'earbuds', 'headphone', 'headphones', 'airpods']]
];
const BRAND_ALIASES = [
  ['Logitech', ['logitech']],
  ['Keychron', ['keychron']],
  ['Razer', ['razer']],
  ['Apple', ['apple']],
  ['Sony', ['sony']]
];

function normalizeWords(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-SG').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function cleanAliases(entries) {
  return entries.map(([canonical, aliases]) => [canonical, aliases]);
}

function parseRequest(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 240 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AdapterError('INVALID_PURCHASE_REQUEST', 'Purchase request must be plain text between 1 and 240 characters.');
  }
  const raw = value.trim();
  const words = normalizeWords(raw);
  const text = words.join(' ');
  const brand = cleanAliases(BRAND_ALIASES).find(([, aliases]) => aliases.some((alias) => words.includes(alias)))?.[0] || null;
  const category = cleanAliases(CATEGORY_ALIASES).find(([, aliases]) => aliases.some((alias) => text.includes(alias)))?.[0] || null;
  const keywords = [...new Set(words.filter((word) => !STOP_WORDS.has(word)))];
  if (!keywords.length) throw new AdapterError('INVALID_PURCHASE_REQUEST', 'Purchase request must include an item keyword.');
  return {
    normalized: words.join(' '),
    brand,
    productCategory: category,
    keywords
  };
}

function stableReference(prefix, input) {
  return `${prefix}-${crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 12).toUpperCase()}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now(clock) {
  return clock().toISOString();
}

function money(minor, currency = CURRENCY) {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

function inventoryKey(candidate) {
  return `${candidate.merchantId}:${candidate.sku}:${candidate.variantId}`;
}

function operationId(taskId, stage) {
  return `op_${taskId}_${stage}`;
}

function stageTemplate() {
  return ['intent', 'discovery', 'quote', 'inventory', 'funding', 'payment', 'merchant_credit', 'order', 'fulfillment', 'delivery', 'receipt', 'audit']
    .map((stage) => ({ stage, status: 'pending', operationId: null, reference: null, detail: null, startedAt: null, completedAt: null }));
}

function stage(task, name) {
  return task.progress.find((item) => item.stage === name);
}

function categoryFromLegacyIntent(intent) {
  if (intent?.productCategory === 'keyboards' || intent?.productCategory === 'mice' || intent?.productCategory === 'earphones') return intent.productCategory;
  return null;
}

class SandboxDomainError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = 'SandboxDomainError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Canonical local adapter: request interpretation and catalog discovery. */
class LocalDiscoveryAdapter {
  constructor({ clock = () => new Date(), catalog = CATALOG, timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS } = {}) {
    this.clock = clock;
    this.catalog = catalog;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  discover({ request, scenario = 'happy' } = {}) {
    this.calls += 1;
    if (scenario === 'discovery-failure') throw new AdapterError('DISCOVERY_UNAVAILABLE', 'The simulated merchant sandbox is unavailable.');
    const discoveredAt = now(this.clock);
    const intent = request.intent;
    const category = categoryFromLegacyIntent(intent);
    const words = new Set(intent?.keywords || []);
    const candidates = this.catalog
      .map((entry, index) => {
        const brandMatch = Boolean(intent?.brand && intent.brand.toLowerCase() === entry.brand.toLowerCase());
        const categoryMatch = Boolean(category && category === entry.productCategory);
        const matches = entry.keywords.filter((keyword) => words.has(keyword));
        let relevanceScore = categoryMatch ? 100 : 0;
        if (brandMatch) relevanceScore += 50;
        relevanceScore += matches.length * 5;
        if (!relevanceScore) return null;
        const forcedOutOfStock = scenario === 'out-of-stock';
        const stockQuantity = forcedOutOfStock ? 0 : entry.quantity;
        const totalMinor = entry.priceMinor + entry.shippingMinor + entry.taxMinor;
        return {
          id: `candidate-${entry.sku}`,
          merchantId: entry.merchantId,
          merchant: entry.merchant,
          merchantDomain: entry.merchantDomain,
          sku: entry.sku,
          variantId: entry.variantId,
          brand: entry.brand,
          productCategory: entry.productCategory,
          item: entry.item,
          variant: entry.variant,
          mcc: entry.mcc || '5732',
          subtotalMinor: entry.priceMinor,
          shippingMinor: entry.shippingMinor,
          taxMinor: entry.taxMinor,
          totalMinor,
          currency: CURRENCY,
          availability: stockQuantity > 0 ? 'in_stock' : 'out_of_stock',
          stockQuantity,
          relevanceScore,
          matchReasons: [
            ...(brandMatch ? [`Brand match: ${entry.brand}`] : []),
            ...(categoryMatch ? [`Category match: ${entry.productCategory}`] : []),
            ...(matches.length ? [`Keyword matches: ${matches.join(', ')}`] : [])
          ],
          quoteExpiresAt: new Date(this.clock().getTime() + 15 * 60 * 1000).toISOString(),
          evidence: {
            type: 'local-catalog-fixture',
            source: 'NaviPay seeded merchant sandbox',
            catalogId: entry.sku,
            observedAt: discoveredAt,
            note: 'SIMULATED local catalog result - not a live merchant feed.'
          },
          _catalogOrder: index
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.relevanceScore - left.relevanceScore || left._catalogOrder - right._catalogOrder)
      .map(({ _catalogOrder, ...candidate }) => candidate);
    if (!candidates.length) throw new AdapterError('NO_LOCAL_MATCHES', 'The local merchant sandbox has no keyboard, mouse, or earphone match for that request.');
    return {
      mode: SANDBOX_MODE,
      source: 'NaviPay seeded merchant sandbox',
      discoveredAt,
      intent,
      candidates,
      recommendedCandidateId: candidates[0].id,
      rankingPolicy: 'Seeded catalog policy: category match, brand match, keyword matches, then stable catalog order.'
    };
  }
}

/** Canonical funding boundary: a read-only lookup of the spendable fake wallet. */
class LocalFundingAdapter {
  constructor({ store, clock = () => new Date(), timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS } = {}) {
    this.store = store;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  verify({ walletId = DEMO_WALLET.id, scenario = 'happy' } = {}) {
    this.calls += 1;
    const wallet = this.store.data.wallets[walletId];
    if (!wallet || scenario === 'funding-failure') throw new AdapterError('FUNDING_UNAVAILABLE', 'The simulated wallet balance could not be verified.');
    return {
      mode: SANDBOX_MODE,
      status: 'verified',
      walletId: wallet.id,
      walletName: wallet.name,
      ownerName: wallet.ownerName,
      chainEvidence: {
        status: 'verified',
        network: 'Avalanche Fuji fixture',
        asset: CURRENCY,
        amountMinor: 185000,
        transactionReference: '0xfixture-funding-7f31',
        observedAt: now(this.clock),
        note: 'Separate simulated chain observation. It is not the spendable wallet balance.'
      },
      currency: wallet.currency,
      balanceMinor: wallet.balanceMinor,
      observedAt: now(this.clock)
    };
  }
}

/** Canonical inventory boundary with lease, commit, release, and replay semantics. */
class LocalInventoryAdapter {
  constructor({ store, clock = () => new Date(), timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS } = {}) {
    this.store = store;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.calls = { reserve: 0, commit: 0, release: 0 };
  }

  reserve({ operationId: opId, taskId, candidate, scenario = 'happy' }) {
    this.calls.reserve += 1;
    return this.store.transaction((data) => {
      const existing = data.reservations[opId];
      if (existing) return clone(existing);
      const key = inventoryKey(candidate);
      const inventory = data.inventory[key];
      const reference = stableReference('INV-LEASE', opId);
      if (!inventory || scenario === 'out-of-stock' || inventory.availableQuantity < 1) {
        const declined = { operationId: opId, taskId, status: 'declined', code: 'OUT_OF_STOCK', reference, quantity: 1, inventoryKey: key, createdAt: now(this.clock) };
        data.reservations[opId] = declined;
        return clone(declined);
      }
      inventory.availableQuantity -= 1;
      inventory.reservedQuantity += 1;
      const reservation = {
        operationId: opId,
        taskId,
        status: 'reserved',
        reference,
        inventoryKey: key,
        merchantId: candidate.merchantId,
        sku: candidate.sku,
        variantId: candidate.variantId,
        quantity: 1,
        leaseExpiresAt: new Date(this.clock().getTime() + 10 * 60 * 1000).toISOString(),
        createdAt: now(this.clock),
        committedAt: null,
        releasedAt: null
      };
      data.reservations[opId] = reservation;
      return clone(reservation);
    });
  }

  commit({ operationId: opId, reservationReference }) {
    this.calls.commit += 1;
    return this.store.transaction((data) => {
      const reservation = data.reservations[opId];
      if (!reservation || reservation.reference !== reservationReference) throw new AdapterError('RESERVATION_NOT_FOUND', 'The inventory reservation could not be committed.');
      if (reservation.status === 'committed') return clone(reservation);
      if (reservation.status !== 'reserved') throw new AdapterError('RESERVATION_NOT_COMMITTABLE', 'The inventory reservation is not active.');
      if (Date.parse(reservation.leaseExpiresAt) <= this.clock().getTime()) {
        const inventory = data.inventory[reservation.inventoryKey];
        inventory.availableQuantity += reservation.quantity;
        inventory.reservedQuantity -= reservation.quantity;
        reservation.status = 'expired';
        reservation.releaseReason = 'lease_expired';
        reservation.releasedAt = now(this.clock);
        return clone(reservation);
      }
      const inventory = data.inventory[reservation.inventoryKey];
      inventory.reservedQuantity -= reservation.quantity;
      reservation.status = 'committed';
      reservation.committedAt = now(this.clock);
      return clone(reservation);
    });
  }

  release({ operationId: opId, reservationReference, reason = 'compensation' }) {
    this.calls.release += 1;
    return this.store.transaction((data) => {
      const reservation = data.reservations[opId];
      if (!reservation || reservation.reference !== reservationReference) throw new AdapterError('RESERVATION_NOT_FOUND', 'The inventory reservation could not be released.');
      if (reservation.status === 'released' || reservation.status === 'declined' || reservation.status === 'expired') return clone(reservation);
      if (reservation.status === 'committed') throw new AdapterError('RESERVATION_ALREADY_COMMITTED', 'Committed inventory cannot be released.');
      const inventory = data.inventory[reservation.inventoryKey];
      inventory.availableQuantity += reservation.quantity;
      inventory.reservedQuantity -= reservation.quantity;
      reservation.status = 'released';
      reservation.releaseReason = reason;
      reservation.releasedAt = now(this.clock);
      return clone(reservation);
    });
  }
}

/** Canonical funding-transfer boundary. The two ledger legs are written atomically. */
class LocalWalletTransferAdapter {
  constructor({ store, clock = () => new Date(), timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS } = {}) {
    this.store = store;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.calls = { transfer: 0, resolve: 0, compensate: 0 };
  }

  _applyTransfer(data, { opId, taskId, walletId, merchantId, amountMinor, currency, reference, kind = 'payment' }) {
    const wallet = data.wallets[walletId];
    if (!wallet || wallet.currency !== currency) return { status: 'declined', code: 'WALLET_NOT_FOUND', reference };
    if (wallet.balanceMinor < amountMinor) return { status: 'declined', code: 'INSUFFICIENT_FUNDS', reference };
    const merchantAccount = `merchant:${merchantId}`;
    const merchantBalance = data.merchantBalances[merchantId] || 0;
    const transactionReference = stableReference('LEDGER-TX', `${opId}:${kind}`);
    const timestamp = now(this.clock);
    const balanceBeforeMinor = wallet.balanceMinor;
    wallet.balanceMinor -= amountMinor;
    data.merchantBalances[merchantId] = merchantBalance + amountMinor;
    data.walletLedger.push(
      { id: `${transactionReference}:debit`, transactionReference, operationId: opId, taskId, kind, entry: 'debit', accountId: walletId, amountMinor, currency, occurredAt: timestamp },
      { id: `${transactionReference}:credit`, transactionReference, operationId: opId, taskId, kind, entry: 'credit', accountId: merchantAccount, amountMinor, currency, occurredAt: timestamp }
    );
    return { status: 'authorized', reference, transactionReference, walletBalanceMinor: wallet.balanceMinor, balanceBeforeMinor, balanceAfterPaymentMinor: wallet.balanceMinor, merchantBalanceMinor: data.merchantBalances[merchantId], occurredAt: timestamp };
  }

  transfer({ operationId: opId, taskId, walletId, merchantId, amountMinor, currency, scenario = 'happy' }) {
    this.calls.transfer += 1;
    return this.store.transaction((data) => {
      const existing = data.walletTransfers[opId];
      if (existing) return clone(existing);
      const reference = stableReference('WALLET-OP', opId);
      const balanceBeforeMinor = data.wallets[walletId]?.balanceMinor ?? null;
      if (scenario === 'payment-decline' || scenario === 'insufficient-funds') {
        const declined = { operationId: opId, taskId, status: 'declined', code: scenario === 'insufficient-funds' ? 'INSUFFICIENT_FUNDS' : 'PAYMENT_DECLINED', reference, amountMinor, currency, balanceBeforeMinor, balanceAfterPaymentMinor: null, occurredAt: now(this.clock) };
        data.walletTransfers[opId] = declined;
        return clone(declined);
      }
      if (scenario === 'unknown-payment') {
        const unknown = { operationId: opId, taskId, status: 'unknown', code: 'PAYMENT_UNKNOWN', reference, amountMinor, currency, balanceBeforeMinor, balanceAfterPaymentMinor: null, occurredAt: now(this.clock), message: 'The simulated wallet did not return a definitive transfer result.' };
        data.walletTransfers[opId] = unknown;
        return clone(unknown);
      }
      const result = this._applyTransfer(data, { opId, taskId, walletId, merchantId, amountMinor, currency, reference });
      const transfer = { operationId: opId, taskId, ...result, amountMinor, currency, walletId, merchantId };
      data.walletTransfers[opId] = transfer;
      return clone(transfer);
    });
  }

  captureForIssuer({ operationId: opId, taskId, walletId, merchantId, amountMinor, currency, scenario = 'happy' }) {
    return this.store.transaction((data) => {
      const existing = data.walletTransfers[opId];
      if (existing) return clone(existing);
      const reference = stableReference('ISSUER-PAYMENT', opId);
      const balanceBeforeMinor = data.wallets[walletId]?.balanceMinor ?? null;
      if (scenario === 'payment-decline' || scenario === 'decline' || scenario === 'merchant-decline' || scenario === 'checkout-failure') {
        const declined = { operationId: opId, taskId, status: 'declined', code: 'PAYMENT_DECLINED', reference, amountMinor, currency, balanceBeforeMinor, balanceAfterPaymentMinor: null, occurredAt: now(this.clock), paymentMode: 'issuer_authorization' };
        data.walletTransfers[opId] = declined;
        return clone(declined);
      }
      if (scenario === 'insufficient-funds') {
        const declined = { operationId: opId, taskId, status: 'declined', code: 'INSUFFICIENT_FUNDS', reference, amountMinor, currency, balanceBeforeMinor, balanceAfterPaymentMinor: null, occurredAt: now(this.clock), paymentMode: 'issuer_authorization' };
        data.walletTransfers[opId] = declined;
        return clone(declined);
      }
      if (['unknown-payment', 'unknown', 'unknown-checkout', 'checkout-unknown', 'capture-unknown', 'timeout', 'checkout-timeout'].includes(scenario)) {
        const unknown = { operationId: opId, taskId, status: 'unknown', code: scenario === 'timeout' ? 'CAPTURE_TIMEOUT' : 'PAYMENT_UNKNOWN', reference, amountMinor, currency, balanceBeforeMinor, balanceAfterPaymentMinor: null, occurredAt: now(this.clock), message: scenario === 'timeout' ? 'The local gateway timed out before capture was confirmed.' : 'The local gateway did not return a definitive capture result.', paymentMode: 'issuer_authorization' };
        data.walletTransfers[opId] = unknown;
        return clone(unknown);
      }
      const result = this._applyTransfer(data, { opId, taskId, walletId, merchantId, amountMinor, currency, reference });
      const transfer = { operationId: opId, taskId, ...result, amountMinor, currency, walletId, merchantId, paymentMode: 'issuer_authorization' };
      data.walletTransfers[opId] = transfer;
      return clone(transfer);
    });
  }

  resolveUnknown({ operationId: opId, taskId, walletId, merchantId, amountMinor, currency, resolution }) {
    this.calls.resolve += 1;
    return this.store.transaction((data) => {
      const existing = data.walletTransfers[opId];
      if (!existing || existing.status !== 'unknown') throw new AdapterError('PAYMENT_NOT_RECONCILABLE', 'No unknown wallet transfer is awaiting reconciliation.');
      if (resolution === 'declined') {
        existing.status = 'declined';
        existing.code = 'PAYMENT_DECLINED_RECONCILED';
        existing.balanceAfterPaymentMinor = null;
        existing.finalBalanceMinor = data.wallets[walletId]?.balanceMinor ?? null;
        existing.resolvedAt = now(this.clock);
        return clone(existing);
      }
      if (resolution !== 'authorized') throw new AdapterError('INVALID_PAYMENT_RESOLUTION', 'Payment resolution must be authorized or declined.');
      const result = this._applyTransfer(data, { opId, taskId, walletId, merchantId, amountMinor, currency, reference: existing.reference });
      const transfer = { ...existing, ...result, status: result.status === 'authorized' ? 'authorized' : result.status, resolvedAt: now(this.clock) };
      data.walletTransfers[opId] = transfer;
      return clone(transfer);
    });
  }

  compensate({ operationId: originalOpId, taskId, walletId, merchantId, amountMinor, currency }) {
    this.calls.compensate += 1;
    const opId = `${originalOpId}:compensation`;
    return this.store.transaction((data) => {
      const existing = data.walletTransfers[opId];
      if (existing) return clone(existing);
      const wallet = data.wallets[walletId];
      const merchantBalance = data.merchantBalances[merchantId] || 0;
      const reference = stableReference('WALLET-REFUND', opId);
      if (!wallet || merchantBalance < amountMinor) {
        const failed = { operationId: opId, taskId, status: 'failed', code: 'COMPENSATION_FAILED', reference, amountMinor, currency, occurredAt: now(this.clock) };
        data.walletTransfers[opId] = failed;
        return clone(failed);
      }
      const transactionReference = stableReference('LEDGER-TX', opId);
      const timestamp = now(this.clock);
      wallet.balanceMinor += amountMinor;
      data.merchantBalances[merchantId] = merchantBalance - amountMinor;
      data.walletLedger.push(
        { id: `${transactionReference}:debit`, transactionReference, operationId: opId, taskId, kind: 'compensation', entry: 'debit', accountId: `merchant:${merchantId}`, amountMinor, currency, occurredAt: timestamp },
        { id: `${transactionReference}:credit`, transactionReference, operationId: opId, taskId, kind: 'compensation', entry: 'credit', accountId: walletId, amountMinor, currency, occurredAt: timestamp }
      );
      const compensated = { operationId: opId, taskId, status: 'compensated', code: 'PAYMENT_COMPENSATED', reference, transactionReference, amountMinor, currency, balanceBeforeMinor: wallet.balanceMinor - amountMinor, balanceAfterPaymentMinor: wallet.balanceMinor - amountMinor, finalBalanceMinor: wallet.balanceMinor, walletBalanceMinor: wallet.balanceMinor, occurredAt: timestamp };
      data.walletTransfers[opId] = compensated;
      return clone(compensated);
    });
  }

  lookup(operationIdValue) {
    return clone(this.store.data.walletTransfers[operationIdValue] || null);
  }
}

/** Canonical merchant checkout boundary: confirms that the merchant received the ledger credit. */
class LocalMerchantCreditAdapter {
  constructor({ store, clock = () => new Date(), timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS } = {}) {
    this.store = store;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  confirm({ operationId: opId, taskId, transferReference, merchantId, amountMinor, currency, scenario = 'happy' }) {
    this.calls += 1;
    return this.store.transaction((data) => {
      if (data.merchantCredits[opId]) return clone(data.merchantCredits[opId]);
      const transfer = data.walletTransfers[`${opId.replace(/:merchant-credit$/, '')}`] || Object.values(data.walletTransfers).find((item) => item.taskId === taskId && item.reference === transferReference);
      if (!transfer || transfer.status !== 'authorized') throw new AdapterError('MERCHANT_CREDIT_MISSING', 'The merchant credit was not confirmed by the local wallet ledger.');
      if (scenario === 'merchant-credit-failure') {
        const failed = { operationId: opId, taskId, status: 'failed', code: 'MERCHANT_CREDIT_FAILED', reference: stableReference('MERCHANT-CREDIT', opId), amountMinor, currency, occurredAt: now(this.clock) };
        data.merchantCredits[opId] = failed;
        return clone(failed);
      }
      const credit = { operationId: opId, taskId, status: 'confirmed', reference: stableReference('MERCHANT-CREDIT', opId), transferReference, merchantId, amountMinor, currency, occurredAt: now(this.clock) };
      data.merchantCredits[opId] = credit;
      return clone(credit);
    });
  }
}

/** Persisted local issuer lifecycle. Credential values stay in its process-local capability map. */
class LocalIssuerAdapter extends LocalFakeIssuerAdapter {}

/** Merchant checkout is implemented below the issuer boundary and never debits the wallet directly. */
class LocalMerchantCheckoutAdapter extends LocalMerchantCreditAdapter {
  constructor({ store, clock = () => new Date(), issuer, walletAdapter, timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS } = {}) {
    super({ store, clock, timeoutMs });
    this.issuer = issuer;
    this.walletAdapter = walletAdapter;
    this.worker = new LocalCheckoutWorker({ store, clock });
    this.checkoutCalls = 0;
  }

  execute(args = {}) {
    const { taskId, cardId } = args;
    const sessionId = stableReference('CHECKOUT', args.operationId || taskId);
    const existing = this.store.data.checkoutSessions[sessionId];
    if (existing?.result) return clone(existing.result);
    return this.worker.run({
      taskId,
      operationId: `op_${taskId}_checkout_worker`,
      credentialCapability: cardId,
      action: () => this.issuer.withCredential(cardId, (credential) => this._executeGateway({ ...args, credential }))
    });
  }

  _executeGateway({ operationId: opId, taskId, cardId, scope, scenario = 'happy' } = {}) {
    this.checkoutCalls += 1;
    const sessionId = stableReference('CHECKOUT', opId || taskId);
    const session = this.store.data.checkoutSessions[sessionId];
    if (session?.result) return clone(session.result);
    const submittedAt = now(this.clock);
    this.store.transaction((data) => {
      data.checkoutSessions[sessionId] = { sessionId, taskId, status: 'submitted', merchantDomain: scope.merchantDomain, amountMinor: scope.amountMinor, currency: scope.currency, product: { sku: scope.sku, item: scope.item, variant: scope.variant }, cart: { quantity: 1, totalMinor: scope.amountMinor, currency: scope.currency }, delivery: { addressLabel: scope.delivery?.address?.label || 'Fixture delivery address', country: scope.delivery?.address?.country || 'Singapore' }, card: { status: 'injected_in_isolated_capability' }, submittedAt, profileStatus: 'isolated' };
      data.checkoutWebhooks.push({ id: stableReference('WEBHOOK', `${sessionId}:submitted`), sessionId, type: 'checkout.submitted', status: 'received', occurredAt: submittedAt });
    });
    if (scenario === 'browser-crash') throw new AdapterError('CHECKOUT_WORKER_CRASHED', 'The isolated checkout worker stopped before submitting a result.');
    const submittedMerchant = scenario === 'wrong-merchant' ? `${scope.merchantDomain}.wrong` : scope.merchantDomain;
    const submittedAmount = ['amount-overage', 'overage'].includes(scenario) ? scope.amountMinor + 1 : scope.amountMinor;
    const submittedCurrency = scenario === 'currency-mismatch' ? 'USD' : scope.currency;
    const submittedMcc = scenario === 'mcc-mismatch' ? '5999' : scope.mcc;
    const authorization = this.issuer.authorize({ operationId: `op_${taskId}_card_authorize`, taskId, cardId, merchantId: scope.merchantId, merchantDomain: submittedMerchant, amountMinor: submittedAmount, currency: submittedCurrency, mcc: submittedMcc, scenario });
    if (authorization.status !== 'authorized') {
      const declined = { mode: SANDBOX_MODE, status: 'declined', code: authorization.code, merchantDomain: submittedMerchant, amountMinor: submittedAmount, currency: submittedCurrency, attemptedAt: submittedAt, checkoutReference: sessionId, authorizationReference: authorization.authorizationReference, captureReference: null, reason: authorization.code === 'CARD_EXPIRED' ? 'The disposable card expired before checkout.' : authorization.code === 'WRONG_MERCHANT' ? 'The merchant did not match the one-use card scope.' : authorization.code === 'AMOUNT_EXCEEDS_SCOPE' ? 'The checkout amount exceeded the one-use card scope.' : 'The local issuer declined the checkout.' };
      this._finishSession(sessionId, declined, 'checkout.declined');
      return declined;
    }
    const capture = this.issuer.capture({ operationId: `op_${taskId}_card_capture`, taskId, cardId, authorizationReference: authorization.authorizationReference, walletId: scope.walletId, merchantId: scope.merchantId, amountMinor: scope.amountMinor, currency: scope.currency, scenario });
    if (capture.status === 'unknown') {
      const unknown = { mode: SANDBOX_MODE, status: 'unknown', code: capture.code, merchantDomain: scope.merchantDomain, amountMinor: scope.amountMinor, currency: scope.currency, attemptedAt: submittedAt, checkoutReference: sessionId, authorizationReference: authorization.authorizationReference, captureReference: capture.captureReference, message: capture.message || 'The local gateway did not return a definitive capture result.' };
      this._finishSession(sessionId, unknown, 'checkout.unknown');
      return unknown;
    }
    if (capture.status !== 'captured') {
      const declined = { mode: SANDBOX_MODE, status: 'declined', code: capture.code, merchantDomain: scope.merchantDomain, amountMinor: scope.amountMinor, currency: scope.currency, attemptedAt: submittedAt, checkoutReference: sessionId, authorizationReference: authorization.authorizationReference, captureReference: capture.captureReference, reason: capture.code === 'INSUFFICIENT_FUNDS' ? 'The fake wallet has insufficient XSGD balance.' : 'The issuer capture was declined.' };
      this._finishSession(sessionId, declined, 'checkout.declined');
      return declined;
    }
    const result = { mode: SANDBOX_MODE, status: 'authorized', merchantDomain: scope.merchantDomain, amountMinor: scope.amountMinor, currency: scope.currency, attemptedAt: submittedAt, checkoutReference: sessionId, authorizationReference: authorization.authorizationReference, captureReference: capture.captureReference, capturedAt: capture.capturedAt, payment: capture.payment };
    this._finishSession(sessionId, result, 'checkout.captured');
    return result;
  }

  _finishSession(sessionId, result, webhookType) {
    this.store.transaction((data) => {
      const session = data.checkoutSessions[sessionId];
      if (!session) return;
      session.status = result.status;
      session.result = clone(result);
      session.completedAt = now(this.clock);
      data.checkoutWebhooks.push({ id: stableReference('WEBHOOK', `${sessionId}:${webhookType}`), sessionId, type: webhookType, status: 'received', occurredAt: session.completedAt, reference: result.checkoutReference || null });
    });
  }

  status(sessionId) {
    return clone(this.store.data.checkoutSessions[sessionId] || null);
  }

  webhookFixtures({ sessionId = null } = {}) {
    return clone(this.store.data.checkoutWebhooks.filter((event) => !sessionId || event.sessionId === sessionId));
  }

  refund({ taskId, cardId, walletId, merchantId, amountMinor, currency, kind = 'refund' }) {
    const result = this.issuer.refund({ operationId: `op_${taskId}_card_${kind}`, taskId, cardId, walletId, merchantId, amountMinor, currency, kind });
    this.store.transaction((data) => {
      data.checkoutWebhooks.push({ id: stableReference('WEBHOOK', result.operationId), sessionId: stableReference('CHECKOUT', taskId), type: kind === 'reversal' ? 'payment.reversed' : 'payment.refunded', status: 'received', occurredAt: result.occurredAt, reference: result.reference });
    });
    return result;
  }
}

/** Canonical order boundary. Order creation is idempotent and only accepts reserved stock plus payment. */
class LocalOrderAdapter {
  constructor({ store, clock = () => new Date(), timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS } = {}) {
    this.store = store;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  create({ operationId: opId, taskId, customer, candidate, reservation, payment, scenario = 'happy' }) {
    this.calls += 1;
    return this.store.transaction((data) => {
      if (data.orders[opId]) return clone(data.orders[opId]);
      const reference = stableReference('ORDER', opId);
      if (scenario === 'order-failure') {
        const failed = { operationId: opId, taskId, status: 'failed', code: 'ORDER_CREATION_FAILED', reference, occurredAt: now(this.clock), message: 'The simulated merchant order service failed safely.' };
        data.orders[opId] = failed;
        return clone(failed);
      }
      if (reservation.status !== 'reserved' || payment.status !== 'authorized') throw new AdapterError('ORDER_PREREQUISITES_MISSING', 'An order requires active reserved inventory and confirmed payment.');
      const order = {
        operationId: opId,
        taskId,
        status: 'confirmed',
        reference,
        merchantId: candidate.merchantId,
        merchant: candidate.merchant,
        sku: candidate.sku,
        variantId: candidate.variantId,
        item: candidate.item,
        variant: candidate.variant,
        amountMinor: candidate.totalMinor,
        currency: candidate.currency,
        paymentReference: payment.reference,
        reservationReference: reservation.reference,
        customer: clone(customer),
        fulfillmentStatus: 'pending',
        deliveryStatus: 'pending',
        createdAt: now(this.clock)
      };
      data.orders[opId] = order;
      return clone(order);
    });
  }

  lookup(operationIdValue) {
    return clone(this.store.data.orders[operationIdValue] || null);
  }
}

/** Canonical fulfillment boundary. Fulfillment status is independent from payment. */
class LocalFulfillmentAdapter {
  constructor({ store, clock = () => new Date(), timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS } = {}) {
    this.store = store;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  fulfill({ operationId: opId, orderReference, scenario = 'happy' }) {
    this.calls += 1;
    return this.store.transaction((data) => {
      const existing = data.operations[opId]?.result;
      if (existing) return clone(existing);
      const result = scenario === 'fulfillment-failure'
        ? { status: 'failed', reference: stableReference('FULFILL', opId), code: 'FULFILLMENT_FAILED', message: 'The simulated merchant fulfillment queue failed.' }
        : { status: 'fulfilled', reference: stableReference('FULFILL', opId), carrier: 'Simulated local carrier', shippedAt: now(this.clock) };
      const order = Object.values(data.orders).find((candidate) => candidate.reference === orderReference);
      if (order) order.fulfillmentStatus = result.status;
      data.operations[opId] = { ...(data.operations[opId] || {}), id: opId, stage: 'fulfillment', status: result.status, result: clone(result), reference: result.reference, updatedAt: now(this.clock) };
      return clone(result);
    });
  }
}

/** Canonical delivery boundary. A delivery failure never changes confirmed payment or order. */
class LocalDeliveryAdapter {
  constructor({ store, clock = () => new Date(), timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS } = {}) {
    this.store = store;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  deliver({ operationId: opId, orderReference, customer, scenario = 'happy' }) {
    this.calls += 1;
    return this.store.transaction((data) => {
      const existing = data.deliveries[opId];
      if (existing) return clone(existing);
      const failed = scenario === 'delivery-failure';
      const result = {
        operationId: opId,
        status: failed ? 'failed' : 'delivered',
        reference: stableReference('DELIVERY', opId),
        orderReference,
        addressLabel: customer.address.label,
        trackingReference: stableReference('TRACK', orderReference),
        deliveredAt: failed ? null : now(this.clock),
        attemptedAt: now(this.clock),
        message: failed ? 'The simulated carrier could not deliver to the fixture address.' : 'Simulated delivery completed to the fixture address.',
        code: failed ? 'DELIVERY_FAILED' : null
      };
      data.deliveries[opId] = result;
      const order = Object.values(data.orders).find((candidate) => candidate.reference === orderReference);
      if (order) order.deliveryStatus = result.status;
      return clone(result);
    });
  }
}

function seedSandbox(store) {
  store.transaction((data) => {
    if (!data.wallets[DEMO_WALLET.id]) {
      data.wallets[DEMO_WALLET.id] = {
        id: DEMO_WALLET.id,
        name: DEMO_WALLET.name,
        ownerName: DEMO_WALLET.ownerName,
        currency: DEMO_WALLET.currency,
        initialBalanceMinor: DEMO_WALLET.initialBalanceMinor,
        balanceMinor: DEMO_WALLET.initialBalanceMinor,
        status: 'active',
        mode: SANDBOX_MODE
      };
    }
    for (const entry of CATALOG) {
      const key = inventoryKey(entry);
      if (!data.inventory[key]) {
        data.inventory[key] = {
          key,
          merchantId: entry.merchantId,
          merchant: entry.merchant,
          sku: entry.sku,
          variantId: entry.variantId,
          item: entry.item,
          quantity: entry.quantity,
          availableQuantity: entry.quantity,
          reservedQuantity: 0
        };
      }
      if (data.merchantBalances[entry.merchantId] === undefined) data.merchantBalances[entry.merchantId] = 0;
    }
  });
}

function publicWallet(wallet) {
  return {
    id: wallet.id,
    name: wallet.name,
    ownerName: wallet.ownerName,
    currency: wallet.currency,
    balanceMinor: wallet.balanceMinor,
    initialBalanceMinor: wallet.initialBalanceMinor,
    status: wallet.status,
    mode: wallet.mode,
    disclosure: 'Seeded fake wallet balance. No real funds or custody are involved.'
  };
}

const TASK_PROJECTION_VERSION = 1;

function safeCandidate(candidate, { sourceAllowlist = [] } = {}) {
  if (!candidate) return null;
  let safeSourceUrl = null;
  if (candidate.sourceUrl || candidate.evidence?.sourceUrl) {
    const value = candidate.sourceUrl || candidate.evidence.sourceUrl;
    if (isExplicitlyAllowlistedUrl(value, sourceAllowlist)) safeSourceUrl = new URL(value).toString();
  }
  return {
    id: candidate.id,
    merchant: candidate.merchant,
    merchantDomain: candidate.merchantDomain,
    merchantId: candidate.merchantId,
    sku: candidate.sku,
    variantId: candidate.variantId,
    item: candidate.item,
    variant: candidate.variant,
    mcc: candidate.mcc || '5732',
    brand: candidate.brand,
    productCategory: candidate.productCategory,
    subtotalMinor: candidate.subtotalMinor,
    shippingMinor: candidate.shippingMinor,
    taxMinor: candidate.taxMinor,
    totalMinor: candidate.totalMinor,
    currency: candidate.currency,
    availability: candidate.availability,
    stockQuantity: candidate.stockQuantity,
    observedAt: candidate.observedAt || candidate.evidence?.observedAt || null,
    relevanceScore: candidate.relevanceScore,
    confidence: candidate.confidence ?? null,
    matchReasons: Array.isArray(candidate.matchReasons) ? [...candidate.matchReasons] : [],
    quoteExpiresAt: candidate.quoteExpiresAt,
    sourceUrl: safeSourceUrl,
    evidence: candidate.evidence ? {
      type: candidate.evidence.type,
      source: candidate.evidence.source,
      observedAt: candidate.evidence.observedAt || null,
      sourceUrl: safeSourceUrl,
      note: candidate.evidence.note
    } : null
  };
}

function safeReference(value) {
  return value || null;
}

function projectOperation(operation) {
  if (!operation) return null;
  return {
    id: operation.id,
    taskId: operation.taskId,
    stage: operation.stage,
    status: operation.status,
    code: operation.code || null,
    reference: safeReference(operation.reference),
    attempts: operation.attempts || 0,
    startedAt: operation.startedAt || null,
    completedAt: operation.completedAt || null,
    updatedAt: operation.updatedAt || null
  };
}

function projectAuditEvent(event) {
  return {
    id: event.id,
    taskId: event.taskId,
    occurredAt: event.occurredAt,
    type: event.type,
    status: event.status,
    summary: event.summary,
    operationId: safeReference(event.operationId),
    reference: safeReference(event.reference)
  };
}

function projectFinancial(task, walletBalanceMinor = null) {
  const financial = task.financial || {};
  const payment = task.payment || {};
  const compensation = task.compensation || financial.compensation || null;
  const finalBalanceMinor = financial.finalBalanceMinor ?? walletBalanceMinor;
  return {
    version: 1,
    currency: task.currency,
    amountMinor: financial.amountMinor ?? task.quote?.totalMinor ?? null,
    balanceBeforeMinor: financial.balanceBeforeMinor ?? payment.balanceBeforeMinor ?? null,
    balanceAfterPaymentMinor: financial.balanceAfterPaymentMinor ?? payment.balanceAfterPaymentMinor ?? null,
    finalBalanceMinor,
    netChargedMinor: financial.netChargedMinor ?? (financial.balanceBeforeMinor != null && finalBalanceMinor != null ? financial.balanceBeforeMinor - finalBalanceMinor : null),
    compensation: compensation ? {
      status: compensation.status,
      amountMinor: compensation.amountMinor || 0,
      reference: safeReference(compensation.reference),
      transactionReference: safeReference(compensation.transactionReference),
      occurredAt: compensation.occurredAt || null
    } : { status: 'not_required', amountMinor: 0, reference: null, transactionReference: null, occurredAt: null },
    outcome: financial.outcome || (payment.status === 'authorized' ? 'authorized' : payment.status || 'pending')
  };
}

function projectTask(task, { operations = {}, auditEvents = [], walletBalanceMinor = null, sourceAllowlist = [] } = {}) {
  const candidates = (task.quote?.candidates || []).map((candidate) => safeCandidate(candidate, { sourceAllowlist }));
  const selected = safeCandidate(task.quote?.lockedSnapshot, { sourceAllowlist }) || candidates.find((candidate) => candidate.id === task.quote?.selectedCandidateId) || null;
  const browserDiscovery = task.quote?.mode === 'read-only Playwright fixture';
  const discoveryUnavailable = task.quote?.discoveryStatus?.status === 'unavailable';
  const discovery = task.quote ? {
    source: discoveryUnavailable ? DISCOVERY_SOURCE.FALLBACK : browserDiscovery ? DISCOVERY_SOURCE.BROWSER_FIXTURE : DISCOVERY_SOURCE.SEEDED_CATALOG,
    status: discoveryUnavailable ? 'unavailable' : browserDiscovery ? 'available' : 'available',
    label: discoveryUnavailable ? 'Seeded catalog fallback' : browserDiscovery ? 'Local browser fixture' : 'Seeded catalog',
    explanation: discoveryUnavailable
      ? `${task.quote.discoveryStatus?.message || 'Browser discovery was unavailable.'} NaviPay used its seeded local catalog instead.`
      : browserDiscovery
        ? task.quote.recommendationOnly
          ? 'A read-only local browser fixture recommended this item. Select it to cross-check the authoritative quote before purchase.'
          : 'Read-only browser evidence was selected and matched to the authoritative local quote before purchase.'
        : 'NaviPay matched this request against its seeded local merchant catalog.',
    recommendationOnly: Boolean(task.quote.recommendationOnly),
    fallback: discoveryUnavailable ? 'seeded_catalog' : null,
    targetSite: task.targetSite ? { status: task.targetSite.status } : { status: 'not_requested' }
  } : null;
  const reservation = task.inventory?.reservation;
  const quote = task.quote ? {
    status: task.quote.locked ? 'locked' : 'open',
    source: discovery?.label || null,
    recommendationOnly: Boolean(task.quote.recommendationOnly),
    discoveryStatus: task.quote.discoveryStatus || { status: 'available', code: null, message: null },
    rankingPolicy: task.quote.rankingPolicy || (browserDiscovery ? DISCOVERY_RANKING_POLICY : 'Seeded catalog policy: category match, brand match, keyword matches, then stable catalog order.'),
    merchantId: task.quote.merchantId || selected?.merchantId || null,
    merchantDomain: task.quote.merchantDomain || selected?.merchantDomain || null,
    mcc: task.quote.mcc || selected?.mcc || '5732',
    merchant: task.quote.merchant || selected?.merchant || null,
    item: task.quote.item || selected?.item || null,
    variant: task.quote.variant || selected?.variant || null,
    subtotalMinor: selected?.subtotalMinor ?? null,
    shippingMinor: selected?.shippingMinor ?? null,
    taxMinor: selected?.taxMinor ?? null,
    totalMinor: task.quote.totalMinor ?? selected?.totalMinor ?? null,
    currency: task.quote.currency || selected?.currency || task.currency,
    expiresAt: selected?.quoteExpiresAt || null,
    selectedCandidateId: task.quote.selectedCandidateId || null,
    candidates,
    recommendation: task.recommendation ? {
      status: task.recommendation.status,
      candidateId: task.recommendation.candidateId,
      reason: task.recommendation.reason,
      autoSelectable: Boolean(task.recommendation.autoSelectable),
      evidence: selected?.matchReasons || []
    } : null
  } : null;
  const safePayment = task.payment ? {
    status: task.payment.status,
    code: task.payment.code || null,
    amountMinor: task.payment.amountMinor || quote?.totalMinor || null,
    currency: task.payment.currency || task.currency,
    reference: safeReference(task.payment.reference),
    transactionReference: safeReference(task.payment.transactionReference),
    authorizationReference: safeReference(task.payment.authorizationReference),
    captureReference: safeReference(task.payment.captureReference),
    paymentMode: task.payment.paymentMode || task.paymentMode || 'issuer_authorization',
    occurredAt: task.payment.occurredAt || null,
    resolvedAt: task.payment.resolvedAt || null,
    balanceBeforeMinor: task.payment.balanceBeforeMinor ?? null,
    balanceAfterPaymentMinor: task.payment.balanceAfterPaymentMinor ?? null
  } : { status: 'pending', code: null, amountMinor: quote?.totalMinor || null, currency: task.currency, reference: null, transactionReference: null, occurredAt: null, resolvedAt: null, balanceBeforeMinor: null, balanceAfterPaymentMinor: null };
  return {
    version: TASK_PROJECTION_VERSION,
    taskId: task.id,
    mode: task.mode,
    disclosure: 'SIMULATED ONLY - fake wallet, seeded catalog, local order, and fixture delivery. No real funds moved.',
    state: task.state,
    lifecycle: Array.isArray(task.lifecycle) ? task.lifecycle.map((entry) => ({ state: entry.state, at: entry.at })) : [],
    purchaseStatus: task.purchaseStatus,
    paymentMode: task.paymentMode || 'issuer_authorization',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    nextAction: task.automation?.nextAction || 'none',
    request: {
      raw: task.request?.raw || '',
      interpreted: task.request?.intent ? {
        normalized: task.request.intent.normalized,
        brand: task.request.intent.brand,
        productCategory: task.request.intent.productCategory,
        keywords: task.request.intent.keywords
      } : null
    },
    recommendation: quote?.recommendation || null,
    discovery,
    quote,
    inventory: task.inventory ? {
      status: task.inventory.status,
      reservation: reservation ? {
        status: reservation.status,
        quantity: reservation.quantity,
        leaseExpiresAt: reservation.leaseExpiresAt || null,
        reference: safeReference(reservation.reference),
        releasedAt: reservation.releasedAt || null,
        committedAt: reservation.committedAt || null
      } : null
    } : { status: 'not_started', reservation: null },
    wallet: task.wallet ? {
      currency: task.wallet.currency,
      balanceBeforeMinor: task.financial?.balanceBeforeMinor ?? task.wallet.balanceMinor,
      balanceAfterPaymentMinor: task.financial?.balanceAfterPaymentMinor ?? null,
      finalBalanceMinor: task.financial?.finalBalanceMinor ?? walletBalanceMinor ?? task.wallet.balanceAfterMinor ?? null
    } : null,
    financial: projectFinancial(task, walletBalanceMinor),
    card: task.card ? {
      status: task.card.status,
      reference: safeReference(task.card.reference),
      lastFour: task.card.lastFour || String(task.card.reference || '').slice(-4),
      maskedReference: task.card.maskedReference || `•••• ${String(task.card.reference || '').slice(-4)}`,
      issuedAt: task.card.issuedAt || null,
      retiredAt: task.card.retiredAt || null,
      captureCount: task.card.captureCount || 0,
      maxCaptures: task.card.scope?.maxCaptures || 1,
      scope: task.card.scope ? { merchantId: task.card.scope.merchantId, merchantDomain: task.card.scope.merchantDomain, amountMinor: task.card.scope.amountMinor, currency: task.card.scope.currency, mcc: task.card.scope.mcc, expiresAt: task.card.scope.expiresAt } : null
    } : { status: 'not_issued', reference: null, maskedReference: null },
    checkout: task.checkout ? { status: task.checkout.status, code: task.checkout.code || null, checkoutReference: safeReference(task.checkout.checkoutReference), authorizationReference: safeReference(task.checkout.authorizationReference), captureReference: safeReference(task.checkout.captureReference), attemptedAt: task.checkout.attemptedAt || null, capturedAt: task.checkout.capturedAt || null, merchantDomain: task.checkout.merchantDomain || null, amountMinor: task.checkout.amountMinor || null, currency: task.checkout.currency || task.currency } : { status: 'not_started', checkoutReference: null },
    checkoutWorker: task.checkoutWorker ? { status: task.checkoutWorker.status, profile: task.checkoutWorker.profile, cleanup: task.checkoutWorker.cleanup } : { status: 'not_started', profile: null, cleanup: null },
    payment: safePayment,
    merchantCredit: task.merchantCredit ? {
      status: task.merchantCredit.status,
      code: task.merchantCredit.code || null,
      amountMinor: task.merchantCredit.amountMinor || null,
      currency: task.merchantCredit.currency || task.currency,
      reference: safeReference(task.merchantCredit.reference),
      transferReference: safeReference(task.merchantCredit.transferReference),
      occurredAt: task.merchantCredit.occurredAt || null
    } : { status: 'pending', reference: null },
    order: task.order ? {
      status: task.order.status,
      reference: safeReference(task.order.reference),
      merchant: task.order.merchant,
      item: task.order.item,
      variant: task.order.variant,
      fulfillmentStatus: task.order.fulfillmentStatus,
      deliveryStatus: task.order.deliveryStatus,
      createdAt: task.order.createdAt || null
    } : { status: 'not_started', reference: null },
    fulfillment: { status: task.fulfillment?.status || 'pending', reference: safeReference(task.fulfillment?.reference), code: task.fulfillment?.code || null, shippedAt: task.fulfillment?.shippedAt || null },
    delivery: { status: task.delivery?.status || 'pending', reference: safeReference(task.delivery?.reference), trackingReference: safeReference(task.delivery?.trackingReference), attemptedAt: task.delivery?.attemptedAt || null, deliveredAt: task.delivery?.deliveredAt || null, code: task.delivery?.code || null },
    funding: task.funding ? {
      status: 'verified',
      asset: task.currency,
      chain: task.funding.network || null,
      evidenceReference: safeReference(task.funding.transactionReference),
      observedAt: task.funding.observedAt || null
    } : { status: 'not_started' },
    customer: task.customer ? { name: task.customer.name, addressLabel: task.customer.address?.label || null, disclosure: task.customer.disclosure } : null,
    receipt: task.receipt ? {
      status: task.receipt.status,
      id: safeReference(task.receipt.id),
      item: task.receipt.item,
      amountMinor: task.receipt.amountMinor,
      currency: task.receipt.currency,
      orderReference: safeReference(task.receipt.orderReference),
      authorizationReference: safeReference(task.receipt.authorizationReference),
      captureReference: safeReference(task.receipt.captureReference),
      fulfillmentStatus: task.receipt.fulfillmentStatus,
      deliveryStatus: task.receipt.deliveryStatus,
      issuedAt: task.receipt.issuedAt,
      disclosure: task.receipt.disclosure
    } : null,
    progress: (task.progress || []).map((item) => ({ stage: item.stage, status: item.status, reference: safeReference(item.reference), detail: item.detail, startedAt: item.startedAt, completedAt: item.completedAt })),
    failure: task.failure ? { stage: task.failure.stage, code: task.failure.code, message: task.failure.message } : null,
    operations: Object.values(operations).filter((operation) => operation.taskId === task.id).map(projectOperation),
    timeline: auditEvents.filter((event) => event.taskId === task.id).map(projectAuditEvent)
  };
}

class NaviPaySandboxService {
  constructor({ store, clock = () => new Date(), adapters = {} } = {}) {
    if (!store) throw new Error('A store is required for the local sandbox.');
    this.kind = 'sandbox';
    this.store = store;
    this.clock = clock;
    seedSandbox(store);
    const localDiscovery = new LocalDiscoveryAdapter({ clock });
    this.localDiscoveryAdapter = localDiscovery;
    this.discoveryAdapter = adapters.discovery || createConfiguredDiscoveryAdapter({ clock, fallback: localDiscovery, catalog: CATALOG });
    this.fundingAdapter = adapters.funding || new LocalFundingAdapter({ store, clock });
    this.inventoryAdapter = adapters.inventory || new LocalInventoryAdapter({ store, clock });
    this.walletAdapter = adapters.wallet || new LocalWalletTransferAdapter({ store, clock });
    this.issuerAdapter = adapters.issuer || new LocalIssuerAdapter({ store, clock, walletAdapter: this.walletAdapter });
    this.merchantCheckoutAdapter = adapters.merchantCheckout || adapters.merchantCredit || new LocalMerchantCheckoutAdapter({ store, clock, issuer: this.issuerAdapter, walletAdapter: this.walletAdapter });
    this.merchantCreditAdapter = this.merchantCheckoutAdapter;
    this.orderAdapter = adapters.order || new LocalOrderAdapter({ store, clock });
    this.fulfillmentAdapter = adapters.fulfillment || new LocalFulfillmentAdapter({ store, clock });
    this.deliveryAdapter = adapters.delivery || new LocalDeliveryAdapter({ store, clock });
  }

  _audit(data, taskId, type, status, summary, details = {}) {
    const event = {
      id: stableReference('AUDIT', `${taskId}:${data.auditEvents.length}:${type}`),
      taskId,
      occurredAt: now(this.clock),
      type,
      status,
      summary,
      operationId: details.operationId || null,
      reference: details.reference || null,
      details
    };
    data.auditEvents.push(event);
    return event;
  }

  _updateTask(taskId, mutator) {
    return this.store.transaction((data) => {
      const task = data.tasks[taskId];
      if (!task) throw new SandboxDomainError(404, 'TASK_NOT_FOUND', 'That purchase does not exist.');
      mutator(task, data);
      task.updatedAt = now(this.clock);
      return clone(task);
    });
  }

  _transition(taskId, nextState, type = null, summary = null, details = {}) {
    return this.store.transaction((data) => {
      const task = data.tasks[taskId];
      if (!task) throw new SandboxDomainError(404, 'TASK_NOT_FOUND', 'That purchase does not exist.');
      if (task.state !== nextState) {
        task.state = nextState;
        task.lifecycle = Array.isArray(task.lifecycle) ? task.lifecycle : [];
        task.lifecycle.push({ state: nextState, at: now(this.clock) });
      }
      if (details.operationId) {
        data.operations[details.operationId] = { ...(data.operations[details.operationId] || {}), id: details.operationId, taskId, stage: nextState, status: details.status || 'completed', reference: details.reference || null, completedAt: now(this.clock) };
      }
      if (type) this._audit(data, taskId, type, details.status || 'info', summary || nextState, details);
      task.updatedAt = now(this.clock);
      return clone(task);
    });
  }

  _setProgress(taskId, stageName, status, patch = {}) {
    return this._updateTask(taskId, (task) => {
      const item = stage(task, stageName);
      if (!item) return;
      item.status = status;
      Object.assign(item, patch);
      if (status === 'running' && !item.startedAt) item.startedAt = now(this.clock);
      if (['completed', 'failed', 'unknown', 'skipped'].includes(status)) item.completedAt = item.completedAt || now(this.clock);
    });
  }

  _begin(taskId, stageName) {
    const opId = operationId(taskId, stageName);
    this.store.transaction((data) => {
      const task = data.tasks[taskId];
      if (!task) throw new SandboxDomainError(404, 'TASK_NOT_FOUND', 'That purchase does not exist.');
      const item = stage(task, stageName);
      if (item && item.status === 'pending') {
        item.status = 'running';
        item.startedAt = now(this.clock);
      }
      item.operationId = opId;
      if (!data.operations[opId]) data.operations[opId] = { id: opId, taskId, stage: stageName, status: 'started', startedAt: now(this.clock), attempts: 0 };
      data.operations[opId].attempts += 1;
      task.updatedAt = now(this.clock);
    });
    return opId;
  }

  _complete(taskId, stageName, result, reference = null) {
    const opId = operationId(taskId, stageName);
    this.store.transaction((data) => {
      const task = data.tasks[taskId];
      const item = stage(task, stageName);
      if (item) {
        item.status = 'completed';
        item.reference = reference || result?.reference || result?.transactionReference || null;
        item.detail = result?.status || 'completed';
        item.completedAt = now(this.clock);
      }
      data.operations[opId] = { ...(data.operations[opId] || {}), id: opId, taskId, stage: stageName, status: 'completed', reference: reference || result?.reference || result?.transactionReference || null, result: result ? clone(result) : null, completedAt: now(this.clock) };
      task.updatedAt = now(this.clock);
    });
  }

  _fail(taskId, stageName, code, message, details = {}) {
    this.store.transaction((data) => {
      const task = data.tasks[taskId];
      const opId = operationId(taskId, stageName);
      task.state = 'failed';
      task.failure = { stage: stageName, code, message };
      task.automation = { ...task.automation, status: 'stopped', nextAction: 'Review the recorded result. No blind retry was attempted.', completedAt: now(this.clock) };
      const item = stage(task, stageName);
      if (item) {
        item.status = 'failed';
        item.detail = code;
        item.completedAt = now(this.clock);
      }
      data.operations[opId] = { ...(data.operations[opId] || {}), id: opId, taskId, stage: stageName, status: 'failed', code, message, updatedAt: now(this.clock) };
      this._audit(data, taskId, `${stageName}.failed`, 'error', message, { operationId: opId, code, ...details });
      task.updatedAt = now(this.clock);
    });
  }

  _response(taskId, statusCode = 200, replayed = false) {
    const task = this.getTask(taskId);
    const runStatus = task.automation.status;
    const projection = this.getTaskProjection(taskId);
    return { statusCode, body: { task, projection, discovery: this.getDiscoveryProjection(), run: { status: runStatus, nextAction: task.automation.nextAction, automatic: task.automation.automatic }, replayed } };
  }

  _targetSiteRecord(targetSite) {
    if (targetSite === undefined || targetSite === null || (typeof targetSite === 'string' && !targetSite.trim())) return null;
    let url;
    try {
      url = normalizeTargetUrl(targetSite);
    } catch (error) {
      throw new SandboxDomainError(422, error.code || 'INVALID_TARGET_SITE', error.message);
    }
    const approved = isExplicitlyAllowlistedUrl(url, this.discoveryAdapter.allowlist || []);
    return { status: approved ? 'approved' : 'blocked', url: approved ? url : null };
  }

  createTask({ request, targetSite = undefined, targetUrl = undefined, scenario = 'happy', origin = 'operator', replayOf = null, paymentMode = 'issuer_authorization' } = {}) {
    if (!SANDBOX_SCENARIOS.has(scenario)) throw new SandboxDomainError(400, 'INVALID_SCENARIO', `Unknown sandbox scenario: ${scenario}.`);
    const targetSiteRecord = this._targetSiteRecord(targetSite === undefined ? targetUrl : targetSite);
    let raw;
    let intent;
    try {
      raw = typeof request === 'string' ? request.trim() : '';
      intent = parseRequest(raw);
    } catch (error) {
      throw new SandboxDomainError(422, error.code || 'INVALID_PURCHASE_REQUEST', error.message);
    }
    const createdAt = now(this.clock);
    const task = {
      id: `purchase_${crypto.randomUUID()}`,
      createdAt,
      updatedAt: createdAt,
      origin,
      replayOf,
      scenario,
      mode: SANDBOX_MODE,
      paymentMode: paymentMode === 'legacy_direct_wallet' ? 'legacy_direct_wallet' : 'issuer_authorization',
      currency: CURRENCY,
      spendingCeilingMinor: TASK_CEILING_MINOR,
      customer: clone(DEMO_CUSTOMER),
      targetSite: targetSiteRecord,
      walletId: DEMO_WALLET.id,
      request: { raw, intent },
      state: 'created',
      purchaseStatus: 'pending',
      recommendation: null,
      quote: null,
      inventory: null,
      funding: null,
      wallet: null,
      card: null,
      issuer: null,
      checkout: null,
      checkoutWorker: null,
      lifecycle: [{ state: 'created', at: createdAt }],
      financial: {
        version: 1,
        amountMinor: null,
        balanceBeforeMinor: null,
        balanceAfterPaymentMinor: null,
        finalBalanceMinor: null,
        netChargedMinor: null,
        compensation: { status: 'not_required', amountMinor: 0, reference: null, transactionReference: null, occurredAt: null },
        outcome: 'pending'
      },
      payment: null,
      merchantCredit: null,
      order: null,
      fulfillment: { status: 'pending' },
      delivery: { status: 'pending' },
      compensation: null,
      receipt: null,
      failure: null,
      progress: stageTemplate(),
      automation: { status: 'not_started', automatic: true, startedAt: null, completedAt: null, nextAction: 'Run purchase to begin the simulated purchase.' }
    };
    this.store.transaction((data) => {
      data.tasks[task.id] = task;
      this._audit(data, task.id, 'purchase.created', 'info', 'Simulated purchase request recorded.', { operationId: operationId(task.id, 'intent'), request: raw, customer: DEMO_CUSTOMER.name });
    });
    return clone(task);
  }

  listTasks() {
    return Object.values(this.store.data.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone);
  }

  getTask(taskId) {
    const task = this.store.data.tasks[taskId];
    if (!task) throw new SandboxDomainError(404, 'TASK_NOT_FOUND', 'That purchase does not exist.');
    return clone(task);
  }

  getAudit(taskId) {
    if (!this.store.data.tasks[taskId]) throw new SandboxDomainError(404, 'TASK_NOT_FOUND', 'That purchase does not exist.');
    return this.store.data.auditEvents.filter((event) => event.taskId === taskId).map(projectAuditEvent);
  }

  getTaskProjection(taskId) {
    const task = this.store.data.tasks[taskId];
    if (!task) throw new SandboxDomainError(404, 'TASK_NOT_FOUND', 'That purchase does not exist.');
    return projectTask(task, {
      operations: this.store.data.operations,
      auditEvents: this.store.data.auditEvents,
      walletBalanceMinor: this.store.data.wallets[task.walletId]?.balanceMinor ?? null,
      sourceAllowlist: this.discoveryAdapter.allowlist || []
    });
  }

  getReceipt(taskId) {
    const task = this.getTask(taskId);
    if (!task.receipt) throw new SandboxDomainError(404, 'RECEIPT_NOT_READY', 'The purchase has no confirmed receipt yet.');
    return {
      ...task.receipt,
      customer: task.receipt.customer ? {
        name: task.receipt.customer.name,
        addressLabel: task.receipt.customer.address?.label || null,
        disclosure: task.receipt.customer.disclosure
      } : null
    };
  }

  getDiscoveryProjection() {
    if (typeof this.discoveryAdapter.getProjection === 'function') return clone(this.discoveryAdapter.getProjection());
    return {
      version: 1,
      mode: DISCOVERY_SOURCE.SEEDED_CATALOG,
      status: 'disabled',
      label: 'Seeded catalog',
      explanation: 'NaviPay is using its seeded local merchant catalog.',
      enabled: false,
      readOnly: true,
      recommendationOnly: false,
      fallback: { enabled: true, source: DISCOVERY_SOURCE.SEEDED_CATALOG, label: 'Seeded catalog' }
    };
  }

  getWallet() {
    return publicWallet(this.store.data.wallets[DEMO_WALLET.id]);
  }

  getCatalog() {
    return CATALOG.map((entry) => {
      const stock = this.store.data.inventory[inventoryKey(entry)];
      return { merchantId: entry.merchantId, merchant: entry.merchant, merchantDomain: entry.merchantDomain, mcc: entry.mcc || '5732', sku: entry.sku, variantId: entry.variantId, brand: entry.brand, productCategory: entry.productCategory, item: entry.item, variant: entry.variant, totalMinor: entry.priceMinor + entry.shippingMinor + entry.taxMinor, currency: CURRENCY, availableQuantity: stock?.availableQuantity || 0, mode: SANDBOX_MODE };
    });
  }

  _blockedTargetFallback(task) {
    const local = this.localDiscoveryAdapter.discover({ request: task.request, scenario: task.scenario === 'discovery-failure' ? 'happy' : task.scenario });
    const source = 'NaviPay seeded merchant sandbox (MOCK FALLBACK - discovery unavailable)';
    return {
      ...local,
      mode: SANDBOX_MODE,
      source,
      discoveryStatus: { status: 'unavailable', code: 'DISCOVERY_DOMAIN_BLOCKED', message: 'That target site is not on NaviPay\'s approved discovery allowlist.' },
      candidates: local.candidates.map((candidate) => ({ ...candidate, evidence: { ...candidate.evidence, source, note: 'MOCK FALLBACK fixture; the blocked target site was never fetched.' } }))
    };
  }

  _recordStageAudit(taskId, stageName, type, status, summary, result) {
    this.store.transaction((data) => {
      this._audit(data, taskId, type, status, summary, { operationId: operationId(taskId, stageName), reference: result?.reference || result?.transactionReference || null, status: result?.status || null });
    });
  }

  _updateFinancial(taskId, { payment = null, compensation = null, outcome = null } = {}) {
    this.store.transaction((data) => {
      const task = data.tasks[taskId];
      if (!task) return;
      const walletBalanceMinor = data.wallets[task.walletId]?.balanceMinor ?? null;
      const current = task.financial || { version: 1, amountMinor: task.quote?.totalMinor ?? null, balanceBeforeMinor: null, balanceAfterPaymentMinor: null, finalBalanceMinor: null, netChargedMinor: null, compensation: null, outcome: 'pending' };
      const nextPayment = payment || task.payment;
      const balanceBeforeMinor = current.balanceBeforeMinor ?? nextPayment?.balanceBeforeMinor ?? (nextPayment ? walletBalanceMinor : null);
      const afterPayment = current.balanceAfterPaymentMinor ?? nextPayment?.balanceAfterPaymentMinor ?? (nextPayment?.status === 'authorized' ? nextPayment.walletBalanceMinor : null);
      const nextCompensation = compensation || current.compensation;
      const finalBalanceMinor = walletBalanceMinor;
      const netChargedMinor = balanceBeforeMinor != null && finalBalanceMinor != null ? balanceBeforeMinor - finalBalanceMinor : null;
      const financialOutcome = outcome || current.outcome || 'pending';
      task.financial = {
        ...current,
        version: 1,
        amountMinor: current.amountMinor ?? task.quote?.totalMinor ?? nextPayment?.amountMinor ?? null,
        balanceBeforeMinor,
        balanceAfterPaymentMinor: afterPayment,
        finalBalanceMinor,
        netChargedMinor,
        compensation: nextCompensation,
        outcome: financialOutcome
      };
      if (task.payment) task.payment = { ...task.payment, finalBalanceMinor, netChargedMinor, financialOutcome };
      if (task.wallet) task.wallet = { ...task.wallet, balanceBeforeMinor, balanceAfterPaymentMinor: afterPayment, balanceAfterMinor: finalBalanceMinor, finalBalanceMinor, netChargedMinor };
    });
  }

  _releaseReservation(taskId, reason) {
    const task = this.getTask(taskId);
    if (!task.inventory?.reservation || !['reserved'].includes(task.inventory.reservation.status)) return;
    const released = this.inventoryAdapter.release({ operationId: operationId(taskId, 'inventory'), reservationReference: task.inventory.reservation.reference, reason });
    this._updateTask(taskId, (current) => { current.inventory.reservation = released; current.inventory.status = released.status; });
    this._complete(taskId, 'inventory', released, released.reference);
    this._recordStageAudit(taskId, 'inventory', 'inventory.released', 'warning', `Inventory reservation released (${reason}).`, released);
  }

  _compensate(taskId, reason) {
    const task = this.getTask(taskId);
    if (!task.payment || task.payment.status !== 'authorized') return null;
    const compensated = this.walletAdapter.compensate({ operationId: operationId(taskId, 'payment'), taskId, walletId: task.walletId, merchantId: task.quote.merchantId, amountMinor: task.quote.totalMinor, currency: task.currency });
    this._updateTask(taskId, (current) => { current.compensation = compensated; current.payment = { ...current.payment, status: compensated.status === 'compensated' ? 'compensated' : current.payment.status, finalBalanceMinor: compensated.finalBalanceMinor ?? null }; });
    this._updateFinancial(taskId, { compensation: compensated, outcome: compensated.status === 'compensated' ? 'compensated' : 'compensation_failed' });
    this._recordStageAudit(taskId, 'payment', 'payment.compensated', compensated.status === 'compensated' ? 'warning' : 'error', compensated.status === 'compensated' ? `Payment compensated after ${reason}.` : 'Payment compensation failed and requires operator review.', compensated);
    return compensated;
  }

  _finishOrderLifecycle(taskId) {
    let task = this.getTask(taskId);
    const fulfillmentOp = this._begin(taskId, 'fulfillment');
    const fulfillment = this.fulfillmentAdapter.fulfill({ operationId: fulfillmentOp, orderReference: task.order.reference, scenario: task.scenario });
    this._updateTask(taskId, (current) => { current.fulfillment = fulfillment; current.order.fulfillmentStatus = fulfillment.status; });
    this._complete(taskId, 'fulfillment', fulfillment, fulfillment.reference);
    this._recordStageAudit(taskId, 'fulfillment', `fulfillment.${fulfillment.status}`, fulfillment.status === 'fulfilled' ? 'success' : 'warning', fulfillment.status === 'fulfilled' ? 'Order fulfillment simulated.' : 'Fulfillment failed independently of confirmed payment.', fulfillment);
    this._transition(taskId, 'fulfillment', 'fulfillment', fulfillment.status === 'fulfilled' ? 'Order fulfillment completed.' : 'Fulfillment needs attention.', { operationId: fulfillmentOp, reference: fulfillment.reference, status: fulfillment.status === 'fulfilled' ? 'success' : 'warning' });

    task = this.getTask(taskId);
    const deliveryOp = this._begin(taskId, 'delivery');
    const delivery = this.deliveryAdapter.deliver({ operationId: deliveryOp, orderReference: task.order.reference, customer: task.customer, scenario: task.scenario });
    this._updateTask(taskId, (current) => { current.delivery = delivery; current.order.deliveryStatus = delivery.status; });
    this._complete(taskId, 'delivery', delivery, delivery.reference);
    this._recordStageAudit(taskId, 'delivery', `delivery.${delivery.status}`, delivery.status === 'delivered' ? 'success' : 'warning', delivery.status === 'delivered' ? 'Simulated delivery completed to the fixture address.' : 'Delivery failed independently; confirmed payment and order were preserved.', delivery);
    this._transition(taskId, 'delivery', 'delivery', delivery.status === 'delivered' ? 'Delivery completed.' : 'Delivery needs attention.', { operationId: deliveryOp, reference: delivery.reference, status: delivery.status === 'delivered' ? 'success' : 'warning' });

    this._updateFinancial(taskId, { outcome: 'confirmed' });
    task = this.getTask(taskId);
    const receiptOp = this._begin(taskId, 'receipt');
    const auditOp = this._begin(taskId, 'audit');
    const receipt = {
      id: stableReference('RECEIPT', task.id),
      status: 'confirmed',
      mode: SANDBOX_MODE,
      customer: clone(task.customer),
      walletName: task.wallet.name,
      merchant: task.quote.merchant,
      merchantId: task.quote.merchantId,
      item: task.quote.item,
      variant: task.quote.variant,
      amountMinor: task.quote.totalMinor,
      currency: task.currency,
      paymentReference: task.payment.reference,
      authorizationReference: task.payment.authorizationReference || task.checkout?.authorizationReference || null,
      captureReference: task.payment.captureReference || task.checkout?.captureReference || null,
      merchantCreditReference: task.merchantCredit.reference,
      orderReference: task.order.reference,
      inventoryReservationReference: task.inventory.reservation.reference,
      fulfillmentStatus: fulfillment.status,
      deliveryStatus: delivery.status,
      issuedAt: now(this.clock),
      disclosure: 'SIMULATED receipt - fake wallet, merchant, order, fulfillment, and delivery only. No real funds moved.'
    };
    this._transition(taskId, 'receipt', 'receipt', 'Receipt state recorded.', { operationId: receiptOp, reference: receipt.id, status: 'success' });
    this._updateTask(taskId, (current) => {
      current.receipt = receipt;
      current.purchaseStatus = 'confirmed';
      current.state = 'completed';
      current.lifecycle = [...(current.lifecycle || []), { state: 'completed', at: now(this.clock) }];
      current.automation = { ...current.automation, status: 'completed', nextAction: 'none', completedAt: now(this.clock) };
    });
    this._complete(taskId, 'receipt', receipt, receipt.id);
    this._complete(taskId, 'audit', receipt, receipt.id);
    this._recordStageAudit(taskId, 'receipt', 'receipt.created', 'success', 'Confirmed receipt created after payment and order confirmation.', receipt);
    this._recordStageAudit(taskId, 'audit', 'purchase.completed', 'success', 'Purchase complete; fulfillment and delivery remain independently visible.', { reference: receipt.id, paymentStatus: task.payment.status, orderStatus: task.order.status, fulfillmentStatus: fulfillment.status, deliveryStatus: delivery.status });
    return this._response(taskId);
  }

  _authoritativeCandidate(task, discoveredCandidate) {
    const authoritative = this.localDiscoveryAdapter.discover({ request: task.request, scenario: task.scenario });
    const match = authoritative.candidates.find((candidate) => candidate.merchantId === discoveredCandidate.merchantId && candidate.sku === discoveredCandidate.sku && candidate.variantId === discoveredCandidate.variantId);
    if (!match) return null;
    const quoteFields = ['subtotalMinor', 'shippingMinor', 'taxMinor', 'totalMinor', 'currency'];
    if (quoteFields.some((field) => discoveredCandidate[field] !== match[field])) {
      throw new SandboxDomainError(409, 'AUTHORITATIVE_QUOTE_MISMATCH', 'The browser quote did not match the approved local quote, so no purchase was attempted.');
    }
    return {
      ...match,
      id: discoveredCandidate.id,
      sourceUrl: discoveredCandidate.sourceUrl,
      observedAt: discoveredCandidate.observedAt,
      quoteExpiresAt: discoveredCandidate.quoteExpiresAt,
      evidence: discoveredCandidate.evidence,
      matchReasons: discoveredCandidate.matchReasons,
      relevanceScore: discoveredCandidate.relevanceScore,
      confidence: discoveredCandidate.confidence
    };
  }

  runTask(taskId, { candidateId = null, automatic = true } = {}) {
    let task = this.getTask(taskId);
    if (['completed', 'failed', 'reconciliation_required'].includes(task.state)) return this._response(taskId);
    this._updateTask(taskId, (current) => { current.automation = { ...current.automation, status: 'running', automatic, startedAt: current.automation.startedAt || now(this.clock), nextAction: 'NaviPay is running the simulated purchase.' }; });

    task = this.getTask(taskId);
    if (stage(task, 'intent').status === 'pending') {
      const opId = this._begin(taskId, 'intent');
      this._complete(taskId, 'intent', { status: 'interpreted', reference: stableReference('INTENT', task.id) }, stableReference('INTENT', task.id));
      this._recordStageAudit(taskId, 'intent', 'intent.interpreted', 'success', `Interpreted request as ${task.request.intent.productCategory || 'an unspecified product category'}.`, { operationId: opId, intent: task.request.intent });
      this._updateTask(taskId, (current) => { current.state = 'intent_interpreted'; });
    }

    task = this.getTask(taskId);
    if (!task.quote) {
      const opId = this._begin(taskId, 'discovery');
      let result;
      try {
        result = task.targetSite?.status === 'blocked'
          ? this._blockedTargetFallback(task)
          : this.discoveryAdapter.discover({ operationId: opId, taskId, request: task.request, scenario: task.scenario, targetSite: task.targetSite?.url || null, targetSiteBlocked: false });
      } catch (error) {
        this._fail(taskId, 'discovery', error.code || 'DISCOVERY_FAILED', error.message || 'The local merchant sandbox could not be searched.');
        return this._response(taskId, 502);
      }
      this._updateTask(taskId, (current) => {
        current.quote = {
          mode: result.mode,
          source: result.source,
          discoveredAt: result.discoveredAt,
          candidates: result.candidates,
          recommendedCandidateId: result.recommendedCandidateId,
          rankingPolicy: result.rankingPolicy || null,
          recommendationOnly: Boolean(result.recommendationOnly),
          discoveryStatus: result.discoveryStatus || { status: 'available', code: null, message: null },
          selectedCandidateId: null,
          locked: false,
          recommendation: null,
          merchantId: null,
          merchant: null,
          item: null,
          variant: null,
          totalMinor: null,
          currency: null
        };
      });
      this._complete(taskId, 'discovery', result, result.discoveredAt);
      this._recordStageAudit(taskId, 'discovery', 'discovery.completed', 'success', `Found ${result.candidates.length} simulated in-catalog candidates.`, result);
      if (result.recommendationOnly) {
        const selection = selectClearWinner(result.candidates, { ceilingMinor: task.spendingCeilingMinor });
        if (selection.status === 'unavailable') {
          const hasInStock = result.candidates.some((candidate) => candidate.availability === 'in_stock');
          const code = hasInStock ? 'SPENDING_CEILING_EXCEEDED' : 'OUT_OF_STOCK';
          const message = hasInStock
            ? 'Every browser candidate exceeds the task spending ceiling; no purchase was attempted.'
            : 'The approved site has no in-stock candidate for this request; no purchase was attempted.';
          this._fail(taskId, hasInStock ? 'quote' : 'inventory', code, message);
          return this._response(taskId, 409);
        }
        if (selection.status === 'ambiguous') {
          this._updateTask(taskId, (current) => {
            current.recommendation = {
              status: 'ambiguous',
              candidateId: null,
              reason: `${selection.reason} Choose an item in Advanced details to continue.`,
              autoSelectable: false
            };
            current.quote.recommendation = current.recommendation;
            current.state = 'awaiting_selection';
            current.automation = { ...current.automation, status: 'awaiting_selection', automatic: false, nextAction: 'Choose one of the tied browser results to cross-check the approved local quote.' };
          });
          return this._response(taskId);
        }
        candidateId = selection.candidate.id;
        this._updateTask(taskId, (current) => {
          current.recommendation = {
            status: 'clear',
            candidateId,
            reason: `${selection.reason} NaviPay will cross-check its price and identity against the approved local quote before purchase safeguards run.`,
            autoSelectable: true
          };
          current.quote.recommendation = current.recommendation;
        });
      }
    }

    task = this.getTask(taskId);
    if (task.quote.recommendationOnly) {
      if (!candidateId) return this._response(taskId);
      const discoveredCandidate = task.quote.candidates.find((candidate) => candidate.id === candidateId);
      if (!discoveredCandidate) {
        this._fail(taskId, 'quote', 'QUOTE_CANDIDATE_NOT_FOUND', 'The selected discovery candidate does not exist.');
        return this._response(taskId, 422);
      }
      let authoritativeCandidate;
      try {
        authoritativeCandidate = this._authoritativeCandidate(task, discoveredCandidate);
      } catch (error) {
        this._fail(taskId, 'quote', error.code || 'AUTHORITATIVE_QUOTE_UNAVAILABLE', error.message || 'The selected item could not be matched to an approved local merchant quote.');
        return this._response(taskId, 502);
      }
      if (!authoritativeCandidate) {
        this._fail(taskId, 'quote', 'AUTHORITATIVE_QUOTE_UNAVAILABLE', 'The selected browser result is not present in the approved local merchant catalog, so no purchase was attempted.');
        return this._response(taskId, 502);
      }
      this._updateTask(taskId, (current) => {
        const recommendation = {
          status: authoritativeCandidate.availability === 'in_stock' ? 'clear' : 'unavailable',
          candidateId: authoritativeCandidate.id,
          reason: 'Selected browser evidence was matched to the approved local catalog before quote, inventory, and payment.',
          autoSelectable: authoritativeCandidate.availability === 'in_stock'
        };
        current.quote = { ...current.quote, candidates: current.quote.candidates.map((candidate) => candidate.id === authoritativeCandidate.id ? authoritativeCandidate : candidate), recommendationOnly: false, recommendation, authoritativeSource: 'seeded_catalog' };
        current.recommendation = recommendation;
      });
      task = this.getTask(taskId);
    }
    if (!task.recommendation) {
      const candidates = task.quote.candidates;
      const available = candidates.filter((candidate) => candidate.availability === 'in_stock' && candidate.totalMinor <= task.spendingCeilingMinor);
      const recommended = candidates.find((candidate) => candidate.id === task.quote.recommendedCandidateId);
      const recommendation = {
        status: recommended?.availability === 'in_stock' && recommended.totalMinor <= task.spendingCeilingMinor ? 'clear' : (available.length ? 'fallback_available' : 'unavailable'),
        candidateId: available[0]?.id || recommended?.id || null,
        reason: available.length ? 'Best clear match from the seeded merchant sandbox, within the task ceiling.' : 'No in-stock candidate is available in the local merchant sandbox.',
        autoSelectable: available.length > 0
      };
      this._updateTask(taskId, (current) => { current.recommendation = recommendation; current.quote.recommendation = recommendation; });
    }

    task = this.getTask(taskId);
    if (!task.quote.locked) {
      if (task.scenario === 'out-of-stock' || !task.recommendation.autoSelectable) {
        if (candidateId && task.quote.candidates.some((candidate) => candidate.id === candidateId && candidate.availability === 'in_stock')) {
          // An explicit available candidate can still rescue an ambiguous catalog response.
        } else if (task.scenario === 'out-of-stock') {
          this._fail(taskId, 'inventory', 'OUT_OF_STOCK', 'The recommended local catalog item is out of stock; no inventory was reserved.');
          return this._response(taskId, 409);
        } else {
          this._updateTask(taskId, (current) => { current.state = 'awaiting_selection'; current.automation = { ...current.automation, status: 'awaiting_selection', automatic: false, nextAction: 'Choose an available candidate and resume this purchase.' }; });
          return this._response(taskId);
        }
      }
      const selected = task.quote.candidates.find((candidate) => candidate.id === (candidateId || task.recommendation.candidateId));
      if (!selected) {
        this._fail(taskId, 'quote', 'QUOTE_CANDIDATE_NOT_FOUND', 'The selected local catalog candidate does not exist.');
        return this._response(taskId, 422);
      }
      if (selected.availability !== 'in_stock') {
        this._fail(taskId, 'inventory', 'OUT_OF_STOCK', 'The selected local catalog item is out of stock; no payment was attempted.');
        return this._response(taskId, 409);
      }
      const quoteOp = this._begin(taskId, 'quote');
      const locked = { ...selected };
      delete locked.evidence?._private;
      this._updateTask(taskId, (current) => {
        current.quote = { ...current.quote, selectedCandidateId: selected.id, locked: true, lockedAt: now(this.clock), merchantId: selected.merchantId, merchant: selected.merchant, merchantDomain: selected.merchantDomain, mcc: selected.mcc || '5732', item: selected.item, variant: selected.variant, totalMinor: selected.totalMinor, currency: selected.currency, lockedSnapshot: locked };
        current.state = 'quote_locked';
      });
      this._complete(taskId, 'quote', locked, selected.id);
      this._recordStageAudit(taskId, 'quote', 'quote.locked', 'success', `${selected.item} quote locked at ${money(selected.totalMinor)}.`, { operationId: quoteOp, reference: selected.id, merchant: selected.merchant, sku: selected.sku, variantId: selected.variantId });
    }

    task = this.getTask(taskId);
    if (!task.inventory) {
      const invOp = this._begin(taskId, 'inventory');
      const reservation = this.inventoryAdapter.reserve({ operationId: invOp, taskId, candidate: task.quote.lockedSnapshot, scenario: task.scenario });
      this._updateTask(taskId, (current) => { current.inventory = { status: reservation.status, reservation }; });
      if (reservation.status !== 'reserved') {
        this._fail(taskId, 'inventory', reservation.code || 'OUT_OF_STOCK', 'Inventory reservation was not confirmed; no payment was attempted.', { reference: reservation.reference });
        return this._response(taskId, 409);
      }
      this._complete(taskId, 'inventory', reservation, reservation.reference);
      this._recordStageAudit(taskId, 'inventory', 'inventory.reserved', 'success', 'One unit reserved with a local stock lease before payment.', reservation);
      this._updateTask(taskId, (current) => { current.state = 'inventory_reserved'; });
    }

    task = this.getTask(taskId);
    if (!task.wallet) {
      const fundingOp = this._begin(taskId, 'funding');
      let wallet;
      try {
        wallet = this.fundingAdapter.verify({ walletId: task.walletId, scenario: task.scenario });
      } catch (error) {
        this._releaseReservation(taskId, 'funding verification failed');
        this._fail(taskId, 'funding', error.code || 'FUNDING_FAILED', error.message || 'The fake wallet balance could not be verified.');
        return this._response(taskId, 502);
      }
      this._updateTask(taskId, (current) => {
        current.wallet = { ...wallet, balanceAfterMinor: this.store.data.wallets[current.walletId]?.balanceMinor ?? null };
        current.funding = wallet.chainEvidence;
      });
      this._complete(taskId, 'funding', wallet, wallet.chainEvidence.transactionReference || fundingOp);
      this._recordStageAudit(taskId, 'funding', 'funding.verified', 'success', 'Fake wallet balance verified while chain evidence remains a separate fact.', { operationId: fundingOp, reference: wallet.chainEvidence.transactionReference, status: wallet.status });
    }

    task = this.getTask(taskId);
    if (task.quote?.lockedSnapshot?.quoteExpiresAt && Date.parse(task.quote.lockedSnapshot.quoteExpiresAt) <= this.clock().getTime()) {
      this._releaseReservation(taskId, 'quote expired before issuer authorization');
      this._fail(taskId, 'quote', 'QUOTE_EXPIRED', 'The locked quote expired before issuer authorization; no payment was attempted.');
      return this._response(taskId, 409);
    }
    if (!task.card && task.paymentMode !== 'legacy_direct_wallet') {
      const issueOp = this._begin(taskId, 'payment');
      this._transition(taskId, 'card_issuing', 'card_issuing', 'Issuing a task-scoped disposable card.', { operationId: issueOp, status: 'info' });
      let issued;
      try {
        const locked = task.quote.lockedSnapshot;
        issued = this.issuerAdapter.issue({ operationId: `op_${taskId}_card_issuing`, taskId, scenario: task.scenario, scope: { ...locked, walletId: task.walletId, mcc: locked.mcc || '5732', amountMinor: locked.totalMinor } });
        this._updateTask(taskId, (current) => {
          const safeCard = { cardId: issued.cardId, reference: issued.reference, lastFour: String(issued.reference).slice(-4), status: issued.status, issuedAt: issued.issuedAt, scope: issued.scope, captureCount: issued.captureCount || 0, maskedReference: `•••• ${String(issued.reference).slice(-4)}`, retiredAt: null };
          current.card = safeCard;
          current.instrument = safeCard;
          current.issuer = { status: 'active', reference: issued.reference, cardId: issued.cardId, scope: issued.scope };
          current.state = 'card_issued';
          current.lifecycle = [...(current.lifecycle || []), { state: 'card_issued', at: now(this.clock) }];
        });
        this._complete(taskId, 'payment', issued, issued.reference);
        this._recordStageAudit(taskId, 'payment', 'card_issued', 'success', 'Disposable card issued for the exact merchant, amount, currency, and MCC.', { operationId: `op_${taskId}_card_issuing`, reference: issued.reference, scope: issued.scope });
      } catch (error) {
        this._releaseReservation(taskId, 'card issuance failed');
        this._fail(taskId, 'payment', error.code || 'ISSUER_FAILED', error.message || 'The local issuer did not issue a disposable card.');
        return this._response(taskId, 502);
      }
    }

    task = this.getTask(taskId);
    if (!task.payment) {
      const paymentOp = operationId(taskId, 'payment');
      if (task.paymentMode !== 'legacy_direct_wallet') {
        this._transition(taskId, 'browser_started', 'browser_started', 'A fresh isolated checkout context was started for this task.', { operationId: `op_${taskId}_browser_started` });
        this._transition(taskId, 'checkout_submitted', 'checkout_submitted', 'The local merchant checkout received the scoped card submission.', { operationId: `op_${taskId}_checkout_submitted` });
      }
      let checkout;
      try {
        checkout = task.paymentMode === 'legacy_direct_wallet'
          ? { status: 'authorized', payment: this.walletAdapter.transfer({ operationId: paymentOp, taskId, walletId: task.walletId, merchantId: task.quote.merchantId, amountMinor: task.quote.totalMinor, currency: task.currency, scenario: task.scenario }), merchantDomain: task.quote.merchantDomain, amountMinor: task.quote.totalMinor, currency: task.currency, reference: stableReference('LEGACY-CHECKOUT', task.id), authorizationReference: null, captureReference: null }
          : this.merchantCheckoutAdapter.execute({ operationId: `op_${taskId}_checkout_submit`, taskId, cardId: task.card.cardId, scope: { ...task.quote.lockedSnapshot, amountMinor: task.quote.totalMinor, walletId: task.walletId, delivery: task.customer, mcc: task.quote.lockedSnapshot.mcc || '5732' }, scenario: task.scenario });
      } catch (error) {
        let retired = null;
        if (this.issuerAdapter.retire && task.card) retired = this.issuerAdapter.retire({ operationId: `op_${taskId}_card_retired`, taskId, cardId: task.card.cardId, reason: 'checkout_worker_failed' });
        this._updateTask(taskId, (current) => { current.checkoutWorker = { status: 'cleaned', profile: 'fresh-per-task', cleanup: 'completed' }; if (current.card && retired) { current.card.status = 'retired'; current.card.retiredAt = retired.retiredAt; } current.instrument = current.card; });
        this._releaseReservation(taskId, 'checkout worker failed');
        this._fail(taskId, 'payment', error.code || 'CHECKOUT_WORKER_FAILED', error.message || 'The isolated checkout worker failed safely.');
        return this._response(taskId, 502);
      }
      this._updateTask(taskId, (current) => {
        current.checkout = { status: checkout.status, code: checkout.code || null, checkoutReference: checkout.checkoutReference || checkout.reference || null, authorizationReference: checkout.authorizationReference || null, captureReference: checkout.captureReference || null, attemptedAt: checkout.attemptedAt || now(this.clock), capturedAt: checkout.capturedAt || null, merchantDomain: checkout.merchantDomain, amountMinor: checkout.amountMinor, currency: checkout.currency, reason: checkout.reason || checkout.message || null };
        current.checkoutWorker = { status: 'cleaned', profile: 'fresh-per-task', cleanup: 'completed' };
        current.payment = { ...(checkout.payment || { operationId: paymentOp, taskId, status: checkout.status, code: checkout.code || null, reference: checkout.captureReference || checkout.checkoutReference, amountMinor: checkout.amountMinor, currency: checkout.currency, occurredAt: checkout.capturedAt || checkout.attemptedAt || now(this.clock) }), authorizationReference: checkout.authorizationReference || checkout.payment?.authorizationReference || null, captureReference: checkout.captureReference || checkout.payment?.captureReference || null, paymentMode: task.paymentMode || 'issuer_authorization' };
      });
      const payment = this.getTask(taskId).payment;
      this._updateFinancial(taskId, { payment, outcome: payment.status === 'unknown' ? 'unknown' : payment.status === 'authorized' ? 'authorized' : 'declined' });
      if (checkout.status === 'unknown') {
        this._setProgress(taskId, 'payment', 'unknown', { detail: 'authorization_pending', reference: checkout.checkoutReference });
        this._transition(taskId, 'authorization_pending', 'authorization_pending', 'Checkout returned an unknown authorization or capture result. Blind retry is blocked.', { operationId: `op_${taskId}_card_capture`, reference: checkout.checkoutReference, status: 'warning' });
        this._transition(taskId, 'reconciliation_required');
        this._updateTask(taskId, (current) => { current.automation = { ...current.automation, status: 'awaiting_reconciliation', nextAction: 'Reconcile the issuer result. Checkout will not be retried automatically.' }; });
        return this._response(taskId);
      }
      if (checkout.status !== 'authorized') {
        if (this.issuerAdapter.retire && task.card) this.issuerAdapter.retire({ operationId: `op_${taskId}_card_retired`, taskId, cardId: task.card.cardId, reason: 'checkout_declined' });
        this._updateTask(taskId, (current) => { current.card = { ...current.card, status: 'retired', retiredAt: now(this.clock) }; current.instrument = current.card; });
        this._releaseReservation(taskId, checkout.code === 'INSUFFICIENT_FUNDS' ? 'insufficient funds' : 'checkout declined');
        this._updateFinancial(taskId, { outcome: 'declined' });
        this._fail(taskId, 'payment', checkout.code || 'PAYMENT_DECLINED', checkout.reason || 'The local merchant checkout was declined; no debit was made.', { reference: checkout.checkoutReference });
        return this._response(taskId, 402);
      }
      this._complete(taskId, 'payment', payment, checkout.captureReference || payment.reference);
      if (task.paymentMode === 'legacy_direct_wallet') {
        this._transition(taskId, 'legacy_wallet_debited', 'legacy_wallet_debited', `Explicit legacy mode debited ${money(payment.amountMinor)} from the fake wallet.`, { operationId: paymentOp, reference: payment.reference, status: 'success' });
      } else {
        this._transition(taskId, 'authorized', 'authorized', 'Issuer authorization was approved.', { operationId: `op_${taskId}_card_authorize`, reference: checkout.authorizationReference, status: 'success' });
        this._transition(taskId, 'captured', 'captured', 'Issuer capture completed and debited the fake wallet once.', { operationId: `op_${taskId}_card_capture`, reference: checkout.captureReference, status: 'success' });
      }
      this._recordStageAudit(taskId, 'payment', 'payment.confirmed', 'success', `${task.paymentMode === 'legacy_direct_wallet' ? 'Legacy wallet transfer' : 'Issuer capture'} debited ${money(payment.amountMinor)} from the fake wallet.`, { reference: checkout.captureReference || payment.reference, authorizationReference: checkout.authorizationReference, paymentMode: task.paymentMode });
      if (this.issuerAdapter.retire && task.card) {
        const retired = this.issuerAdapter.retire({ operationId: `op_${taskId}_card_retired`, taskId, cardId: task.card.cardId, reason: 'captured' });
        this._updateTask(taskId, (current) => { current.card = { ...current.card, status: 'retired', captureCount: 1, retiredAt: retired.retiredAt }; current.instrument = current.card; });
        this._transition(taskId, 'card_retired', 'card_retired', 'Disposable card retired after its single capture.', { operationId: `op_${taskId}_card_retired`, reference: retired.reference, status: 'success' });
      }
    }

    task = this.getTask(taskId);
    if (task.payment?.status === 'authorized' && task.inventory?.reservation?.status === 'reserved' && Date.parse(task.inventory.reservation.leaseExpiresAt) <= this.clock().getTime()) {
      this._compensate(taskId, 'inventory reservation lease expired after capture');
      this._releaseReservation(taskId, 'inventory lease expired after capture');
      this._fail(taskId, 'inventory', 'RESERVATION_EXPIRED', 'The inventory lease expired after capture; the issuer debit was compensated.');
      return this._response(taskId, 409);
    }
    if (!task.merchantCredit) {
      const creditOp = this._begin(taskId, 'merchant_credit');
      let credit;
      try {
        credit = this.merchantCreditAdapter.confirm({ operationId: creditOp, taskId, transferReference: task.payment.reference, merchantId: task.quote.merchantId, amountMinor: task.quote.totalMinor, currency: task.currency, scenario: task.scenario });
      } catch (error) {
        this._compensate(taskId, 'merchant credit could not be confirmed');
        this._releaseReservation(taskId, 'merchant credit failed');
        this._fail(taskId, 'merchant_credit', error.code || 'MERCHANT_CREDIT_FAILED', error.message || 'Merchant credit was not confirmed.');
        return this._response(taskId, 502);
      }
      this._updateTask(taskId, (current) => { current.merchantCredit = credit; });
      if (credit.status !== 'confirmed') {
        this._compensate(taskId, 'merchant credit failed');
        this._releaseReservation(taskId, 'merchant credit failed');
        this._fail(taskId, 'merchant_credit', credit.code || 'MERCHANT_CREDIT_FAILED', 'Merchant credit failed and the fake wallet was compensated.', { reference: credit.reference });
        return this._response(taskId, 502);
      }
      this._complete(taskId, 'merchant_credit', credit, credit.reference);
      this._recordStageAudit(taskId, 'merchant_credit', 'merchant.credit.confirmed', 'success', 'Fake merchant credit confirmed from the double-entry ledger.', credit);
      this._updateTask(taskId, (current) => { current.state = 'merchant_credited'; });
    }

    task = this.getTask(taskId);
    if (!task.order) {
      const orderOp = this._begin(taskId, 'order');
      const order = this.orderAdapter.create({ operationId: orderOp, taskId, customer: task.customer, candidate: task.quote.lockedSnapshot, reservation: task.inventory.reservation, payment: task.payment, scenario: task.scenario });
      if (order.status !== 'confirmed') {
        this._compensate(taskId, 'order creation failed');
        this._releaseReservation(taskId, 'order creation failed');
        this._updateTask(taskId, (current) => { current.order = order; });
        this._fail(taskId, 'order', order.code || 'ORDER_CREATION_FAILED', 'Order creation failed safely; payment was compensated and inventory released.', { reference: order.reference });
        return this._response(taskId, 502);
      }
      const committed = this.inventoryAdapter.commit({ operationId: operationId(taskId, 'inventory'), reservationReference: task.inventory.reservation.reference });
      this._updateTask(taskId, (current) => { current.inventory.reservation = committed; current.inventory.status = committed.status; current.order = order; });
      this._transition(taskId, 'order_confirmed', 'order_confirmed', 'Local merchant order confirmed after issuer capture.', { operationId: orderOp, reference: order.reference, status: 'success' });
      this._complete(taskId, 'inventory', committed, committed.reference);
      this._complete(taskId, 'order', order, order.reference);
      this._recordStageAudit(taskId, 'order', 'order.confirmed', 'success', 'Order created after confirmed payment and committed inventory.', order);
    }

    return this._finishOrderLifecycle(taskId);
  }

  _readIdempotency(key, fingerprint) {
    const previous = this.store.data.idempotency[key];
    if (!previous) return null;
    if (previous.requestFingerprint !== fingerprint) throw new SandboxDomainError(409, 'IDEMPOTENCY_KEY_REUSED', 'Use a new idempotency key when the purchase request changes.');
    return previous;
  }

  startPurchase({ idempotencyKey, request, targetSite = undefined, targetUrl = undefined, scenario = 'happy', origin = 'operator', paymentMode = 'issuer_authorization' } = {}) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for the purchase run.');
    const requestedTargetSite = targetSite === undefined ? targetUrl : targetSite;
    const fingerprint = JSON.stringify({ request, targetSite: requestedTargetSite, scenario, origin, paymentMode });
    const taskInput = { request, targetSite: requestedTargetSite, scenario, origin, paymentMode };
    const key = `sandbox:start:${idempotencyKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const task = previous?.taskId ? this.getTask(previous.taskId) : this.createTask(taskInput);
    if (!previous) this.store.transaction((data) => { data.idempotency[key] = { taskId: task.id, requestFingerprint: fingerprint, createdAt: now(this.clock), response: null }; });
    const result = this.runTask(task.id);
    const response = { ...result, statusCode: previous ? result.statusCode : (result.statusCode === 200 ? 201 : result.statusCode), replayed: false };
    this.store.transaction((data) => { data.idempotency[key] = { ...data.idempotency[key], response: clone(response) }; });
    return response;
  }

  runPurchase(input = {}) {
    return this.startPurchase({ ...input, idempotencyKey: input.idempotencyKey || stableReference('RUN', JSON.stringify(input)) });
  }

  resumePurchase(taskId, idempotencyKey, candidateId = null) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for the resume action.');
    const key = `sandbox:resume:${taskId}:${idempotencyKey}`;
    const fingerprint = candidateId || '';
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const result = this.runTask(taskId, { candidateId, automatic: false });
    const response = { ...result, replayed: false };
    this.store.transaction((data) => { data.idempotency[key] = { taskId, requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(response) }; });
    return response;
  }

  revokeCard(taskId, idempotencyKey, reason = 'operator') {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for card revocation.');
    const key = `sandbox:revoke-card:${taskId}:${idempotencyKey}`;
    const previous = this._readIdempotency(key, reason);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const task = this.getTask(taskId);
    if (!task.card?.cardId) throw new SandboxDomainError(409, 'CARD_NOT_ISSUED', 'This purchase has no disposable card to revoke.');
    const revoked = this.issuerAdapter.revoke({ operationId: `op_${taskId}_card_revoked`, taskId, cardId: task.card.cardId, reason });
    this._updateTask(taskId, (current) => { current.card = { ...current.card, status: 'revoked', revokedAt: revoked.revokedAt }; current.instrument = current.card; });
    this._recordStageAudit(taskId, 'payment', 'card_revoked', 'warning', 'Disposable card revoked by the operator.', { reference: revoked.reference, operationId: `op_${taskId}_card_revoked` });
    const response = this._response(taskId);
    this.store.transaction((data) => { data.idempotency[key] = { taskId, requestFingerprint: reason, createdAt: now(this.clock), response: clone(response) }; });
    return response;
  }

  getCardStatus(cardId) {
    const card = this.issuerAdapter.status ? this.issuerAdapter.status(cardId) : null;
    if (!card) throw new SandboxDomainError(404, 'CARD_NOT_FOUND', 'That disposable card does not exist.');
    return {
      cardId: card.cardId,
      reference: card.reference,
      lastFour: String(card.reference).slice(-4),
      status: card.status,
      issuedAt: card.issuedAt,
      retiredAt: card.retiredAt || null,
      revokedAt: card.revokedAt || null,
      captureCount: card.captureCount || 0,
      maxCaptures: card.scope?.maxCaptures || 1,
      scope: card.scope ? { merchantId: card.scope.merchantId, merchantDomain: card.scope.merchantDomain, amountMinor: card.scope.amountMinor, currency: card.scope.currency, mcc: card.scope.mcc, expiresAt: card.scope.expiresAt } : null
    };
  }

  getCheckoutSession(sessionId) {
    if (!this.store.data.checkoutSessions[sessionId]) throw new SandboxDomainError(404, 'CHECKOUT_SESSION_NOT_FOUND', 'That local checkout session does not exist.');
    const session = clone(this.store.data.checkoutSessions[sessionId]);
    delete session.result?.payment;
    return session;
  }

  getCheckoutWebhooks(sessionId = null) {
    return clone(this.store.data.checkoutWebhooks.filter((event) => !sessionId || event.sessionId === sessionId));
  }

  refundPayment(taskId, idempotencyKey, kind = 'refund') {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for the payment reversal.');
    if (!['refund', 'reversal'].includes(kind)) throw new SandboxDomainError(422, 'INVALID_PAYMENT_REVERSAL', 'Payment action must be refund or reversal.');
    const key = `sandbox:${kind}:${taskId}:${idempotencyKey}`;
    const previous = this._readIdempotency(key, kind);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const task = this.getTask(taskId);
    if (!['completed'].includes(task.state) || task.payment?.status !== 'authorized') throw new SandboxDomainError(409, 'PAYMENT_NOT_REFUNDABLE', 'Only a confirmed issuer capture can be refunded or reversed.');
    let result;
    try {
      result = this.merchantCheckoutAdapter.refund({ taskId, cardId: task.card?.cardId, walletId: task.walletId, merchantId: task.quote.merchantId, amountMinor: task.quote.totalMinor, currency: task.currency, kind });
    } catch (error) {
      throw new SandboxDomainError(502, error.code || 'PAYMENT_REVERSAL_FAILED', error.message || 'The local payment reversal failed.');
    }
    this._updateTask(taskId, (current) => {
      current.compensation = { ...result, status: result.status };
      current.payment = { ...current.payment, status: result.status, reversalReference: result.reference, refundReference: result.reference };
      current.financial = { ...current.financial, compensation: result, outcome: result.status, finalBalanceMinor: this.store.data.wallets[current.walletId]?.balanceMinor ?? null, netChargedMinor: 0 };
      current.automation = { ...current.automation, nextAction: 'none' };
    });
    this._recordStageAudit(taskId, 'payment', kind === 'reversal' ? 'payment.reversed' : 'payment.refunded', 'success', kind === 'reversal' ? 'Issuer capture was reversed in the local gateway.' : 'Issuer capture was refunded in the local gateway.', result);
    const response = this._response(taskId);
    this.store.transaction((data) => { data.idempotency[key] = { taskId, requestFingerprint: kind, createdAt: now(this.clock), response: clone(response) }; });
    return response;
  }

  reconcilePayment(taskId, idempotencyKey, resolution) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for payment reconciliation.');
    const key = `sandbox:reconcile:${taskId}:${idempotencyKey}`;
    const fingerprint = resolution || '';
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const task = this.getTask(taskId);
    if (task.state !== 'reconciliation_required' || task.payment?.status !== 'unknown') throw new SandboxDomainError(409, 'PAYMENT_RECONCILIATION_NOT_REQUIRED', 'This purchase has no unknown payment awaiting reconciliation.');
    if (!['authorized', 'declined'].includes(resolution)) throw new SandboxDomainError(422, 'INVALID_PAYMENT_RESOLUTION', 'Resolution must be authorized or declined.');
    const reconciledCapture = this.issuerAdapter.reconcile
      ? this.issuerAdapter.reconcile({ operationId: `op_${taskId}_card_capture`, taskId, cardId: task.card?.cardId, walletId: task.walletId, merchantId: task.quote.merchantId, amountMinor: task.quote.totalMinor, currency: task.currency, resolution })
      : null;
    const payment = reconciledCapture?.payment || this.walletAdapter.resolveUnknown({ operationId: operationId(taskId, 'payment'), taskId, walletId: task.walletId, merchantId: task.quote.merchantId, amountMinor: task.quote.totalMinor, currency: task.currency, resolution });
    this._updateTask(taskId, (current) => {
      current.payment = { ...payment, authorizationReference: current.payment?.authorizationReference || null, captureReference: reconciledCapture?.captureReference || current.payment?.captureReference || null };
      current.card = current.card ? { ...current.card, status: resolution === 'authorized' ? 'captured' : 'retired', captureCount: resolution === 'authorized' ? 1 : current.card.captureCount, retiredAt: resolution === 'declined' ? now(this.clock) : current.card.retiredAt } : current.card;
      current.instrument = current.card;
      current.wallet = { ...current.wallet, balanceAfterMinor: this.store.data.wallets[current.walletId]?.balanceMinor ?? null };
    });
    this._updateFinancial(taskId, { payment, outcome: resolution === 'authorized' ? 'authorized' : 'declined' });
    this._recordStageAudit(taskId, 'payment', `payment.reconciled.${resolution}`, resolution === 'authorized' ? 'success' : 'warning', resolution === 'authorized' ? 'Unknown payment reconciled as authorized without retrying the transfer.' : 'Unknown payment reconciled as declined; inventory will be released.', payment);
    if (resolution === 'declined') {
      if (this.issuerAdapter.retire && task.card?.cardId) this.issuerAdapter.retire({ operationId: `op_${taskId}_card_retired`, taskId, cardId: task.card.cardId, reason: 'reconciled_declined' });
      this._updateTask(taskId, (current) => { if (current.card) { current.card.status = 'retired'; current.card.retiredAt = current.card.retiredAt || now(this.clock); } current.instrument = current.card; });
      this._releaseReservation(taskId, 'payment reconciled declined');
      this._updateFinancial(taskId, { outcome: 'declined' });
      this._fail(taskId, 'payment', 'PAYMENT_DECLINED_RECONCILED', 'The unknown wallet transfer was reconciled as declined; no duplicate payment was attempted.', { reference: payment.reference });
      const response = this._response(taskId, 200);
      this.store.transaction((data) => { data.idempotency[key] = { taskId, requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(response) }; });
      return response;
    }
    this._complete(taskId, 'payment', payment, payment.captureReference || payment.reference);
    if (this.issuerAdapter.retire && task.card?.cardId) {
      const retired = this.issuerAdapter.retire({ operationId: `op_${taskId}_card_retired`, taskId, cardId: task.card.cardId, reason: 'reconciled_capture' });
      this._updateTask(taskId, (current) => { if (current.card) { current.card.status = 'retired'; current.card.captureCount = 1; current.card.retiredAt = retired.retiredAt; } current.instrument = current.card; });
      this._transition(taskId, 'card_retired', 'card_retired', 'Disposable card retired after reconciliation.', { operationId: `op_${taskId}_card_retired`, reference: retired.reference, status: 'success' });
    }
    this._updateFinancial(taskId, { outcome: 'authorized' });
    this._updateTask(taskId, (current) => { current.state = 'payment_confirmed'; current.automation = { ...current.automation, status: 'running', nextAction: 'Continuing after reconciled payment.' }; });
    const result = this.runTask(taskId);
    this.store.transaction((data) => { data.idempotency[key] = { taskId, requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(result) }; });
    return result;
  }

  lookupOperation(id) {
    return projectOperation(this.store.data.operations[id] || null);
  }

  getWalletLedger() {
    return clone(this.store.data.walletLedger);
  }

  lookupWalletTransfer(operationIdValue) {
    const transfer = this.walletAdapter.lookup(operationIdValue);
    if (!transfer) return null;
    return {
      operationId: transfer.operationId,
      taskId: transfer.taskId,
      status: transfer.status,
      code: transfer.code || null,
      amountMinor: transfer.amountMinor,
      currency: transfer.currency,
      reference: safeReference(transfer.reference),
      transactionReference: safeReference(transfer.transactionReference),
      balanceBeforeMinor: transfer.balanceBeforeMinor ?? null,
      balanceAfterPaymentMinor: transfer.balanceAfterPaymentMinor ?? null,
      finalBalanceMinor: transfer.finalBalanceMinor ?? null,
      occurredAt: transfer.occurredAt || null,
      resolvedAt: transfer.resolvedAt || null
    };
  }

  getInventory() {
    return clone(this.store.data.inventory);
  }

  reset() {
    this.store.reset();
    seedSandbox(this.store);
    return { wallet: this.getWallet(), tasks: [] };
  }
}

module.exports = {
  CATALOG,
  DEFAULT_ADAPTER_TIMEOUT_MS,
  DEMO_CUSTOMER,
  DEMO_WALLET,
  SANDBOX_MODE,
  SANDBOX_SCENARIOS,
  SandboxDomainError,
  NaviPaySandboxService,
  LocalDiscoveryAdapter,
  PlaywrightDiscoveryAdapter,
  LocalFundingAdapter,
  LocalInventoryAdapter,
  LocalWalletTransferAdapter,
  LocalIssuerAdapter,
  LocalMerchantCreditAdapter,
  LocalMerchantCheckoutAdapter,
  LocalMerchantGatewayAdapter: LocalMerchantCheckoutAdapter,
  LocalCheckoutWorker,
  LocalOrderAdapter,
  LocalFulfillmentAdapter,
  LocalDeliveryAdapter,
  TASK_PROJECTION_VERSION,
  projectAuditEvent,
  projectOperation,
  projectTask,
  parseRequest,
  money,
  seedSandbox
};
