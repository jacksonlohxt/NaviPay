const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AdapterError } = require('./adapters');

const DISCOVERY_UNAVAILABLE_MESSAGE = 'Browser discovery is unavailable; the seeded local catalog was used.';
const DISCOVERY_SOURCE = Object.freeze({
  SEEDED_CATALOG: 'seeded_catalog',
  BROWSER_FIXTURE: 'local_browser_fixture',
  FALLBACK: 'seeded_catalog_fallback'
});
const DEFAULT_LIMITS = Object.freeze({
  deadlineMs: 4000,
  maxPages: 5,
  maxTabs: 1,
  maxRedirects: 3,
  maxResponseBytes: 256 * 1024,
  maxCandidates: 20
});
const HARD_LIMITS = Object.freeze({
  deadlineMs: 30_000,
  maxPages: 20,
  maxTabs: 4,
  maxRedirects: 8,
  maxResponseBytes: 2 * 1024 * 1024,
  maxCandidates: 100
});
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const AVAILABILITY = new Set(['in_stock', 'limited', 'out_of_stock']);
const DISCOVERY_RANKING_POLICY = Object.freeze({
  version: 1,
  score: 'brand match 100 + category match 60 + 7 per distinct request keyword',
  eligible: 'in_stock candidates at or below the task spending ceiling',
  winner: 'the eligible candidate with a unique highest score',
  tie: 'equal highest scores require an explicit user choice',
  sourceOrder: 'never breaks a score tie'
});

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

function isAllowedMethod(method) {
  return ALLOWED_METHODS.has(method);
}

function parseHttpUrl(value) {
  if (!isText(value)) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    parsed.hash = '';
    return parsed;
  } catch {
    return null;
  }
}

function approvedHosts(allowlist = []) {
  return new Set(allowlist.map((entry) => {
    const parsed = parseHttpUrl(entry.includes('://') ? entry : `https://${entry}`);
    return parsed?.hostname.toLowerCase().replace(/^\[|\]$/g, '') || null;
  }).filter(Boolean));
}

function isExplicitlyAllowlistedUrl(value, allowlist = []) {
  const parsed = parseHttpUrl(value);
  if (!parsed) return false;
  return approvedHosts(allowlist).has(parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''));
}

function isApprovedUrl(value, allowlist = []) {
  const parsed = parseHttpUrl(value);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return LOCAL_HOSTS.has(host) || approvedHosts(allowlist).has(host);
}

function normalizeTargetUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new AdapterError('INVALID_TARGET_SITE', 'Target site must be an http or https URL under 2048 characters.');
  const parsed = parseHttpUrl(value);
  if (!parsed) throw new AdapterError('INVALID_TARGET_SITE', 'Target site must be an http or https URL without credentials.');
  return parsed.toString();
}

function limitsWithDefaults(limits = {}) {
  const merged = { ...DEFAULT_LIMITS, ...limits };
  for (const name of Object.keys(DEFAULT_LIMITS)) {
    if (!Number.isSafeInteger(merged[name]) || merged[name] <= 0 || merged[name] > HARD_LIMITS[name]) throw new AdapterError('DISCOVERY_POLICY_VIOLATION', `Discovery limit ${name} is outside the safe bound.`);
  }
  return Object.freeze(merged);
}

const DISCOVERY_MESSAGES = Object.freeze({
  DISCOVERY_UNAVAILABLE: DISCOVERY_UNAVAILABLE_MESSAGE,
  DISCOVERY_DISABLED: 'Browser discovery is disabled; the seeded local catalog was used.',
  DISCOVERY_DOMAIN_BLOCKED: 'That target site is not on NaviPay\'s approved discovery allowlist.',
  DISCOVERY_NO_MATCH: 'The approved site had no matching item; the seeded local catalog was used.',
  DISCOVERY_TIMEOUT: 'The approved site did not respond before the discovery deadline.',
  DISCOVERY_WORKER_FAILED: 'The local discovery worker could not return a safe result.',
  DISCOVERY_RESPONSE_TOO_LARGE: 'The approved site exceeded the discovery response-size limit.',
  MALFORMED_DISCOVERY_DATA: 'The approved site returned malformed product data.',
  STALE_DISCOVERY_DATA: 'The approved site returned stale product data.',
  CONTRADICTORY_DISCOVERY_DATA: 'The approved site returned contradictory product data.',
  DISCOVERY_POLICY_VIOLATION: 'The approved site did not satisfy discovery policy.',
  DISCOVERY_METHOD_BLOCKED: 'The approved site attempted a non-read-only request.',
  DISCOVERY_CREDENTIALS_BLOCKED: 'Discovery blocked credentials from being sent to the approved site.',
  DISCOVERY_REDIRECT_LIMIT: 'The approved site exceeded the redirect limit.',
  DISCOVERY_TAB_LIMIT: 'The approved site exceeded the tab limit.',
  DISCOVERY_PAGE_LIMIT: 'The approved site exceeded the page or candidate limit.'
});

function safeUnavailableError(code = 'DISCOVERY_UNAVAILABLE', message = DISCOVERY_MESSAGES[code] || DISCOVERY_UNAVAILABLE_MESSAGE) {
  return new AdapterError(code, message);
}

function safeDiscoveryMessage(failure) {
  return DISCOVERY_MESSAGES[failure?.code] || DISCOVERY_UNAVAILABLE_MESSAGE;
}

function targetSiteFor(args = {}) {
  return args.targetSite || args.targetUrl || null;
}

function targetSitePolicy(targetSite, allowlist) {
  if (!targetSite) return { status: 'not_requested', url: null };
  const url = normalizeTargetUrl(targetSite);
  return {
    status: isExplicitlyAllowlistedUrl(url, allowlist) ? 'approved' : 'blocked',
    url
  };
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
  if (candidate.stockQuantity !== undefined && !isIntegerMinor(candidate.stockQuantity)) throw new AdapterError('MALFORMED_DISCOVERY_DATA', 'The merchant fixture returned an invalid stock quantity.');
  if (candidate.confidence !== undefined && (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1)) throw new AdapterError('MALFORMED_DISCOVERY_DATA', 'The merchant fixture returned an invalid confidence score.');
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
    type: candidate.evidence.type || 'playwright-merchant-fixture',
    source: candidate.evidence.source,
    sourceUrl: candidate.sourceUrl,
    observedAt: candidate.observedAt,
    note: candidate.evidence.note
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
    observedAt: candidate.observedAt,
    relevanceScore: 0,
    confidence: candidate.confidence ?? null,
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
    return { ...candidate, relevanceScore: score, confidence: Math.min(0.99, Math.max(candidate.confidence || 0, 0.5 + score / 250)), matchReasons: reasons, _order: index };
  }).filter(Boolean).sort((left, right) => right.relevanceScore - left.relevanceScore || left._order - right._order).map(({ _order, ...candidate }) => candidate);
}

function selectClearWinner(candidates, { ceilingMinor = Number.POSITIVE_INFINITY } = {}) {
  const eligible = (candidates || []).filter((candidate) => candidate.availability === 'in_stock' && candidate.totalMinor <= ceilingMinor);
  if (!eligible.length) {
    return {
      status: 'unavailable',
      candidate: null,
      eligible,
      reason: 'No in-stock candidate is within the task spending ceiling.'
    };
  }
  const [winner, runnerUp] = eligible;
  if (runnerUp && runnerUp.relevanceScore === winner.relevanceScore) {
    return {
      status: 'ambiguous',
      candidate: null,
      eligible,
      reason: 'The best eligible candidates have the same deterministic match score.'
    };
  }
  return {
    status: 'clear',
    candidate: winner,
    eligible,
    reason: 'Clear winner: the highest-scoring in-stock candidate within the task spending ceiling.'
  };
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
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') throw safeUnavailableError('DISCOVERY_TIMEOUT', 'The approved site did not respond before the discovery deadline.');
    throw safeUnavailableError('DISCOVERY_WORKER_FAILED', 'The local discovery worker could not start safely.');
  }
  let message;
  try {
    message = JSON.parse(result.stdout || '{}');
  } catch {
    throw safeUnavailableError('DISCOVERY_WORKER_FAILED', 'The local discovery worker returned an unreadable result.');
  }
  if (result.status !== 0 || !message.ok) {
    const code = isText(message.error?.code) ? message.error.code : 'DISCOVERY_WORKER_FAILED';
    throw safeUnavailableError(code, 'The approved site could not be read safely.');
  }
  return message.result;
}

function fallbackResult(localAdapter, args, failure) {
  const local = localAdapter.discover({ ...args, scenario: args.scenario === 'discovery-failure' ? 'happy' : args.scenario });
  const code = failure?.code || 'DISCOVERY_UNAVAILABLE';
  const message = safeDiscoveryMessage(failure);
  const source = 'NaviPay seeded merchant sandbox (MOCK FALLBACK - discovery unavailable)';
  return {
    ...local,
    mode: 'simulated local sandbox',
    source,
    discoveryStatus: { status: 'unavailable', code, message },
    candidates: local.candidates.map((candidate) => ({
      ...candidate,
      evidence: { ...candidate.evidence, source, note: `MOCK FALLBACK fixture; ${message}` }
    })),
    fallbackCode: code
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

  getProjection() {
    const configured = this.enabled && this.startUrls.length > 0 && this.startUrls.length <= this.limits.maxPages && this.startUrls.every((url) => isExplicitlyAllowlistedUrl(url, this.allowlist));
    if (!this.enabled) {
      return {
        version: 1,
        mode: DISCOVERY_SOURCE.SEEDED_CATALOG,
        status: 'disabled',
        label: 'Seeded catalog',
        explanation: 'NaviPay is using its seeded local merchant catalog. Local browser fixture discovery is off.',
        enabled: false,
        readOnly: true,
        recommendationOnly: false,
        configuredSite: { status: 'not_configured', label: 'No approved challenge site configured' },
        fallback: { enabled: true, source: DISCOVERY_SOURCE.SEEDED_CATALOG, label: 'Seeded catalog' }
      };
    }
    if (!configured) {
      const targetReady = this.enabled && this.allowlist.length > 0;
      return {
        version: 1,
        mode: DISCOVERY_SOURCE.BROWSER_FIXTURE,
        status: 'unavailable',
        label: 'Browser discovery unavailable',
        explanation: targetReady ? 'Enter a target site from the server-approved allowlist, or configure a challenge site. NaviPay will use its seeded catalog when browser discovery is unavailable.' : 'The local browser fixture is not configured with an approved site, so NaviPay will use its seeded catalog instead.',
        enabled: true,
        readOnly: true,
        recommendationOnly: true,
        configuredSite: { status: targetReady ? 'target_required' : 'blocked', label: targetReady ? 'Approved target site can be entered' : 'Challenge site is not approved' },
        fallback: { enabled: true, source: DISCOVERY_SOURCE.SEEDED_CATALOG, label: 'Seeded catalog fallback' }
      };
    }
    return {
      version: 1,
      mode: DISCOVERY_SOURCE.BROWSER_FIXTURE,
      status: 'ready',
      label: 'Local browser fixture',
      explanation: 'Read-only browser discovery can recommend an item from the approved challenge site. Approved merchant adapters still control quote, inventory, and payment.',
      enabled: true,
      readOnly: true,
      recommendationOnly: true,
      configuredSite: { status: 'ready', label: 'Approved challenge site ready' },
      fallback: { enabled: true, source: DISCOVERY_SOURCE.SEEDED_CATALOG, label: 'Seeded catalog fallback' }
    };
  }

  discover(args = {}) {
    this.calls += 1;
    const requestedTarget = targetSiteFor(args);
    if (args.targetSiteBlocked) {
      return fallbackResult(this.fallback, args, safeUnavailableError('DISCOVERY_DOMAIN_BLOCKED', 'That target site is not on NaviPay\'s approved discovery allowlist.'));
    }
    let targetPolicy;
    try {
      targetPolicy = requestedTarget ? targetSitePolicy(requestedTarget, this.allowlist) : { status: 'not_requested', url: null };
    } catch (error) {
      return fallbackResult(this.fallback, args, error);
    }
    if (targetPolicy.status === 'blocked') {
      return fallbackResult(this.fallback, args, safeUnavailableError('DISCOVERY_DOMAIN_BLOCKED', 'That target site is not on NaviPay\'s approved discovery allowlist.'));
    }
    if (!this.enabled) {
      if (requestedTarget) return fallbackResult(this.fallback, args, safeUnavailableError('DISCOVERY_DISABLED', 'Browser discovery is disabled; the seeded local catalog was used.'));
      return this.fallback.discover(args);
    }
    if (args.scenario === 'discovery-failure') return fallbackResult(this.fallback, args, safeUnavailableError());
    const startUrls = requestedTarget ? [targetPolicy.url] : this.startUrls;
    if (!startUrls.length || startUrls.length > this.limits.maxPages || startUrls.some((url) => !isExplicitlyAllowlistedUrl(url, this.allowlist))) {
      return fallbackResult(this.fallback, args, safeUnavailableError('DISCOVERY_DOMAIN_BLOCKED', 'No approved challenge site is configured for browser discovery.'));
    }
    const now = this.clock();
    try {
      const workerResult = this.workerRunner({
        startUrls,
        allowlist: this.allowlist,
        limits: this.limits
      }, this.limits.deadlineMs);
      const result = workerResult;
      const extracted = result?.candidates || [];
      if (!Array.isArray(extracted) || extracted.length === 0 || extracted.length > this.limits.maxCandidates) throw safeUnavailableError('DISCOVERY_NO_MATCH', 'The approved site returned no products to compare.');
      const normalized = extracted.map((candidate) => normalizeCandidate(candidate, { now: this.clock(), allowlist: this.allowlist }));
      const ranked = rankCandidates(normalized, args.request?.intent).slice(0, this.limits.maxCandidates);
      if (!ranked.length) throw safeUnavailableError('DISCOVERY_NO_MATCH', 'The approved site had no matching item; the seeded local catalog was used.');
      const discoveredAt = result.discoveredAt || now.toISOString();
      return {
        mode: 'read-only Playwright fixture',
        source: 'Local browser fixture discovery',
        recommendationOnly: true,
        discoveredAt,
        candidates: ranked,
        recommendedCandidateId: ranked[0].id,
        rankingPolicy: DISCOVERY_RANKING_POLICY,
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
    startUrls: splitList(env.NAVIPAY_DISCOVERY_URLS || env.NAVIPAY_CHALLENGE_SITE_URL),
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
  DISCOVERY_SOURCE,
  ALLOWED_METHODS,
  DEFAULT_LIMITS,
  DISCOVERY_UNAVAILABLE_MESSAGE,
  PlaywrightDiscoveryAdapter,
  createConfiguredDiscoveryAdapter,
  extractCandidatesFromHtml,
  isAllowedMethod,
  isApprovedUrl,
  isExplicitlyAllowlistedUrl,
  normalizeCandidate,
  normalizeTargetUrl,
  rankCandidates,
  selectClearWinner,
  validateExtractedCandidate,
  DISCOVERY_RANKING_POLICY
};
