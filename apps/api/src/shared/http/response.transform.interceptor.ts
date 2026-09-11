import { ApiProperty } from '@nestjs/swagger';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CorrelationContext } from '../cqrs/correlation.context';

export interface IResponse<T> {
  statusCode: number;
  message: string | string[];
  data: T;
  /** Additive (plan §4.8) — old clients that don't read it are unaffected. */
  correlationId?: string;
}

export class ResponseDto<T> {
  @ApiProperty({ default: 200 })
  statusCode: number;

  @ApiProperty()
  message: string;

  @ApiProperty()
  data: T;
}

// Routes whose handlers already return the exact response body they want can
// be added here to skip the {statusCode, message, data} envelope.
const EXCLUDED_ROUTES: string[] = [];

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<
  T,
  IResponse<T> | T
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<IResponse<T> | T> {
    const request = context.switchToHttp().getRequest();
    if (EXCLUDED_ROUTES.includes(request.route?.path)) {
      return next.handle();
    }

    const correlationId =
      (request as Request & { correlationId?: string })?.correlationId ??
      CorrelationContext.current();

    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) {
          return data as T;
        }

        return {
          statusCode: context.switchToHttp().getResponse().statusCode || 500,
          message: data?.message || 'Successfully!',
          data,
          correlationId,
        };
      }),
    );
  }
}
