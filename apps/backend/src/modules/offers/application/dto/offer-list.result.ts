import { OfferResult } from './offer.result';

export interface OfferListResult {
  items: OfferResult[];
  page: number;
  limit: number;
  total: number;
}
