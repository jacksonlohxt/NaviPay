const crypto = require('node:crypto');
const { AdapterError } = require('./adapters');
const { CURRENCY } = require('./domain');

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
  'discovery-failure'
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
      recommendedCandidateId: candidates[0].id
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
      if (reservation.status === 'released' || reservation.status === 'declined') return clone(reservation);
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

/** Optional future issuer boundary. The wallet path intentionally does not expose credentials. */
class LocalIssuerAdapter {
  constructor({ clock = () => new Date(), timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS } = {}) {
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  issue({ taskId, scope }) {
    this.calls += 1;
    return {
      mode: SANDBOX_MODE,
      status: 'ready',
      reference: stableReference('ISSUER-SCOPE', taskId),
      issuedAt: now(this.clock),
      scope: { merchantId: scope.merchantId, amountMinor: scope.amountMinor, currency: scope.currency, reusable: false, credentials: 'provider-controlled and redacted' }
    };
  }
}

/** Merchant checkout is kept as a named replacement point over the local credit confirmation. */
class LocalMerchantCheckoutAdapter extends LocalMerchantCreditAdapter {}

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

function safeCandidate(candidate) {
  if (!candidate) return null;
  return {
    id: candidate.id,
    merchant: candidate.merchant,
    merchantId: candidate.merchantId,
    item: candidate.item,
    variant: candidate.variant,
    brand: candidate.brand,
    productCategory: candidate.productCategory,
    subtotalMinor: candidate.subtotalMinor,
    shippingMinor: candidate.shippingMinor,
    taxMinor: candidate.taxMinor,
    totalMinor: candidate.totalMinor,
    currency: candidate.currency,
    availability: candidate.availability,
    stockQuantity: candidate.stockQuantity,
    relevanceScore: candidate.relevanceScore,
    matchReasons: Array.isArray(candidate.matchReasons) ? [...candidate.matchReasons] : [],
    quoteExpiresAt: candidate.quoteExpiresAt,
    evidence: candidate.evidence ? {
      type: candidate.evidence.type,
      source: candidate.evidence.source,
      observedAt: candidate.evidence.observedAt,
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

function projectTask(task, { operations = {}, auditEvents = [], walletBalanceMinor = null } = {}) {
  const candidates = (task.quote?.candidates || []).map(safeCandidate);
  const selected = safeCandidate(task.quote?.lockedSnapshot) || candidates.find((candidate) => candidate.id === task.quote?.selectedCandidateId) || null;
  const reservation = task.inventory?.reservation;
  const quote = task.quote ? {
    status: task.quote.locked ? 'locked' : 'open',
    merchantId: task.quote.merchantId || selected?.merchantId || null,
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
    purchaseStatus: task.purchaseStatus,
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
    this.discoveryAdapter = adapters.discovery || new LocalDiscoveryAdapter({ clock });
    this.fundingAdapter = adapters.funding || new LocalFundingAdapter({ store, clock });
    this.inventoryAdapter = adapters.inventory || new LocalInventoryAdapter({ store, clock });
    this.walletAdapter = adapters.wallet || new LocalWalletTransferAdapter({ store, clock });
    this.issuerAdapter = adapters.issuer || new LocalIssuerAdapter({ clock });
    this.merchantCheckoutAdapter = adapters.merchantCheckout || adapters.merchantCredit || new LocalMerchantCheckoutAdapter({ store, clock });
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
    return { statusCode, body: { task, projection, run: { status: runStatus, nextAction: task.automation.nextAction, automatic: task.automation.automatic }, replayed } };
  }

  createTask({ request, scenario = 'happy', origin = 'operator', replayOf = null } = {}) {
    if (!SANDBOX_SCENARIOS.has(scenario)) throw new SandboxDomainError(400, 'INVALID_SCENARIO', `Unknown sandbox scenario: ${scenario}.`);
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
      currency: CURRENCY,
      spendingCeilingMinor: TASK_CEILING_MINOR,
      customer: clone(DEMO_CUSTOMER),
      walletId: DEMO_WALLET.id,
      request: { raw, intent },
      state: 'created',
      purchaseStatus: 'pending',
      recommendation: null,
      quote: null,
      inventory: null,
      funding: null,
      wallet: null,
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
      walletBalanceMinor: this.store.data.wallets[task.walletId]?.balanceMinor ?? null
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

  getWallet() {
    return publicWallet(this.store.data.wallets[DEMO_WALLET.id]);
  }

  getCatalog() {
    return CATALOG.map((entry) => {
      const stock = this.store.data.inventory[inventoryKey(entry)];
      return { merchantId: entry.merchantId, merchant: entry.merchant, sku: entry.sku, variantId: entry.variantId, brand: entry.brand, productCategory: entry.productCategory, item: entry.item, variant: entry.variant, totalMinor: entry.priceMinor + entry.shippingMinor + entry.taxMinor, currency: CURRENCY, availableQuantity: stock?.availableQuantity || 0, mode: SANDBOX_MODE };
    });
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
      if (task.wallet) task.wallet = { ...task.wallet, balanceBeforeMinor, balanceAfterPaymentMinor: afterPayment, finalBalanceMinor, netChargedMinor };
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

    task = this.getTask(taskId);
    const deliveryOp = this._begin(taskId, 'delivery');
    const delivery = this.deliveryAdapter.deliver({ operationId: deliveryOp, orderReference: task.order.reference, customer: task.customer, scenario: task.scenario });
    this._updateTask(taskId, (current) => { current.delivery = delivery; current.order.deliveryStatus = delivery.status; });
    this._complete(taskId, 'delivery', delivery, delivery.reference);
    this._recordStageAudit(taskId, 'delivery', `delivery.${delivery.status}`, delivery.status === 'delivered' ? 'success' : 'warning', delivery.status === 'delivered' ? 'Simulated delivery completed to the fixture address.' : 'Delivery failed independently; confirmed payment and order were preserved.', delivery);

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
      merchantCreditReference: task.merchantCredit.reference,
      orderReference: task.order.reference,
      inventoryReservationReference: task.inventory.reservation.reference,
      fulfillmentStatus: fulfillment.status,
      deliveryStatus: delivery.status,
      issuedAt: now(this.clock),
      disclosure: 'SIMULATED receipt - fake wallet, merchant, order, fulfillment, and delivery only. No real funds moved.'
    };
    this._updateTask(taskId, (current) => {
      current.receipt = receipt;
      current.purchaseStatus = 'confirmed';
      current.state = 'completed';
      current.automation = { ...current.automation, status: 'completed', nextAction: 'none', completedAt: now(this.clock) };
    });
    this._complete(taskId, 'receipt', receipt, receipt.id);
    this._complete(taskId, 'audit', receipt, receipt.id);
    this._recordStageAudit(taskId, 'receipt', 'receipt.created', 'success', 'Confirmed receipt created after payment and order confirmation.', receipt);
    this._recordStageAudit(taskId, 'audit', 'purchase.completed', 'success', 'Purchase complete; fulfillment and delivery remain independently visible.', { reference: receipt.id, paymentStatus: task.payment.status, orderStatus: task.order.status, fulfillmentStatus: fulfillment.status, deliveryStatus: delivery.status });
    return this._response(taskId);
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
        result = this.discoveryAdapter.discover({ operationId: opId, taskId, request: task.request, scenario: task.scenario });
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
    }

    task = this.getTask(taskId);
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
        current.quote = { ...current.quote, selectedCandidateId: selected.id, locked: true, lockedAt: now(this.clock), merchantId: selected.merchantId, merchant: selected.merchant, item: selected.item, variant: selected.variant, totalMinor: selected.totalMinor, currency: selected.currency, lockedSnapshot: locked };
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
    if (!task.payment) {
      const paymentOp = this._begin(taskId, 'payment');
      const payment = this.walletAdapter.transfer({ operationId: paymentOp, taskId, walletId: task.walletId, merchantId: task.quote.merchantId, amountMinor: task.quote.totalMinor, currency: task.currency, scenario: task.scenario });
      this._updateTask(taskId, (current) => {
        current.payment = payment;
        current.wallet = { ...current.wallet, balanceAfterMinor: this.store.data.wallets[current.walletId]?.balanceMinor ?? null };
      });
      this._updateFinancial(taskId, { payment, outcome: payment.status === 'unknown' ? 'unknown' : payment.status === 'authorized' ? 'authorized' : 'declined' });
      if (payment.status === 'unknown') {
        this._setProgress(taskId, 'payment', 'unknown', { detail: 'reconciliation_required', reference: payment.reference });
        this._recordStageAudit(taskId, 'payment', 'payment.unknown', 'warning', 'Wallet transfer returned an unknown result. Inventory remains held and blind retry is blocked.', payment);
        this._updateTask(taskId, (current) => { current.state = 'reconciliation_required'; current.automation = { ...current.automation, status: 'awaiting_reconciliation', nextAction: 'Reconcile the wallet result as authorized or declined. No transfer retry is allowed.' }; });
        return this._response(taskId);
      }
      if (payment.status !== 'authorized') {
        this._releaseReservation(taskId, payment.code === 'INSUFFICIENT_FUNDS' ? 'insufficient funds' : 'payment declined');
        this._updateFinancial(taskId, { outcome: 'declined' });
        this._fail(taskId, 'payment', payment.code || 'PAYMENT_DECLINED', payment.code === 'INSUFFICIENT_FUNDS' ? 'The fake wallet has insufficient XSGD balance; no debit was made.' : 'The simulated wallet declined payment; no debit was made.', { reference: payment.reference });
        return this._response(taskId, 402);
      }
      this._complete(taskId, 'payment', payment, payment.reference);
      this._recordStageAudit(taskId, 'payment', 'payment.confirmed', 'success', `Fake wallet debited ${money(payment.amountMinor)}.`, payment);
      this._updateTask(taskId, (current) => { current.state = 'payment_confirmed'; });
    }

    task = this.getTask(taskId);
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
      this._updateTask(taskId, (current) => { current.inventory.reservation = committed; current.inventory.status = committed.status; current.order = order; current.state = 'order_confirmed'; });
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

  startPurchase({ idempotencyKey, request, scenario = 'happy', origin = 'operator' } = {}) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for the purchase run.');
    const fingerprint = JSON.stringify({ request, scenario, origin });
    const key = `sandbox:start:${idempotencyKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const task = previous?.taskId ? this.getTask(previous.taskId) : this.createTask({ request, scenario, origin });
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

  reconcilePayment(taskId, idempotencyKey, resolution) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for payment reconciliation.');
    const key = `sandbox:reconcile:${taskId}:${idempotencyKey}`;
    const fingerprint = resolution || '';
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const task = this.getTask(taskId);
    if (task.state !== 'reconciliation_required' || task.payment?.status !== 'unknown') throw new SandboxDomainError(409, 'PAYMENT_RECONCILIATION_NOT_REQUIRED', 'This purchase has no unknown payment awaiting reconciliation.');
    if (!['authorized', 'declined'].includes(resolution)) throw new SandboxDomainError(422, 'INVALID_PAYMENT_RESOLUTION', 'Resolution must be authorized or declined.');
    const payment = this.walletAdapter.resolveUnknown({ operationId: operationId(taskId, 'payment'), taskId, walletId: task.walletId, merchantId: task.quote.merchantId, amountMinor: task.quote.totalMinor, currency: task.currency, resolution });
    this._updateTask(taskId, (current) => { current.payment = payment; current.wallet = { ...current.wallet, balanceAfterMinor: this.store.data.wallets[current.walletId]?.balanceMinor ?? null }; });
    this._updateFinancial(taskId, { payment, outcome: resolution === 'authorized' ? 'authorized' : 'declined' });
    this._recordStageAudit(taskId, 'payment', `payment.reconciled.${resolution}`, resolution === 'authorized' ? 'success' : 'warning', resolution === 'authorized' ? 'Unknown payment reconciled as authorized without retrying the transfer.' : 'Unknown payment reconciled as declined; inventory will be released.', payment);
    if (resolution === 'declined') {
      this._releaseReservation(taskId, 'payment reconciled declined');
      this._updateFinancial(taskId, { outcome: 'declined' });
      this._fail(taskId, 'payment', 'PAYMENT_DECLINED_RECONCILED', 'The unknown wallet transfer was reconciled as declined; no duplicate payment was attempted.', { reference: payment.reference });
      const response = this._response(taskId, 200);
      this.store.transaction((data) => { data.idempotency[key] = { taskId, requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(response) }; });
      return response;
    }
    this._complete(taskId, 'payment', payment, payment.reference);
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
  LocalFundingAdapter,
  LocalInventoryAdapter,
  LocalWalletTransferAdapter,
  LocalIssuerAdapter,
  LocalMerchantCreditAdapter,
  LocalMerchantCheckoutAdapter,
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
