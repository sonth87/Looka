import { ArgumentsHost, Catch, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Response } from 'express';
import { QueryFailedError, TypeORMError } from 'typeorm';

@Catch(TypeORMError)
export class TypeOrmExceptionFilter extends BaseExceptionFilter {
  catch(exception: TypeORMError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = 500;

    Logger.error(
      `${exception.name}:`,
      exception instanceof QueryFailedError
        ? exception.query
        : exception.message,
    );

    response.status(status).json({
      statusCode: status,
      message: 'Internal server error',
      errorCode: status,
    });
  }
}
