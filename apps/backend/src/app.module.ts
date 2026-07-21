import { Module } from '@nestjs/common';
import { ConfigurationModule } from './config/configuration.module';
import { AppLoggingModule } from './infrastructure/logging/logging.module';
import { CommonModule } from './common/common.module';
import { HealthModule } from './infrastructure/health/health.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { QueueModule } from './infrastructure/bullmq/queue.module';
import { StorageModule } from './infrastructure/minio/storage.module';
import { MetricsModule } from './infrastructure/metrics/metrics.module';
import { TenancyModule } from './infrastructure/tenancy/tenancy.module';
import { AuditModule } from './infrastructure/audit/audit.module';
import { AuthenticationModule } from './modules/authentication/authentication.module';
import { UsersModule } from './modules/users/users.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { BranchesModule } from './modules/branches/branches.module';
import { TablesModule } from './modules/tables/tables.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { ReservationsModule } from './modules/reservations/reservations.module';

@Module({
  imports: [
    ConfigurationModule,
    AppLoggingModule,
    CommonModule,
    PrismaModule,
    TenancyModule,
    AuditModule,
    RedisModule,
    QueueModule,
    StorageModule,
    MetricsModule,
    HealthModule,
    AuthenticationModule,
    UsersModule,
    RestaurantsModule,
    BranchesModule,
    TablesModule,
    EmployeesModule,
    ReservationsModule,
  ],
})
export class AppModule {}
