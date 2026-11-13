import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { StaffNotificationRecipientReaderPort } from '../../application/ports/staff-notification-recipient-reader.port';

/**
 * One raw read across `organization_members` and `employees`. Raw SQL on
 * purpose: the triggering event usually comes from a Customer request with
 * no bound TenantContext, and `OrganizationMember`/`Restaurant` model
 * queries fail closed without one. The query is still tenant-safe - it is
 * keyed only by the restaurant the event itself names.
 */
@Injectable()
export class PrismaStaffNotificationRecipientReader implements StaffNotificationRecipientReaderPort {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findRecipientUserIds(
    restaurantId: string,
    branchId: string | null,
    requiredPermission?: string,
  ): Promise<string[]> {
    const branchScope =
      branchId === null
        ? Prisma.sql`TRUE`
        : Prisma.sql`(
            NOT EXISTS (SELECT 1 FROM employee_branch_assignments a WHERE a.employee_id = e.id)
            OR EXISTS (
              SELECT 1 FROM employee_branch_assignments a
              WHERE a.employee_id = e.id AND a.branch_id = ${branchId}::uuid
            )
          )`;
    const permissionScope =
      requiredPermission === undefined
        ? Prisma.sql`TRUE`
        : Prisma.sql`(
            EXISTS (
              SELECT 1 FROM role_permissions rp
              JOIN permissions p ON p.id = rp.permission_id
              WHERE p.slug = ${requiredPermission}
                AND (
                  (rp.role_id = e.role_id AND rp.type = 'RoleGrant')
                  OR (rp.employee_id = e.id AND rp.type = 'IndividualGrant')
                )
            )
            AND NOT EXISTS (
              SELECT 1 FROM role_permissions rp
              JOIN permissions p ON p.id = rp.permission_id
              WHERE p.slug = ${requiredPermission}
                AND rp.employee_id = e.id
                AND rp.type = 'IndividualRevocation'
            )
          )`;

    const rows = await this.prismaContext.client.$queryRaw<Array<{ user_id: string }>>`
      SELECT om.user_id::text AS user_id
      FROM organization_members om
      JOIN restaurants r ON r.organization_id = om.organization_id
      WHERE r.id = ${restaurantId}::uuid
        AND om.role IN ('Owner', 'Admin')
        AND om.status = 'Active'
      UNION
      SELECT e.user_id::text AS user_id
      FROM employees e
      WHERE e.restaurant_id = ${restaurantId}::uuid
        AND e.user_id IS NOT NULL
        AND e.deleted_at IS NULL
        AND e.status = 'Active'
        AND ${branchScope}
        AND ${permissionScope}
    `;
    return rows.map((row) => row.user_id);
  }
}
