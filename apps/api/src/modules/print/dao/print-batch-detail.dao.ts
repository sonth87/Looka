import type { PrintBatch } from '../entities/print-batch.entity';
import { PrintBatchListItemDao } from './print-batch-list-item.dao';

/** `GET /v1/print/batches/:id` — list row today; kept as its own class (not a bare alias) so a batch-specific field can be added later without touching the list DAO's shape. */
export class PrintBatchDetailDao extends PrintBatchListItemDao {
  static fromDetail(batch: PrintBatch): PrintBatchDetailDao {
    const base = PrintBatchListItemDao.from(batch);
    const dao = new PrintBatchDetailDao();
    Object.assign(dao, base);
    return dao;
  }
}
