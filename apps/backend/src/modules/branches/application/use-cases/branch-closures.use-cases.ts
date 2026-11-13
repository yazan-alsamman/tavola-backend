import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { calendarDateInTimeZone } from '@modules/reservations/domain/services/reservation-time-slots.service';
import { BranchClosure } from '../../domain/entities/branch-closure.entity';
import { BranchClosureNotFoundException } from '../../domain/exceptions/branch-closure-not-found.exception';
import {
  BranchClosureRepository,
  BRANCH_CLOSURE_REPOSITORY,
} from '../../domain/repositories/branch-closure.repository';
import { BranchAccessService } from '../services/branch-access.service';
import {
  BranchClosureResult,
  BranchScopedCommand,
  CreateBranchClosureCommand,
  DeleteBranchClosureCommand,
} from '../dto/branch-closure.dto';

export function toBranchClosureResult(closure: BranchClosure): BranchClosureResult {
  return {
    closureId: closure.closureId,
    branchId: closure.branchId,
    startDate: closure.startDate,
    endDate: closure.endDate,
    reason: closure.reason,
    createdAt: closure.createdAt,
  };
}

/** ADR-053: the branch's closures that have not ended yet (branch-local today). */
@Injectable()
export class ListBranchClosuresUseCase {
  constructor(
    private readonly access: BranchAccessService,
    @Inject(BRANCH_CLOSURE_REPOSITORY) private readonly closures: BranchClosureRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: BranchScopedCommand): Promise<BranchClosureResult[]> {
    const { branch } = await this.access.resolve(command.restaurantId, command.branchId);
    const today = calendarDateInTimeZone(this.clock.now(), branch.timezone);
    const rows = await this.closures.findUpcoming(branch.branchId.value, today);
    return rows.map(toBranchClosureResult);
  }
}

/** ADR-053: close a branch for a range of dates without changing its weekly hours. */
@Injectable()
export class CreateBranchClosureUseCase {
  constructor(
    private readonly access: BranchAccessService,
    @Inject(BRANCH_CLOSURE_REPOSITORY) private readonly closures: BranchClosureRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: CreateBranchClosureCommand): Promise<BranchClosureResult> {
    const { branch } = await this.access.resolve(command.restaurantId, command.branchId);
    const now = this.clock.now();
    const closure = BranchClosure.create({
      id: this.idGenerator.generate(),
      branchId: branch.branchId.value,
      startDate: command.startDate,
      endDate: command.endDate,
      reason: command.reason,
      createdAt: now,
      updatedAt: now,
    });
    await this.closures.save(closure);
    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'branch.closure.created',
      targetType: 'Branch',
      targetId: branch.branchId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });
    return toBranchClosureResult(closure);
  }
}

/** ADR-053: reopen dates a closure covered. */
@Injectable()
export class DeleteBranchClosureUseCase {
  constructor(
    private readonly access: BranchAccessService,
    @Inject(BRANCH_CLOSURE_REPOSITORY) private readonly closures: BranchClosureRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: DeleteBranchClosureCommand): Promise<void> {
    const { branch } = await this.access.resolve(command.restaurantId, command.branchId);
    const closure = await this.closures.findById(command.closureId, branch.branchId.value);
    if (closure === null) {
      throw new BranchClosureNotFoundException();
    }
    await this.closures.remove(closure.closureId);
    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'branch.closure.deleted',
      targetType: 'Branch',
      targetId: branch.branchId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: this.clock.now(),
    });
  }
}
