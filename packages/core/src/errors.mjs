export class DepLensError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'DepLensError';
    this.code = options.code || 'DEPLENS_ERROR';
    this.phase = options.phase || 'unknown';
    this.retryable = Boolean(options.retryable);
    this.details = options.details || null;
  }
}

export function toDepLensError(error, defaults = {}) {
  if (error instanceof DepLensError) return error;
  return new DepLensError(error instanceof Error ? error.message : String(error), {
    code: defaults.code || 'DEPLENS_ERROR',
    phase: defaults.phase || 'unknown',
    retryable: defaults.retryable,
    details: defaults.details,
    cause: error instanceof Error ? error : undefined,
  });
}

export function errorPayload(error, defaults = {}) {
  const normalized = toDepLensError(error, defaults);
  return {
    error: normalized.message,
    errorInfo: {
      code: normalized.code,
      phase: normalized.phase,
      retryable: normalized.retryable,
      details: normalized.details,
    },
  };
}

export function throwIfAborted(signal, phase = 'unknown') {
  if (!signal?.aborted) return;
  throw new DepLensError('Operation aborted', {
    code: 'ABORTED',
    phase,
    retryable: true,
  });
}

export function createOperationSignal(signal, timeoutMs, phase = 'unknown') {
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) return { signal, dispose: () => {} };
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DepLensError(`Operation timed out after ${timeout}ms`, {
          code: 'TIMEOUT',
          phase,
          retryable: true,
          details: { timeoutMs: timeout },
        })
      ),
    timeout
  );
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}
