import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CreateBucketCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, PutObjectLockConfigurationCommand, S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CONFIG, type Config } from '../../config';

/**
 * S3 protocol only (ADR-0003): MinIO in Docker and self-hosted Kubernetes, Ceph RGW on-premises,
 * any cloud S3 in the cloud profile. No provider-specific features beyond S3 Object Lock.
 *
 * Two clients: one for the API's own traffic (in-cluster endpoint) and one used only to sign URLs
 * for browsers, because a presigned URL's signature covers the host the browser will call.
 */
@Injectable()
export class ObjectStore {
  private readonly log = new Logger('ObjectStore');
  private readonly s3: S3Client;
  private readonly signer: S3Client;
  private ready: Promise<void> | null = null;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    const base = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
    };
    this.s3 = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    this.signer = new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT });
  }

  get documentsBucket() { return this.config.S3_BUCKET_DOCUMENTS; }
  get anchorsBucket() { return this.config.S3_BUCKET_ANCHORS; }

  /** Create buckets on first use. The anchors bucket is write-once (Object Lock, COMPLIANCE mode). */
  ensureBuckets(): Promise<void> {
    this.ready ??= (async () => {
      await this.ensureBucket(this.documentsBucket, false);
      await this.ensureBucket(this.anchorsBucket, true);
    })().catch(e => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  private async ensureBucket(bucket: string, locked: boolean) {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: bucket }));
      return;
    } catch {
      /* create below */
    }
    await this.s3.send(new CreateBucketCommand({ Bucket: bucket, ObjectLockEnabledForBucket: locked }));
    if (locked) {
      await this.s3.send(new PutObjectLockConfigurationCommand({
        Bucket: bucket,
        ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: this.config.ANCHOR_RETENTION_DAYS } } }
      }));
    }
    this.log.log(`created bucket ${bucket}${locked ? ' (object lock, COMPLIANCE)' : ''}`);
  }

  async presignPut(key: string, contentType: string, expiresIn = 900): Promise<{ url: string; headers: Record<string, string> }> {
    await this.ensureBuckets();
    const url = await getSignedUrl(this.signer, new PutObjectCommand({ Bucket: this.documentsBucket, Key: key, ContentType: contentType }), { expiresIn });
    return { url, headers: { 'content-type': contentType } };
  }

  async presignGet(key: string, fileName: string, expiresIn = 300): Promise<string> {
    const safe = fileName.replace(/[^\w.\- ]+/g, '_');
    return getSignedUrl(this.signer, new GetObjectCommand({
      Bucket: this.documentsBucket, Key: key, ResponseContentDisposition: `inline; filename="${safe}"`
    }), { expiresIn });
  }

  async head(key: string): Promise<{ size: number; contentType: string | undefined } | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.documentsBucket, Key: key }));
      return { size: r.ContentLength ?? 0, contentType: r.ContentType };
    } catch {
      return null;
    }
  }

  /** Stream the object and hash it; the hash is what the register and the audit trail record. */
  async sha256(key: string, maxBytes: number): Promise<{ sha256: string; size: number }> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.documentsBucket, Key: key }));
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of r.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > maxBytes) throw new Error(`Object ${key} exceeds ${maxBytes} bytes`);
      hash.update(chunk);
    }
    return { sha256: hash.digest('hex'), size };
  }

  async putDocument(key: string, bytes: Uint8Array, contentType: string) {
    await this.ensureBuckets();
    await this.s3.send(new PutObjectCommand({ Bucket: this.documentsBucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  /** Write-once: the bucket's default COMPLIANCE retention applies to every anchor. */
  async putAnchor(key: string, body: string) {
    await this.ensureBuckets();
    const md5 = createHash('md5').update(body).digest('base64'); // required by S3 for Object Lock writes
    await this.s3.send(new PutObjectCommand({ Bucket: this.anchorsBucket, Key: key, Body: body, ContentType: 'application/json', ContentMD5: md5 }));
  }

  async getAnchor(key: string): Promise<string> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.anchorsBucket, Key: key }));
    return (await r.Body!.transformToString()) ?? '';
  }

  async ping(): Promise<boolean> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.documentsBucket }));
      return true;
    } catch {
      return false;
    }
  }
}
