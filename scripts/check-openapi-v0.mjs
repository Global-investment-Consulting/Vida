#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SPEC_PATH = path.join(repoRoot, "docs", "api", "openapi.v0.yaml");
const ROUTES = [
  { module: "dist/src/routes/invoicesV0.js", exportName: "invoicesV0Router" },
  { module: "dist/src/routes/shopifyWebhook.js", exportName: "shopifyWebhookRouter" }
];

function normalizePath(value) {
  return value.replace(/\{([^}]+)\}/g, ":$1");
}

function normalizeExpressPath(value) {
  return value.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function formatKey(method, pathValue) {
  return `${method.toUpperCase()} ${normalizePath(pathValue)}`;
}

async function collectRoutes() {
  const entries = [];
  for (const routeInfo of ROUTES) {
    const modulePath = pathToFileURL(path.join(repoRoot, routeInfo.module)).href;
    const mod = await import(modulePath);
    const router = mod[routeInfo.exportName];
    if (!router || !router.stack) {
      throw new Error(`Router ${routeInfo.exportName} missing stack`);
    }
    for (const layer of router.stack) {
      if (!layer.route || !layer.route.path) {
        continue;
      }
      const pathValue = layer.route.path;
      for (const method of Object.keys(layer.route.methods)) {
        if (layer.route.methods[method]) {
          entries.push(formatKey(method.toUpperCase(), pathValue));
        }
      }
    }
  }
  return new Set(entries);
}

async function collectSpecRoutes() {
  const specRaw = await readFile(SPEC_PATH, "utf8");
  const spec = YAML.parse(specRaw);
  const entries = new Set();
  const paths = spec?.paths ?? {};
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    for (const method of Object.keys(pathItem)) {
      if (["get", "post", "put", "delete", "patch"].includes(method.toLowerCase())) {
        entries.add(formatKey(method, normalizeExpressPath(pathKey)));
      }
    }
  }
  return entries;
}

function diffSets(expected, actual) {
  const missing = [];
  const extra = [];
  for (const entry of expected) {
    if (!actual.has(entry)) {
      missing.push(entry);
    }
  }
  for (const entry of actual) {
    if (!expected.has(entry)) {
      extra.push(entry);
    }
  }
  return { missing, extra };
}

async function main() {
  const [actualRoutes, specRoutes] = await Promise.all([collectRoutes(), collectSpecRoutes()]);

  const { missing, extra } = diffSets(actualRoutes, specRoutes);

  if (missing.length === 0 && extra.length === 0) {
    console.log("OpenAPI spec matches exported routes.");
    return;
  }

  if (missing.length > 0) {
    console.error("Missing routes in OpenAPI spec:");
    for (const entry of missing) {
      console.error(`  - ${entry}`);
    }
  }
  if (extra.length > 0) {
    console.error("Routes documented but not implemented:");
    for (const entry of extra) {
      console.error(`  - ${entry}`);
    }
  }
  process.exit(1);
}

main().catch((error) => {
  console.error("OpenAPI check failed:", error);
  process.exit(1);
});
