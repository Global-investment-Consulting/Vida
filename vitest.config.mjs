import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.mjs"],
    reporters: "default",
    restoreMocks: true,
    isolate: true
  }
});
