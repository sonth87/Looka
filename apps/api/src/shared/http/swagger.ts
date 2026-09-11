import { DocumentBuilder } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('Looka Capture API')
  .setDescription(
    'Backend the web capture app talks to. Holds the file-service key and owns the Postgres record of a capture session.',
  )
  .setVersion('1.0')
  .addTag('capture', 'Capture sessions and photos')
  .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'apiKey')
  // CMS/admin surface (campaigns, devices, CMS-facing session browsing,
  // photo view-links) — SsoAuthGuard forwards this bearer token to the
  // external SSO backend's GET /auth/profile, see docs/LOGIN.md §12.
  .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'sso')
  .build();
