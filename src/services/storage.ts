/**
 * Tiny AsyncStorage wrapper used by the saved-events / reports / onboarding
 * stores. Loaded lazily via require() so a missing native module degrades to
 * an in-memory map rather than crashing — same defensive pattern as
 * services/notifications.ts.
 */

let _Storage: any = null;
let _probed = false;

// In-memory fallback so the app still behaves within a session even if
// AsyncStorage isn't installed in this build.
const memory = new Map<string, string>();

const getStorage = (): any => {
  if (_probed) return _Storage || null;
  _probed = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _Storage = require('@react-native-async-storage/async-storage').default;
  } catch {
    _Storage = null;
  }
  return _Storage;
};

export async function getItem(key: string): Promise<string | null> {
  const s = getStorage();
  if (!s) return memory.has(key) ? memory.get(key)! : null;
  try {
    return (await s.getItem(key)) as string | null;
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  memory.set(key, value);
  const s = getStorage();
  if (!s) return;
  try {
    await s.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export async function removeItem(key: string): Promise<void> {
  memory.delete(key);
  const s = getStorage();
  if (!s) return;
  try {
    await s.removeItem(key);
  } catch {
    /* ignore */
  }
}

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setJSON(key: string, value: unknown): Promise<void> {
  await setItem(key, JSON.stringify(value));
}
