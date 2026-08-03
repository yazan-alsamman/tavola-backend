/**
 * DECISIONS.md Phase 15.6 D5: `Closed` is set by a Restaurant-side actor
 * (closes for both sides); `Archived` is set by the Customer participant
 * (soft-hides from their own default list only). Either auto-reopens to
 * `Open` when a new Message is sent, from either side.
 */
export enum ConversationStatus {
  Open = 'Open',
  Closed = 'Closed',
  Archived = 'Archived',
}

/**
 * DECISIONS.md D2: a `Staff` row is either an Employee (`employeeId` set) or
 * an OrganizationMember (`userId` set, no Employee row exists for them) -
 * `Message.senderType` is what disambiguates the two, not this role alone.
 */
export enum ConversationParticipantRole {
  Customer = 'Customer',
  Staff = 'Staff',
  System = 'System',
}

/**
 * DECISIONS.md D3: disambiguates a populated `senderUserId` between a
 * Customer and an OrganizationMember (both reference `User`) - a database
 * CHECK constraint alone cannot tell the two apart.
 */
export enum MessageSenderType {
  Customer = 'Customer',
  Employee = 'Employee',
  OrganizationMember = 'OrganizationMember',
  System = 'System',
}

export enum MessageType {
  Text = 'Text',
  System = 'System',
  Attachment = 'Attachment',
}
