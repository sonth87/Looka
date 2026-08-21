import { ApiKeyMiddleware } from '@app/common/middlewares';
import * as configs from '@app/config';
import { TypeOrmConfigService } from '@app/database/database.service';
import { CaptureModule } from '@app/modules/capture/capture.module';
import { PhotoController } from '@app/modules/capture/controllers/photo.controller';
import { SessionController } from '@app/modules/capture/controllers/session.controller';
import { SharedModule } from '@app/modules/shared/shared.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: Object.values(configs),
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService }),
    SharedModule,
    CaptureModule,
  ],
  controllers: [AppController],
  providers: [ApiKeyMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The health check stays open - an uptime probe or load balancer should
    // not need a key, and it exposes nothing sensitive.
    consumer
      .apply(ApiKeyMiddleware)
      .forRoutes(SessionController, PhotoController);
  }
}
