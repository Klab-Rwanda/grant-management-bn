import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { GrantApplicationStatus } from '@grant-ledger/shared';

export class CreateApplicationDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  applicantUserId!: string;

  @ApiProperty({ enum: GrantApplicationStatus })
  @IsEnum(GrantApplicationStatus)
  status!: GrantApplicationStatus;
}
