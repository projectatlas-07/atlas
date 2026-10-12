// The SDK and the deny-only ownership fence use this same supported adapter.
// No second copy of Auth credentials is persisted. Unreadable browser storage
// may use SDK memory fallback, but cannot establish protected-request ownership.
export function createAuthStorageBoundary(key: string) {
  const memory = new Map<string, string>();
  let backing: Storage | null = null;
  let readable = typeof window === "undefined";
  if (typeof window !== "undefined") {
    try {
      backing = window.localStorage;
      backing.getItem(key);
      readable = true;
    } catch { readable = false; }
  }
  const storage = {
    getItem(name: string) {
      try { if (backing) return backing.getItem(name); } catch { backing = null; readable = false; }
      return memory.get(name) ?? null;
    },
    setItem(name: string, value: string) {
      try { if (backing) { backing.setItem(name, value); return; } } catch { backing = null; readable = false; }
      memory.set(name, value);
    },
    removeItem(name: string) {
      try { if (backing) { backing.removeItem(name); return; } } catch { backing = null; readable = false; }
      memory.delete(name);
    },
  };
  return {
    key, storage,
    readSession(): string | null | undefined {
      if (!readable) return undefined;
      const value = storage.getItem(key);
      return readable ? value : undefined;
    },
    subscribe(listener: () => void) {
      if (typeof window === "undefined") return () => {};
      const onStorage = (event: StorageEvent) => {
        if ((event.key === key || event.key === null) && event.storageArea === backing) listener();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
  };
}
