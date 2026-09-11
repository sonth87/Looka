import { Injectable, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
  ApplicationException,
  ConflictException,
  IntegrityViolationException,
  NotFoundException,
} from '../errors/application.exception';

/** Driver error shape `pg` attaches to TypeORM's `QueryFailedError`. */
interface PgDriverError {
  readonly code?: string;
  readonly constraint?: string;
  readonly detail?: string;
  readonly table?: string;
}

const SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
} as const;

export type ConstraintExceptionFactory = (
  detail?: string,
) => ApplicationException;

/**
 * Dịch tên ràng buộc Postgres thành exception có kiểu — tầng bền vững, và
 * chỉ tầng này (plan §4.4, spec §11.2). Mỗi module đăng ký constraint của
 * chính nó qua `register()`; constraint chưa đăng ký rơi vào nhánh mặc định
 * theo SQLSTATE thay vì lộ message Postgres ra ngoài.
 *
 * `UnitOfWork.run()` gọi `translate()` trong catch trước khi ném lại lỗi;
 * `AllExceptionsFilter` gọi lại y hệt cho code CHƯA chuyển qua UnitOfWork
 * (giai đoạn chuyển đổi — có `dataSource.transaction()` nằm ngoài UnitOfWork)
 * để không cần hai nơi triển khai logic dịch lỗi.
 */
@Injectable()
export class ConstraintErrorTranslator {
  private readonly logger = new Logger(ConstraintErrorTranslator.name);
  private readonly byConstraintName = new Map<
    string,
    ConstraintExceptionFactory
  >();

  /** Called once per module, listing every unique/check constraint it owns. */
  register(constraintName: string, factory: ConstraintExceptionFactory): void {
    if (this.byConstraintName.has(constraintName)) {
      throw new Error(
        `Constraint "${constraintName}" is already registered — pick one owner.`,
      );
    }
    this.byConstraintName.set(constraintName, factory);
  }

  /** Returns the translated error to throw, or the original if untranslatable. */
  translate(err: unknown): Error {
    if (!(err instanceof QueryFailedError)) {
      return err instanceof Error ? err : new Error(String(err));
    }

    const driverError =
      (err as QueryFailedError & { driverError?: PgDriverError }).driverError ??
      {};
    const { code, constraint, detail } = driverError;

    if (constraint) {
      const factory = this.byConstraintName.get(constraint);
      if (factory) return factory(detail);
    }

    switch (code) {
      case SQLSTATE.CHECK_VIOLATION:
      case SQLSTATE.NOT_NULL_VIOLATION:
        // Đáng lẽ ValidationPipe / validator đã chặn — đây là lỗi lập
        // trình, cảnh báo riêng thay vì trả 400 như request sai bình thường.
        this.logger.error(
          `Unreachable constraint hit: ${constraint ?? code} (table ${driverError.table ?? 'unknown'}) — ` +
            'a presentation-layer validator should have caught this first.',
        );
        return new IntegrityViolationException(
          `Ràng buộc dữ liệu bị vi phạm${constraint ? ` (${constraint})` : ''}.`,
          detail,
        );

      case SQLSTATE.UNIQUE_VIOLATION:
        // Unique violation chưa đăng ký bảng dịch — không đoán ý nghĩa,
        // không lộ message Postgres, trả 409 chung chung.
        return new ConflictException(
          'UNREGISTERED_CONFLICT',
          'Dữ liệu đã tồn tại.',
          detail,
        );

      case SQLSTATE.FOREIGN_KEY_VIOLATION:
        return new NotFoundException(
          'UNREGISTERED_FK_VIOLATION',
          'Tham chiếu tới dữ liệu không tồn tại.',
          detail,
        );

      default:
        return err;
    }
  }
}
