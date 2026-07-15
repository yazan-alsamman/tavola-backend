import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { DomainException } from '../../shared/domain/base/domain-exception.base';
import { ApiErrorResponse } from '../interfaces/api-response.interface';

/**
 * The single place exceptions become HTTP responses (API_GUIDELINES.md's
 * error envelope). Three cases, in priority order:
 *
 *  1. DomainException subclasses - trusted to carry the correct
 *     httpStatus/code themselves.
 *  2. NestJS HttpException (e.g. the global ValidationPipe's
 *     BadRequestException, Nest's own 404 for unmatched routes, or
 *     `FileInterceptor`'s multer wrapper converting a `limits.fileSize`
 *     violation into a 413 PayloadTooLargeException - Phase 3.2 Avatar
 *     Upload confirmed NestJS already converts raw multer errors into
 *     HttpException before a global filter ever sees them, so there is no
 *     separate multer-specific branch here) - mapped to the generic
 *     application codes catalogued in API_GUIDELINES.md.
 *  3. Anything else - never leaks internals to the client, logged at error
 *     level for on-call visibility.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { status, body } = this.buildResponse(exception, request);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${GlobalExceptionFilter.name}] Unhandled exception: ${(exception as Error)?.message}`,
        (exception as Error)?.stack,
      );
    } else {
      this.logger.warn(`[${GlobalExceptionFilter.name}] ${body.code}: ${body.message}`);
    }

    response.status(status).json(body);
  }

  private buildResponse(
    exception: unknown,
    request: Request,
  ): { status: number; body: ApiErrorResponse } {
    const timestamp = new Date().toISOString();
    const path = request.url;

    if (exception instanceof DomainException) {
      return {
        status: exception.httpStatus,
        body: {
          success: false,
          message: exception.message,
          code: exception.code,
          errors: [exception.message],
          timestamp,
          path,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const isValidation = status === HttpStatus.BAD_REQUEST;

      return {
        status,
        body: {
          success: false,
          message: isValidation ? 'Validation failed.' : exception.message,
          code: this.resolveHttpExceptionCode(status),
          errors: this.extractMessages(exception.getResponse(), exception.message),
          timestamp,
          path,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        success: false,
        message: 'An unexpected error occurred.',
        code: 'UNKNOWN_ERROR',
        errors: [],
        timestamp,
        path,
      },
    };
  }

  private resolveHttpExceptionCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return 'FILE_TOO_LARGE';
      case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
        return 'UNSUPPORTED_FILE_TYPE';
      default:
        return 'UNKNOWN_ERROR';
    }
  }

  private extractMessages(response: string | object, fallback: string): string[] {
    if (typeof response === 'string') {
      return [response];
    }

    const maybeMessage = (response as { message?: string | string[] }).message;

    if (Array.isArray(maybeMessage)) {
      return maybeMessage;
    }

    if (typeof maybeMessage === 'string') {
      return [maybeMessage];
    }

    return [fallback];
  }
}
