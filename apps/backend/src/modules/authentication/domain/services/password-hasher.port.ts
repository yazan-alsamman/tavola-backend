import { Password } from '@shared/domain/value-objects/password.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';

export interface PasswordHasher {
  hash(password: Password): Promise<PasswordHash>;
  verify(password: Password, hash: PasswordHash): Promise<boolean>;
}
