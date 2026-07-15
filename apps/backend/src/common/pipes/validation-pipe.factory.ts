import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

/**
 * Single source of the global validation configuration - reused by main.ts
 * bootstrap and by e2e test app factories (TESTING_STRATEGY.md) so tests
 * exercise the exact same validation behavior as production.
 *
 * whitelist + forbidNonWhitelisted: a client sending fields not declared on
 * the DTO is rejected outright, per API_GUIDELINES.md's "Never trust client
 * input" and DTO Rules ("never expose database entities directly").
 *
 * `enableImplicitConversion` is deliberately NOT set (bug found during Phase
 * 3.4 live E2E verification): class-transformer's implicit primitive
 * conversion coerces every non-empty string to `true` for any `boolean`-typed
 * property (`Boolean("yes") === true`), which silently defeats `@IsBoolean()`
 * for every DTO in the codebase, not just this module's. Query-string
 * numeric fields (the only other primitive type that ever needs
 * string->type coercion here) opt in explicitly per-property via
 * `@Type(() => Number)` instead (see `ListFavoritesQueryDto`) - the
 * NestJS-recommended pattern - so conversion is deliberate per field rather
 * than an implicit, type-reflection-driven blanket behavior that silently
 * varies by which primitive type a property happens to declare.
 */
export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) => {
      const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
      return new BadRequestException(messages);
    },
  });
}
