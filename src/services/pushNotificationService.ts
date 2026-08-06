// Browser push notification service for ConfluenceX.
// Handles permission requests, push subscription, and subscription sync with the backend.

import { bwtsApi } from './bwtsApi';

const VAPID_PUBLIC_KEY = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY || '';

export interface PushSubscriptionStatus {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  subscription: PushSubscription | null;
}

/**
 * Convert a base64 VAPID public key to the Uint8Array format required by
 * PushManager.subscribe().
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Check whether the browser supports push notifications at all.
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Get the current push notification status without prompting the user.
 */
export async function getPushStatus(): Promise<PushSubscriptionStatus> {
  if (!isPushSupported()) {
    return { supported: false, permission: 'denied', subscribed: false, subscription: null };
  }

  const permission = Notification.permission;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return {
      supported: true,
      permission,
      subscribed: subscription !== null,
      subscription,
    };
  } catch {
    return { supported: true, permission, subscribed: false, subscription: null };
  }
}

/**
 * Request notification permission from the user and subscribe to push.
 * Returns the PushSubscription if successful, null otherwise.
 */
export async function requestPushPermissionAndSubscribe(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    console.warn('[Push] Push notifications are not supported in this browser.');
    return null;
  }

  if (!VAPID_PUBLIC_KEY) {
    console.warn('[Push] VITE_VAPID_PUBLIC_KEY is not configured. Cannot subscribe.');
    return null;
  }

  // Request permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.log('[Push] Permission denied by user.');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Create new subscription
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    // Sync with backend
    await syncSubscriptionToBackend(subscription);

    return subscription;
  } catch (err) {
    console.error('[Push] Failed to subscribe:', err);
    return null;
  }
}

/**
 * Unsubscribe from push notifications and remove from backend.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      await removeSubscriptionFromBackend(subscription);
      await subscription.unsubscribe();
    }

    return true;
  } catch (err) {
    console.error('[Push] Failed to unsubscribe:', err);
    return false;
  }
}

/**
 * Sync a PushSubscription to the backend so the server can send pushes.
 */
async function syncSubscriptionToBackend(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const payload = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || '',
    },
    expiration_time: subscription.expirationTime ?? null,
  };

  try {
    await bwtsApi.savePushSubscription(payload);
  } catch (err) {
    console.error('[Push] Failed to sync subscription to backend:', err);
  }
}

/**
 * Remove a PushSubscription from the backend.
 */
async function removeSubscriptionFromBackend(subscription: PushSubscription): Promise<void> {
  try {
    await bwtsApi.removePushSubscription(subscription.endpoint);
  } catch (err) {
    console.error('[Push] Failed to remove subscription from backend:', err);
  }
}

/**
 * Re-sync an existing subscription with the backend (e.g. on app load).
 * Useful if the backend was redeployed or subscription data was lost.
 */
export async function resyncExistingSubscription(): Promise<void> {
  if (!isPushSupported()) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await syncSubscriptionToBackend(subscription);
    }
  } catch {
    // silent — this is a best-effort background sync
  }
}
