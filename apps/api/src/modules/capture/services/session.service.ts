import { toDao } from '@app/common/helpers';
import { CustomException, ERROR_CODE } from '@app/common/errors';
import { CommonService } from '@app/modules/shared/common/common.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionStatus } from '../capture.constants';
import { SessionDao } from '../dao';
import { CreateSessionDto } from '../dto';
import { Session } from '../entities/session.entity';

@Injectable()
export class SessionService extends CommonService<Session> {
  constructor(
    @InjectRepository(Session)
    repository: Repository<Session>,
  ) {
    super(repository);
  }

  async createSession(dto: CreateSessionDto): Promise<SessionDao> {
    const session = await this.create({
      subjectCode: dto.subjectCode,
      subjectName: dto.subjectName,
      status: SessionStatus.IN_PROGRESS,
      metadata: dto.metadata ?? {},
    });

    return toDao(SessionDao, session);
  }

  async findByIdOrFail(id: string): Promise<Session> {
    const session = await this.findById(id);
    if (!session) {
      throw new CustomException(
        'Session not found',
        ERROR_CODE.SESSION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return session;
  }

  /**
   * Mark a run finished. Idempotent: a browser that retries after a dropped
   * response must not turn an already-completed session into an error.
   */
  async completeSession(id: string): Promise<SessionDao> {
    const session = await this.findByIdOrFail(id);

    if (session.status !== SessionStatus.COMPLETED) {
      session.status = SessionStatus.COMPLETED;
      session.completedAt = new Date();
      await this.save(session);
    }

    return toDao(SessionDao, session);
  }
}
