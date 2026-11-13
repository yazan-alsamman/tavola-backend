import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { BranchRepository, BRANCH_REPOSITORY } from '../../domain/repositories/branch.repository';
import { BranchAccessService } from '../services/branch-access.service';
import { BranchScopedCommand } from '../dto/branch-closure.dto';
import { BranchResult } from '../dto/branch.result';
import { toBranchResult } from '../mappers/branch-result.mapper';

export interface SetBranchPausedCommand extends BranchScopedCommand {
  paused: boolean;
}

/**
 * ADR-053: the owner pauses a branch (no online bookings, hidden from guests)
 * or resumes it. Existing reservations are kept; staff can still manage them.
 */
@Injectable()
export class SetBranchPausedUseCase {
  constructor(
    private readonly access: BranchAccessService,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: SetBranchPausedCommand): Promise<BranchResult> {
    const { branch } = await this.access.resolve(command.restaurantId, command.branchId);
    const now = this.clock.now();
    const updated = command.paused ? branch.pause(now) : branch.resume(now);
    if (updated !== branch) {
      await this.branchRepository.save(updated);
      await this.auditLogWriter.record({
        actorId: command.actor.userId,
        actorType: 'User',
        action: command.paused ? 'branch.paused' : 'branch.resumed',
        targetType: 'Branch',
        targetId: branch.branchId.value,
        organizationId: command.actor.organizationId,
        correlationId: command.correlationId ?? null,
        ipAddress: null,
        occurredAt: now,
      });
    }
    return toBranchResult(updated, now);
  }
}
