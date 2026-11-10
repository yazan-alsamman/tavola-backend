import { OfferContentRequestDto } from './offer-content.request.dto';

/** Full replace. A Draft or Published offer may be edited, an Expired one may not (ADR-047). */
export class UpdateOfferRequestDto extends OfferContentRequestDto {}
