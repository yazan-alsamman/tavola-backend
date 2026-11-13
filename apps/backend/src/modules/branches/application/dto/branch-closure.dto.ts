import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface BranchScopedCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  branchId: string;
  correlationId?: string;
}

export interface CreateBranchClosureCommand extends BranchScopedCommand {
  startDate: string;
  endDate: string;
  reason: string | null;
}

export interface DeleteBranchClosureCommand extends BranchScopedCommand {
  closureId: string;
}

export interface BranchClosureResult {
  closureId: string;
  branchId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  createdAt: Date;
}
