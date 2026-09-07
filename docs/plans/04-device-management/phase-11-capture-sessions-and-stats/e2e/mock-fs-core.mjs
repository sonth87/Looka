#!/usr/bin/env node
// Mock fs-core server for Phase 11 D1 end-to-end verification.
//
// Implements just enough of the file-service HTTP contract (see
// packages/fs-client/src/FsClient.ts + types.ts and
// docs/photo-upload-storage-flow.md §3/§6) for apps/api's FileStorageService
// and UploadWorkerService to run against it unmodified:
//
//   GET    /healthz
//   POST   /api/v1/self-service/provision
//   POST   /api/v1/files                       (direct upload only — every
//                                                photo in this test suite is
//                                                well under the 10 MiB direct
//                                                ceiling, so chunked upload,
//                                                Content-Range probing, is
//                                                intentionally NOT implemented)
//   DELETE /api/v1/files                        (cancelUpload, X-Upload-ID)
//   GET    /api/v1/files/:id
//   POST   /api/v1/files/:id/download-link
//   GET    /api/v1/files/:id/download
//   DELETE /api/v1/files/:id
//
// Node 22 built-in `http` only — no dependencies, nothing to `npm install`.
//
// Usage: node mock-fs-core.mjs [port]
//   env MOCK_FS_PORT            overrides the port (default 8999)
//   env MOCK_FS_READY_DELAY_MS  overrides the SCANNING -> READY delay (default 2000)

import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.argv[2] ?? process.env.MOCK_FS_PORT ?? 8999);
const READY_DELAY_MS = Number(process.env.MOCK_FS_READY_DELAY_MS ?? 2000);

// ---- in-memory state -------------------------------------------------------

/** slug -> { tenantId, appId, apiKey, tenantName, namespacePrefix, createdAt } */
const tenants = new Map();
/** fileId -> { fileId, virtualPath, status, size, etag, version, visibility, mimeType, sha256, deleted } */
const files = new Map();
/** idempotencyKey -> fileId, so a resent upload replays instead of duplicating. */
const idempotencyIndex = new Map();

// The smallest possible well-formed PNG (1x1, transparent) — verified to
// carry a correct signature and IEND CRC. Always what /download returns,
// regardless of what bytes were actually posted: this mock remembers upload
// *metadata* (virtual path, size, sha256 the caller claimed), not the bytes
// themselves, matching the task brief ("generate bytes in code").
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

// ---- helpers ----------------------------------------------------------------

function slugify(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'tenant';
}

function maskKey(key) {
  if (!key) return '(none)';
  const s = String(key);
  return s.length <= 12 ? `${s.slice(0, 4)}...` : `${s.slice(0, 12)}...`;
}

function errorEnvelope(code, message, detail) {
  return { error: { code, message, ...(detail !== undefined ? { detail } : {}) } };
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function log(...args) {
  console.log(`[mock-fs-core] ${new Date().toISOString()}`, ...args);
}

// ---- server ------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://localhost:${PORT}`);
  } catch {
    return sendJson(res, 400, errorEnvelope('BAD_REQUEST', 'invalid URL'));
  }

  const apiKey = req.headers['x-api-key'];
  const viewerId = req.headers['x-viewer-id'];
  log(
    req.method,
    url.pathname + url.search,
    `X-API-Key=${maskKey(apiKey)}`,
    viewerId ? `X-Viewer-ID=${viewerId}` : '',
  );

  try {
    // GET /healthz
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, { status: 'ok' });
    }

    // POST /api/v1/self-service/provision
    if (req.method === 'POST' && url.pathname === '/api/v1/self-service/provision') {
      const raw = await readBody(req);
      let body = {};
      try {
        body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
      } catch {
        return sendJson(res, 400, errorEnvelope('BAD_REQUEST', 'invalid JSON body'));
      }
      const tenantName = String(body.tenant_name ?? '').trim();
      if (!tenantName) {
        return sendJson(res, 400, errorEnvelope('BAD_REQUEST', 'tenant_name is required'));
      }

      const slug = slugify(tenantName);
      let entry = tenants.get(slug);
      let created = false;
      if (!entry) {
        entry = {
          tenantId: crypto.randomUUID(),
          appId: crypto.randomUUID(),
          apiKey: `fsc_mock_${slug}`,
          tenantName,
          namespacePrefix: `/apps/${slug}`,
          createdAt: new Date().toISOString(),
        };
        tenants.set(slug, entry);
        created = true;
        log(`  PROVISIONED tenant_name="${tenantName}" -> api_key=${entry.apiKey} namespace=${entry.namespacePrefix}`);
      } else {
        log(`  provision replay for tenant_name="${tenantName}" -> api_key=${entry.apiKey}`);
      }

      return sendJson(res, 200, {
        tenant_id: entry.tenantId,
        app_id: entry.appId,
        api_key: entry.apiKey,
        tenant_name: entry.tenantName,
        namespace_prefix: entry.namespacePrefix,
        created,
      });
    }

    // DELETE /api/v1/files  (cancel a chunked upload session — never actually
    // reached by this test suite since every photo is well under the direct
    // ceiling, but implemented for completeness / future re-use)
    if (req.method === 'DELETE' && url.pathname === '/api/v1/files') {
      await readBody(req).catch(() => {});
      log(`  cancelUpload X-Upload-ID=${req.headers['x-upload-id'] ?? '(none)'}`);
      res.writeHead(204);
      return res.end();
    }

    // POST /api/v1/files  (direct upload)
    if (req.method === 'POST' && url.pathname === '/api/v1/files') {
      const body = await readBody(req);
      const virtualPath = req.headers['x-virtual-path'] ? String(req.headers['x-virtual-path']) : '';
      const sha256 = req.headers['x-content-sha256'] ? String(req.headers['x-content-sha256']) : '';
      const idemKey = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']) : '';
      const visibility = req.headers['x-visibility'] === 'private' ? 'private' : 'public';
      const mimeType = String(req.headers['content-type'] ?? req.headers['x-content-type'] ?? 'application/octet-stream');

      // Idempotent replay: same key -> same file, no second object created.
      if (idemKey && idempotencyIndex.has(idemKey)) {
        const fileId = idempotencyIndex.get(idemKey);
        const existing = files.get(fileId);
        if (existing) {
          log(`  idempotent replay Idempotency-Key=${idemKey} -> file_id=${fileId}`);
          return sendJson(res, 201, {
            file_id: existing.fileId,
            virtual_path: existing.virtualPath,
            status: existing.status,
            size: existing.size,
            etag: existing.etag,
            version: existing.version,
            dedup_hit: true,
            visibility: existing.visibility,
          });
        }
      }

      const fileId = crypto.randomUUID();
      const etag = crypto.createHash('sha256').update(body).update(fileId).digest('hex').slice(0, 32);
      const record = {
        fileId,
        virtualPath,
        status: 'SCANNING',
        size: body.length,
        etag,
        version: 1,
        visibility,
        mimeType,
        sha256,
        deleted: false,
      };
      files.set(fileId, record);
      if (idemKey) idempotencyIndex.set(idemKey, fileId);

      log(
        `  UPLOADED file_id=${fileId} virtual_path="${virtualPath}" size=${body.length}` +
          ` visibility=${visibility} sha256=${sha256.slice(0, 12)}...`,
      );

      setTimeout(() => {
        const f = files.get(fileId);
        if (f && !f.deleted && f.status === 'SCANNING') {
          f.status = 'READY';
          log(`  file_id=${fileId} scan complete -> READY`);
        }
      }, READY_DELAY_MS);

      return sendJson(res, 201, {
        file_id: fileId,
        virtual_path: virtualPath,
        status: record.status,
        size: record.size,
        etag,
        version: 1,
        dedup_hit: false,
        visibility,
      });
    }

    // /api/v1/files/:id[...]
    const fileMatch = url.pathname.match(/^\/api\/v1\/files\/([^/]+)(\/.*)?$/);
    if (fileMatch) {
      const fileId = decodeURIComponent(fileMatch[1]);
      const rest = fileMatch[2] ?? '';
      const f = files.get(fileId);

      if (req.method === 'GET' && rest === '') {
        if (!f || f.deleted) {
          return sendJson(res, 404, errorEnvelope('NOT_FOUND', `file ${fileId} not found`));
        }
        return sendJson(res, 200, {
          file_id: f.fileId,
          virtual_path: f.virtualPath,
          status: f.status,
          size: f.size,
        });
      }

      if (req.method === 'POST' && rest === '/download-link') {
        if (!f || f.deleted) {
          return sendJson(res, 404, errorEnvelope('NOT_FOUND', `file ${fileId} not found`));
        }
        const ttl = Number(url.searchParams.get('ttl_seconds') ?? '600') || 600;
        const allowDownload = url.searchParams.get('allow_download') !== 'false';
        const token = crypto.randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
        log(`  download-link file_id=${fileId} viewer=${viewerId ?? '(none)'} ttl_seconds=${ttl}`);
        return sendJson(res, 201, {
          url: `/api/v1/files/${fileId}/download?token=${token}`,
          expires_at: expiresAt,
          allow_download: allowDownload,
        });
      }

      if (req.method === 'GET' && rest === '/download') {
        if (!f || f.deleted) {
          return sendJson(res, 404, errorEnvelope('NOT_FOUND', `file ${fileId} not found`));
        }
        if (f.status !== 'READY') {
          return sendJson(res, 423, errorEnvelope('NOT_READY', `file ${fileId} is ${f.status}`, { status: f.status }));
        }
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': TINY_PNG.length,
          'Cache-Control': 'private, no-store',
        });
        return res.end(TINY_PNG);
      }

      if (req.method === 'DELETE' && rest === '') {
        if (f) {
          f.deleted = true;
          f.status = 'TRASHED';
        }
        log(`  DELETED file_id=${fileId} (existed=${!!f})`);
        return sendJson(res, 200, { file_id: fileId, status: 'TRASHED' });
      }
    }

    return sendJson(res, 404, errorEnvelope('NOT_FOUND', `no such route: ${req.method} ${url.pathname}`));
  } catch (err) {
    log('  ERROR', err?.stack ?? String(err));
    return sendJson(res, 500, errorEnvelope('INTERNAL', String(err?.message ?? err)));
  }
});

server.listen(PORT, () => {
  log(`mock fs-core listening on http://localhost:${PORT} (ready-delay=${READY_DELAY_MS}ms)`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
