import { cp, mkdir } from "node:fs/promises";
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
