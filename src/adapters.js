const crypto = require('node:crypto');

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
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
    this.calls = 0;
  }

  discover({ scenario = 'happy', purchase } = {}) {
    this.calls += 1;
    if (scenario === 'discovery-failure') {
      throw new AdapterError('DISCOVERY_UNAVAILABLE', 'The simulated catalog is unavailable.');
    }

    const overCap = scenario === 'over-cap';
    const requested = purchase || { merchant: 'Harbor Supply', item: 'Anker 737 Power Bank', amountMinor: 8950 };
    const expiresAt = new Date(this.clock().getTime() + 15 * 60 * 1000).toISOString();
    const totalMinor = overCap ? 125000 : requested.amountMinor;
    const merchant = requested.merchant;
    const item = requested.item;
    const domain = merchantDomain(merchant);
    const shippingMinor = Math.min(450, Math.max(0, Math.floor(totalMinor / 10)));
    const taxMinor = Math.min(200, Math.max(0, Math.floor(totalMinor / 20)));
    const candidate = {
      id: overCap ? 'fixture-over-cap' : `fixture-${stableReference('ITEM', `${merchant}:${item}:${totalMinor}`).toLowerCase()}`,
      merchant,
      merchantDomain: domain,
      item,
      variant: 'Requested configuration',
      subtotalMinor: totalMinor - shippingMinor - taxMinor,
      shippingMinor,
      taxMinor,
      totalMinor,
      currency: 'XSGD',
      expiresAt,
      selectionReason: overCap ? 'Fixture used to prove the hard ceiling.' : 'Requested item and amount from the operator task.'
    };
    const alternateTotal = totalMinor + 1000;
    const alternate = {
      id: `${candidate.id}-alt`,
      merchant,
      merchantDomain: domain,
      item,
      variant: 'Alternate configuration',
      subtotalMinor: alternateTotal - shippingMinor - taxMinor,
      shippingMinor,
      taxMinor,
      totalMinor: alternateTotal,
      currency: 'XSGD',
      expiresAt,
      selectionReason: 'Alternate configuration from the same merchant.'
    };
    return {
      mode: 'mock',
      source: 'deterministic catalog fixture',
      candidates: [candidate, alternate],
      recommendedCandidateId: candidate.id,
      discoveredAt: this.clock().toISOString()
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
  MockFundingAdapter,
  MockDiscoveryAdapter,
  MockIssuerAdapter,
  MockCheckoutAdapter
};
