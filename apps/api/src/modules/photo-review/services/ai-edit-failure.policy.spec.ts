import { PhotoAiError } from '../application/ports/photo-ai.port';
import { resolveAiJobFailureStatus } from './ai-edit-failure.policy';
import { AI_EDIT_MAX_ATTEMPTS } from '../photo-review.constants';

describe('resolveAiJobFailureStatus', () => {
  it('resolves a Timeout PhotoAiError under the attempt cap to retry', () => {
    const error = new PhotoAiError('timed out', 'Timeout');
    expect(resolveAiJobFailureStatus(error, 1)).toBe('retry');
  });

  it('resolves a Retryable PhotoAiError under the attempt cap to retry', () => {
    const error = new PhotoAiError('503', 'Retryable');
    expect(resolveAiJobFailureStatus(error, 2)).toBe('retry');
  });

  it('resolves a Terminal PhotoAiError to FAILED regardless of attempts', () => {
    const error = new PhotoAiError('forbidden prompt', 'Terminal');
    expect(resolveAiJobFailureStatus(error, 1)).toBe('FAILED');
  });

  it('resolves an Unavailable PhotoAiError to FAILED (the sidecar is permanently dead, not worth auto-retrying)', () => {
    const error = new PhotoAiError('ECONNREFUSED', 'Unavailable');
    expect(resolveAiJobFailureStatus(error, 1)).toBe('FAILED');
  });

  it('resolves a Timeout/Retryable PhotoAiError to FAILED once AI_EDIT_MAX_ATTEMPTS is reached', () => {
    const timeoutError = new PhotoAiError('timed out', 'Timeout');
    expect(resolveAiJobFailureStatus(timeoutError, AI_EDIT_MAX_ATTEMPTS)).toBe(
      'FAILED',
    );

    const retryableError = new PhotoAiError('503', 'Retryable');
    expect(
      resolveAiJobFailureStatus(retryableError, AI_EDIT_MAX_ATTEMPTS + 1),
    ).toBe('FAILED');
  });

  it('resolves a plain (non-PhotoAiError) exception to FAILED', () => {
    expect(resolveAiJobFailureStatus(new Error('db exploded'), 1)).toBe(
      'FAILED',
    );
    expect(resolveAiJobFailureStatus('a thrown string', 1)).toBe('FAILED');
    expect(resolveAiJobFailureStatus(undefined, 1)).toBe('FAILED');
  });
});
