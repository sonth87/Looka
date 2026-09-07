import { Pagination } from '@app/modules/shared/common/pagination';
import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiResponseOptions,
  getSchemaPath,
} from '@nestjs/swagger';

/**
 * Swagger-only envelope shapes mirroring `IResponse<T>`
 * (`src/common/interceptors/response.transform.interceptor.ts`), used purely
 * so `ApiResponseDecorator`/`ApiResponseArrayDecorator` can describe the
 * `{ statusCode, message, data }` wrapper the real interceptor adds at
 * runtime.
 */
class ApiObjectResponseEnvelope<T> {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Successfully!' })
  message: string;

  @ApiProperty()
  data: T;
}

class ApiArrayResponseEnvelope<T> {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Successfully!' })
  message: string;

  @ApiProperty({ isArray: true })
  data: T[];
}

/** Documents a handler that returns `{ statusCode, message, data: <model> }`. */
export const ApiResponseDecorator = <TModel extends Type<any>>(
  model: TModel,
  options?: ApiResponseOptions,
) => {
  return applyDecorators(
    ApiExtraModels(ApiObjectResponseEnvelope, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiObjectResponseEnvelope) },
          { properties: { data: { $ref: getSchemaPath(model) } } },
        ],
      },
      ...options,
    }),
  );
};

/** Documents a handler that returns `{ statusCode, message, data: <model>[] }`. */
export const ApiResponseArrayDecorator = <TModel extends Type<any>>(
  model: TModel,
  options?: ApiResponseOptions,
) => {
  return applyDecorators(
    ApiExtraModels(ApiArrayResponseEnvelope, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiArrayResponseEnvelope) },
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
            },
          },
        ],
      },
      ...options,
    }),
  );
};

/**
 * Documents a handler that returns `{ statusCode, message, data: Pagination<model> }`
 * - the `items`/`meta` shape from `modules/shared/common/pagination.ts`,
 * with `items` typed to the given model. A bare `Pagination<T>` return type
 * loses that at the Swagger level since TS generics do not survive to
 * runtime, so the item model has to be threaded through explicitly here,
 * the same reason `ApiResponseArrayDecorator` above takes one.
 */
export const ApiResponsePaginatedDecorator = <TModel extends Type<any>>(
  model: TModel,
  options?: ApiResponseOptions,
) => {
  return applyDecorators(
    ApiExtraModels(ApiObjectResponseEnvelope, Pagination, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiObjectResponseEnvelope) },
          {
            properties: {
              data: {
                allOf: [
                  { $ref: getSchemaPath(Pagination) },
                  {
                    properties: {
                      items: {
                        type: 'array',
                        items: { $ref: getSchemaPath(model) },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      ...options,
    }),
  );
};
