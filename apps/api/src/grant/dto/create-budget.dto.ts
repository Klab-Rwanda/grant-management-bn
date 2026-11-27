import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsNumberString } from 'class-validator';
import { GrantBudgetStatus } from '@grant-ledger/shared';

export class CreateBudgetDto {
  @ApiProperty({ type: String, description: 'Period UUID' })
  @IsString()
  @IsNotEmpty()
  periodId!: string;

  @ApiProperty({ type: String, description: 'DecimalString representing allocated amount' })
  @IsNumberString()
  amount!: string; // DecimalString

  @ApiProperty({ enum: GrantBudgetStatus })
  @IsEnum(GrantBudgetStatus)
  status!: GrantBudgetStatus;
}
