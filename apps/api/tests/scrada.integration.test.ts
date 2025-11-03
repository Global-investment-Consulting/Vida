import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import axios from "axios";
import {
  fetchAndArchiveOutboundUbl,
  pollOutboundDocument,
  sendInvoiceWithFallback
} from "../src/adapters/scrada.ts";

const RUN_INTEGRATION = process.env.RUN_SCRADA_INTEGRATION === "true";
const describeIfEnabled = RUN_INTEGRATION ? describe : describe.skip;

function ensureEnv(name: string) {
  if (!process.env[name]) {
    throw new Error(`${name} must be set for Scrada integration test`);
  }
}

describeIfEnabled("Scrada sandbox flow", () => {
  beforeAll(() => {
    for (const envName of [
      "SCRADA_API_KEY",
      "SCRADA_API_PASSWORD",
      "SCRADA_COMPANY_ID",
      "SCRADA_SUPPLIER_SCHEME",
      "SCRADA_SUPPLIER_ID",
      "SCRADA_SUPPLIER_VAT",
      "SCRADA_TEST_RECEIVER_SCHEME",
      "SCRADA_TEST_RECEIVER_ID",
      "SCRADA_RECEIVER_VAT"
    ]) {
      ensureEnv(envName);
    }
  });

  it(
    "sends, polls, and archives an outbound document",
    async () => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "scrada-artifacts-"));

      let sendResult;
      try {
        sendResult = await sendInvoiceWithFallback({ artifactDir });
      } catch (error) {
        const root =
          error instanceof Error && axios.isAxiosError(error.cause) ? error.cause : null;
        const detail =
          (root ?? (axios.isAxiosError(error) ? error : null))?.response?.data ?? null;
        if (detail) {
          process.stdout.write(
            `[[scrada-integration] send failure response] ${
              typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)
            }\n`
          );
        }

        const headers = (root ?? (axios.isAxiosError(error) ? error : null))?.response?.headers;
        if (headers) {
          process.stdout.write(
            `[[scrada-integration] response headers] ${JSON.stringify(headers, null, 2)}\n`
          );
        }

        try {
          const errorBody = await readFile(path.join(artifactDir, "error-body.txt"), "utf8");
          if (errorBody.trim()) {
            process.stdout.write(
              `[[scrada-integration] artifact error body] ${errorBody.trim()}\n`
            );
          }
        } catch (readError) {
          process.stdout.write(
            `[[scrada-integration] unable to read error-body artifact] ${
              readError instanceof Error ? readError.message : readError
            }\n`
          );
        }

        throw error;
      }

      expect(sendResult.documentId).toBeTruthy();

      const pollResult = await pollOutboundDocument(sendResult.documentId, {
        maxWaitMinutes: Number.parseFloat(process.env.SCRADA_STATUS_MAX_WAIT_MINUTES ?? "30"),
        pollIntervalSeconds: Number.parseFloat(process.env.SCRADA_STATUS_POLL_INTERVAL_SECONDS ?? "45"),
        logger: (message) => {
          // eslint-disable-next-line no-console
          console.log(message);
        }
      });

      expect(pollResult.classification).toBe("success");

      const archiveResult = await fetchAndArchiveOutboundUbl(sendResult.documentId);

      const localArchivePath =
        archiveResult.driver === "local" ? archiveResult.location : path.join(artifactDir, "archived.xml");

      if (archiveResult.driver !== "local") {
        await writeFile(localArchivePath, "", "utf8");
      }

      const jsonPayload = await readFile(path.join(artifactDir, "json-sent.json"), "utf8");
      expect(jsonPayload).toContain(sendResult.vatVariant);

      if (archiveResult.driver === "local") {
        const ublContents = await readFile(archiveResult.location, "utf8");
        expect(ublContents).toContain("<Invoice");
      }
    },
    120_000
  );
});
