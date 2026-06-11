/**
 * Minimal structural HTTP request/response shapes used by the core HTTP layer.
 *
 * The runtime platform is Express (`@nestjs/platform-express`), but we depend
 * only on the small surface we actually use rather than pulling `@types/express`
 * (not in the dependency register). These interfaces are intentionally a subset;
 * they are satisfied structurally by Express's `Request`/`Response`.
 */

export interface HttpRequestLike {
  headers: Record<string, string | string[] | undefined>;
  /** Express convenience accessor (case-insensitive single header lookup). */
  header?(name: string): string | undefined;
  /** pino-http request id; aligned with the correlation id by the middleware. */
  id?: string;
}

export interface HttpResponseLike {
  setHeader(name: string, value: string): void;
  getHeader(name: string): number | string | string[] | undefined;
  status(code: number): HttpResponseLike;
  json(body: unknown): HttpResponseLike;
}

/** Reads a single header value case-insensitively from either accessor. */
export function readHeader(req: HttpRequestLike, name: string): string | undefined {
  if (typeof req.header === 'function') {
    return req.header(name);
  }
  const raw = req.headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}
