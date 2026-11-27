import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Socket } from 'node:net';
import type { AuthUserContext } from '@grant-ledger/shared';
import { AuditLogService } from '../audit/audit.service';
import { EnvService } from '../config/env';
import { TenantContextService } from '../database/tenant-context.service';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set([
  'INVOICE',
  'RECEIPT',
  'BANK_WIRE_SLIP',
  'TAX_FILING',
  'DELIVERABLE',
  'OTHER',
]);

type EvidenceDocumentType =
  | 'INVOICE'
  | 'RECEIPT'
  | 'BANK_WIRE_SLIP'
  | 'TAX_FILING'
  | 'DELIVERABLE'
  | 'OTHER';

export interface UploadedEvidenceFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

type ScanResult = 'CLEAN' | 'INFECTED';

@Injectable()
export class EvidenceVaultService {
  constructor(
    private readonly env: EnvService,
    private readonly tenantContext: TenantContextService,
    private readonly auditLog: AuditLogService,
  ) {}

  async upload(
    actor: AuthUserContext,
    file: UploadedEvidenceFile,
    documentType: string,
  ) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length) {
      throw new BadRequestException('A valid evidence file is required');
    }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('Evidence files must be between 1 byte and 10 MB');
    }
    if (!this.isEvidenceDocumentType(documentType)) {
      throw new BadRequestException('Unsupported evidence document type');
    }

    const detectedMimeType = this.detectMimeType(file.buffer);
    if (!detectedMimeType || detectedMimeType !== file.mimetype) {
      throw new BadRequestException('The file contents do not match a supported MIME type');
    }

    const scanResult = await this.scan(file.buffer);
    const id = randomUUID();
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `${actor.tenant_id}/${id}`;
    if (scanResult === 'CLEAN') {
      await this.putObject(storageKey, detectedMimeType, file.buffer);
    }

    try {
      return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
        const document = await tx
          .insertInto('evidence_documents')
          .values({
            id,
            tenant_id: actor.tenant_id,
            storage_key: storageKey,
            sha256,
            mime_type: detectedMimeType,
            declared_mime_type: file.mimetype,
            size_bytes: file.size,
            uploader_user_id: actor.user_id,
            doc_type: documentType,
            source_channel: 'WEB_UPLOAD',
            scan_status: scanResult,
          })
          .returning([
            'id',
            'doc_type',
            'scan_status',
            'size_bytes',
            'sha256',
            'created_at',
          ])
          .executeTakeFirstOrThrow();

        await this.auditLog.appendAuditLog(tx, {
          tenant_id: actor.tenant_id,
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: scanResult === 'CLEAN' ? 'EVIDENCE_UPLOADED' : 'EVIDENCE_REJECTED_BY_SCAN',
          entity_type: 'evidence_document',
          entity_id: id,
          after_state: {
            doc_type: documentType,
            scan_status: scanResult,
            size_bytes: file.size,
            sha256,
          },
        });
        return document;
      });
    } catch (error) {
      if (scanResult === 'CLEAN') {
        try {
          await this.deleteObject(storageKey);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Evidence metadata persistence failed and the uploaded object could not be removed',
          );
        }
      }
      throw error;
    }
  }

  async getOwnDownloadUrl(actor: AuthUserContext, documentId: string): Promise<string> {
    const document = await this.tenantContext.withTenantContext(actor.tenant_id, (tx) =>
      tx
        .selectFrom('evidence_documents')
        .select(['storage_key', 'scan_status'])
        .where('id', '=', documentId)
        .where('tenant_id', '=', actor.tenant_id)
        .executeTakeFirst(),
    );
    if (!document || document.scan_status !== 'CLEAN') {
      throw new BadRequestException('Evidence is unavailable');
    }
    return this.presignObject('GET', document.storage_key, 60);
  }

  presignSnapshotEvidence(storageKey: string): string {
    return this.presignObject('GET', storageKey, 60);
  }

  private async scan(buffer: Buffer): Promise<ScanResult> {
    const { CLAMAV_HOST, CLAMAV_PORT, CLAMAV_TIMEOUT_MS } = this.env.config;
    return await new Promise<ScanResult>((resolve, reject) => {
      const socket = new Socket();
      let response = Buffer.alloc(0);
      let settled = false;

      const finish = (error?: Error, result?: ScanResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else if (result) resolve(result);
      };

      socket.setTimeout(CLAMAV_TIMEOUT_MS);
      socket.once('connect', () => {
        socket.write(Buffer.from('INSTREAM\0', 'utf8'));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(buffer.length);
        socket.write(length);
        socket.write(buffer);
        socket.write(Buffer.alloc(4));
      });
      socket.on('data', (chunk) => {
        response = Buffer.concat([response, chunk]);
        const terminator = response.indexOf(0);
        if (terminator < 0) return;
        const result = response.subarray(0, terminator).toString('utf8');
        if (result.endsWith(' OK')) finish(undefined, 'CLEAN');
        else if (result.endsWith(' FOUND')) finish(undefined, 'INFECTED');
        else finish(new ServiceUnavailableException('The evidence scanner returned an invalid response'));
      });
      socket.once('timeout', () =>
        finish(new ServiceUnavailableException('The evidence scanner timed out')),
      );
      socket.once('error', () =>
        finish(new ServiceUnavailableException('The evidence scanner is unavailable')),
      );
      socket.connect(CLAMAV_PORT, CLAMAV_HOST);
    });
  }

  private detectMimeType(buffer: Buffer): string | null {
    if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return 'image/png';
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    return null;
  }

  private isEvidenceDocumentType(value: string): value is EvidenceDocumentType {
    return ALLOWED_DOCUMENT_TYPES.has(value);
  }

  private async putObject(key: string, mimeType: string, body: Buffer): Promise<void> {
    const response = await fetch(this.presignObject('PUT', key, 60), {
      method: 'PUT',
      headers: { 'content-type': mimeType },
      body,
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Evidence storage rejected the upload (HTTP ${response.status})`,
      );
    }
  }

  private async deleteObject(key: string): Promise<void> {
    const response = await fetch(this.presignObject('DELETE', key, 60), { method: 'DELETE' });
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Evidence storage could not remove the failed upload (HTTP ${response.status})`,
      );
    }
  }

  private presignObject(method: 'GET' | 'PUT' | 'DELETE', key: string, expiresSeconds: number) {
    const config = this.env.config;
    const endpoint = new URL(config.S3_ENDPOINT);
    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const region = config.S3_REGION;
    const bucket = config.S3_BUCKET;

    let host = endpoint.host;
    let objectPath = `${endpoint.pathname.replace(/\/$/, '')}/${this.encodePath(key)}`;
    if (config.S3_FORCE_PATH_STYLE) {
      objectPath = `${endpoint.pathname.replace(/\/$/, '')}/${this.encodePath(bucket)}/${this.encodePath(key)}`;
    } else {
      host = `${bucket}.${host}`;
      endpoint.hostname = `${bucket}.${endpoint.hostname}`;
    }
    if (objectPath.startsWith('//')) objectPath = objectPath.slice(1);

    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const params: Array<[string, string]> = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${config.S3_ACCESS_KEY}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(expiresSeconds)],
      ['X-Amz-SignedHeaders', 'host'],
    ];
    const canonicalQuery = params
      .map(([name, value]) => `${this.awsEncode(name)}=${this.awsEncode(value)}`)
      .sort()
      .join('&');
    const canonicalRequest = [
      method,
      objectPath,
      canonicalQuery,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const dateKey = this.hmac(`AWS4${config.S3_SECRET_KEY}`, dateStamp);
    const regionKey = this.hmac(dateKey, region);
    const serviceKey = this.hmac(regionKey, 's3');
    const signingKey = this.hmac(serviceKey, 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const origin = endpoint.origin;
    return `${origin}${objectPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  private hmac(key: string | Buffer, value: string): Buffer {
    return createHmac('sha256', key).update(value).digest();
  }

  private awsEncode(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  private encodePath(value: string): string {
    return value.split('/').map((part) => this.awsEncode(part)).join('/');
  }
}
