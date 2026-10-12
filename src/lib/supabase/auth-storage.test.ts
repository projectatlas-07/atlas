import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthStorageBoundary } from "./auth-storage.ts";

test("same configured SDK adapter/key supplies the storage fence without a second persisted session", () => {
  const boundary = createAuthStorageBoundary("synthetic-auth-storage");
  assert.equal(boundary.readSession(), null);
  boundary.storage.setItem(boundary.key, "synthetic-value"); assert.equal(boundary.readSession(), "synthetic-value");
  boundary.storage.removeItem(boundary.key); assert.equal(boundary.readSession(), null);
});
test("browser adapter observes external changes; denied storage uses SDK memory fallback but never authorizes", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const data = new Map<string, string>(); let fail = false;
  const callbacks = new Set<(event: StorageEvent) => void>();
  const backing = { getItem(name: string) { if (fail) throw new Error("Synthetic blocked storage"); return data.get(name) ?? null; },
    setItem(name: string, value: string) { if (fail) throw new Error("Synthetic blocked storage"); data.set(name, value); }, removeItem(name: string) { data.delete(name); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: backing,
    addEventListener(_event: string, callback: (event: StorageEvent) => void) { callbacks.add(callback); },
    removeEventListener(_event: string, callback: (event: StorageEvent) => void) { callbacks.delete(callback); } } });
  try {
    const boundary = createAuthStorageBoundary("synthetic-auth-storage"); let changes = 0;
    const stop = boundary.subscribe(() => { changes++; }); boundary.storage.setItem(boundary.key, "synthetic-value");
    assert.equal(data.size, 1); assert.equal(boundary.readSession(), "synthetic-value");
    callbacks.forEach((callback) => callback({ key: boundary.key, storageArea: backing } as unknown as StorageEvent)); assert.equal(changes, 1);
    callbacks.forEach((callback) => callback({ key: "unrelated", storageArea: backing } as unknown as StorageEvent)); assert.equal(changes, 1);
    fail = true; assert.equal(boundary.readSession(), undefined);
    boundary.storage.setItem(boundary.key, "synthetic-memory-fallback"); assert.equal(boundary.storage.getItem(boundary.key), "synthetic-memory-fallback");
    assert.equal(boundary.readSession(), undefined); stop(); assert.equal(callbacks.size, 0);
  } finally { if (original) Object.defineProperty(globalThis, "window", original); else Reflect.deleteProperty(globalThis, "window"); }
});
