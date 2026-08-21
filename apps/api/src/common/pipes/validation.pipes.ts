import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { CustomException } from '../errors';

export const validationPipes = new ValidationPipe({
  transform: true,
  whitelist: true,
  validateCustomDecorators: true,
  dismissDefaultMessages: false,
  exceptionFactory: (errors) => {
    const errorMessages = flattenValidationErrors(errors);
    throw new CustomException(
      errorMessages[0],
      HttpStatus.BAD_REQUEST,
      HttpStatus.BAD_REQUEST,
    );
  },
});

function flattenValidationErrors(errors: ValidationError[]): string[] {
  return errors
    .map((error) => {
      if (error.constraints) {
        return Object.values(error.constraints);
      } else if (error.children) {
        return flattenValidationErrors(error.children);
      }
      return [];
    })
    .reduce((a, b) => b.concat(a), [] as string[]);
}
