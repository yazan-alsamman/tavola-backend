import { ValueObject } from '@shared/domain/base/value-object.base';

export type AuthorizationDecision =
  Readonly<{ allowed: true }> | Readonly<{ allowed: false; reason: string; code: string }>;

export class AuthorizationDecisionVo extends ValueObject<AuthorizationDecision> {
  private constructor(decision: AuthorizationDecision) {
    super(decision);
  }

  static allow(): AuthorizationDecisionVo {
    return new AuthorizationDecisionVo({ allowed: true });
  }

  static deny(reason: string, code: string): AuthorizationDecisionVo {
    return new AuthorizationDecisionVo({ allowed: false, reason, code });
  }

  get decision(): AuthorizationDecision {
    return this.props;
  }

  isAllowed(): boolean {
    return this.props.allowed;
  }
}
