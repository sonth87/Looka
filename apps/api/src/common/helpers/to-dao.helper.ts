import { ClassConstructor, plainToInstance } from 'class-transformer';

/**
 * Maps a plain object/entity (or array of them) to a `@Expose()`-annotated DAO
 * class, stripping any field not marked with `@Expose()`. Thin wrapper around
 * `plainToInstance` so services don't repeat the `excludeExtraneousValues`
 * option everywhere.
 *
 * Usage:
 *   toDao(SessionDao, session)
 *   toDao(SessionDao, sessions) // arrays work transparently
 */
export function toDao<T, V>(cls: ClassConstructor<T>, plain: V[]): T[];
export function toDao<T, V>(cls: ClassConstructor<T>, plain: V): T;
export function toDao<T, V>(cls: ClassConstructor<T>, plain: V | V[]): T | T[] {
  return plainToInstance(cls, plain, { excludeExtraneousValues: true });
}
