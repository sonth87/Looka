import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { PrintBatch } from '../entities/print-batch.entity';
import { PrintItem } from '../entities/print-item.entity';
import { PrintItemEvent } from '../entities/print-item-event.entity';
import { Printer } from '../entities/printer.entity';
import { PrinterStockEvent } from '../entities/printer-stock-event.entity';
import { PrinterService } from './printer.service';
import { PrintBatchService } from './print-batch.service';
import { PrintItemService } from './print-item.service';

/**
 * LIVE end-to-end coverage for DIRECT print mode, against the REAL dev
 * Postgres (`apps/api/.env`'s `DATABASE_URL`) — not mocks, and not routed
 * through Nest's DI container: `new Service(...)` wired to a plain,
 * standalone `DataSource` (this test's own connection, `entities: [...]`
 * scoped to just the 5 print tables), same "fakes typed as plain shapes,
 * only cast at the constructor call site" convention `print-item.service
 * .spec.ts` already uses — just with REAL repositories/DataSource instead
 * of jest mocks. `NestFactory.createApplicationContext(AppModule)` was
 * tried first and rejected: it drags in every module's entire boot
 * sequence (`PermissionCatalogService.onApplicationBootstrap` et al),
 * which both takes minutes to ts-jest-compile from a cold cache and threw
 * `EntityMetadataNotFoundError: No metadata for "PermissionEntity"` outright
 * under ts-jest's isolated compilation — unrelated to anything this suite
 * is testing. Constructor args this suite never exercises (`templateService`/
 * `renderService`/`fileStorage`/`printStats`/`itemService`/`packageService`
 * on the two services below) are `undefined as never`, matching exactly
 * what `print-item.service.spec.ts` already does for the same reason.
 *
 * The print-agent-facing routes (`GET /v1/print/queue`,
 * `POST /v1/print/items/:id/status`, `POST /v1/printers/:id/heartbeat`) are
 * driven over REAL HTTP against the already-running dev server
 * (`pnpm run start:dev`, `http://localhost:3100`) with the real
 * agent-token Bearer header `PrinterAgentGuard` expects — this IS the
 * actual security boundary under test (ownership/idempotency/token
 * rotation), so it is exercised exactly the way a real print agent would,
 * through the real HTTP guard stack.
 *
 * Every row this suite creates is deleted in `afterAll` — printers/batches/
 * items and a throwaway campaign+import+roster row, all tagged with a
 * `__DIRECT_FLOW_LIVE_TEST__` marker in `name`/`fileName` fields so a
 * failed run's leftovers are easy to spot and re-clean by hand.
 *
 * Requires the dev API to already be running on PORT (see `.env`) — skips
 * itself with a clear message if it isn't reachable, rather than failing
 * every test with a confusing ECONNREFUSED.
 */

const API_BASE = `http://localhost:${process.env.PORT ?? 3100}/v1`;
const MARKER = '__DIRECT_FLOW_LIVE_TEST__';

/** The `ResponseTransformInterceptor` envelope every non-streaming success response is wrapped in — see that class's own doc comment. Error responses (`AllExceptionsFilter`) are NOT wrapped this way, hence `data` staying optional here. */
interface Envelope<T> {
  statusCode: number;
  message?: string | string[];
  data?: T;
}

async function agentFetch<T = unknown>(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: Envelope<T> | undefined }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let body: Envelope<T> | undefined;
  try {
    body = text ? (JSON.parse(text) as Envelope<T>) : undefined;
  } catch {
    // non-JSON body (shouldn't happen for these routes) — leave undefined
  }
  return { status: res.status, body };
}

interface QueueItemRow {
  id: string;
}

async function fetchQueue(
  token: string,
): Promise<{ status: number; itemIds: string[] }> {
  const res = await agentFetch<QueueItemRow[]>('/print/queue', token);
  return {
    status: res.status,
    itemIds: (res.body?.data ?? []).map((i) => i.id),
  };
}

interface PrinterRow {
  status: string;
  blank_stock: number;
  last_seen_at: Date | null;
  last_error: string | null;
}

interface PrintItemRow {
  status: string;
  printed_at: Date | null;
  printer_id: string | null;
  error_message: string | null;
}

interface PrintItemEventRow {
  from_status: string | null;
  to_status: string;
  source: string;
}

interface RosterRow {
  printed_at: Date | null;
  printed_batch_id: string | null;
}

describe('DIRECT print mode — live end-to-end (real dev DB + real HTTP agent routes)', () => {
  jest.setTimeout(60000);

  let dataSource: DataSource;
  let printerService: PrinterService;
  let batchService: PrintBatchService;
  let itemService: PrintItemService;
  let serverReachable = true;

  const printerIds: string[] = [];
  const batchIds: string[] = [];
  const itemIds: string[] = [];
  let campaignId: string;
  let importId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [
        PrintBatch,
        PrintItem,
        PrintItemEvent,
        Printer,
        PrinterStockEvent,
      ],
      namingStrategy: new SnakeNamingStrategy(), // matches TypeOrmConfigService's real config
      synchronize: false,
    });
    await dataSource.initialize();

    printerService = new PrinterService(
      dataSource.getRepository(Printer),
      dataSource.getRepository(PrinterStockEvent),
      dataSource,
    );
    batchService = new PrintBatchService(
      dataSource.getRepository(PrintBatch),
      dataSource.getRepository(PrintItem),
      dataSource.getRepository(PrintItemEvent),
      dataSource,
      undefined as never, // itemService — only used by addItems/removeItem/populate/render, none of which this suite calls
      undefined as never, // packageService — only used by export/package routes
    );
    itemService = new PrintItemService(
      dataSource.getRepository(PrintItem),
      dataSource.getRepository(PrintItemEvent),
      dataSource.getRepository(PrintBatch),
      dataSource,
      undefined as never, // templateService — only used by render()/preview()
      undefined as never, // renderService — only used by render()/preview()
      undefined as never, // fileStorage — only used by render()/preview()
      undefined as never, // printStats — only reached by patch()'s PRINTED branch; this suite only patches to CANCELLED
      undefined as never, // printerService — same as above (markPrintedManually)
    );

    try {
      const ping = await fetch(`${API_BASE}/print/queue`, {
        headers: { Authorization: 'Bearer not-a-real-token' },
      });
      // Any HTTP response (even 401) proves the server is up; a network
      // error means it isn't.
      serverReachable = ping.status !== undefined;
    } catch {
      serverReachable = false;
    }

    const campaignRow: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO campaigns (name) VALUES ($1) RETURNING id`,
      [`${MARKER} campaign`],
    );
    campaignId = campaignRow[0].id;
    const importRow: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO campaign_subject_imports (campaign_id, file_name) VALUES ($1, $2) RETURNING id`,
      [campaignId, `${MARKER}.xlsx`],
    );
    importId = importRow[0].id;
  });

  afterAll(async () => {
    if (itemIds.length) {
      await dataSource.query(
        `DELETE FROM print_item_events WHERE item_id = ANY($1)`,
        [itemIds],
      );
      await dataSource.query(`DELETE FROM print_items WHERE id = ANY($1)`, [
        itemIds,
      ]);
    }
    if (batchIds.length) {
      await dataSource.query(`DELETE FROM print_batches WHERE id = ANY($1)`, [
        batchIds,
      ]);
    }
    if (printerIds.length) {
      await dataSource.query(
        `DELETE FROM printer_stock_events WHERE printer_id = ANY($1)`,
        [printerIds],
      );
      await dataSource.query(`DELETE FROM printers WHERE id = ANY($1)`, [
        printerIds,
      ]);
    }
    if (campaignId) {
      // campaign_subjects/campaign_subject_imports cascade off campaigns.
      await dataSource.query(`DELETE FROM campaigns WHERE id = $1`, [
        campaignId,
      ]);
    }
    await dataSource.destroy();
  });

  /** Fixture: one printer + freshly issued agent token + a DIRECT batch pinned to it + one RENDERED item in that batch, with a matching VALID roster row so `campaign_subjects.printedAt` stamping is observable. */
  async function makeDirectFixture(opts: {
    blankStock: number;
    subjectCode: string;
  }): Promise<{
    printerId: string;
    token: string;
    batchId: string;
    itemId: string;
  }> {
    const printer = await printerService.create({
      name: `${MARKER} printer ${opts.subjectCode}`,
      usageMode: 'DIRECT',
      blankStock: opts.blankStock,
    });
    printerIds.push(printer.id);
    const { token } = await printerService.issueToken(printer.id);

    const batch = await batchService.create(
      {
        name: `${MARKER} batch ${opts.subjectCode}`,
        mode: 'DIRECT',
        printerId: printer.id,
        campaignId,
      },
      null,
    );
    batchIds.push(batch.id);

    await dataSource.query(
      `INSERT INTO campaign_subjects (campaign_id, import_id, row_no, subject_code, full_name, status)
       VALUES ($1, $2, 1, $3, $4, 'VALID')`,
      [campaignId, importId, opts.subjectCode, `${MARKER} ${opts.subjectCode}`],
    );

    // Inserted directly (not via `bulkCreate`/`render()`) — a real render
    // needs a real `subject_photo_sets` row with an APPROVED photo, which
    // is out of scope to fabricate for this suite. `setId` carries no FK
    // (cross-module, see the print migration's own top comment), so a
    // synthetic id is fine; `renderedFrontFsFileId`/`renderedBackFsFileId`
    // are fake file-service ids — nothing in the DIRECT send/queue/callback
    // path under test ever dereferences them.
    const itemRow: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO print_items
         (batch_id, campaign_id, set_id, subject_code, full_name, status,
          rendered_front_fs_file_id, rendered_back_fs_file_id, rendered_at)
       VALUES ($1, $2, $3, $4, $5, 'RENDERED', 'fake-front-file-id', 'fake-back-file-id', now())
       RETURNING id`,
      [
        batch.id,
        campaignId,
        randomUUID(),
        opts.subjectCode,
        `${MARKER} ${opts.subjectCode}`,
      ],
    );
    const itemId = itemRow[0].id;
    itemIds.push(itemId);

    // `batchService.create()` starts `itemCount` at 0 — normally incremented
    // by `addItems()`/`populate()`, both bypassed here since the item above
    // was inserted directly. `send()` refuses a batch with `itemCount === 0`
    // (`Đợt in chưa có item nào`), so this fixture must keep that counter
    // consistent with the row it just created.
    await dataSource.query(
      `UPDATE print_batches SET item_count = item_count + 1 WHERE id = $1`,
      [batch.id],
    );

    return { printerId: printer.id, token, batchId: batch.id, itemId };
  }

  async function queryPrinter(id: string): Promise<PrinterRow> {
    const rows: PrinterRow[] = await dataSource.query(
      `SELECT status, blank_stock, last_seen_at, last_error FROM printers WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  async function queryItem(id: string): Promise<PrintItemRow> {
    const rows: PrintItemRow[] = await dataSource.query(
      `SELECT status, printed_at, printer_id, error_message FROM print_items WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  async function queryEvents(itemId: string): Promise<PrintItemEventRow[]> {
    return dataSource.query(
      `SELECT from_status, to_status, source FROM print_item_events WHERE item_id = $1 ORDER BY at ASC`,
      [itemId],
    );
  }

  async function queryRosterPrintedAt(subjectCode: string): Promise<RosterRow> {
    const rows: RosterRow[] = await dataSource.query(
      `SELECT printed_at, printed_batch_id FROM campaign_subjects WHERE campaign_id = $1 AND subject_code = $2`,
      [campaignId, subjectCode],
    );
    return rows[0];
  }

  // ── 1. Full happy path ──────────────────────────────────────────────
  it('1) send() queues a RENDERED item, the agent drains it via real HTTP, and PRINTED stamps stock/status/event/roster', async () => {
    if (!serverReachable) {
      console.warn(
        'Dev API not reachable on ' +
          API_BASE +
          ' — skipping HTTP-dependent assertions for test 1.',
      );
    }
    const fx = await makeDirectFixture({
      blankStock: 5,
      subjectCode: 'SV-DIRECT-001',
    });

    await batchService.send(fx.batchId);
    let item = await queryItem(fx.itemId);
    expect(item.status).toBe('QUEUED');

    if (!serverReachable) return;

    const queue = await fetchQueue(fx.token);
    expect(queue.status).toBe(200);
    expect(queue.itemIds).toContain(fx.itemId);

    const printingRes = await agentFetch(
      `/print/items/${fx.itemId}/status`,
      fx.token,
      {
        method: 'POST',
        body: { status: 'PRINTING' },
      },
    );
    // Nest's default status for a `@Post` route with no `@HttpCode`
    // override is 201, not 200 — see `PrintAgentController.status` /
    // `PrinterAgentController.heartbeat`, neither of which overrides it.
    expect(printingRes.status).toBe(201);
    item = await queryItem(fx.itemId);
    expect(item.status).toBe('PRINTING');

    const printedRes = await agentFetch(
      `/print/items/${fx.itemId}/status`,
      fx.token,
      {
        method: 'POST',
        body: { status: 'PRINTED' },
      },
    );
    expect(printedRes.status).toBe(201);

    item = await queryItem(fx.itemId);
    expect(item.status).toBe('PRINTED');
    expect(item.printed_at).not.toBeNull();

    const printer = await queryPrinter(fx.printerId);
    expect(Number(printer.blank_stock)).toBe(4); // 5 - 1

    const events = await queryEvents(fx.itemId);
    expect(
      events.some(
        (e) => e.to_status === 'PRINTED' && e.source === 'PRINT_AGENT',
      ),
    ).toBe(true);

    // The fix under test: `campaign_subjects.printedAt` must now be stamped
    // by the DIRECT agent callback too, not only by the CENTRALIZED
    // result-upload flow.
    const roster = await queryRosterPrintedAt('SV-DIRECT-001');
    expect(roster.printed_at).not.toBeNull();
    expect(roster.printed_batch_id).toBe(fx.batchId);
  });

  // ── 2. Ownership / cross-printer security ──────────────────────────
  it("2) a different printer's agent token cannot report status for this item (403), item left untouched", async () => {
    if (!serverReachable) return;
    const fxA = await makeDirectFixture({
      blankStock: 5,
      subjectCode: 'SV-DIRECT-002',
    });
    const fxB = await makeDirectFixture({
      blankStock: 5,
      subjectCode: 'SV-DIRECT-002B',
    });
    await batchService.send(fxA.batchId);

    const res = await agentFetch(
      `/print/items/${fxA.itemId}/status`,
      fxB.token,
      {
        method: 'POST',
        body: { status: 'PRINTING' },
      },
    );
    expect(res.status).toBe(403);

    const item = await queryItem(fxA.itemId);
    expect(item.status).toBe('QUEUED'); // unaffected by the rejected cross-printer call
  });

  // ── 3. Idempotent retry ─────────────────────────────────────────────
  it('3) a duplicate PRINTED callback (at-least-once retry) is a no-op — no second stock decrement or event', async () => {
    if (!serverReachable) return;
    const fx = await makeDirectFixture({
      blankStock: 5,
      subjectCode: 'SV-DIRECT-003',
    });
    await batchService.send(fx.batchId);

    const first = await agentFetch(
      `/print/items/${fx.itemId}/status`,
      fx.token,
      {
        method: 'POST',
        body: { status: 'PRINTED' },
      },
    );
    expect(first.status).toBe(201);
    const afterFirst = await queryPrinter(fx.printerId);
    const eventsAfterFirst = await queryEvents(fx.itemId);

    const second = await agentFetch(
      `/print/items/${fx.itemId}/status`,
      fx.token,
      {
        method: 'POST',
        body: { status: 'PRINTED' },
      },
    );
    expect(second.status).toBe(201); // no error — silently accepted as a no-op

    const afterSecond = await queryPrinter(fx.printerId);
    const eventsAfterSecond = await queryEvents(fx.itemId);
    expect(Number(afterSecond.blank_stock)).toBe(
      Number(afterFirst.blank_stock),
    ); // no second decrement
    expect(eventsAfterSecond.length).toBe(eventsAfterFirst.length); // no duplicate event
  });

  // ── 4. Stock exhaustion ─────────────────────────────────────────────
  it('4) a PRINTED callback against a zero-stock printer is rejected (409) and the item is NOT left half-updated', async () => {
    if (!serverReachable) return;
    const fx = await makeDirectFixture({
      blankStock: 0,
      subjectCode: 'SV-DIRECT-004',
    });
    await batchService.send(fx.batchId);

    const printingRes = await agentFetch(
      `/print/items/${fx.itemId}/status`,
      fx.token,
      {
        method: 'POST',
        body: { status: 'PRINTING' },
      },
    );
    expect(printingRes.status).toBe(201);

    const printedRes = await agentFetch(
      `/print/items/${fx.itemId}/status`,
      fx.token,
      {
        method: 'POST',
        body: { status: 'PRINTED' },
      },
    );
    expect(printedRes.status).toBe(409);

    const item = await queryItem(fx.itemId);
    // Rolled back cleanly: still PRINTING, never silently promoted to
    // PRINTED with a negative stock.
    expect(item.status).toBe('PRINTING');
    expect(item.printed_at).toBeNull();
    const printer = await queryPrinter(fx.printerId);
    expect(Number(printer.blank_stock)).toBe(0);
  });

  // ── 5. Heartbeat ────────────────────────────────────────────────────
  it('5) heartbeat updates lastSeenAt/status, and rejects a token/:id mismatch', async () => {
    if (!serverReachable) return;
    const fxA = await makeDirectFixture({
      blankStock: 5,
      subjectCode: 'SV-DIRECT-005A',
    });
    const fxB = await makeDirectFixture({
      blankStock: 5,
      subjectCode: 'SV-DIRECT-005B',
    });

    const before = await queryPrinter(fxA.printerId);
    expect(before.last_seen_at).toBeNull();

    const res = await agentFetch(
      `/printers/${fxA.printerId}/heartbeat`,
      fxA.token,
      {
        method: 'POST',
        body: { status: 'ONLINE' },
      },
    );
    expect(res.status).toBe(201);

    const after = await queryPrinter(fxA.printerId);
    expect(after.last_seen_at).not.toBeNull();
    expect(after.status).toBe('ONLINE');

    // Token/:id mismatch — fxA's token heartbeating AS fxB's printer id.
    const mismatch = await agentFetch(
      `/printers/${fxB.printerId}/heartbeat`,
      fxA.token,
      {
        method: 'POST',
        body: { status: 'ONLINE' },
      },
    );
    expect(mismatch.status).toBe(403);
  });

  // ── 6. Cancel while queued ──────────────────────────────────────────
  it('6a) cancelling an item removes it from the agent queue and rejects a stray callback', async () => {
    if (!serverReachable) return;
    const fx = await makeDirectFixture({
      blankStock: 5,
      subjectCode: 'SV-DIRECT-006A',
    });
    await batchService.send(fx.batchId);

    let queue = await fetchQueue(fx.token);
    expect(queue.itemIds).toContain(fx.itemId);

    await itemService.patch(fx.itemId, { status: 'CANCELLED' }, null);
    const item = await queryItem(fx.itemId);
    expect(item.status).toBe('CANCELLED');

    queue = await fetchQueue(fx.token);
    expect(queue.itemIds).not.toContain(fx.itemId);

    const strayCallback = await agentFetch(
      `/print/items/${fx.itemId}/status`,
      fx.token,
      {
        method: 'POST',
        body: { status: 'PRINTING' },
      },
    );
    expect(strayCallback.status).toBe(409);
  });

  it('6b) cancelling the BATCH cascade-cancels its still-QUEUED items, removing them from the agent queue (2026-09-28 product decision, see PrintBatchService.cancel doc comment)', async () => {
    if (!serverReachable) return;
    const fx = await makeDirectFixture({
      blankStock: 5,
      subjectCode: 'SV-DIRECT-006B',
    });
    await batchService.send(fx.batchId);

    let queue = await fetchQueue(fx.token);
    expect(queue.itemIds).toContain(fx.itemId);

    await batchService.cancel(fx.batchId, null);

    const item = await queryItem(fx.itemId);
    expect(item.status).toBe('CANCELLED');

    queue = await fetchQueue(fx.token);
    expect(queue.itemIds).not.toContain(fx.itemId);

    const events = await queryEvents(fx.itemId);
    expect(events.at(-1)).toMatchObject({
      from_status: 'QUEUED',
      to_status: 'CANCELLED',
      source: 'MANUAL',
    });
  });

  it('6c) cancelling the BATCH leaves an already-PRINTING item untouched (agent already claimed it, physical print may be underway)', async () => {
    if (!serverReachable) return;
    const fx = await makeDirectFixture({
      blankStock: 5,
      subjectCode: 'SV-DIRECT-006C',
    });
    await batchService.send(fx.batchId);

    const claim = await agentFetch(
      `/print/items/${fx.itemId}/status`,
      fx.token,
      {
        method: 'POST',
        body: { status: 'PRINTING' },
      },
    );
    expect(claim.status).toBe(201);

    await batchService.cancel(fx.batchId, null);

    const item = await queryItem(fx.itemId);
    expect(item.status).toBe('PRINTING'); // deliberately untouched
  });

  // ── 7. Token rotation ───────────────────────────────────────────────
  it("7) reissuing a printer's agent token immediately invalidates the old one", async () => {
    if (!serverReachable) return;
    const fx = await makeDirectFixture({
      blankStock: 5,
      subjectCode: 'SV-DIRECT-007',
    });

    const oldTokenRes = await agentFetch('/print/queue', fx.token);
    expect(oldTokenRes.status).toBe(200);

    const { token: newToken } = await printerService.issueToken(fx.printerId);

    const oldTokenAfterRotate = await agentFetch('/print/queue', fx.token);
    expect(oldTokenAfterRotate.status).toBe(401);

    const newTokenRes = await agentFetch('/print/queue', newToken);
    expect(newTokenRes.status).toBe(200);
  });
});
