import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcTypesPath = path.join(rootDir, "src", "index.d.ts");
const outDir = path.join(rootDir, "lib");
const outPath = path.join(outDir, "sprucex.d.ts");

await mkdir(outDir, { recursive: true });
await cp(srcTypesPath, outPath);
