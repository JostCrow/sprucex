import { afterEach, expect, test } from 'bun:test';
import { Component } from '../src/core/component.js';
import { registerIntegration } from '../src/integrations/index.js';
import { createSortableIntegration, createNativeSortableAdapter } from '../src/integrations/sortable.js';
import { installDom, waitForUpdates } from './helpers/dom.js';
let cleanup, component;
afterEach(() => { component?.destroy(); cleanup?.(); component = null; });
const list = (name, expr = name) => `<div id="${name}" sx-sortable="{items:${expr},containerId:'${name}',group:'shared'}"><template sx-for="item in ${expr}" sx-key="item.id"><section sx-bind:sx-sortable-item="item.id"><button sx-sortable-handle>Move</button><button sx-sortable-move="up">Up</button><button sx-sortable-move="down">Down</button></section></template></div>`;
function mount(extra = '', options) {
  cleanup = installDom(`<main sx-data="{a:[{id:'one'},{id:'two'},{id:'three'}],b:[]}">${list('a')}${list('b')}${extra}</main>`).cleanup;
  registerIntegration('sortable', createSortableIntegration(options));
  component = new Component(document.querySelector('main'));
  return document.querySelector('#a');
}
function key(el, name = 'ArrowDown') { el.dispatchEvent(new KeyboardEvent('keydown', { key:name, altKey:true, bubbles:true, cancelable:true })); }
test('keyboard moves source model, emits positions, retains keyed identity and focus', async () => {
  const el = mount(); const row = el.querySelector('section'), handle = row.querySelector('button');
  const events = []; el.addEventListener('sprucex:sortable:change', e => events.push(e.detail));
  handle.focus(); key(handle); await waitForUpdates();
  expect(component.state.a.map(x => x.id)).toEqual(['two','one','three']);
  expect(el.querySelectorAll('section')[1]).toBe(row);
  expect(document.activeElement).toBe(handle);
  expect(events).toEqual([{ itemId:'one', oldIndex:0, newIndex:1, fromContainerId:'a', toContainerId:'a', input:'keyboard' }]);
  expect(el.querySelector('[role=status]').textContent).toContain('position 2 of 3');
  key(handle, 'ArrowUp'); await waitForUpdates();
  key(handle, 'ArrowUp'); await waitForUpdates();
  expect(events).toHaveLength(2);
});
test('cancelable before event prevents all model changes', async () => {
  const el = mount(); el.addEventListener('sprucex:sortable:before', e => e.preventDefault());
  key(el.querySelector('button')); await waitForUpdates();
  expect(component.state.a[0].id).toBe('one');
});
test('refresh, repeated updates, morph-style rebind and destruction clean adapters and listeners', async () => {
  let mounts = 0, destroys = 0;
  const el = mount('', { adapter() { mounts++; return { destroy() { destroys++; } }; } });
  component.refresh(); component.refresh();
  expect(mounts - destroys).toBe(2);
  const handle = el.querySelector('button'); key(handle); await waitForUpdates();
  expect(component.state.a.map(x=>x.id)).toEqual(['two','one','three']);
  el.removeAttribute('sx-sortable'); component.scheduleUpdate(); await waitForUpdates();
  key(handle); await waitForUpdates(); expect(component.state.a[1].id).toBe('one');
  component.destroy(); expect(mounts).toBe(destroys);
});
test('grouped cross-container moves use source arrays, preserve focus and reject invalid moves', async () => {
  const contexts = [];
  const el = mount('', { adapter(ctx) { contexts.push(ctx); return { destroy() {} }; } });
  const handle = el.querySelector('button'); handle.focus();
  expect(contexts[0].move('one','b',0)).toBe(true); await waitForUpdates();
  expect(component.state.a.map(x=>x.id)).toEqual(['two','three']);
  expect(component.state.b[0].id).toBe('one');
  expect(document.activeElement.closest('section').getAttribute('sx-sortable-item')).toBe('one');
  expect(document.activeElement.closest('[sx-sortable]').id).toBe('b');
  expect(contexts[0].move('two','b',99)).toBe(false);
  document.querySelector('#b').setAttribute('sx-sortable', "{items:b,containerId:'b',group:'other'}");
  expect(contexts[0].move('two','b',0)).toBe(false);
  el.setAttribute('sx-sortable', "{items:[{id:'x'},{id:'x'}],containerId:'a'}");
  expect(contexts[0].move('x','a',1)).toBe(false);
});
test('nested components do not trigger ancestor controls; sortable in keyed row gets current locals and cleanup', async () => {
  mount(`<aside sx-data="{}"><button sx-sortable-move="down">Nested</button></aside><template sx-for="item in a" sx-key="item.id"><article sx-sortable="{items:b,containerId:item.id}"></article></template>`);
  document.querySelector('aside button').click(); await waitForUpdates();
  expect(component.state.a[0].id).toBe('one');
  expect(document.querySelectorAll('article [role=status]').length).toBe(3);
  component.state.a.splice(0,1); await waitForUpdates();
  expect(document.querySelectorAll('article [role=status]').length).toBe(2);
});
test('native adapter delegates desktop drag and restores attributes on teardown', async () => {
  const el = mount('', { adapter:createNativeSortableAdapter() });
  const handles = el.querySelectorAll('[sx-sortable-handle]');
  expect(handles[0].getAttribute('draggable')).toBe('true');
  handles[0].dispatchEvent(new Event('dragstart', { bubbles:true }));
  handles[2].dispatchEvent(new Event('drop', { bubbles:true, cancelable:true }));
  await waitForUpdates(); expect(component.state.a.map(x=>x.id)).toEqual(['two','three','one']);
  component.destroy(); expect(handles[0].hasAttribute('draggable')).toBe(false);
});
test('replacement registration disposes previous factory bindings before rescan', async () => {
  let disposed = 0;
  const el = mount('', { adapter() { return { destroy() { disposed++; } }; } });
  registerIntegration('sortable', createSortableIntegration());
  component.refresh();
  expect(disposed).toBe(2);
  key(el.querySelector('button')); await waitForUpdates();
  expect(component.state.a.map(x=>x.id)).toEqual(['two','one','three']);
  expect(document.querySelectorAll('[role=status]').length).toBe(2);
});
test('morph hydration rebinds once and uses new options', async () => {
  const el = mount(); component.root.__sprucex = component;
  for (let i=0;i<3;i++) {
    component.applySwap('#b', '<p>Empty destination</p>', 'morph');
  }
  key(el.querySelector('button')); await waitForUpdates();
  expect(component.state.a.map(x=>x.id)).toEqual(['two','one','three']);
  expect(document.querySelectorAll('[role=status]').length).toBe(2);
  component.applySwap('#b', '<div id="b" sx-sortable="{items:b,containerId:\'b\',disabled:true}"></div>', 'outerHTML');
  expect(document.querySelectorAll('[role=status]').length).toBe(2);
});
test('before listeners cannot cause a stale or reentrant move', () => {
  const contexts = [];
  const el = mount('', { adapter(ctx) { contexts.push(ctx); return { destroy() {} }; } });
  el.addEventListener('sprucex:sortable:before', () => {
    expect(contexts[0].move('two','a',2)).toBe(false);
    component.state.a.push({id:'four'});
  });
  expect(contexts[0].move('one','a',1)).toBe(false);
  expect(component.state.a.map(x=>x.id)).toEqual(['one','two','three','four']);
});
test('cross-container native move control appends and disabled configuration rejects', async () => {
  const el = mount();
  const down = el.querySelector('[sx-sortable-move=down]');
  down.setAttribute('sx-sortable-to','b'); down.focus(); down.click(); await waitForUpdates();
  expect(component.state.b[0].id).toBe('one');
  expect(document.activeElement.closest('[sx-sortable]').id).toBe('b');
  el.setAttribute('sx-sortable', "{items:a,containerId:'a',disabled:true}");
  key(el.querySelector('button')); await waitForUpdates();
  expect(component.state.a[0].id).toBe('two');
});
test('before listener may invalidate config without throwing', () => {
  const contexts = [];
  const el = mount('', { adapter(ctx) { contexts.push(ctx); return { destroy() {} }; } });
  el.addEventListener('sprucex:sortable:before', () => el.setAttribute('sx-sortable','null'));
  expect(contexts[0].move('one','a',1)).toBe(false);
  expect(component.state.a[0].id).toBe('one');
});
test('native drag ignores drop targets inside nested components', () => {
  const el = mount('', { adapter:createNativeSortableAdapter() });
  const nested = document.createElement('div'); nested.setAttribute('sx-data','{}');
  el.querySelectorAll('section')[2].append(nested);
  el.querySelector('button').dispatchEvent(new Event('dragstart',{bubbles:true}));
  nested.dispatchEvent(new Event('drop',{bubbles:true,cancelable:true}));
  expect(component.state.a[0].id).toBe('one');
});
