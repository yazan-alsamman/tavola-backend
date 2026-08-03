import { OrganizationRegistrationPolicy } from './organization-registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { OrganizationSlug } from '@shared/domain/value-objects/organization-slug.vo';
import { OrganizationStatus } from '../enums/organization.enums';

describe('OrganizationRegistrationPolicy', () => {
  const now = new Date('2026-08-02T12:00:00.000Z');
  const id = '11111111-1111-4111-8111-111111111111';

  describe('createForOwner', () => {
    it('creates an Active Organization with the given id/slug/billingEmail', () => {
      const organization = OrganizationRegistrationPolicy.createForOwner({
        id,
        name: 'Acme Restaurant Group',
        slug: OrganizationSlug.create('acme-restaurant-group'),
        billingEmail: Email.create('owner@example.com'),
        at: now,
      });

      expect(organization.organizationId.value).toBe(id);
      expect(organization.status).toBe(OrganizationStatus.Active);
      expect(organization.slug.value).toBe('acme-restaurant-group');
      expect(organization.toProps().billingEmail).toBe('owner@example.com');
      expect(organization.toProps().createdAt).toBe(now);
      expect(organization.toProps().updatedAt).toBe(now);
      expect(organization.isActive()).toBe(true);
      expect(organization.isSoftDeleted()).toBe(false);
    });

    it('trims the organization name', () => {
      const organization = OrganizationRegistrationPolicy.createForOwner({
        id,
        name: '  Acme Restaurant Group  ',
        slug: OrganizationSlug.create('acme-restaurant-group'),
        billingEmail: Email.create('owner@example.com'),
        at: now,
      });

      expect(organization.toProps().name).toBe('Acme Restaurant Group');
    });

    it('normalizes the billing email exactly as the Email value object does', () => {
      const organization = OrganizationRegistrationPolicy.createForOwner({
        id,
        name: 'Acme',
        slug: OrganizationSlug.create('acme'),
        billingEmail: Email.create('  Owner@Example.COM  '),
        at: now,
      });

      expect(organization.toProps().billingEmail).toBe('owner@example.com');
    });
  });
});
