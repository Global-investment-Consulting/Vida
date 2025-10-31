#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

const USER_AGENT = "vida-scrada-doc-check/1.0";
const FETCH_TIMEOUT_MS = 15_000;

const SURFACES = [
  {
    name: "scrada_api_docs",
    url: "https://www.scrada.be/api-documentation/",
    requiredSnippets: [
      "peppol/outbound/salesInvoice",
      "peppol/outbound/document",
      "peppolOutboundDocument/statusUpdate",
      "X-API-KEY",
      "X-PASSWORD"
    ]
  },
  {
    name: "postman_peppol_only",
    url: "https://www.postman.com/scrada/overview/documentation/pcpubjp/scrada-peppol-only",
    requiredSnippets: [
      "participantLookup",
      "peppolOutboundDocument",
      "X-Scrada-Signature"
    ]
  }
];

async function fetchText(url) {
  const controller = new AbortController();
  const timer = delay(FETCH_TIMEOUT_MS).then(() => controller.abort()).catch(() => {});

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8"
      }
    });
    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }
    const text = await response.text();
    return { text };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { error: reason };
  } finally {
    controller.abort();
    await timer;
  }
}

async function main() {
  const results = [];
  for (const surface of SURFACES) {
    const result = await fetchText(surface.url);
    if (result.error) {
      results.push({
        name: surface.name,
        url: surface.url,
        status: "skipped",
        reason: result.error
      });
      continue;
    }

    const text = result.text ?? "";
    const missing = surface.requiredSnippets.filter((snippet) => !text.includes(snippet));
    results.push({
      name: surface.name,
      url: surface.url,
      status: missing.length === 0 ? "ok" : "missing-snippets",
      missing
    });
  }

  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));

  const blockers = results.filter((item) => item.status === "missing-snippets");
  if (blockers.length > 0) {
    console.warn(
      `[scrada-doc-check] Documentation check found ${blockers.length} result(s) missing expected content.`
    );
  }
}

await main();
