import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReplyToReviewRequestDto {
  @ApiProperty({ example: 'Thank you so much for the kind words!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  comment!: string;
}
