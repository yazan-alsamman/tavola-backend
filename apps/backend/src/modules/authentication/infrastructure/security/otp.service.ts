import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { OtpService } from '../../domain/services/otp.port';

@Injectable()
export class CryptoOtpService implements OtpService {
  generate(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hash(code: string): string {
    return createHash('sha256').update(code, 'utf8').digest('hex');
  }

  verify(code: string, storedHash: string): boolean {
    const computed = this.hash(code);
    if (computed.length !== storedHash.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(storedHash, 'utf8'));
  }
}
