import { ATTR_DATA, ATTR_LAZY } from "../constants.js";
import { cloneChildren } from "../utils/helpers.js";
import { safeEval } from "../utils/eval.js";
import { effect } from "../reactivity/index.js";

function getActiveSelection() {
  if (typeof document === "undefined") return { focusedEl: null, selection: null };
  const focusedEl = document.activeElement;
  const selection =
    focusedEl && typeof focusedEl.selectionStart === "number"
      ? [focusedEl.selectionStart, focusedEl.selectionEnd, focusedEl.selectionDirection]
      : null;
  return { focusedEl, selection };
}

function restoreActiveSelection(root, focusedEl, selection) {
  if (typeof document === "undefined") return;
  if (
    focusedEl?.isConnected &&
    root.contains(focusedEl) &&
    document.activeElement !== focusedEl
  ) {
    focusedEl.focus({ preventScroll: true });
    if (selection) {
      try {
        focusedEl.setSelectionRange(...selection);
      } catch {
        // Ignore non-selectable input types (e.g. number/email)
      }
    }
  }
}

export function isBlockDetached(block) {
  if (!block) return true;
  const { parent, marker } = block;
  if (!parent || !marker) return true;
  if (!parent.isConnected || !marker.isConnected) return true;
  if (marker.parentNode !== parent) return true;
  return false;
}

export function mountNestedDataComponents(component, inst) {
  if (!inst?.elements || !inst.bindings) return;
  inst.bindings.nestedDataComponents = inst.bindings.nestedDataComponents || [];

  const nestedRoots = [];
  inst.elements.forEach((node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.hasAttribute(ATTR_DATA)) nestedRoots.push(node);
    node.querySelectorAll?.(`[${ATTR_DATA}]`).forEach((el) => nestedRoots.push(el));
  });

  const ComponentClass = component.constructor;
  nestedRoots.forEach((root) => {
    if (root.__sprucex) return;
    const mountRoot = () => {
      if (!root.isConnected || root.__sprucex) return;
      const nested = new ComponentClass(root, {
        parentComponent: component,
        locals: inst.scopeLocals,
      });
      root.__sprucex = nested;
      inst.bindings.nestedDataComponents.push(nested);
    };

    if (root.hasAttribute(ATTR_LAZY) && typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect();
            mountRoot();
            break;
          }
        }
      });
      io.observe(root);
      inst.bindings.lazyObservers = inst.bindings.lazyObservers || [];
      inst.bindings.lazyObservers.push(io);
    } else {
      mountRoot();
    }
  });
}

export function disposeInstance(component, inst) {
  if (!inst) return;
  component.cleanupInstanceBindings(inst.bindings);
  if (inst.elements) {
    inst.elements.forEach((el) => el.remove());
  } else if (inst.fragmentRoot) {
    inst.fragmentRoot.remove();
  }
  const scope = component.integrationScopes.get(inst.scopeLocals);
  if (scope) {
    scope.teardownIntegrations();
    component.integrationScopes.delete(inst.scopeLocals);
  }
  component.pruneDetachedBindings(inst.elements || [inst.fragmentRoot]);
  inst.mounted = false;
}

export function markInstanceDirty(component, inst) {
  if (!inst?.bindings) return;
  (inst.bindings.bindings || []).forEach((b) => {
    b.dirty = true;
    component.dirtyBindings.add(b);
  });
  (inst.bindings.modelBindings || []).forEach((m) => {
    m.dirty = true;
    component.dirtyModels.add(m);
  });
  (inst.bindings.elementEffects || []).forEach((e) => {
    component.dirtyEffects.add(e);
  });
  (inst.bindings.directiveInstances || []).forEach((d) => {
    d.effects.forEach((eff) => component.dirtyEffects.add(eff));
  });
  (inst.bindings.nestedForBlocks || []).forEach((b) => {
    b.dirty = true;
    component.dirtyForBlocks.add(b);
  });
  (inst.bindings.nestedIfBlocks || []).forEach((b) => {
    b.dirty = true;
    component.dirtyIfBlocks.add(b);
  });
}

// ========== sx-if ==========

export function createIfBlock(component, el, expr, parent, marker, parentLocals) {
  const block = {
    template: el,
    parent,
    marker,
    expr,
    parentLocals,
    instance: null,
    dirty: true,
    tracked: false,
  };

  const runner = effect(
    () => {
      const prevLocals = component.locals;
      if (block.parentLocals) component.locals = block.parentLocals;
      try {
        return !!safeEval(block.expr, component);
      } finally {
        component.locals = prevLocals;
      }
    },
    {
      lazy: true,
      scheduler() {
        block.dirty = true;
        component.dirtyIfBlocks.add(block);
        component.scheduleUpdate(false);
      },
    },
  );

  block._evalCond = () => {
    const val = runner();
    block.tracked = runner.effect.deps.length > 0;
    return val;
  };
  block.dispose = () => {
    runner.stop();
    component.dirtyIfBlocks.delete(block);
  };

  component.ifBlocks.push(block);
  component.dirtyIfBlocks.add(block);
  return block;
}

export function teardownIfBlock(component, block) {
  if (!block) return;
  block.dispose?.();
  if (block.instance) {
    disposeInstance(component, block.instance);
    block.instance = null;
  }
  const idx = component.ifBlocks.indexOf(block);
  if (idx !== -1) component.ifBlocks.splice(idx, 1);
}

export function teardownDetachedIfBlocks(component) {
  component.ifBlocks.slice().forEach((block) => {
    if (isBlockDetached(block)) {
      teardownIfBlock(component, block);
    }
  });
}

export function teardownAllIfBlocks(component) {
  component.ifBlocks.slice().forEach((block) => {
    teardownIfBlock(component, block);
    if (block.template && block.marker && block.marker.parentNode) {
      block.marker.parentNode.insertBefore(block.template, block.marker);
      block.marker.remove();
    }
  });
  component.ifBlocks = [];
  component.dirtyIfBlocks.clear();
}

export function renderIfBlocks(component, forceAll = true) {
  let structureChanged = false;
  teardownDetachedIfBlocks(component);

  let idx = 0;
  while (idx < component.ifBlocks.length) {
    const block = component.ifBlocks[idx];
    if (!block) {
      idx++;
      continue;
    }
    if (isBlockDetached(block)) {
      teardownIfBlock(component, block);
      structureChanged = true;
      continue;
    }
    if (!forceAll && block.tracked && !block.dirty) {
      idx++;
      continue;
    }

    block.dirty = false;
    component.dirtyIfBlocks.delete(block);
    const shouldShow = block._evalCond();

    if (shouldShow && !block.instance) {
      const frag = block.template.content
        ? block.template.content.cloneNode(true)
        : cloneChildren(block.template);
      const elements = [];
      while (frag.firstChild) {
        const child = frag.firstChild;
        elements.push(child);
        frag.removeChild(child);
      }

      const locals = block.parentLocals || component.locals;
      const instanceBindings = createEmptyInstanceBindings();
      elements.forEach((node) => {
        const scanned = component.scanFragmentBindings(node, locals);
        mergeInstanceBindings(instanceBindings, scanned);
      });

      const inst = {
        scopeLocals: locals,
        elements,
        bindings: instanceBindings,
        mounted: false,
      };

      elements.forEach((node) => {
        block.parent.insertBefore(node, block.marker);
      });
      mountNestedDataComponents(component, inst);
      inst.mounted = true;
      block.instance = inst;
      structureChanged = true;
    } else if (!shouldShow && block.instance) {
      disposeInstance(component, block.instance);
      block.instance = null;
      structureChanged = true;
    }

    idx++;
  }

  return structureChanged;
}

// ========== sx-for ==========

export function createForBlock(component, config) {
  const block = {
    ...config,
    instances: [],
    dirty: true,
    tracked: false,
  };

  const runner = effect(
    () => {
      const prevLocals = component.locals;
      if (block.parentLocals) component.locals = block.parentLocals;
      try {
        const collection = safeEval(block.def.iterable, component) || [];
        return Array.from(collection);
      } finally {
        component.locals = prevLocals;
      }
    },
    {
      lazy: true,
      scheduler() {
        block.dirty = true;
        component.dirtyForBlocks.add(block);
        component.scheduleUpdate(false);
      },
    },
  );

  block._evalArray = () => {
    const arr = runner();
    block.tracked = runner.effect.deps.length > 0;
    return arr;
  };
  block.dispose = () => {
    runner.stop();
    component.dirtyForBlocks.delete(block);
  };

  component.forBlocks.push(block);
  component.dirtyForBlocks.add(block);
  return block;
}

export function teardownForBlock(component, block) {
  if (!block) return;
  block.dispose?.();

  const instances = Array.isArray(block.instances) ? [...block.instances] : [];
  instances.forEach((inst) => {
    disposeInstance(component, inst);
  });

  if (block.instances) block.instances.length = 0;

  const idx = component.forBlocks.indexOf(block);
  if (idx !== -1) component.forBlocks.splice(idx, 1);
}

export function teardownDetachedForBlocks(component) {
  component.forBlocks.slice().forEach((block) => {
    if (isBlockDetached(block)) {
      teardownForBlock(component, block);
    }
  });
}

export function teardownAllForBlocks(component) {
  component.forBlocks.slice().forEach((block) => {
    teardownForBlock(component, block);
    if (block.template && block.marker && block.marker.parentNode) {
      block.marker.parentNode.insertBefore(block.template, block.marker);
      block.marker.remove();
    }
  });
  component.forBlocks = [];
  component.dirtyForBlocks.clear();
}

export function renderForBlocks(component, forceAll = true) {
  let structureChanged = false;
  const { focusedEl, selection } = getActiveSelection();
  teardownDetachedForBlocks(component);

  let blockIndex = 0;
  while (blockIndex < component.forBlocks.length) {
    const block = component.forBlocks[blockIndex];
    if (!block) {
      blockIndex += 1;
      continue;
    }
    if (isBlockDetached(block)) {
      teardownForBlock(component, block);
      structureChanged = true;
      continue;
    }
    if (!forceAll && block.tracked && !block.dirty) {
      blockIndex += 1;
      continue;
    }

    block.dirty = false;
    component.dirtyForBlocks.delete(block);

    const { def, template, parent, marker, instances, parentLocals, keyExpr } = block;
    const arr = block._evalArray();

    const instanceBuckets = new Map();
    instances.forEach((inst) => {
      const key = inst.itemKey;
      if (!instanceBuckets.has(key)) instanceBuckets.set(key, []);
      instanceBuckets.get(key).push(inst);
    });

    const newInstances = [];
    const reusedInstances = new Set();
    const seenKeys = new Set();

    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      const idxName = def.index || "$index";

      const localsForKey = parentLocals ? { ...parentLocals } : {};
      localsForKey[def.item] = item;
      localsForKey[idxName] = i;

      let key = i;
      if (keyExpr) {
        const prevLocalsForKey = component.locals;
        component.locals = localsForKey;
        try {
          key = safeEval(keyExpr, component);
        } finally {
          component.locals = prevLocalsForKey;
        }
        if (key === undefined || key === null) key = i;
      }
      if (seenKeys.has(key)) {
        console.warn(
          "SpruceX sx-for detected a duplicate key. This can cause unstable row reuse.",
          key,
        );
      }
      seenKeys.add(key);

      const bucket = instanceBuckets.get(key);
      const inst = bucket && bucket.length > 0 ? bucket.shift() : null;

      if (inst) {
        let localsChanged =
          !Object.is(inst.scopeLocals[def.item], item) ||
          !Object.is(inst.scopeLocals[idxName], i);

        if (parentLocals) {
          Object.keys(parentLocals).forEach((parentKey) => {
            if (!Object.is(inst.scopeLocals[parentKey], parentLocals[parentKey])) {
              inst.scopeLocals[parentKey] = parentLocals[parentKey];
              localsChanged = true;
            }
          });
        }
        inst.scopeLocals[def.item] = item;
        inst.scopeLocals[idxName] = i;

        if (localsChanged) {
          markInstanceDirty(component, inst);
        }

        (inst.bindings.nestedDataComponents || []).forEach((nestedComp) => {
          Object.assign(nestedComp.locals, inst.scopeLocals);
          if (localsChanged) {
            nestedComp.markAllDirty();
            nestedComp.scheduleUpdate();
          }
        });

        newInstances.push(inst);
        reusedInstances.add(inst);
      } else {
        structureChanged = true;
        const locals = parentLocals ? { ...parentLocals } : {};
        locals[def.item] = item;
        locals[idxName] = i;

        const frag = template.content
          ? template.content.cloneNode(true)
          : cloneChildren(template);

        const elements = [];
        while (frag.firstChild) {
          const child = frag.firstChild;
          elements.push(child);
          frag.removeChild(child);
        }

        const instanceBindings = createEmptyInstanceBindings();
        elements.forEach((el) => {
          const elBindings = component.scanFragmentBindings(el, locals);
          mergeInstanceBindings(instanceBindings, elBindings);
        });

        const newInst = {
          scopeLocals: locals,
          elements,
          bindings: instanceBindings,
          itemKey: key,
          mounted: false,
        };

        newInstances.push(newInst);
      }
    }

    // Pass 2: Remove unused instances immediately
    instances.forEach((inst) => {
      if (!reusedInstances.has(inst)) {
        structureChanged = true;
        disposeInstance(component, inst);
      }
    });

    // Pass 3: Reorder / insert backwards
    let anchor = marker;
    for (let i = newInstances.length - 1; i >= 0; i--) {
      const inst = newInstances[i];

      for (let j = inst.elements.length - 1; j >= 0; j--) {
        const el = inst.elements[j];
        if (el.parentNode !== parent || el.nextSibling !== anchor) {
          parent.insertBefore(el, anchor);
          structureChanged = true;
        }
        anchor = el;
      }

      if (!inst.mounted) {
        mountNestedDataComponents(component, inst);
        inst.mounted = true;
      }
    }

    block.instances.length = 0;
    block.instances.push(...newInstances);
    blockIndex += 1;
  }

  restoreActiveSelection(component.root, focusedEl, selection);
  return structureChanged;
}

export function createEmptyInstanceBindings() {
  return {
    bindings: [],
    memoBindings: [],
    modelBindings: [],
    eventHandlers: [],
    netBindings: [],
    elementEffects: [],
    directiveInstances: [],
    nestedForBlocks: [],
    nestedIfBlocks: [],
    nestedDataComponents: [],
    lazyObservers: [],
  };
}

export function mergeInstanceBindings(target, source) {
  target.bindings.push(...source.bindings);
  target.memoBindings.push(...source.memoBindings);
  target.modelBindings.push(...source.modelBindings);
  target.eventHandlers.push(...source.eventHandlers);
  target.netBindings.push(...source.netBindings);
  if (source.elementEffects) target.elementEffects.push(...source.elementEffects);
  if (source.directiveInstances) {
    target.directiveInstances.push(...source.directiveInstances);
  }
  if (source.nestedForBlocks) target.nestedForBlocks.push(...source.nestedForBlocks);
  if (source.nestedIfBlocks) target.nestedIfBlocks.push(...source.nestedIfBlocks);
}
