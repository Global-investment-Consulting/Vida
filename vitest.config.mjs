import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.mjs"],
    reporters: "default",
    restoreMocks: true,
    isolate: true,
    pool: "vmThreads",
    env: {
      PORT: "3001",
      NODE_ENV: "test",
      HOST: "127.0.0.1"
    }
  }
});
