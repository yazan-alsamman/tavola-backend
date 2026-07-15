export interface AuthTokenTtlPort {
  readonly accessTokenTtlSeconds: number;
}

export const AUTH_TOKEN_TTL = Symbol('AUTH_TOKEN_TTL');
