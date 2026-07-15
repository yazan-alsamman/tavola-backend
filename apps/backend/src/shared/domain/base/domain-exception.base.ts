/**
 * Base class every business exception in every bounded context must extend
 * (CODING_STANDARDS.md: "Throw domain-specific exceptions. Avoid generic
 * Error objects."). Deliberately framework-independent - no NestJS/HTTP
 * import here, per DOMAIN_MODEL.md's rule that the Domain layer must never
 * depend on the framework. `httpStatus` is a plain number (not NestJS's
 * HttpStatus enum) for that same reason; the Global Exception Filter
 * (Presentation layer) is what actually turns it into an HTTP response.
 *
 * `code` must match one of the application error codes catalogued in
 * API_GUIDELINES.md's Error Codes section.
 */
export abstract class DomainException extends Error {
  public abstract readonly code: string;

  /** Defaults to 400 (Bad Request) - most business-rule violations are
   *  client-correctable input problems. Concrete subclasses override this
   *  where a different status is more accurate (e.g., 409 for conflicts,
   *  404 for not-found, 403 for permission-denied). */
  public readonly httpStatus: number;

  protected constructor(message: string, httpStatus = 400) {
    super(message);
    this.name = this.constructor.name;
    this.httpStatus = httpStatus;
    Error.captureStackTrace(this, this.constructor);
  }
}
