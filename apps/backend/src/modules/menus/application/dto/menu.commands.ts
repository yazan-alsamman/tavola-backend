import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

interface BaseMenuCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  correlationId?: string;
}

export interface CreateMenuCommand extends BaseMenuCommand {
  name: string;
}

export interface UpdateMenuCommand extends BaseMenuCommand {
  menuId: string;
  name: string;
  displayOrder: number;
}

export interface SetMenuActiveStateCommand extends BaseMenuCommand {
  menuId: string;
}

export interface SetDefaultMenuCommand extends BaseMenuCommand {
  menuId: string;
}

export interface DeleteMenuCommand extends BaseMenuCommand {
  menuId: string;
}

export interface ListRestaurantMenusCommand {
  restaurantId: string;
}

/** `menuId` omitted defaults to the Restaurant's active, non-deleted, `isDefault` Menu (ADR-032). */
export interface GetMenuCommand {
  restaurantId: string;
  menuId?: string;
}
