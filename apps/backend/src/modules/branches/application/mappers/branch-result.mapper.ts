import { Branch } from '../../domain/entities/branch.entity';
import { BranchResult } from '../dto/branch.result';

/** `now` decides whether a trial is still running (ADR-053). */
export function toBranchResult(branch: Branch, now: Date): BranchResult {
  return {
    branchId: branch.branchId.value,
    restaurantId: branch.restaurantId.value,
    city: branch.city,
    district: branch.district,
    address: branch.address,
    latitude: branch.latitude,
    longitude: branch.longitude,
    countryCode: branch.countryCode,
    currency: branch.currency,
    coverImageId: branch.coverImageId,
    venueType: branch.venueType,
    features: branch.features,
    subscriptionStatus: branch.subscriptionStatus(now),
    trialEndsAt: branch.trialEndsAt,
    referencePrice: branch.referencePrice,
    priceLevel: branch.priceLevel,
    timezone: branch.timezone,
    phone: branch.phone,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}
