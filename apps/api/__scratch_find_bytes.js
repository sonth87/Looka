const { Client } = require('pg');
async function main() {
  const client = new Client({ connectionString: 'postgres://postgres:postgres@localhost:5432/camera' });
  await client.connect();
  const rows = await client.query(
    `SELECT id, photo_id, idem_key, status, length(content) as content_len, mime_type, created_at
       FROM upload_outbox WHERE content IS NOT NULL AND length(content) > 0
       ORDER BY created_at DESC LIMIT 10`,
  );
  console.log(rows.rows);
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
