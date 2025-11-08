import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveApAdapterName } from "src/config.js";
import { getAdapter } from "src/apadapters/index.js";

const originalVidaAdapter = process.env.VIDA_AP_ADAPTER;
const originalStagingAdapter = process.env.STAGING_AP_ADAPTER;

describe("resolveApAdapterName", () => {
  beforeEach(() => {
    delete process.env.VIDA_AP_ADAPTER;
    delete process.env.STAGING_AP_ADAPTER;
  });

  afterEach(() => {
    if (originalVidaAdapter === undefined) {
      delete process.env.VIDA_AP_ADAPTER;
    } else {
      process.env.VIDA_AP_ADAPTER = originalVidaAdapter;
    }

    if (originalStagingAdapter === undefined) {
      delete process.env.STAGING_AP_ADAPTER;
    } else {
      process.env.STAGING_AP_ADAPTER = originalStagingAdapter;
    }
  });

  it("defaults to the mock adapter when no env vars are provided", () => {
    expect(resolveApAdapterName()).toBe("mock");
    expect(getAdapter().name).toBe("mock");
  });

  it("respects VIDA_AP_ADAPTER when provided", () => {
    process.env.VIDA_AP_ADAPTER = "billit";
    expect(resolveApAdapterName()).toBe("billit");
    expect(getAdapter().name).toBe("billit");
  });

  it("prefers STAGING_AP_ADAPTER over VIDA_AP_ADAPTER when set", () => {
    process.env.VIDA_AP_ADAPTER = "billit";
    process.env.STAGING_AP_ADAPTER = "mock_error";
    expect(resolveApAdapterName()).toBe("mock_error");
    expect(getAdapter().name).toBe("mock_error");
  });

  it("ignores blank staging overrides", () => {
    process.env.STAGING_AP_ADAPTER = "   ";
    process.env.VIDA_AP_ADAPTER = "billit";
    expect(resolveApAdapterName()).toBe("billit");
  });
});
