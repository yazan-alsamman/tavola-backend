import { Injectable } from '@nestjs/common';
import { BranchAccessService } from '../services/branch-access.service';
import { BranchCategoriesReader } from '../services/branch-categories-reader.service';
import { GetBranchCategoriesCommand } from '../dto/branch-categories.command';
import { BranchCategoriesResult } from '../dto/branch-categories.result';

@Injectable()
export class GetBranchCategoriesUseCase {
  constructor(
    private readonly branchAccess: BranchAccessService,
    private readonly categoriesReader: BranchCategoriesReader,
  ) {}

  async execute(command: GetBranchCategoriesCommand): Promise<BranchCategoriesResult> {
    const { branch } = await this.branchAccess.resolve(command.restaurantId, command.branchId);
    return this.categoriesReader.read(branch.branchId);
  }
}
