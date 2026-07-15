import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordResponseDto {
  @ApiProperty({
    example: 'If an eligible account exists, password reset instructions will be sent.',
  })
  message!: string;
}
