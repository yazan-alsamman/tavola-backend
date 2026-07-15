import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger-only mirror of ApiErrorResponse (api-response.interface.ts), built
 * by GlobalExceptionFilter for every non-2xx response. Referenced via
 * `schema: { allOf: [{ $ref: getSchemaPath(ErrorResponseDto) }], properties: { code: { example: '...' } } }`
 * on individual @ApiResponse() entries so each documented status can show
 * its actual `code` value while sharing one named schema.
 */
export class ErrorResponseDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ example: 'Validation failed.' })
  message!: string;

  @ApiProperty({
    description: 'Application error code, see API_GUIDELINES.md Error Codes',
    example: 'VALIDATION_ERROR',
  })
  code!: string;

  @ApiProperty({ type: [String], example: ['Validation failed.'] })
  errors!: string[];

  @ApiProperty({ type: String, format: 'date-time', example: '2026-07-12T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/auth/login' })
  path!: string;
}
