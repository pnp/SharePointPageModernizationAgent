import { Agent } from 'undici';
import { getSharePointCookies } from './auth.js';
import { logger } from '../utils/logger.js';

const ACCEPT_HEADER = 'application/json;odata=nometadata';
const ACCEPT_VERBOSE = 'application/json;odata=verbose';
const CONTENT_TYPE_VERBOSE = 'application/json;odata=verbose';

// Only these domain get cert validation skipped — public sharepoint.com stays validated.
const INTERNAL_HOST_SUFFIXES: string[] = [];

const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

function isInternalHost(hostname: string): boolean {
  return INTERNAL_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix));
}

export function fetchOptionsFor(url: string): { dispatcher?: Agent } {
  try {
    return isInternalHost(new URL(url).hostname) ? { dispatcher: insecureDispatcher } : {};
  } catch {
    return {};
  }
}

// ── Form digest cache ──

interface DigestEntry {
  digest: string;
  expiresAt: number;
}

const digestCache = new Map<string, DigestEntry>();

/** Get a form digest for SharePoint POST operations (cached ~30 min). */
export async function getFormDigest(siteUrl: string): Promise<string> {
  const key = siteUrl.replace(/\/$/, '');
  const cached = digestCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.digest;

  const cookies = await getSharePointCookies(siteUrl);
  const url = `${key}/_api/contextinfo`;

  logger.info('SP REST POST contextinfo', { url });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Cookie: cookies,
      Accept: ACCEPT_VERBOSE,
      'Content-Length': '0',
    },
    ...fetchOptionsFor(url),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Form digest request failed (${res.status}): ${body}`);
  }

  const json = await res.json() as { d?: { GetContextWebInformation?: { FormDigestValue?: string; FormDigestTimeoutSeconds?: number } } };
  const info = json.d?.GetContextWebInformation;
  const digest = info?.FormDigestValue;
  if (!digest) throw new Error('No FormDigestValue in contextinfo response');

  const timeout = (info?.FormDigestTimeoutSeconds || 1800) * 1000;
  digestCache.set(key, { digest, expiresAt: Date.now() + timeout - 60_000 });
  return digest;
}

// ── GET ──

/** GET a SharePoint REST API endpoint and return parsed JSON. */
export async function get<T = unknown>(siteUrl: string, apiPath: string): Promise<T> {
  const cookies = await getSharePointCookies(siteUrl);
  const url = `${siteUrl.replace(/\/$/, '')}/_api/${apiPath.replace(/^\//, '')}`;

  logger.info('SP REST GET', { url });
  const res = await fetch(url, {
    headers: {
      Cookie: cookies,
      Accept: ACCEPT_HEADER,
    },
    ...fetchOptionsFor(url),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SP REST GET ${url} failed (${res.status}): ${body}`);
  }
  return (await res.json()) as T;
}

// ── POST ──

/** POST to a SharePoint REST API endpoint (odata=verbose). */
export async function post<T = unknown>(siteUrl: string, apiPath: string, body: unknown): Promise<T> {
  const cookies = await getSharePointCookies(siteUrl);
  const digest = await getFormDigest(siteUrl);
  const url = `${siteUrl.replace(/\/$/, '')}/_api/${apiPath.replace(/^\//, '')}`;

  logger.info('SP REST POST', { url });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Cookie: cookies,
      Accept: ACCEPT_VERBOSE,
      'Content-Type': CONTENT_TYPE_VERBOSE,
      'X-RequestDigest': digest,
    },
    body: JSON.stringify(body),
    ...fetchOptionsFor(url),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SP REST POST ${url} failed (${res.status}): ${text}`);
  }

  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/** POST with X-HTTP-Method: MERGE for updating existing items. */
export async function postMerge(siteUrl: string, apiPath: string, body: unknown): Promise<void> {
  const cookies = await getSharePointCookies(siteUrl);
  const digest = await getFormDigest(siteUrl);
  const url = `${siteUrl.replace(/\/$/, '')}/_api/${apiPath.replace(/^\//, '')}`;

  logger.info('SP REST MERGE', { url });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Cookie: cookies,
      Accept: ACCEPT_VERBOSE,
      'Content-Type': CONTENT_TYPE_VERBOSE,
      'X-RequestDigest': digest,
      'X-HTTP-Method': 'MERGE',
      'IF-MATCH': '*',
    },
    body: JSON.stringify(body),
    ...fetchOptionsFor(url),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SP REST MERGE ${url} failed (${res.status}): ${text}`);
  }
}

// ── Binary file operations ──

/** Download a file as a binary Buffer by absolute or server-relative URL. */
export async function downloadFileBuffer(siteUrl: string, fileUrl: string): Promise<Buffer> {
  const cookies = await getSharePointCookies(siteUrl);
  const absoluteUrl = fileUrl.startsWith('http')
    ? fileUrl
    : `${new URL(siteUrl).origin}${fileUrl}`;

  logger.info('SP REST download file', { url: absoluteUrl });
  const res = await fetch(absoluteUrl, {
    headers: { Cookie: cookies },
    ...fetchOptionsFor(absoluteUrl),
  });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${absoluteUrl}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Upload a binary file to a SharePoint folder. Returns the server-relative URL. */
export async function uploadFileBuffer(
  siteUrl: string,
  folderServerRelativeUrl: string,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const cookies = await getSharePointCookies(siteUrl);
  const digest = await getFormDigest(siteUrl);
  const encodedFolder = encodeURIComponent(folderServerRelativeUrl).replace(/%2F/g, '/');
  const encodedFilename = encodeURIComponent(filename);
  const url = `${siteUrl.replace(/\/$/, '')}/_api/web/GetFolderByServerRelativeUrl('${encodedFolder}')/Files/add(url='${encodedFilename}',overwrite=true)`;

  logger.info('SP REST upload file', { url, size: buffer.length });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Cookie: cookies,
      'X-RequestDigest': digest,
      Accept: ACCEPT_VERBOSE,
    },
    body: new Uint8Array(buffer),
    ...fetchOptionsFor(url),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  const json = await res.json() as { d?: { ServerRelativeUrl?: string }; ServerRelativeUrl?: string };
  const serverRelUrl = json.d?.ServerRelativeUrl ?? json.ServerRelativeUrl;
  if (!serverRelUrl) {
    logger.warn('uploadFileBuffer: response missing ServerRelativeUrl', { folder: folderServerRelativeUrl, filename });
    throw new Error(`Upload succeeded but response missing ServerRelativeUrl for ${filename}`);
  }
  return serverRelUrl;
}

// ── Text file operations ──

/** GET a file's text content by server-relative URL. */
export async function getFile(siteUrl: string, serverRelativeUrl: string): Promise<string> {
  const cookies = await getSharePointCookies(siteUrl);
  const encodedPath = encodeURIComponent(serverRelativeUrl).replace(/%2F/g, '/');
  const url = `${siteUrl.replace(/\/$/, '')}/_api/web/getfilebyserverrelativeurl('${encodedPath}')/$value`;

  logger.info('SP REST GET file', { url });
  const res = await fetch(url, {
    headers: {
      Cookie: cookies,
    },
    ...fetchOptionsFor(url),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SP REST GET file ${url} failed (${res.status}): ${body}`);
  }
  return await res.text();
}
