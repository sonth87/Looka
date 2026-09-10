import { Injectable } from '@nestjs/common';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { ByteaSafeAdvancedConsoleLogger } from './bytea-safe-logger';

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
      // Was the plain `'advanced-console'` string — see
      // `ByteaSafeAdvancedConsoleLogger`'s own doc comment (2026-09-10):
      // with `logging: 'all'` (below, every dev run), the stock logger's
      // `JSON.stringify` of a photo's raw bytes on every `upload_outbox`
      // INSERT measured as the dominant cost of the whole capture request
      // (400-1100ms of a request that is otherwise 12-18ms), live-confirmed
      // against this same DB. This subclass keeps every other logged query
      // and parameter byte-for-identical, only replacing an oversized
      // binary parameter with a size placeholder.
      logger: new ByteaSafeAdvancedConsoleLogger(),
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
