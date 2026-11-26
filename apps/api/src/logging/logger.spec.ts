import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { JsonLoggerService } from './logger.service';
import { runWithRequestContext } from './request-context';

describe('JsonLoggerService', () => {
  it('always emits structured JSON with request_id and tenant_id fields', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });

    const logger = new JsonLoggerService('info', stream);

    logger.log('startup message', 'Bootstrap');

    runWithRequestContext({ request_id: 'req-123', tenant_id: 'tenant-abc' }, () => {
      logger.infoWithMeta({ route: '/health' }, 'request handled');
    });

    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(first).toHaveProperty('request_id', 'system');
    expect(first).toHaveProperty('tenant_id', null);
    expect(first).toHaveProperty('msg', 'startup message');

    const second = JSON.parse(lines[1] ?? '{}') as Record<string, unknown>;
    expect(second).toHaveProperty('request_id', 'req-123');
    expect(second).toHaveProperty('tenant_id', 'tenant-abc');
    expect(second).toHaveProperty('route', '/health');
  });
});
