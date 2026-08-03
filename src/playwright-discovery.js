const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AdapterError } = require('./adapters');

const DISCOVERY_UNAVAILABLE_MESSAGE = 'Browser discovery is unavailable; the seeded local catalog was used.';
const DEFAULT_LIMITS = Object.freeze({
  deadlineMs: 4000,
  maxPages: 5,
  maxTabs: 1,
  maxRedirects: 3,
  maxResponseBytes: 256 * 1024,
  maxCandidates: 20
});
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const AVAILABILITY = new Set(['in_stock', 'limited', 'out_of_stock']);

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isTimestamp(value) {
  return isText(value) && Number.isFinite(Date.parse(value));
}

function isIntegerMinor(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function splitList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function hostnameFor(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

function isAllowedMethod(method) {
  return ALLOWED_METHODS.has(method);
}

function isApprovedUrl(value, allowlist = []) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const approved = new Set(allowlist.filter((entry) => {
    try {
      const parsedEntry = new URL(entry.includes('://') ? entry : `https://${entry}`);
      return !parsedEntry.username && !parsedEntry.password;
    } catch {
      return false;
    }
  }).map((entry) => hostnameFor(entry) || String(entry).toLowerCase().replace(/^\[|\]$/g, '')));
  return LOCAL_HOSTS.has(host) || approved.has(host);
}

function limitsWithDefaults(limits = {}) {
  const merged = { ...DEFAULT_LIMITS, ...limits };
  for (const name of Object.keys(DEFAULT_LIMITS)) {
    if (!Number.isSafeInteger(merged[name]) || merged[name] <= 0) throw new AdapterError('DISCOVERY_POLICY_VIOLATION', `Discovery limit ${name} is invalid.`);
  }
  return Object.freeze(merged);
}

function safeUnavailableError() {
  return new AdapterError('DISCOVERY_UNAVAILABLE', DISCOVERY_UNAVAILABLE_MESSAGE);
}

function validateExtractedCandidate(candidate, { now = new Date(), allowlist = [] } = {}) {
  const requiredText = ['merchant', 'merchantDomain', 'sku', 'variantId', 'item', 'variant', 'sourceUrl'];
  if (!candidate || requiredText.some((field) => !isText(candidate[field]))) {
    throw new AdapterError('MALFORMED_DISCOVERY_DATA', 'The merchant fixture returned an incomplete candidate.');
  }
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(candidate.merchantDomain) || !AVAILABILITY.has(candidate.availability) || candidate.currency !== 'XSGD') {
    throw new AdapterError('MALFORMED_DISCOVERY_DATA', 'The merchant fixture returned an invalid candidate identity or availability.');
  }
  if (!isApprovedUrl(candidate.sourceUrl, allowlist)) {
    throw new AdapterError('DISCOVERY_POLICY_VIOLATION', 'The candidate source URL is not approved.');
  }
  if (!isTimestamp(candidate.observedAt) || !isTimestamp(candidate.expiresAt) || !candidate.evidence || !isText(candidate.evidence.type) || !isText(candidate.evidence.source) || !isText(candidate.evidence.note)) {
    throw new AdapterError('MALFORMED_DISCOVERY_DATA', 'The merchant fixture returned incomplete observation evidence.');
  }
  const observedAt = Date.parse(candidate.observedAt);
  const expiresAt = Date.parse(candidate.expiresAt);
  const nowMs = now.getTime();
  if (observedAt > nowMs + 5000 || expiresAt <= nowMs || expiresAt <= observedAt || expiresAt > nowMs + 24 * 60 * 60 * 1000) {
    throw new AdapterError('STALE_DISCOVERY_DATA', 'The merchant fixture returned a stale or contradictory quote.');
  }
  for (const field of ['subtotalMinor', 'shippingMinor', 'taxMinor', 'totalMinor']) {
    if (!isIntegerMinor(candidate[field])) throw new AdapterError('MALFORMED_DISCOVERY_DATA', 'The merchant fixture returned a non-integer price.');
  }
  if (candidate.totalMinor !== candidate.subtotalMinor + candidate.shippingMinor + candidate.taxMinor) {
    throw new AdapterError('CONTRADICTORY_DISCOVERY_DATA', 'The merchant fixture quote total does not match its price breakdown.');
  }
  if (candidate.evidence.observedAt !== candidate.observedAt) {
    throw new AdapterError('CONTRADICTORY_DISCOVERY_DATA', 'The merchant fixture evidence timestamp does not match the quote.');
  }
  return true;
}

function candidateId(candidate) {
  return `browser-${crypto.createHash('sha256').update(`${candidate.merchantDomain}:${candidate.sku}:${candidate.variantId}`).digest('hex').slice(0, 16)}`;
}

function normalizeCandidate(candidate, { now = new Date(), allowlist = [] } = {}) {
  validateExtractedCandidate(candidate, { now, allowlist });
  const evidence = {
    ...candidate.evidence,
    type: candidate.evidence.type || 'playwright-merchant-fixture',
    sourceUrl: candidate.sourceUrl,
    observedAt: candidate.observedAt
  };
  return {
    id: candidate.id || candidateId(candidate),
    merchantId: candidate.merchantId || candidate.merchantDomain,
    merchant: candidate.merchant,
    merchantDomain: candidate.merchantDomain,
    sku: candidate.sku,
    variantId: candidate.variantId,
    brand: candidate.brand || 'Unspecified',
    productCategory: candidate.productCategory || 'unspecified',
    item: candidate.item,
    variant: candidate.variant,
    subtotalMinor: candidate.subtotalMinor,
    shippingMinor: candidate.shippingMinor,
    taxMinor: candidate.taxMinor,
    totalMinor: candidate.totalMinor,
    currency: candidate.currency,
    availability: candidate.availability,
    stockQuantity: candidate.stockQuantity ?? (candidate.availability === 'out_of_stock' ? 0 : 1),
    relevanceScore: 0,
    matchReasons: [],
    quoteExpiresAt: candidate.expiresAt,
    evidence,
    sourceUrl: candidate.sourceUrl
  };
}

function rankCandidates(candidates, intent) {
  const requestWords = new Set(intent?.keywords || []);
  return candidates.map((candidate, index) => {
    const words = `${candidate.brand} ${candidate.productCategory} ${candidate.item} ${candidate.variant} ${(candidate.keywords || []).join(' ')}`.toLocaleLowerCase('en-SG').split(/[^a-z0-9]+/).filter(Boolean);
    const matches = [...new Set(words.filter((word) => requestWords.has(word)))];
    const brandMatch = intent?.brand && candidate.brand.toLocaleLowerCase('en-SG') === intent.brand.toLocaleLowerCase('en-SG');
    const categoryMatch = intent?.productCategory && candidate.productCategory === intent.productCategory;
    const reasons = [];
    let score = 0;
    if (brandMatch) { score += 100; reasons.push(`Brand match: ${candidate.brand}`); }
    if (categoryMatch) { score += 60; reasons.push(`Category match: ${candidate.productCategory}`); }
    if (matches.length) { score += matches.length * 7; reasons.push(`Keyword matches: ${matches.join(', ')}`); }
    if (!reasons.length) return null;
    return { ...candidate, relevanceScore: score, matchReasons: reasons, _order: index };
  }).filter(Boolean).sort((left, right) => right.relevanceScore - left.relevanceScore || left._order - right._order).map(({ _order, ...candidate }) => candidate);
}

function extractCandidatesFromHtml(html, sourceUrl, { now = new Date(), allowlist = [], replayClock = false } = {}) {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > DEFAULT_LIMITS.maxResponseBytes) {
    throw new AdapterError('DISCOVERY_RESPONSE_TOO_LARGE', 'The merchant fixture page exceeded the response-size limit.');
  }
  const candidates = [];
  const scriptPattern = /<script\b[^>]*data-navipay-candidate(?:\s*=\s*["'][^"']*["'])?[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(html)) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      throw new AdapterError('MALFORMED_DISCOVERY_DATA', 'The merchant fixture candidate was not valid JSON.');
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      const withSource = { ...item, sourceUrl: item.sourceUrl || sourceUrl };
      if (replayClock && withSource.observedAt === '__NAVIPAY_REPLAY_NOW__' && withSource.expiresAt === '__NAVIPAY_REPLAY_EXPIRY__') {
        withSource.observedAt = now.toISOString();
        withSource.expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
        withSource.evidence = { ...withSource.evidence, observedAt: withSource.observedAt };
      }
      validateExtractedCandidate(withSource, { now, allowlist });
      candidates.push(withSource);
    }
  }
  if (!candidates.length) throw new AdapterError('MALFORMED_DISCOVERY_DATA', 'The merchant fixture page contained no discovery candidate.');
  return candidates;
}

function runWorker(workerData, timeoutMs) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'playwright-discovery-worker.js')], {
    input: JSON.stringify(workerData),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error || result.status !== 0) throw safeUnavailableError();
  try {
    const message = JSON.parse(result.stdout || '{}');
    if (!message.ok) throw safeUnavailableError();
    return message.result;
  } catch {
    throw safeUnavailableError();
  }
}

function fallbackResult(localAdapter, args, failure) {
  const local = localAdapter.discover(args);
  const source = 'NaviPay seeded merchant sandbox (MOCK FALLBACK - discovery unavailable)';
  return {
    ...local,
    mode: 'simulated local sandbox',
    source,
    discoveryStatus: { status: 'unavailable', code: 'DISCOVERY_UNAVAILABLE', message: DISCOVERY_UNAVAILABLE_MESSAGE },
    candidates: local.candidates.map((candidate) => ({
      ...candidate,
      evidence: { ...candidate.evidence, source, note: 'MOCK FALLBACK fixture; browser discovery was unavailable.' }
    })),
    fallbackCode: 'DISCOVERY_UNAVAILABLE'
  };
}

class PlaywrightDiscoveryAdapter {
  constructor({ clock = () => new Date(), fallback, enabled = false, allowlist = [], startUrls = [], limits = {}, workerRunner = runWorker } = {}) {
    if (!fallback || typeof fallback.discover !== 'function') throw new Error('A local discovery fallback is required.');
    this.clock = clock;
    this.fallback = fallback;
    this.enabled = enabled;
    this.allowlist = [...allowlist];
    this.startUrls = [...startUrls];
    this.limits = limitsWithDefaults(limits);
    this.workerRunner = workerRunner;
    this.calls = 0;
  }

  discover(args = {}) {
    this.calls += 1;
    if (!this.enabled) return this.fallback.discover(args);
    if (args.scenario === 'discovery-failure') return fallbackResult(this.fallback, args, safeUnavailableError());
    if (!this.startUrls.length || this.startUrls.length > this.limits.maxPages || this.startUrls.some((url) => !isApprovedUrl(url, this.allowlist))) {
      return fallbackResult(this.fallback, args, safeUnavailableError());
    }
    const now = this.clock();
    try {
      const workerResult = this.workerRunner({
        startUrls: this.startUrls,
        allowlist: this.allowlist,
        limits: this.limits
      }, this.limits.deadlineMs);
      const result = workerResult;
      const extracted = result?.candidates || [];
      if (!Array.isArray(extracted) || extracted.length === 0 || extracted.length > this.limits.maxCandidates) throw safeUnavailableError();
      const normalized = extracted.map((candidate) => normalizeCandidate(candidate, { now: this.clock(), allowlist: this.allowlist }));
      const ranked = rankCandidates(normalized, args.request?.intent).slice(0, this.limits.maxCandidates);
      if (!ranked.length) throw safeUnavailableError();
      const discoveredAt = result.discoveredAt || now.toISOString();
      return {
        mode: 'read-only Playwright fixture',
        source: 'Allowlisted local merchant fixture via read-only Playwright worker',
        recommendationOnly: true,
        discoveredAt,
        candidates: ranked,
        recommendedCandidateId: ranked[0].id,
        discoveryStatus: { status: 'available', code: null, message: 'Read-only fixture discovery completed.' }
      };
    } catch (error) {
      return fallbackResult(this.fallback, args, error);
    }
  }
}

function createConfiguredDiscoveryAdapter({ clock, fallback, catalog, env = process.env } = {}) {
  return new PlaywrightDiscoveryAdapter({
    clock,
    fallback,
    enabled: env.NAVIPAY_PLAYWRIGHT_DISCOVERY === '1',
    allowlist: splitList(env.NAVIPAY_DISCOVERY_ALLOWLIST),
    startUrls: splitList(env.NAVIPAY_DISCOVERY_URLS),
    limits: Object.fromEntries(Object.entries({
      deadlineMs: env.NAVIPAY_DISCOVERY_DEADLINE_MS ? Number(env.NAVIPAY_DISCOVERY_DEADLINE_MS) : null,
      maxPages: env.NAVIPAY_DISCOVERY_MAX_PAGES ? Number(env.NAVIPAY_DISCOVERY_MAX_PAGES) : null,
      maxTabs: env.NAVIPAY_DISCOVERY_MAX_TABS ? Number(env.NAVIPAY_DISCOVERY_MAX_TABS) : null,
      maxRedirects: env.NAVIPAY_DISCOVERY_MAX_REDIRECTS ? Number(env.NAVIPAY_DISCOVERY_MAX_REDIRECTS) : null,
      maxResponseBytes: env.NAVIPAY_DISCOVERY_MAX_RESPONSE_BYTES ? Number(env.NAVIPAY_DISCOVERY_MAX_RESPONSE_BYTES) : null,
      maxCandidates: env.NAVIPAY_DISCOVERY_MAX_CANDIDATES ? Number(env.NAVIPAY_DISCOVERY_MAX_CANDIDATES) : null
    }).filter(([, value]) => value !== null)),
    catalog
  });
}

module.exports = {
  ALLOWED_METHODS,
  DEFAULT_LIMITS,
  DISCOVERY_UNAVAILABLE_MESSAGE,
  PlaywrightDiscoveryAdapter,
  createConfiguredDiscoveryAdapter,
  extractCandidatesFromHtml,
  isAllowedMethod,
  isApprovedUrl,
  normalizeCandidate,
  rankCandidates,
  validateExtractedCandidate
};
