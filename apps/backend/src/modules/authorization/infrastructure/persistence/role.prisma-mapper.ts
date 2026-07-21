import { Role as PrismaRoleRow } from '@prisma/client';
import { Role, RoleProps } from '../../domain/entities/role.entity';
import { RoleScope } from '../../domain/enums/authorization.enums';

export type RoleRow = PrismaRoleRow;

export class RolePrismaMapper {
  static toDomain(row: RoleRow): Role {
    if (!Object.values(RoleScope).includes(row.scope as RoleScope)) {
      throw new Error(`Unknown role scope persisted: ${row.scope}`);
    }

    const props: RoleProps = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      scope: row.scope as RoleScope,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return Role.reconstitute(props);
  }
}
