import { afterEach, beforeEach, expect, test } from "vitest";
import nock from "nock";
import axios from "axios";

const baseUrl = "http://mock.scrada";
const companyId = "company-x";
const apiKey = "k";
const apiPassword = "p";

function buildHeaders() {
  return {
    "x-scrada-peppol-sender-scheme": "iso6523-actorid-upis",
    "x-scrada-peppol-sender-id": "0208:0755799452",
    "x-scrada-peppol-receiver-scheme": "iso6523-actorid-upis",
    "x-scrada-peppol-receiver-id": "9925:BE0749521473",
    "x-scrada-peppol-c1-country-code": "BE",
    "x-scrada-peppol-document-type-scheme": "busdox-docid-qns",
    "x-scrada-peppol-document-type-value":
      "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
    "x-scrada-peppol-process-scheme": "cenbii-procid-ubl",
    "x-scrada-peppol-process-value": "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
  };
}

beforeEach(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

test("submit + info (mocked)", async () => {
  const http = axios.create({ baseURL: baseUrl });
  const docId = "11111111-2222-3333-4444-555555555555";

  nock(baseUrl)
    .post(`/v1/company/${companyId}/peppol/outbound/document`)
    .reply(200, `"${docId}"`)
    .get(`/v1/company/${companyId}/peppol/outbound/document/${docId}/info`)
    .reply(200, { id: docId, status: "Processed", attempt: 1 });

  const submit = await http.post(`/v1/company/${companyId}/peppol/outbound/document`, "<xml/>", {
    headers: {
      "X-API-KEY": apiKey,
      "X-PASSWORD": apiPassword,
      "Content-Type": "application/xml",
      ...buildHeaders()
    },
    responseType: "text",
    transformResponse: [(d) => d]
  });
  const id = String(submit.data).replace(/^"+|"+$/g, "").trim();
  expect(id).toBe(docId);

  const info = await http.get(`/v1/company/${companyId}/peppol/outbound/document/${docId}/info`, {
    headers: { "X-API-KEY": apiKey, "X-PASSWORD": apiPassword }
  });
  expect(info.data.status).toBe("Processed");
});
