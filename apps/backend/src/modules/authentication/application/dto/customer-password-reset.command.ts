export interface StartCustomerPasswordResetCommand {
  countryCode: string;
  phoneNumber: string;
  correlationId?: string;
}

export interface ResendCustomerPasswordResetCommand {
  countryCode: string;
  phoneNumber: string;
  correlationId?: string;
}

export interface VerifyCustomerPasswordResetCommand {
  countryCode: string;
  phoneNumber: string;
  code: string;
  correlationId?: string;
}

export interface CompleteCustomerPasswordResetCommand {
  countryCode: string;
  phoneNumber: string;
  newPassword: string;
  correlationId?: string;
}
