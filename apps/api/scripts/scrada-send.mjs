#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

async function loadAdapter() {
  try {
    return await import("../dist/src/adapters/scrada.js");
  } catch {
    await import("tsx/esm");
    return import("../src/adapters/scrada.ts");
  }
}

const { sendInvoiceWithFallback } = await loadAdapter();

function parseArgs(argv) {
  const parsed = {
    artifactDir: process.env.SCRADA_ARTIFACT_DIR,
    externalReference: process.env.SCRADA_EXTERNAL_REFERENCE,
    variants: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--artifact-dir" && argv[i + 1]) {
      parsed.artifactDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--artifact-dir=")) {
      parsed.artifactDir = token.split("=", 2)[1];
      continue;
    }
    if (token === "--external-ref" && argv[i + 1]) {
      parsed.externalReference = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--external-ref=")) {
      parsed.externalReference = token.split("=", 2)[1];
      continue;
    }
    if (token === "--vat" && argv[i + 1]) {
      parsed.variants.push(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--vat=")) {
      parsed.variants.push(token.split("=", 2)[1]);
      continue;
    }
  }

  parsed.variants = parsed.variants
    .map((value) => value?.trim())
    .filter((value) => value && value.length > 0);

  return parsed;
}

function normalizeArtifactDir(dir) {
  if (!dir) {
    return undefined;
  }
  return path.resolve(process.cwd(), dir);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const result = await sendInvoiceWithFallback({
      artifactDir: normalizeArtifactDir(args.artifactDir),
      externalReference: args.externalReference,
      vatVariants: args.variants
    });

    const output = {
      success: true,
      documentId: result.documentId,
      invoiceId: result.invoiceId,
      externalReference: result.externalReference,
      channel: result.channel,
      vatVariant: result.vatVariant,
      artifacts: result.artifacts,
      attempts: result.attempts
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown error");
    const failureOutput = {
      success: false,
      errorMessage: message
    };
    console.error("[scrada-send] Failed to send Scrada invoice:", message);
    try {
      console.log(JSON.stringify(failureOutput, null, 2));
    } catch {
      console.log('{"success":false,"errorMessage":"failed to serialize error"}');
    }
    process.exit(1);
  }
}

await main();
