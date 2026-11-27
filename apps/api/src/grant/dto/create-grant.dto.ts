import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsNumberString } from 'class-validator';
import { GrantStatus } from '@grant-ledger/shared';

export class CreateGrantDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ type: String, required: false })
  @IsString()
  description?: string;

  @ApiProperty({ type: String, description: 'DecimalString representing total budget' })
  @IsNumberString()
  totalBudget!: string; // DecimalString

  @ApiProperty({ enum: GrantStatus })
  @IsEnum(GrantStatus)
  status!: GrantStatus;
}
