import {
  FOCUS_PLAYLIST_CACHE_VERSION,
  type FocusPlaylistCache,
  type FocusPlaylistItem,
} from "./focus-playlists";

const DATABASE_NAME = "inspirations-farm-focus";
const DATABASE_VERSION = 1;
const STORE_NAME = "focus-playlists";
export const FOCUS_PLAYLIST_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

function isPlaylistId(value: unknown): value is string {
  return typeof value === "string"
    && /^bilibili:ugc-season:[1-9][0-9]{0,19}$/.test(value);
}

function parseItem(value: unknown): FocusPlaylistItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<FocusPlaylistItem>;
  if (
    typeof item.bvid !== "string"
    || !/^BV[0-9A-Za-z]{10}$/.test(item.bvid)
    || !(item.cid === null || (typeof item.cid === "string" && /^[1-9][0-9]{0,19}$/.test(item.cid)))
    || typeof item.sourceIndex !== "number"
    || !Number.isSafeInteger(item.sourceIndex)
    || item.sourceIndex < 0
    || typeof item.title !== "string"
    || item.title.length === 0
    || item.title.length > 500
    || typeof item.duration !== "number"
    || !Number.isSafeInteger(item.duration)
    || item.duration < 0
    || item.duration > 604_800
  ) {
    return null;
  }
  return item as FocusPlaylistItem;
}

export function parseFocusPlaylistCache(value: unknown): FocusPlaylistCache | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cache = value as Partial<FocusPlaylistCache>;
  if (
    !isPlaylistId(cache.id)
    || cache.schemaVersion !== FOCUS_PLAYLIST_CACHE_VERSION
    || typeof cache.fetchedAt !== "string"
    || !Number.isFinite(Date.parse(cache.fetchedAt))
    || typeof cache.total !== "number"
    || !Number.isSafeInteger(cache.total)
    || cache.total < 0
    || cache.total > 2_000
    || !Array.isArray(cache.items)
    || cache.items.length !== cache.total
  ) {
    return null;
  }
  const items = cache.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  const typedItems = items as FocusPlaylistItem[];
  if (new Set(typedItems.map((item) => item.sourceIndex)).size !== typedItems.length) {
    return null;
  }
  return {
    id: cache.id,
    schemaVersion: FOCUS_PLAYLIST_CACHE_VERSION,
    fetchedAt: cache.fetchedAt,
    total: cache.total,
    items: typedItems,
  };
}

export function createFocusPlaylistCache(
  id: string,
  items: FocusPlaylistItem[],
  fetchedAt = new Date().toISOString()
): FocusPlaylistCache {
  const cache = parseFocusPlaylistCache({
    id,
    schemaVersion: FOCUS_PLAYLIST_CACHE_VERSION,
    fetchedAt,
    total: items.length,
    items,
  });
  if (!cache) throw new TypeError("Cannot cache invalid focus playlist items");
  return cache;
}

export function isFocusPlaylistCacheFresh(
  cache: FocusPlaylistCache,
  now = Date.now()
): boolean {
  const fetchedAt = Date.parse(cache.fetchedAt);
  return Number.isFinite(fetchedAt)
    && Number.isFinite(now)
    && now >= fetchedAt
    && now - fetchedAt < FOCUS_PLAYLIST_CACHE_MAX_AGE_MS;
}

function getIndexedDb(): IDBFactory | null {
  return typeof indexedDB === "undefined" ? null : indexedDB;
}

function openDatabase(): Promise<IDBDatabase | null> {
  const factory = getIndexedDb();
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open focus cache"));
    request.onblocked = () => reject(new Error("Focus cache upgrade was blocked"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Focus cache transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Focus cache transaction aborted"));
  });
}

export async function readFocusPlaylistCache(id: string): Promise<FocusPlaylistCache | null> {
  if (!isPlaylistId(id)) return null;
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completed = transactionComplete(transaction);
    const request = transaction.objectStore(STORE_NAME).get(id);
    const value = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to read focus cache"));
    });
    await completed;
    return parseFocusPlaylistCache(value);
  } finally {
    database.close();
  }
}

export async function writeFocusPlaylistCache(
  id: string,
  items: FocusPlaylistItem[],
  fetchedAt = new Date().toISOString()
): Promise<boolean> {
  const cache = createFocusPlaylistCache(id, items, fetchedAt);
  const database = await openDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(cache);
    await transactionComplete(transaction);
    return true;
  } finally {
    database.close();
  }
}

export async function deleteFocusPlaylistCache(id: string): Promise<boolean> {
  if (!isPlaylistId(id)) return false;
  const database = await openDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    await transactionComplete(transaction);
    return true;
  } finally {
    database.close();
  }
}
