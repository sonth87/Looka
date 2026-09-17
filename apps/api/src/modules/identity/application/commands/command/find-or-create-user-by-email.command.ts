import { ICommand } from '@nestjs/cqrs';

/** Plan item 14, 2026-09-17 — "gán người vào campaign theo email". */
export class FindOrCreateUserByEmailCommand implements ICommand {
  constructor(
    public readonly email: string,
    public readonly displayNameHint: string | undefined,
    public readonly createdByUserId: string | null,
  ) {}
}
