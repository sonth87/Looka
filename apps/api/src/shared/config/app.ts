import { registerAs } from '@nestjs/config';

export const app = registerAs('app', () => ({
  appName: 'Looka Capture API',
  port: +(process.env.PORT ?? 3100),
  nodeEnv: process.env.NODE_ENV ?? 'development',
}));
