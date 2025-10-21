import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mockAdapter, __resetMockAdapter } from "src/apadapters/mock.js";

describe("mock AP adapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetMockAdapter();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetMockAdapter();
  });

  it("queues a send then transitions to delivered after a short delay", async () => {
    const result = await mockAdapter.send({
      tenant: "tenant-a",
      invoiceId: "INV-123",
      ublXml: "<Invoice />"
    });

    expect(result.status).toBe("queued");
    expect(result.providerId).toBe("mock-INV-123");

    const immediateStatus = await mockAdapter.getStatus(result.providerId);
    expect(immediateStatus).toBe("queued");

    vi.advanceTimersByTime(500);

    const delivered = await mockAdapter.getStatus(result.providerId);
    expect(delivered).toBe("delivered");
  });
});
