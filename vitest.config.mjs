import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distSrcDir = path.join(rootDir, "dist", "src");
const useDistSrc = (process.env.CI === "true" || process.env.VITEST_USE_DIST === "true") && fs.existsSync(distSrcDir);
const sourceRoot = useDistSrc ? distSrcDir : path.join(rootDir, "src");
const isPrismaBackend = (process.env.VIDA_STORAGE_BACKEND ?? "").trim().toLowerCase() === "prisma";

export default defineConfig({
  resolve: {
    alias: {
      src: sourceRoot
    }
  },
  plugins: [
    {
      name: "ts-extension-fallback",
      enforce: "pre",
      resolveId(source, importer) {
        if (!importer || !source.endsWith(".js")) {
          return null;
        }

        const importerPath = importer.startsWith("file://") ? fileURLToPath(importer) : importer;
        const fromAlias = source.startsWith("src/");
        let candidatePath;

        if (source.startsWith("./") || source.startsWith("../")) {
          candidatePath = path.resolve(path.dirname(importerPath), source);
        } else if (fromAlias) {
          candidatePath = path.join(sourceRoot, source.slice(4));
        } else {
          return null;
        }

        const tsCandidate = candidatePath.replace(/\.js$/, ".ts");
        if (fs.existsSync(tsCandidate)) {
          return tsCandidate;
        }

        if (fs.existsSync(candidatePath)) {
          return null;
        }

        return null;
      }
    }
  ],
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.mjs"],
    reporters: "default",
    restoreMocks: true,
    isolate: true,
    pool: "vmThreads",
    maxConcurrency: isPrismaBackend ? 1 : undefined,
    poolOptions: {
      threads: {
        maxWorkers: isPrismaBackend ? 1 : undefined,
        minWorkers: isPrismaBackend ? 1 : undefined
      }
    }
  }
});
