import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateUbl } from "../../src/validation/ubl.js";

const fixturesDir = path.resolve(__dirname);

describe("validateUbl", () => {
  it("returns ok for a minimal Invoice", async () => {
    const xml = await readFile(path.join(fixturesDir, "good.xml"), "utf8");
    const result = validateUbl(xml);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("flags documents without an Invoice root", async () => {
    const xml = await readFile(path.join(fixturesDir, "bad.xml"), "utf8");
    const result = validateUbl(xml);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.msg).toMatch(/Invoice root/);
  });
});
