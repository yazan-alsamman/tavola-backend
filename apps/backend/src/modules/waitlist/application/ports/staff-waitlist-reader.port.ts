import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import { WaitlistEntryResult } from '../dto/waitlist-entry.result';

export type StaffWaitlistCustomerType = 'User' | 'Guest';

/** Who is waiting - an app Customer or a walk-up guest the staff typed in. */
export interface StaffWaitlistCustomerInfo {
  type: StaffWaitlistCustomerType;
  name: string | null;
  phone: string | null;
}

export interface StaffWaitlistItem extends WaitlistEntryResult {
  /** `User` = joined from the app, `Guest` = added by staff. */
  customer: StaffWaitlistCustomerInfo;
}

export interface StaffWaitlistFilters {
  preferredDate: Date;
  status?: WaitlistStatus;
}

/**
 * Read model for the Restaurant Dashboard's waitlist board: one branch's
 * queue for one day, ordered by queue position. Waiting entries were only
 * ever writable, never listable, so the dashboard kept them in the browser
 * (lost on another device, invisible to other staff).
 */
export interface StaffWaitlistReaderPort {
  listForBranchDay(
    restaurantId: string,
    branchId: string,
    filters: StaffWaitlistFilters,
  ): Promise<StaffWaitlistItem[]>;
}

export const STAFF_WAITLIST_READER = Symbol('STAFF_WAITLIST_READER');
