import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { OfferDiscountType, OfferType } from '../../domain/enums/offer.enums';

export interface CreateOfferCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  type: OfferType;
  title: string;
  description: string;
  discountType: OfferDiscountType;
  discountValue: number;
  startsAt: Date;
  endsAt: Date;
  correlationId?: string;
}
