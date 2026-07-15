/**
 * The two response shapes every endpoint must return, verbatim from
 * API_GUIDELINES.md's Response Format section. Nothing outside
 * ResponseEnvelopeInterceptor and GlobalExceptionFilter should construct
 * these directly.
 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  message: string;
  data: T;
  meta: Record<string, unknown>;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  /** One of API_GUIDELINES.md's Error Codes (e.g. RESERVATION_CONFLICT). */
  code: string;
  errors: string[];
  timestamp: string;
  path: string;
}
