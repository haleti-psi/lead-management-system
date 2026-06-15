import type { ApiEnvelope, PaginationMeta } from '@lms/shared';
import { ApiClientError, fromApiError, fromNetwork, fromStatus } from './errors';

/**
 * Web → API client. Single entry point for every call to the NestJS backend.
 *
 * Contract alignment (do not diverge — FR-001 LLD §"Auth state management"):
 * - Base path `/api/v1` (api-contract `servers.url`), same-origin. Dev reaches the
 *   API via the Vite proxy (vite.config.ts); prod is served behind the same host.
 * - The access token is held IN-MEMORY (never localStorage) and sent as
 *   `Authorization: Bearer`. The refresh token is an httpOnly cookie
 *   (`lms_refresh`), so every request also sends `credentials: 'include'`.
 * - A `401 AUTH_REQUIRED` triggers ONE transparent `POST /auth/refresh`
 *   (single-flight; cookie-based) whose response carries a NEW access token that
 *   replaces the in-memory one, then a single retry. If refresh also fails, the
 *   unauthorized handler (wired by the auth layer → redirect to /login) fires.
 * - The auth layer (useAuth) owns the token lifecycle: it calls `setAccessToken`
 *   after login/MFA and `setAccessToken(null)` on logout.
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

/** The in-memory access token (FR-001: never persisted). Set by the auth layer
 * after login/MFA/refresh; sent as `Authorization: Bearer` on every request. */
let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** The body shape of the login/mfa/refresh 200 (FR-001 token response). */
interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  mfa_required: boolean;
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

/** Read one Response into the uniform envelope, throwing ApiClientError on any
 * `error` body or non-2xx. Shared by `parse` (data only) and `getPage` (data + meta). */
async function readEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
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
  return envelope ?? ({ data: null, meta: { correlation_id: '' }, error: null } as ApiEnvelope<T>);
}

/** Parse one Response into `data` (success) or a thrown ApiClientError. */
async function parse<T>(res: Response): Promise<T> {
  // Success: `data` may legitimately be null (e.g. 204-style envelopes).
  return (await readEnvelope<T>(res)).data as T;
}

/** Parse one Response into the full envelope (success) or throw ApiClientError. */
async function parseEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  const text = await res.text();
  let envelope: ApiEnvelope<T> | null = null;
  if (text.length > 0) {
    try {
      envelope = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      envelope = null;
    }
  }

  if (envelope?.error) {
    throw fromApiError(envelope.error, res.status, envelope.meta?.correlation_id);
  }
  if (!res.ok) {
    throw fromStatus(res.status);
  }
  return envelope as ApiEnvelope<T>;
}

let refreshInFlight: Promise<void> | null = null;
/** Single-flight `POST /auth/refresh`; concurrent 401s share one refresh. The
 * response carries a new access token (cookie-based refresh) which replaces the
 * in-memory one so the retried request authenticates. */
function refreshSession(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = rawFetch<TokenResponse>('POST', '/auth/refresh', undefined, {
      skipAuthRefresh: true,
    })
      .then((tokens) => {
        accessToken = tokens.access_token;
      })
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
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
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

/** Run `attempt`; on a 401 (and not opted out), refresh once and retry once.
 * Shared by `request` (data calls), `getPage` (paginated reads), and
 * `requestEnvelope`/`getEnvelope` (full-envelope reads). */
async function withAuthRetry<R>(
  opts: RequestOptions | undefined,
  attempt: (o: RequestOptions | undefined) => Promise<R>,
): Promise<R> {
  try {
    return await attempt(opts);
  } catch (err) {
    const unauthenticated = err instanceof ApiClientError && err.status === 401;
    if (!unauthenticated || opts?.skipAuthRefresh) throw err;

    try {
      await refreshSession();
    } catch {
      onUnauthorized?.();
      throw err;
    }
    try {
      return await attempt({ ...opts, skipAuthRefresh: true });
    } catch (retryErr) {
      if (retryErr instanceof ApiClientError && retryErr.status === 401) onUnauthorized?.();
      throw retryErr;
    }
  }
}

/** One network round-trip returning the full envelope (no refresh logic). */
async function rawFetchEnvelope<T>(
  method: string,
  path: string,
  body: unknown,
  opts: RequestOptions | undefined,
): Promise<ApiEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts?.query), {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...opts?.headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts?.signal,
    });
  } catch (cause) {
    throw fromNetwork(cause);
  }
  return parseEnvelope<T>(res);
}

function request<T>(
  method: string,
  path: string,
  body: unknown,
  opts: RequestOptions | undefined,
): Promise<T> {
  return withAuthRetry(opts, (o) => rawFetch<T>(method, path, body, o));
}

/** Like `request` but resolves the full `ApiEnvelope<T>` (data + meta). */
function requestEnvelope<T>(
  method: string,
  path: string,
  body: unknown,
  opts: RequestOptions | undefined,
): Promise<ApiEnvelope<T>> {
  return withAuthRetry(opts, (o) => rawFetchEnvelope<T>(method, path, body, o));
}

/** A paginated list result: the `data` array plus the `meta.pagination` block. */
export interface PageResult<T> {
  data: T[];
  pagination?: PaginationMeta;
}

/** GET that preserves `meta.pagination` (for server-paginated DataTable lists). */
async function rawFetchPage<T>(path: string, opts: RequestOptions | undefined): Promise<PageResult<T>> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts?.query), {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...opts?.headers,
      },
      signal: opts?.signal,
    });
  } catch (cause) {
    throw fromNetwork(cause);
  }
  const envelope = await readEnvelope<T[]>(res);
  return { data: (envelope.data ?? []) as T[], pagination: envelope.meta.pagination };
}

export const apiClient = {
  get: <T>(path: string, opts?: RequestOptions): Promise<T> => request<T>('GET', path, undefined, opts),
  getPage: <T>(path: string, opts?: RequestOptions): Promise<PageResult<T>> =>
    withAuthRetry(opts, (o) => rawFetchPage<T>(path, o)),
  /** Like `get` but resolves the full `ApiEnvelope<T>` (data + meta). */
  getEnvelope: <T>(path: string, opts?: RequestOptions): Promise<ApiEnvelope<T>> =>
    requestEnvelope<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>('POST', path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>('PUT', path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>('PATCH', path, body, opts),
  del: <T>(path: string, opts?: RequestOptions): Promise<T> => request<T>('DELETE', path, undefined, opts),
} as const;
