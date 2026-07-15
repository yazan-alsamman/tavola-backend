import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_ENVELOPE_KEY = 'skipResponseEnvelope';

/**
 * API_GUIDELINES.md's { success, message, data, meta } envelope is a
 * business-API convention. Operational endpoints consumed by infrastructure
 * (Prometheus scraping /metrics, Docker/k8s probing /health) have their own
 * required response contracts (Prometheus text exposition format, Terminus's
 * { status, info, details } shape) that must not be wrapped - this
 * decorator tells ResponseEnvelopeInterceptor to pass the response through
 * unmodified.
 */
export const SkipResponseEnvelope = (): MethodDecorator =>
  SetMetadata(SKIP_RESPONSE_ENVELOPE_KEY, true);
