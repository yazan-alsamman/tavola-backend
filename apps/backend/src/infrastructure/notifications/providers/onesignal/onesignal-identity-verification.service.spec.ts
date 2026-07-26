import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { OneSignalConfig } from '@config/onesignal.config';
import { OneSignalIdentityVerificationService } from './onesignal-identity-verification.service';

/**
 * Uses a freshly-generated ES256 (P-256) key pair, never a real OneSignal
 * secret - ADR-025's own "no key/secret exists yet" note. Verification
 * below (`jwt.verify` with the matching public key) proves the service
 * actually signs correctly, without ever touching a real credential.
 */
function generateTestKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKey, publicKey };
}

function createService(
  config: Partial<OneSignalConfig> = {},
): OneSignalIdentityVerificationService {
  const fullConfig: OneSignalConfig = {
    appId: 'fixture-app-id',
    apiKey: '',
    apiUrl: 'https://api.onesignal.com/notifications',
    requestTimeoutMs: 5000,
    identityVerificationPrivateKey: '',
    identityVerificationExpirySeconds: 3600,
    ...config,
  };
  const configService = { get: () => fullConfig } as unknown as ConfigService;
  return new OneSignalIdentityVerificationService(configService);
}

describe('OneSignalIdentityVerificationService', () => {
  it('signs an ES256 JWT with identity.external_id and iss = appId', () => {
    const { privateKey, publicKey } = generateTestKeyPair();
    const service = createService({ identityVerificationPrivateKey: privateKey });

    const token = service.sign('user-42');
    expect(token).not.toBeNull();

    const payload = jwt.verify(token as string, publicKey, {
      algorithms: ['ES256'],
      issuer: 'fixture-app-id',
    }) as jwt.JwtPayload;

    expect(payload.iss).toBe('fixture-app-id');
    expect((payload as { identity?: { external_id?: string } }).identity?.external_id).toBe(
      'user-42',
    );
    expect(typeof payload.exp).toBe('number');
  });

  it('rejects verification against a different key pair (proves it is really signed, not fabricated)', () => {
    const { privateKey } = generateTestKeyPair();
    const { publicKey: wrongPublicKey } = generateTestKeyPair();
    const service = createService({ identityVerificationPrivateKey: privateKey });

    const token = service.sign('user-42') as string;

    expect(() => jwt.verify(token, wrongPublicKey, { algorithms: ['ES256'] })).toThrow();
  });

  it('sets exp using identityVerificationExpirySeconds', () => {
    const { privateKey, publicKey } = generateTestKeyPair();
    const service = createService({
      identityVerificationPrivateKey: privateKey,
      identityVerificationExpirySeconds: 120,
    });

    const before = Math.floor(Date.now() / 1000);
    const token = service.sign('user-42') as string;
    const payload = jwt.verify(token, publicKey, { algorithms: ['ES256'] }) as jwt.JwtPayload;

    expect(payload.exp).toBeGreaterThanOrEqual(before + 119);
    expect(payload.exp).toBeLessThanOrEqual(before + 121);
  });

  it('returns null (never signs with an empty/placeholder key) when unconfigured', () => {
    const service = createService({ identityVerificationPrivateKey: '' });
    expect(service.sign('user-42')).toBeNull();
  });

  it('never throws for an unconfigured private key', () => {
    const service = createService({ identityVerificationPrivateKey: '', appId: '' });
    expect(() => service.sign('user-42')).not.toThrow();
  });

  it('exposes the configured expiry via getExpirySeconds (ADR-025 delivery port)', () => {
    const service = createService({ identityVerificationExpirySeconds: 900 });
    expect(service.getExpirySeconds()).toBe(900);
  });
});
