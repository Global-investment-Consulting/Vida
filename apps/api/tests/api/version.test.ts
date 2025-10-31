import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "src/server.js";

describe("GET /_version", () => {
  it("returns version metadata", async () => {
    const response = await request(app).get("/_version").expect(200);

    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toHaveProperty("version");
    expect(typeof response.body.version === "string" || response.body.version === undefined).toBe(true);

    expect(response.body).toHaveProperty("commit");
    expect(typeof response.body.commit).toBe("string");
    expect(response.body.commit.length).toBeGreaterThan(0);

    expect(response.body).toHaveProperty("builtAt");
    expect(typeof response.body.builtAt).toBe("string");
    expect(new Date(response.body.builtAt).toString()).not.toBe("Invalid Date");
  });
});
