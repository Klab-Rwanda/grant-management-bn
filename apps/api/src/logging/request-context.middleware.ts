import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { JsonLoggerService } from './logger.service';
import { runWithRequestContext } from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(@Inject(JsonLoggerService) private readonly logger: JsonLoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incomingId = req.header('x-request-id');
    const requestId =
      typeof incomingId === 'string' && incomingId.trim().length > 0
        ? incomingId.trim()
        : randomUUID();

    // Auth and tenant resolution are out of scope for the foundation milestone.
    const context = {
      request_id: requestId,
      tenant_id: null,
    };

    res.setHeader('x-request-id', requestId);
    const startMs = Date.now();

    runWithRequestContext(context, () => {
      res.on('finish', () => {
        this.logger.infoWithMeta(
          {
            method: req.method,
            path: req.originalUrl,
            status_code: res.statusCode,
            duration_ms: Date.now() - startMs,
          },
          'http_request_completed',
        );
      });
      next();
    });
  }
}
