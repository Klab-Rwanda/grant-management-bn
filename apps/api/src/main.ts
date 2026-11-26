import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { EnvService } from './config/env';
import { JsonLoggerService } from './logging/logger.service';
import { buildOpenApiDocument } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(JsonLoggerService);
  const env = app.get(EnvService);

  app.useLogger(logger);
  app.enableCors({ origin: true });

  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document);

  await app.listen(env.config.API_PORT);
  logger.log(`Grant Ledger API listening on port ${env.config.API_PORT}`, 'Bootstrap');
}

void bootstrap();
