import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "src/server.js";

describe("GET /docs", () => {
  const TITLE_TEXT = "<title>API Docs</title>";

  it("serves the documentation index", async () => {
    const response = await request(app).get("/docs").expect(200);
    expect(response.text).toContain(TITLE_TEXT);
  });

  it("serves the documentation index with trailing slash", async () => {
    const response = await request(app).get("/docs/").expect(200);
    expect(response.text).toContain(TITLE_TEXT);
  });
});

