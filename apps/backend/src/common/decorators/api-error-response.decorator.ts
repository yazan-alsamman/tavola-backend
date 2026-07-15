import { applyDecorators } from '@nestjs/common';
import { ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

/**
 * Documents one error status for an endpoint, referencing the shared
 * ErrorResponseDto schema (registered via @ApiExtraModels on the
 * controller) and listing the exact application `code` value(s)
 * (API_GUIDELINES.md Error Codes) that status can carry for this endpoint.
 */
export function ApiErrorResponse(
  status: number,
  description: string,
  codes: [string, ...string[]],
) {
  return applyDecorators(
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ErrorResponseDto) },
          { properties: { code: { type: 'string', enum: codes, example: codes[0] } } },
        ],
      },
    }),
  );
}
