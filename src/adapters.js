const crypto = require('node:crypto');

const CURRENCY = 'XSGD';

class AdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
  }
}

function stableReference(prefix, input) {
  return `${prefix}-${crypto.createHash('sha256').update(input).digest('hex').slice(0, 10).toUpperCase()}`;
}

function merchantDomain(merchant) {
  const slug = String(merchant || 'merchant')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'merchant';
  return slug === 'harbor-supply' ? 'merchant.test' : `${slug}.test`;
}

const LOCAL_CATALOG = Object.freeze([
  {
    catalogId: 'apple-airpods-4-anc',
    brand: 'Apple',
    productCategory: 'earphones',
    merchant: 'Orchard Electronics',
    merchantDomain: 'orchard-electronics.test',
    item: 'Apple AirPods 4',
    variant: 'Active Noise Cancellation, USB-C case',
    priceMinor: 22900,
    shippingMinor: 0,
    taxMinor: 1832,
    currency: CURRENCY,
    availability: 'in_stock',
    keywords: ['apple', 'airpods', 'earphones', 'wireless', 'bluetooth', 'anc']
  },
  {
    catalogId: 'apple-airpods-pro-2-usbc',
    brand: 'Apple',
    productCategory: 'earphones',
    merchant: 'Circuit Market',
    merchantDomain: 'circuit-market.test',
    item: 'Apple AirPods Pro 2',
    variant: 'USB-C case, MagSafe charging',
    priceMinor: 31900,
    shippingMinor: 450,
    taxMinor: 2588,
    currency: CURRENCY,
    availability: 'limited',
    keywords: ['apple', 'airpods', 'earphones', 'wireless', 'bluetooth', 'pro', 'anc']
  },
  {
    catalogId: 'sony-wf-c700n',
    brand: 'Sony',
    productCategory: 'earphones',
    merchant: 'Audio Corner',
    merchantDomain: 'audio-corner.test',
    item: 'Sony WF-C700N',
    variant: 'Noise cancelling wireless earbuds',
    priceMinor: 11900,
    shippingMinor: 350,
    taxMinor: 980,
    currency: CURRENCY,
    availability: 'in_stock',
    keywords: ['sony', 'earphones', 'wireless', 'bluetooth', 'noise', 'cancelling', 'earbuds']
  },
  {
    catalogId: 'samsung-galaxy-buds3',
    brand: 'Samsung',
    productCategory: 'earphones',
    merchant: 'Harbor Supply',
    merchantDomain: 'merchant.test',
    item: 'Samsung Galaxy Buds3',
    variant: 'Open-fit wireless earbuds',
    priceMinor: 16900,
    shippingMinor: 300,
    taxMinor: 1376,
    currency: CURRENCY,
    availability: 'in_stock',
    keywords: ['samsung', 'galaxy', 'buds', 'earphones', 'wireless', 'bluetooth', 'earbuds']
  },
  {
    catalogId: 'soundcore-liberty-4-nc',
    brand: 'Anker',
    productCategory: 'earphones',
    merchant: 'Harbor Supply',
    merchantDomain: 'merchant.test',
    item: 'Soundcore Liberty 4 NC',
    variant: 'Adaptive noise cancelling earbuds',
    priceMinor: 13900,
    shippingMinor: 300,
    taxMinor: 1136,
    currency: CURRENCY,
    availability: 'in_stock',
    keywords: ['anker', 'soundcore', 'liberty', 'earphones', 'wireless', 'bluetooth', 'noise', 'cancelling', 'earbuds']
  },
  {
    catalogId: 'bose-quietcomfort-ultra-earbuds',
    brand: 'Bose',
    productCategory: 'earphones',
    merchant: 'Audio Corner',
    merchantDomain: 'audio-corner.test',
    item: 'Bose QuietComfort Ultra Earbuds',
    variant: 'Immersive audio wireless earbuds',
    priceMinor: 34900,
    shippingMinor: 450,
    taxMinor: 2828,
    currency: CURRENCY,
    availability: 'in_stock',
    keywords: ['bose', 'earphones', 'wireless', 'bluetooth', 'immersive', 'earbuds']
  },
  {
    catalogId: 'anker-737-power-bank',
    brand: 'Anker',
    productCategory: 'power banks',
    merchant: 'Harbor Supply',
    merchantDomain: 'merchant.test',
    item: 'Anker 737 Power Bank',
    variant: 'PowerCore 24,000mAh 140W',
    priceMinor: 8950,
    shippingMinor: 450,
    taxMinor: 200,
    currency: CURRENCY,
    availability: 'in_stock',
    keywords: ['anker', 'power', 'bank', 'charger', 'portable', 'usb-c']
  },
  {
    catalogId: 'logitech-mx-keys-mini',
    brand: 'Logitech',
    productCategory: 'keyboards',
    merchant: 'Circuit Market',
    merchantDomain: 'circuit-market.test',
    item: 'Logitech MX Keys Mini',
    variant: 'Wireless compact keyboard',
    priceMinor: 12900,
    shippingMinor: 350,
    taxMinor: 1060,
    currency: CURRENCY,
    availability: 'in_stock',
    keywords: ['logitech', 'keyboard', 'wireless', 'compact', 'bluetooth']
  }
]);

const BRAND_ALIASES = [
  ['Apple', ['apple']],
  ['Anker', ['anker', 'soundcore']],
  ['Sony', ['sony']],
  ['Samsung', ['samsung', 'galaxy']],
  ['Bose', ['bose']],
  ['Logitech', ['logitech']]
];

const CATEGORY_ALIASES = [
  ['earphones', ['earphones', 'earphone', 'earbuds', 'earbud', 'airpods', 'headphones', 'headphone', 'in-ear']],
  ['power banks', ['power bank', 'powerbank', 'portable charger', 'power banks']],
  ['keyboards', ['keyboard', 'keyboards']]
];

const REQUEST_STOP_WORDS = new Set([
  'a', 'an', 'and', 'for', 'get', 'i', 'like', 'me', 'my', 'of', 'please', 'some', 'the', 'to', 'want', 'would'
]);

function normalizeWords(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-SG')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function findAlias(words, aliases) {
  const text = words.join(' ');
  return aliases
    .flatMap(([canonical, values]) => values.map((alias) => ({ canonical, alias, words: normalizeWords(alias) })))
    .sort((left, right) => right.words.length - left.words.length || right.alias.length - left.alias.length)
    .find(({ words: aliasWords }) => aliasWords.length === 1 ? words.includes(aliasWords[0]) : text.includes(aliasWords.join(' ')));
}

function findCategory(words) {
  const text = words.join(' ');
  const aliases = CATEGORY_ALIASES
    .flatMap(([canonical, values]) => values.map((alias) => ({ canonical, alias, words: normalizeWords(alias) })))
    .sort((left, right) => right.words.length - left.words.length || right.alias.length - left.alias.length);
  return aliases.find(({ words: aliasWords }) => text.includes(aliasWords.join(' ')));
}

function parsePurchaseRequest(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 240 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AdapterError('INVALID_PURCHASE_REQUEST', 'Purchase request must be plain text between 1 and 240 characters.');
  }
  const raw = value.trim();
  const words = normalizeWords(raw);
  const brandAlias = findAlias(words, BRAND_ALIASES);
  const categoryAlias = findCategory(words);
  const keywords = [...new Set(words.filter((word) => !REQUEST_STOP_WORDS.has(word)))];
  if (!keywords.length) {
    throw new AdapterError('INVALID_PURCHASE_REQUEST', 'Purchase request must include an item keyword.');
  }
  return {
    normalized: words.join(' '),
    brand: brandAlias?.canonical || null,
    productCategory: categoryAlias?.canonical || null,
    keywords
  };
}

function rankCatalogCandidates(intent, catalog = LOCAL_CATALOG) {
  const parsed = typeof intent === 'string' ? parsePurchaseRequest(intent) : intent;
  const requestKeywords = new Set(parsed?.keywords || []);
  return catalog.map((entry, index) => {
    const keywordMatches = entry.keywords.filter((keyword) => requestKeywords.has(keyword));
    const brandMatch = parsed?.brand && entry.brand.toLocaleLowerCase('en-SG') === parsed.brand.toLocaleLowerCase('en-SG');
    const categoryMatch = parsed?.productCategory && entry.productCategory === parsed.productCategory;
    const reasons = [];
    let relevanceScore = 0;
    if (brandMatch) {
      relevanceScore += 100;
      reasons.push(`Brand match: ${entry.brand}`);
    }
    if (categoryMatch) {
      relevanceScore += 60;
      reasons.push(`Product category match: ${entry.productCategory}`);
    }
    if (keywordMatches.length) {
      relevanceScore += keywordMatches.length * 7;
      reasons.push(`Keyword matches: ${keywordMatches.join(', ')}`);
    }
    if (!reasons.length) reasons.push('Local catalog fallback');
    return {
      ...entry,
      relevanceScore,
      matchReasons: reasons,
      _catalogOrder: index
    };
  }).sort((left, right) => right.relevanceScore - left.relevanceScore || left._catalogOrder - right._catalogOrder).map(({ _catalogOrder, ...entry }) => entry);
}

function candidateEvidence(catalogId, observedAt, source = 'NaviPay seeded local catalog') {
  return {
    type: 'local-catalog-fixture',
    source,
    catalogId,
    observedAt,
    note: 'DEMO / MOCK fixture; not a live marketplace result.'
  };
}

function catalogCandidate(entry, expiresAt, discoveredAt, overCap = false) {
  const shippingMinor = entry.shippingMinor;
  const taxMinor = entry.taxMinor;
  const totalMinor = overCap ? 125000 : entry.priceMinor + shippingMinor + taxMinor;
  return {
    id: `catalog-${entry.catalogId}`,
    brand: entry.brand,
    productCategory: entry.productCategory,
    merchant: entry.merchant,
    merchantDomain: entry.merchantDomain,
    item: entry.item,
    variant: entry.variant,
    subtotalMinor: totalMinor - shippingMinor - taxMinor,
    shippingMinor,
    taxMinor,
    totalMinor,
    currency: entry.currency,
    availability: entry.availability,
    relevanceScore: entry.relevanceScore,
    matchReasons: entry.matchReasons,
    selectionReason: entry.matchReasons.join(' · '),
    evidence: candidateEvidence(entry.catalogId, discoveredAt),
    expiresAt
  };
}

function directCandidateEvidence(discoveredAt) {
  return {
    type: 'direct-task-fixture',
    source: 'NaviPay direct task fixture',
    catalogId: 'operator-direct-input',
    observedAt: discoveredAt,
    note: 'DEMO / MOCK fixture; not a live marketplace result.'
  };
}

function directCandidates(requested, expiresAt, discoveredAt, overCap) {
  const totalMinor = overCap ? 125000 : requested.amountMinor;
  const shippingMinor = Math.min(450, Math.max(0, Math.floor(totalMinor / 10)));
  const taxMinor = Math.min(200, Math.max(0, Math.floor(totalMinor / 20)));
  const base = {
    brand: 'Operator specified',
    productCategory: 'operator-specified',
    merchant: requested.merchant,
    merchantDomain: merchantDomain(requested.merchant),
    item: requested.item,
    shippingMinor,
    taxMinor,
    currency: requested.currency || CURRENCY,
    availability: 'in_stock',
    relevanceScore: 100,
    matchReasons: ['Exact direct task input'],
    selectionReason: overCap ? 'Fixture used to prove the hard ceiling.' : 'Requested item and amount from the operator task.',
    evidence: directCandidateEvidence(discoveredAt),
    expiresAt
  };
  const candidate = {
    ...base,
    id: overCap ? 'fixture-over-cap' : `fixture-${stableReference('ITEM', `${requested.merchant}:${requested.item}:${totalMinor}`).toLowerCase()}`,
    subtotalMinor: totalMinor - shippingMinor - taxMinor,
    totalMinor
  };
  const alternateTotal = totalMinor + 1000;
  const alternate = {
    ...base,
    id: `${candidate.id}-alt`,
    variant: 'Alternate configuration',
    subtotalMinor: alternateTotal - shippingMinor - taxMinor,
    totalMinor: alternateTotal,
    selectionReason: 'Alternate configuration from the same merchant.'
  };
  candidate.variant = 'Requested configuration';
  return [candidate, alternate];
}

/**
 * Replaceable provider contracts. The default implementations intentionally
 * return deterministic fixtures so the local demo never needs credentials.
 */
class MockFundingAdapter {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
    this.calls = 0;
  }

  verify({ scenario = 'happy' } = {}) {
    this.calls += 1;
    if (scenario === 'funding-failure') {
      throw new AdapterError('FUNDING_UNAVAILABLE', 'The simulated funding verifier is unavailable.');
    }

    const observedAt = this.clock().toISOString();
    return {
      mode: 'mock',
      source: 'Avalanche Fuji fixture',
      onChain: {
        status: 'verified',
        network: 'Avalanche Fuji',
        asset: 'XSGD',
        amountMinor: 185000,
        recipient: 'merchant settlement address (redacted)',
        transactionReference: '0xfixture-funding-7f31',
        confirmations: 12,
        observedAt
      },
      settlement: {
        status: 'simulated-ready',
        spendable: true,
        provider: 'mock issuer settlement ledger',
        note: 'Separate mock settlement status - not inferred from the chain observation.'
      }
    };
  }
}

class MockDiscoveryAdapter {
  constructor({ clock = () => new Date(), catalog = LOCAL_CATALOG } = {}) {
    this.clock = clock;
    this.catalog = catalog;
    this.calls = 0;
  }

  discover({ scenario = 'happy', purchase, request } = {}) {
    this.calls += 1;
    if (scenario === 'discovery-failure') {
      throw new AdapterError('DISCOVERY_UNAVAILABLE', 'The simulated catalog is unavailable.');
    }

    const discoveredAt = this.clock().toISOString();
    const expiresAt = new Date(this.clock().getTime() + 15 * 60 * 1000).toISOString();
    if (request) {
      const intent = request.intent || parsePurchaseRequest(request.raw || request);
      const ranked = rankCatalogCandidates(intent, this.catalog).filter((entry) => entry.relevanceScore > 0).slice(0, 5);
      if (!ranked.length) {
        throw new AdapterError('NO_LOCAL_MATCHES', 'The seeded local catalog has no relevant candidates for that request.');
      }
      return {
        mode: 'mock',
        source: 'NaviPay seeded local catalog',
        candidates: ranked.map((entry, index) => catalogCandidate(entry, expiresAt, discoveredAt, scenario === 'over-cap' && index === 0)),
        recommendedCandidateId: `catalog-${ranked[0].catalogId}`,
        discoveredAt,
        intent
      };
    }

    const requested = purchase || { merchant: 'Harbor Supply', item: 'Anker 737 Power Bank', amountMinor: 8950, currency: CURRENCY };
    const candidates = directCandidates(requested, expiresAt, discoveredAt, scenario === 'over-cap');
    return {
      mode: 'mock',
      source: 'NaviPay direct task fixture',
      candidates,
      recommendedCandidateId: candidates[0].id,
      discoveredAt
    };
  }
}

class MockIssuerAdapter {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
    this.calls = 0;
  }

  issue({ taskId, scope, scenario = 'happy' }) {
    this.calls += 1;
    if (scenario === 'issuer-failure') {
      throw new AdapterError('ISSUER_UNAVAILABLE', 'The simulated issuer rejected the issuance request.');
    }
    return {
      mode: 'mock',
      reference: stableReference('MOCK-SCOPE', taskId),
      issuedAt: this.clock().toISOString(),
      status: 'active',
      scope: {
        merchant: scope.merchant,
        merchantDomain: scope.merchantDomain,
        item: scope.item,
        variant: scope.variant,
        amountMinor: scope.amountMinor,
        currency: scope.currency,
        expiresAt: scope.expiresAt,
        maxCaptures: 1,
        reusable: false,
        credentialStatus: 'provider-controlled and redacted'
      }
    };
  }
}

class MockCheckoutAdapter {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
    this.calls = 0;
  }

  execute({ taskId, scope, scenario = 'happy' }) {
    this.calls += 1;
    const attemptedAt = this.clock().toISOString();
    const base = {
      mode: 'mock',
      merchantDomain: scope.merchantDomain,
      amountMinor: scope.amountMinor,
      currency: scope.currency,
      attemptedAt,
      checkoutReference: stableReference('MOCK-CHK', `${taskId}:${this.calls}`)
    };
    if (scenario === 'unknown-checkout') {
      return {
        ...base,
        status: 'unknown',
        message: 'The simulated merchant did not return a definitive authorization.'
      };
    }
    if (scenario === 'checkout-failure') {
      return {
        ...base,
        status: 'declined',
        reason: 'Simulated merchant decline - no retry was attempted.'
      };
    }
    return {
      ...base,
      status: 'authorized',
      authorizationReference: stableReference('MOCK-AUTH', taskId),
      captureReference: stableReference('MOCK-CAP', taskId),
      capturedAt: this.clock().toISOString()
    };
  }
}

module.exports = {
  AdapterError,
  LOCAL_CATALOG,
  MockFundingAdapter,
  MockDiscoveryAdapter,
  MockIssuerAdapter,
  MockCheckoutAdapter,
  parsePurchaseRequest,
  rankCatalogCandidates
};
