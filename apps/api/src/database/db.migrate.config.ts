import 'dotenv/config';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

const isLocal = process.env.NODE_ENV !== 'production';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: isLocal
    ? ['src/modules/**/*.entity.{ts,js}']
    : [path.join(process.cwd(), 'dist/modules/**/*.entity.js')],
  migrations: isLocal
    ? ['src/database/migrations/*.{ts,js}']
    : [path.join(process.cwd(), 'dist/database/migrations/*.js')],
  migrationsTableName: 'typeorm_migrations',
  logger: 'advanced-console',
  namingStrategy: new SnakeNamingStrategy(),
  logging: 'all',
});
