import { describe, expect, it } from 'vitest';
import { DepLensError, errorPayload, throwIfAborted } from '../src/errors.mjs';

describe('structured errors', () => {
  it('preserves machine-readable error metadata', () => {
    const error = new DepLensError('Package unavailable', {
      code: 'PACKAGE_NOT_FOUND',
      phase: 'resolution',
      retryable: false,
      details: { package: 'missing' },
    });

    expect(errorPayload(error)).toEqual({
      error: 'Package unavailable',
      errorInfo: {
        code: 'PACKAGE_NOT_FOUND',
        phase: 'resolution',
        retryable: false,
        details: { package: 'missing' },
      },
    });
  });

  it('turns AbortSignal cancellation into a stable error code', () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => throwIfAborted(controller.signal, 'analysis')).toThrowError(
      expect.objectContaining({ code: 'ABORTED', phase: 'analysis' })
    );
  });
});
