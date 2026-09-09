const { FsClient } = require('../../packages/fs-client/dist/FsClient.js');

async function main() {
  const baseUrl = 'http://192.168.101.32:8080';
  const apiKey = 'fsk_g6qxtxvwe5eybo4662xn44fajy_66b71db60603ff6392824ed57b9007b4bb10906f';
  const client = new FsClient({ baseUrl, apiKey });

  const data = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const idempotencyKey = 'diagnostic-png-' + Date.now();

  console.log('uploading tiny PNG...');
  const result = await client.uploadRaw({
    virtualPath: `diagnostics/${idempotencyKey}.png`,
    mimeType: 'image/png',
    data,
    idempotencyKey,
    visibility: 'private',
  });
  console.log('upload result:', result);

  for (let i = 0; i < 15; i++) {
    try {
      const info = await client.getFile(result.fileId);
      console.log(i, 'getFile OK', info.status);
      if (info.status === 'READY') break;
    } catch (e) {
      console.log(i, 'getFile THROW', e.httpStatus, e.code, e.message);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
