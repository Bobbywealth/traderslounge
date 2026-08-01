import { describe, expect, it, vi } from 'vitest';
import { createAuthenticatedApiClient } from './authenticatedApiClient';

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

const response = (status: number, body: unknown = {}): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
} as Response);

describe('createAuthenticatedApiClient', () => {
  it('restores a token and attaches it to protected requests', async () => {
    const storage = createStorage({ confluencex_refresh_token: 'refresh-1' });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { access_token: 'access-1', refresh_token: 'refresh-2' }))
      .mockResolvedValueOnce(response(200));
    const client = createAuthenticatedApiClient({
      apiBase: 'https://api.test',
      fetchImpl: fetchImpl as typeof fetch,
      storage,
    });

    await client.fetch('https://api.test/api/candles');

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://api.test/api/auth/refresh', expect.objectContaining({ method: 'POST' }));
    const protectedInit = fetchImpl.mock.calls[1][1] as RequestInit;
    expect(new Headers(protectedInit.headers).get('Authorization')).toBe('Bearer access-1');
    expect(storage.setItem).toHaveBeenCalledWith('confluencex_refresh_token', 'refresh-2');
  });

  it('shares one refresh request across simultaneous protected calls', async () => {
    const storage = createStorage({ confluencex_refresh_token: 'refresh-1' });
    let resolveRefresh!: (value: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => refreshResponse)
      .mockResolvedValue(response(200));
    const client = createAuthenticatedApiClient({
      apiBase: 'https://api.test',
      fetchImpl: fetchImpl as typeof fetch,
      storage,
    });

    const first = client.fetch('https://api.test/api/one');
    const second = client.fetch('https://api.test/api/two');
    resolveRefresh(response(200, { access_token: 'access-1' }));
    await Promise.all([first, second]);

    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/refresh'))).toHaveLength(1);
  });

  it('retries only once after a 401', async () => {
    const storage = createStorage({ confluencex_refresh_token: 'refresh-1' });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { access_token: 'access-1' }))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { access_token: 'access-2' }))
      .mockResolvedValueOnce(response(401));
    const client = createAuthenticatedApiClient({
      apiBase: 'https://api.test',
      fetchImpl: fetchImpl as typeof fetch,
      storage,
    });

    const result = await client.fetch('https://api.test/api/protected');

    expect(result.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('clears an expired session when refresh fails', async () => {
    const storage = createStorage({ confluencex_refresh_token: 'expired' });
    const onSessionExpired = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(response(401));
    const client = createAuthenticatedApiClient({
      apiBase: 'https://api.test',
      fetchImpl: fetchImpl as typeof fetch,
      storage,
      onSessionExpired,
    });

    expect(await client.restore()).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith('confluencex_refresh_token');
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });
});
