import { z } from 'zod';

/**
 * Every env var this process reads, validated once at boot (plan §2 gap
 * #12: "host is the only layer that reads environment config" — validate
 * it there, fail fast, with one combined error instead of each consumer
 * discovering a missing var on its own at an arbitrary later point).
 *
 * Deliberately NOT `.strict()`: `process.env` legitimately carries many
 * more keys than this app reads (shell/tooling vars, other apps' vars in a
 * shared `.env`) — an unknown key is not a configuration error. Zod's
 * default (non-strict) `object()` just ignores and drops keys it doesn't
 * know about from the parsed result; it does not reject them.
 *
 * Only `DATABASE_URL` and `FS_BASE_URL` are hard-required here — both
 * already fail today without a validator (TypeORM connect error;
 * `FileStorageService.onModuleInit` throws explicitly), so requiring them
 * here changes WHEN the failure surfaces and how legible the message is,
 * not WHETHER the app can boot without them. Everything else stays
 * optional/defaulted to match each consumer's own current fallback — this
 * file does not invent new required configuration.
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  SERVICE_TYPE: z.enum(['all', 'command', 'query', 'worker']).default('all'),
  PORT: z.coerce.number().int().positive().default(3100),

  DATABASE_URL: z
    .string()
    .min(
      1,
      'DATABASE_URL is required — set it to a Postgres connection string.',
    ),
  DB_POOL_MAX: z.coerce.number().int().positive().optional(),

  API_KEY: z.string().optional(),
  SSO_BASE_URL: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  ALLOW_UNAUTHENTICATED_ADMIN_DEV: z.string().optional(),

  FS_BASE_URL: z
    .string()
    .min(
      1,
      'FS_BASE_URL is required — FileStorageService cannot start without it.',
    ),
  FS_TENANT: z.string().optional(),
  FS_API_KEY: z.string().optional(),
  FS_CONTACT_EMAIL: z.string().optional(),

  DAINAM_STUDENT_INFO_BASE_URL: z.string().optional(),
  DAINAM_STUDENT_INFO_API_KEY: z.string().optional(),

  DESKTOP_INSTALLER_PATH_MAC: z.string().optional(),
  DESKTOP_INSTALLER_PATH_WIN: z.string().optional(),

  PYTHON_AI_BASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Throws one combined, readable error listing every invalid/missing var. */
export function validateEnv(rawEnv: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(rawEnv);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return result.data;
}
