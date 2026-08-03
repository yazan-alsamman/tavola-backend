import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

interface BaseOptionCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  menuId: string;
  categoryId: string;
  itemId: string;
  optionGroupId: string;
  correlationId?: string;
}

export interface OptionContentInput {
  name: string;
  priceModifier: number;
}

export interface CreateMenuItemOptionCommand extends BaseOptionCommand {
  content: OptionContentInput;
}

export interface UpdateMenuItemOptionCommand extends BaseOptionCommand {
  optionId: string;
  content: OptionContentInput;
  active: boolean;
}

export interface DeleteMenuItemOptionCommand extends BaseOptionCommand {
  optionId: string;
}
