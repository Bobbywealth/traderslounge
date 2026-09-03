/**
 * Centralized API client with authentication support.
 * 
 * All API calls should go through this client to ensure:
 * - Automatic token attachment
 * - Automatic refresh on 401
 * - Request deduplication for concurrent 401s
 * - Proper error handling
 * - Request timeout support
 */
import { getAccessToken, setAccessToken } from './authBridge';

const BASE =
  (import.meta as any).env?.VITE_BWTS_API_URL ||
  (import.meta as any).env?.VITE_API_URL ||
  'http://localhost:8000';

const REFRESH_TOKEN_KEY = 'confluencex_refresh_token';
const REMEMBER_ME_KEY = 'cx_remember_me';

// Remember-me switches between localStorage (persistent across browser
// restarts) and sessionStorage (cleared when the tab/window closes).
const getRefreshStorage = (): Storage => {
  if (typeof window === 'undefined') return localStorage;
  try {
    if (window.localStorage.getItem(REMEMBER_ME_KEY) === '0') return window.sessionStorage;
  } catch { /* ignore quota */ }
  return window.localStorage;
};

// Request deduplication for refresh operations
let refreshInFlight: Promise<boolean> | null = null;

// Default timeout (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Error types for API responses
 */
export type ApiErrorType = 
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'AUTH_EXPIRED'
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export interface ApiError {
  type: ApiErrorType;
  status: number;
  message: string;
  requestId?: string;
  details?: any;
}

/**
 * Custom error class for API errors
 */
export class ApiClientError extends Error {
  public type: ApiErrorType;
  public status: number;
  public requestId?: string;
  public details?: any;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.type = error.type;
    this.status = error.status;
    this.requestId = error.requestId;
    this.details = error.details;
  }
}

/**
 * Save tokens to storage
 */
const saveTokens = (payload: { access_token: string; refresh_token: string }) => {
  setAccessToken(payload.access_token);
  const storage = getRefreshStorage();
  try {
    storage.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
    // Mirror to the other store so a stale refresh attempt during a
    // remember-me toggle doesn't 401. Cheap string copy.
    const other = storage === localStorage ? window.sessionStorage : window.localStorage;
    try { other.setItem(REFRESH_TOKEN_KEY, payload.refresh_token); } catch { /* ignore */ }
  } catch { /* ignore quota / private mode */ }
};

/**
 * Refresh access token with deduplication
 */
const refreshAccessToken = async (): Promise<boolean> => {
  // Deduplicate concurrent refresh attempts
  if (refreshInFlight) return refreshInFlight;
  
  const refreshToken = getRefreshStorage().getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;
  
  refreshInFlight = fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error('Refresh failed');
      const payload = await response.json();
      saveTokens(payload);
      return true;
    })
    .catch(() => {
      setAccessToken(null);
      try { window.localStorage.removeItem(REFRESH_TOKEN_KEY); } catch { /* ignore */ }
      try { window.sessionStorage.removeItem(REFRESH_TOKEN_KEY); } catch { /* ignore */ }
      return false;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  
  return refreshInFlight;
};

/**
 * Core fetch wrapper with authentication and error handling
 */
const fetchWithAuth = async (
  url: string,
  init: RequestInit = {},
  options: {
    timeout?: number;
    retry?: boolean;
    throwOn4xx?: boolean;
  } = {}
): Promise<Response> => {
  const { timeout = DEFAULT_TIMEOUT_MS, retry = true, throwOn4xx = true } = options;
  
  // Ensure we have a valid token
  if (!getAccessToken()) {
    await refreshAccessToken();
  }
  
  // Add auth header
  const headers = new Headers(init.headers || {});
  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  // Add request ID for tracing
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  headers.set('X-Request-ID', requestId);
  
  // Set up timeout with AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    // Handle 401 with single refresh attempt
    if (response.status === 401 && retry && await refreshAccessToken()) {
      return fetchWithAuth(url, init, { ...options, retry: false });
    }
    
    // Parse error responses
    if (!response.ok && throwOn4xx) {
      let errorBody: any;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = {};
      }
      
      // Map status to error type
      let errorType: ApiErrorType;
      switch (response.status) {
        case 400:
          errorType = 'VALIDATION_ERROR';
          break;
        case 401:
          errorType = 'AUTH_EXPIRED';
          break;
        case 403:
          errorType = 'FORBIDDEN';
          break;
        case 404:
          errorType = 'NOT_FOUND';
          break;
        case 409:
          errorType = 'CONFLICT';
          break;
        case 429:
          errorType = 'RATE_LIMITED';
          break;
        default:
          errorType = response.status >= 500 ? 'SERVER_ERROR' : 'UNKNOWN';
      }
      
      throw new ApiClientError({
        type: errorType,
        status: response.status,
        message: errorBody?.error || errorBody?.message || `Request failed with status ${response.status}`,
        requestId,
        details: errorBody,
      });
    }
    
    return response;
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Handle abort (timeout)
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiClientError({
        type: 'TIMEOUT',
        status: 0,
        message: `Request timed out after ${timeout}ms`,
        requestId,
      });
    }
    
    // Handle network errors
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      throw new ApiClientError({
        type: 'NETWORK_ERROR',
        status: 0,
        message: 'Network error - please check your connection',
        requestId,
      });
    }
    
    // Re-throw ApiClientError as-is
    if (error instanceof ApiClientError) {
      throw error;
    }
    
    // Unknown error
    throw new ApiClientError({
      type: 'UNKNOWN',
      status: 0,
      message: error instanceof Error ? error.message : 'Unknown error',
      requestId,
    });
  }
};

/**
 * Typed API client methods
 */
export const apiClient = {
  /**
   * Make a GET request
   */
  async get<T = any>(
    path: string,
    params?: Record<string, string>,
    options?: { timeout?: number }
  ): Promise<T> {
    const url = new URL(path, BASE);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, value);
        }
      });
    }
    
    const response = await fetchWithAuth(url.toString(), { method: 'GET' }, options);
    return response.json();
  },
  
  /**
   * Make a POST request
   */
  async post<T = any>(
    path: string,
    body?: any,
    options?: { timeout?: number }
  ): Promise<T> {
    const url = new URL(path, BASE);
    
    const response = await fetchWithAuth(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }, options);
    
    return response.json();
  },
  
  /**
   * Make a PATCH request
   */
  async patch<T = any>(
    path: string,
    body?: any,
    options?: { timeout?: number }
  ): Promise<T> {
    const url = new URL(path, BASE);
    
    const response = await fetchWithAuth(url.toString(), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }, options);
    
    return response.json();
  },
  
  /**
   * Make a DELETE request
   */
  async delete<T = any>(
    path: string,
    options?: { timeout?: number }
  ): Promise<T> {
    const url = new URL(path, BASE);
    
    const response = await fetchWithAuth(url.toString(), { method: 'DELETE' }, options);
    return response.json();
  },
  
  /**
   * Get the base URL
   */
  getBaseUrl: () => BASE,
  
  /**
   * Refresh access token (exposed for manual use)
   */
  refreshToken: refreshAccessToken,
  
  /**
   * Check if user is authenticated
   */
  isAuthenticated: () => !!getAccessToken(),
  
  /**
   * Clear authentication state
   */
  clearAuth: () => {
    setAccessToken(null);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    try { window.sessionStorage.removeItem(REFRESH_TOKEN_KEY); } catch { /* ignore */ }
  },
};

export default apiClient;
