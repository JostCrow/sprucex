import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const rootDir = process.cwd();
const require = createRequire(import.meta.url);
const pkg = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
);

function assertFile(field, value) {
  if (!value || typeof value !== "string") {
    throw new Error(`package.json is missing a valid "${field}" entry.`);
  }

  const resolved = path.join(rootDir, value);
  if (!fs.existsSync(resolved)) {
    throw new Error(`package.json "${field}" points to a missing file: ${value}`);
  }

  return resolved;
}

const mainPath = assertFile("main", pkg.main);
const modulePath = assertFile("module", pkg.module);
assertFile("types", pkg.types);

require(rootDir);
await import(pathToFileURL(modulePath).href);

console.log(
  JSON.stringify(
    {
      main: path.relative(rootDir, mainPath),
      module: path.relative(rootDir, modulePath),
      types: pkg.types,
      require: "ok",
      import: "ok",
    },
    null,
    2,
  ),
);
