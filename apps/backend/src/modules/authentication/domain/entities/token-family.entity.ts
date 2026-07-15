import { Entity } from '@shared/domain/base/entity.base';
import { TokenFamilyId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { TokenFamilyCompromisedException } from '../exceptions/token-family-compromised.exception';

export interface TokenFamilyProps {
  id: string;
  userId: string;
  compromisedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export class TokenFamily extends Entity<TokenFamilyProps> {
  private constructor(props: TokenFamilyProps) {
    super(props);
  }

  static create(props: TokenFamilyProps): TokenFamily {
    return new TokenFamily({ ...props });
  }

  static reconstitute(props: TokenFamilyProps): TokenFamily {
    return new TokenFamily({ ...props });
  }

  get tokenFamilyId(): TokenFamilyId {
    return TokenFamilyId.create(this.props.id);
  }

  get userId(): UserId {
    return UserId.create(this.props.userId);
  }

  isCompromised(): boolean {
    return this.props.compromisedAt !== null;
  }

  isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  assertUsable(): void {
    if (this.isCompromised()) {
      throw new TokenFamilyCompromisedException();
    }
    if (this.isRevoked()) {
      throw new TokenFamilyCompromisedException();
    }
  }

  markCompromised(at: Date): TokenFamily {
    if (this.props.compromisedAt !== null) {
      return this;
    }
    return TokenFamily.reconstitute({
      ...this.props,
      compromisedAt: at,
      revokedAt: at,
    });
  }

  revoke(at: Date): TokenFamily {
    if (this.props.revokedAt !== null) {
      return this;
    }
    return TokenFamily.reconstitute({
      ...this.props,
      revokedAt: at,
    });
  }

  toProps(): Readonly<TokenFamilyProps> {
    return { ...this.props };
  }
}
