/**
 * Return type for every outbound call in `shared/integrations/*` (plan
 * §4.5). An adapter never throws for a predictable outcome and never knows
 * an HTTP status of ITS OWN api — it classifies what happened on the wire
 * into one of these, and the application handler that called it decides
 * what that means for the use case.
 *
 * `Retryable` vs `Terminal` is the distinction spec §11.1 calls the
 * "deadly trap": a remote service refusing because of OUR bad credentials
 * (`Terminal` — a config problem, page someone) and the same service being
 * unreachable (`Retryable`/`Timeout`/`Unavailable` — a network blip, a
 * worker retries) are different incidents with different owners. Collapsing
 * them into one "failed" bucket is exactly the bug spec §11.1 names.
 */
export type IntegrationOutcome<T> =
  | { readonly kind: 'Success'; readonly value: T }
  /** Transient — safe to retry with backoff (network error, 5xx, etc.). */
  | { readonly kind: 'Retryable'; readonly reason: string }
  /** Not safe to retry as-is — bad credentials, bad request shape, rejected. */
  | { readonly kind: 'Terminal'; readonly reason: string }
  | { readonly kind: 'Timeout'; readonly reason: string }
  /** The remote service itself is down/unreachable, distinct from our own timeout. */
  | { readonly kind: 'Unavailable'; readonly reason: string };

export function success<T>(value: T): IntegrationOutcome<T> {
  return { kind: 'Success', value };
}

export function retryable<T>(reason: string): IntegrationOutcome<T> {
  return { kind: 'Retryable', reason };
}

export function terminal<T>(reason: string): IntegrationOutcome<T> {
  return { kind: 'Terminal', reason };
}

export function timeout<T>(reason: string): IntegrationOutcome<T> {
  return { kind: 'Timeout', reason };
}

export function unavailable<T>(reason: string): IntegrationOutcome<T> {
  return { kind: 'Unavailable', reason };
}

export function isSuccess<T>(
  outcome: IntegrationOutcome<T>,
): outcome is { kind: 'Success'; value: T } {
  return outcome.kind === 'Success';
}
