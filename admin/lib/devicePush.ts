import { mysqlAdmin } from './mysqlapi';

// «الإشعارات … مش بيوصل موبايل الموظف غير لو فاتح اللوحة». This device's
// notifications, from the bell: the browser asks once, the panel's service
// worker (public/sw-push.js) shows them, and the server sends each one to the
// phones of the people it is for (api/lib/staffPush.js).

export type DevicePushState = 'enabled' | 'off' | 'denied' | 'unsupported' | 'unavailable';

const supported = () => typeof window !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

export async function devicePushState(): Promise<DevicePushState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.getRegistration('/sw-push.js').catch(() => undefined);
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  return subscription && Notification.permission === 'granted' ? 'enabled' : 'off';
}

export async function enableDevicePush(): Promise<DevicePushState> {
  if (!supported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const { publicKey } = await mysqlAdmin.adminGet<{ publicKey: string | null }>('/push/vapid-public-key');
  if (!publicKey) return 'unavailable';
  const registration = await navigator.serviceWorker.register('/sw-push.js');
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription()
    || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
  await mysqlAdmin.adminPost('/push/subscribe', { subscription: subscription.toJSON() });
  return 'enabled';
}
