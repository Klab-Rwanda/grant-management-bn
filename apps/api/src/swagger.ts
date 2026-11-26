import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Grant Ledger API')
    .setDescription('Startup Accounting & Grant Management Platform API')
    .setVersion('0.1.0')
    .build();

  return SwaggerModule.createDocument(app, config);
}
