import { NotificationResult } from './notification.result';

export interface NotificationListResult {
  items: NotificationResult[];
  page: number;
  limit: number;
  total: number;
}
