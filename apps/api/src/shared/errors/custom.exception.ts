import { HttpException as BaseHttpException, HttpStatus } from '@nestjs/common';

export class CustomException extends BaseHttpException {
  public payload: {
    error?: string;
    code?: number;
  };

  /**
   * CustomException accepts both patterns:
   * - CustomException('message', ERROR_CODE) - message first
   * - CustomException(ERROR_CODE, 'message') - code first
   */
  constructor(
    errorOrCode: string | number,
    codeOrError: number | string,
    httpStatusCode = HttpStatus.BAD_REQUEST,
  ) {
    const error =
      typeof errorOrCode === 'string' ? errorOrCode : (codeOrError as string);
    const code =
      typeof errorOrCode === 'number' ? errorOrCode : (codeOrError as number);

    super({ error }, httpStatusCode);

    this.payload = {
      error,
      code: code ?? httpStatusCode,
    };
  }
}
