import {
  HttpExceptionFilter,
  TypeOrmExceptionFilter,
} from '@app/common/filters';
import { ResponseTransformInterceptor } from '@app/common/interceptors/response.transform.interceptor';
import { validationPipes } from '@app/common/pipes';
import { swaggerConfig } from '@app/common/swagger';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import 'dotenv/config';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import 'reflect-metadata';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
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

  app.useGlobalFilters(new HttpExceptionFilter(), new TypeOrmExceptionFilter());
  app.useGlobalPipes(validationPipes);
  app.useGlobalInterceptors(new ResponseTransformInterceptor());

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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-refresh-token'],
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
  await app.listen(port, async () => {
    console.info(`Application is running on: ${await app.getUrl()}`);
  });
}

bootstrap();
