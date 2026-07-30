const REFRESH_TOKEN_KEY = 'confluencex_refresh_token';

export interface AuthTokenPayload {
  access_token: string;
  refresh_token?: string;
}

export interface AuthenticatedApiClientOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  onSessionExpired?: () => void;
}

export function getAuthenticatedApiBase(): string {
  return import.meta.env.VITE_BWTS_API_URL || import.meta.env.VITE_API_URL || '';
}

export function createAuthenticatedApiClient(options: AuthenticatedApiClientOptions = {}) {
  const apiBase = options.apiBase ?? getAuthenticatedApiBase();
  const fetchImpl = options.fetchImpl ?? fetch;
  const storage = options.storage ?? localStorage;
  let accessToken: string | null = null;
  let refreshInFlight: Promise<boolean> | null = null;

  const clearSession = () => {
    accessToken = null;
    storage.removeItem(REFRESH_TOKEN_KEY);
    options.onSessionExpired?.();
  };

  const saveTokens = (payload: AuthTokenPayload) => {
    accessToken = payload.access_token;
    if (payload.refresh_token) storage.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
  };

  const refreshAccessToken = async (): Promise<boolean> => {
    if (refreshInFlight) return refreshInFlight;

    const refreshToken = storage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;

    refreshInFlight = fetchImpl(`${apiBase}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const payload = await response.json() as Partial<AuthTokenPayload>;
        if (!payload.access_token) return false;
        saveTokens(payload as AuthTokenPayload);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });

    const refreshed = await refreshInFlight;
    if (!refreshed) clearSession();
    return refreshed;
  };

  const authenticatedFetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
    retry = true,
  ): Promise<Response> => {
    if (!accessToken) await refreshAccessToken();

    const headers = new Headers(init.headers || {});
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

    const response = await fetchImpl(input, { ...init, headers });
    if (response.status !== 401 || !retry) return response;

    if (!await refreshAccessToken()) return response;
    return authenticatedFetch(input, init, false);
  };

  return {
    fetch: authenticatedFetch,
    restore: refreshAccessToken,
    clear: clearSession,
    hasRefreshToken: () => Boolean(storage.getItem(REFRESH_TOKEN_KEY)),
    setTokens: saveTokens,
  };
}

export const authenticatedApiClient = createAuthenticatedApiClient();
export const authenticatedApiFetch = authenticatedApiClient.fetch;
