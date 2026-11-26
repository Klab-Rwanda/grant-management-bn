import { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  it('returns 200 when postgres ping succeeds', async () => {
    const healthService = {
      check: vi.fn().mockResolvedValue({
        status: 'ok',
        service: 'grant-ledger-api',
        timestamp: '2026-11-26T00:00:00.000Z',
        checks: { postgres: 'up' },
      }),
    } as unknown as HealthService;

    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;

    const controller = new HealthController(healthService);
    await controller.getHealth(res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        checks: { postgres: 'up' },
      }),
    );
  });

  it('returns 503 when postgres ping fails', async () => {
    const healthService = {
      check: vi.fn().mockResolvedValue({
        status: 'degraded',
        service: 'grant-ledger-api',
        timestamp: '2026-11-26T00:00:00.000Z',
        checks: { postgres: 'down' },
      }),
    } as unknown as HealthService;

    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;

    const controller = new HealthController(healthService);
    await controller.getHealth(res);

    expect(status).toHaveBeenCalledWith(503);
  });
});
