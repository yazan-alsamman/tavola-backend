export interface StartCustomerRegistrationCommand {
  username: string;
  countryCode: string;
  phoneNumber: string;
  correlationId?: string;
}
