export interface CompleteCustomerRegistrationCommand {
  countryCode: string;
  phoneNumber: string;
  password: string;
  correlationId?: string;
}

export interface CompleteCustomerRegistrationResult {
  userId: string;
  username: string;
  phone: string;
}
