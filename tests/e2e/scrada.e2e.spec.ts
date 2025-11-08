import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import axios from "axios";

const run = process.env.SCRADA_RUN_E2E === "true";
const missing = ["SCRADA_COMPANY_ID", "SCRADA_API_KEY", "SCRADA_API_PASSWORD"].filter(
  (key) => !process.env[key]
);
const testFn = run && missing.length === 0 ? test : test.skip;

testFn("Scrada E2E submit + wait", async () => {
  const baseUrl = process.env.SCRADA_BASE_URL || "https://apitest.scrada.be";
  const companyId = process.env.SCRADA_COMPANY_ID!;
  const apiKey = process.env.SCRADA_API_KEY!;
  const apiPass = process.env.SCRADA_API_PASSWORD!;

  const xml = readFileSync(resolve("peppol/fixtures/invoice_peppol_bis3.xml"), "utf8");

  const headers = {
    "X-API-KEY": apiKey,
    "X-PASSWORD": apiPass,
    "Content-Type": "application/xml",
    "x-scrada-peppol-sender-scheme": "iso6523-actorid-upis",
    "x-scrada-peppol-sender-id": process.env.SCRADA_SENDER_ID || "0208:0755799452",
    "x-scrada-peppol-receiver-scheme": "iso6523-actorid-upis",
    "x-scrada-peppol-receiver-id": process.env.SCRADA_RECEIVER_ID || "9925:BE0749521473",
    "x-scrada-peppol-c1-country-code": process.env.SCRADA_C1_COUNTRY || "BE",
    "x-scrada-peppol-document-type-scheme": "busdox-docid-qns",
    "x-scrada-peppol-document-type-value":
      process.env.SCRADA_DOC_TYPE ||
      "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
    "x-scrada-peppol-process-scheme": "cenbii-procid-ubl",
    "x-scrada-peppol-process-value":
      process.env.SCRADA_PROCESS_VALUE || "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
  };

  const http = axios.create({ baseURL: baseUrl, timeout: 30_000 });

  const { data: idRaw } = await http.post(
    `/v1/company/${companyId}/peppol/outbound/document`,
    xml,
    {
      headers,
      responseType: "text",
      transformResponse: [(d) => d]
    }
  );
  const docId = String(idRaw).replace(/^"+|"+$/g, "").trim();

  let info: Record<string, unknown> | undefined;
  for (let i = 0; i < 60; i += 1) {
    const response = await http.get(
      `/v1/company/${companyId}/peppol/outbound/document/${docId}/info`,
      { headers: { "X-API-KEY": apiKey, "X-PASSWORD": apiPass } }
    );
    info = response.data;
    const status = typeof info?.status === "string" ? info.status : "";
    if (["Processed", "Delivered", "Error"].includes(status)) {
      break;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 5_000));
  }
  expect(info).toBeTruthy();
  const status = typeof info?.status === "string" ? info.status : "";
  expect(["Processed", "Delivered", "Error"]).toContain(status);
});
