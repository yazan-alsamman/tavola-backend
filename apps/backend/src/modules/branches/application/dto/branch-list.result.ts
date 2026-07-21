import { BranchResult } from './branch.result';

export interface BranchListResult {
  items: BranchResult[];
  page: number;
  limit: number;
  total: number;
}
