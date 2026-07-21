import { TableResult } from './table.result';

export interface TableListResult {
  items: TableResult[];
  page: number;
  limit: number;
  total: number;
}
