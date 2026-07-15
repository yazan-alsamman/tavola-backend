import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { DomainException } from '../../shared/domain/base/domain-exception.base';

class TestDomainException extends DomainException {
  readonly code = 'TEST_DOMAIN_ERROR';

  constructor() {
    super('Domain rule violated.', 409);
  }
}

describe('GlobalExceptionFilter', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() } as never;
  const filter = new GlobalExceptionFilter(logger);

  const createHost = (url = '/api/v1/test') => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });

    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ url }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;

    return { host, json, status };
  };

  it('maps DomainException to its code and status', () => {
    const { host, json, status } = createHost();

    filter.catch(new TestDomainException(), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'TEST_DOMAIN_ERROR',
        message: 'Domain rule violated.',
        path: '/api/v1/test',
      }),
    );
  });

  it('maps validation failures to VALIDATION_ERROR', () => {
    const { host, json, status } = createHost();

    filter.catch(new BadRequestException(['name must be a string']), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed.',
        errors: ['name must be a string'],
      }),
    );
  });

  it.each([
    [new UnauthorizedException(), 'UNAUTHORIZED'],
    [new ForbiddenException(), 'FORBIDDEN'],
    [new NotFoundException(), 'NOT_FOUND'],
  ])('maps generic HTTP exceptions to application codes', (exception, code) => {
    const { host, json } = createHost();

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code }));
  });

  it("maps a 413 (e.g. FileInterceptor's multer size-limit wrapper) to FILE_TOO_LARGE", () => {
    const { host, json, status } = createHost();

    filter.catch(new PayloadTooLargeException('File too large'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'FILE_TOO_LARGE' }),
    );
  });

  it('maps a 415 to UNSUPPORTED_FILE_TYPE', () => {
    const { host, json, status } = createHost();

    filter.catch(new UnsupportedMediaTypeException('Unsupported type'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'UNSUPPORTED_FILE_TYPE' }),
    );
  });

  it('never leaks internals for unknown errors', () => {
    const { host, json, status } = createHost();

    filter.catch(new Error('database connection string leaked'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred.',
        errors: [],
      }),
    );
    expect(json.mock.calls[0][0].message).not.toContain('database');
  });
});
