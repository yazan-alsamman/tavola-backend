import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { OpaqueTokenService } from '../../domain/services/opaque-token.port';

@Injectable()
export class Sha256OpaqueTokenService implements OpaqueTokenService {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  verify(token: string, storedHash: string): boolean {
    const computed = this.hash(token);
    if (computed.length !== storedHash.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(storedHash, 'utf8'));
  }
}
