
export const walk = (el, cb) => {
  if (cb(el) === false) return;
  let child = el.firstElementChild;
  while (child) {
    const next = child.nextElementSibling;
    walk(child, cb);
    child = next;
  }
};
