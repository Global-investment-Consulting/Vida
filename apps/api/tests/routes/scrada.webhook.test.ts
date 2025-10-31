import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetReplayGuard } from "../../src/services/replayGuard.ts";
import { createScradaWebhookRouter } from "../../src/routes/webhooks/scrada.ts";

const mocks = vi.hoisted(() => ({
  getOutboundUblMock: vi.fn(),
  getOutboundStatusMock: vi.fn(),
  saveArchiveObjectMock: vi.fn()
}));

vi.mock("../../src/adapters/scrada.ts", () => ({
  getOutboundUbl: mocks.getOutboundUblMock,
  getOutboundStatus: mocks.getOutboundStatusMock
}));

vi.mock("../../src/lib/storage.ts", () => ({
  saveArchiveObject: mocks.saveArchiveObjectMock
}));

function buildApp() {
  const app = express();
  app.use(express.raw({ type: "*/*" }));
  app.use(createScradaWebhookRouter());
  return app;
}

function signPayload(body: Buffer, secret: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function buildEvent(status: string) {
  return {
    id: "evt-123",
    topic: "peppolOutboundDocument/statusUpdate",
    data: {
      documentId: "doc-123",
      status
    }
  };
}

describe("scrada webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReplayGuard();
    process.env.SCRADA_WEBHOOK_SECRET = "topsecret";
  });

  afterEach(() => {
    delete process.env.SCRADA_WEBHOOK_SECRET;
    delete process.env.SCRADA_ALLOW_UNSIGNED_WEBHOOK;
  });

  it("rejects requests with missing signature when secret is configured", async () => {
    const app = buildApp();
    const bodyText = JSON.stringify(buildEvent("DELIVERED"));

    const response = await request(app)
      .post("/api/webhooks/scrada")
      .set("content-type", "application/json")
      .send(bodyText);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("missing_signature");
  });

  it("allows missing signature when override is enabled", async () => {
    const app = buildApp();
    process.env.SCRADA_ALLOW_UNSIGNED_WEBHOOK = "1";
    const bodyText = JSON.stringify(buildEvent("SENT"));

    const response = await request(app)
      .post("/api/webhooks/scrada")
      .set("content-type", "application/json")
      .send(bodyText);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, archived: false });
  });

  it("archives payload when status is delivered", async () => {
    const app = buildApp();
    const event = buildEvent("DELIVERED");
    const bodyText = JSON.stringify(event);
    const signature = signPayload(Buffer.from(bodyText, "utf8"), process.env.SCRADA_WEBHOOK_SECRET!);

    mocks.getOutboundUblMock.mockResolvedValue("<xml>payload</xml>");
    mocks.getOutboundStatusMock.mockResolvedValue({
      documentId: "doc-123",
      status: "DELIVERED",
      attempts: 1
    });
    mocks.saveArchiveObjectMock.mockResolvedValue({ driver: "local", location: "/tmp/doc-123.xml" });

    const response = await request(app)
      .post("/api/webhooks/scrada")
      .set("content-type", "application/json")
      .set("x-scrada-signature", signature)
      .send(bodyText);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, archived: true });
    expect(mocks.getOutboundUblMock).toHaveBeenCalledWith("doc-123");
    expect(mocks.getOutboundStatusMock).toHaveBeenCalledWith("doc-123");
    expect(mocks.saveArchiveObjectMock).toHaveBeenCalledTimes(2);
  });

  it("marks duplicate events as duplicates", async () => {
    const app = buildApp();
    const event = buildEvent("SENT");
    const bodyText = JSON.stringify(event);
    const signature = signPayload(Buffer.from(bodyText, "utf8"), process.env.SCRADA_WEBHOOK_SECRET!);

    const first = await request(app)
      .post("/api/webhooks/scrada")
      .set("content-type", "application/json")
      .set("x-scrada-signature", signature)
      .send(bodyText);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, archived: false });

    const second = await request(app)
      .post("/api/webhooks/scrada")
      .set("x-scrada-signature", signature)
      .send(bodyText);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true, duplicate: true });
  });
});
