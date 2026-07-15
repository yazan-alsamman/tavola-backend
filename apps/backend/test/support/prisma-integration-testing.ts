import { Provider } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { TenancyModule } from '@infrastructure/tenancy/tenancy.module';

export async function createPrismaIntegrationModule(
  providers: Provider[] = [],
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      LoggerModule.forRoot({
        pinoHttp: {
          level: 'silent',
          autoLogging: false,
        },
      }),
      PrismaModule,
      // TenancyModule now owns PrismaContext (Phase 2.13.1) - every
      // integration test injecting a repository that depends on
      // PrismaContext (which is now every repository except
      // PrismaLoginOrganizationReader) needs this imported, exactly as the
      // real AppModule already does.
      TenancyModule,
    ],
    providers,
  }).compile();
}
