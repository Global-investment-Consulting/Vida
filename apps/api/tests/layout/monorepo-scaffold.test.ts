import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("monorepo scaffold", () => {
  it("exposes the @vida/api workspace manifest", async () => {
    const candidates = [
      path.resolve(process.cwd(), "package.json"),
      path.resolve(process.cwd(), "apps/api/package.json")
    ];

    let manifestPath: string | undefined;
    for (const candidate of candidates) {
      try {
        await access(candidate);
        manifestPath = candidate;
        break;
      } catch {
        // continue
      }
    }

    expect(manifestPath, "manifest path to exist").toBeTruthy();
    if (!manifestPath) return;

    const raw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe("@vida/api");
    expect(manifest.private).toBe(true);
  });
});
