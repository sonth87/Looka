import {
  ApiResponseDecorator,
  ApiResponsePaginatedDecorator,
} from '@app/common/decorators';
import { ApiKeyOrSsoGuard } from '@app/common/guards';
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { StudentDetailDao, StudentListItemDao } from '../dao';
import { ListStudentsQueryDto } from '../dto';
import { StudentService } from '../services/student.service';

/**
 * "Sinh viên đã chụp" (2026-09-08) — CMS-facing (global students page) AND
 * apps/web-facing (its own "Sinh viên đã chụp" desktop icon), so this is the
 * one controller in the API gated by `ApiKeyOrSsoGuard` instead of the usual
 * either/or split (`SsoAuthGuard` for CMS/admin, the shared `x-api-key` for
 * the kiosk/web capture pipeline) — see that guard's own doc comment for why,
 * and for why `PhotoController`/`VideoController` deliberately keep their own
 * SSO-only guard unchanged rather than taking this one too.
 */
@Controller({ path: 'students', version: '1' })
@ApiTags('capture')
@UseGuards(ApiKeyOrSsoGuard)
@ApiSecurity('apiKey')
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  @Get()
  @ApiOperation({ summary: 'List students who have been captured, grouped by subjectCode' })
  @ApiResponsePaginatedDecorator(StudentListItemDao)
  listStudents(@Query() query: ListStudentsQueryDto) {
    return this.studentService.listStudents(query);
  }

  @Get(':code')
  @ApiOperation({ summary: 'One student, every session across every campaign, with photos/videos and view-links' })
  @ApiResponseDecorator(StudentDetailDao)
  getStudent(@Param('code') code: string): Promise<StudentDetailDao> {
    return this.studentService.getStudentDetail(code);
  }
}
