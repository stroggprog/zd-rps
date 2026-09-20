import type { Connection } from '../types.js';
import { ApiError } from '../util.js';

export function authHeaders(conn: Connection): Record<string, string> {
  return conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {};
}

export function jsonPost(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function multipartPost(
  url: string,
  form: FormData,
  headers: Record<string, string> = {},
): Promise<Response> {
  return request(url, { method: 'POST', headers, body: form });
}

export async function request(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError(`Failed to reach ${url}: ${(err as Error).message}`, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`, 502);
  }
  return res;
}

export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(`Non-JSON response from ${res.url}: ${text.slice(0, 200)}`, 502);
  }
}

/** Yields trimmed non-empty lines from a streaming HTTP response body. */
export async function* readBodyLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    if (!done) buf += decoder.decode(chunk.value as Uint8Array, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) yield line;
    }
  }
  if (buf.trim()) yield buf;
}

export function appendV1(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}