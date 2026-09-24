import { test, expect } from "@playwright/test";

async function mount(page, markup, bundle) {
  await page.goto("/");
  await page.setContent(markup);
  await page.addScriptTag({ url: `/${bundle}` });
}

for (const bundle of ["sprucex.js", "sprucex.min.js"]) {
  test.describe(bundle, () => {
    test("keyed rows preserve focus, selection and state while updating and reordering", async ({ page }) => {
      await mount(page, `<div sx-data="{count:0,items:[{id:1,name:'one'},{id:2,name:'two'}]}"><span id="count" sx-text="count"></span><template sx-for="item in items" sx-key="item.id"><section><input sx-model="item.name" sx-bind:data-id="item.id"><b sx-text="item.name"></b></section></template></div>`, bundle);
      const input = page.locator('input[data-id="1"]');
      await input.fill("edited");
      await input.evaluate((el) => { el.setSelectionRange(1, 3); window.originalInput = el; });
      await page.evaluate(() => document.querySelector("[sx-data]").__sprucex.state.count++);
      await expect(page.locator("#count")).toHaveText("1");
      await expect(input).toBeFocused();
      await page.evaluate(() => document.querySelector("[sx-data]").__sprucex.state.items.reverse());
      await expect(page.locator("input").first()).toHaveAttribute("data-id", "2");
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("edited");
      expect(await input.evaluate((el) => [el === window.originalInput, el.selectionStart, el.selectionEnd])).toEqual([true, 1, 3]);
    });

    test("fetched fragments initialize bindings and nested components", async ({ page }) => {
      await page.route("**/fragment", (route) => route.fulfill({ contentType: "text/html", body: '<button id="new" sx-on:click="count++">Add</button><span id="value" sx-text="count"></span><section sx-data="{ready:true}"><b sx-text="ready"></b></section>' }));
      await mount(page, `<div sx-data="{count:0}"><button id="load" sx-get="/fragment" sx-target="#target">Load</button><div id="target"></div></div>`, bundle);
      await page.locator("#load").click();
      await page.locator("#new").click();
      await expect(page.locator("#value")).toHaveText("1");
      await expect(page.locator("b")).toHaveText("true");
      await page.locator("#load").click();
      await expect(page.locator("#value")).toHaveText("1");
      await page.locator("#new").click();
      await expect(page.locator("#value")).toHaveText("2");
    });

    test("global row listeners stop firing after the row is removed", async ({ page }) => {
      await mount(page, `<div sx-data="{items:[1],hits:0}"><span id="hits" sx-text="hits"></span><template sx-for="item in items"><section sx-on:keydown.escape.window="hits++"><input></section></template></div>`, bundle);
      await page.locator("input").focus();
      await page.keyboard.press("Escape");
      await expect(page.locator("#hits")).toHaveText("1");
      await page.evaluate(() => document.querySelector("[sx-data]").__sprucex.state.items = []);
      await expect(page.locator("input")).toHaveCount(0);
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.querySelector("[sx-data]").__sprucex.state.hits)).toBe(1);
    });
  });
}
