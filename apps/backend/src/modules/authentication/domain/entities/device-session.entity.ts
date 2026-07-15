import { Entity } from '@shared/domain/base/entity.base';
import { RefreshTokenHash } from '@shared/domain/value-objects/refresh-token-hash.vo';
import { SessionId, TokenFamilyId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  DeviceSessionStatus,
  DeviceType,
  SessionRevokeReason,
} from '../enums/authentication.enums';
import { SessionRevokedException } from '../exceptions/session-revoked.exception';

export interface DeviceSessionProps {
  id: string;
  userId: string;
  tokenFamilyId: string;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  deviceName: string | null;
  deviceType: DeviceType;
  ipAddress: string | null;
  userAgent: string | null;
  sessionVersion: number;
  permissionsVersion: number;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: SessionRevokeReason | null;
  expiresAt: Date;
  createdAt: Date;
}

export class DeviceSession extends Entity<DeviceSessionProps> {
  private constructor(props: DeviceSessionProps) {
    super(props);
  }

  static create(props: DeviceSessionProps): DeviceSession {
    RefreshTokenHash.create(props.refreshTokenHash);
    return new DeviceSession({ ...props });
  }

  static reconstitute(props: DeviceSessionProps): DeviceSession {
    return new DeviceSession({ ...props });
  }

  get sessionId(): SessionId {
    return SessionId.create(this.props.id);
  }

  get userId(): UserId {
    return UserId.create(this.props.userId);
  }

  get tokenFamilyId(): TokenFamilyId {
    return TokenFamilyId.create(this.props.tokenFamilyId);
  }

  get refreshTokenHash(): RefreshTokenHash {
    return RefreshTokenHash.create(this.props.refreshTokenHash);
  }

  get status(): DeviceSessionStatus {
    if (this.props.revokedAt !== null) {
      return DeviceSessionStatus.Revoked;
    }
    if (this.props.expiresAt <= new Date()) {
      return DeviceSessionStatus.Expired;
    }
    return DeviceSessionStatus.Active;
  }

  isActive(now: Date = new Date()): boolean {
    return this.status === DeviceSessionStatus.Active && this.props.expiresAt > now;
  }

  assertActiveForRefresh(now: Date = new Date()): void {
    if (this.props.revokedAt !== null) {
      throw new SessionRevokedException(this.props.revokedReason ?? undefined);
    }
    if (this.props.expiresAt <= now) {
      throw new SessionRevokedException(SessionRevokeReason.Expired);
    }
  }

  rotateRefreshToken(newHash: RefreshTokenHash, at: Date, expiresAt: Date): DeviceSession {
    this.assertActiveForRefresh(at);
    return DeviceSession.reconstitute({
      ...this.props,
      previousRefreshTokenHash: this.props.refreshTokenHash,
      refreshTokenHash: newHash.value,
      lastUsedAt: at,
      expiresAt,
    });
  }

  withPermissionsVersion(permissionsVersion: number, at: Date): DeviceSession {
    return DeviceSession.reconstitute({
      ...this.props,
      permissionsVersion,
      lastUsedAt: at,
    });
  }

  revoke(reason: SessionRevokeReason, at: Date): DeviceSession {
    if (this.props.revokedAt !== null) {
      return this;
    }
    return DeviceSession.reconstitute({
      ...this.props,
      revokedAt: at,
      revokedReason: reason,
    });
  }

  matchesSessionVersion(userSessionVersion: number): boolean {
    return this.props.sessionVersion === userSessionVersion;
  }

  withSessionVersion(sessionVersion: number, at: Date): DeviceSession {
    return DeviceSession.reconstitute({
      ...this.props,
      sessionVersion,
      lastUsedAt: at,
    });
  }

  belongsToUser(userId: UserId): boolean {
    return this.props.userId === userId.value;
  }

  matchesTokenFamily(tokenFamilyId: TokenFamilyId): boolean {
    return this.props.tokenFamilyId === tokenFamilyId.value;
  }

  isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  toProps(): Readonly<DeviceSessionProps> {
    return { ...this.props };
  }
}
