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
import helmet from 'helmet';
import 'reflect-metadata';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.enable('trust proxy');
  app.use(helmet());

  app.useGlobalFilters(new HttpExceptionFilter(), new TypeOrmExceptionFilter());
  app.useGlobalPipes(validationPipes);
  app.useGlobalInterceptors(new ResponseTransformInterceptor());

  // The browser talks to this API, never to the file-service directly (its
  // key is namespace-wide - see FileStorageModule) - CORS is open here
  // because the deployed origin varies by environment (dev localhost, a
  // kiosk on the LAN); tighten to a fixed origin once one is fixed.
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
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
