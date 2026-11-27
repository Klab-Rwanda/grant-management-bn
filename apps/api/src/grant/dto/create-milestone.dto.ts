import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsDateString } from 'class-validator';
import { GrantMilestoneStatus } from '@grant-ledger/shared';

export class CreateMilestoneDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ type: String, description: 'ISO date string (YYYY-MM-DD)' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ type: String, description: 'ISO date string (YYYY-MM-DD)' })
  @IsDateString()
  endDate!: string;

  @ApiProperty({ enum: GrantMilestoneStatus })
  @IsEnum(GrantMilestoneStatus)
  status!: GrantMilestoneStatus;
}
