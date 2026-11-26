// Auto-animate support (SSR-safe)
let autoAnimate = null;
let autoAnimateLoaded = false;

export function getAutoAnimate() {
  if (autoAnimateLoaded) return autoAnimate;
  if (typeof window === "undefined") return null;
  autoAnimateLoaded = true;

  if (window.autoAnimate) {
    autoAnimate = window.autoAnimate;
  } else if (window.AutoAnimate?.default) {
    autoAnimate = window.AutoAnimate.default;
  }

  return autoAnimate;
}

export function setAutoAnimate(lib) {
  autoAnimate = lib;
  autoAnimateLoaded = true;
}
