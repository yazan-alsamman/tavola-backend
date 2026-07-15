import { AccessTokenClaims } from './access-token-claims';

export interface TokenService {
  signAccessToken(claims: AccessTokenClaims): string;
  verifyAccessToken(token: string): AccessTokenClaims;
}
