/**
 * Who on the restaurant side hears about a customer's activity: the active
 * Owner/Admin members of the restaurant's organization, plus active,
 * signed-in Employees of the restaurant whose branch scope covers that
 * branch (no assignment = restaurant-wide). De-duplicated.
 *
 * `branchId: null` means restaurant-wide activity (a conversation with no
 * branch), so every Employee of the restaurant is in scope.
 *
 * `requiredPermission` narrows the Employee half to those whose effective
 * permissions ((role grants ∪ individual grants) − individual revocations,
 * the same rule as `PermissionResolver`) include that slug. Owner/Admin
 * members are never narrowed: they hold every permission.
 */
export interface StaffNotificationRecipientReaderPort {
  findRecipientUserIds(
    restaurantId: string,
    branchId: string | null,
    requiredPermission?: string,
  ): Promise<string[]>;
}

export const STAFF_NOTIFICATION_RECIPIENT_READER = Symbol('STAFF_NOTIFICATION_RECIPIENT_READER');
