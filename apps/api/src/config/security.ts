import { registerAs } from '@nestjs/config';

export const security = registerAs('security', () => ({
  apiKey: process.env.API_KEY,
}));
