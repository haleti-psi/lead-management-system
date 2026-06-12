// @vitest-environment node
//
// Unit tests for the web apiClient (testing-contract: "Frontend unit: Vitest").
// `fetch` is stubbed; no DOM and no live API are needed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, setUnauthorizedHandler } from './apiClient';
import { isApiClientError } from './errors';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ok = <T>(data: T, correlation = 'cid-ok'): Response =>
  jsonResponse({ data, meta: { correlation_id: correlation }, error: null }, 200);

const errEnvelope = (status: number, error: object, correlation = 'cid-err'): Response =>
  jsonResponse({ data: null, meta: { correlation_id: correlation }, error }, status);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setUnauthorizedHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiClient', () => {
  it('unwraps `data` and sends cookies against the /api/v1 base path', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: '1', name: 'A' }));

    const res = await apiClient.get<{ id: string; name: string }>('/leads/1');

    expect(res).toEqual({ id: '1', name: 'A' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/leads/1');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('serialises a JSON body with a Content-Type header', async () => {
    fetchMock.mockResolvedValueOnce(ok({ created: true }));

    await apiClient.post('/leads', { product_code: 'CV' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ product_code: 'CV' }));
  });

  it('serialises query params (objects as JSON; skips null/undefined)', async () => {
    fetchMock.mockResolvedValueOnce(ok([]));

    await apiClient.get('/leads', {
      query: { page: 1, q: 'foo', filter: { stage: 'new' }, sort: undefined, dropme: null },
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('page=1');
    expect(url).toContain('q=foo');
    expect(url).toContain(`filter=${encodeURIComponent(JSON.stringify({ stage: 'new' }))}`);
    expect(url).not.toContain('sort');
    expect(url).not.toContain('dropme');
  });

  it('rejects with an ApiClientError carrying the taxonomy code, fields and correlation id', async () => {
    fetchMock.mockResolvedValueOnce(
      errEnvelope(400, {
        code: 'VALIDATION_ERROR',
        message: 'Invalid',
        retryable: false,
        fields: [{ field: 'mobile', issue: 'required' }],
      }),
    );

    const err = await apiClient.post('/leads', {}).catch((e: unknown) => e);

    expect(isApiClientError(err)).toBe(true);
    if (!isApiClientError(err)) throw new Error('expected ApiClientError');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(400);
    expect(err.retryable).toBe(false);
    expect(err.fields).toEqual([{ field: 'mobile', issue: 'required' }]);
    expect(err.correlationId).toBe('cid-err');
  });

  it('maps a non-enveloped error response to INTERNAL_ERROR', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    const err = await apiClient.get('/leads').catch((e: unknown) => e);

    if (!isApiClientError(err)) throw new Error('expected ApiClientError');
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.status).toBe(502);
  });

  it('maps a transport failure to UPSTREAM_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const err = await apiClient.get('/leads').catch((e: unknown) => e);

    if (!isApiClientError(err)) throw new Error('expected ApiClientError');
    expect(err.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(err.status).toBe(0);
    expect(err.retryable).toBe(true);
  });

  it('refreshes once on 401 then retries the original request', async () => {
    fetchMock
      .mockResolvedValueOnce(errEnvelope(401, { code: 'AUTH_REQUIRED', message: 'expired', retryable: false }))
      .mockResolvedValueOnce(ok(null)) // POST /auth/refresh
      .mockResolvedValueOnce(ok({ id: '1' })); // retried GET

    const res = await apiClient.get<{ id: string }>('/leads/1');

    expect(res).toEqual({ id: '1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(refreshUrl).toBe('/api/v1/auth/refresh');
    expect(refreshInit.method).toBe('POST');
  });

  it('invokes the unauthorized handler when the refresh also fails', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock
      .mockResolvedValueOnce(errEnvelope(401, { code: 'AUTH_REQUIRED', message: 'expired', retryable: false }))
      .mockResolvedValueOnce(errEnvelope(401, { code: 'AUTH_REQUIRED', message: 'no session', retryable: false }));

    const err = await apiClient.get('/leads/1').catch((e: unknown) => e);

    expect(handler).toHaveBeenCalledOnce();
    if (!isApiClientError(err)) throw new Error('expected ApiClientError');
    expect(err.status).toBe(401);
  });

  it('does not refresh on a 401 from an auth endpoint (skipAuthRefresh)', async () => {
    fetchMock.mockResolvedValueOnce(
      errEnvelope(401, { code: 'AUTH_REQUIRED', message: 'bad credentials', retryable: false }),
    );

    const err = await apiClient
      .post('/auth/login', { username: 'a', password: 'b' }, { skipAuthRefresh: true })
      .catch((e: unknown) => e);

    if (!isApiClientError(err)) throw new Error('expected ApiClientError');
    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
