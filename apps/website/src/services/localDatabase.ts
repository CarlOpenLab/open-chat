const DB_NAME = "open-chat";
const DB_VERSION = 1;
const STORE_NAME = "app-state";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest,
): Promise<T | undefined> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = callback(transaction.objectStore(STORE_NAME));

    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      db.close();
    };
  });
}

export async function readLocalValue<T>(key: string): Promise<T | undefined> {
  return withStore<T>("readonly", (store) => store.get(key));
}

export async function writeLocalValue<T>(key: string, value: T): Promise<void> {
  const plainValue = JSON.parse(JSON.stringify(value)) as T;
  await withStore<void>("readwrite", (store) => store.put(plainValue, key));
}

export async function deleteLocalValue(key: string): Promise<void> {
  await withStore<void>("readwrite", (store) => store.delete(key));
}
