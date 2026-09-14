import { ICommand } from '@nestjs/cqrs';

/**
 * Carries the ALREADY-uploaded file-service id, not raw bytes — the
 * controller does the `FileStorageService.uploadRaw()` network call
 * itself, before dispatching this command, so the DB transaction
 * `UnitOfWork.run()` opens for this command's `handle()` stays a plain,
 * fast local write (id 20+ other services' whole outbox-worker pattern
 * exists precisely to keep a slow external call out of a DB transaction —
 * an avatar image is small/synchronous-acceptable, but still shouldn't
 * hold a transaction open for the network round trip).
 */
export class SetUserAvatarCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly fsFileId: string,
  ) {}
}
