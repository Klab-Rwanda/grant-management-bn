import { HealthCheckResponse } from '@grant-ledger/shared';
import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service';

class HealthChecksDto {
  @ApiProperty({ type: String, enum: ['up', 'down'] })
  postgres!: 'up' | 'down';
}

export class HealthResponseDto implements HealthCheckResponse {
  @ApiProperty({ type: String, enum: ['ok', 'degraded'] })
  status!: 'ok' | 'degraded';

  @ApiProperty({ type: String, example: 'grant-ledger-api' })
  service!: string;

  @ApiProperty({ type: String, example: '2026-11-26T00:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ type: () => HealthChecksDto })
  checks!: HealthChecksDto;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check API and PostgreSQL readiness' })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto })
  async getHealth(@Res() res: Response): Promise<void> {
    const result = await this.healthService.check();
    const statusCode = result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    res.status(statusCode).json(result);
  }
}
