import { Injectable, LoggerService } from '@nestjs/common';
import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';
import { getRequestContext } from './request-context';

export function createJsonPinoLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      mixin() {
        const ctx = getRequestContext();
        return {
          request_id: ctx.request_id,
          tenant_id: ctx.tenant_id,
        };
      },
    },
    destination,
  );
}

@Injectable()
export class JsonLoggerService implements LoggerService {
  private readonly logger: Logger;

  constructor(level = 'info', destination?: DestinationStream) {
    this.logger = createJsonPinoLogger(level, destination);
  }

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, this.stringify(message));
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, this.stringify(message));
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, this.stringify(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, this.stringify(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, this.stringify(message));
  }

  infoWithMeta(meta: Record<string, unknown>, message: string): void {
    this.logger.info(meta, message);
  }

  private stringify(message: unknown): string {
    return typeof message === 'string' ? message : JSON.stringify(message);
  }
}
