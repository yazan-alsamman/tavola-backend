import { UserId } from '@shared/domain/value-objects/identifiers.vo';

export interface LoginOrganizationSnapshot {
  organizationId: string;
  name: string;
  slug: string;
  role: string;
}

export interface LoginOrganizationReaderPort {
  findByUserId(userId: UserId): Promise<LoginOrganizationSnapshot | null>;
}

export const LOGIN_ORGANIZATION_READER = Symbol('LOGIN_ORGANIZATION_READER');
