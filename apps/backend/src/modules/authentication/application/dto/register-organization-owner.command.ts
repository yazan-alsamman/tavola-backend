export interface RegistrationConsentsInput {
  termsOfService: boolean;
  privacyPolicy: boolean;
  marketing?: boolean;
}

export interface RegisterOrganizationOwnerCommand {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  language?: string;
  organizationName: string;
  organizationSlug?: string;
  consents: RegistrationConsentsInput;
  ipAddress: string;
  correlationId?: string;
}
