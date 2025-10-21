import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireApiKey } from "src/mw_auth.js";

const TEST_KEY = "test-auth-key";

const buildApp = () => {
  const app = express();
  app.get("/protected", requireApiKey, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
};

describe("requireApiKey middleware", () => {
  beforeEach(() => {
    process.env.VIDA_API_KEYS = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.VIDA_API_KEYS;
  });

  it("returns 401 when header missing", async () => {
    const app = buildApp();

    const response = await request(app).get("/protected").expect(401);

    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it("returns 401 when API key is invalid", async () => {
    const app = buildApp();

    const response = await request(app)
      .get("/protected")
      .set("x-api-key", "wrong")
      .expect(401);

    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it("allows the request when API key matches", async () => {
    const app = buildApp();

    const response = await request(app)
      .get("/protected")
      .set("x-api-key", TEST_KEY)
      .expect(200);

    expect(response.body).toEqual({ ok: true });
  });
});
