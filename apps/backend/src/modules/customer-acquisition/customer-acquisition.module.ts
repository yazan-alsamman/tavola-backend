import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { PlatformAdminModule } from '@modules/platform-admin/platform-admin.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { BranchesModule } from '@modules/branches/branches.module';
import { OrganizationsModule } from '@modules/organizations/organizations.module';
import { RecordCustomerAcquisitionOnApprovalService } from './application/services/record-customer-acquisition-on-approval.service';
import { ReverseCustomerAcquisitionUseCase } from './application/use-cases/reverse-customer-acquisition.use-case';
import { ManuallyRecordCustomerAcquisitionUseCase } from './application/use-cases/manually-record-customer-acquisition.use-case';
import { ListCustomerAcquisitionsUseCase } from './application/use-cases/list-customer-acquisitions.use-case';
import { ActivatePricingRuleUseCase } from './application/use-cases/activate-pricing-rule.use-case';
import { ListPricingRulesUseCase } from './application/use-cases/list-pricing-rules.use-case';
import { SimulatePricingUseCase } from './application/use-cases/simulate-pricing.use-case';
import { GetRevenueReportUseCase } from './application/use-cases/get-revenue-report.use-case';
import { ExportCustomerAcquisitionsUseCase } from './application/use-cases/export-customer-acquisitions.use-case';
import { CUSTOMER_ACQUISITION_REPOSITORY } from './domain/repositories/customer-acquisition.repository';
import { ACQUISITION_PRICING_RULE_REPOSITORY } from './domain/repositories/acquisition-pricing-rule.repository';
import { ACQUISITION_CROSS_TENANT_READER } from './application/ports/acquisition-cross-tenant-reader.port';
import { PrismaCustomerAcquisitionRepository } from './infrastructure/persistence/prisma-customer-acquisition.repository';
import { PrismaAcquisitionPricingRuleRepository } from './infrastructure/persistence/prisma-acquisition-pricing-rule.repository';
import { PrismaAcquisitionCrossTenantReader } from './infrastructure/persistence/prisma-acquisition-cross-tenant.reader';
import { PlatformAdminAcquisitionsController } from './presentation/controllers/platform-admin-acquisitions.controller';
import { PlatformAdminPricingController } from './presentation/controllers/platform-admin-pricing.controller';
import { PlatformAdminRevenueController } from './presentation/controllers/platform-admin-revenue.controller';

/**
 * Phase 19.2 (Customer Acquisition & Pricing Engine, architecture frozen
 * 2026-08-04, implemented 2026-08-09, ADR-033). Owns both `CustomerAcquisition`
 * and `AcquisitionPricingRule` - one bounded context, per DOMAIN_MODEL.md
 * ("Acquisition Pricing... part of the Customer Acquisition bounded
 * context, not its own aggregate root"), matching API_GUIDELINES.md's
 * Platform Back Office Route Ownership table naming this "New
 * `customer-acquisition` module" for both `/platform-admin/acquisitions*`
 * and `/platform-admin/pricing*`.
 *
 * `AuthenticationModule` supplies the shared
 * `CLOCK`/`ID_GENERATOR`/`EVENT_PUBLISHER`/`TENANT_CONTEXT_PORT` tokens.
 * `RestaurantsModule` supplies `RESTAURANT_SETTINGS_REPOSITORY` and the
 * reused `PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER` (see
 * `RecordCustomerAcquisitionOnApprovalService`'s own doc comment for why
 * that reader, not a new one). `BranchesModule` supplies `BRANCH_REPOSITORY`
 * (currency fallback). `OrganizationsModule` supplies `ORGANIZATION_REPOSITORY`
 * (Organization-scope pricing rule existence validation).
 *
 * `forwardRef(() => BranchesModule)`: this module has no DIRECT edge back to
 * `BranchesModule`, but `ReservationsModule`/`WaitlistModule` both import
 * THIS module (for `RecordCustomerAcquisitionOnApprovalService`), and both
 * already sit inside the pre-existing `BranchesModule` <-> `TablesModule` <->
 * `ReservationsModule` three-module require cycle (see `ReservationsModule`'s
 * own doc comment for that cycle's exact shape). Importing `BranchesModule`
 * here without `forwardRef` closes that cycle through a fourth module and
 * fails at boot with "the module at index [n] of the
 * CustomerAcquisitionModule imports array is undefined" - confirmed by a
 * real e2e run, not a hypothetical.
 */
@Module({
  imports: [
    AuthenticationModule,
    PrismaModule,
    PlatformAdminModule,
    RestaurantsModule,
    forwardRef(() => BranchesModule),
    OrganizationsModule,
  ],
  controllers: [
    PlatformAdminAcquisitionsController,
    PlatformAdminPricingController,
    PlatformAdminRevenueController,
  ],
  providers: [
    RecordCustomerAcquisitionOnApprovalService,
    ReverseCustomerAcquisitionUseCase,
    ManuallyRecordCustomerAcquisitionUseCase,
    ListCustomerAcquisitionsUseCase,
    ActivatePricingRuleUseCase,
    ListPricingRulesUseCase,
    SimulatePricingUseCase,
    GetRevenueReportUseCase,
    ExportCustomerAcquisitionsUseCase,
    PrismaCustomerAcquisitionRepository,
    PrismaAcquisitionPricingRuleRepository,
    PrismaAcquisitionCrossTenantReader,
    {
      provide: CUSTOMER_ACQUISITION_REPOSITORY,
      useExisting: PrismaCustomerAcquisitionRepository,
    },
    {
      provide: ACQUISITION_PRICING_RULE_REPOSITORY,
      useExisting: PrismaAcquisitionPricingRuleRepository,
    },
    {
      provide: ACQUISITION_CROSS_TENANT_READER,
      useExisting: PrismaAcquisitionCrossTenantReader,
    },
  ],
  // RecordCustomerAcquisitionOnApprovalService is exported for
  // ReservationsModule (ApproveReservationUseCase, CreateReservationUseCase)
  // and WaitlistModule (WaitlistPromotionService) - the single shared write
  // path ADR-033 §13 requires inside each of their own UnitOfWorkPort
  // transactions.
  exports: [RecordCustomerAcquisitionOnApprovalService],
})
export class CustomerAcquisitionModule {}
