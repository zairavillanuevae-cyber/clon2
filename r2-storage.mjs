import crypto from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const imageTypes = new Map([
  ['image/jpeg', { extension: '.jpg', matches: (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff }],
  [
    'image/png',
    {
      extension: '.png',
      matches: (data) => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    }
  ],
  [
    'image/gif',
    {
      extension: '.gif',
      matches: (data) => ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))
    }
  ],
  [
    'image/webp',
    {
      extension: '.webp',
      matches: (data) =>
        data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP'
    }
  ]
]);

export function validateImage(data, contentType) {
  const normalizedType = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const definition = imageTypes.get(normalizedType);
  if (!definition) throw Object.assign(new Error('Use a JPG, PNG, WEBP, or GIF image.'), { status: 415 });
  if (!Buffer.isBuffer(data) || data.length === 0)
    throw Object.assign(new Error('Choose an image to upload.'), { status: 400 });
  if (data.length > MAX_IMAGE_BYTES)
    throw Object.assign(new Error('The image must be 5 MB or smaller.'), { status: 413 });
  if (!definition.matches(data))
    throw Object.assign(new Error('The file contents do not match the selected image format.'), { status: 415 });
  return { contentType: normalizedType, extension: definition.extension };
}

const extensionOf = (name) =>
  String(name)
    .toLowerCase()
    .match(/\.[a-z0-9]+$/)?.[0] || '';
const isZip = (data) =>
  data.length >= 4 &&
  data[0] === 0x50 &&
  data[1] === 0x4b &&
  ((data[2] === 0x03 && data[3] === 0x04) ||
    (data[2] === 0x05 && data[3] === 0x06) ||
    (data[2] === 0x07 && data[3] === 0x08));
const containsZipEntry = (data, entry) => data.includes(Buffer.from(entry, 'utf8'));
const isPlainText = (data) => {
  if (data.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
};

const documentTypes = new Map([
  [
    '.pdf',
    {
      contentType: 'application/pdf',
      declaredTypes: ['application/pdf'],
      matches: (data) =>
        data.subarray(0, 5).toString('ascii') === '%PDF-' &&
        data.subarray(Math.max(0, data.length - 2048)).includes(Buffer.from('%%EOF', 'ascii'))
    }
  ],
  ['.txt', { contentType: 'text/plain', declaredTypes: ['text/plain'], matches: isPlainText }],
  [
    '.csv',
    {
      contentType: 'text/csv',
      declaredTypes: ['text/csv', 'application/csv', 'application/vnd.ms-excel'],
      matches: isPlainText
    }
  ],
  [
    '.docx',
    {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      declaredTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      matches: (data) => isZip(data) && containsZipEntry(data, '[Content_Types].xml') && containsZipEntry(data, 'word/')
    }
  ],
  [
    '.xlsx',
    {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      declaredTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      matches: (data) => isZip(data) && containsZipEntry(data, '[Content_Types].xml') && containsZipEntry(data, 'xl/')
    }
  ]
]);

export function validateAttachment(data, contentType, fileName) {
  const normalizedType = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (normalizedType.startsWith('image/')) {
    const image = validateImage(data, normalizedType);
    const declaredExtension = extensionOf(fileName);
    const allowedExtensions = image.extension === '.jpg' ? ['.jpg', '.jpeg'] : [image.extension];
    if (!allowedExtensions.includes(declaredExtension))
      throw Object.assign(new Error('The image type does not match its extension.'), { status: 415 });
    return { ...image, kind: 'image' };
  }
  if (!Buffer.isBuffer(data) || data.length === 0)
    throw Object.assign(new Error('Choose a file to upload.'), { status: 400 });
  if (data.length > MAX_FILE_BYTES)
    throw Object.assign(new Error('The file must be 10 MB or smaller.'), { status: 413 });
  const extension = extensionOf(fileName);
  const definition = documentTypes.get(extension);
  if (!definition)
    throw Object.assign(new Error('Use a PDF, TXT, CSV, DOCX, XLSX, JPG, PNG, WEBP, or GIF file.'), { status: 415 });
  if (
    normalizedType &&
    normalizedType !== 'application/octet-stream' &&
    !definition.declaredTypes.includes(normalizedType)
  )
    throw Object.assign(new Error('The file type does not match its extension.'), { status: 415 });
  if (!definition.matches(data))
    throw Object.assign(new Error('The file contents do not match its extension.'), { status: 415 });
  return { kind: 'file', contentType: definition.contentType, extension };
}

export function cleanImageName(value = '') {
  const decoded = (() => {
    try {
      return decodeURIComponent(String(value));
    } catch {
      return String(value);
    }
  })();
  return (
    decoded
      .replace(/[\\/\0-\x1f\x7f]/g, '')
      .trim()
      .slice(0, 120) || 'chat-image'
  );
}

export function createR2Storage(environment = process.env) {
  const accountId = environment.R2_ACCOUNT_ID;
  const accessKeyId = environment.R2_ACCESS_KEY || environment.R2_ACCESS_KEY_ID;
  const secretAccessKey = environment.R2_SECRET_KEY || environment.R2_SECRET_ACCESS_KEY;
  const bucket = environment.R2_BUCKET_NAME;
  const publicUrl = environment.R2_PUBLIC_URL;
  if (![accountId, accessKeyId, secretAccessKey, bucket, publicUrl].every(Boolean)) return null;

  let publicBase;
  try {
    publicBase = new URL(String(publicUrl).replace(/\/+$/, '') + '/');
  } catch {
    throw new Error('R2_PUBLIC_URL must be a valid public HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(publicBase.protocol)) throw new Error('R2_PUBLIC_URL must use HTTP or HTTPS.');

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  });

  return {
    publicOrigin: publicBase.origin,
    async uploadAttachment({ data, contentType, extension, sessionId, fileName, kind }) {
      const key = `chat/${sessionId}/${crypto.randomUUID()}${extension}`;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          ContentDisposition:
            kind === 'file' ? `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}` : 'inline',
          CacheControl: 'public, max-age=31536000, immutable'
        })
      );
      return { key, url: new URL(key, publicBase).href };
    },
    async deleteAttachment(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
  };
}
