import {
  HttpExceptionFilter,
  TypeOrmExceptionFilter,
} from '@app/common/filters';
import { ResponseTransformInterceptor } from '@app/common/interceptors/response.transform.interceptor';
import { validationPipes } from '@app/common/pipes';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
// From dist, not src: TypeOrmConfigService points `entities` at
// dist/modules/**/*.entity.js (the only path that also works for
// start/start:dev/start:prod, which all run compiled output, not ts-node) -
// importing AppModule from ts-jest-compiled src would pull in a SEPARATE
// class identity for Session/Photo/UploadOutboxEntry than the one that glob
// loads, and TypeORM matches @InjectRepository() by class identity, not by
// name. `pretest:e2e` (package.json) runs `nest build` first so this exists.
import { AppModule } from '../dist/app.module';

/**
 * Boots the real AppModule - Postgres connection included - the same way
 * capture-persistence.spec.ts does, so it needs TEST_DATABASE_URL and is
 * skipped without it (a machine without Postgres still runs the rest of the
 * suite).
 */
const dbUrl = process.env.TEST_DATABASE_URL;
const describeE2e = dbUrl ? describe : describe.skip;

describeE2e('AppModule (e2e)', () => {
  let app: INestApplication<App>;
  const apiKey = process.env.API_KEY || 'e2e-test-key';

  beforeAll(async () => {
    // ConfigService reads these lazily (registerAs factories run when a
    // namespace is first resolved, during .compile()/app.init() below), not
    // at import time - setting them here, before .compile(), is early enough
    // even though AppModule was already imported above.
    process.env.DATABASE_URL = dbUrl;
    process.env.API_KEY = apiKey;
    // FileStorageService's onModuleInit throws at boot without a baseUrl,
    // and skips its real network call (FsClient.provision()) whenever an API
    // key is already configured - a made-up key is enough to satisfy it,
    // since nothing in this suite exercises an upload.
    process.env.FS_BASE_URL =
      process.env.FS_BASE_URL || 'http://fs-service.invalid';
    process.env.FS_API_KEY = process.env.FS_API_KEY || 'e2e-fs-key';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // createNestApplication() gives a bare app - the versioning, filters,
    // and interceptor main.ts's bootstrap() applies are not automatic here,
    // so an e2e test asserting the real HTTP contract (/v1 prefix, the
    // {statusCode,message,data} envelope) has to reapply them itself. Helmet,
    // CORS, and Swagger are left out - nothing here exercises them.
    app.useGlobalFilters(
      new HttpExceptionFilter(),
      new TypeOrmExceptionFilter(),
    );
    app.useGlobalPipes(validationPipes);
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'v',
    });

    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('/v1/health (GET) answers without an API key', () => {
    // AppController declares no explicit version, so enableVersioning's
    // defaultVersion still applies to it - confirmed empirically (a bare
    // /health 404s once versioning is enabled).
    return request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.data.status).toBe('ONLINE');
      });
  });

  it('/v1/sessions (POST) rejects a request with no API key', () => {
    return request(app.getHttpServer())
      .post('/v1/sessions')
      .send({})
      .expect(401);
  });

  it('/v1/sessions (POST) rejects the wrong API key', () => {
    return request(app.getHttpServer())
      .post('/v1/sessions')
      .set('x-api-key', 'not-the-real-key')
      .send({})
      .expect(401);
  });

  it('/v1/sessions (POST) accepts the configured API key', () => {
    return request(app.getHttpServer())
      .post('/v1/sessions')
      .set('x-api-key', apiKey)
      .send({})
      .expect(201);
  });
});
