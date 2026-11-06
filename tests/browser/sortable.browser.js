import { test, expect } from '@playwright/test';
const markup = `<main sx-data="{items:[{id:'a'},{id:'b'},{id:'c'}]}"><div id="rows" sx-sortable="{items,containerId:'rows'}"><template sx-for="item in items" sx-key="item.id"><section sx-bind:sx-sortable-item="item.id"><button sx-sortable-handle sx-bind:aria-label="'Move '+item.id">Move</button><button sx-sortable-move="up">Up</button><button sx-sortable-move="down">Down</button></section></template></div></main>`;
for (const bundle of ['sprucex.js', 'sprucex.min.js']) {
  test(`${bundle}: keyboard and native buttons update model with focus and cancellation`, async ({ page }) => {
    await page.goto('/'); await page.setContent(markup); await page.addScriptTag({ url:`/${bundle}` });
    await page.evaluate(() => {
      SpruceX.integration('sortable', SpruceX.createSortableIntegration({ adapter: SpruceX.createNativeSortableAdapter() }));
      window.events = [];
      document.querySelector('#rows').addEventListener('sprucex:sortable:change', e => events.push(e.detail));
    });
    const handle = page.getByRole('button', { name:'Move a', exact:true });
    await handle.focus(); await handle.press('Alt+ArrowDown');
    await expect(page.locator('section').nth(1)).toHaveAttribute('sx-sortable-item','a');
    await expect(handle).toBeFocused();
    await expect(page.getByRole('status')).toContainText('position 2 of 3');
    const down = page.locator('[sx-sortable-item="a"] [sx-sortable-move="down"]');
    await down.focus(); await down.press('Enter');
    await expect(page.locator('section').last()).toHaveAttribute('sx-sortable-item','a');
    await expect(down).toBeFocused();
    await page.evaluate(() => document.querySelector('#rows').addEventListener('sprucex:sortable:before', e => e.preventDefault()));
    await down.press('Alt+ArrowUp');
    await page.locator('[sx-sortable-item="a"] [sx-sortable-move="up"]').click();
    expect(await page.evaluate(() => document.querySelector('main').__sprucex.state.items.map(x=>x.id))).toEqual(['b','c','a']);
    expect(await page.evaluate(() => events.map(e=>[e.oldIndex,e.newIndex,e.input]))).toEqual([[0,1,'keyboard'],[1,2,'keyboard']]);
  });
  test(`${bundle}: desktop drag routes through model and survives refresh`, async ({ page }) => {
    await page.goto('/'); await page.setContent(markup); await page.addScriptTag({ url:`/${bundle}` });
    await page.evaluate(() => {
      SpruceX.integration('sortable', SpruceX.createSortableIntegration({ adapter:SpruceX.createNativeSortableAdapter() }));
      document.querySelector('main').__sprucex.refresh();
    });
    await page.getByRole('button', { name:'Move a', exact:true }).dragTo(page.getByRole('button', { name:'Move c', exact:true }));
    await expect(page.locator('section').last()).toHaveAttribute('sx-sortable-item','a');
    expect(await page.evaluate(() => document.querySelector('main').__sprucex.state.items.map(x=>x.id))).toEqual(['b','c','a']);
  });
}

test('touch buttons work without a drag adapter', async ({ browser, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox does not emulate touch contexts');
  const context = await browser.newContext({ hasTouch:true });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4174/'); await page.setContent(markup); await page.addScriptTag({url:'/sprucex.js'});
  await page.evaluate(() => SpruceX.integration('sortable', SpruceX.createSortableIntegration()));
  await page.locator('[sx-sortable-item="a"] [sx-sortable-move="down"]').tap();
  await expect(page.locator('section').nth(1)).toHaveAttribute('sx-sortable-item','a');
  await expect(page.getByRole('status')).toContainText('position 2 of 3');
  await context.close();
});
