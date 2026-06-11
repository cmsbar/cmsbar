// Tiny IndexedDB wrapper just for persisting CMS upload File blobs across
// page reloads. Keyed by branch name so each editing session has its own slot.

import { UPLOAD_DB_NAME } from "./keys";

const DB_NAME = UPLOAD_DB_NAME;
const DB_VERSION = 1;
const STORE = "uploads";

type Row = {
  // composite key: `${branch}::${repoPath}`
  id: string;
  branch: string;
  repoPath: string;
  file: File;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("by_branch", "branch", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function key(branch: string, repoPath: string): string {
  return `${branch}::${repoPath}`;
}

export async function putUpload(
  branch: string,
  repoPath: string,
  file: File,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      id: key(branch, repoPath),
      branch,
      repoPath,
      file,
    } satisfies Row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listUploads(
  branch: string,
): Promise<{ repoPath: string; file: File }[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await open();
  const result = await new Promise<Row[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).index("by_branch").getAll(branch);
    req.onsuccess = () => resolve(req.result as Row[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result.map((r) => ({ repoPath: r.repoPath, file: r.file }));
}

export async function deleteUpload(
  branch: string,
  repoPath: string,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key(branch, repoPath));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearBranch(branch: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.index("by_branch").openCursor(branch);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
