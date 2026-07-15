import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Every endpoint must include Swagger documentation (API_GUIDELINES.md,
 * CLAUDE.md). This wires the OpenAPI document and the bearer-auth scheme
 * that every authenticated endpoint will reference via @ApiBearerAuth()
 * starting Phase 2 - no route uses it yet, since Authentication does not
 * exist in Foundation.
 */
export function setupSwagger(app: INestApplication, apiVersion: string): void {
  const config = new DocumentBuilder()
    .setTitle('TAVLA API')
    .setDescription('Enterprise Restaurant Reservation Platform - REST API')
    .setVersion(apiVersion)
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`api/${apiVersion}/docs`, app, document);
}
