import { describe, expect, it } from "vitest";
import { apProviderCatalog } from "src/apadapters/contracts.js";
import { banqupAdapter } from "src/apadapters/banqup.js";
import { getAdapter } from "src/apadapters/index.js";

describe("adapter registry", () => {
  it("returns a banqup stub when requested", () => {
    const adapter = getAdapter("banqup");
    expect(adapter).toBe(banqupAdapter);
  });

  it("marks banqup as a stub in provider metadata", () => {
    expect(apProviderCatalog.banqup.status).toBe("stub");
  });
});
