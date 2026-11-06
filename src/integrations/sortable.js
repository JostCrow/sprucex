const sortableOwners = new WeakMap();

// Optional integration: the sx-for source array remains the only list state.
export function createSortableIntegration({ adapter } = {}) {
  const scopes = new Map();
  const owner = {};
  const containers = new Set();
  let pendingFocus = null;
  let moving = false;
  const config = (binding) => binding.component.evaluateExpressionOrLiteral(binding.el.getAttribute('sx-sortable'));
  const owned = (binding, el) => el?.closest('[sx-sortable]') === binding.el
    && el.closest('[sx-data]') === binding.component.root;
  const rows = (binding) => Array.from(binding.el.children).filter(el => el.hasAttribute('sx-sortable-item'));
  const ids = (cfg) => cfg.items.map(item => String(item[cfg.id || 'id']));
  function valid(cfg) {
    return cfg && Array.isArray(cfg.items) && typeof cfg.containerId === 'string' && cfg.containerId.length > 0
      && cfg.items.every(item => item != null && ['string', 'number'].includes(typeof item[cfg.id || 'id']))
      && new Set(ids(cfg)).size === cfg.items.length;
  }
  function findContainer(id) {
    const matches = [...containers].filter(b => b.el.isConnected && config(b)?.containerId === id);
    return matches.length === 1 ? matches[0] : null;
  }
  function move(source, itemId, toContainerId, newIndex, input = 'api') {
    if (moving || !containers.has(source) || !source.el.isConnected
      || !['api', 'keyboard', 'pointer'].includes(input)) return false;
    const target = findContainer(toContainerId);
    const from = config(source), to = target && config(target);
    if (!valid(from) || !valid(to) || from.disabled || to.disabled || findContainer(from.containerId) !== source) return false;
    const same = source === target;
    if (!same && (!from.group || from.group !== to.group || from.items === to.items)) return false;
    const oldIndex = ids(from).indexOf(String(itemId));
    if (oldIndex < 0 || !Number.isInteger(newIndex) || newIndex < 0 || newIndex > to.items.length - (same ? 1 : 0)
      || (same && newIndex === oldIndex) || (!same && ids(to).includes(String(itemId)))) return false;
    if (!same && String(from.items[oldIndex][to.id || 'id']) !== String(itemId)) return false;
    const fromIds = JSON.stringify(ids(from)), toIds = JSON.stringify(ids(to));
    const detail = Object.freeze({ itemId: String(itemId), oldIndex, newIndex,
      fromContainerId: from.containerId, toContainerId: to.containerId, input });
    const EventClass = source.el.ownerDocument.defaultView.CustomEvent;
    moving = true;
    try {
      if (!source.el.dispatchEvent(new EventClass('sprucex:sortable:before', { detail, bubbles: true, cancelable: true }))) return false;
      // A before listener may have changed the collection or removed a container.
      const currentFrom = config(source), currentTo = config(target);
      if (!containers.has(source) || !containers.has(target) || !target.el.isConnected
        || !valid(currentFrom) || !valid(currentTo)
        || currentFrom.items !== from.items || currentTo.items !== to.items
        || findContainer(from.containerId) !== source || findContainer(to.containerId) !== target
        || currentFrom.disabled || currentTo.disabled
        || (!same && (!currentFrom.group || currentFrom.group !== currentTo.group))
        || JSON.stringify(ids(currentFrom)) !== fromIds || JSON.stringify(ids(currentTo)) !== toIds) return false;
      const active = source.el.ownerDocument.activeElement;
      const row = active?.closest('[sx-sortable-item]');
      const controls = row ? [...row.querySelectorAll('[sx-sortable-handle], [sx-sortable-move]')] : [];
      const controlIndex = controls.indexOf(active);
      if (owned(source, active) && row?.getAttribute('sx-sortable-item') === String(itemId) && controlIndex >= 0) {
        pendingFocus = { target, itemId: String(itemId), controlIndex };
      }
      const [item] = from.items.splice(oldIndex, 1);
      to.items.splice(newIndex, 0, item);
      source.component.scheduleUpdate();
      target.component.scheduleUpdate();
      target.status.textContent = `Moved ${itemId} to position ${newIndex + 1} of ${to.items.length} in ${to.containerId}.`;
      source.el.dispatchEvent(new EventClass('sprucex:sortable:change', { detail, bubbles: true }));
      return true;
    } finally { moving = false; }
  }
  function dispose(binding) {
    if (!containers.delete(binding)) return;
    sortableOwners.delete(binding.el);
    binding.el.removeEventListener('click', binding.click);
    binding.el.removeEventListener('keydown', binding.keydown);
    try { binding.adapter?.destroy(); } finally { binding.status.remove(); }
    if (pendingFocus?.target === binding) pendingFocus = null;
  }
  return {
    scan(component, el) {
      if (!el.hasAttribute('sx-sortable')) return;
      const previous = sortableOwners.get(el);
      if (previous && previous.owner !== owner) previous.dispose();
      let bindings = scopes.get(component);
      if (!bindings) scopes.set(component, bindings = new Map());
      if (bindings.has(el)) return;
      const status = el.ownerDocument.createElement('span');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
      el.append(status);
      const binding = { component, el, status };
      function control(event, keyboard) {
        const button = event.target.closest?.(keyboard ? '[sx-sortable-handle]' : '[sx-sortable-move]');
        if (!button || !owned(binding, button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
        const row = button.closest('[sx-sortable-item]');
        if (!row || row.parentElement !== el) return;
        let direction = button.getAttribute('sx-sortable-move');
        if (keyboard) {
          if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
          direction = event.key === 'ArrowUp' ? 'up' : 'down';
        }
        const cfg = config(binding);
        if (!valid(cfg)) return;
        const itemId = row.getAttribute('sx-sortable-item');
        const index = ids(cfg).indexOf(itemId);
        const destination = button.getAttribute('sx-sortable-to') || cfg.containerId;
        const target = findContainer(destination);
        const targetConfig = target && config(target);
        const next = destination !== cfg.containerId && valid(targetConfig) ? targetConfig.items.length
          : direction === 'up' ? index - 1 : direction === 'down' ? index + 1 : -1;
        event.preventDefault();
        move(binding, itemId, destination, next, keyboard ? 'keyboard' : event.detail === 0 ? 'keyboard' : 'pointer');
      }
      binding.click = event => control(event, false);
      binding.keydown = event => control(event, true);
      bindings.set(el, binding);
      containers.add(binding);
      sortableOwners.set(el, { owner, dispose() {
        dispose(binding); bindings.delete(el);
        if (!bindings.size) scopes.delete(component);
      } });
      el.addEventListener('click', binding.click);
      el.addEventListener('keydown', binding.keydown);
      try {
        binding.adapter = adapter?.({ el,
          items: () => rows(binding).filter(row => owned(binding, row)),
          containerId: () => config(binding)?.containerId,
          move: (itemId, destination, index, input) => move(binding, itemId, destination, index, input),
        });
      } catch (error) { bindings.delete(el); dispose(binding); throw error; }
    },
    update(component) {
      const bindings = scopes.get(component);
      bindings?.forEach((binding, el) => {
        if (!el.isConnected || !el.hasAttribute('sx-sortable') || el.closest('[sx-data]') !== component.root) {
          dispose(binding); bindings.delete(el); return;
        }
        binding.adapter?.update?.();
        if (pendingFocus?.target === binding) {
          const row = rows(binding).find(row => row.getAttribute('sx-sortable-item') === pendingFocus.itemId);
          const control = row?.querySelectorAll('[sx-sortable-handle], [sx-sortable-move]')[pendingFocus.controlIndex];
          if (control) { control.focus({ preventScroll: true }); pendingFocus = null; }
        }
      });
    },
    teardown(component) {
      scopes.get(component)?.forEach(dispose);
      scopes.delete(component);
    },
  };
}

// HTML Drag and Drop is desktop-oriented. Touch support is browser-dependent;
// native move buttons remain available on touch devices.
export function createNativeSortableAdapter() {
  let drag = null;
  return context => {
    const originals = new Map();
    const handles = () => context.items().flatMap(row => [...row.querySelectorAll('[sx-sortable-handle]')])
      .filter(el => el.closest('[sx-sortable]') === context.el && el.closest('[sx-data]') === context.el.closest('[sx-data]'));
    function update() {
      for (const el of handles()) {
        if (!originals.has(el)) originals.set(el, el.getAttribute('draggable'));
        el.setAttribute('draggable', 'true');
      }
      for (const [el, value] of originals) {
        if (!context.el.contains(el)) { restore(el, value); originals.delete(el); }
      }
    }
    function restore(el, value) { if (value === null) el.removeAttribute('draggable'); else el.setAttribute('draggable', value); }
    function start(event) {
      const handle = event.target.closest?.('[sx-sortable-handle]');
      if (!handles().includes(handle) || handle.disabled || handle.getAttribute('aria-disabled') === 'true') return;
      drag = { context, itemId: handle.closest('[sx-sortable-item]').getAttribute('sx-sortable-item') };
      event.dataTransfer?.setData('text/plain', drag.itemId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    }
    const ownsTarget = event => event.target.closest('[sx-sortable]') === context.el
      && event.target.closest('[sx-data]') === context.el.closest('[sx-data]');
    function over(event) { if (drag && ownsTarget(event)) event.preventDefault(); }
    function drop(event) {
      if (!drag || !ownsTarget(event)) return;
      event.preventDefault();
      const row = event.target.closest('[sx-sortable-item]');
      const items = context.items();
      let index = row && items.includes(row) ? items.indexOf(row) : items.length;
      if (drag.context === context) index = Math.min(index, items.length - 1);
      const source = drag; drag = null;
      source.context.move(source.itemId, context.containerId(), index, 'pointer');
    }
    function end() { drag = null; }
    const listeners = { dragstart: start, dragover: over, drop, dragend: end };
    Object.entries(listeners).forEach(([name, fn]) => context.el.addEventListener(name, fn));
    update();
    return { update, destroy() {
      if (drag?.context === context) drag = null;
      Object.entries(listeners).forEach(([name, fn]) => context.el.removeEventListener(name, fn));
      originals.forEach((value, el) => restore(el, value)); originals.clear();
    } };
  };
}
