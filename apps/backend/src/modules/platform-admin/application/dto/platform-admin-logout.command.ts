export interface PlatformAdminLogoutCommand {
  /**
   * The refresh token identifying which session to end. Required: the access
   * token alone cannot identify a session, since Platform Admin JWT claims
   * are deliberately minimal (`sub` + `role`, no `sessionId`) per
   * AUTHENTICATION_ARCHITECTURE.md §5.2, and widening them purely to support
   * logout would weaken that isolation for no security gain.
   */
  refreshToken: string;
  /** The authenticated caller - a session may only be ended by its own owner. */
  actorId: string;
  ipAddress?: string;
  correlationId?: string;
}
