import { CustomException, ERROR_CODE } from '@app/common/errors';
import { Injectable } from '@nestjs/common';
import {
  IPaginationMeta,
  IPaginationOptions,
  paginate,
} from 'nestjs-typeorm-paginate';
import {
  DeepPartial,
  EntityManager,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  In,
  InsertResult,
  ObjectLiteral,
  Repository,
  SaveOptions,
  SelectQueryBuilder,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { UpsertOptions } from 'typeorm/repository/UpsertOptions';

/**
 * Generic base service every module's repository-backed service should
 * extend, e.g. `class PhotoService extends CommonService<Photo>`.
 *
 * Bundles the usual CRUD/pagination helpers plus pessimistic-locking helpers
 * (`findForUpdate*`) for the rare read-then-write that needs to be race-safe
 * under concurrent requests (e.g. claiming an outbox row).
 */
@Injectable()
export class CommonService<T extends ObjectLiteral> {
  constructor(protected repository: Repository<T>) {}

  save(entity: T, options?: SaveOptions) {
    return this.repository.save(entity, options);
  }

  new(data: DeepPartial<T>) {
    return this.repository.create(data);
  }

  creates(datas: DeepPartial<T>[]): T[] {
    return this.repository.create(datas);
  }

  async create(data: DeepPartial<T>) {
    return this.repository.save(this.repository.create(data));
  }

  findAll(options: FindManyOptions<T>) {
    return this.repository.find(options);
  }

  findOneQueryBuilder<U extends ObjectLiteral = T>(
    queryBuilder: SelectQueryBuilder<U>,
  ) {
    return queryBuilder.getOne();
  }

  findAllQueryBuilder<U extends ObjectLiteral = T>(
    queryBuilder: SelectQueryBuilder<U>,
  ) {
    return queryBuilder.getMany();
  }

  countQueryBuilder<U extends ObjectLiteral = T>(
    queryBuilder: SelectQueryBuilder<U>,
  ) {
    return queryBuilder.getCount();
  }

  paginate(
    paginateOption: IPaginationOptions<IPaginationMeta>,
    searchOptions?: FindOptionsWhere<T> | FindManyOptions<T>,
  ) {
    return paginate<T>(this.repository, paginateOption, searchOptions);
  }

  paginateQueryBuilder<U extends ObjectLiteral = T>(
    queryBuilder: SelectQueryBuilder<U>,
    paginateOption: IPaginationOptions<IPaginationMeta>,
  ) {
    return paginate<U>(queryBuilder, paginateOption);
  }

  count(options: FindManyOptions<T>) {
    return this.repository.count(options);
  }

  findAndCount(options: FindManyOptions<T>) {
    return this.repository.findAndCount(options);
  }

  findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.repository.findOne(options);
  }

  findById(id: string | number): Promise<T | null> {
    return this.repository.findOneBy({ id } as unknown as FindOptionsWhere<T>);
  }

  findOneByOrFail(id: string | number): Promise<T> {
    return this.repository.findOneByOrFail({
      id,
    } as unknown as FindOptionsWhere<T>);
  }

  findByIds(ids: (string | number)[]): Promise<T[]> {
    return this.repository.find({
      where: { id: In(ids) } as unknown as FindOptionsWhere<T>,
    });
  }

  async update(id: string | number, data: DeepPartial<T>) {
    await this.repository.update(id, data as QueryDeepPartialEntity<T>);
    return true;
  }

  async delete(id: string | number | string[] | number[]) {
    await this.repository.delete(id);
    return true;
  }

  async softDelete(id: string | number) {
    try {
      await this.repository.softDelete(id);
      return true;
    } catch (error: any) {
      throw new CustomException(error.message, ERROR_CODE.BAD_REQUEST);
    }
  }

  /**
   * Locks the matching row(s) for the duration of the surrounding
   * transaction (`manager`). Use inside `dataSource.transaction(async (manager) => { ... })`
   * whenever a read-then-write needs to be race-safe under concurrent requests
   * - the upload outbox's `claimNext` is the case that needs this here.
   */
  async findForUpdate(
    manager: EntityManager,
    options: FindOneOptions<T>,
  ): Promise<T | null> {
    return manager.withRepository(this.repository).findOne({
      ...options,
      transaction: true,
      lock: { mode: 'pessimistic_write' },
    });
  }

  async findForUpdateById(
    manager: EntityManager,
    id: string | number,
  ): Promise<T | null> {
    return manager.withRepository(this.repository).findOne({
      where: { id } as unknown as FindOptionsWhere<T>,
      transaction: true,
      lock: { mode: 'pessimistic_write' },
    });
  }

  async findManyForUpdate(
    manager: EntityManager,
    options: FindManyOptions<T>,
  ): Promise<T[]> {
    return manager.withRepository(this.repository).find({
      ...options,
      transaction: true,
      lock: { mode: 'pessimistic_write' },
    });
  }

  async saveWithTransaction(manager: EntityManager, entity: T): Promise<T> {
    return manager
      .withRepository(this.repository)
      .save(entity, { transaction: true });
  }

  async saveMultiWithTransaction(
    manager: EntityManager,
    entities: T[],
  ): Promise<T[]> {
    return manager
      .withRepository(this.repository)
      .save(entities, { transaction: true });
  }

  async upsertWithTransaction(
    manager: EntityManager,
    entityOrEntities: QueryDeepPartialEntity<T> | QueryDeepPartialEntity<T>[],
    conflictPathsOrOptions: string[] | UpsertOptions<T>,
  ): Promise<InsertResult> {
    return manager
      .withRepository(this.repository)
      .upsert(entityOrEntities, conflictPathsOrOptions);
  }

  async upsert(
    entityOrEntities: QueryDeepPartialEntity<T> | QueryDeepPartialEntity<T>[],
    conflictPathsOrOptions: string[] | UpsertOptions<T>,
  ): Promise<InsertResult> {
    return this.repository.upsert(entityOrEntities, conflictPathsOrOptions);
  }

  async createWithTransaction(
    manager: EntityManager,
    data: DeepPartial<T>,
  ): Promise<T> {
    return manager
      .withRepository(this.repository)
      .save(this.new(data), { transaction: true });
  }

  async createsWithTransaction(
    manager: EntityManager,
    datas: DeepPartial<T>[],
  ): Promise<T[]> {
    if (datas && datas.length > 0) {
      return manager
        .withRepository(this.repository)
        .save(this.creates(datas), { transaction: true });
    }
    return [];
  }
}
