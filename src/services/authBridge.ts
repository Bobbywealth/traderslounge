// Shared access token store. Both bwtsApi and billingApi use this so the
// JWT refresh is consistent across both clients.

const listeners = new Set<(token: string | null) => void>();
let current: string | null = null;

export function getAccessToken(): string | null {
  return current;
}

export function setAccessToken(token: string | null) {
  current = token;
  for (const listener of listeners) {
    try { listener(token); } catch { /* ignore */ }
  }
}

export function onAccessTokenChange(listener: (token: string | null) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
