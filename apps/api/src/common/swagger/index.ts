import { DocumentBuilder } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('Looka Capture API')
  .setDescription(
    'Backend the web capture app talks to. Holds the file-service key and owns the Postgres record of a capture session.',
  )
  .setVersion('1.0')
  .addTag('capture', 'Capture sessions and photos')
  .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'apiKey')
  .build();
