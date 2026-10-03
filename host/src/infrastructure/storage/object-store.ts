import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

export interface ObjectStore {
  check?(): Promise<void>;
  create(key: string, bytes: Uint8Array, contentType: string): Promise<boolean>;
  open(key: string): Promise<Readable>;
  promote(source: string, target: string, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  put(
    key: string,
    bytes: Uint8Array,
    contentType: string,
    immutable?: boolean,
  ): Promise<void>;
  get(key: string, maxBytes?: number): Promise<Uint8Array>;
  upload(key: string, body: Readable, contentType: string): Promise<void>;
  publicUrl(key: string): string;
}
export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}
export const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
export const validateKey = (key: string): void => {
  if (
    !/^[a-zA-Z0-9/_ .-]+$/.test(key) ||
    key.split("/").some((p) => p === ".." || p === ".") ||
    key.startsWith("/")
  )
    throw new Error("Invalid object key");
};
export const createS3ObjectStore = (
  config: StorageConfig,
): ObjectStore & { check(): Promise<void> } => {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 10000, requestTimeout: 30000 },
  });
  return {
    async create(key, bytes, contentType) {
      validateKey(key);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType,
            IfNoneMatch: "*",
            CacheControl: "no-store",
          }),
        );
        return true;
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode: number } })?.$metadata
            ?.httpStatusCode === 412
        )
          return false;
        throw error;
      }
    },
    async open(key) {
      validateKey(key);
      const result = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      if (!result.Body) throw new Error("Missing object body");
      return result.Body as Readable;
    },
    async promote(source, target, contentType) {
      validateKey(source);
      validateKey(target);
      await client.send(
        new CopyObjectCommand({
          Bucket: config.bucket,
          Key: target,
          CopySource: `${config.bucket}/${source}`,
          ContentType: contentType,
          MetadataDirective: "REPLACE",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    },
    async remove(key) {
      validateKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
    async check() {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    },
    async put(key, bytes, contentType, immutable = false) {
      validateKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          CacheControl: immutable ? "public, max-age=31536000, immutable" : "no-store",
        }),
      );
    },
    async get(key, maxBytes = 16 * 1024 * 1024) {
      validateKey(key);
      const result = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      if (!result.Body || (result.ContentLength ?? 0) > maxBytes) {
        (result.Body as Readable | undefined)?.destroy();
        throw new Error("Object missing or exceeds read limit");
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of result.Body as Readable) {
        size += chunk.length;
        if (size > maxBytes) {
          (result.Body as Readable).destroy();
          throw new Error("Object exceeds read limit");
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
    async upload(key, body, contentType) {
      validateKey(key);
      await new Upload({
        client,
        params: { Bucket: config.bucket, Key: key, Body: body, ContentType: contentType },
        queueSize: 2,
        partSize: 5 * 1024 * 1024,
        leavePartsOnError: false,
      }).done();
    },
    publicUrl(key) {
      validateKey(key);
      return (
        config.publicBaseUrl.replace(/\/$/, "") +
        "/" +
        key.split("/").map(encodeURIComponent).join("/")
      );
    },
  };
};

export const putVerified = async (
  store: ObjectStore,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> => {
  await store.put(key, bytes, contentType, true);
  const actual = await store.get(key, bytes.length + 1);
  if (actual.length !== bytes.length || digest(actual) !== digest(bytes))
    throw new Error("Stored bytes failed verification");
};
