import { Role } from '@modules/authorization/domain/entities/role.entity';
import { RoleRepository } from '@modules/authorization/domain/repositories/authorization.repositories';
import { RoleId } from '@shared/domain/value-objects/identifiers.vo';
import { RoleSlug } from '@shared/domain/value-objects/role-slug.vo';

export class InMemoryRoleRepository implements RoleRepository {
  private readonly roles = new Map<string, Role>();

  async findById(id: RoleId): Promise<Role | null> {
    return this.roles.get(id.value) ?? null;
  }

  async findBySlug(slug: RoleSlug): Promise<Role | null> {
    for (const role of this.roles.values()) {
      if (role.slug.value === slug.value) {
        return role;
      }
    }
    return null;
  }

  async save(role: Role): Promise<void> {
    this.roles.set(role.roleId.value, role);
  }
}
