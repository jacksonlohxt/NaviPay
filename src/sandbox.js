const crypto = require('node:crypto');
const { AdapterError } = require('./adapters');
const { createConfiguredDiscoveryAdapter, DISCOVERY_SOURCE, DISCOVERY_RANKING_POLICY, PlaywrightDiscoveryAdapter, isExplicitlyAllowlistedUrl, normalizeTargetUrl, selectClearWinner } = require('./playwright-discovery');
const { CURRENCY } = require('./domain');
const { LocalFakeIssuerAdapter } = require('./issuer');
const { LocalCheckoutWorker } = require('./checkout-worker');
const {
  FUNDING_ASSET,
  FUNDING_NETWORK,
  FUNDING_PROVIDER_ID,
  FUNDING_STATES,
  LocalMockXsgdFundingProvider,
  formatAmount: formatFundingAmount,
  normalizeAction,
  normalizeAmountMinor,
  stableReference: fundingStableReference
} = require('./funding');
const {
  KYC_PROVIDER_ID,
  KYC_REASON_CODES,
  KYC_STATES,
  LocalMockKycProvider,
  normalizeDecision,
  stableReference: kycStableReference
} = require('./kyc');
const {
  AllowlistedToolRegistry,
  AgentPolicyEngine,
  appendAgentEvent,
  createAgentRun,
  safeContextObservation,
  recordBusinessPolicy,
  recordObservation,
  updateStage,
  saveCheckpoint,
  projectCustomerAgent,
  projectReviewerRun,
  rebuildAgentRunFromEvents
} = require('./agentic');
const { MODES, contentHash, parseAgentRun } = require('./agent-contract');
const { createModelGateway, DeterministicFallbackGateway, ModelGatewayError } = require('./model-gateway');

const SANDBOX_MODE = 'simulated local sandbox';
const DEFAULT_ADAPTER_TIMEOUT_MS = 5000;
const TASK_CEILING_MINOR = 100000;
const SIMULATION_RESOURCE_PROJECTION_VERSION = 1;
const SIMULATION_RESTOCK_MAX_QUANTITY = 100;
const SIMULATION_RESTOCK_MAX_AVAILABLE_QUANTITY = 1000;
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
  'no-match',
  'no-match-prepayment',
  'over-budget',
  'ambiguity',
  'ambiguous',
  'ambiguous-same-brand',
  'missing-product-type',
  'pending-kyc',
  'rejected-kyc',
  'insufficient-funding',
  'merchant-category-violation',
  'policy-block',
  'risk-block',
  'duplicate-instruction',
  'stale-quote',
  'stale-quote-before-card',
  'low-balance',
  'duplicate-replay',
  'restart-recovery',
  'order-commit-failure',
  'card-issued-before-checkout',
  'checkpoint-card-issued',
  'insufficient-funds',
  'payment-decline',
  'unknown-payment',
  'order-failure',
  'delivery-failure',
  'fulfillment-failure',
  'out-of-stock',
  'exact-out-of-stock',
  'merchant-credit-failure',
  'funding-failure',
  'discovery-failure',
  'invalid-request',
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

const APPROVED_MERCHANT_SCOPE = Object.freeze([...new Map(CATALOG.map((entry) => [entry.merchantId, { merchantId: entry.merchantId, merchant: entry.merchant, merchantDomain: entry.merchantDomain }])).values()]);
const APPROVED_MERCHANT_IDS = new Set(APPROVED_MERCHANT_SCOPE.map((entry) => entry.merchantId));
const APPROVED_PRODUCT_CATEGORIES = new Set(['keyboards', 'mice', 'earphones']);
const DEFAULT_PURCHASE_PURPOSE = 'one_purchase';

const CARDINAL_QUANTITIES = Object.freeze({
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20
});
const QUANTITY_WORDS = new Set(Object.keys(CARDINAL_QUANTITIES));
const STOP_WORDS = new Set(['a', 'an', 'and', 'below', 'budget', 'buy', 'for', 'find', 'get', 'i', 'like', 'limit', 'max', 'maximum', 'me', 'more', 'my', 'no', 'of', 'please', 'quantity', 'qty', 'sgd', 'some', 'spend', 'spending', 'than', 'the', 'to', 'under', 'unit', 'units', 'up', 'want', 'within', 'would', 'xsgd', ...QUANTITY_WORDS]);
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

function parseBudget(raw) {
  const amountPattern = '(\\d{1,9}(?:,\\d{3})*(?:\\.\\d{1,2})?)';
  const budgetPattern = new RegExp(`(?:under|below|within|up to|max(?:imum)?|budget(?:\\s+of)?|no more than|spend(?:ing)?(?:\\s+limit)?(?:\\s+of)?)\\s*(?:xsgd|sgd|\\$)?\\s*${amountPattern}\\s*(?:xsgd|sgd)?`, 'i');
  const currencyPattern = new RegExp(`(?:xsgd|sgd|\\$)\\s*${amountPattern}`, 'i');
  const markerPresent = /\b(?:under|below|within|up|to|max|maximum|budget|spend|spending|limit)\b|(?:xsgd|sgd|\$)/i.test(raw);
  const match = budgetPattern.exec(raw) || currencyPattern.exec(raw);
  if (!match) {
    if (markerPresent && /\b(?:budget|under|below|within|up to|max|maximum|spend|spending|limit)\b/i.test(raw)) {
      throw new AdapterError('INVALID_BUDGET', 'Budget must be a non-negative XSGD amount with at most two decimal places.');
    }
    return null;
  }
  const normalized = match[1].replace(/,/g, '');
  const amount = Number(normalized);
  const amountMinor = Math.round(amount * 100);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > 100_000_000) {
    throw new AdapterError('INVALID_BUDGET', 'Budget must be a bounded XSGD amount.');
  }
  return { amountMinor, currency: CURRENCY, raw: match[0].trim() };
}

function quantityTokenValue(token) {
  if (token === undefined || token === null) return null;
  const normalized = String(token).toLocaleLowerCase('en-SG');
  if (Object.prototype.hasOwnProperty.call(CARDINAL_QUANTITIES, normalized)) return CARDINAL_QUANTITIES[normalized];
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function isQuantityToken(token) {
  return quantityTokenValue(token) !== null || QUANTITY_WORDS.has(String(token).toLocaleLowerCase('en-SG'));
}

function parseRequest(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 240 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AdapterError('INVALID_PURCHASE_REQUEST', 'Purchase request must be plain text between 1 and 240 characters.');
  }
  const raw = value.trim();
  const unsupportedCurrency = raw.match(/\b(usd|eur|gbp|jpy|aud|cad)\b/i);
  if (unsupportedCurrency) throw new AdapterError('UNSUPPORTED_CURRENCY', 'NaviPay local purchases use XSGD only.');
  const budget = parseBudget(raw);
  const words = normalizeWords(raw);
  const text = words.join(' ');
  const knownBrand = cleanAliases(BRAND_ALIASES).find(([, aliases]) => aliases.some((alias) => words.includes(alias)))?.[0] || null;
  const category = cleanAliases(CATEGORY_ALIASES).find(([, aliases]) => aliases.some((alias) => text.includes(alias)))?.[0] || null;
  const categoryWordIndex = category ? words.findIndex((word) => CATEGORY_ALIASES.find(([canonical]) => canonical === category)?.[1].includes(word)) : -1;
  const trailingBrandWord = !knownBrand ? /\b(?:from|by|brand)\s+([a-z][a-z0-9-]*)\b/i.exec(raw)?.[1] || null : null;
  const inferredBrandWord = !knownBrand && categoryWordIndex > 0
    ? words.slice(0, categoryWordIndex).filter((word) => !STOP_WORDS.has(word) && !isQuantityToken(word)).at(-1)
    : null;
  const requestedBrandWord = knownBrand || inferredBrandWord || trailingBrandWord;
  const brand = requestedBrandWord ? (knownBrand || `${requestedBrandWord.charAt(0).toUpperCase()}${requestedBrandWord.slice(1)}`) : null;
  const quantityValuePattern = '(?:[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
  const quantityBoundary = '(?<![A-Za-z0-9])';
  const quantityEndBoundary = '(?![A-Za-z0-9])';
  const namedQuantity = new RegExp(`${quantityBoundary}(?:quantity|qty)\\s*(?:of\\s*)?(?:[:=]\\s*)?(${quantityValuePattern})${quantityEndBoundary}`, 'i').exec(raw);
  const unitQuantity = new RegExp(`${quantityBoundary}(${quantityValuePattern})\\s+(?:units?|items?)${quantityEndBoundary}`, 'i').exec(raw);
  const bareQuantity = new RegExp(`${quantityBoundary}(?:buy|get|find|want|purchase|order)\\s+(?:(?:a|an)\\s+)?(${quantityValuePattern})${quantityEndBoundary}`, 'i').exec(raw);
  const explicitQuantityMarker = /\b(?:quantity|qty)\b/i.test(raw);
  const quantityMatch = namedQuantity || unitQuantity || bareQuantity;
  const quantityToken = quantityMatch ? quantityMatch[1] : null;
  if (explicitQuantityMarker && !quantityMatch) throw new AdapterError('INVALID_QUANTITY', 'Quantity must be a numeric or cardinal value.');
  const quantity = quantityToken === null ? 1 : quantityTokenValue(quantityToken);
  if (!Number.isFinite(quantity)) throw new AdapterError('INVALID_QUANTITY', 'Quantity must be a numeric or cardinal value.');
  const keywords = [...new Set(words.filter((word) => !STOP_WORDS.has(word) && !isQuantityToken(word)))];
  if (!keywords.length) throw new AdapterError('INVALID_PURCHASE_REQUEST', 'Purchase request must include an item keyword.');
  const product = typeof CATALOG !== 'undefined'
    ? CATALOG.find((entry) => normalizeWords(entry.item).every((word) => words.includes(word)))?.item || null
    : null;
  const productCategory = category || (product ? CATALOG.find((entry) => entry.item === product)?.productCategory || null : null);
  return {
    normalized: words.join(' '),
    brand,
    product: product || null,
    productCategory,
    quantity,
    currency: CURRENCY,
    keywords,
    budgetMinor: budget?.amountMinor ?? null,
    budget: budget ? { amountMinor: budget.amountMinor, currency: budget.currency, raw: budget.raw } : null
  };
}

function stableReference(prefix, input) {
  return `${prefix}-${crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 12).toUpperCase()}`;
}

function stableSnapshotHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

function normalizeReconciliationResult(capture, payment) {
  const captureStatus = capture?.status;
  const paymentStatus = payment?.status;
  // A definitive decline wins over a contradictory authorization signal. This
  // keeps operator intent from manufacturing a capture when the adapter knows
  // that the wallet transfer did not happen.
  const status = captureStatus === 'declined' || paymentStatus === 'declined'
    ? 'declined'
    : captureStatus === 'captured' || paymentStatus === 'authorized'
      ? 'authorized'
      : null;
  if (!status) throw new AdapterError('INVALID_RECONCILIATION_RESULT', 'The payment adapter did not return a definitive reconciliation result.');
  return {
    status,
    capture,
    payment: {
      ...(payment || {}),
      status,
      code: payment?.code || capture?.code || null,
      authorizationReference: payment?.authorizationReference || capture?.authorizationReference || null,
      captureReference: payment?.captureReference || capture?.captureReference || null,
      amountMinor: payment?.amountMinor ?? capture?.amountMinor ?? null,
      currency: payment?.currency || capture?.currency || null,
      resolvedAt: payment?.resolvedAt || capture?.reconciledAt || null
    }
  };
}

const LIFECYCLE_STAGES = ['intent', 'discovery', 'quote', 'inventory', 'funding', 'payment', 'merchant_credit', 'order', 'fulfillment', 'delivery', 'receipt', 'audit'];

function stageTemplate() {
  return LIFECYCLE_STAGES.map((stage) => ({ stage, status: 'not_started', operationId: null, reference: null, detail: null, startedAt: null, completedAt: null }));
}

function stage(task, name) {
  return task.progress.find((item) => item.stage === name);
}

function categoryFromLegacyIntent(intent) {
  if (intent?.productCategory === 'keyboards' || intent?.productCategory === 'mice' || intent?.productCategory === 'earphones') return intent.productCategory;
  return null;
}

function matchesHardIntent(candidate, intent) {
  const brandMatches = !intent?.brand || String(candidate?.brand || '').toLowerCase() === intent.brand.toLowerCase();
  const categoryMatches = !intent?.productCategory || candidate?.productCategory === intent.productCategory;
  const productMatches = !intent?.product || normalizeWords(candidate?.item || '').join(' ') === normalizeWords(intent.product).join(' ');
  return brandMatches && categoryMatches && productMatches;
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
  constructor({ store = null, clock = () => new Date(), catalog = CATALOG, timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS } = {}) {
    this.store = store;
    this.clock = clock;
    this.catalog = catalog;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  discover({ request, scenario = 'happy' } = {}) {
    this.calls += 1;
    if (scenario === 'discovery-failure') throw new AdapterError('DISCOVERY_UNAVAILABLE', 'The simulated merchant sandbox is unavailable.');
    if (['no-match', 'no-match-prepayment'].includes(scenario)) throw new AdapterError('NO_LOCAL_MATCHES', 'No seeded local merchant item matched that request. Nothing was charged.');
    const discoveredAt = now(this.clock);
    const intent = request.intent;
    const category = categoryFromLegacyIntent(intent);
    const words = new Set(intent?.keywords || []);
    const eligibleCatalog = this.catalog.filter((entry) => {
      const brandMatches = !intent?.brand || entry.brand.toLowerCase() === intent.brand.toLowerCase();
      const categoryMatches = !category || entry.productCategory === category;
      const productMatches = !intent?.product || normalizeWords(entry.item).join(' ') === normalizeWords(intent.product).join(' ');
      return brandMatches && categoryMatches && productMatches;
    });
    let candidates = eligibleCatalog
      .map((entry, index) => {
        const brandMatch = Boolean(intent?.brand && intent.brand.toLowerCase() === entry.brand.toLowerCase());
        const categoryMatch = Boolean(category && category === entry.productCategory);
        const matches = entry.keywords.filter((keyword) => words.has(keyword));
        let relevanceScore = categoryMatch ? 100 : 0;
        if (brandMatch) relevanceScore += 50;
        relevanceScore += matches.length * 5;
        if (!relevanceScore) return null;
        const forcedOutOfStock = ['out-of-stock', 'exact-out-of-stock'].includes(scenario);
        const persistedInventory = this.store?.data?.inventory?.[inventoryKey(entry)];
        const stockQuantity = forcedOutOfStock ? 0 : persistedInventory?.availableQuantity ?? entry.quantity;
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
          quoteExpiresAt: new Date(this.clock().getTime() + (['stale-quote', 'stale-quote-before-card'].includes(scenario) ? -1 : 15 * 60 * 1000)).toISOString(),
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
    if (scenario === 'ambiguous-same-brand' && candidates.length === 1) {
      const original = candidates[0];
      candidates = [original, {
        ...clone(original),
        id: `${original.id}-alternate`,
        sku: `${original.sku}-alternate`,
        variantId: `${original.variantId}-alternate`,
        item: `${original.item} Alternate`,
        variant: `${original.variant} alternate configuration`,
        evidence: { ...original.evidence, catalogId: `${original.sku}-alternate` },
        matchReasons: [...original.matchReasons, 'Same-brand alternate fixture'],
        relevanceScore: original.relevanceScore
      }];
    }
    if (!candidates.length) throw new AdapterError('NO_LOCAL_MATCHES', 'The local merchant sandbox has no keyboard, mouse, or earphone match for that request.');
    return {
      mode: SANDBOX_MODE,
      source: 'NaviPay seeded merchant sandbox',
      discoveredAt,
      intent,
      candidates,
      recommendedCandidateId: candidates[0].id,
      rankingPolicy: 'Seeded catalog policy: hard brand/category constraints, category match, brand match, keyword matches, then stable catalog order.',
      recommendationOnly: ['ambiguity', 'ambiguous', 'ambiguous-same-brand'].includes(scenario)
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

  reserve({ operationId: opId, taskId, candidate, quoteId = null, snapshotHash = null, scenario = 'happy' }) {
    this.calls.reserve += 1;
    return this.store.transaction((data) => {
      const existing = data.reservations[opId];
      if (existing) return clone(existing);
      const key = inventoryKey(candidate);
      const inventory = data.inventory[key];
      const reference = stableReference('INV-LEASE', opId);
      if (!inventory || scenario === 'out-of-stock' || inventory.availableQuantity < 1) {
        const declined = { operationId: opId, taskId, status: 'declined', code: 'OUT_OF_STOCK', reference, quantity: 1, inventoryKey: key, quoteId, snapshotHash, createdAt: now(this.clock) };
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
        quoteId,
        snapshotHash,
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

  commit({ operationId: opId, reservationReference, quoteId = null, snapshotHash = null, scenario = 'happy' }) {
    this.calls.commit += 1;
    return this.store.transaction((data) => {
      const reservation = data.reservations[opId];
      if (!reservation || reservation.reference !== reservationReference) throw new AdapterError('RESERVATION_NOT_FOUND', 'The inventory reservation could not be committed.');
      if ((quoteId && reservation.quoteId !== quoteId) || (snapshotHash && reservation.snapshotHash !== snapshotHash)) throw new AdapterError('RESERVATION_QUOTE_MISMATCH', 'The inventory reservation does not match the authoritative quote snapshot.');
      if (scenario === 'order-commit-failure') throw new AdapterError('INVENTORY_COMMIT_FAILED', 'The local inventory commit failed before confirmation.');
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
      if (reservation.status === 'committed' && reason !== 'order commit failed' && reason !== 'order confirmation failed') throw new AdapterError('RESERVATION_ALREADY_COMMITTED', 'Committed inventory cannot be released.');
      const inventory = data.inventory[reservation.inventoryKey];
      inventory.availableQuantity += reservation.quantity;
      if (reservation.status === 'reserved') inventory.reservedQuantity -= reservation.quantity;
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
      if (scenario === 'payment-decline' || ['insufficient-funds', 'low-balance'].includes(scenario)) {
        const declined = { operationId: opId, taskId, status: 'declined', code: ['insufficient-funds', 'low-balance'].includes(scenario) ? 'INSUFFICIENT_FUNDS' : 'PAYMENT_DECLINED', reference, amountMinor, currency, balanceBeforeMinor, balanceAfterPaymentMinor: null, occurredAt: now(this.clock) };
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
      if (['insufficient-funds', 'low-balance'].includes(scenario)) {
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
      const webhookId = stableReference('WEBHOOK', result.operationId);
      if (data.checkoutWebhooks.some((event) => event.id === webhookId)) return;
      data.checkoutWebhooks.push({ id: webhookId, sessionId: stableReference('CHECKOUT', taskId), type: kind === 'reversal' ? 'payment.reversed' : 'payment.refunded', status: 'received', occurredAt: result.occurredAt, reference: result.reference });
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
        status: 'pending_inventory_commit',
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
        quoteId: candidate.quoteId || null,
        snapshotHash: candidate.snapshotHash || null,
        customer: clone(customer),
        fulfillmentStatus: 'pending',
        deliveryStatus: 'pending',
        createdAt: now(this.clock)
      };
      data.orders[opId] = order;
      return clone(order);
    });
  }

  confirm({ operationId: opId, reservation, quoteId = null, snapshotHash = null } = {}) {
    return this.store.transaction((data) => {
      const order = data.orders[opId];
      if (!order) throw new AdapterError('ORDER_NOT_FOUND', 'The local order intermediate state was not found.');
      if (order.status === 'confirmed') return clone(order);
      if (order.status !== 'pending_inventory_commit' || reservation?.status !== 'committed' || (quoteId && order.quoteId !== quoteId) || (snapshotHash && order.snapshotHash !== snapshotHash)) {
        throw new AdapterError('ORDER_COMMIT_PREREQUISITES_MISSING', 'The local order could not be confirmed against committed inventory and the authoritative quote.');
      }
      order.status = 'confirmed';
      order.confirmedAt = now(this.clock);
      return clone(order);
    });
  }

  fail({ operationId: opId, code = 'ORDER_COMMIT_FAILED', message = 'The local order commit failed safely.' } = {}) {
    return this.store.transaction((data) => {
      const order = data.orders[opId];
      if (!order) return null;
      if (order.status === 'confirmed') throw new AdapterError('ORDER_ALREADY_CONFIRMED', 'The local order was already confirmed.');
      order.status = 'failed';
      order.code = code;
      order.message = message;
      order.failedAt = order.failedAt || now(this.clock);
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

function seedSandbox(store, clock = () => new Date()) {
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
    if (!data.kycProfiles[DEMO_CUSTOMER.id]) {
      const createdAt = now(clock);
      data.kycProfiles[DEMO_CUSTOMER.id] = {
        customerId: DEMO_CUSTOMER.id,
        providerId: KYC_PROVIDER_ID,
        providerMode: 'local_mock',
        providerReference: kycStableReference('MOCK-KYC', DEMO_CUSTOMER.id),
        status: 'pending',
        decisionReference: null,
        reasonCode: null,
        createdAt,
        updatedAt: createdAt,
        decidedAt: null
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
    disclosure: 'Seeded fake wallet balance plus local mock funding. No real funds or custody are involved.'
  };
}

function safeWalletTopup(topup) {
  if (!topup) return null;
  return {
    id: topup.id,
    status: topup.status,
    amountMinor: topup.amountMinor,
    amount: formatFundingAmount(topup.amountMinor),
    currency: topup.currency,
    walletId: topup.walletId,
    operationId: topup.operationId,
    actionReference: fundingStableReference('SIM-ACTION', topup.actionKey),
    transactionReference: safeReference(topup.transactionReference),
    mode: 'local_simulation',
    createdAt: topup.createdAt,
    completedAt: topup.completedAt,
    disclosure: 'Local simulated funds only. This record does not represent real money, a provider deposit, or blockchain activity.'
  };
}

function safeInventoryResource(entry, inventory) {
  return {
    sku: entry.sku,
    variantId: entry.variantId,
    item: entry.item,
    variant: entry.variant,
    brand: entry.brand,
    productCategory: entry.productCategory,
    merchantId: entry.merchantId,
    merchant: entry.merchant,
    currency: CURRENCY,
    availableQuantity: Number.isSafeInteger(inventory?.availableQuantity) ? inventory.availableQuantity : 0,
    reservedQuantity: Number.isSafeInteger(inventory?.reservedQuantity) ? inventory.reservedQuantity : 0,
    mode: 'local_simulation',
    disclosure: 'Seeded simulated inventory only. It is not live merchant stock.'
  };
}

function safeInventoryRestock(restock) {
  if (!restock) return null;
  return {
    id: restock.id,
    status: restock.status,
    sku: restock.sku,
    item: restock.item,
    merchant: restock.merchant,
    quantityAdded: restock.quantityAdded,
    availableBeforeQuantity: restock.availableBeforeQuantity,
    availableAfterQuantity: restock.availableAfterQuantity,
    operationId: safeReference(restock.operationId),
    reference: safeReference(restock.reference),
    mode: 'local_simulation',
    createdAt: restock.createdAt,
    completedAt: restock.completedAt,
    disclosure: 'Simulated stock replenishment only. It does not represent live merchant inventory.'
  };
}

function safeKycProfile(profile) {
  if (!profile) return null;
  return {
    customerId: profile.customerId,
    providerId: profile.providerId,
    providerMode: profile.providerMode,
    providerReference: safeReference(profile.providerReference),
    status: KYC_STATES.includes(profile.status) ? profile.status : 'pending',
    decisionReference: safeReference(profile.decisionReference),
    reasonCode: KYC_REASON_CODES.includes(profile.reasonCode) ? profile.reasonCode : null,
    createdAt: profile.createdAt || null,
    updatedAt: profile.updatedAt || null,
    decidedAt: profile.decidedAt || null,
    disclosure: 'LOCAL SIMULATION ONLY - this is a mock KYC gate. No identity documents were collected, stored, or verified.'
  };
}

function safeFundingEvidence(evidence) {
  if (!evidence) return null;
  return {
    type: evidence.type || 'provider_evidence',
    providerReference: safeReference(evidence.providerReference),
    network: evidence.network || null,
    asset: evidence.asset || null,
    amountMinor: evidence.amountMinor ?? null,
    transactionReference: safeReference(evidence.transactionReference),
    confirmationCount: evidence.confirmationCount ?? null,
    observedAt: evidence.observedAt || null,
    note: evidence.note || null
  };
}

function safeFundingIntent(intent) {
  if (!intent) return null;
  const instructions = intent.depositInstructions || {};
  return {
    id: intent.id,
    providerId: intent.providerId,
    providerMode: intent.providerMode,
    status: FUNDING_STATES.includes(intent.status) ? intent.status : 'pending',
    providerReference: safeReference(intent.providerReference),
    network: intent.network,
    asset: intent.asset,
    amountMinor: intent.amountMinor,
    amount: formatFundingAmount(intent.amountMinor),
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    expiresAt: intent.expiresAt,
    confirmedAt: intent.confirmedAt || null,
    failedAt: intent.failedAt || null,
    expiredAt: intent.expiredAt || null,
    reversedAt: intent.reversedAt || null,
    failureReason: intent.failureReason || null,
    confirmationEvidence: safeFundingEvidence(intent.confirmationEvidence),
    depositInstructions: {
      mode: instructions.mode || 'local_mock',
      destination: instructions.destination || null,
      memo: instructions.memo || null,
      amountMinor: instructions.amountMinor ?? intent.amountMinor,
      asset: instructions.asset || intent.asset,
      network: instructions.network || intent.network,
      expiresAt: instructions.expiresAt || intent.expiresAt,
      disclosure: instructions.disclosure || 'Local mock deposit instructions only.'
    },
    credit: intent.credit ? {
      status: intent.credit.status,
      transactionReference: safeReference(intent.credit.transactionReference),
      creditedAt: intent.credit.creditedAt || null,
      reversalTransactionReference: safeReference(intent.credit.reversalTransactionReference),
      reversedAt: intent.credit.reversedAt || null
    } : { status: 'not_credited', transactionReference: null, creditedAt: null, reversalTransactionReference: null, reversedAt: null },
    disclosure: 'LOCAL SIMULATION ONLY - this funding intent does not accept real XSGD and does not create blockchain activity.'
  };
}

const TASK_PROJECTION_VERSION = 1;
const CUSTOMER_OUTCOME_VERSION = 1;
const CUSTOMER_ACTION_VERSION = 1;

const CUSTOMER_OUTCOME_BY_FAILURE = Object.freeze({
  NO_LOCAL_MATCHES: 'no_match',
  DISCOVERY_NO_MATCH: 'no_match',
  AMBIGUOUS_MATCH: 'ambiguity',
  SPENDING_CEILING_EXCEEDED: 'over_budget',
  OUT_OF_STOCK: 'out_of_stock',
  INSUFFICIENT_FUNDS: 'insufficient_funds',
  PAYMENT_DECLINED: 'declined_payment',
  PAYMENT_DECLINED_RECONCILED: 'declined_payment',
  INVALID_PURCHASE_REQUEST: 'invalid_request',
  MISSING_PRODUCT_TYPE: 'invalid_request',
  INVALID_QUANTITY: 'invalid_request',
  QUANTITY_UNSUPPORTED: 'invalid_request',
  AUTHORITATIVE_QUOTE_MISMATCH: 'invalid_request',
  QUOTE_EXPIRED: 'invalid_request',
  KYC_NOT_APPROVED: 'invalid_request',
  MERCHANT_CATEGORY_NOT_ALLOWED: 'invalid_request',
  POLICY_BLOCKED: 'invalid_request',
  RISK_BLOCKED: 'invalid_request',
  DUPLICATE_INSTRUCTION: 'invalid_request'
});

function customerSideEffect(status, label, detail) {
  return { status, label, detail };
}

function projectCustomerSideEffects(task) {
  const paymentStatus = task.payment?.status || 'not_started';
  const payment = paymentStatus === 'unknown' || task.state === 'reconciliation_required'
    ? customerSideEffect('needs_confirmation', 'Needs confirmation', 'Payment status needs confirmation.')
    : paymentStatus === 'authorized'
      ? customerSideEffect('paid', 'Paid', 'Payment is confirmed.')
      : paymentStatus === 'refunded'
        ? customerSideEffect('refunded', 'Refunded', 'The current payment was refunded.')
        : paymentStatus === 'reversed'
          ? customerSideEffect('reversed', 'Reversed', 'The current payment was reversed.')
          : paymentStatus === 'compensated'
            ? customerSideEffect('returned', 'Payment returned', 'Payment was returned and no confirmed order remains.')
            : paymentStatus === 'declined'
              ? customerSideEffect('not_paid', 'No payment', 'Payment was declined. Nothing was paid.')
              : customerSideEffect('not_started', 'No payment', 'No payment was made.');
  const orderStatus = task.order?.status || 'not_started';
  const order = orderStatus === 'confirmed'
    ? customerSideEffect('confirmed', 'Confirmed', 'Order confirmed.')
    : orderStatus === 'failed'
      ? customerSideEffect('not_confirmed', 'No confirmed order', 'No confirmed order remains.')
      : orderStatus === 'pending_inventory_commit'
        ? customerSideEffect('processing', 'Being confirmed', 'Order confirmation is still in progress.')
        : customerSideEffect('not_started', 'No order', 'No order was created.');
  const fulfillmentStatus = task.fulfillment?.status || 'not_started';
  const fulfillment = fulfillmentStatus === 'fulfilled'
    ? customerSideEffect('prepared', 'Prepared', 'Order preparation is complete.')
    : fulfillmentStatus === 'failed'
      ? customerSideEffect('attention', 'Needs attention', 'Order preparation needs attention.')
      : fulfillmentStatus === 'pending'
        ? customerSideEffect('processing', 'In progress', 'Order preparation is in progress.')
        : customerSideEffect('not_started', 'Not started', 'Order preparation did not start.');
  const deliveryStatus = task.delivery?.status || 'not_started';
  const delivery = deliveryStatus === 'delivered'
    ? customerSideEffect('delivered', 'Delivered', 'Delivery is complete.')
    : deliveryStatus === 'failed'
      ? customerSideEffect('failed', 'Needs attention', 'Delivery could not be completed.')
      : deliveryStatus === 'pending'
        ? customerSideEffect('pending', 'Pending', task.delivery?.trackingReference ? 'Delivery is pending. Simulated tracking is available.' : 'Delivery is pending. No tracking update is available.')
        : customerSideEffect('not_started', 'No delivery update', 'Delivery did not start.');
  const receipt = task.receipt?.status === 'confirmed'
    ? customerSideEffect('ready', 'Receipt ready', 'Receipt is ready.')
    : customerSideEffect('not_started', 'No receipt', 'No receipt was issued.');
  const reservationStatus = task.inventory?.reservation?.status || 'not_started';
  const inventory = reservationStatus === 'reserved'
    ? customerSideEffect('held', 'Item held', 'The item is held while payment is confirmed.')
    : reservationStatus === 'committed'
      ? customerSideEffect('committed', 'Item committed', 'The item was committed to the order.')
      : reservationStatus === 'released'
        ? customerSideEffect('released', 'No item held', 'The item hold was released.')
        : customerSideEffect('not_started', 'No item held', 'No item was held.');
  return { payment, order, fulfillment, delivery, receipt, inventory };
}

function projectCustomerOutcome(task) {
  const sideEffects = projectCustomerSideEffects(task);
  const failureCode = task.failure?.code || null;
  const adjustment = task.receipt?.adjustment || null;
  let code = 'processing';
  let tone = 'warning';
  let title = 'Purchase in progress';
  let message = 'NaviPay is checking the item and preparing the next update.';

  if (adjustment?.status === 'failed') {
    code = 'payment_update_failed';
    tone = 'attention';
    title = 'Payment update needs review';
    message = `The original purchase remains in your receipt. The payment update did not complete. Net payment remains ${money(adjustment.netChargedMinor ?? task.financial?.netChargedMinor ?? 0)}.`;
  } else if (adjustment?.status === 'refunded' || task.payment?.status === 'refunded') {
    code = 'refund';
    tone = 'warning';
    title = 'Payment refunded';
    message = `The original purchase remains in your receipt. The current payment was refunded. Net payment: ${money(adjustment?.netChargedMinor ?? task.financial?.netChargedMinor ?? 0)}.`;
  } else if (adjustment?.status === 'reversed' || task.payment?.status === 'reversed') {
    code = 'reversal';
    tone = 'warning';
    title = 'Payment reversed';
    message = `The original purchase remains in your receipt. The current payment was reversed. Net payment: ${money(adjustment?.netChargedMinor ?? task.financial?.netChargedMinor ?? 0)}.`;
  } else if (task.payment?.status === 'unknown' || task.state === 'reconciliation_required') {
    code = 'payment_unknown';
    tone = 'warning';
    title = 'Payment status needs confirmation';
    message = 'We do not yet know whether payment went through. No automatic retry will occur.';
  } else if (task.state === 'completed' && task.delivery?.status === 'failed') {
    code = 'delivery_failed';
    tone = 'warning';
    title = 'Delivery needs attention';
    message = 'Your payment and order are confirmed, but delivery could not be completed.';
  } else if (task.state === 'completed' && task.fulfillment?.status === 'failed') {
    code = 'completed';
    tone = 'warning';
    title = 'Purchase confirmed, preparation needs attention';
    message = 'Your payment and order are confirmed, but order preparation needs attention.';
  } else if (task.state === 'completed' && task.delivery?.status === 'pending') {
    code = 'delivery_pending';
    tone = 'warning';
    title = 'Order confirmed, delivery pending';
    message = 'Your payment and order are confirmed. Delivery is still pending.';
  } else if (task.state === 'completed' && task.delivery?.status === 'delivered') {
    code = 'delivered';
    tone = 'success';
    title = 'Purchase delivered';
    message = 'Your item was delivered. Your receipt is ready.';
  } else if (task.state === 'completed') {
    code = 'completed';
    tone = 'success';
    title = 'Purchase complete';
    message = 'Your payment and order are confirmed. Your receipt is ready.';
  } else if (task.payment?.status === 'compensated') {
    code = 'payment_returned';
    tone = 'warning';
    title = 'Payment returned, no order confirmed';
    message = 'The payment was returned because the order could not be confirmed. No confirmed order or receipt remains.';
  } else if (failureCode && CUSTOMER_OUTCOME_BY_FAILURE[failureCode]) {
    code = CUSTOMER_OUTCOME_BY_FAILURE[failureCode];
    tone = ['ambiguity'].includes(code) ? 'warning' : 'attention';
    const invalidCopy = failureCode === 'MISSING_PRODUCT_TYPE'
      ? ['Name the product type', 'Name an item to buy, such as a Logitech mouse. Nothing was reserved or paid.']
      : ['KYC_NOT_APPROVED', 'MERCHANT_CATEGORY_NOT_ALLOWED', 'POLICY_BLOCKED', 'RISK_BLOCKED'].includes(failureCode)
        ? ['Purchase cannot proceed', 'This purchase cannot proceed in the local demo. Nothing was reserved or paid.']
        : failureCode === 'QUOTE_EXPIRED'
          ? ['Price check expired', 'The price check expired before payment. Nothing was reserved or paid.']
          : ['Purchase could not start', 'The purchase request could not be used. Nothing was reserved or paid.'];
    const copy = {
      no_match: ['No matching item found', 'No matching local item was found. Nothing was reserved or paid.'],
      ambiguity: ['Choose an item to continue', 'More than one item fits this request. Choose one before anything is reserved or paid.'],
      over_budget: ['Item is over the purchase limit', 'The available item is over the purchase limit. Nothing was reserved or paid.'],
      out_of_stock: ['Item is out of stock', 'The requested item is out of stock. Nothing was reserved or paid.'],
      insufficient_funds: ['Not enough balance', 'The total is more than the available balance. Nothing was paid.'],
      declined_payment: ['Payment was declined', 'Payment was declined. Nothing was paid, and no order was created.'],
      invalid_request: invalidCopy
    }[code] || ['Purchase not completed', 'The purchase was not completed. Nothing was reserved or paid.'];
    [title, message] = copy;
  } else if (task.state === 'awaiting_selection') {
    code = 'ambiguity';
    tone = 'warning';
    title = 'Choose an item to continue';
    message = 'More than one item fits this request. Choose one before anything is reserved or paid.';
  } else if (task.state === 'failed') {
    code = 'blocked';
    tone = 'attention';
    title = 'Purchase not completed';
    message = 'NaviPay could not complete this purchase. Nothing was left half-paid.';
  }

  const sideEffectsSummary = ['payment', 'order', 'fulfillment', 'delivery', 'receipt'].map((stage) => ({
    stage,
    ...sideEffects[stage]
  }));
  return {
    version: CUSTOMER_OUTCOME_VERSION,
    code,
    status: code,
    tone,
    title,
    message,
    purchaseEntered: sideEffects.payment.status !== 'not_started' || sideEffects.order.status !== 'not_started' || sideEffects.receipt.status !== 'not_started',
    purchaseStatus: task.state === 'completed' ? 'completed' : task.state === 'reconciliation_required' ? 'payment_unknown' : code,
    paymentStatus: sideEffects.payment.status,
    orderStatus: sideEffects.order.status,
    deliveryStatus: sideEffects.delivery.status,
    sideEffects,
    sideEffectsSummary,
    adjustment: adjustment ? {
      kind: adjustment.kind,
      status: adjustment.status,
      originalCaptureStatus: adjustment.originalCaptureStatus || null,
      netChargedMinor: adjustment.netChargedMinor ?? null,
      netRefundedMinor: adjustment.netRefundedMinor ?? 0,
      currency: adjustment.currency || task.currency
    } : null
  };
}

function projectNextActions(task) {
  const awaitingSelection = task.state === 'awaiting_selection';
  const paymentUnknown = task.state === 'reconciliation_required' && task.payment?.status === 'unknown';
  const hasReceipt = task.receipt?.status === 'confirmed';
  const actions = [
    {
      version: CUSTOMER_ACTION_VERSION,
      id: 'new_purchase',
      label: 'New purchase',
      enabled: true,
      policyReason: 'A separate purchase can start without changing this purchase.'
    },
    {
      version: CUSTOMER_ACTION_VERSION,
      id: 'choose_item',
      label: 'Choose an item',
      enabled: awaitingSelection,
      policyReason: awaitingSelection ? 'One item choice is needed before payment can start.' : 'No item choice is waiting for this purchase.'
    },
    {
      version: CUSTOMER_ACTION_VERSION,
      id: 'reconcile_payment',
      label: 'Check payment status',
      enabled: paymentUnknown,
      policyReason: paymentUnknown ? 'Payment status needs confirmation. No automatic retry will occur.' : 'Payment status is not waiting for confirmation.'
    },
    {
      version: CUSTOMER_ACTION_VERSION,
      id: 'view_receipt',
      label: 'View receipt',
      enabled: hasReceipt,
      policyReason: hasReceipt ? 'The confirmed receipt is available on this purchase.' : 'A receipt is available only after a confirmed order.'
    },
    {
      version: CUSTOMER_ACTION_VERSION,
      id: 'view_details',
      label: 'View purchase details',
      enabled: true,
      policyReason: 'Purchase details are available below.'
    }
  ];
  return actions;
}

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

function configuredProviderId(provider, fallback) {
  return provider?.providerId || fallback;
}

function requireProviderIdentity(actual, expected, code, message) {
  if (actual !== expected) throw new SandboxDomainError(422, code, message);
}

function safeAuthorizationEnvelope(envelope) {
  if (!envelope) return null;
  const constraints = envelope.normalizedConstraints || {};
  return {
    version: envelope.version || 1,
    purpose: envelope.purpose || DEFAULT_PURCHASE_PURPOSE,
    originalInstruction: String(envelope.originalInstruction || '').slice(0, 240),
    normalizedConstraints: {
      normalized: constraints.normalized || null,
      brand: constraints.brand || null,
      product: constraints.product || null,
      productCategory: constraints.productCategory || null,
      quantity: constraints.quantity ?? 1,
      explicitBudgetMinor: constraints.explicitBudgetMinor ?? null,
      spendingCeilingMinor: constraints.spendingCeilingMinor ?? null,
      currency: constraints.currency || CURRENCY,
      merchantScope: Array.isArray(constraints.merchantScope) ? constraints.merchantScope.map((merchant) => ({ merchantId: merchant.merchantId, merchant: merchant.merchant, merchantDomain: merchant.merchantDomain })) : []
    }
  };
}

function safeAuthorizationDecision(decision) {
  if (!decision) return null;
  return {
    version: decision.version || 1,
    decisionId: safeReference(decision.decisionId),
    status: decision.status,
    code: decision.code || null,
    reason: decision.reason,
    purpose: decision.purpose || DEFAULT_PURCHASE_PURPOSE,
    decidedAt: decision.decidedAt || null,
    quantityDecision: decision.quantityDecision ? {
      requested: decision.quantityDecision.requested,
      authorized: decision.quantityDecision.authorized,
      status: decision.quantityDecision.status,
      code: decision.quantityDecision.code || null,
      reason: decision.quantityDecision.reason
    } : null,
    checks: decision.checks ? clone(decision.checks) : {},
    candidate: decision.candidate ? {
      id: safeReference(decision.candidate.id),
      sku: safeReference(decision.candidate.sku),
      variantId: safeReference(decision.candidate.variantId),
      item: decision.candidate.item || null,
      variant: decision.candidate.variant || null,
      brand: decision.candidate.brand || null,
      productCategory: decision.candidate.productCategory || null,
      merchantId: safeReference(decision.candidate.merchantId),
      merchant: decision.candidate.merchant || null,
      merchantDomain: decision.candidate.merchantDomain || null,
      mcc: decision.candidate.mcc || '5732',
      amountMinor: decision.candidate.totalMinor ?? decision.candidate.amountMinor ?? null,
      currency: decision.candidate.currency || null,
      quoteId: safeReference(decision.candidate.quoteId),
      cartId: safeReference(decision.candidate.cartId),
      snapshotHash: safeReference(decision.candidate.snapshotHash),
      expiresAt: decision.candidate.quoteExpiresAt || decision.candidate.expiresAt || null
    } : null
  };
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
    reference: safeReference(event.reference),
    transactionReference: safeReference(event.details?.transactionReference)
  };
}

function projectPaymentAdjustment(adjustment) {
  if (!adjustment) return null;
  return {
    kind: adjustment.kind,
    status: adjustment.status,
    currentPaymentStatus: adjustment.currentPaymentStatus || null,
    originalCaptureStatus: adjustment.originalCaptureStatus || null,
    amountMinor: adjustment.amountMinor ?? null,
    currency: adjustment.currency || CURRENCY,
    netChargedMinor: adjustment.netChargedMinor ?? null,
    netRefundedMinor: adjustment.netRefundedMinor ?? 0,
    failureCode: adjustment.failureCode || null,
    reference: safeReference(adjustment.reference),
    transactionReference: safeReference(adjustment.transactionReference),
    requestedAt: adjustment.requestedAt || null,
    occurredAt: adjustment.occurredAt || null,
    compensation: adjustment.compensation ? {
      status: adjustment.compensation.status,
      amountMinor: adjustment.compensation.amountMinor ?? 0,
      reference: safeReference(adjustment.compensation.reference),
      transactionReference: safeReference(adjustment.compensation.transactionReference),
      occurredAt: adjustment.compensation.occurredAt || null
    } : null
  };
}

function projectCaptureSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    status: snapshot.status,
    paymentStatus: snapshot.paymentStatus || null,
    amountMinor: snapshot.amountMinor ?? null,
    currency: snapshot.currency || CURRENCY,
    balanceBeforeMinor: snapshot.balanceBeforeMinor ?? null,
    balanceAfterPaymentMinor: snapshot.balanceAfterPaymentMinor ?? null,
    finalBalanceMinor: snapshot.finalBalanceMinor ?? null,
    netChargedMinor: snapshot.netChargedMinor ?? null,
    paymentReference: safeReference(snapshot.paymentReference),
    transactionReference: safeReference(snapshot.transactionReference),
    authorizationReference: safeReference(snapshot.authorizationReference),
    captureReference: safeReference(snapshot.captureReference),
    capturedAt: snapshot.capturedAt || null
  };
}

function captureSnapshotFromReceipt(receipt) {
  return receipt.captureSnapshot || {
    status: 'captured',
    paymentStatus: receipt.paymentStatus || null,
    amountMinor: receipt.amountMinor ?? receipt.totalMinor ?? null,
    currency: receipt.currency || CURRENCY,
    balanceBeforeMinor: receipt.balanceBeforeMinor ?? null,
    balanceAfterPaymentMinor: receipt.balanceAfterPaymentMinor ?? null,
    finalBalanceMinor: receipt.finalBalanceMinor ?? null,
    netChargedMinor: receipt.netChargedMinor ?? null,
    paymentReference: receipt.paymentReference || null,
    transactionReference: null,
    authorizationReference: receipt.authorizationReference || null,
    captureReference: receipt.captureReference || null,
    capturedAt: receipt.issuedAt || null
  };
}

function projectReceipt(receipt) {
  if (!receipt) return null;
  return {
    status: receipt.status,
    id: safeReference(receipt.id),
    mode: receipt.mode,
    walletName: receipt.walletName || null,
    customer: receipt.customer ? {
      name: receipt.customer.name,
      addressLabel: receipt.customer.address?.label || receipt.customer.addressLabel || null,
      disclosure: receipt.customer.disclosure
    } : null,
    merchant: receipt.merchant,
    merchantId: safeReference(receipt.merchantId),
    item: receipt.item,
    variant: receipt.variant,
    subtotalMinor: receipt.subtotalMinor,
    shippingMinor: receipt.shippingMinor,
    taxMinor: receipt.taxMinor,
    amountMinor: receipt.amountMinor,
    totalMinor: receipt.totalMinor ?? receipt.amountMinor,
    currency: receipt.currency,
    balanceBeforeMinor: receipt.balanceBeforeMinor ?? null,
    balanceAfterPaymentMinor: receipt.balanceAfterPaymentMinor ?? null,
    finalBalanceMinor: receipt.finalBalanceMinor ?? null,
    netChargedMinor: receipt.netChargedMinor ?? null,
    paymentStatus: receipt.paymentStatus || null,
    paymentReference: safeReference(receipt.paymentReference),
    authorizationReference: safeReference(receipt.authorizationReference),
    captureReference: safeReference(receipt.captureReference),
    merchantCreditReference: safeReference(receipt.merchantCreditReference),
    orderReference: safeReference(receipt.orderReference),
    orderStatus: receipt.orderStatus || null,
    inventoryReservationReference: safeReference(receipt.inventoryReservationReference),
    fulfillmentStatus: receipt.fulfillmentStatus || null,
    fulfillmentReference: safeReference(receipt.fulfillmentReference),
    deliveryStatus: receipt.deliveryStatus || null,
    deliveryReference: safeReference(receipt.deliveryReference),
    trackingReference: safeReference(receipt.trackingReference),
    quoteId: safeReference(receipt.quoteId),
    cartId: safeReference(receipt.cartId),
    snapshotHash: safeReference(receipt.snapshotHash),
    captureSnapshot: projectCaptureSnapshot(captureSnapshotFromReceipt(receipt)),
    adjustment: projectPaymentAdjustment(receipt.adjustment),
    issuedAt: receipt.issuedAt || null,
    disclosure: receipt.disclosure
  };
}

function projectFinancial(task, walletBalanceMinor = null) {
  const financial = task.financial || {};
  const payment = task.payment || {};
  const compensation = task.compensation || financial.compensation || null;
  const finalBalanceMinor = financial.finalBalanceMinor ?? null;
  const netRefundedMinor = financial.netRefundedMinor ?? (compensation?.status === 'compensated' ? compensation.amountMinor || 0 : 0);
  return {
    version: 1,
    currency: task.currency,
    amountMinor: financial.amountMinor ?? task.quote?.totalMinor ?? null,
    balanceBeforeMinor: financial.balanceBeforeMinor ?? payment.balanceBeforeMinor ?? null,
    balanceAfterPaymentMinor: financial.balanceAfterPaymentMinor ?? payment.balanceAfterPaymentMinor ?? null,
    finalBalanceMinor,
    netChargedMinor: financial.netChargedMinor ?? (financial.balanceBeforeMinor != null && finalBalanceMinor != null ? financial.balanceBeforeMinor - finalBalanceMinor : null),
    netRefundedMinor,
    compensation: compensation ? {
      status: compensation.status,
      amountMinor: compensation.amountMinor ?? 0,
      reference: safeReference(compensation.reference),
      transactionReference: safeReference(compensation.transactionReference),
      occurredAt: compensation.occurredAt || null
    } : { status: 'not_required', amountMinor: 0, reference: null, transactionReference: null, occurredAt: null },
    outcome: financial.outcome || (payment.status === 'authorized' ? 'authorized' : payment.status || 'not_started')
  };
}

function projectTask(task, { operations = {}, auditEvents = [], walletBalanceMinor = null, sourceAllowlist = [], agentRun = null } = {}) {
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
    mode: task.quote.mode || null,
    quoteStatus: task.quote.quoteStatus || (task.quote.locked ? 'locked' : 'open'),
    quoteId: safeReference(task.quote.quoteId),
    cartId: safeReference(task.quote.cartId),
    snapshotHash: safeReference(task.quote.snapshotHash),
    lineSnapshot: task.quote.lineSnapshot ? clone(task.quote.lineSnapshot) : null,
    budget: task.quote.budget ? clone(task.quote.budget) : { requestedMinor: task.request?.intent?.budgetMinor ?? null, ceilingMinor: task.spendingCeilingMinor, status: 'not_started' },
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
    expiresAt: task.quote.quoteExpiresAt || selected?.quoteExpiresAt || null,
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
    adjustmentStatus: task.payment.adjustmentStatus || null,
    adjustmentReference: safeReference(task.payment.adjustmentReference),
    adjustmentTransactionReference: safeReference(task.payment.adjustmentTransactionReference),
    adjustedAt: task.payment.adjustedAt || null,
    refundReference: safeReference(task.payment.refundReference),
    reversalReference: safeReference(task.payment.reversalReference),
    balanceBeforeMinor: task.payment.balanceBeforeMinor ?? null,
    balanceAfterPaymentMinor: task.payment.balanceAfterPaymentMinor ?? null
  } : { status: 'not_started', code: null, amountMinor: quote?.totalMinor || null, currency: task.currency, reference: null, transactionReference: null, occurredAt: null, resolvedAt: null, adjustmentStatus: null, adjustmentReference: null, adjustmentTransactionReference: null, adjustedAt: null, refundReference: null, reversalReference: null, balanceBeforeMinor: null, balanceAfterPaymentMinor: null };
  return {
    version: TASK_PROJECTION_VERSION,
    taskId: task.id,
    mode: task.mode,
    disclosure: 'SIMULATED ONLY - fake wallet, seeded catalog, local order, and fixture delivery. No real funds moved.',
    state: task.state,
    lifecycle: Array.isArray(task.lifecycle) ? task.lifecycle.map((entry) => ({ state: entry.state, at: entry.at })) : [],
    purchaseStatus: task.purchaseStatus,
    paymentMode: task.paymentMode || 'issuer_authorization',
    spendingCeilingMinor: task.spendingCeilingMinor,
    budget: task.budget ? clone(task.budget) : null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    nextAction: task.automation?.nextAction || 'none',
    agent: projectCustomerAgent(agentRun),
    customerOutcome: projectCustomerOutcome(task),
    nextActions: projectNextActions(task),
    request: {
      raw: task.request?.raw || '',
      interpreted: task.request?.intent ? {
        normalized: task.request.intent.normalized,
        brand: task.request.intent.brand,
        product: task.request.intent.product || null,
        productCategory: task.request.intent.productCategory,
        quantity: task.request.intent.quantity ?? 1,
        currency: task.request.intent.currency || task.currency,
        keywords: task.request.intent.keywords,
        budgetMinor: task.request.intent.budgetMinor ?? null,
        budget: task.request.intent.budget ? clone(task.request.intent.budget) : null
      } : null
    },
    authorization: {
      envelope: safeAuthorizationEnvelope(task.authorizationEnvelope),
      decision: safeAuthorizationDecision(task.authorizationDecision)
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
        quoteId: safeReference(reservation.quoteId),
        snapshotHash: safeReference(reservation.snapshotHash),
        releasedAt: reservation.releasedAt || null,
        committedAt: reservation.committedAt || null
      } : null
    } : { status: 'not_started', reservation: null },
    wallet: task.wallet ? {
      currency: task.wallet.currency,
      balanceBeforeMinor: task.financial?.balanceBeforeMinor ?? task.wallet.balanceMinor ?? null,
      balanceAfterPaymentMinor: task.financial?.balanceAfterPaymentMinor ?? null,
      finalBalanceMinor: task.financial?.finalBalanceMinor ?? task.wallet.balanceAfterMinor ?? null,
      netChargedMinor: task.financial?.netChargedMinor ?? task.wallet.netChargedMinor ?? null,
      netRefundedMinor: task.financial?.netRefundedMinor ?? task.wallet.netRefundedMinor ?? 0
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
    } : { status: 'not_started', reference: null },
    order: task.order ? {
      status: task.order.status,
      reference: safeReference(task.order.reference),
      merchant: task.order.merchant,
      item: task.order.item,
      variant: task.order.variant,
      quoteId: safeReference(task.order.quoteId),
      snapshotHash: safeReference(task.order.snapshotHash),
      fulfillmentStatus: task.order.fulfillmentStatus,
      deliveryStatus: task.order.deliveryStatus,
      createdAt: task.order.createdAt || null
    } : { status: 'not_started', reference: null },
    fulfillment: { status: task.fulfillment?.status || 'not_started', reference: safeReference(task.fulfillment?.reference), code: task.fulfillment?.code || null, shippedAt: task.fulfillment?.shippedAt || null },
    delivery: { status: task.delivery?.status || 'not_started', reference: safeReference(task.delivery?.reference), trackingReference: safeReference(task.delivery?.trackingReference), attemptedAt: task.delivery?.attemptedAt || null, deliveredAt: task.delivery?.deliveredAt || null, code: task.delivery?.code || null },
    funding: task.funding ? {
      status: 'verified',
      asset: task.currency,
      chain: task.funding.network || null,
      evidenceReference: safeReference(task.funding.transactionReference),
      observedAt: task.funding.observedAt || null
    } : { status: 'not_started' },
    customer: task.customer ? { name: task.customer.name, addressLabel: task.customer.address?.label || null, disclosure: task.customer.disclosure } : null,
    receipt: projectReceipt(task.receipt),
    progress: (task.progress || []).map((item) => ({ stage: item.stage, status: item.status === 'pending' && !item.startedAt ? 'not_started' : item.status, reference: safeReference(item.reference), detail: item.detail, startedAt: item.startedAt, completedAt: item.completedAt })),
    failure: task.failure ? { stage: task.failure.stage, code: task.failure.code, message: task.failure.message } : null,
    operations: Object.values(operations).filter((operation) => operation.taskId === task.id).map(projectOperation),
    timeline: auditEvents.filter((event) => event.taskId === task.id).map(projectAuditEvent)
  };
}

class NaviPaySandboxService {
  constructor({ store, clock = () => new Date(), adapters = {}, modelGateway = null, agentMode = process.env.NAVIPAY_AGENT_MODE || 'recorded_replay', fundingWebhookSecret = process.env.NAVIPAY_FUNDING_WEBHOOK_SECRET || null, kycWebhookSecret = process.env.NAVIPAY_KYC_WEBHOOK_SECRET || null } = {}) {
    if (!store) throw new Error('A store is required for the local sandbox.');
    this.kind = 'sandbox';
    this.store = store;
    this.clock = clock;
    this.fundingWebhookSecret = fundingWebhookSecret;
    this.kycWebhookSecret = kycWebhookSecret;
    if (!MODES.includes(agentMode)) throw new SandboxDomainError(422, 'AGENT_MODE_UNSUPPORTED', 'P0 agent mode must be recorded_replay or deterministic_fallback.');
    this.modelGateway = modelGateway || adapters.modelGateway || createModelGateway(agentMode);
    this.fallbackModelGateway = new DeterministicFallbackGateway();
    this.agentMode = this.modelGateway.mode || agentMode;
    this.agentRegistry = new AllowlistedToolRegistry();
    this.agentPolicy = new AgentPolicyEngine({ registry: this.agentRegistry });
    seedSandbox(store, clock);
    const localDiscovery = new LocalDiscoveryAdapter({ store, clock });
    this.localDiscoveryAdapter = localDiscovery;
    this.discoveryAdapter = adapters.discovery || createConfiguredDiscoveryAdapter({ clock, fallback: localDiscovery, catalog: CATALOG });
    this.fundingAdapter = adapters.funding || new LocalFundingAdapter({ store, clock });
    this.fundingProvider = adapters.fundingProvider || new LocalMockXsgdFundingProvider({ clock });
    this.kycProvider = adapters.kycProvider || new LocalMockKycProvider({ clock });
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
      if (item && ['pending', 'not_started'].includes(item.status)) {
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
      task.purchaseStatus = 'failed';
      task.failure = { stage: stageName, code, message };
      if (!['authorized', 'compensated'].includes(task.financial?.outcome)) {
        const outcomeByCode = { NO_LOCAL_MATCHES: 'no_match', MISSING_PRODUCT_TYPE: 'invalid_intent', SPENDING_CEILING_EXCEEDED: 'over_budget', OUT_OF_STOCK: 'out_of_stock', AMBIGUOUS_MATCH: 'ambiguity', INSUFFICIENT_FUNDS: 'low_balance', KYC_NOT_APPROVED: 'kyc_blocked', MERCHANT_CATEGORY_NOT_ALLOWED: 'policy_blocked', POLICY_BLOCKED: 'policy_blocked', DUPLICATE_INSTRUCTION: 'duplicate', QUOTE_EXPIRED: 'stale_quote', PAYMENT_DECLINED: 'declined', PAYMENT_DECLINED_RECONCILED: 'declined', CAPTURE_TIMEOUT: 'unknown' };
        task.financial = { ...task.financial, outcome: outcomeByCode[code] || 'failed' };
      }
      task.automation = { ...task.automation, status: 'stopped', nextAction: 'Review the recorded result. No blind retry was attempted.', completedAt: now(this.clock) };
      const item = stage(task, stageName);
      if (item) {
        item.status = 'failed';
        item.detail = code;
        item.completedAt = now(this.clock);
      }
      const failedIndex = LIFECYCLE_STAGES.indexOf(stageName);
      for (const later of task.progress.slice(failedIndex + 1)) {
        if (['pending', 'not_started'].includes(later.status)) {
          later.status = 'skipped';
          later.detail = `Not entered after ${code}.`;
          later.completedAt = now(this.clock);
        }
      }
      if (task.quote && ['quote', 'inventory', 'payment', 'merchant_credit', 'order'].includes(stageName)) task.quote.quoteStatus = task.quote.quoteStatus === 'locked' ? task.quote.quoteStatus : 'failed';
      data.operations[opId] = { ...(data.operations[opId] || {}), id: opId, taskId, stage: stageName, status: 'failed', code, message, updatedAt: now(this.clock) };
      this._audit(data, taskId, `${stageName}.failed`, 'error', message, { operationId: opId, code, ...details });
      task.updatedAt = now(this.clock);
    });
  }

  _prepareAgentRun(taskId) {
    const task = this.getTask(taskId);
    if (!task.agentRunId) return;
    const existing = this.store.data.agentRuns[task.agentRunId];
    if (!existing || existing.proposal) return;
    let gateway = existing.mode === 'deterministic_fallback' ? this.fallbackModelGateway : this.modelGateway;
    let result;
    try {
      result = gateway.propose({ runId: existing.id, intent: task.request?.intent, context: existing.context });
    } catch (error) {
      if (!(error instanceof ModelGatewayError) && !error?.code) throw error;
      gateway = this.fallbackModelGateway;
      result = gateway.propose({ runId: existing.id, intent: task.request?.intent, context: existing.context });
    }
    this.store.transaction((data) => {
      const run = data.agentRuns[task.agentRunId];
      if (!run || run.proposal) return;
      run.mode = gateway.mode;
      run.provenance = result.prompt?.inputHash ? { ...result.provenance, promptInputHash: result.prompt.inputHash } : result.provenance;
      run.proposal = result.proposal;
      run.status = 'running';
      run.budgets.modelCalls += 1;
      appendAgentEvent(data, { runId: run.id, type: 'model.proposed', idempotencyKey: run.proposal.proposalId, payload: { proposal: run.proposal, provenance: run.provenance }, clock: this.clock });
      for (const toolProposal of run.proposal.toolProposals) appendAgentEvent(data, { runId: run.id, type: 'tool.proposed', stage: toolProposal.stage, idempotencyKey: `${toolProposal.id}-proposal`, payload: { toolProposal }, clock: this.clock });
      recordObservation(data, run, safeContextObservation(run.id, task, this.clock), this.clock);
      const fundingObservation = {
        version: 1,
        id: stableReference('OBSERVATION', `${run.id}:local-mock-funding`),
        source: 'local_mock_provider',
        kind: 'funding_evidence',
        trust: 'trusted',
        summary: 'Local mock funding event observed before discovery; no live provider activity is claimed.',
        contentHash: contentHash(`${run.id}:local_mock_funding`),
        observedAt: now(this.clock),
        promptInjectionDetected: false,
        ignored: false,
        facts: { providerMode: 'local_mock', providerId: FUNDING_PROVIDER_ID, asset: CURRENCY, network: 'simulated_local_network' }
      };
      recordObservation(data, run, fundingObservation, this.clock);
      updateStage(data, run, 'funding', 'completed', {
        reason: 'Local mock funding evidence was recorded before discovery. This is not a live deposit or wallet credit.',
        evidenceRefs: [stableReference('FUNDING-EVIDENCE', `${task.id}:local-mock`)],
        internalSteps: [{ name: 'local mock funding event', status: 'completed', reference: stableReference('FUNDING-EVENT', task.id) }]
      }, this.clock);
      const advisory = this.agentPolicy.evaluate({ proposal: run.proposal, context: run.context });
      const advisoryDecision = this.agentPolicy.fromBusinessDecision({ ...advisory, status: advisory.status === 'denied' ? 'rejected' : 'paused', code: advisory.reasonCodes[0], reason: advisory.reasons[0], checks: advisory.checks, decisionId: advisory.decisionId, decidedAt: now(this.clock) }, this.clock);
      recordBusinessPolicy(data, run, advisoryDecision, this.clock);
      saveCheckpoint(data, run, { name: 'funding-evidence-recorded', stage: 'funding', status: 'completed', resumable: true }, this.clock);
      data.agentRuns[run.id] = parseAgentRun(run);
    });
  }

  _refreshAgentRun(taskId) {
    const task = this.store.data.tasks[taskId];
    if (!task?.agentRunId || !this.store.data.agentRuns[task.agentRunId]) return;
    this.store.transaction((data) => {
      const currentTask = data.tasks[taskId];
      const run = data.agentRuns[currentTask.agentRunId];
      const internal = (names) => names.flatMap((name) => {
        const progress = currentTask.progress?.find((item) => item.stage === name);
        if (!progress) return [];
        const statusMap = { pending: 'not_started', running: 'running', completed: 'completed', failed: 'blocked', unknown: 'awaiting_input', skipped: 'skipped', not_started: 'not_started' };
        const reference = progress.reference && !/[:/?#]/.test(String(progress.reference)) ? progress.reference : progress.reference ? stableReference('STEP', progress.reference) : null;
        return [{ name, status: statusMap[progress.status] || 'not_started', reference }];
      });
      const failureStage = currentTask.failure?.stage || null;
      const discoveryStatus = currentTask.quote ? 'completed' : failureStage === 'discovery' || failureStage === 'quote' ? 'blocked' : 'not_started';
      const issuanceStatus = currentTask.card ? 'completed' : failureStage === 'payment' || failureStage === 'issuance' ? 'blocked' : currentTask.authorizationDecision?.status === 'approved' ? 'running' : 'not_started';
      const executionStatus = currentTask.receipt ? 'completed' : currentTask.state === 'reconciliation_required' || currentTask.state === 'card_issued' || currentTask.payment?.status === 'unknown' ? 'awaiting_input' : failureStage && ['payment', 'merchant_credit', 'order', 'fulfillment', 'delivery'].includes(failureStage) ? 'blocked' : currentTask.card ? 'running' : 'not_started';
      updateStage(data, run, 'discovery', discoveryStatus, { reason: currentTask.quote ? 'Discovery returned bounded candidates and the server locked or reviewed the authoritative quote.' : 'Discovery has not produced a safe quote.', evidenceRefs: currentTask.quote ? [currentTask.quote.quoteId || stableReference('QUOTE', taskId)] : [], internalSteps: internal(['discovery', 'quote']) }, this.clock);
      updateStage(data, run, 'issuance', issuanceStatus, { reason: currentTask.card ? 'The server policy approved a one-use scoped instrument.' : failureStage === 'payment' ? 'Issuance or payment was blocked by the server policy or local issuer.' : 'Issuance awaits the authoritative server policy decision.', evidenceRefs: currentTask.card?.reference ? [currentTask.card.reference] : [], internalSteps: internal(['payment']) }, this.clock);
      updateStage(data, run, 'execution', executionStatus, { reason: currentTask.receipt ? 'The local merchant, ledger, order, fulfillment, delivery, and receipt lifecycle completed.' : currentTask.payment?.status === 'unknown' ? 'Execution is waiting for explicit payment reconciliation. No retry is automatic.' : 'Execution has not produced a terminal customer outcome.', evidenceRefs: currentTask.receipt?.id ? [currentTask.receipt.id] : [], internalSteps: internal(['merchant_credit', 'order', 'fulfillment', 'delivery', 'receipt']) }, this.clock);
      const toolResults = [
        { stage: 'funding', name: 'funding.observe_local_mock', status: run.stages.find((item) => item.stage === 'funding').status, reference: run.stages.find((item) => item.stage === 'funding').evidenceRefs[0] || null, disclosure: 'Local mock funding evidence only.' },
        { stage: 'discovery', name: 'catalog.search', status: discoveryStatus, reference: currentTask.quote?.quoteId || null, disclosure: 'Bounded seeded catalog observation.' },
        { stage: 'issuance', name: 'issuance.issue_scoped_instrument', status: issuanceStatus, reference: currentTask.card?.reference || null, disclosure: 'Server-scoped local instrument result.' },
        { stage: 'execution', name: 'execution.run_local_checkout', status: executionStatus, reference: currentTask.checkout?.checkoutReference || currentTask.receipt?.id || null, disclosure: 'Simulated local checkout result, not real browser checkout.' }
      ];
      for (const toolResult of toolResults) {
        if (toolResult.status === 'not_started') continue;
        const alreadyRecorded = data.agentEvents.some((event) => event.runId === run.id && event.type === 'tool.resulted' && event.payload?.toolResult?.stage === toolResult.stage && event.payload?.toolResult?.status === toolResult.status);
        if (!alreadyRecorded) {
          appendAgentEvent(data, { runId: run.id, type: 'tool.resulted', stage: toolResult.stage, idempotencyKey: `${run.id}-tool-result-${toolResult.stage}-${toolResult.status}`, payload: { toolResult: { ...toolResult, authoritative: true } }, clock: this.clock });
          run.budgets.toolCalls += 1;
        }
      }
      if (['completed'].includes(currentTask.state)) run.status = 'completed';
      else if (['failed'].includes(currentTask.state)) run.status = 'failed';
      else if (['reconciliation_required', 'awaiting_selection'].includes(currentTask.state) || executionStatus === 'awaiting_input') run.status = 'awaiting_input';
      else if (run.proposal) run.status = 'running';
      const checkpointStage = executionStatus === 'completed' ? 'execution' : issuanceStatus === 'completed' ? 'issuance' : discoveryStatus === 'completed' ? 'discovery' : 'funding';
      const checkpointStatus = run.stages.find((item) => item.stage === checkpointStage)?.status || 'not_started';
      const checkpointName = currentTask.state === 'card_issued' ? 'card-issued' : currentTask.state === 'reconciliation_required' ? 'payment-reconciliation-required' : currentTask.state === 'completed' ? 'run-complete' : currentTask.state === 'failed' ? 'run-stopped' : `${checkpointStage}-checkpoint`;
      if (!run.checkpoint || run.checkpoint.name !== checkpointName || run.checkpoint.status !== checkpointStatus) saveCheckpoint(data, run, { name: checkpointName, stage: checkpointStage, status: checkpointStatus, resumable: !['completed', 'failed'].includes(currentTask.state) }, this.clock);
      run.outcome = { status: currentTask.state, code: currentTask.failure?.code || currentTask.authorizationDecision?.code || null, receiptReference: currentTask.receipt?.id || null, customerStatus: currentTask.purchaseStatus || currentTask.state };
      const priorOutcome = data.agentEvents.filter((event) => event.runId === run.id && event.type === 'outcome.recorded').at(-1)?.payload?.outcome;
      if (JSON.stringify(priorOutcome || null) !== JSON.stringify(run.outcome)) appendAgentEvent(data, { runId: run.id, type: 'outcome.recorded', stage: 'execution', idempotencyKey: `${run.id}-outcome-${currentTask.state}-${run.outcome.code || 'none'}-${run.outcome.receiptReference || 'none'}`, payload: { outcome: run.outcome }, clock: this.clock });
      data.agentRuns[run.id] = parseAgentRun(run);
    });
  }

  getReviewerProjection(taskId) {
    const initialTask = this.getTask(taskId);
    if (initialTask.agentRunId && !this.store.data.agentRuns[initialTask.agentRunId]?.proposal) this._prepareAgentRun(taskId);
    this._refreshAgentRun(taskId);
    const task = this.store.data.tasks[taskId];
    const run = this.store.data.agentRuns[task.agentRunId];
    if (!run) throw new SandboxDomainError(404, 'AGENT_RUN_NOT_FOUND', 'That purchase has no agent run.');
    const taskProjection = projectTask(task, { operations: this.store.data.operations, auditEvents: this.store.data.auditEvents, walletBalanceMinor: this.store.data.wallets[task.walletId]?.balanceMinor ?? null, sourceAllowlist: this.discoveryAdapter.allowlist || [], agentRun: run });
    return projectReviewerRun({ run, events: this.store.data.agentEvents.filter((event) => event.runId === run.id), taskProjection, toolRegistry: this.agentRegistry });
  }

  getReviewerProjectionByRun(runId) {
    const run = this.store.data.agentRuns[runId];
    if (!run) throw new SandboxDomainError(404, 'AGENT_RUN_NOT_FOUND', 'That agent run does not exist.');
    return this.getReviewerProjection(run.taskId);
  }

  getAgentEvents(taskId) {
    const task = this.getTask(taskId);
    return clone(this.store.data.agentEvents.filter((event) => event.runId === task.agentRunId).map((event) => ({ eventId: event.eventId, runId: event.runId, taskId: event.taskId, sequence: event.sequence, type: event.type, stage: event.stage, occurredAt: event.occurredAt, actor: event.actor, idempotencyKey: event.idempotencyKey, payloadHash: event.payloadHash, previousHash: event.previousHash })));
  }

  getAgentCheckpoint(taskId) {
    const task = this.getTask(taskId);
    const checkpoint = this.store.data.agentCheckpoints[task.agentRunId] || this.store.data.agentRuns[task.agentRunId]?.checkpoint;
    if (!checkpoint) throw new SandboxDomainError(404, 'AGENT_CHECKPOINT_NOT_FOUND', 'That purchase has no agent checkpoint.');
    return clone(checkpoint);
  }

  rebuildProjections(taskId) {
    return this.rebuildAgentProjections(taskId);
  }

  rebuildAgentProjections(taskId) {
    const task = this.getTask(taskId);
    this._refreshAgentRun(taskId);
    const run = this.store.data.agentRuns[task.agentRunId];
    const events = this.store.data.agentEvents.filter((event) => event.runId === run.id);
    const rebuiltRun = rebuildAgentRunFromEvents(run, events);
    const customer = projectTask(task, { operations: this.store.data.operations, auditEvents: this.store.data.auditEvents, walletBalanceMinor: this.store.data.wallets[task.walletId]?.balanceMinor ?? null, sourceAllowlist: this.discoveryAdapter.allowlist || [], agentRun: rebuiltRun });
    const reviewer = projectReviewerRun({ run: rebuiltRun, events, taskProjection: customer, toolRegistry: this.agentRegistry });
    return { customer, reviewer };
  }

  _response(taskId, statusCode = 200, replayed = false) {
    this._refreshAgentRun(taskId);
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

  createTask({ request, targetSite = undefined, targetUrl = undefined, scenario = 'happy', origin = 'operator', replayOf = null, paymentMode = 'issuer_authorization', allowInvalid = false, agentMode = this.agentMode } = {}) {
    if (!SANDBOX_SCENARIOS.has(scenario)) throw new SandboxDomainError(400, 'INVALID_SCENARIO', `Unknown sandbox scenario: ${scenario}.`);
    if (!MODES.includes(agentMode)) throw new SandboxDomainError(422, 'AGENT_MODE_UNSUPPORTED', 'P0 agent mode must be recorded_replay or deterministic_fallback.');
    const targetSiteRecord = this._targetSiteRecord(targetSite === undefined ? targetUrl : targetSite);
    let raw;
    let intent;
    let parseError = null;
    try {
      raw = typeof request === 'string' ? request.trim() : '';
      intent = parseRequest(raw);
    } catch (error) {
      if (!allowInvalid) throw new SandboxDomainError(422, error.code || 'INVALID_PURCHASE_REQUEST', error.message);
      raw = typeof request === 'string' ? request.trim() : '';
      parseError = { code: error.code || 'INVALID_PURCHASE_REQUEST', message: error.message || 'The purchase request could not be used.' };
      intent = { normalized: '', brand: null, product: null, productCategory: null, quantity: 1, currency: CURRENCY, keywords: [], budgetMinor: null, budget: null };
    }
    const createdAt = now(this.clock);
    const requestedBudgetMinor = intent.budgetMinor;
    const effectiveCeilingMinor = scenario === 'over-budget' ? 1 : Math.min(TASK_CEILING_MINOR, requestedBudgetMinor ?? TASK_CEILING_MINOR);
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
      spendingCeilingMinor: effectiveCeilingMinor,
      budget: {
        requestedMinor: requestedBudgetMinor ?? null,
        taskCeilingMinor: TASK_CEILING_MINOR,
        effectiveCeilingMinor,
        status: requestedBudgetMinor == null && scenario !== 'over-budget' ? 'not_specified' : 'pending'
      },
      customer: clone(DEMO_CUSTOMER),
      targetSite: targetSiteRecord,
      walletId: DEMO_WALLET.id,
      request: { raw, intent, parseError },
      authorizationEnvelope: {
        version: 1,
        purpose: DEFAULT_PURCHASE_PURPOSE,
        originalInstruction: raw,
        normalizedConstraints: {
          normalized: intent.normalized,
          brand: intent.brand,
          product: intent.product || null,
          productCategory: intent.productCategory,
          quantity: intent.quantity,
          explicitBudgetMinor: requestedBudgetMinor,
          spendingCeilingMinor: effectiveCeilingMinor,
          currency: intent.currency || CURRENCY,
          merchantScope: clone(APPROVED_MERCHANT_SCOPE)
        }
      },
      authorizationDecision: null,
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
        netRefundedMinor: 0,
        compensation: { status: 'not_required', amountMinor: 0, reference: null, transactionReference: null, occurredAt: null },
        outcome: 'not_started'
      },
      payment: null,
      merchantCredit: null,
      order: null,
      fulfillment: { status: 'not_started' },
      delivery: { status: 'not_started' },
      compensation: null,
      receipt: null,
      failure: null,
      progress: stageTemplate(),
      automation: { status: 'not_started', automatic: true, startedAt: null, completedAt: null, nextAction: 'Run purchase to begin the simulated purchase.' }
    };
    const gateway = agentMode === this.modelGateway.mode ? this.modelGateway : agentMode === 'deterministic_fallback' ? this.fallbackModelGateway : createModelGateway(agentMode);
    const provenance = gateway.getProvenance();
    const agentRun = createAgentRun({ task, mode: agentMode, provenance, clock: this.clock });
    task.agentRunId = agentRun.id;
    this.store.transaction((data) => {
      data.tasks[task.id] = task;
      data.agentRuns[agentRun.id] = agentRun;
      this._audit(data, task.id, 'purchase.created', 'info', 'Simulated purchase request recorded.', { operationId: operationId(task.id, 'intent'), request: raw, customer: DEMO_CUSTOMER.name });
      appendAgentEvent(data, { runId: agentRun.id, type: 'run.created', idempotencyKey: agentRun.id, payload: { mode: agentRun.mode, provenance: agentRun.provenance }, clock: this.clock });
      appendAgentEvent(data, { runId: agentRun.id, type: 'context.assembled', idempotencyKey: `${agentRun.id}-context`, payload: { context: agentRun.context }, clock: this.clock });
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
      sourceAllowlist: this.discoveryAdapter.allowlist || [],
      agentRun: task.agentRunId ? this.store.data.agentRuns[task.agentRunId] || null : null
    });
  }

  getReceipt(taskId) {
    const task = this.getTask(taskId);
    if (!task.receipt) throw new SandboxDomainError(404, 'RECEIPT_NOT_READY', 'The purchase has no confirmed receipt yet.');
    return projectReceipt(task.receipt);
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

  getSimulationResourcesProjection() {
    const inventory = CATALOG.map((entry) => safeInventoryResource(entry, this.store.data.inventory[inventoryKey(entry)]));
    const restocks = Object.values(this.store.data.inventoryRestocks || {})
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 20)
      .map(safeInventoryRestock);
    return {
      version: SIMULATION_RESOURCE_PROJECTION_VERSION,
      name: 'Simulation resources',
      mode: 'local_simulation',
      disclosure: 'Simulation resources only - fake XSGD balance and seeded local inventory. No real funds or live stock are used.',
      wallet: { ...publicWallet(this.store.data.wallets[DEMO_WALLET.id]), topups: this.getWalletTopups() },
      inventory,
      restocks,
      limits: {
        restockMaxQuantity: SIMULATION_RESTOCK_MAX_QUANTITY,
        restockMaxAvailableQuantity: SIMULATION_RESTOCK_MAX_AVAILABLE_QUANTITY
      }
    };
  }

  getWallet() {
    return publicWallet(this.store.data.wallets[DEMO_WALLET.id]);
  }

  getWalletTopups() {
    return Object.values(this.store.data.walletTopups || {})
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(safeWalletTopup);
  }

  getWalletAudit() {
    return this.store.data.auditEvents
      .filter((event) => event.type === 'wallet.top_up')
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .map(projectAuditEvent);
  }

  addSimulatedFunds({ idempotencyKey, amount, amountMinor, asset = FUNDING_ASSET } = {}) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) {
      throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for simulated wallet funding.');
    }
    if (asset !== FUNDING_ASSET) {
      throw new SandboxDomainError(422, 'UNSUPPORTED_CURRENCY', 'Simulated wallet funding accepts XSGD only.');
    }
    const fingerprint = JSON.stringify({ amount, amountMinor, asset, walletId: DEMO_WALLET.id });
    const key = `sandbox:wallet:top-up:${idempotencyKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) {
      const replay = clone(previous.response);
      replay.body = { ...replay.body, simulationResources: this.getSimulationResourcesProjection(), wallet: this.getWallet(), ledger: this.getWalletLedger(), topups: this.getWalletTopups(), audit: this.getWalletAudit() };
      return { ...replay, replayed: true };
    }
    let normalizedAmount;
    try {
      normalizedAmount = normalizeAmountMinor({ amount, amountMinor });
    } catch (error) {
      throw new SandboxDomainError(422, error.code || 'MALFORMED_AMOUNT', error.message);
    }
    const wallet = this.store.data.wallets[DEMO_WALLET.id];
    if (!wallet || wallet.status !== 'active' || wallet.currency !== FUNDING_ASSET) {
      throw new SandboxDomainError(503, 'FUNDING_WALLET_UNAVAILABLE', 'The fake wallet is not available for simulated funding.');
    }
    const createdAt = now(this.clock);
    const id = `simulated_topup_${crypto.randomUUID()}`;
    const operationId = `op_${id}`;
    const transactionReference = fundingStableReference('SIM-TOPUP-TX', idempotencyKey);
    const topup = {
      id,
      walletId: wallet.id,
      status: 'credited',
      amountMinor: normalizedAmount,
      currency: FUNDING_ASSET,
      operationId,
      actionKey: idempotencyKey,
      transactionReference,
      createdAt,
      completedAt: createdAt,
      mode: 'local_simulation'
    };
    this.store.transaction((data) => {
      const currentWallet = data.wallets[wallet.id];
      currentWallet.balanceMinor += normalizedAmount;
      data.walletTopups[id] = topup;
      data.walletLedger.push(
        { id: `${transactionReference}:source`, transactionReference, operationId, topupId: id, kind: 'simulation_top_up', entry: 'debit', accountId: 'operator:local-simulation', amountMinor: normalizedAmount, currency: FUNDING_ASSET, occurredAt: createdAt },
        { id: `${transactionReference}:wallet`, transactionReference, operationId, topupId: id, kind: 'simulation_top_up', entry: 'credit', accountId: wallet.id, amountMinor: normalizedAmount, currency: FUNDING_ASSET, occurredAt: createdAt }
      );
      this._audit(data, null, 'wallet.top_up', 'success', 'Simulated funds added to the fake wallet in local developer mode.', { operationId, reference: transactionReference, topupId: id, amountMinor: normalizedAmount, currency: FUNDING_ASSET, mode: 'local_simulation' });
      data.idempotency[key] = { topupId: id, requestFingerprint: fingerprint, createdAt, response: null };
    });
    const response = {
      statusCode: 201,
      body: {
        topup: safeWalletTopup(topup),
        simulationResources: this.getSimulationResourcesProjection(),
        wallet: this.getWallet(),
        ledger: this.getWalletLedger(),
        topups: this.getWalletTopups(),
        audit: this.getWalletAudit()
      },
      replayed: false
    };
    this.store.transaction((data) => { data.idempotency[key] = { ...data.idempotency[key], response: clone(response) }; });
    return response;
  }

  restockSimulationInventory({ idempotencyKey, sku, quantity } = {}) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) {
      throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for simulated inventory restock.');
    }
    const fingerprint = JSON.stringify({ sku, quantity });
    const key = `sandbox:inventory:restock:${idempotencyKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) {
      const replay = clone(previous.response);
      replay.body = { ...replay.body, simulationResources: this.getSimulationResourcesProjection() };
      return { ...replay, replayed: true };
    }
    if (typeof sku !== 'string' || !sku.trim()) {
      throw new SandboxDomainError(422, 'UNKNOWN_CATALOG_ITEM', 'Choose a seeded catalog item to restock.');
    }
    const entry = CATALOG.find((candidate) => candidate.sku === sku);
    if (!entry) {
      throw new SandboxDomainError(422, 'UNKNOWN_CATALOG_ITEM', 'That item is not in the seeded local catalog.');
    }
    let normalizedQuantity;
    if (typeof quantity === 'number') {
      normalizedQuantity = Number.isSafeInteger(quantity) ? quantity : null;
    } else if (typeof quantity === 'string' && /^[0-9]+$/.test(quantity)) {
      normalizedQuantity = Number(quantity);
    } else {
      normalizedQuantity = null;
    }
    if (!Number.isSafeInteger(normalizedQuantity) || normalizedQuantity < 1) {
      throw new SandboxDomainError(422, 'INVALID_RESTOCK_QUANTITY', 'Restock quantity must be a positive whole number.');
    }
    if (normalizedQuantity > SIMULATION_RESTOCK_MAX_QUANTITY) {
      throw new SandboxDomainError(422, 'RESTOCK_QUANTITY_LIMIT', `Restock quantity cannot exceed ${SIMULATION_RESTOCK_MAX_QUANTITY} units per action.`);
    }
    const inventoryKeyValue = inventoryKey(entry);
    const inventory = this.store.data.inventory[inventoryKeyValue];
    if (!inventory) throw new SandboxDomainError(503, 'INVENTORY_UNAVAILABLE', 'The seeded local inventory is not available.');
    const availableBeforeQuantity = inventory.availableQuantity;
    if (availableBeforeQuantity + normalizedQuantity > SIMULATION_RESTOCK_MAX_AVAILABLE_QUANTITY) {
      throw new SandboxDomainError(422, 'RESTOCK_CAPACITY_EXCEEDED', `Available simulated stock cannot exceed ${SIMULATION_RESTOCK_MAX_AVAILABLE_QUANTITY} units.`);
    }
    const createdAt = now(this.clock);
    const id = `simulated_restock_${crypto.randomUUID()}`;
    const operationId = `op_${id}`;
    const reference = stableReference('SIM-RESTOCK', idempotencyKey);
    const restock = {
      id,
      operationId,
      actionKey: idempotencyKey,
      status: 'restocked',
      sku: entry.sku,
      item: entry.item,
      merchant: entry.merchant,
      quantityAdded: normalizedQuantity,
      availableBeforeQuantity,
      availableAfterQuantity: availableBeforeQuantity + normalizedQuantity,
      reference,
      createdAt,
      completedAt: createdAt,
      mode: 'local_simulation'
    };
    this.store.transaction((data) => {
      const currentInventory = data.inventory[inventoryKeyValue];
      currentInventory.availableQuantity += normalizedQuantity;
      data.inventoryRestocks[id] = restock;
      data.operations[operationId] = {
        id: operationId,
        taskId: null,
        stage: 'simulation_resources',
        status: 'completed',
        reference,
        attempts: 1,
        startedAt: createdAt,
        completedAt: createdAt,
        updatedAt: createdAt
      };
      this._audit(data, null, 'inventory.restock', 'success', 'Simulated inventory was restocked in local developer mode.', {
        operationId,
        reference,
        sku: entry.sku,
        quantityAdded: normalizedQuantity,
        availableBeforeQuantity,
        availableAfterQuantity: currentInventory.availableQuantity,
        mode: 'local_simulation'
      });
      data.idempotency[key] = { restockId: id, requestFingerprint: fingerprint, createdAt, response: null };
    });
    const response = {
      statusCode: 201,
      body: {
        restock: safeInventoryRestock(restock),
        simulationResources: this.getSimulationResourcesProjection()
      },
      replayed: false
    };
    this.store.transaction((data) => { data.idempotency[key] = { ...data.idempotency[key], response: clone(response) }; });
    return response;
  }

  getKycStatus() {
    const profile = this.store.data.kycProfiles[DEMO_CUSTOMER.id];
    if (!profile) throw new SandboxDomainError(503, 'KYC_UNAVAILABLE', 'The local KYC gate is unavailable.');
    return clone(profile);
  }

  getKycProjection() {
    const profile = this.getKycStatus();
    let status;
    try {
      status = this.kycProvider.getStatus({ profile });
      requireProviderIdentity(status.providerId, configuredProviderId(this.kycProvider, KYC_PROVIDER_ID), 'KYC_PROVIDER_MISMATCH', 'The normalized KYC status came from an unexpected provider.');
    } catch (error) {
      if (error instanceof SandboxDomainError) throw error;
      throw new SandboxDomainError(503, error.code || 'KYC_UNAVAILABLE', error.message || 'The local KYC gate is unavailable.');
    }
    return safeKycProfile({ ...profile, ...status, customerId: profile.customerId, createdAt: profile.createdAt });
  }

  simulateKycDecision(idempotencyKey, action, reasonCode = null) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for the KYC simulation.');
    const normalizedAction = normalizeDecision(action);
    const fingerprint = JSON.stringify({ action: normalizedAction, reasonCode: reasonCode || null });
    const key = `sandbox:kyc:simulate:${idempotencyKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const profile = this.getKycStatus();
    let decision;
    try {
      const decisionSequence = Object.keys(this.store.data.kycEvents).length;
      decision = this.kycProvider.receiveDecision({ profile, decisionId: kycStableReference('MOCK-KYC-EVENT', `${profile.providerReference}:${normalizedAction}:${decisionSequence}`), action: normalizedAction, reasonCode });
    } catch (error) {
      throw new SandboxDomainError(422, error.code || 'INVALID_KYC_DECISION', error.message || 'The local KYC decision could not be simulated.');
    }
    const response = this._applyKycDecision({ idempotencyKey: key, fingerprint, decision });
    this.store.transaction((data) => { data.idempotency[key] = { requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(response) }; });
    return response;
  }

  receiveKycDecision({ idempotencyKey = null, decision = {} } = {}) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) throw new SandboxDomainError(400, 'INVALID_KYC_DECISION', 'KYC provider decision must be a JSON object.');
    const decisionId = decision.decisionId;
    if (typeof decisionId !== 'string' || !decisionId.trim() || decisionId.length > 200) throw new SandboxDomainError(422, 'INVALID_KYC_DECISION', 'KYC provider decision must include a bounded decisionId.');
    const expectedProviderId = configuredProviderId(this.kycProvider, KYC_PROVIDER_ID);
    requireProviderIdentity(decision.providerId, expectedProviderId, 'KYC_PROVIDER_MISMATCH', 'The KYC decision provider does not match the configured KYC provider.');
    const requestKey = idempotencyKey || decisionId;
    const fingerprint = JSON.stringify({ decisionId, providerId: decision.providerId, providerReference: decision.providerReference, action: decision.action, status: decision.status, reasonCode: decision.reasonCode || decision.reason });
    const key = `sandbox:kyc:event:${requestKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const profile = this.getKycStatus();
    if (profile.providerReference !== decision.providerReference) throw new SandboxDomainError(404, 'KYC_REFERENCE_NOT_FOUND', 'The KYC provider reference does not match the local profile.');
    const previousEvent = this.store.data.kycEvents[decisionId];
    if (previousEvent) {
      if (previousEvent.fingerprint !== fingerprint) throw new SandboxDomainError(409, 'KYC_DECISION_REUSED', 'The KYC decision ID was already used for different data.');
      const replay = this._kycResponse(true);
      this.store.transaction((data) => { data.idempotency[key] = { requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(replay) }; });
      return replay;
    }
    let normalizedDecision;
    try {
      normalizedDecision = this.kycProvider.receiveDecision({ profile, ...decision, decisionId });
      requireProviderIdentity(normalizedDecision.providerId, expectedProviderId, 'KYC_PROVIDER_MISMATCH', 'The normalized KYC decision came from an unexpected provider.');
    } catch (error) {
      if (error instanceof SandboxDomainError) throw error;
      throw new SandboxDomainError(422, error.code || 'INVALID_KYC_DECISION', error.message || 'The KYC provider decision could not be normalized.');
    }
    const response = this._applyKycDecision({ idempotencyKey: key, fingerprint, decision: normalizedDecision });
    this.store.transaction((data) => { data.idempotency[key] = { requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(response) }; });
    return response;
  }

  _kycResponse(replayed = false, decision = null) {
    return { statusCode: 200, body: { kyc: this.getKycProjection(), funding: this.getFundingProjection(), decision: decision ? { decisionId: decision.decisionId, status: decision.status, decisionReference: safeReference(decision.decisionReference) } : null }, replayed };
  }

  _applyKycDecision({ fingerprint, decision } = {}) {
    requireProviderIdentity(decision?.providerId, configuredProviderId(this.kycProvider, KYC_PROVIDER_ID), 'KYC_PROVIDER_MISMATCH', 'The KYC decision provider does not match the configured KYC provider.');
    const profileId = DEMO_CUSTOMER.id;
    const duplicate = this.store.transaction((data) => {
      const previous = data.kycEvents[decision.decisionId];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new SandboxDomainError(409, 'KYC_DECISION_REUSED', 'The KYC decision ID was already used for different data.');
        return true;
      }
      const profile = data.kycProfiles[profileId];
      const nextStatus = decision.status;
      const allowed = profile.status === nextStatus || profile.status === 'pending' || profile.status === 'approved' && ['pending', 'rejected'].includes(nextStatus) || profile.status === 'rejected' && ['pending', 'approved'].includes(nextStatus);
      if (!allowed) throw new SandboxDomainError(409, 'INVALID_KYC_TRANSITION', `KYC status cannot move from ${profile.status} to ${nextStatus}.`);
      profile.status = nextStatus;
      profile.providerId = decision.providerId || profile.providerId;
      profile.providerMode = decision.providerMode || profile.providerMode;
      profile.decisionReference = decision.decisionReference;
      profile.reasonCode = decision.reasonCode || null;
      profile.decidedAt = decision.decidedAt;
      profile.updatedAt = decision.decidedAt;
      data.kycEvents[decision.decisionId] = { decisionId: decision.decisionId, providerReference: profile.providerReference, status: nextStatus, fingerprint, receivedAt: decision.decidedAt };
      return false;
    });
    return this._kycResponse(duplicate, decision);
  }

  reconcileKycReference(options = {}) {
    const expectedProviderId = configuredProviderId(this.kycProvider, KYC_PROVIDER_ID);
    if (typeof options === 'string') options = { providerReference: options, providerId: expectedProviderId };
    const { idempotencyKey = null, providerId = null, providerReference } = options;
    if (typeof providerReference !== 'string' || !providerReference.trim()) throw new SandboxDomainError(400, 'PROVIDER_REFERENCE_REQUIRED', 'Provide a KYC provider reference to reconcile.');
    requireProviderIdentity(providerId, expectedProviderId, 'KYC_PROVIDER_MISMATCH', 'The KYC reference provider does not match the configured KYC provider.');
    const requestKey = idempotencyKey || `kyc-reconcile-${providerReference}`;
    const fingerprint = JSON.stringify({ providerId, providerReference });
    const key = `sandbox:kyc:reconcile:${requestKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const profile = this.getKycStatus();
    if (profile.providerReference !== providerReference) throw new SandboxDomainError(404, 'KYC_REFERENCE_NOT_FOUND', 'The KYC provider reference does not match the local profile.');
    let status;
    try {
      status = this.kycProvider.reconcileReference({ profile, providerReference });
      requireProviderIdentity(status.providerId, expectedProviderId, 'KYC_PROVIDER_MISMATCH', 'The normalized KYC status came from an unexpected provider.');
    } catch (error) {
      if (error instanceof SandboxDomainError) throw error;
      throw new SandboxDomainError(422, error.code || 'KYC_RECONCILIATION_FAILED', error.message || 'The KYC reference could not be reconciled.');
    }
    const response = { statusCode: 200, body: { kyc: this.getKycProjection(), status: { providerReference: safeReference(status.providerReference), status: status.status, decisionReference: safeReference(status.decisionReference), decidedAt: status.decidedAt || null }, funding: this.getFundingProjection() }, replayed: false };
    this.store.transaction((data) => { data.idempotency[key] = { requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(response) }; });
    return response;
  }

  _expireFundingIntents() {
    const timestamp = this.clock().getTime();
    this.store.transaction((data) => {
      for (const intent of Object.values(data.fundingIntents)) {
        if (intent.status !== 'pending' || !intent.expiresAt || Date.parse(intent.expiresAt) > timestamp) continue;
        intent.status = 'expired';
        intent.expiredAt = intent.expiredAt || now(this.clock);
        intent.updatedAt = intent.expiredAt;
        intent.failureReason = intent.failureReason || 'The local deposit intent expired before confirmation.';
      }
    });
  }

  _fundingResponse(intentId, statusCode = 200, replayed = false, extra = {}) {
    const intent = this.getFundingIntent(intentId);
    return {
      statusCode,
      body: { intent: safeFundingIntent(intent), funding: this.getFundingProjection(), ...extra },
      replayed
    };
  }

  getFundingIntent(intentId) {
    this._expireFundingIntents();
    const intent = this.store.data.fundingIntents[intentId];
    if (!intent) throw new SandboxDomainError(404, 'FUNDING_INTENT_NOT_FOUND', 'That funding intent does not exist.');
    return clone(intent);
  }

  getFundingStatus(intentId) {
    const intent = this.getFundingIntent(intentId);
    let status;
    try {
      status = this.fundingProvider.getFundingStatus({ intent });
      requireProviderIdentity(status.providerId, configuredProviderId(this.fundingProvider, FUNDING_PROVIDER_ID), 'FUNDING_PROVIDER_MISMATCH', 'The normalized funding status came from an unexpected provider.');
    } catch (error) {
      if (error instanceof SandboxDomainError) throw error;
      throw new SandboxDomainError(503, error.code || 'FUNDING_STATUS_UNAVAILABLE', error.message || 'The funding provider status could not be retrieved.');
    }
    return { ...intent, status: status.status, confirmationEvidence: status.confirmationEvidence || intent.confirmationEvidence, failureReason: status.failureReason || intent.failureReason, updatedAt: status.updatedAt || intent.updatedAt };
  }

  getFundingProjection() {
    this._expireFundingIntents();
    const intents = Object.values(this.store.data.fundingIntents).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const providerId = this.fundingProvider.providerId || FUNDING_PROVIDER_ID;
    const providerMode = this.fundingProvider.providerMode || (this.fundingProvider instanceof LocalMockXsgdFundingProvider ? 'local_mock' : 'configured');
    return {
      version: 1,
      provider: {
        id: providerId,
        mode: providerMode,
        live: false,
        disclosure: providerMode === 'local_mock' ? 'Local deterministic mock provider. No real XSGD, wallet, or Avalanche transaction is involved.' : 'Provider adapter is configured server-side and its live status is not represented by this local projection.'
      },
      asset: FUNDING_ASSET,
      network: FUNDING_NETWORK,
      availableBalanceMinor: this.store.data.wallets[DEMO_WALLET.id]?.balanceMinor ?? null,
      wallet: this.getWallet(),
      kyc: this.getKycProjection(),
      intents: intents.map(safeFundingIntent),
      disclosure: 'LOCAL SIMULATION ONLY - funding controls exercise a credential-free mock lifecycle and never accept real deposits.'
    };
  }

  createFundingIntent({ idempotencyKey, amount, amountMinor, asset = FUNDING_ASSET, network = FUNDING_NETWORK, providerId = null } = {}) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for the funding intent.');
    const selectedProviderId = providerId || this.fundingProvider.providerId || FUNDING_PROVIDER_ID;
    const fingerprint = JSON.stringify({ amount, amountMinor, asset, network, providerId: selectedProviderId, walletId: DEMO_WALLET.id });
    const key = `sandbox:funding:create:${idempotencyKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    let normalizedAmount;
    try {
      normalizedAmount = normalizeAmountMinor({ amount, amountMinor });
    } catch (error) {
      throw new SandboxDomainError(422, error.code || 'MALFORMED_AMOUNT', error.message);
    }
    const kyc = this.getKycProjection();
    if (kyc.status !== 'approved') throw new SandboxDomainError(409, 'KYC_NOT_APPROVED', `XSGD funding requires approved KYC; current status is ${kyc.status}.`, { status: kyc.status, providerReference: safeReference(kyc.providerReference), decisionReference: safeReference(kyc.decisionReference) });
    if (selectedProviderId !== this.fundingProvider.providerId) throw new SandboxDomainError(422, 'UNSUPPORTED_FUNDING_PROVIDER', 'The requested funding provider is not configured server-side.');
    const wallet = this.store.data.wallets[DEMO_WALLET.id];
    if (!wallet || wallet.status !== 'active' || wallet.currency !== FUNDING_ASSET) throw new SandboxDomainError(503, 'FUNDING_WALLET_UNAVAILABLE', 'The fake wallet is not available for funding.');
    const createdAt = now(this.clock);
    const expiresAt = new Date(this.clock().getTime() + 30 * 60 * 1000).toISOString();
    const id = `funding_${crypto.randomUUID()}`;
    let providerIntent;
    try {
      providerIntent = this.fundingProvider.createFundingIntent({ intentId: id, amountMinor: normalizedAmount, asset, network, expiresAt });
      requireProviderIdentity(providerIntent.providerId, selectedProviderId, 'FUNDING_PROVIDER_MISMATCH', 'The normalized funding intent came from an unexpected provider.');
    } catch (error) {
      if (error instanceof SandboxDomainError) throw error;
      throw new SandboxDomainError(422, error.code || 'FUNDING_PROVIDER_UNAVAILABLE', error.message || 'The funding provider could not create an intent.');
    }
    const intent = {
      id,
      walletId: DEMO_WALLET.id,
      providerId: providerIntent.providerId || selectedProviderId,
      providerMode: providerIntent.providerMode || 'configured',
      status: 'pending',
      providerReference: providerIntent.providerReference,
      network: providerIntent.network,
      asset: providerIntent.asset,
      amountMinor: providerIntent.amountMinor,
      depositInstructions: providerIntent.depositInstructions,
      confirmationEvidence: null,
      failureReason: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt: providerIntent.expiresAt || expiresAt,
      confirmedAt: null,
      failedAt: null,
      expiredAt: null,
      reversedAt: null,
      credit: { status: 'not_credited', transactionReference: null, creditedAt: null, reversalTransactionReference: null, reversedAt: null }
    };
    this.store.transaction((data) => {
      data.fundingIntents[id] = intent;
      data.idempotency[key] = { intentId: id, requestFingerprint: fingerprint, createdAt, response: null };
    });
    const response = this._fundingResponse(id, 201, false);
    this.store.transaction((data) => { data.idempotency[key] = { ...data.idempotency[key], response: clone(response) }; });
    return response;
  }

  receiveFundingEvent({ idempotencyKey = null, event = {} } = {}) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new SandboxDomainError(400, 'INVALID_FUNDING_EVENT', 'Funding provider event must be a JSON object.');
    const eventId = event.eventId;
    if (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 200) throw new SandboxDomainError(422, 'INVALID_PROVIDER_EVENT', 'Funding provider event must include a bounded eventId.');
    const expectedProviderId = configuredProviderId(this.fundingProvider, FUNDING_PROVIDER_ID);
    requireProviderIdentity(event.providerId, expectedProviderId, 'FUNDING_PROVIDER_MISMATCH', 'The funding event provider does not match the configured funding provider.');
    const requestKey = idempotencyKey || eventId;
    const fingerprint = JSON.stringify({ eventId, providerId: event.providerId, providerReference: event.providerReference, action: event.action, status: event.status, asset: event.asset, network: event.network, amountMinor: event.amountMinor, reason: event.reason });
    const key = `sandbox:funding:event:${requestKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const rawIntent = Object.values(this.store.data.fundingIntents).find((candidate) => candidate.providerReference === event.providerReference);
    if (!rawIntent) throw new SandboxDomainError(404, 'PROVIDER_REFERENCE_NOT_FOUND', 'The funding provider reference does not match a persisted intent.');
    this._expireFundingIntents();
    const intent = this.store.data.fundingIntents[rawIntent.id];
    const previousEvent = this.store.data.fundingEvents[eventId];
    if (previousEvent) {
      if (previousEvent.fingerprint !== fingerprint) throw new SandboxDomainError(409, 'PROVIDER_EVENT_REUSED', 'The provider event ID was already used for different funding data.');
      const replay = this._fundingResponse(intent.id, 200, true, { duplicateEvent: true });
      this.store.transaction((data) => { data.idempotency[key] = { intentId: intent.id, requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(replay) }; });
      return replay;
    }
    let normalizedEvent;
    try {
      normalizedEvent = this.fundingProvider.receiveProviderEvent({ intent: clone(intent), ...event, eventId });
      requireProviderIdentity(normalizedEvent.providerId, expectedProviderId, 'FUNDING_PROVIDER_MISMATCH', 'The normalized funding event came from an unexpected provider.');
    } catch (error) {
      if (error instanceof SandboxDomainError) throw error;
      throw new SandboxDomainError(422, error.code || 'INVALID_PROVIDER_EVENT', error.message || 'The funding provider event could not be normalized.');
    }
    let duplicateCredit = false;
    if (normalizedEvent.status === 'confirmed' && intent.status === 'pending') {
      const kyc = this.getKycProjection();
      if (kyc.status !== 'approved') throw new SandboxDomainError(409, 'KYC_NOT_APPROVED', `XSGD funding credit requires approved KYC; current status is ${kyc.status}.`, { status: kyc.status, providerReference: safeReference(kyc.providerReference), decisionReference: safeReference(kyc.decisionReference) });
    }
    try {
      this.store.transaction((data) => {
        const current = data.fundingIntents[intent.id];
        const nextStatus = normalizedEvent.status;
        const allowed = current.status === nextStatus
          || current.status === 'pending' && ['confirmed', 'failed', 'expired'].includes(nextStatus)
          || current.status === 'confirmed' && nextStatus === 'reversed';
        if (!allowed) throw new SandboxDomainError(409, 'INVALID_FUNDING_TRANSITION', `Funding intent cannot move from ${current.status} to ${nextStatus}.`);
        if (current.status === nextStatus && nextStatus === 'confirmed' && data.fundingCredits[current.id]) duplicateCredit = true;
        if (current.status === 'pending' && nextStatus === 'confirmed') {
          const kyc = data.kycProfiles[DEMO_CUSTOMER.id];
          if (!kyc || kyc.status !== 'approved') throw new SandboxDomainError(409, 'KYC_NOT_APPROVED', `XSGD funding credit requires approved KYC; current status is ${kyc?.status || 'unavailable'}.`, { status: kyc?.status || 'unavailable', providerReference: safeReference(kyc?.providerReference), decisionReference: safeReference(kyc?.decisionReference) });
          const wallet = data.wallets[current.walletId];
          if (!wallet || wallet.currency !== current.asset) throw new SandboxDomainError(503, 'FUNDING_WALLET_UNAVAILABLE', 'The authoritative fake wallet is unavailable for funding credit.');
          const existingCredit = data.fundingCredits[current.id];
          if (existingCredit?.status === 'credited' || existingCredit?.status === 'reversed') {
            duplicateCredit = true;
          } else {
            const transactionReference = fundingStableReference('FUNDING-TX', current.id);
            const occurredAt = normalizedEvent.receivedAt;
            wallet.balanceMinor += current.amountMinor;
            data.walletLedger.push(
              { id: `${transactionReference}:source`, transactionReference, operationId: `funding:${current.id}`, intentId: current.id, kind: 'funding', entry: 'debit', accountId: `provider:${current.providerId}`, amountMinor: current.amountMinor, currency: current.asset, occurredAt },
              { id: `${transactionReference}:wallet`, transactionReference, operationId: `funding:${current.id}`, intentId: current.id, kind: 'funding', entry: 'credit', accountId: current.walletId, amountMinor: current.amountMinor, currency: current.asset, occurredAt }
            );
            data.fundingCredits[current.id] = { intentId: current.id, status: 'credited', transactionReference, creditedAt: occurredAt, reversalTransactionReference: null, reversedAt: null };
            current.credit = data.fundingCredits[current.id];
          }
          current.confirmedAt = current.confirmedAt || normalizedEvent.receivedAt;
          current.confirmationEvidence = normalizedEvent.confirmationEvidence;
        } else if (current.status === 'confirmed' && nextStatus === 'reversed') {
          const credit = data.fundingCredits[current.id];
          const wallet = data.wallets[current.walletId];
          if (!credit || !['credited'].includes(credit.status)) throw new SandboxDomainError(409, 'FUNDING_NOT_CREDITED', 'Only credited funding can be reversed.');
          if (!wallet || wallet.balanceMinor < current.amountMinor) throw new SandboxDomainError(409, 'INSUFFICIENT_FUNDS_FOR_REVERSAL', 'The fake wallet does not have enough balance to reverse this funding credit.');
          const transactionReference = fundingStableReference('FUNDING-REVERSAL', current.id);
          wallet.balanceMinor -= current.amountMinor;
          data.walletLedger.push(
            { id: `${transactionReference}:wallet`, transactionReference, operationId: `funding:${current.id}:reversal`, intentId: current.id, kind: 'funding_reversal', entry: 'debit', accountId: current.walletId, amountMinor: current.amountMinor, currency: current.asset, occurredAt: normalizedEvent.receivedAt },
            { id: `${transactionReference}:source`, transactionReference, operationId: `funding:${current.id}:reversal`, intentId: current.id, kind: 'funding_reversal', entry: 'credit', accountId: `provider:${current.providerId}`, amountMinor: current.amountMinor, currency: current.asset, occurredAt: normalizedEvent.receivedAt }
          );
          credit.status = 'reversed';
          credit.reversalTransactionReference = transactionReference;
          credit.reversedAt = normalizedEvent.receivedAt;
          current.credit = credit;
          current.reversedAt = normalizedEvent.receivedAt;
          current.confirmationEvidence = normalizedEvent.confirmationEvidence || current.confirmationEvidence;
        } else if (current.status === 'pending' && nextStatus === 'failed') {
          current.failedAt = current.failedAt || normalizedEvent.receivedAt;
          current.failureReason = normalizedEvent.reason || 'The local funding provider reported a failure.';
        } else if (current.status === 'pending' && nextStatus === 'expired') {
          current.expiredAt = current.expiredAt || normalizedEvent.receivedAt;
          current.failureReason = normalizedEvent.reason || 'The funding intent expired before confirmation.';
        }
        if (current.status !== nextStatus && !duplicateCredit) current.status = nextStatus;
        current.updatedAt = normalizedEvent.receivedAt;
        data.fundingEvents[eventId] = { eventId, intentId: current.id, providerReference: current.providerReference, status: nextStatus, fingerprint, receivedAt: normalizedEvent.receivedAt };
        if (!data.fundingEvents[eventId]) throw new SandboxDomainError(500, 'FUNDING_EVENT_NOT_RECORDED', 'The funding provider event could not be recorded.');
      });
    } catch (error) {
      if (error instanceof SandboxDomainError) throw error;
      throw new SandboxDomainError(409, error.code || 'FUNDING_EVENT_REJECTED', error.message || 'The funding provider event was rejected.');
    }
    const response = this._fundingResponse(intent.id, 200, false, { duplicateCredit, event: { eventId, status: normalizedEvent.status } });
    this.store.transaction((data) => { data.idempotency[key] = { intentId: intent.id, requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(response) }; });
    return response;
  }

  simulateFundingIntent(intentId, idempotencyKey, action) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for the funding simulation.');
    const normalizedAction = normalizeAction(action);
    const fingerprint = JSON.stringify({ intentId, action: normalizedAction });
    const key = `sandbox:funding:simulate:${idempotencyKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const intent = this.getFundingIntent(intentId);
    if (typeof this.fundingProvider.simulate !== 'function') throw new SandboxDomainError(409, 'LOCAL_SIMULATION_UNAVAILABLE', 'This funding provider does not expose the local simulation path.');
    let event;
    try {
      event = this.fundingProvider.simulate({ intent, action: normalizedAction });
    } catch (error) {
      throw new SandboxDomainError(422, error.code || 'INVALID_SIMULATION_ACTION', error.message || 'The local funding simulation could not run.');
    }
    const response = this.receiveFundingEvent({ idempotencyKey: key, event });
    this.store.transaction((data) => { data.idempotency[key] = { intentId, requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(response) }; });
    return response;
  }

  reconcileFundingReference(options = {}) {
    const expectedProviderId = configuredProviderId(this.fundingProvider, FUNDING_PROVIDER_ID);
    if (typeof options === 'string') options = { providerReference: options, providerId: expectedProviderId };
    const { idempotencyKey = null, providerId = null, providerReference } = options;
    if (typeof providerReference !== 'string' || !providerReference.trim()) throw new SandboxDomainError(400, 'PROVIDER_REFERENCE_REQUIRED', 'Provide a funding provider reference to reconcile.');
    requireProviderIdentity(providerId, expectedProviderId, 'FUNDING_PROVIDER_MISMATCH', 'The funding reference provider does not match the configured funding provider.');
    const requestKey = idempotencyKey || `funding-reconcile-${providerReference}`;
    const fingerprint = JSON.stringify({ providerId, providerReference });
    const key = `sandbox:funding:reconcile:${requestKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const intent = Object.values(this.store.data.fundingIntents).find((candidate) => candidate.providerReference === providerReference);
    if (!intent) throw new SandboxDomainError(404, 'PROVIDER_REFERENCE_NOT_FOUND', 'The funding provider reference does not match a persisted intent.');
    this._expireFundingIntents();
    let status;
    try {
      status = this.fundingProvider.reconcileReference({ intent: this.getFundingIntent(intent.id), providerReference });
      requireProviderIdentity(status.providerId, expectedProviderId, 'FUNDING_PROVIDER_MISMATCH', 'The normalized funding status came from an unexpected provider.');
    } catch (error) {
      if (error instanceof SandboxDomainError) throw error;
      throw new SandboxDomainError(422, error.code || 'FUNDING_RECONCILIATION_FAILED', error.message || 'The funding reference could not be reconciled.');
    }
    const response = { statusCode: 200, body: { intent: safeFundingIntent(this.getFundingIntent(intent.id)), status: { providerReference: safeReference(status.providerReference), status: status.status, asset: status.asset, network: status.network, amountMinor: status.amountMinor, confirmationEvidence: safeFundingEvidence(status.confirmationEvidence), failureReason: status.failureReason || null }, funding: this.getFundingProjection() }, replayed: false };
    this.store.transaction((data) => { data.idempotency[key] = { requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(response) }; });
    return response;
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
      this._audit(data, taskId, type, status, summary, { operationId: operationId(taskId, stageName), reference: result?.reference || result?.transactionReference || null, transactionReference: result?.transactionReference || null, status: result?.status || null });
    });
  }

  _recordAuthorizationDecision(taskId, { status, code = null, reason, checks = {}, candidate = null } = {}) {
    const task = this.getTask(taskId);
    const requestedQuantity = task.request?.intent?.quantity ?? 1;
    const quantityAllowed = requestedQuantity === 1;
    const decision = {
      version: 1,
      decisionId: stableReference('AUTHZ', `${task.id}:${status}:${code || 'approved'}:${task.quote?.snapshotHash || 'unlocked'}`),
      status,
      code,
      reason,
      purpose: task.authorizationEnvelope?.purpose || DEFAULT_PURCHASE_PURPOSE,
      decidedAt: now(this.clock),
      quantityDecision: {
        requested: requestedQuantity,
        authorized: 1,
        status: quantityAllowed ? 'passed' : 'failed',
        code: quantityAllowed ? null : 'QUANTITY_UNSUPPORTED',
        reason: quantityAllowed ? 'Exactly one unit was requested and is authorized.' : 'This authorization permits exactly one unit; the requested quantity was not authorized.'
      },
      checks,
      candidate: candidate ? clone(candidate) : null
    };
    this._updateTask(taskId, (current) => { current.authorizationDecision = decision; });
    this.store.transaction((data) => {
      this._audit(data, taskId, status === 'approved' ? 'authorization.approved' : 'authorization.stopped', status === 'approved' ? 'success' : status === 'paused' ? 'warning' : 'error', reason, {
        operationId: `op_${taskId}_authorization`,
        reference: decision.decisionId,
        code,
        decision: safeAuthorizationDecision(decision)
      });
      const run = data.agentRuns[task.agentRunId];
      if (run) recordBusinessPolicy(data, run, this.agentPolicy.fromBusinessDecision(decision, this.clock), this.clock);
    });
    return decision;
  }

  _bootstrapDefaultLocalKyc(task) {
    if (['pending-kyc', 'rejected-kyc'].includes(task.scenario)) return;
    if (this.kycProvider.providerId !== KYC_PROVIDER_ID) return;
    if (Object.keys(this.store.data.kycEvents || {}).length > 0) return;
    const profile = this.getKycStatus();
    if (profile.status !== 'pending' || typeof this.kycProvider.receiveDecision !== 'function') return;
    try {
      const decision = this.kycProvider.receiveDecision({
        profile,
        decisionId: kycStableReference('MOCK-KYC-AUTO', task.id),
        action: 'approve',
        reasonCode: 'simulated_approval'
      });
      this._applyKycDecision({ fingerprint: JSON.stringify({ taskId: task.id, automatic: true }), decision });
      this.store.transaction((data) => {
        this._audit(data, task.id, 'authorization.kyc_ready', 'info', 'The local mock KYC fixture was approved for this one-instruction simulation.', { operationId: `op_${task.id}_authorization`, status: 'approved' });
      });
    } catch (error) {
      // The policy check below records the safe rejection if the local gate cannot be read or approved.
    }
  }

  _authorizationChecks(task) {
    this._bootstrapDefaultLocalKyc(task);
    const candidate = task.quote?.lockedSnapshot;
    const intent = task.request?.intent;
    const quoteFresh = Boolean(candidate?.quoteExpiresAt) && Date.parse(candidate.quoteExpiresAt) > this.clock().getTime();
    const line = task.quote?.lineSnapshot?.[0];
    const snapshotMatches = Boolean(line && task.quote?.snapshotHash && stableSnapshotHash({ quoteId: task.quote.quoteId, cartId: task.quote.cartId, lineSnapshot: task.quote.lineSnapshot, quoteExpiresAt: task.quote.quoteExpiresAt }) === task.quote.snapshotHash);
    const exactTotal = Boolean(candidate)
      && candidate.currency === task.currency
      && candidate.currency === CURRENCY
      && candidate.totalMinor === candidate.subtotalMinor + candidate.shippingMinor + candidate.taxMinor
      && task.quote?.totalMinor === candidate.totalMinor
      && task.quote?.currency === candidate.currency
      && line?.totalMinor === candidate.totalMinor
      && line?.currency === candidate.currency
      && snapshotMatches;
    const kycProjection = this.getKycProjection();
    const kycStatus = task.scenario === 'pending-kyc' ? 'pending' : task.scenario === 'rejected-kyc' ? 'rejected' : kycProjection.status;
    const walletBalance = task.wallet?.balanceMinor ?? this.store.data.wallets[task.walletId]?.balanceMinor ?? null;
    const sufficientFunding = task.scenario !== 'insufficient-funds' && task.scenario !== 'insufficient-funding' && task.scenario !== 'low-balance' && Number.isSafeInteger(walletBalance) && walletBalance >= (candidate?.totalMinor ?? Number.MAX_SAFE_INTEGER);
    const merchantAllowed = Boolean(candidate) && APPROVED_MERCHANT_IDS.has(candidate.merchantId) && APPROVED_PRODUCT_CATEGORIES.has(candidate.productCategory);
    const requestRiskSignal = /\b(?:bypass|ignore|evade|credential|password|pan|cvv|real money|cash|weapon|drug)\b/i.test(task.request?.raw || '');
    const riskClear = !['risk-block', 'policy-block', 'merchant-category-violation', 'duplicate-instruction'].includes(task.scenario) && !requestRiskSignal;
    const uniqueCandidate = task.recommendation?.status === 'clear' && task.recommendation?.autoSelectable === true && Boolean(task.quote?.selectedCandidateId);
    const quantityAllowed = intent?.quantity === 1;
    const budgetAllowed = Boolean(candidate) && candidate.totalMinor <= task.spendingCeilingMinor;
    return {
      validIntent: { status: intent?.productCategory && intent.currency === CURRENCY ? 'passed' : 'failed', reason: intent?.productCategory ? 'The request has a supported product type and currency.' : 'The request does not contain a supported product type.' },
      eligibleUniqueCandidate: { status: uniqueCandidate ? 'passed' : 'failed', reason: uniqueCandidate ? 'Exactly one clear eligible candidate was selected.' : 'The request has no unique eligible candidate; an explicit choice is required.' },
      freshAuthoritativeQuote: { status: quoteFresh ? 'passed' : 'failed', reason: quoteFresh ? 'The locked local quote is still fresh.' : 'The authoritative quote is stale or expired.' },
      exactCurrencyAndTotal: { status: exactTotal ? 'passed' : 'failed', reason: exactTotal ? 'Currency and quote arithmetic match the locked snapshot exactly.' : 'Currency or quote arithmetic did not match the locked snapshot.' },
      withinBudget: { status: budgetAllowed ? 'passed' : 'failed', reason: budgetAllowed ? 'The exact quoted total is within the task spending ceiling.' : 'The exact quoted total exceeds the task spending ceiling.' },
      inventoryReserved: { status: task.inventory?.reservation?.status === 'reserved' ? 'passed' : 'failed', reason: task.inventory?.reservation?.status === 'reserved' ? 'One unit is held by an active inventory lease.' : 'Inventory is not reserved.' },
      approvedKyc: { status: kycStatus === 'approved' ? 'passed' : 'failed', reason: kycStatus === 'approved' ? 'The local KYC gate is approved.' : `The local KYC gate is ${kycStatus}; approval is required before card issuance.` },
      sufficientFunding: { status: sufficientFunding ? 'passed' : 'failed', reason: sufficientFunding ? 'The authoritative simulated wallet covers the exact total.' : 'The simulated wallet does not cover the exact total.' },
      allowedMerchantCategory: { status: merchantAllowed ? 'passed' : 'failed', reason: merchantAllowed ? 'The merchant and product category are in the approved local scope.' : 'The merchant or product category is outside the approved local scope.' },
      quantityPolicy: { status: quantityAllowed ? 'passed' : 'failed', reason: quantityAllowed ? 'The one-purchase quantity is exactly one.' : 'This authorization permits one unit only.' },
      riskPolicy: { status: riskClear ? 'passed' : 'failed', reason: riskClear ? 'No local risk or policy block is active.' : 'A local risk or policy block is active.' }
    };
  }

  _updateFinancial(taskId, { payment = null, compensation = null, outcome = null } = {}) {
    this.store.transaction((data) => {
      const task = data.tasks[taskId];
      if (!task) return;
      const walletBalanceMinor = data.wallets[task.walletId]?.balanceMinor ?? null;
      const current = task.financial || { version: 1, amountMinor: task.quote?.totalMinor ?? null, balanceBeforeMinor: null, balanceAfterPaymentMinor: null, finalBalanceMinor: null, netChargedMinor: null, netRefundedMinor: 0, compensation: null, outcome: 'pending' };
      const nextPayment = payment || task.payment;
      const balanceBeforeMinor = current.balanceBeforeMinor ?? nextPayment?.balanceBeforeMinor ?? (nextPayment ? walletBalanceMinor : null);
      const afterPayment = current.balanceAfterPaymentMinor ?? nextPayment?.balanceAfterPaymentMinor ?? (nextPayment?.status === 'authorized' ? nextPayment.walletBalanceMinor : null);
      const nextCompensation = compensation || current.compensation;
      const paymentAuthorized = nextPayment?.status === 'authorized';
      const compensationCompleted = nextCompensation?.status === 'compensated';
      // A reconciliation decline has no task-owned balance effect. Do not use
      // the current global wallet balance here: another purchase may have won
      // the race while this task was awaiting a definitive capture result.
      const finalBalanceMinor = paymentAuthorized
        ? nextPayment.walletBalanceMinor ?? walletBalanceMinor
        : compensationCompleted
          ? nextCompensation.finalBalanceMinor ?? walletBalanceMinor
          : current.finalBalanceMinor ?? task.wallet?.finalBalanceMinor ?? task.wallet?.balanceAfterMinor ?? null;
      const netChargedMinor = compensationCompleted
        ? 0
        : paymentAuthorized
          ? nextPayment.amountMinor ?? current.amountMinor ?? null
          : current.netChargedMinor;
      const financialOutcome = outcome || current.outcome || 'not_started';
      task.financial = {
        ...current,
        version: 1,
        amountMinor: current.amountMinor ?? task.quote?.totalMinor ?? nextPayment?.amountMinor ?? null,
        balanceBeforeMinor,
        balanceAfterPaymentMinor: afterPayment,
        finalBalanceMinor,
        netChargedMinor,
        netRefundedMinor: compensation ? (nextCompensation?.status === 'compensated' ? nextCompensation.amountMinor || 0 : 0) : current.netRefundedMinor ?? (nextCompensation?.status === 'compensated' ? nextCompensation.amountMinor || 0 : 0),
        compensation: nextCompensation,
        outcome: financialOutcome
      };
      if (task.payment) task.payment = { ...task.payment, finalBalanceMinor, netChargedMinor, financialOutcome };
      if (task.wallet) task.wallet = { ...task.wallet, balanceBeforeMinor, balanceAfterPaymentMinor: afterPayment, balanceAfterMinor: finalBalanceMinor, finalBalanceMinor, netChargedMinor };
    });
  }

  _releaseReservation(taskId, reason) {
    const task = this.getTask(taskId);
    if (!task.inventory?.reservation || !['reserved', 'committed'].includes(task.inventory.reservation.status)) return;
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
      subtotalMinor: task.quote.subtotalMinor,
      shippingMinor: task.quote.shippingMinor,
      taxMinor: task.quote.taxMinor,
      amountMinor: task.quote.totalMinor,
      totalMinor: task.quote.totalMinor,
      currency: task.currency,
      balanceBeforeMinor: task.financial.balanceBeforeMinor,
      balanceAfterPaymentMinor: task.financial.balanceAfterPaymentMinor,
      finalBalanceMinor: task.financial.finalBalanceMinor,
      netChargedMinor: task.financial.netChargedMinor,
      paymentStatus: task.payment.status,
      paymentReference: task.payment.reference,
      authorizationReference: task.payment.authorizationReference || task.checkout?.authorizationReference || null,
      captureReference: task.payment.captureReference || task.checkout?.captureReference || null,
      captureSnapshot: {
        status: 'captured',
        paymentStatus: task.payment.status,
        amountMinor: task.payment.amountMinor,
        currency: task.currency,
        balanceBeforeMinor: task.financial.balanceBeforeMinor,
        balanceAfterPaymentMinor: task.financial.balanceAfterPaymentMinor,
        finalBalanceMinor: task.financial.finalBalanceMinor,
        netChargedMinor: task.financial.netChargedMinor,
        paymentReference: task.payment.reference,
        transactionReference: task.payment.transactionReference || null,
        authorizationReference: task.payment.authorizationReference || task.checkout?.authorizationReference || null,
        captureReference: task.payment.captureReference || task.checkout?.captureReference || null,
        capturedAt: task.checkout?.capturedAt || task.payment.occurredAt || null
      },
      adjustment: null,
      merchantCreditReference: task.merchantCredit.reference,
      orderReference: task.order.reference,
      orderStatus: task.order.status,
      inventoryReservationReference: task.inventory.reservation.reference,
      fulfillmentStatus: fulfillment.status,
      fulfillmentReference: fulfillment.reference,
      deliveryStatus: delivery.status,
      deliveryReference: delivery.reference,
      trackingReference: delivery.trackingReference,
      quoteId: task.quote.quoteId,
      cartId: task.quote.cartId,
      snapshotHash: task.quote.snapshotHash,
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
    let cardIssuedThisRun = false;
    if (['completed', 'failed', 'reconciliation_required'].includes(task.state)) return this._response(taskId);
    this._prepareAgentRun(taskId);
    task = this.getTask(taskId);
    this._updateTask(taskId, (current) => { current.automation = { ...current.automation, status: 'running', automatic, startedAt: current.automation.startedAt || now(this.clock), nextAction: 'NaviPay is running the simulated purchase.' }; });

    task = this.getTask(taskId);
    if (['pending', 'not_started'].includes(stage(task, 'intent').status)) {
      const opId = this._begin(taskId, 'intent');
      this._complete(taskId, 'intent', { status: 'interpreted', reference: stableReference('INTENT', task.id) }, stableReference('INTENT', task.id));
      this._recordStageAudit(taskId, 'intent', 'intent.interpreted', 'success', `Interpreted request as ${task.request.intent.productCategory || 'an unspecified product category'}.`, { operationId: opId, intent: task.request.intent });
      this._updateTask(taskId, (current) => { current.state = 'intent_interpreted'; });
      if (task.request.parseError || task.scenario === 'invalid-request') {
        const reason = 'Name an item to buy, such as a Logitech mouse. Nothing was reserved or paid.';
        this._recordAuthorizationDecision(taskId, { status: 'rejected', code: 'INVALID_PURCHASE_REQUEST', reason, checks: { validIntent: { status: 'failed', reason } } });
        this._fail(taskId, 'intent', 'INVALID_PURCHASE_REQUEST', reason);
        return this._response(taskId, 422);
      }
      if (task.request.intent.quantity !== 1) {
        this._recordAuthorizationDecision(taskId, { status: 'rejected', code: 'QUANTITY_UNSUPPORTED', reason: 'Authorization is limited to one unit per instruction.', checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, quantityPolicy: { status: 'failed', reason: 'This authorization permits one unit only.' } } });
        this._fail(taskId, 'intent', 'QUANTITY_UNSUPPORTED', 'This local authorization permits one unit per purchase instruction.');
        return this._response(taskId, 409);
      }
      if (task.scenario === 'missing-product-type' || (task.request.intent.brand && !task.request.intent.productCategory)) {
        const reason = 'The instruction names a brand but not a product type. NaviPay will not guess the category.';
        this._recordAuthorizationDecision(taskId, { status: 'rejected', code: 'MISSING_PRODUCT_TYPE', reason, checks: { validIntent: { status: 'failed', reason } } });
        this._fail(taskId, 'intent', 'MISSING_PRODUCT_TYPE', reason);
        return this._response(taskId, 409);
      }
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
        this._recordAuthorizationDecision(taskId, { status: 'rejected', code: error.code || 'DISCOVERY_FAILED', reason: error.message || 'The local merchant sandbox could not be searched.', checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, eligibleUniqueCandidate: { status: 'failed', reason: error.message || 'No eligible candidate was returned.' } } });
        this._fail(taskId, 'discovery', error.code || 'DISCOVERY_FAILED', error.message || 'The local merchant sandbox could not be searched.');
        return this._response(taskId, error.code === 'NO_LOCAL_MATCHES' ? 409 : 502);
      }
      const constrainedCandidates = (result.candidates || []).filter((candidate) => matchesHardIntent(candidate, task.request.intent));
      if (!constrainedCandidates.length) {
        this._recordAuthorizationDecision(taskId, { status: 'rejected', code: 'NO_LOCAL_MATCHES', reason: 'No approved local candidate matched the requested brand, product, and category. Nothing was charged.', checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, eligibleUniqueCandidate: { status: 'failed', reason: 'No candidate satisfied the hard constraints.' } } });
        this._fail(taskId, 'discovery', 'NO_LOCAL_MATCHES', 'No approved candidate matched the requested brand, product, and category. Nothing was charged.');
        return this._response(taskId, 409);
      }
      result = { ...result, candidates: constrainedCandidates, recommendedCandidateId: constrainedCandidates.some((candidate) => candidate.id === result.recommendedCandidateId) ? result.recommendedCandidateId : constrainedCandidates[0].id };
      this._updateTask(taskId, (current) => {
        current.quote = {
          mode: result.mode,
          source: result.source,
          discoveredAt: result.discoveredAt,
          candidates: result.candidates,
          recommendedCandidateId: result.recommendedCandidateId,
          quoteId: stableReference('QUOTE', task.id),
          cartId: stableReference('CART', task.id),
          snapshotHash: null,
          lineSnapshot: null,
          quoteExpiresAt: null,
          quoteStatus: 'open',
          budget: { ...task.budget, status: 'pending' },
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
        if (['ambiguity', 'ambiguous', 'ambiguous-same-brand'].includes(task.scenario)) {
          const reason = task.scenario === 'ambiguous-same-brand'
            ? 'Two equally eligible candidates from the requested brand remain. Choose one before any inventory or payment action.'
            : 'This local scenario intentionally contains an ambiguity. Choose one result before any inventory or payment action.';
          this._updateTask(taskId, (current) => {
            current.recommendation = { status: 'ambiguous', candidateId: null, reason, autoSelectable: false };
            current.quote.recommendation = current.recommendation;
            current.state = 'awaiting_selection';
            current.automation = { ...current.automation, status: 'awaiting_selection', automatic: false, nextAction: 'Choose one result to continue.' };
          });
          this._recordAuthorizationDecision(taskId, { status: 'paused', code: 'AMBIGUOUS_MATCH', reason, checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, eligibleUniqueCandidate: { status: 'failed', reason } } });
          return this._response(taskId);
        }
        const selection = selectClearWinner(result.candidates, { ceilingMinor: task.spendingCeilingMinor });
        if (selection.status === 'unavailable') {
          const hasInStock = result.candidates.some((candidate) => candidate.availability === 'in_stock');
          const code = hasInStock ? 'SPENDING_CEILING_EXCEEDED' : 'OUT_OF_STOCK';
          const message = hasInStock
            ? 'Every browser candidate exceeds the task spending ceiling; no purchase was attempted.'
            : 'The approved site has no in-stock candidate for this request; no purchase was attempted.';
          this._recordAuthorizationDecision(taskId, { status: 'rejected', code, reason: message, checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, eligibleUniqueCandidate: { status: 'failed', reason: hasInStock ? 'Every in-stock candidate is over budget.' : 'No in-stock candidate is available.' }, withinBudget: { status: hasInStock ? 'failed' : 'not_run', reason: message } } });
          this._fail(taskId, hasInStock ? 'quote' : 'inventory', code, message);
          return this._response(taskId, 409);
        }
        if (selection.status === 'ambiguous') {
          const reason = `${selection.reason} Choose an item in Advanced details to continue.`;
          this._updateTask(taskId, (current) => {
            current.recommendation = {
              status: 'ambiguous',
              candidateId: null,
              reason,
              autoSelectable: false
            };
            current.quote.recommendation = current.recommendation;
            current.state = 'awaiting_selection';
            current.automation = { ...current.automation, status: 'awaiting_selection', automatic: false, nextAction: 'Choose one of the tied browser results to cross-check the approved local quote.' };
          });
          this._recordAuthorizationDecision(taskId, { status: 'paused', code: 'AMBIGUOUS_MATCH', reason, checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, eligibleUniqueCandidate: { status: 'failed', reason } } });
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
      const inStock = candidates.filter((candidate) => candidate.availability === 'in_stock');
      const available = inStock.filter((candidate) => candidate.totalMinor <= task.spendingCeilingMinor);
      const recommended = candidates.find((candidate) => candidate.id === task.quote.recommendedCandidateId);
      const overBudget = inStock.length > 0 && available.length === 0;
      const [best, runnerUp] = available;
      const tied = Boolean(best && runnerUp && best.relevanceScore === runnerUp.relevanceScore && (task.request.intent.brand || task.request.intent.product));
      const recommendation = {
        status: overBudget ? 'unavailable' : !available.length ? 'unavailable' : tied ? 'ambiguous' : 'clear',
        candidateId: best?.id || recommended?.id || null,
        reason: available.length && !tied ? 'One clear in-stock match satisfies the hard constraints and task budget.' : tied ? 'Multiple equally eligible in-stock candidates remain; an explicit choice is required.' : overBudget ? 'Every in-stock match is over the task budget.' : 'No in-stock candidate is available in the local merchant sandbox.',
        autoSelectable: available.length > 0 && !tied
      };
      this._updateTask(taskId, (current) => {
        current.recommendation = recommendation;
        current.quote.recommendation = recommendation;
        current.quote.budget = { ...current.budget, status: overBudget ? 'over_budget' : available.length ? 'within_budget' : 'no_match' };
        current.budget = { ...current.budget, status: overBudget ? 'over_budget' : available.length ? 'within_budget' : 'no_match' };
      });
      if (overBudget) {
        const reason = 'Every in-stock match exceeds the task budget; no inventory or payment action was attempted.';
        this._recordAuthorizationDecision(taskId, { status: 'rejected', code: 'SPENDING_CEILING_EXCEEDED', reason, checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, withinBudget: { status: 'failed', reason } } });
        this._fail(taskId, 'quote', 'SPENDING_CEILING_EXCEEDED', reason);
        return this._response(taskId, 409);
      }
      if (!inStock.length) {
        const reason = 'No in-stock local item matched this request; no inventory or payment action was attempted.';
        this._recordAuthorizationDecision(taskId, { status: 'rejected', code: 'OUT_OF_STOCK', reason, checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, eligibleUniqueCandidate: { status: 'failed', reason } } });
        this._fail(taskId, 'inventory', 'OUT_OF_STOCK', reason);
        return this._response(taskId, 409);
      }
      if (tied) {
        const reason = `${recommendation.reason} Choose an item in Advanced details to continue.`;
        this._updateTask(taskId, (current) => {
          current.recommendation = { ...current.recommendation, reason, autoSelectable: false };
          current.quote.recommendation = current.recommendation;
          current.state = 'awaiting_selection';
          current.automation = { ...current.automation, status: 'awaiting_selection', automatic: false, nextAction: 'Choose one of the equally eligible candidates before authorization.' };
        });
        this._recordAuthorizationDecision(taskId, { status: 'paused', code: 'AMBIGUOUS_MATCH', reason, checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, eligibleUniqueCandidate: { status: 'failed', reason } } });
        return this._response(taskId);
      }
    }

    task = this.getTask(taskId);
    if (!task.quote.locked) {
      if (task.scenario === 'out-of-stock' || !task.recommendation.autoSelectable) {
        if (candidateId && task.quote.candidates.some((candidate) => candidate.id === candidateId && candidate.availability === 'in_stock')) {
          // An explicit available candidate can still rescue an ambiguous catalog response.
        } else if (task.scenario === 'out-of-stock') {
          const reason = 'The recommended local catalog item is out of stock; no inventory was reserved.';
          this._recordAuthorizationDecision(taskId, { status: 'rejected', code: 'OUT_OF_STOCK', reason, checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, eligibleUniqueCandidate: { status: 'failed', reason } } });
          this._fail(taskId, 'inventory', 'OUT_OF_STOCK', reason);
          return this._response(taskId, 409);
        } else {
          this._updateTask(taskId, (current) => { current.state = 'awaiting_selection'; current.automation = { ...current.automation, status: 'awaiting_selection', automatic: false, nextAction: 'Choose an available candidate and resume this purchase.' }; });
          return this._response(taskId);
        }
      }
      if (candidateId && task.recommendation && !task.recommendation.autoSelectable) {
        this._updateTask(taskId, (current) => {
          current.recommendation = { ...current.recommendation, status: 'clear', candidateId, autoSelectable: true, reason: 'The user explicitly selected one candidate from an otherwise ambiguous result.' };
          if (current.quote) current.quote.recommendation = current.recommendation;
        });
        task = this.getTask(taskId);
      }
      const selected = task.quote.candidates.find((candidate) => candidate.id === (candidateId || task.recommendation.candidateId));
      if (!selected) {
        this._fail(taskId, 'quote', 'QUOTE_CANDIDATE_NOT_FOUND', 'The selected local catalog candidate does not exist.');
        return this._response(taskId, 422);
      }
      if (selected.availability !== 'in_stock') {
        const reason = 'The selected local catalog item is out of stock; no payment was attempted.';
        this._recordAuthorizationDecision(taskId, { status: 'rejected', code: 'OUT_OF_STOCK', reason, checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, eligibleUniqueCandidate: { status: 'failed', reason } }, candidate: selected });
        this._fail(taskId, 'inventory', 'OUT_OF_STOCK', reason);
        return this._response(taskId, 409);
      }
      const quoteOp = this._begin(taskId, 'quote');
      const quoteId = task.quote.quoteId || stableReference('QUOTE', task.id);
      const cartId = task.quote.cartId || stableReference('CART', task.id);
      const lineSnapshot = [{
        lineId: 'line-1',
        sku: selected.sku,
        variantId: selected.variantId,
        merchantId: selected.merchantId,
        item: selected.item,
        variant: selected.variant,
        quantity: 1,
        unitPriceMinor: selected.subtotalMinor,
        shippingMinor: selected.shippingMinor,
        taxMinor: selected.taxMinor,
        totalMinor: selected.totalMinor,
        currency: selected.currency
      }];
      const snapshotHash = stableSnapshotHash({ quoteId, cartId, lineSnapshot, quoteExpiresAt: selected.quoteExpiresAt });
      const locked = { ...selected, quoteId, cartId, snapshotHash };
      delete locked.evidence?._private;
      this._updateTask(taskId, (current) => {
        const budgetStatus = selected.totalMinor <= current.spendingCeilingMinor ? 'within_budget' : 'over_budget';
        current.budget = { ...current.budget, status: budgetStatus };
        current.quote = { ...current.quote, quoteId, cartId, snapshotHash, lineSnapshot, quoteExpiresAt: selected.quoteExpiresAt, quoteStatus: 'locked', budget: { ...current.budget }, selectedCandidateId: selected.id, locked: true, lockedAt: now(this.clock), merchantId: selected.merchantId, merchant: selected.merchant, merchantDomain: selected.merchantDomain, mcc: selected.mcc || '5732', item: selected.item, variant: selected.variant, subtotalMinor: selected.subtotalMinor, shippingMinor: selected.shippingMinor, taxMinor: selected.taxMinor, totalMinor: selected.totalMinor, currency: selected.currency, lockedSnapshot: locked };
        current.state = 'quote_locked';
      });
      this._complete(taskId, 'quote', locked, selected.id);
      this._recordStageAudit(taskId, 'quote', 'quote.locked', 'success', `${selected.item} quote locked at ${money(selected.totalMinor)}.`, { operationId: quoteOp, reference: selected.id, merchant: selected.merchant, sku: selected.sku, variantId: selected.variantId });
    }

    task = this.getTask(taskId);
    if (task.quote?.lockedSnapshot?.quoteExpiresAt && Date.parse(task.quote.lockedSnapshot.quoteExpiresAt) <= this.clock().getTime()) {
      const reason = 'The authoritative quote expired before inventory reservation and card issuance; no payment was attempted.';
      this._updateTask(taskId, (current) => { if (current.quote) current.quote.quoteStatus = 'expired'; });
      this._recordAuthorizationDecision(taskId, { status: 'rejected', code: 'QUOTE_EXPIRED', reason, checks: { validIntent: { status: 'passed', reason: 'The request was parsed.' }, freshAuthoritativeQuote: { status: 'failed', reason } }, candidate: task.quote.lockedSnapshot });
      this._fail(taskId, 'quote', 'QUOTE_EXPIRED', reason);
      return this._response(taskId, 409);
    }
    if (!task.inventory) {
      const invOp = this._begin(taskId, 'inventory');
      const reservation = this.inventoryAdapter.reserve({ operationId: invOp, taskId, candidate: task.quote.lockedSnapshot, quoteId: task.quote.quoteId, snapshotHash: task.quote.snapshotHash, scenario: task.scenario });
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
        current.wallet = { ...wallet, balanceBeforeMinor: wallet.balanceMinor, balanceAfterMinor: wallet.balanceMinor, finalBalanceMinor: wallet.balanceMinor };
        current.financial = { ...current.financial, balanceBeforeMinor: wallet.balanceMinor, finalBalanceMinor: wallet.balanceMinor, netChargedMinor: 0, outcome: 'pending' };
        current.funding = wallet.chainEvidence;
      });
      this._complete(taskId, 'funding', wallet, wallet.chainEvidence.transactionReference || fundingOp);
      this._recordStageAudit(taskId, 'funding', 'funding.verified', 'success', 'Fake wallet balance verified while chain evidence remains a separate fact.', { operationId: fundingOp, reference: wallet.chainEvidence.transactionReference, status: wallet.status });
    }

    task = this.getTask(taskId);
    if (task.quote?.lockedSnapshot?.quoteExpiresAt && Date.parse(task.quote.lockedSnapshot.quoteExpiresAt) <= this.clock().getTime()) {
      const reason = 'The locked quote expired before issuer authorization; no payment was attempted.';
      this._updateTask(taskId, (current) => { if (current.quote) current.quote.quoteStatus = 'expired'; });
      this._releaseReservation(taskId, 'quote expired before issuer authorization');
      this._recordAuthorizationDecision(taskId, { status: 'rejected', code: 'QUOTE_EXPIRED', reason, checks: { freshAuthoritativeQuote: { status: 'failed', reason } }, candidate: task.quote.lockedSnapshot });
      this._fail(taskId, 'quote', 'QUOTE_EXPIRED', reason);
      return this._response(taskId, 409);
    }

    const authorizationChecks = this._authorizationChecks(task);
    const failedAuthorizationCheck = Object.entries(authorizationChecks).find(([, check]) => check.status === 'failed');
    if (failedAuthorizationCheck) {
      const [failedName, failedCheck] = failedAuthorizationCheck;
      const codeByCheck = {
        validIntent: 'INVALID_PURCHASE_REQUEST',
        eligibleUniqueCandidate: 'AMBIGUOUS_MATCH',
        freshAuthoritativeQuote: 'QUOTE_EXPIRED',
        exactCurrencyAndTotal: 'AUTHORITATIVE_QUOTE_MISMATCH',
        withinBudget: 'SPENDING_CEILING_EXCEEDED',
        inventoryReserved: 'INVENTORY_NOT_RESERVED',
        approvedKyc: 'KYC_NOT_APPROVED',
        sufficientFunding: 'INSUFFICIENT_FUNDS',
        allowedMerchantCategory: 'MERCHANT_CATEGORY_NOT_ALLOWED',
        quantityPolicy: 'QUANTITY_UNSUPPORTED',
        riskPolicy: 'POLICY_BLOCKED'
      };
      const code = task.scenario === 'duplicate-instruction' ? 'DUPLICATE_INSTRUCTION' : task.scenario === 'merchant-category-violation' ? 'MERCHANT_CATEGORY_NOT_ALLOWED' : codeByCheck[failedName] || 'AUTHORIZATION_REJECTED';
      const status = failedName === 'approvedKyc' && task.scenario === 'pending-kyc' ? 'paused' : 'rejected';
      this._recordAuthorizationDecision(taskId, { status, code, reason: failedCheck.reason, checks: authorizationChecks, candidate: task.quote.lockedSnapshot });
      this._releaseReservation(taskId, `authorization ${code.toLowerCase()}`);
      this._fail(taskId, failedName === 'approvedKyc' ? 'funding' : failedName === 'sufficientFunding' ? 'funding' : failedName === 'inventoryReserved' ? 'inventory' : 'quote', code, failedCheck.reason);
      return this._response(taskId, code === 'INSUFFICIENT_FUNDS' ? 402 : 409);
    }
    this._recordAuthorizationDecision(taskId, {
      status: 'approved',
      code: 'AUTHORIZATION_APPROVED',
      reason: 'Approved one-purchase authorization: the unique fresh local quote, reserved inventory, approved KYC, exact XSGD budget, merchant scope, and fake-wallet balance all passed.',
      checks: authorizationChecks,
      candidate: task.quote.lockedSnapshot
    });
    this._updateTask(taskId, (current) => { current.state = 'authorization_approved'; });

    if (!task.card && task.paymentMode !== 'legacy_direct_wallet') {
      const issueOp = this._begin(taskId, 'payment');
      this._transition(taskId, 'card_issuing', 'card_issuing', 'Issuing a task-scoped disposable card.', { operationId: issueOp, status: 'info' });
      let issued;
      try {
        const locked = task.quote.lockedSnapshot;
        const authorized = task.authorizationDecision?.candidate || locked;
        const approvedScope = { ...locked, merchantId: authorized.merchantId, merchant: authorized.merchant, merchantDomain: authorized.merchantDomain, amountMinor: authorized.amountMinor ?? locked.totalMinor, currency: authorized.currency || locked.currency, mcc: authorized.mcc || locked.mcc || '5732', walletId: task.walletId };
        issued = this.issuerAdapter.issue({ operationId: `op_${taskId}_card_issuing`, taskId, scenario: task.scenario, scope: approvedScope });
        this._updateTask(taskId, (current) => {
          const safeCard = { cardId: issued.cardId, reference: issued.reference, lastFour: String(issued.reference).slice(-4), status: issued.status, issuedAt: issued.issuedAt, scope: issued.scope, captureCount: issued.captureCount || 0, maskedReference: `•••• ${String(issued.reference).slice(-4)}`, retiredAt: null };
          current.card = safeCard;
          current.instrument = safeCard;
          current.issuer = { status: 'active', reference: issued.reference, cardId: issued.cardId, scope: issued.scope };
          current.state = 'card_issued';
          current.lifecycle = [...(current.lifecycle || []), { state: 'card_issued', at: now(this.clock) }];
        });
        cardIssuedThisRun = true;
        this._complete(taskId, 'payment', issued, issued.reference);
        this._recordStageAudit(taskId, 'payment', 'card_issued', 'success', 'Disposable card issued for the exact merchant, amount, currency, and MCC.', { operationId: `op_${taskId}_card_issuing`, reference: issued.reference, scope: issued.scope });
      } catch (error) {
        this._releaseReservation(taskId, 'card issuance failed');
        this._fail(taskId, 'payment', error.code || 'ISSUER_FAILED', error.message || 'The local issuer did not issue a disposable card.');
        return this._response(taskId, 502);
      }
    }

    task = this.getTask(taskId);
    if (cardIssuedThisRun && ['card-issued-before-checkout', 'checkpoint-card-issued'].includes(task.scenario)) {
      this._updateTask(taskId, (current) => { current.automation = { ...current.automation, status: 'paused', nextAction: 'Resume this persisted checkpoint to continue checkout.' }; });
      return this._response(taskId);
    }
    if (task.card && !task.payment && task.paymentMode !== 'legacy_direct_wallet' && typeof this.issuerAdapter.hasCapability === 'function' && !this.issuerAdapter.hasCapability(task.card.cardId)) {
      try {
        const locked = task.quote.lockedSnapshot;
        const authorized = task.authorizationDecision?.candidate || locked;
        this.issuerAdapter.issue({ operationId: `op_${taskId}_card_issuing`, taskId, scenario: task.scenario, scope: { ...locked, merchantId: authorized.merchantId, merchant: authorized.merchant, merchantDomain: authorized.merchantDomain, amountMinor: authorized.amountMinor ?? locked.totalMinor, currency: authorized.currency || locked.currency, mcc: authorized.mcc || locked.mcc || '5732', walletId: task.walletId } });
        this._recordStageAudit(taskId, 'payment', 'card_capability.restored', 'info', 'The process-local disposable card capability was recreated after reload; no credential was persisted.', { reference: task.card.reference });
      } catch (error) {
        this._releaseReservation(taskId, 'card capability unavailable after reload');
        this._fail(taskId, 'payment', error.code || 'CARD_CAPABILITY_UNAVAILABLE', 'The disposable card capability was unavailable after reload; no payment was attempted.');
        return this._response(taskId, 409);
      }
    }
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
          : this.merchantCheckoutAdapter.execute({ operationId: `op_${taskId}_checkout_submit`, taskId, cardId: task.card.cardId, scope: { ...task.quote.lockedSnapshot, ...(task.authorizationDecision?.candidate ? { merchantId: task.authorizationDecision.candidate.merchantId, merchant: task.authorizationDecision.candidate.merchant, merchantDomain: task.authorizationDecision.candidate.merchantDomain, mcc: task.authorizationDecision.candidate.mcc } : {}), amountMinor: task.authorizationDecision?.candidate?.amountMinor ?? task.quote.totalMinor, walletId: task.walletId, delivery: task.customer, mcc: task.authorizationDecision?.candidate?.mcc || task.quote.lockedSnapshot.mcc || '5732' }, scenario: task.scenario });
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
        this._updateTask(taskId, (current) => { if (current.card) current.card.status = 'pending_reconciliation'; current.automation = { ...current.automation, status: 'awaiting_reconciliation', nextAction: 'Reconcile the issuer result. Checkout will not be retried automatically.' }; });
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
    const orderOp = operationId(taskId, 'order');
    if (!task.order) {
      this._begin(taskId, 'order');
      let order;
      try {
        order = this.orderAdapter.create({ operationId: orderOp, taskId, customer: task.customer, candidate: task.quote.lockedSnapshot, reservation: task.inventory.reservation, payment: task.payment, scenario: task.scenario });
      } catch (error) {
        this._compensate(taskId, 'order creation failed');
        this._releaseReservation(taskId, 'order creation failed');
        this._fail(taskId, 'order', error.code || 'ORDER_CREATION_FAILED', 'Order creation failed safely; payment was compensated and inventory released.');
        return this._response(taskId, 502);
      }
      this._updateTask(taskId, (current) => { current.order = order; });
      if (order.status === 'failed') {
        this._compensate(taskId, 'order creation failed');
        this._releaseReservation(taskId, 'order creation failed');
        this._fail(taskId, 'order', order.code || 'ORDER_CREATION_FAILED', 'Order creation failed safely; payment was compensated and inventory released.', { reference: order.reference });
        return this._response(taskId, 502);
      }
    }

    task = this.getTask(taskId);
    if (task.order?.status === 'pending_inventory_commit' || task.inventory?.reservation?.status === 'reserved') {
      let committed;
      let confirmed;
      try {
        committed = task.inventory.reservation.status === 'committed'
          ? task.inventory.reservation
          : this.inventoryAdapter.commit({ operationId: operationId(taskId, 'inventory'), reservationReference: task.inventory.reservation.reference, quoteId: task.quote.quoteId, snapshotHash: task.quote.snapshotHash, scenario: task.scenario });
        if (committed.status !== 'committed') throw new AdapterError('INVENTORY_COMMIT_FAILED', 'The inventory reservation was not committed.');
        confirmed = task.order.status === 'confirmed'
          ? task.order
          : typeof this.orderAdapter.confirm === 'function'
            ? this.orderAdapter.confirm({ operationId: orderOp, reservation: committed, quoteId: task.quote.quoteId, snapshotHash: task.quote.snapshotHash })
            : { ...task.order, status: 'confirmed', confirmedAt: now(this.clock) };
        if (confirmed.status !== 'confirmed') throw new AdapterError('ORDER_COMMIT_FAILED', 'The local order was not confirmed after inventory commit.');
      } catch (error) {
        let failedOrder = task.order;
        if (failedOrder?.status === 'pending_inventory_commit' && typeof this.orderAdapter.fail === 'function') {
          failedOrder = this.orderAdapter.fail({ operationId: orderOp, code: error.code || 'ORDER_COMMIT_FAILED', message: error.message || 'The local order commit failed safely.' });
        }
        this._updateTask(taskId, (current) => { current.order = failedOrder ? { ...failedOrder, status: 'failed' } : { status: 'failed', code: error.code || 'ORDER_COMMIT_FAILED', message: error.message }; });
        this._compensate(taskId, 'order or inventory commit failed');
        this._releaseReservation(taskId, 'order commit failed');
        this._fail(taskId, 'order', error.code || 'ORDER_COMMIT_FAILED', 'Order and inventory confirmation failed safely; payment was compensated and no confirmed order remains.');
        return this._response(taskId, 502);
      }
      this._updateTask(taskId, (current) => { current.inventory.reservation = committed; current.inventory.status = committed.status; current.order = confirmed; });
      this._transition(taskId, 'order_confirmed', 'order_confirmed', 'Local merchant order confirmed after issuer capture and committed inventory.', { operationId: orderOp, reference: confirmed.reference, status: 'success' });
      this._complete(taskId, 'inventory', committed, committed.reference);
      this._complete(taskId, 'order', confirmed, confirmed.reference);
      this._recordStageAudit(taskId, 'order', 'order.confirmed', 'success', 'Order created after confirmed payment and committed inventory.', confirmed);
    }

    return this._finishOrderLifecycle(taskId);
  }

  _readIdempotency(key, fingerprint) {
    const previous = this.store.data.idempotency[key];
    if (!previous) return null;
    if (previous.requestFingerprint !== fingerprint) throw new SandboxDomainError(409, 'IDEMPOTENCY_KEY_REUSED', 'Use a new idempotency key when the purchase request changes.');
    return previous;
  }

  startPurchase({ idempotencyKey, request, targetSite = undefined, targetUrl = undefined, scenario = 'happy', origin = 'operator', paymentMode = 'issuer_authorization', agentMode = this.agentMode } = {}) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) throw new SandboxDomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key for the purchase run.');
    const requestedTargetSite = targetSite === undefined ? targetUrl : targetSite;
    const fingerprint = JSON.stringify({ request, targetSite: requestedTargetSite, scenario, origin, paymentMode, agentMode });
    const taskInput = { request, targetSite: requestedTargetSite, scenario, origin, paymentMode, agentMode };
    const key = `sandbox:start:${idempotencyKey}`;
    const previous = this._readIdempotency(key, fingerprint);
    if (previous?.response) return { ...clone(previous.response), replayed: true };
    const task = previous?.taskId ? this.getTask(previous.taskId) : this.createTask({ ...taskInput, allowInvalid: true });
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
    const existingAdjustment = task.receipt?.adjustment;
    if (existingAdjustment) {
      if (existingAdjustment.kind !== kind) throw new SandboxDomainError(409, 'PAYMENT_ALREADY_ADJUSTED', `This capture already has a ${existingAdjustment.kind}; a second payment adjustment was not attempted.`);
      const response = this._response(taskId);
      this.store.transaction((data) => { data.idempotency[key] = { taskId, requestFingerprint: kind, createdAt: now(this.clock), response: clone(response) }; });
      return { ...response, replayed: true };
    }
    if (!['completed'].includes(task.state) || task.payment?.status !== 'authorized') throw new SandboxDomainError(409, 'PAYMENT_NOT_REFUNDABLE', 'Only a confirmed issuer capture can be refunded or reversed.');
    const requestedAt = now(this.clock);
    let result;
    try {
      result = this.merchantCheckoutAdapter.refund({ taskId, cardId: task.card?.cardId, walletId: task.walletId, merchantId: task.quote.merchantId, amountMinor: task.quote.totalMinor, currency: task.currency, kind });
    } catch (error) {
      throw new SandboxDomainError(502, error.code || 'PAYMENT_REVERSAL_FAILED', error.message || 'The local payment reversal failed.');
    }
    const succeeded = ['refunded', 'reversed'].includes(result.status);
    const refundedAmountMinor = succeeded ? result.amountMinor : 0;
    const compensation = {
      ...result,
      amountMinor: refundedAmountMinor,
      status: succeeded ? 'compensated' : 'failed'
    };
    const adjustment = {
      kind,
      status: result.status,
      currentPaymentStatus: succeeded ? result.status : task.payment.status,
      originalCaptureStatus: task.receipt?.paymentStatus || task.payment.status,
      amountMinor: result.amountMinor,
      currency: result.currency || task.currency,
      netChargedMinor: task.quote.totalMinor - refundedAmountMinor,
      netRefundedMinor: refundedAmountMinor,
      failureCode: result.status === 'failed' ? 'COMPENSATION_FAILED' : null,
      reference: result.reference,
      transactionReference: result.transactionReference || null,
      requestedAt,
      occurredAt: result.occurredAt,
      compensation
    };
    this._updateTask(taskId, (current) => {
      current.compensation = compensation;
      current.payment = {
        ...current.payment,
        status: adjustment.currentPaymentStatus,
        adjustmentStatus: result.status,
        adjustmentReference: result.reference,
        adjustmentTransactionReference: result.transactionReference || null,
        adjustedAt: result.occurredAt,
        finalBalanceMinor: this.store.data.wallets[current.walletId]?.balanceMinor ?? null,
        netChargedMinor: adjustment.netChargedMinor,
        netRefundedMinor: adjustment.netRefundedMinor,
        ...(kind === 'reversal' ? { reversalReference: result.reference } : { refundReference: result.reference })
      };
      current.financial = {
        ...current.financial,
        compensation,
        outcome: succeeded ? result.status : 'compensation_failed',
        finalBalanceMinor: this.store.data.wallets[current.walletId]?.balanceMinor ?? null,
        netChargedMinor: adjustment.netChargedMinor,
        netRefundedMinor: adjustment.netRefundedMinor
      };
      if (current.receipt) {
        current.receipt.captureSnapshot = captureSnapshotFromReceipt(current.receipt);
        current.receipt.adjustment = adjustment;
      }
      if (current.wallet) current.wallet = {
        ...current.wallet,
        balanceAfterMinor: this.store.data.wallets[current.walletId]?.balanceMinor ?? null,
        finalBalanceMinor: this.store.data.wallets[current.walletId]?.balanceMinor ?? null,
        netChargedMinor: adjustment.netChargedMinor,
        netRefundedMinor: adjustment.netRefundedMinor
      };
      current.automation = { ...current.automation, nextAction: 'none' };
    });
    const auditType = succeeded ? (kind === 'reversal' ? 'payment.reversed' : 'payment.refunded') : (kind === 'reversal' ? 'payment.reversal_failed' : 'payment.refund_failed');
    const auditStatus = succeeded ? 'success' : 'error';
    const auditSummary = succeeded
      ? (kind === 'reversal' ? 'Issuer capture was reversed in the local gateway.' : 'Issuer capture was refunded in the local gateway.')
      : (kind === 'reversal' ? 'Issuer capture reversal failed; the original capture remains settled.' : 'Issuer capture refund failed; the original capture remains settled.');
    this._recordStageAudit(taskId, 'payment', auditType, auditStatus, auditSummary, { ...result, transactionReference: result.transactionReference || null });
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
    const adapterPayment = reconciledCapture?.payment || this.walletAdapter.resolveUnknown({ operationId: operationId(taskId, 'payment'), taskId, walletId: task.walletId, merchantId: task.quote.merchantId, amountMinor: task.quote.totalMinor, currency: task.currency, resolution });
    const normalized = normalizeReconciliationResult(reconciledCapture, adapterPayment);
    const { status, payment } = normalized;
    this._updateTask(taskId, (current) => {
      current.payment = { ...payment, authorizationReference: payment.authorizationReference || current.payment?.authorizationReference || null, captureReference: payment.captureReference || current.payment?.captureReference || null, paymentMode: current.payment?.paymentMode || task.paymentMode || 'issuer_authorization' };
      if (current.checkout) {
        current.checkout = {
          ...current.checkout,
          status,
          code: payment.code || current.checkout.code || null,
          captureReference: payment.captureReference || current.checkout.captureReference || null,
          capturedAt: status === 'authorized' ? (reconciledCapture?.capturedAt || current.checkout.capturedAt || now(this.clock)) : null,
          reason: status === 'declined' ? (payment.message || current.checkout.reason || 'The issuer capture was declined.') : null
        };
      }
      current.card = current.card ? {
        ...current.card,
        status: status === 'authorized' ? 'captured' : 'retired',
        captureCount: status === 'authorized' ? Math.max(current.card.captureCount || 0, 1) : current.card.captureCount,
        retiredAt: status === 'declined' ? (current.card.retiredAt || now(this.clock)) : current.card.retiredAt
      } : current.card;
      current.instrument = current.card;
    });
    this._updateFinancial(taskId, { payment, outcome: status });
    this._recordStageAudit(taskId, 'payment', `payment.reconciled.${status}`, status === 'authorized' ? 'success' : 'warning', status === 'authorized' ? 'Unknown payment reconciled as authorized without retrying the transfer.' : 'Unknown payment reconciled as declined; inventory will be released.', { ...payment, requestedResolution: resolution, definitiveStatus: status });
    if (status === 'declined') {
      if (this.issuerAdapter.retire && task.card?.cardId) this.issuerAdapter.retire({ operationId: `op_${taskId}_card_retired`, taskId, cardId: task.card.cardId, reason: 'reconciled_declined' });
      this._updateTask(taskId, (current) => { if (current.card) { current.card.status = 'retired'; current.card.retiredAt = current.card.retiredAt || now(this.clock); } current.instrument = current.card; });
      this._releaseReservation(taskId, 'payment reconciled declined');
      const failureCode = payment.code || 'PAYMENT_DECLINED_RECONCILED';
      const failureMessage = failureCode === 'INSUFFICIENT_FUNDS'
        ? 'The unknown wallet transfer was reconciled as insufficient funds; no duplicate payment was attempted.'
        : 'The unknown wallet transfer was reconciled as declined; no duplicate payment was attempted.';
      this._fail(taskId, 'payment', failureCode, failureMessage, { reference: payment.reference });
      this._updateFinancial(taskId, { payment, outcome: 'declined' });
      const response = this._response(taskId, 200);
      this.store.transaction((data) => { data.idempotency[key] = { taskId, requestFingerprint: fingerprint, createdAt: now(this.clock), response: clone(response) }; });
      return response;
    }
    this._complete(taskId, 'payment', payment, payment.captureReference || payment.reference);
    if (this.issuerAdapter.retire && task.card?.cardId) {
      const retired = this.issuerAdapter.retire({ operationId: `op_${taskId}_card_retired`, taskId, cardId: task.card.cardId, reason: 'reconciled_capture' });
      this._updateTask(taskId, (current) => { if (current.card) { current.card.status = 'retired'; current.card.captureCount = Math.max(current.card.captureCount || 0, 1); current.card.retiredAt = retired.retiredAt; } current.instrument = current.card; });
      this._transition(taskId, 'card_retired', 'card_retired', 'Disposable card retired after reconciliation.', { operationId: `op_${taskId}_card_retired`, reference: retired.reference, status: 'success' });
    }
    this._updateFinancial(taskId, { payment, outcome: 'authorized' });
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
    seedSandbox(this.store, this.clock);
    return { simulationResources: this.getSimulationResourcesProjection(), wallet: this.getWallet(), walletTopups: this.getWalletTopups(), walletAudit: this.getWalletAudit(), tasks: [], funding: this.getFundingProjection() };
  }
}

module.exports = {
  CATALOG,
  DEFAULT_ADAPTER_TIMEOUT_MS,
  TASK_CEILING_MINOR,
  DEFAULT_PURCHASE_PURPOSE,
  APPROVED_MERCHANT_SCOPE,
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
  LocalMockKycProvider,
  LocalMockXsgdFundingProvider,
  TASK_PROJECTION_VERSION,
  CUSTOMER_OUTCOME_VERSION,
  CUSTOMER_ACTION_VERSION,
  projectCustomerOutcome,
  projectNextActions,
  projectAuditEvent,
  projectOperation,
  projectTask,
  parseRequest,
  money,
  seedSandbox
};
