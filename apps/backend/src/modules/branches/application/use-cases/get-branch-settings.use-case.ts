import { Injectable } from '@nestjs/common';
import {
  BranchSettingsAccessService,
  toBranchSettingsResult,
} from '../services/branch-settings-access.service';
import { GetBranchSettingsCommand } from '../dto/branch-settings.command';
import { BranchSettingsResult } from '../dto/branch-settings.result';

/** ADR-051: the reservation rules one branch uses. */
@Injectable()
export class GetBranchSettingsUseCase {
  constructor(private readonly access: BranchSettingsAccessService) {}

  async execute(command: GetBranchSettingsCommand): Promise<BranchSettingsResult> {
    const { branchId, settings } = await this.access.load(command.restaurantId, command.branchId);
    return toBranchSettingsResult(branchId, settings);
  }
}
