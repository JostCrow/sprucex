
import { ATTR_DATA } from "../constants.js";

// ========== Feature 3 & 4: Morphing & ID Mapping ==========
export function morphNodes(target, source) {
  // First, handle ID mapping (Feature 4)
  const sourceIds = new Map();
  source.querySelectorAll("[id]").forEach(el => {
    sourceIds.set(el.id, el);
  });

  // Update elements with matching IDs in place
  sourceIds.forEach((sourceEl, id) => {
    // Escape ID for selector
    const targetEl = target.querySelector(`#${CSS.escape(id)}`);
    if (targetEl) {
      morphElement(targetEl, sourceEl);
      // Mark as processed
      sourceEl.__morphed = true;
    }
  });

  // For the rest, do a smart merge (Feature 3)
  morphChildren(target, source);
}

export function morphElement(target, source) {
  // Don't morph if same element
  if (target === source) return;
  if (target.isEqualNode(source)) return;

  // Different tag - must replace
  if (target.tagName !== source.tagName) {
    target.replaceWith(source.cloneNode(true));
    return;
  }

  // Sync attributes
  syncAttributes(target, source);

  // Handle special elements
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
    // Morph options then set value
    morphChildren(target, source);
    if (target.value !== source.value) {
      target.value = source.value;
    }
    return;
  }

  // Skip morphing for elements marked to preserve
  if (target.hasAttribute("sx-preserve")) return;

  // Morph children
  morphChildren(target, source);
}

export function morphChildren(target, source) {
  const targetChildren = Array.from(target.childNodes);
  const sourceChildren = Array.from(source.childNodes);

  // Build a map of keyed target elements
  const targetKeyedMap = new Map();
  const targetIdMap = new Map();

  targetChildren.forEach((child, i) => {
    if (child.nodeType === 1) {
      const key = child.getAttribute?.("sx-key") || child.getAttribute?.("key");
      if (key) targetKeyedMap.set(key, { el: child, index: i });
      const id = child.id;
      if (id) targetIdMap.set(id, { el: child, index: i });
    }
  });

  let targetIndex = 0;

  for (let i = 0; i < sourceChildren.length; i++) {
    const sourceChild = sourceChildren[i];

    // Text/comment nodes
    if (sourceChild.nodeType === 3 || sourceChild.nodeType === 8) {
      const targetChild = targetChildren[targetIndex];
      if (targetChild && targetChild.nodeType === sourceChild.nodeType) {
        if (targetChild.nodeValue !== sourceChild.nodeValue) {
          targetChild.nodeValue = sourceChild.nodeValue;
        }
        targetIndex++;
      } else {
        // Insert new text node
        const clone = sourceChild.cloneNode(true);
        if (targetChild) {
          target.insertBefore(clone, targetChild);
        } else {
          target.appendChild(clone);
        }
      }
      continue;
    }

    // Element nodes
    if (sourceChild.nodeType === 1) {
      // Skip if already morphed via ID mapping
      if (sourceChild.__morphed) {
        delete sourceChild.__morphed;
        targetIndex++;
        continue;
      }

      const sourceKey = sourceChild.getAttribute?.("sx-key") || sourceChild.getAttribute?.("key");
      const sourceId = sourceChild.id;

      let matchedTarget = null;

      // Try to find by key first
      if (sourceKey && targetKeyedMap.has(sourceKey)) {
        matchedTarget = targetKeyedMap.get(sourceKey).el;
        targetKeyedMap.delete(sourceKey);
      }
      // Then by ID
      else if (sourceId && targetIdMap.has(sourceId)) {
        matchedTarget = targetIdMap.get(sourceId).el;
        targetIdMap.delete(sourceId);
      }
      // Then by position + tag match
      else {
        const targetChild = targetChildren[targetIndex];
        if (targetChild?.nodeType === 1 && targetChild.tagName === sourceChild.tagName) {
          // Check it's not keyed
          const targetKey = targetChild.getAttribute?.("sx-key") || targetChild.getAttribute?.("key");
          if (!targetKey) {
            matchedTarget = targetChild;
          }
        }
      }

      if (matchedTarget) {
        // Morph the matched element
        morphElement(matchedTarget, sourceChild);

        // Move if needed
        const currentIndex = Array.from(target.childNodes).indexOf(matchedTarget);
        const desiredIndex = i;
        if (currentIndex !== desiredIndex && currentIndex !== -1) {
          const refNode = target.childNodes[desiredIndex];
          if (refNode && refNode !== matchedTarget) {
            target.insertBefore(matchedTarget, refNode);
          }
        }
        targetIndex++;
      } else {
        // Insert new element
        const clone = sourceChild.cloneNode(true);
        const refNode = targetChildren[targetIndex];
        if (refNode) {
          target.insertBefore(clone, refNode);
        } else {
          target.appendChild(clone);
        }
      }
    }
  }

  // Remove extra target children
  while (target.childNodes.length > sourceChildren.length) {
    const extra = target.childNodes[sourceChildren.length];
    if (extra) {
      // Destroy any SpruceX components
      if (extra.__sprucex) extra.__sprucex.destroy();
      if (extra.nodeType === 1) {
        extra.querySelectorAll?.(`[${ATTR_DATA}]`).forEach(el => {
          if (el.__sprucex) el.__sprucex.destroy();
        });
      }
      extra.remove();
    }
  }
}

function syncAttributes(target, source) {
  // Remove old attributes
  const targetAttrs = Array.from(target.attributes);
  for (const attr of targetAttrs) {
    if (!source.hasAttribute(attr.name)) {
      target.removeAttribute(attr.name);
    }
  }

  // Set new/changed attributes
  const sourceAttrs = Array.from(source.attributes);
  for (const attr of sourceAttrs) {
    if (target.getAttribute(attr.name) !== attr.value) {
      target.setAttribute(attr.name, attr.value);
    }
  }
}
