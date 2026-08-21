import { Injectable } from '@nestjs/common';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

/**
 * `pg`'s default pool size is 10. A capture is a handful of small statements
 * per request, so this is deliberately moderate headroom rather than
 * speculative over-provisioning - override with `DB_POOL_MAX` if the deployed
 * traffic shape needs more.
 */
const DEFAULT_DB_POOL_MAX = 10;

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  createTypeOrmOptions(): Promise<TypeOrmModuleOptions> | TypeOrmModuleOptions {
    return {
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: ['dist/modules/**/*.entity.js'],
      migrations: ['dist/database/migrations/*.js'],
      migrationsTableName: 'typeorm_migrations',
      logger: 'advanced-console',
      namingStrategy: new SnakeNamingStrategy(),
      installExtensions: true,
      uuidExtension: 'pgcrypto',
      logging: process.env.NODE_ENV === 'development' ? 'all' : ['error'],
      synchronize: false,
      extra: {
        max: +(process.env.DB_POOL_MAX ?? DEFAULT_DB_POOL_MAX),
      },
    };
  }
}
