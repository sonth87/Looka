import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  CannotCreateEntityIdMapError,
  EntityNotFoundError,
  QueryFailedError,
} from 'typeorm';
import { CustomException } from '../errors';
import { HttpResponseError } from './http.response.error';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    let code = (exception as any)?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = (exception as any)?.message;

    switch (exception?.constructor) {
      case CustomException:
        status = (exception as CustomException).getStatus();
        message = (exception as CustomException).payload.error as string;
        code =
          (exception as CustomException).payload.code ??
          (exception as CustomException).getStatus();
        break;
      case QueryFailedError: // TypeORM error
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        message = (exception as QueryFailedError).message;
        code = status;
        break;
      case EntityNotFoundError: // TypeORM error
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        message = (exception as EntityNotFoundError).message;
        code = status;
        break;
      case CannotCreateEntityIdMapError:
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        message = (exception as CannotCreateEntityIdMapError).message;
        code = status;
        break;
      case BadRequestException:
        status = HttpStatus.BAD_REQUEST;
        message = (exception as BadRequestException).message;
        code = status;
        break;
      default: {
        message = (exception as any)?.message ?? 'Internal server error';
      }
    }

    Logger.error(`[${code}] ${message}`, (exception as Error)?.stack);

    response
      .status(status)
      .json(HttpResponseError(code, message as string, request));
  }
}
