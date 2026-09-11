import { Injectable } from '@nestjs/common';

/**
 * Per-module error-code registry (plan §4.7 / gap #10 in §2: the old
 * `code.constants.error.ts` gathers every module's domain codes into one
 * shared file — `photo-review` already gave up on that convention and made
 * its own 9xxx table locally). Each module calls `register()` once, from
 * its own `<module>.error-codes.ts`, with the exact string values it throws
 * in `ApplicationException`s. This only catches accidental cross-module
 * reuse of the same code string — it does not replace `legacy.ts`, which
 * stays as-is until the module that owns a given legacy code migrates.
 */
@Injectable()
export class ErrorCodeRegistry {
  private readonly ownerByCode = new Map<string, string>();

  register(moduleName: string, codes: Readonly<Record<string, string>>): void {
    for (const code of Object.values(codes)) {
      const owner = this.ownerByCode.get(code);
      if (owner && owner !== moduleName) {
        throw new Error(
          `Error code "${code}" is already registered by module "${owner}" — ` +
            `"${moduleName}" cannot reuse it. Pick a distinct code.`,
        );
      }
      this.ownerByCode.set(code, moduleName);
    }
  }

  ownerOf(code: string): string | undefined {
    return this.ownerByCode.get(code);
  }
}
