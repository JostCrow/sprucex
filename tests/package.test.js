import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = process.cwd();
const pkg = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
);

describe("package metadata", () => {
  test("main, module, and types point to build artifacts that exist", () => {
    expect(fs.existsSync(path.join(rootDir, pkg.main))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, pkg.module))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, pkg.types))).toBe(true);
  });

  test("root package can be required and imported", async () => {
    const required = execFileSync(
      "node",
      ["-e", "const mod=require(process.cwd()); console.log(typeof mod.SpruceX);"],
      { cwd: rootDir, encoding: "utf8" },
    ).trim();
    expect(required).toBe("object");

    const imported = await import(pathToFileURL(path.join(rootDir, pkg.module)).href);
    expect(typeof imported.SpruceX).toBe("object");
  });

  test("verify-package script succeeds", () => {
    const output = execFileSync("node", ["scripts/verify-package.mjs"], {
      cwd: rootDir,
      encoding: "utf8",
    });
    expect(output).toContain('"require": "ok"');
    expect(output).toContain('"import": "ok"');
  });
});
