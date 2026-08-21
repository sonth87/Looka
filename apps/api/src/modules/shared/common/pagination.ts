import { ApiProperty } from '@nestjs/swagger';
import { IPaginationMeta } from './interfaces';

export class PaginationMetaDao implements IPaginationMeta {
  @ApiProperty()
  itemCount: number;

  @ApiProperty({ required: false })
  totalItems?: number;

  @ApiProperty()
  itemsPerPage: number;

  @ApiProperty({ required: false })
  totalPages?: number;

  @ApiProperty()
  currentPage: number;

  constructor(meta: IPaginationMeta) {
    this.itemCount = meta.itemCount;
    this.totalItems = meta.totalItems;
    this.itemsPerPage = meta.itemsPerPage;
    this.totalPages = meta.totalPages;
    this.currentPage = meta.currentPage;
  }
}

/**
 * Response shape for a paginated list, wrapping whatever DAO the module maps
 * its items to. The querying half of this pattern is `CommonService.paginate()`
 * (nestjs-typeorm-paginate's own `Pagination<T>`); this class is the
 * Swagger-decorated mirror a controller actually returns, so `items` can be
 * typed as the module's DAO rather than the raw entity.
 */
export class Pagination<T> {
  @ApiProperty({ isArray: true })
  items: T[];

  @ApiProperty({ type: PaginationMetaDao })
  meta: PaginationMetaDao;

  constructor(items: T[], meta: IPaginationMeta) {
    this.items = items;
    this.meta = new PaginationMetaDao(meta);
  }
}
