import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import os from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

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

const required = require(rootDir);
const imported = await import(pathToFileURL(modulePath).href);
assert.equal(required.default, required.SpruceX);
assert.equal(imported.default, imported.SpruceX);
assertFile("exports.import.types", pkg.exports["."].import.types);
assertFile("exports.require.types", pkg.exports["."].require.types);
assertFile("unpkg", pkg.unpkg);
assertFile("jsdelivr", pkg.jsdelivr);
assert.equal(Object.keys(pkg.dependencies || {}).length, 0, "The runtime must not install documentation build tools");

// Verify the actual tarball from a clean consumer directory. Ignore lifecycle
// scripts here because this check itself also runs within prepack.
const consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), "sprucex-consumer-"));
try {
  const [packed] = JSON.parse(execFileSync("npm", [
    "pack", "--ignore-scripts", "--json", "--pack-destination", consumerDir,
  ], { cwd: rootDir, encoding: "utf8" }));
  const packageDir = path.join(consumerDir, "node_modules", pkg.name);
  fs.mkdirSync(packageDir, { recursive: true });
  execFileSync("tar", ["-xzf", path.join(consumerDir, packed.filename), "--strip-components=1", "-C", packageDir]);
  execFileSync("node", ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import SpruceX, { SpruceX as named } from 'sprucex';
    const required = createRequire(import.meta.url)('sprucex');
    assert.equal(SpruceX, named);
    assert.equal(required.default, required.SpruceX);
    assert.equal(typeof SpruceX.init, 'function');
    assert.equal(typeof required.SpruceX.removeStore, 'function');
  `], { cwd: consumerDir, stdio: "pipe" });
} finally {
  fs.rmSync(consumerDir, { recursive: true, force: true });
}

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
