import { Parser } from 'expr-eval';

export interface EligibilityRule {
  key: string;
  expr: string;
  message: string;
}

export interface EligibilityEvaluation {
  eligible: boolean;
  reason?: string;
}

const parser = new Parser();

/**
 * Evaluates `campaigns.eligibility_config.rules[]` (plan §2.2,
 * `eligibility-config.schema.ts`'s own `eligibilityRuleSchema` — `expr` is
 * only checked as "non-empty string" at config-save time; REAL
 * parsing/evaluation happens here, the first real caller; 2026-09-18 —
 * moved off `workflow_versions.config.eligibility`, see
 * `Campaign.eligibilityConfig`'s own doc comment). `expr-eval` (never
 * `eval()`, plan's own explicit "never eval()" instruction) parses a safe
 * subset of JS-like math/comparison/logical syntax — e.g. `course_year >=
 * 2023 && status == "ACTIVE"` — against a flat `context` object (roster
 * fields and/or the external API record's own field names, whichever the
 * campaign's `eligibilityConfig.mode` put in play — see
 * `CampaignSubjectService.lookupSubject`).
 *
 * Rules are evaluated in order; the FIRST one whose expression is falsy
 * fails the whole check (its own `message` becomes the rejection reason) —
 * matches how the plan's sample config reads each rule as an independent
 * gate, not a scored/weighted set. A malformed expression (typo, unknown
 * field) is reported as a normal ineligibility with a reason naming which
 * rule broke, rather than throwing and 500ing the kiosk's lookup call — a
 * workflow author who mistypes a rule should see it fail closed and
 * visibly, not crash the capture flow for every student.
 */
export function evaluateEligibilityRules(
  rules: EligibilityRule[],
  context: Record<string, unknown>,
): EligibilityEvaluation {
  for (const rule of rules) {
    let result: unknown;
    try {
      result = parser.evaluate(rule.expr, context as Record<string, never>);
    } catch (error) {
      return {
        eligible: false,
        reason: `Lỗi cấu hình điều kiện "${rule.key}": ${(error as Error).message}`,
      };
    }
    if (!result) {
      return { eligible: false, reason: rule.message };
    }
  }
  return { eligible: true };
}
