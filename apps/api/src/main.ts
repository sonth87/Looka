import { validateEnv } from '@app/shared/config/env.schema';
import { AllExceptionsFilter } from '@app/shared/errors/all-exceptions.filter';
import { LoggingInterceptor } from '@app/shared/http/logging.interceptor';
import { ResponseTransformInterceptor } from '@app/shared/http/response.transform.interceptor';
import { validationPipes } from '@app/shared/http/validation.pipes';
import { swaggerConfig } from '@app/shared/http/swagger';
import { Type, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import 'dotenv/config';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import 'reflect-metadata';

type ServiceType = 'all' | 'command' | 'query' | 'worker';

/**
 * Picks the root module for this process per docs/plans/backend-layering-plan.md
 * §4.1/§6 Phase 0. `SERVICE_TYPE` unset (or any value other than the three
 * below) resolves to `'all'` — everything in one process, byte-for-byte the
 * app this codebase ran before Phase 0. Dynamic `import()` so a process
 * booted as one type never even loads the other three modules' import
 * graphs into memory.
 */
async function resolveRootModule(
  serviceType: ServiceType,
): Promise<Type<unknown>> {
  switch (serviceType) {
    case 'command':
      return (await import('./app-command.module.js')).AppCommandModule;
    case 'query':
      return (await import('./app-query.module.js')).AppQueryModule;
    case 'worker':
      return (await import('./app-worker.module.js')).AppWorkerModule;
    default:
      return (await import('./app.module.js')).AppModule;
  }
}

function readServiceType(): ServiceType {
  const raw = process.env.SERVICE_TYPE;
  return raw === 'command' || raw === 'query' || raw === 'worker' ? raw : 'all';
}

async function bootstrap() {
  // Fail fast with one readable error instead of a downstream TypeORM
  // connect error or FileStorageService throwing mid-request (plan §2 gap
  // #12). `dotenv/config` above has already populated `process.env`.
  validateEnv(process.env);

  const serviceType = readServiceType();
  const RootModule = await resolveRootModule(serviceType);

  const app = await NestFactory.create<NestExpressApplication>(RootModule, {
    bufferLogs: true,
  });

  app.enable('trust proxy');
  app.use(helmet());

  // Express's own default body limit is 100kb — comfortably smaller than a
  // single base64-encoded photo (2026-09-09 field bug: every kiosk photo
  // upload over ~70KB raw was silently rejected with a 413 "request entity
  // too large" the client-side retry loop then just kept backing off on
  // forever, since a 413 has no smaller-body retry to fall back to). Photos
  // land here as base64 inside JSON (`AddDevicePhotoDto.dataUrl`,
  // `AddPhotoDto.dataUrl`), which inflates a raw JPEG by ~33% — 25mb covers a
  // full-resolution capture with headroom.
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  // One global filter (plan §2 gap #4) instead of the two overlapping ones
  // this codebase had before Phase 0 — resolved through the app's DI
  // container (not `new`'d) so it shares the same ConstraintErrorTranslator
  // singleton every feature module registers its constraints into.
  app.useGlobalFilters(app.get(AllExceptionsFilter));
  app.useGlobalPipes(validationPipes);
  // LoggingInterceptor first (spec §4 step ① — outermost, so a validation
  // failure at step ② still carries a correlation id) then the response
  // envelope, matching registration = execution order for interceptors.
  app.useGlobalInterceptors(
    app.get(LoggingInterceptor),
    new ResponseTransformInterceptor(),
  );

  // The browser talks to this API, never to the file-service directly (its
  // key is namespace-wide - see FileStorageModule) - CORS is open here
  // because the deployed origin varies by environment (dev localhost, a
  // kiosk on the LAN); tighten to a fixed origin once one is fixed.
  //
  // `x-refresh-token` added 2026-09-07 alongside SsoAuthGuard: the CMS now
  // sends it (with `Authorization`) on every admin call (see apps/cms's
  // auth/authApi.ts and api.ts). A header missing from this list makes the
  // browser's own CORS preflight reject the request before it ever reaches
  // the server - indistinguishable from a server-side CORS misconfiguration
  // from the browser's console, but the fix is here, not in `origin`.
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-api-key',
      'x-refresh-token',
    ],
    credentials: true,
  });

  app.enableShutdownHooks();

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
  });

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3100;
  await app.listen(port);
  console.info(
    `[${serviceType}] Application is running on: ${await app.getUrl()}`,
  );
}

// A boot failure (bad env, DB unreachable, DI error) should exit loudly with
// a real stack trace, not fall through as an unhandled rejection that Node
// logs less legibly before exiting anyway.
bootstrap().catch((err: unknown) => {
  console.error('[bootstrap] failed:', err);
  process.exit(1);
});
