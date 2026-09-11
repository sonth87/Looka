import { Request } from 'express';
import { IResponseError } from './response.error.interface';

export const HttpResponseError = (
  errorCode: number,
  message: string,
  _request: Request,
): IResponseError => {
  return {
    errorCode,
    message,
  };
};
