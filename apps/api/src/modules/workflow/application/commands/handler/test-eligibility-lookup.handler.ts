import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { encryptSecret } from '@app/shared/security/secret.codec';
import { EligibilityHttpClient } from '../../../infrastructure/integrations/eligibility-http.client';
import { TestEligibilityLookupCommand } from '../command/test-eligibility-lookup.command';

export interface TestLookupResult {
  success: boolean;
  message: string | null;
  sampleRecord: Record<string, unknown> | null;
  /** The full raw response — the CMS keeps this client-side as the field-picker's source for `requiredFields`, see `WorkflowConfigEditor.tsx`. Never persisted server-side (there is no catalog row to persist it onto anymore). */
  rawResponse: unknown;
}

/**
 * Plain `ICommandHandler` again (2026-09-17 redo of plan item 7) — no DB
 * write, so no `UnitOfWork` (same reasoning `sync-users.handler.ts`
 * documents), same as this handler was BEFORE the now-abandoned
 * `eligibility_api_clients` catalog design made it persist a
 * `sampleResponse` column. Calls `EligibilityHttpClient` directly against
 * whatever ad-hoc config the CMS sends — a workflow author can test-call
 * before ever saving the workflow, since there is no catalog row that
 * needs to exist first.
 */
@CommandHandler(TestEligibilityLookupCommand)
export class TestEligibilityLookupHandler implements ICommandHandler<
  TestEligibilityLookupCommand,
  TestLookupResult
> {
  constructor(private readonly httpClient: EligibilityHttpClient) {}

  async execute(
    command: TestEligibilityLookupCommand,
  ): Promise<TestLookupResult> {
    const { dto } = command;
    const outcome = await this.httpClient.lookup(
      {
        baseUrl: dto.baseUrl,
        requestMethod: dto.requestMethod ?? 'POST',
        requestPath: dto.requestPath,
        requestBodyTemplate: dto.requestBodyTemplate,
        authType: dto.authType ?? 'API_KEY_HEADER',
        authParamName: dto.authParamName,
        // `EligibilityHttpClient.lookup` only ever reads `credentialCiphertext`
        // (it's shared with the "real, saved" path where a value is
        // already encrypted) — a test call's plaintext credential is
        // encrypted here just to satisfy that one shape, then decrypted
        // straight back inside `lookup`. Harmless roundtrip; never
        // persisted anywhere, discarded once this request finishes.
        credentialCiphertext: dto.credential
          ? encryptSecret(dto.credential)
          : undefined,
        keyResponsePath: dto.keyResponsePath,
        retryCount: dto.retryCount,
        timeoutMs: dto.timeoutMs,
      },
      dto.key,
    );

    if (outcome.kind !== 'Success') {
      return {
        success: false,
        message: outcome.reason,
        sampleRecord: null,
        rawResponse: null,
      };
    }
    if (!outcome.value.record) {
      return {
        success: true,
        message:
          'Tra cứu thành công nhưng không xác định được record trong response.',
        sampleRecord: null,
        rawResponse: outcome.value.raw,
      };
    }
    return {
      success: true,
      message: null,
      sampleRecord: outcome.value.record,
      rawResponse: outcome.value.raw,
    };
  }
}
