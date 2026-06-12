import type { ApiEnvelope } from '@lms/shared';
import { ApiClientError, fromApiError, fromNetwork, fromStatus } from './errors';

/**
 * Web → API client. Single entry point for every call to the NestJS backend.
 *
 * Contract alignment (do not diverge):
 * - Base path `/api/v1` (api-contract `servers.url`), same-origin. Dev reaches the
 *   API via the Vite proxy (vite.config.ts); prod is served behind the same host.
 * - Auth is httpOnly cookies (api-contract: "tokens set as httpOnly cookies").
 *   So every request sends `credentials: 'include'`; there is NO token in JS and
 *   NO `Authorization` header. A `401 AUTH_REQUIRED` triggers ONE transparent
 *   `POST /auth/refresh` (single-flight) then a single retry; if refresh also
 *   fails, the unauthorized handler (wired by the auth layer) fires.
 * - Every response is the uniform `{ data, meta, error }` envelope. Success
 *   returns `data`; any `error` rejects with `ApiClientError` (taxonomy code).
 */

const BASE_URL = '/api/v1';

/** Query value kinds we serialise; objects (e.g. the leads `filter`) are JSON. */
type QueryValue = string | number | boolean | Record<string, unknown> | undefined | null;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  query?: QueryParams;
  signal?: AbortSignal;
  /** Extra headers (merged over the JSON defaults). */
  headers?: Record<string, string>;
  /** Auth endpoints set this so a 401 is not caught by the refresh interceptor. */
  skipAuthRefresh?: boolean;
}

/** Registered by the auth layer; invoked when the session is unrecoverable
 * (refresh failed). Kept as an injected callback to avoid a circular import. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

function buildUrl(path: string, query?: QueryParams): string {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Parse one Response into either `data` (success) or a thrown ApiClientError. */
async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let envelope: ApiEnvelope<T> | null = null;
  if (text.length > 0) {
    try {
      envelope = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      envelope = null; // non-JSON body (e.g. a proxy 502 HTML page)
    }
  }

  if (envelope?.error) {
    throw fromApiError(envelope.error, res.status, envelope.meta?.correlation_id);
  }
  if (!res.ok) {
    throw fromStatus(res.status);
  }
  // Success: `data` may legitimately be null (e.g. 204-style envelopes).
  return (envelope ? envelope.data : null) as T;
}

let refreshInFlight: Promise<void> | null = null;
/** Single-flight `POST /auth/refresh`; concurrent 401s share one refresh. */
function refreshSession(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = rawFetch('POST', '/auth/refresh', undefined, { skipAuthRefresh: true })
      .then(() => undefined)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/** One network round-trip (no refresh logic). Rejects with ApiClientError. */
async function rawFetch<T>(
  method: string,
  path: string,
  body: unknown,
  opts: RequestOptions | undefined,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts?.query), {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...opts?.headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts?.signal,
    });
  } catch (cause) {
    throw fromNetwork(cause);
  }
  return parse<T>(res);
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  opts: RequestOptions | undefined,
): Promise<T> {
  try {
    return await rawFetch<T>(method, path, body, opts);
  } catch (err) {
    const unauthenticated = err instanceof ApiClientError && err.status === 401;
    if (!unauthenticated || opts?.skipAuthRefresh) throw err;

    // 401 on a normal call: refresh once, then retry once.
    try {
      await refreshSession();
    } catch {
      onUnauthorized?.();
      throw err;
    }
    try {
      return await rawFetch<T>(method, path, body, { ...opts, skipAuthRefresh: true });
    } catch (retryErr) {
      if (retryErr instanceof ApiClientError && retryErr.status === 401) onUnauthorized?.();
      throw retryErr;
    }
  }
}

export const apiClient = {
  get: <T>(path: string, opts?: RequestOptions): Promise<T> => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>('POST', path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>('PUT', path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>('PATCH', path, body, opts),
  del: <T>(path: string, opts?: RequestOptions): Promise<T> => request<T>('DELETE', path, undefined, opts),
} as const;
