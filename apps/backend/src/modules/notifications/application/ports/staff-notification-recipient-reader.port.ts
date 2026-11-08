/**
 * Who on the restaurant side hears about a customer's booking activity at a
 * branch: the active Owner/Admin members of the restaurant's organization,
 * plus active, signed-in Employees of the restaurant whose branch scope
 * covers that branch (no assignment = restaurant-wide). De-duplicated.
 */
export interface StaffNotificationRecipientReaderPort {
  findRecipientUserIds(restaurantId: string, branchId: string): Promise<string[]>;
}

export const STAFF_NOTIFICATION_RECIPIENT_READER = Symbol('STAFF_NOTIFICATION_RECIPIENT_READER');
