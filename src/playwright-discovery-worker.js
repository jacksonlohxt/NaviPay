const fs = require('node:fs');
const { isApprovedUrl, ALLOWED_METHODS, DEFAULT_LIMITS, extractCandidatesFromHtml } = require('./playwright-discovery');

function policyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function redirectCount(request) {
  let count = 0;
  let previous = request.redirectedFrom();
  while (previous) {
    count += 1;
    previous = previous.redirectedFrom();
  }
  return count;
}

async function discoverWithPlaywright(input) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    throw policyError('DISCOVERY_UNAVAILABLE', 'Playwright is not installed in the local prototype.');
  }
  const limits = { ...DEFAULT_LIMITS, ...(input.limits || {}) };
  const allowlist = input.allowlist || [];
  const startedAt = Date.now();
  const deadline = startedAt + limits.deadlineMs;
  const approvedUrls = input.startUrls || [];
  if (approvedUrls.length > limits.maxPages || approvedUrls.some((url) => !isApprovedUrl(url, allowlist))) {
    throw policyError('DISCOVERY_POLICY_VIOLATION', 'A discovery URL is not approved.');
  }

  let browser;
  let policyViolation = null;
  let responseBytes = 0;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    context.on('response', (response) => {
      const declaredLength = Number(response.headers()['content-length'] || 0);
      if (declaredLength > limits.maxResponseBytes) policyViolation = policyError('DISCOVERY_RESPONSE_TOO_LARGE', 'A merchant fixture response exceeded the response-size limit.');
    });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!ALLOWED_METHODS.has(request.method())) {
        policyViolation = policyError('DISCOVERY_METHOD_BLOCKED', 'Only GET and HEAD requests are permitted during discovery.');
        await route.abort('blockedbyclient');
        return;
      }
      if (!isApprovedUrl(request.url(), allowlist)) {
        policyViolation = policyError('DISCOVERY_DOMAIN_BLOCKED', 'Navigation escaped the approved discovery domains.');
        await route.abort('blockedbyclient');
        return;
      }
      if (redirectCount(request) > limits.maxRedirects) {
        policyViolation = policyError('DISCOVERY_REDIRECT_LIMIT', 'The discovery redirect limit was exceeded.');
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    context.on('page', (page) => {
      if (context.pages().length > limits.maxTabs) {
        policyViolation = policyError('DISCOVERY_TAB_LIMIT', 'The discovery tab limit was exceeded.');
        page.close().catch(() => {});
      }
    });
    const page = await context.newPage();
    const candidates = [];
    for (const url of approvedUrls) {
      if (Date.now() >= deadline) throw policyError('DISCOVERY_TIMEOUT', 'The discovery deadline was exceeded.');
      if (context.pages().length > limits.maxTabs) throw policyError('DISCOVERY_TAB_LIMIT', 'The discovery tab limit was exceeded.');
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.max(1, deadline - Date.now()) });
      if (policyViolation) throw policyViolation;
      if (!response || !isApprovedUrl(response.url(), allowlist)) throw policyError('DISCOVERY_DOMAIN_BLOCKED', 'Navigation escaped the approved discovery domains.');
      if (redirectCount(response.request()) > limits.maxRedirects) throw policyError('DISCOVERY_REDIRECT_LIMIT', 'The discovery redirect limit was exceeded.');
      const declaredLength = Number(response.headers()['content-length'] || 0);
      if (declaredLength > limits.maxResponseBytes) throw policyError('DISCOVERY_RESPONSE_TOO_LARGE', 'The merchant fixture response exceeded the response-size limit.');
      const body = await response.body();
      responseBytes += body.length;
      if (body.length > limits.maxResponseBytes || responseBytes > limits.maxResponseBytes * limits.maxPages) throw policyError('DISCOVERY_RESPONSE_TOO_LARGE', 'The merchant fixture response exceeded the response-size limit.');
      const pageCandidates = extractCandidatesFromHtml(body.toString('utf8'), response.url(), { now: new Date(), allowlist, replayClock: true });
      candidates.push(...pageCandidates);
      if (candidates.length > limits.maxCandidates) throw policyError('DISCOVERY_PAGE_LIMIT', 'The discovery candidate limit was exceeded.');
    }
    return { discoveredAt: new Date(startedAt).toISOString(), candidates };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function main(input) {
  return discoverWithPlaywright(input);
}

if (require.main === module) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  main(input).then((result) => {
    process.stdout.write(JSON.stringify({ ok: true, result }));
  }).catch((error) => {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: error.code || 'DISCOVERY_UNAVAILABLE' } }));
    process.exitCode = 1;
  });
}

module.exports = { discoverWithPlaywright };
