const REFRESH_TOKEN_KEY = 'confluencex_refresh_token';

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

function getApiBase(): string {
  return import.meta.env.VITE_BWTS_API_URL || import.meta.env.VITE_API_URL || '';
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;

  refreshInFlight = fetch(`${getApiBase()}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
    .then(async (response) => {
      if (!response.ok) return false;
      const payload = await response.json() as {
        access_token?: string;
        refresh_token?: string;
      };
      if (!payload.access_token) return false;

      accessToken = payload.access_token;
      if (payload.refresh_token) {
        localStorage.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
      }
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });

  const refreshed = await refreshInFlight;
  if (!refreshed) accessToken = null;
  return refreshed;
}

/**
 * Authenticated fetch for chart endpoints that live outside the main BWTS API
 * client. It restores an access token from the persisted refresh token and
 * retries once when the backend returns 401.
 */
export async function authenticatedChartFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  if (!accessToken) await refreshAccessToken();

  const headers = new Headers(init.headers || {});
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && retry && await refreshAccessToken()) {
    return authenticatedChartFetch(input, init, false);
  }

  return response;
}
