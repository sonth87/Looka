import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
  ApiResponsePaginatedDecorator,
} from '@app/common/decorators';
import { Pagination } from '@app/modules/shared/common/pagination';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  PhotoDao,
  SessionDao,
  SessionDetailDao,
  SessionListItemDao,
} from '../dao';
import { AddPhotoDto, CreateSessionDto, ListSessionsQueryDto } from '../dto';
import { PhotoService } from '../services/photo.service';
import { SessionService } from '../services/session.service';

@Controller({ path: 'sessions', version: '1' })
@ApiTags('capture')
@ApiSecurity('apiKey')
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly photoService: PhotoService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Open a new capture session' })
  @ApiResponseDecorator(SessionDao, { status: 201 })
  createSession(@Body() dto: CreateSessionDto): Promise<SessionDao> {
    return this.sessionService.createSession(dto);
  }

  /**
   * List of capture sessions across both paths (web and kiosk) - A.6.
   * `state` is derived from each session's own photos, not stored - see
   * `SessionListItemDao`'s doc comment for the exact definitions.
   */
  @Get()
  @ApiOperation({ summary: 'List capture sessions, filterable and paginated' })
  @ApiResponsePaginatedDecorator(SessionListItemDao)
  listSessions(
    @Query() query: ListSessionsQueryDto,
  ): Promise<Pagination<SessionListItemDao>> {
    return this.sessionService.listSessions(query);
  }

  /** One session with every one of its photos - A.6. */
  @Get(':id')
  @ApiOperation({ summary: 'Get one capture session, with its photos' })
  @ApiResponseDecorator(SessionDetailDao)
  getSessionDetail(@Param('id') id: string): Promise<SessionDetailDao> {
    return this.sessionService.getSessionDetail(id);
  }

  /**
   * Accept one capture. The image arrives as a data URL because that is what
   * a canvas produces; it is decoded in `PhotoService` so the bytes never
   * travel further as a string that something downstream might log in full.
   */
  @Post(':id/photos')
  @HttpCode(201)
  @ApiOperation({ summary: 'Store one captured photo for a session' })
  async addPhoto(@Param('id') sessionId: string, @Body() dto: AddPhotoDto) {
    return this.photoService.addPhoto(sessionId, dto);
  }

  @Get(':id/photos')
  @ApiOperation({ summary: 'List photos captured so far in a session' })
  @ApiResponseArrayDecorator(PhotoDao)
  listPhotos(@Param('id') sessionId: string): Promise<PhotoDao[]> {
    return this.photoService.listBySession(sessionId);
  }

  /** Close a run. The photos were stored as they were taken. */
  @Post(':id/complete')
  @ApiOperation({ summary: 'Mark a session finished' })
  @ApiResponseDecorator(SessionDao)
  completeSession(@Param('id') sessionId: string): Promise<SessionDao> {
    return this.sessionService.completeSession(sessionId);
  }
}
