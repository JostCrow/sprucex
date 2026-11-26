import { ATTR_DATA } from "../constants.js";

// ========== Morphing & ID Mapping ==========
export function morphNodes(target, source) {
  const morphedIds = new Set();
  const sourceIds = new Map();
  source.querySelectorAll("[id]").forEach((el) => {
    sourceIds.set(el.id, el);
  });

  // Update elements with matching IDs in place
  sourceIds.forEach((sourceEl, id) => {
    const targetEl = target.querySelector(`#${CSS.escape(id)}`);
    if (targetEl) {
      morphElement(targetEl, sourceEl);
      morphedIds.add(id);
    }
  });

  morphChildren(target, source, morphedIds);
}

export function morphElement(target, source) {
  if (target === source) return;
  if (target.isEqualNode(source)) return;

  if (target.tagName !== source.tagName) {
    target.replaceWith(source.cloneNode(true));
    return;
  }

  // Skip morphing for elements marked to preserve.
  if (target.hasAttribute("sx-preserve")) return;

  syncAttributes(target, source);

  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
    if (target.value !== source.value) {
      target.value = source.value;
    }
    if (target.checked !== source.checked) {
      target.checked = source.checked;
    }
    return;
  }

  if (target.tagName === "SELECT") {
    morphChildren(target, source, new Set());
    if (target.value !== source.value) {
      target.value = source.value;
    }
    return;
  }

  morphChildren(target, source, new Set());
}

export function morphChildren(target, source, morphedIds) {
  const sourceChildren = Array.from(source.childNodes);

  // Index existing keyed and ID-bearing target children in O(n).
  const targetKeyedMap = new Map();
  const targetIdMap = new Map();
  for (let child = target.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) {
      const key = child.getAttribute?.("sx-key") || child.getAttribute?.("key");
      if (key) targetKeyedMap.set(key, child);
      const id = child.id;
      if (id) targetIdMap.set(id, child);
    }
  }

  // O(n) cursor-based reconciliation: cursor always points to the next expected child.
  let cursor = target.firstChild;

  for (let i = 0; i < sourceChildren.length; i++) {
    const sourceChild = sourceChildren[i];

    // Text / comment nodes
    if (sourceChild.nodeType === 3 || sourceChild.nodeType === 8) {
      if (cursor && cursor.nodeType === sourceChild.nodeType) {
        if (cursor.nodeValue !== sourceChild.nodeValue) {
          cursor.nodeValue = sourceChild.nodeValue;
        }
        cursor = cursor.nextSibling;
      } else {
        const clone = sourceChild.cloneNode(true);
        target.insertBefore(clone, cursor);
      }
      continue;
    }

    // Element nodes
    if (sourceChild.nodeType === 1) {
      const sourceId = sourceChild.id;
      if (sourceId && morphedIds.has(sourceId)) {
        const existingById = targetIdMap.get(sourceId);
        if (existingById && existingById.parentNode === target) {
          targetIdMap.delete(sourceId);
          if (existingById === cursor) {
            cursor = cursor.nextSibling;
          } else {
            target.insertBefore(existingById, cursor);
          }
        } else if (cursor) {
          cursor = cursor.nextSibling;
        }
        continue;
      }

      const sourceKey =
        sourceChild.getAttribute?.("sx-key") || sourceChild.getAttribute?.("key");

      let matchedTarget = null;

      if (sourceKey && targetKeyedMap.has(sourceKey)) {
        matchedTarget = targetKeyedMap.get(sourceKey);
        targetKeyedMap.delete(sourceKey);
      } else if (sourceId && targetIdMap.has(sourceId)) {
        matchedTarget = targetIdMap.get(sourceId);
        targetIdMap.delete(sourceId);
      } else if (cursor?.nodeType === 1 && cursor.tagName === sourceChild.tagName) {
        const targetKey =
          cursor.getAttribute?.("sx-key") || cursor.getAttribute?.("key");
        if (!targetKey) {
          matchedTarget = cursor;
        }
      }

      if (matchedTarget) {
        const wasCursor = matchedTarget === cursor;
        const nextAfterCursor = wasCursor ? cursor.nextSibling : cursor;
        morphElement(matchedTarget, sourceChild);

        if (wasCursor) {
          cursor = matchedTarget.parentNode === target ? matchedTarget.nextSibling : nextAfterCursor;
        } else if (matchedTarget.parentNode === target) {
          target.insertBefore(matchedTarget, cursor);
        }
      } else {
        const clone = sourceChild.cloneNode(true);
        target.insertBefore(clone, cursor);
      }
    }
  }

  // Remove any trailing excess target children after cursor.
  while (cursor) {
    const extra = cursor;
    cursor = cursor.nextSibling;
    if (extra.__sprucex) extra.__sprucex.destroy();
    if (extra.nodeType === 1) {
      extra.querySelectorAll?.(`[${ATTR_DATA}]`).forEach((el) => {
        if (el.__sprucex) el.__sprucex.destroy();
      });
    }
    extra.remove();
  }
}

function syncAttributes(target, source) {
  const targetAttrs = Array.from(target.attributes);
  for (const attr of targetAttrs) {
    if (!source.hasAttribute(attr.name)) {
      target.removeAttribute(attr.name);
    }
  }

  const sourceAttrs = Array.from(source.attributes);
  for (const attr of sourceAttrs) {
    if (target.getAttribute(attr.name) !== attr.value) {
      target.setAttribute(attr.name, attr.value);
    }
  }
}
