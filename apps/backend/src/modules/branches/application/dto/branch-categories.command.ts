import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetBranchCategoriesCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  branchId: string;
}

export interface SetBranchCategoriesCommand extends GetBranchCategoriesCommand {
  cuisineCategoryIds: string[];
  occasionCategoryIds: string[];
  correlationId?: string;
}

export interface UpdateBranchDetailsCommand extends GetBranchCategoriesCommand {
  name: string | null;
  description: string | null;
  correlationId?: string;
}
