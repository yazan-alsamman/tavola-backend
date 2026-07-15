import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { Password } from '@shared/domain/value-objects/password.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { PasswordHasher } from '../../domain/services/password-hasher.port';
import { AuthConfig } from '@config/auth.config';

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  private readonly options: argon2.Options;

  constructor(private readonly configService: ConfigService) {
    const auth = this.configService.get<AuthConfig>('auth', { infer: true });
    if (!auth) {
      throw new Error('Auth configuration is not loaded.');
    }

    this.options = {
      type: argon2.argon2id,
      memoryCost: auth.argon2MemoryCost,
      timeCost: auth.argon2TimeCost,
      parallelism: auth.argon2Parallelism,
    };
  }

  async hash(password: Password): Promise<PasswordHash> {
    const digest = await argon2.hash(password.value, this.options);
    return PasswordHash.create(digest);
  }

  async verify(password: Password, hash: PasswordHash): Promise<boolean> {
    return argon2.verify(hash.value, password.value);
  }
}
