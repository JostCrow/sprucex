import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcTypesPath = path.join(rootDir, "src", "index.d.ts");
const outDir = path.join(rootDir, "lib");

await mkdir(outDir, { recursive: true });
for (const extension of ["d.ts", "d.mts", "d.cts"]) {
  await cp(srcTypesPath, path.join(outDir, `sprucex.${extension}`));
}

const coreDts = `export type {
  SpruceXComponent,
  SpruceXDirectiveContext,
  SpruceXDirectiveHandler,
  SpruceXIntegration,
  SpruceXRequestContext,
  SpruceXResponseContext,
  SpruceXConfig,
  SpruceXStoreOptions,
  SpruceXInspectEntry,
  ReactiveEffectRunner,
  ComputedRef,
  SpruceXCoreApi,
} from "./sprucex.js";
import type { SpruceXCoreApi } from "./sprucex.js";
export {
  initSpruceX,
  mountElement,
  unmountElement,
  markRaw,
  toRaw,
  shallow,
  computed,
  effect,
  stop,
  registerDirective,
  getDirective,
} from "./sprucex.js";
export declare const SpruceX: SpruceXCoreApi;
export default SpruceX;
`;

const sortableDts = `export type {
  SpruceXIntegration,
  SortableConfig,
  SortableChange,
  SortableAdapterContext,
  SortableAdapter,
} from "./sprucex.js";
export {
  createSortableIntegration,
  createNativeSortableAdapter,
} from "./sprucex.js";
`;

const gridstackDts = `export type { SpruceXIntegration } from "./sprucex.js";
export { createGridStackIntegration } from "./sprucex.js";
`;

for (const [name, content] of [
  ["core", coreDts],
  ["sortable", sortableDts],
  ["gridstack", gridstackDts],
]) {
  for (const ext of ["d.ts", "d.mts", "d.cts"]) {
    await writeFile(path.join(outDir, `${name}.${ext}`), content, "utf8");
  }
}
