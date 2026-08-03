import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

interface BaseOptionGroupCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  menuId: string;
  categoryId: string;
  itemId: string;
  correlationId?: string;
}

export interface OptionGroupContentInput {
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
}

export interface CreateMenuItemOptionGroupCommand extends BaseOptionGroupCommand {
  content: OptionGroupContentInput;
}

export interface UpdateMenuItemOptionGroupCommand extends BaseOptionGroupCommand {
  optionGroupId: string;
  content: OptionGroupContentInput;
}

export interface DeleteMenuItemOptionGroupCommand extends BaseOptionGroupCommand {
  optionGroupId: string;
}
