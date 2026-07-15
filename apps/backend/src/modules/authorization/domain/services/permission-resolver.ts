import { PermissionSlug } from '@shared/domain/value-objects/permission-slug.vo';
import { RolePermissionType } from '../enums/authorization.enums';
import { PermissionDeniedException } from '../exceptions/permission-denied.exception';

export interface PermissionGrantRecord {
  slug: string;
  type: RolePermissionType;
}

export interface PermissionResolutionInput {
  rolePermissionSlugs: string[];
  individualGrants: string[];
  individualRevocations: string[];
}

export class PermissionResolver {
  /**
   * effective = (RoleGrants ∪ IndividualGrants) − IndividualRevocations
   * Revocations always beat grants on the same slug.
   */
  static resolveEffectivePermissions(input: PermissionResolutionInput): Set<string> {
    const effective = new Set<string>([...input.rolePermissionSlugs, ...input.individualGrants]);
    for (const revoked of input.individualRevocations) {
      effective.delete(revoked);
    }
    return effective;
  }

  static resolveFromRecords(records: PermissionGrantRecord[]): Set<string> {
    const roleGrants: string[] = [];
    const individualGrants: string[] = [];
    const individualRevocations: string[] = [];

    for (const record of records) {
      if (record.type === RolePermissionType.RoleGrant) {
        roleGrants.push(record.slug);
      } else if (record.type === RolePermissionType.IndividualGrant) {
        individualGrants.push(record.slug);
      } else {
        individualRevocations.push(record.slug);
      }
    }

    return PermissionResolver.resolveEffectivePermissions({
      rolePermissionSlugs: roleGrants,
      individualGrants,
      individualRevocations,
    });
  }

  static hasPermission(effective: Set<string>, required: PermissionSlug): boolean {
    return effective.has(required.value);
  }

  static assertPermission(effective: Set<string>, required: PermissionSlug): void {
    if (!PermissionResolver.hasPermission(effective, required)) {
      throw new PermissionDeniedException(required.value);
    }
  }
}
