import { ERROR_CODES, type ErrorCode } from '@fundchain/shared';

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = ERROR_CODES[code];
  }
}
