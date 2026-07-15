export interface ResetPasswordCommand {
  token: string;
  newPassword: string;
  correlationId?: string;
}
