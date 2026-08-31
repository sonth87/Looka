export type SecurityLevel = 'HIGH_SECURITY' | 'BALANCED' | 'CONVENIENCE';

export interface ThresholdConfig {
  matchThreshold: number;
  ambiguityMargin: number;
}

/**
 * A threshold config with a real, traceable identity — see FIX-PLAN.md step
 * 15. `id`/`version` are what gets recorded against a match (e.g. into
 * `attendance_records.policy_version`), never the security-level name alone:
 * the level is a selector, not a version — two profiles can both be
 * `'BALANCED'` while using different actual numbers.
 */
export interface ThresholdProfile extends ThresholdConfig {
  id: string;
  version: number;
  /** False accept / false reject rate from whatever evaluation produced this profile, if measured. */
  measuredFar?: number;
  measuredFrr?: number;
  measuredAt?: number;
  sampleSize?: number;
}

/** Built in, used whenever no override is supplied for a level. */
const DEFAULT_PROFILES: Record<SecurityLevel, ThresholdProfile> = {
  HIGH_SECURITY: { id: 'default-high-security', version: 1, matchThreshold: 0.75, ambiguityMargin: 0.05 },
  BALANCED: { id: 'default-balanced', version: 1, matchThreshold: 0.65, ambiguityMargin: 0.05 },
  CONVENIENCE: { id: 'default-convenience', version: 1, matchThreshold: 0.55, ambiguityMargin: 0.05 },
};

export class ThresholdPolicy {
  /**
   * Resolves a security level to the profile actually in effect.
   *
   * `overrides` is the seam for a config-driven profile (FIX-PLAN step 15's
   * "đọc từ app_settings hoặc file config") — this package has no database
   * dependency of its own, so loading real overrides from storage is the
   * caller's job; pass the result here. No caller does this yet (recognition
   * has no real entry point in the app today — see ROADMAP.md's cross-cutting
   * finding), so until one exists this always resolves to `DEFAULT_PROFILES`.
   */
  public static getThreshold(
    level: SecurityLevel = 'BALANCED',
    overrides?: Partial<Record<SecurityLevel, ThresholdProfile>>
  ): ThresholdProfile {
    return overrides?.[level] ?? DEFAULT_PROFILES[level] ?? DEFAULT_PROFILES.BALANCED;
  }
}

/** `${id}@v${version}` — the exact string recorded as `policyVersion`/`attendance_records.policy_version`. */
export function formatPolicyVersion(profile: ThresholdProfile): string {
  return `${profile.id}@v${profile.version}`;
}
