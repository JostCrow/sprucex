import { createDeepReactiveProxy, toRaw } from "../reactivity/index.js";

export const globalStores = Object.create(null);
export const storeSubscribers = Object.create(null);
const storeCleanups = Object.create(null);

export function getStore(name) {
  return globalStores[name];
}

export function initStore(name, value, options = {}) {
  if (!globalStores[name]) {
    let raw = value || {};
    const storageKey = `sprucex-store-${name}`;
    let persistQueued = false;
    let applyingExternalSync = false;

    if (options.persist && typeof localStorage !== "undefined") {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          Object.assign(raw, JSON.parse(stored));
        }
      } catch (e) {
        console.error(`SpruceX store "${name}" load error:`, e);
      }
    }

    const subscribers = new Set();
    storeSubscribers[name] = subscribers;

    const flushPersist = () => {
      persistQueued = false;
      if (!globalStores[name] || typeof localStorage === "undefined") return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(toRaw(globalStores[name])));
      } catch (e) {
        console.error(`SpruceX store "${name}" save error:`, e);
      }
    };

    const notify = () => {
      if (options.persist && !applyingExternalSync && !persistQueued) {
        persistQueued = true;
        queueMicrotask(flushPersist);
      }
      subscribers.forEach((comp) => {
        if (!comp.isDestroyed) comp.scheduleUpdate();
      });
    };

    globalStores[name] = createDeepReactiveProxy(raw, notify);

    const cleanups = [];
    if (options.persist && options.syncTabs && typeof window !== "undefined") {
      const onStorage = (ev) => {
        if (ev.key !== storageKey || ev.newValue == null || !globalStores[name]) return;
        try {
          const parsed = JSON.parse(ev.newValue);
          if (parsed && typeof parsed === "object") {
            applyingExternalSync = true;
            try {
              Object.assign(globalStores[name], parsed);
            } finally {
              applyingExternalSync = false;
            }
          }
        } catch (e) {
          console.error(`SpruceX store "${name}" sync error:`, e);
        }
      };
      window.addEventListener("storage", onStorage);
      cleanups.push(() => window.removeEventListener("storage", onStorage));
    }

    storeCleanups[name] = cleanups;
  }
  return globalStores[name];
}

export function removeStore(name) {
  if (!globalStores[name]) return;

  const cleanups = storeCleanups[name];
  if (cleanups) {
    cleanups.forEach((fn) => fn());
    delete storeCleanups[name];
  }

  const subscribers = storeSubscribers[name];
  if (subscribers) {
    subscribers.forEach((comp) => {
      if (!comp.isDestroyed) comp.scheduleUpdate();
    });
  }

  delete globalStores[name];
  delete storeSubscribers[name];
}
