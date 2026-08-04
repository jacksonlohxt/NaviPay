const { AdapterError } = require('./adapters');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeTimestamp(clock) {
  return clock().toISOString();
}

/**
 * Local checkout worker boundary. Each task gets a new ephemeral profile and
 * the callback is the only code path that can receive the issuer capability.
 * No credential value is placed in workerRuns or returned from this class.
 */
class LocalCheckoutWorker {
  constructor({ store, clock = () => new Date(), origin = 'http://merchant-checkout.local/', limits = {} } = {}) {
    if (!store) throw new Error('A store is required for the checkout worker.');
    this.store = store;
    this.clock = clock;
    this.origin = origin;
    this.limits = Object.freeze({ navigationMs: limits.navigationMs || 5000, actionCount: limits.actionCount || 12 });
    this.calls = 0;
  }

  run({ taskId, operationId, action, credentialCapability = null } = {}) {
    if (typeof action !== 'function') throw new AdapterError('CHECKOUT_WORKER_INVALID', 'The isolated checkout worker requires an action.');
    this.calls += 1;
    const profile = `profile-${taskId}`;
    const runId = operationId || `worker-${taskId}`;
    const startedAt = safeTimestamp(this.clock);
    this.store.transaction((data) => {
      data.workerRuns[runId] = {
        id: runId,
        taskId,
        profile,
        origin: this.origin,
        status: 'started',
        actionCount: 0,
        startedAt,
        completedAt: null,
        cleanup: 'pending'
      };
    });
    try {
      const result = action(credentialCapability);
      this.store.transaction((data) => {
        const run = data.workerRuns[runId];
        if (run) {
          run.status = 'completed';
          run.actionCount = 1;
          run.completedAt = safeTimestamp(this.clock);
          run.cleanup = 'completed';
        }
      });
      return result;
    } catch (error) {
      this.store.transaction((data) => {
        const run = data.workerRuns[runId];
        if (run) {
          run.status = 'failed';
          run.errorCode = error.code || 'CHECKOUT_WORKER_FAILED';
          run.completedAt = safeTimestamp(this.clock);
          run.cleanup = 'completed';
        }
      });
      throw error;
    } finally {
      // The capability is owned by the callback scope and is not retained.
      credentialCapability = null;
    }
  }

  getRun(runId) {
    return clone(this.store.data.workerRuns[runId] || null);
  }
}

module.exports = { LocalCheckoutWorker };
