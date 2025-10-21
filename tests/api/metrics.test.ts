import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "src/server.js";
import { resetMetrics } from "src/metrics.js";

describe("GET /metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("exposes Prometheus counters", async () => {
    const response = await request(app).get("/metrics").expect(200);

    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("invoices_created_total");
    expect(response.text).toContain("ap_send_success_total");
    expect(response.text).toContain("ap_send_fail_total");
  });
});

