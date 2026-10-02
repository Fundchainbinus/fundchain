import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  PayloadTooLargeException,
  StreamableFile,
  ValidationError,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { map } from 'rxjs';
import { AppError } from './app-error';

/** Bungkus semua response sukses jadi { success: true, data }. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next
      .handle()
      .pipe(map((data) => (data instanceof StreamableFile ? data : { success: true, data: data ?? null })));
  }
}

/** Semua error jadi { success: false, error: { code, message } } — tanpa membocorkan detail internal. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const send = (status: number, code: string, message: string, details?: unknown) =>
      res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) } });

    if (exception instanceof AppError) {
      return send(exception.status, exception.code, exception.message, exception.details);
    }
    if (exception instanceof ThrottlerException) {
      return send(429, 'RATE_LIMITED', 'Terlalu banyak permintaan, coba lagi sebentar.');
    }
    if (exception instanceof PayloadTooLargeException) {
      return send(400, 'FILE_TOO_LARGE', 'Ukuran file maksimal 4MB.');
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 404 ? 'NOT_FOUND' : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR';
      const body = exception.getResponse() as { message?: string | string[] };
      const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message ?? exception.message;
      return send(status, code, message);
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return send(500, 'INTERNAL_ERROR', 'Terjadi kesalahan pada server.');
  }
}

export function validationExceptionFactory(errors: ValidationError[]) {
  const flatten = (list: ValidationError[], prefix = ''): Record<string, string[]> =>
    list.reduce<Record<string, string[]>>((acc, err) => {
      const key = prefix ? `${prefix}.${err.property}` : err.property;
      if (err.constraints) acc[key] = Object.values(err.constraints);
      if (err.children?.length) Object.assign(acc, flatten(err.children, key));
      return acc;
    }, {});
  const fields = flatten(errors);
  const first = Object.values(fields)[0]?.[0] ?? 'Input tidak valid';
  return new AppError('VALIDATION_ERROR', first, fields);
}
