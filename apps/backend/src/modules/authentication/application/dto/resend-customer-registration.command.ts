export interface ResendCustomerRegistrationCommand {
  countryCode: string;
  phoneNumber: string;
  correlationId?: string;
}
