export interface VerifyCustomerRegistrationCommand {
  countryCode: string;
  phoneNumber: string;
  code: string;
  correlationId?: string;
}
