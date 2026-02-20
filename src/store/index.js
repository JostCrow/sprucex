
import { createDeepReactiveProxy } from "../reactivity/index.js";

export const globalStores = Object.create(null);
export const storeSubscribers = Object.create(null);

export function getStore(name) {
  return globalStores[name];
}

export function initStore(name, value, options = {}) {
  if (!globalStores[name]) {
    let raw = value || {};

    if (options.persist) {
      try {
        const stored = localStorage.getItem(`sprucex-store-${name}`);
        if (stored) {
          Object.assign(raw, JSON.parse(stored));
        }
      } catch (e) {
        console.error(`SpruceX store "${name}" load error:`, e);
      }
    }

    const subscribers = new Set();
    storeSubscribers[name] = subscribers;

    const notify = () => {
      if (options.persist) {
        try {
          localStorage.setItem(
            `sprucex-store-${name}`,
            JSON.stringify(globalStores[name])
          );
        } catch (e) {
          console.error(`SpruceX store "${name}" save error:`, e);
        }
      }
      subscribers.forEach(comp => comp.scheduleUpdate());
    };

    globalStores[name] = createDeepReactiveProxy(raw, notify);
  }
  return globalStores[name];
}
