
// Auto-animate support
let autoAnimate = null;
let autoAnimateLoaded = false;

// Try to detect auto-animate library
export function getAutoAnimate() {
  if (autoAnimateLoaded) return autoAnimate;
  autoAnimateLoaded = true;

  // Check various ways the library might be available
  if (window.autoAnimate) {
    autoAnimate = window.autoAnimate;
  } else if (window.AutoAnimate?.default) {
    autoAnimate = window.AutoAnimate.default;
  }

  return autoAnimate;
}

export function setAutoAnimate(lib) {
  // Allow manually setting the auto-animate library
  autoAnimate = lib;
  autoAnimateLoaded = true;
}
