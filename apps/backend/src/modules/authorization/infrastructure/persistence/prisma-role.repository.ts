import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { RoleId } from '@shared/domain/value-objects/identifiers.vo';
import { RoleSlug } from '@shared/domain/value-objects/role-slug.vo';
import { Role } from '../../domain/entities/role.entity';
import { RoleRepository } from '../../domain/repositories/authorization.repositories';
import { RolePrismaMapper } from './role.prisma-mapper';

/**
 * `Role`/`Permission` are fixed, seeded reference data (like `Country`/
 * `Currency`) - `prisma/seed.ts` is their only writer today. `save()` is
 * implemented to satisfy the domain `RoleRepository` interface in full, but
 * no Phase 7.0 use case calls it; `findById` is the only method Phase 7.0
 * actually needs, to validate a target `roleId` exists (and is
 * restaurant-scoped) before `AssignEmployeeRoleUseCase` assigns it.
 */
@Injectable()
export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: RoleId): Promise<Role | null> {
    const row = await this.prismaContext.client.role.findUnique({ where: { id: id.value } });
    return row ? RolePrismaMapper.toDomain(row) : null;
  }

  async findBySlug(slug: RoleSlug): Promise<Role | null> {
    const row = await this.prismaContext.client.role.findUnique({
      where: { slug: slug.value },
    });
    return row ? RolePrismaMapper.toDomain(row) : null;
  }

  async save(role: Role): Promise<void> {
    const props = role.toProps();
    await this.prismaContext.client.role.upsert({
      where: { id: props.id },
      create: {
        id: props.id,
        name: props.name,
        slug: props.slug,
        description: props.description,
        scope: props.scope,
        createdAt: props.createdAt,
        updatedAt: props.updatedAt,
      },
      update: {
        name: props.name,
        slug: props.slug,
        description: props.description,
        scope: props.scope,
        updatedAt: props.updatedAt,
      },
    });
  }
}
