import { Branch } from '../../domain/entities/branch.entity';
import { BranchResult } from '../dto/branch.result';

export function toBranchResult(branch: Branch): BranchResult {
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
    timezone: branch.timezone,
    phone: branch.phone,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}
