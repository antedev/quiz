import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE_DIR = join(ROOT, 'data', 'cache');
export const DATA_DIR = join(ROOT, 'data');
export const PUBLIC_DATA_DIR = join(ROOT, 'public', 'data');

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function readJsonIfExists<T>(path: string, fallback: T): T {
  return existsSync(path) ? readJson<T>(path) : fallback;
}

export function writeJson(path: string, data: unknown, pretty = true): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, pretty ? 2 : undefined) + '\n', 'utf8');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch med User-Agent, timeout och exponentiell backoff. */
export async function httpFetch(url: string, init: RequestInit = {}, retries = 4, baseDelayMs = 1000): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(120_000),
        headers: { 'User-Agent': config.userAgent, ...(init.headers ?? {}) },
      });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        const err = new Error(`HTTP ${res.status}` + (retryAfter ? ` (retry-after ${retryAfter}s)` : ''));
        (err as any).retryAfter = retryAfter;
        throw err;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const retryAfter = (err as any)?.retryAfter ?? 0;
        const expWait = baseDelayMs * 2 ** attempt;
        const wait = Math.max(expWait, (retryAfter + 1) * 1000);
        console.warn(`  ! ${String(err)} – väntar ${(wait / 1000).toFixed(1)}s (försök ${attempt + 1}/${retries})`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
