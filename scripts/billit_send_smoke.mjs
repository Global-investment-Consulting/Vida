
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORT_DIR = path.resolve(__dirname, "..", "reports");
const INVOICE_PATH = path.join(REPORT_DIR, "invoice.sb.json");
const REPORT_PATH = path.join(REPORT_DIR, "billit-sandbox-live.json");

const TOKEN_SAFETY_WINDOW_MS = 30_000;
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1_000;
const REGISTRATION_CACHE_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_RECEIVER_SCHEME = "0088";
const DEFAULT_RECEIVER_VALUE = "0000000000000";
const DEFAULT_DOCUMENT_TYPE = "BISv3Invoice";

let cachedToken;
let cachedRegistration;

run().catch((error) => {
  console.error("Billit sandbox smoke failed:", error.message);
  process.exit(1);
});

async function run() {
  const report = {
    requestShape: {},
    response: undefined,
    poll: [],
    errors: []
  };

  try {
    ensureReportDir();
    const config = resolveConfig();
    const auth = await resolveAuthHeaders(config);

    const invoiceDraft = loadInvoiceDraft();
    const order = buildOrderFromDraft(invoiceDraft);

    const requestId = randomUUID();
    const idempotencyKey = buildIdempotencyKey(config, order.orderNumber);

    const requestHeaders = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Request-ID": requestId,
      ...auth.headers
    };

    let registrationForBody = config.registrationId;
    let targetPath = "/v1/commands/send";
    let targetUrl = joinUrl(config.baseUrl, targetPath);
    let payload = buildBillitPayload(order, config, registrationForBody);
    let body = JSON.stringify(payload);
    report.requestPayload = payload;
    report.registrationId = registrationForBody ?? null;
    report.registrationEntry = config.registrationEntry ?? cachedRegistration?.entry ?? null;

    console.log("Sending invoice to Billit sandbox…", sanitizeUrl(targetUrl));
    let response = await fetch(targetUrl, {
      method: "POST",
      headers: requestHeaders,
      body
    });

    const shouldRetry =
      response.status === 404 ||
      response.status === 400 ||
      (response.status >= 500 && response.status < 600);

    if (shouldRetry) {
      let fallbackRegistration = registrationForBody;
      if (!fallbackRegistration) {
        try {
          fallbackRegistration = await resolveRegistrationId(config, auth);
        } catch (lookupError) {
          const message = lookupError instanceof Error ? lookupError.message : String(lookupError);
          console.warn("Registration lookup failed:", message);
          report.errors.push(`registration: ${message}`);
          fallbackRegistration = undefined;
        }
      }
      if (fallbackRegistration) {
        config.registrationId = fallbackRegistration;
        registrationForBody = fallbackRegistration;
        targetPath = `/v1/einvoices/registrations/${encodeURIComponent(fallbackRegistration)}/commands/send`;
        targetUrl = joinUrl(config.baseUrl, targetPath);
        payload = buildBillitPayload(order, config, registrationForBody);
        body = JSON.stringify(payload);
        report.requestPayload = payload;
        report.registrationId = registrationForBody;
        report.registrationEntry = config.registrationEntry ?? cachedRegistration?.entry ?? null;
        console.log("Retrying with registration path…", sanitizeUrl(targetUrl));
        response = await fetch(targetUrl, {
          method: "POST",
          headers: requestHeaders,
          body
        });
      }
    }

    report.requestShape = {
      url: sanitizeUrl(targetUrl),
      method: "POST",
      headers: redactHeaders(requestHeaders),
      bodyBytes: Buffer.byteLength(body, "utf8"),
      invoiceNumber: order.orderNumber
    };

    const parsed = await parseJson(response);

    if (!response.ok) {
      const errorBody = await safeReadBody(response, parsed);
      throw new Error(
        `Billit send failed (${response.status} ${response.statusText}): ${errorBody}`
      );
    }

    const provider = extractProviderResponse(parsed);
    const sendStatus = mapProviderSendStatus(provider.status);
    report.response = { id: provider.providerId, status: sendStatus };

    console.log(
      "Send response:",
      JSON.stringify(
        {
          id: provider.providerId,
          status: sendStatus,
          message: provider.message ?? null
        },
        null,
        2
      )
    );

    if (provider.providerId) {
      const pollDelays = [5_000, 15_000, 30_000];
      for (const delay of pollDelays) {
        await sleep(delay);
        try {
          const pollStatus = await pollStatusOnce(config, auth, provider.providerId);
          report.poll.push({ t: nowIso(), status: pollStatus });
          console.log("Poll status:", pollStatus);
          if (pollStatus === "delivered" || pollStatus === "error") {
            break;
          }
        } catch (pollError) {
          const message = pollError instanceof Error ? pollError.message : String(pollError);
          console.error("Status poll failed:", message);
          report.errors.push(`poll: ${message}`);
          report.poll.push({ t: nowIso(), status: "unknown" });
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.errors.push(message);
    if (!report.response) {
      report.response = { id: null, status: "error" };
    }
    throw error;
  } finally {
    if (report.errors && report.errors.length === 0) {
      delete report.errors;
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  }
}

function ensureReportDir() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function optionalEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireEnv(name) {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function normalizeTransportType(value) {
  if (!value) {
    return "Peppol";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "Peppol";
  }
  const lower = trimmed.toLowerCase();
  if (lower === "peppol") {
    return "Peppol";
  }
  if (lower === "smtp") {
    return "SMTP";
  }
  if (lower === "letter") {
    return "Letter";
  }
  if (lower === "sdi") {
    return "SDI";
  }
  return trimmed;
}

function resolveConfig() {
  const baseUrl = requireEnv("AP_BASE_URL").replace(/\/+$/, "").replace(/\/api\/?$/i, "");
  const registrationId =
    optionalEnv("AP_REGISTRATION_ID") ?? optionalEnv("BILLIT_REGISTRATION_ID") ?? optionalEnv("AP_PARTY_ID");

  const apiKey = optionalEnv("AP_API_KEY");
  const clientId = optionalEnv("AP_CLIENT_ID");
  const clientSecret = optionalEnv("AP_CLIENT_SECRET");

  if (!apiKey && (!clientId || !clientSecret)) {
    throw new Error("AP_API_KEY or both AP_CLIENT_ID and AP_CLIENT_SECRET must be provided");
  }

  return {
    baseUrl,
    registrationId,
    apiKey,
    clientId,
    clientSecret,
    partyId: optionalEnv("AP_PARTY_ID"),
    contextPartyId: optionalEnv("AP_CONTEXT_PARTY_ID"),
    transportType: normalizeTransportType(optionalEnv("AP_TRANSPORT_TYPE") ?? optionalEnv("BILLIT_TRANSPORT_TYPE")),
    documentType: optionalEnv("BILLIT_DOC_TYPE") ?? optionalEnv("AP_DOCUMENT_TYPE") ?? DEFAULT_DOCUMENT_TYPE,
    receiverScheme: optionalEnv("BILLIT_RX_SCHEME") ?? optionalEnv("AP_RECEIVER_SCHEME"),
    receiverValue: optionalEnv("BILLIT_RX_VALUE") ?? optionalEnv("AP_RECEIVER_VALUE")
  };
}

async function resolveAuthHeaders(config) {
  if (config.apiKey) {
    const headers = {
      ApiKey: config.apiKey
    };
    if (config.partyId) {
      headers.PartyID = config.partyId;
    }
    if (config.contextPartyId) {
      headers.ContextPartyID = config.contextPartyId;
    }
    return { headers, mode: "api-key" };
  }

  const token = await getOAuthToken(config);
  const scheme = token.tokenType && token.tokenType.length > 0 ? token.tokenType : "Bearer";
  const headers = {
    Authorization: `${scheme} ${token.accessToken}`
  };
  if (config.partyId) {
    headers.PartyID = config.partyId;
  }
  if (config.contextPartyId) {
    headers.ContextPartyID = config.contextPartyId;
  }
  return { headers, mode: "oauth" };
}

async function getOAuthToken(config) {
  if (!config.clientId || !config.clientSecret) {
    throw new Error("AP_CLIENT_ID and AP_CLIENT_SECRET are required when AP_API_KEY is not set");
  }

  if (
    cachedToken &&
    cachedToken.baseUrl === config.baseUrl &&
    cachedToken.clientId === config.clientId &&
    cachedToken.expiresAt > Date.now() + TOKEN_SAFETY_WINDOW_MS
  ) {
    return cachedToken;
  }

  const tokenUrl = joinUrl(config.baseUrl, "oauth/token");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: body.toString()
  });

  if (!response.ok) {
    const errorBody = await safeReadBody(response);
    throw new Error(`OAuth token request failed (${response.status} ${response.statusText}): ${errorBody}`);
  }

  const json = await parseJson(response);
  const accessToken = pickString(json?.access_token);
  if (!accessToken) {
    throw new Error("OAuth token response missing access_token");
  }
  const tokenType = pickString(json?.token_type) ?? "Bearer";
  const expiresAt = Date.now() + (normalizeExpires(json?.expires_in) ?? DEFAULT_TOKEN_TTL_MS);

  cachedToken = {
    accessToken,
    tokenType,
    expiresAt,
    baseUrl: config.baseUrl,
    clientId: config.clientId
  };

  return cachedToken;
}

function loadInvoiceDraft() {
  if (!fs.existsSync(INVOICE_PATH)) {
    throw new Error(`Missing invoice draft at ${INVOICE_PATH}`);
  }
  const raw = fs.readFileSync(INVOICE_PATH, "utf8");
  return JSON.parse(raw);
}

function buildOrderFromDraft(draft) {
  const now = new Date();
  const issueDate = parseDate(draft.issueDate) ?? now;
  const dueDate = parseDate(draft.dueDate);
  const orderNumber = draft.number ?? draft.orderNumber ?? `SB-LIVE-${Date.now()}`;
  const currency = (draft.currency ?? "EUR").toUpperCase();
  const currencyMinorUnit = Number.isInteger(draft.currencyMinorUnit) ? draft.currencyMinorUnit : 2;
  const defaultVatRate = typeof draft.defaultVatRate === "number" ? draft.defaultVatRate : 21;

  const buyer = normalizeParty(draft.buyer, "Sandbox Buyer");
  const supplier = normalizeParty(draft.supplier, "Sandbox Supplier");
  const lines = normalizeLines(draft.lines, defaultVatRate, currencyMinorUnit);

  if (lines.length === 0) {
    throw new Error("Invoice draft must include at least one line");
  }

  return {
    orderNumber,
    currency,
    currencyMinorUnit,
    issueDate,
    dueDate,
    buyer,
    supplier,
    lines,
    defaultVatRate
  };
}

function parseDate(value) {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date;
}

function normalizeParty(party = {}, fallbackName) {
  const result = {
    name: party.name ?? fallbackName,
    registrationName: party.registrationName,
    companyId: party.companyId,
    vatId: party.vatId,
    endpoint: party.endpoint,
    address: party.address,
    contact: party.contact
  };
  return pruneEmpty(result);
}

function toMinor(amount, minorUnit) {
  const factor = 10 ** minorUnit;
  return Math.round(Number(amount || 0) * factor);
}

function formatAmount(minor, minorUnit) {
  if (typeof minor !== "number" || !Number.isFinite(minor)) {
    return undefined;
  }
  return (minor / 10 ** minorUnit).toFixed(minorUnit);
}

function formatIsoDate(value) {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function mapBillitAddress(address) {
  if (!address) {
    return undefined;
  }
  return pruneEmpty({
    street: address.streetName,
    street2: address.additionalStreetName,
    buildingNumber: address.buildingNumber,
    city: address.cityName,
    postalCode: address.postalZone,
    countryCode: address.countryCode
  });
}

function mapBillitContact(contact) {
  if (!contact) {
    return undefined;
  }
  return pruneEmpty({
    name: contact.name,
    telephone: contact.telephone,
    email: contact.electronicMail
  });
}

function mapBillitParty(party) {
  if (!party) {
    return {};
  }
  return pruneEmpty({
    name: party.name,
    registrationName: party.registrationName,
    companyId: party.companyId,
    vatNumber: party.vatId,
    endpoint: party.endpoint?.id,
    endpointScheme: party.endpoint?.scheme,
    address: mapBillitAddress(party.address),
    contact: mapBillitContact(party.contact)
  });
}

function mapBillitTotals(totals, minorUnit) {
  if (!totals) {
    return undefined;
  }
  return pruneEmpty({
    lineExtension: formatAmount(totals.lineExtensionTotalMinor, minorUnit),
    taxTotal: formatAmount(totals.taxTotalMinor, minorUnit),
    payable: formatAmount(totals.payableAmountMinor, minorUnit),
    allowanceTotal: formatAmount(totals.allowanceTotalMinor, minorUnit),
    chargeTotal: formatAmount(totals.chargeTotalMinor, minorUnit),
    rounding: totals.roundingMinor
  });
}

function extractRegistrationCompany(entry) {
  if (!entry) {
    return undefined;
  }
  const companies = asArray(entry.Companies ?? entry.companies);
  const company = companies.length > 0 ? asRecord(companies[0]) : undefined;
  if (!company) {
    return undefined;
  }
  const details = asRecord(company.CompanyDetails ?? company.companyDetails);
  if (!details) {
    return undefined;
  }
  return pruneEmpty({
    name: pickString(details.CompanyName ?? details.companyName),
    vatNumber: pickString(details.TaxIdentifier ?? details.taxIdentifier)
  });
}

function normalizeLines(linesInput, defaultVatRate, minorUnit) {
  const lines = Array.isArray(linesInput) ? linesInput : [];
  return lines.map((line, index) => {
    const quantity = Number(line.quantity ?? line.qty ?? 1) || 1;
    const unitPriceMinor =
      line.unitPriceMinor != null ? Number(line.unitPriceMinor) : toMinor(line.price ?? line.unitPrice ?? 0, minorUnit);
    const discountMinor =
      line.discountMinor != null ? Number(line.discountMinor) : toMinor(line.discount ?? 0, minorUnit);
    const vatRate = line.vatRate != null ? Number(line.vatRate) : defaultVatRate;

    return pruneEmpty({
      description: line.description ?? line.desc ?? `Line ${index + 1}`,
      quantity,
      unitCode: line.unitCode ?? "EA",
      unitPriceMinor,
      discountMinor,
      vatRate,
      vatCategory: line.vatCategory,
      vatExemptionReason: line.vatExemptionReason,
      itemName: line.itemName,
      buyerAccountingReference: line.buyerAccountingReference
    });
  });
}

function buildBillitPayload(order, config, registrationId) {
  const minorUnit = order.currencyMinorUnit ?? 2;
  const defaultVatRate = order.defaultVatRate ?? 0;

  let computedLineTotalMinor = 0;
  let computedVatTotalMinor = 0;

  const lines = order.lines.map((line, index) => {
    const quantity = Number(line.quantity ?? 1) || 1;
    const unitPriceMinor = Number(line.unitPriceMinor ?? 0);
    const discountMinor = Number(line.discountMinor ?? 0);
    const vatRate = line.vatRate != null ? Number(line.vatRate) : defaultVatRate;
    const lineExtensionMinor = Math.max(Math.round(quantity * unitPriceMinor) - discountMinor, 0);
    const vatAmountMinor = Math.round((lineExtensionMinor * (vatRate ?? 0)) / 100);

    computedLineTotalMinor += lineExtensionMinor;
    computedVatTotalMinor += vatAmountMinor;

    return pruneEmpty({
      description: line.description ?? line.itemName ?? `Line ${index + 1}`,
      quantity,
      unitCode: line.unitCode ?? "EA",
      unitPrice: formatAmount(unitPriceMinor, minorUnit),
      vatRate,
      vatAmount: formatAmount(vatAmountMinor, minorUnit),
      lineTotal: formatAmount(lineExtensionMinor, minorUnit),
      discount: formatAmount(discountMinor, minorUnit),
      buyerReference: line.buyerAccountingReference,
      itemName: line.itemName,
      vatCategory: line.vatCategory,
      vatExemptionReason: line.vatExemptionReason
    });
  });

  const registrationCompany = extractRegistrationCompany(config.registrationEntry ?? cachedRegistration?.entry);
  const sellerDetails = mapBillitParty(order.supplier);
  if (registrationCompany) {
    Object.assign(sellerDetails, registrationCompany);
  }

  const totalsSource = order.totals ?? {
    lineExtensionTotalMinor: computedLineTotalMinor,
    taxTotalMinor: computedVatTotalMinor,
    payableAmountMinor: computedLineTotalMinor + computedVatTotalMinor
  };

  const document = pruneEmpty({
    invoiceNumber: order.orderNumber,
    currency: order.currency,
    issueDate: formatIsoDate(order.issueDate),
    dueDate: formatIsoDate(order.dueDate),
    buyer: mapBillitParty(order.buyer),
    seller: sellerDetails,
    totals: mapBillitTotals(totalsSource, minorUnit),
    lines
  });

  const receiverScheme =
    pickString(order.buyer?.endpoint?.scheme) ??
    pickString(config.receiverScheme) ??
    DEFAULT_RECEIVER_SCHEME;
  const receiverValue =
    pickString(order.buyer?.endpoint?.id) ??
    pickString(config.receiverValue) ??
    DEFAULT_RECEIVER_VALUE;

  if (receiverScheme && receiverValue) {
    document.receiver = {
      scheme: receiverScheme,
      value: receiverValue
    };
  }

  const payload = pruneEmpty({
    registrationId,
    transportType: config.transportType,
    documentType: pickString(config.documentType) ?? DEFAULT_DOCUMENT_TYPE,
    documents: [document]
  });

  if (!Array.isArray(payload.documents) || payload.documents.length === 0) {
    payload.documents = [document];
  }

  return payload;
}

async function resolveRegistrationId(config, auth) {
  const now = Date.now();

  if (config.registrationId) {
    const trimmed = config.registrationId.trim();
    if (!trimmed) {
      throw new Error("AP_REGISTRATION_ID cannot be empty");
    }
    config.registrationId = trimmed;
    cachedRegistration = {
      baseUrl: config.baseUrl,
      partyId: config.partyId,
      registrationId: trimmed,
      fetchedAt: now
    };
    return trimmed;
  }

  if (
    cachedRegistration &&
    cachedRegistration.baseUrl === config.baseUrl &&
    cachedRegistration.partyId === (config.partyId ?? undefined) &&
    now - cachedRegistration.fetchedAt < REGISTRATION_CACHE_TTL_MS
  ) {
    return cachedRegistration.registrationId;
  }

  const searchPaths = ["v1/einvoices/registrations", "v1/registrations"];
  const headerVariants = [{ headers: auth.headers, label: auth.mode }];

  if (auth.mode === "api-key" && config.clientId && config.clientSecret) {
    try {
      const oauthAuth = await resolveAuthHeaders({ ...config, apiKey: undefined });
      headerVariants.push({ headers: oauthAuth.headers, label: oauthAuth.mode });
    } catch {
      // ignore oauth fallback errors
    }
  }

  let lastError;
  let lastStructure;

  for (const variant of headerVariants) {
    for (const path of searchPaths) {
      const url = joinUrl(config.baseUrl, path);
      const response = await fetch(url, {
        method: "GET",
        headers: {
          ...variant.headers,
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          continue;
        }
        const errorBody = await safeReadBody(response);
        lastError = new Error(
          `Billit registrations lookup failed (${response.status} ${response.statusText}) auth=${variant.label} path=${path}: ${errorBody}`
        );
        continue;
      }

      let matchedEntry;
      const payload = await parseJson(response);
      const registrationId = extractRegistrationId(
        payload,
        config.partyId,
        config.transportType,
        (entry) => {
          matchedEntry = entry;
        }
      );
      if (registrationId) {
        cachedRegistration = {
          baseUrl: config.baseUrl,
          partyId: config.partyId,
          registrationId,
          fetchedAt: now,
          entry: matchedEntry
        };
        config.registrationId = registrationId;
        if (matchedEntry) {
          config.registrationEntry = matchedEntry;
        }
        return registrationId;
      }

      lastStructure = describeRegistrationPayload(payload);
      console.warn(
        "Billit registration payload missing id:",
        `auth=${variant.label} path=${path} structure=${lastStructure}`
      );
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(
    `Unable to determine Billit registration id. Provide AP_REGISTRATION_ID or ensure the account has an active registration.${lastStructure ? ` Last payload: ${lastStructure}` : ''}`
  );
}

function extractRegistrationId(payload, preferred, transportType, onEntry) {
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const candidate = selectRegistrationId(entry, preferred, transportType);
      if (candidate) {
        const record = asRecord(entry);
        if (record && typeof onEntry === "function") {
          onEntry(record);
        }
        return candidate;
      }
    }
    return undefined;
  }

  const root = asRecord(payload);
  if (!root) {
    return undefined;
  }

  const direct = selectRegistrationId(root, preferred, transportType);
  if (direct) {
    if (typeof onEntry === "function") {
      onEntry(root);
    }
    return direct;
  }

  const collections = [];
  const collectionKeys = [
    "Companies",
    "companies",
    "Registrations",
    "registrations",
    "data",
    "items",
    "results"
  ];
  for (const key of collectionKeys) {
    const value = root[key];
    if (Array.isArray(value)) {
      collections.push(...value);
    }
  }

  for (const entry of collections) {
    const candidate = selectRegistrationId(entry, preferred, transportType);
    if (candidate) {
      const record = asRecord(entry);
      if (record && typeof onEntry === "function") {
        onEntry(record);
      }
      return candidate;
    }
  }

  for (const value of Object.values(root)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const candidate = selectRegistrationId(entry, preferred, transportType);
        if (candidate) {
          const record = asRecord(entry);
          if (record && typeof onEntry === "function") {
            onEntry(record);
          }
          return candidate;
        }
      }
    }
  }

  return undefined;
}

function selectRegistrationId(record, preferred, transportType) {
  const ids = collectCandidateIds(record);
  if (preferred) {
    const normalized = preferred.trim();
    const match = ids.find((id) => id === normalized);
    if (match) {
      return match;
    }
  }

  const integrations = asArray(record.Integrations ?? record.integrations);
  if (integrations.length > 0) {
    const normalizedTransport = (transportType ?? "").trim().toLowerCase();
    for (const integrationEntry of integrations) {
      const integration = asRecord(integrationEntry);
      if (!integration) {
        continue;
      }
      const integrationName = pickString(
        integration.Integration ??
          integration.integration ??
          integration.ExternalProvider ??
          integration.externalProvider ??
          integration.Provider ??
          integration.provider
      );
      if (integrationName && integrationName.trim().toLowerCase() === normalizedTransport) {
        if (ids.length > 0) {
          return ids[0];
        }
      }
    }
  }

  if (ids.length > 0) {
    return ids[0];
  }

  return undefined;
}

function collectCandidateIds(record) {
  const candidates = [];
  const keys = [
    "RegistrationID",
    "registrationID",
    "RegistrationId",
    "registrationId",
    "registration_id",
    "RegistrationGuid",
    "registrationGuid",
    "RegistrationGUID",
    "registrationGUID",
    "CompanyID",
    "companyID",
    "CompanyId",
    "companyId",
    "PartyID",
    "partyID",
    "PartyId",
    "partyId",
    "id",
    "ID",
    "Guid",
    "guid",
    "GUID"
  ];

  for (const key of keys) {
    const value = record[key];
    const id = pickId(value);
    if (id && !candidates.includes(id)) {
      candidates.push(id);
    }
  }

  for (const value of Object.values(record)) {
    if (!value) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          for (const nested of collectCandidateIds(entry)) {
            if (!candidates.includes(nested)) {
              candidates.push(nested);
            }
          }
        }
      }
      continue;
    }
    if (typeof value === "object") {
      for (const nested of collectCandidateIds(value)) {
        if (!candidates.includes(nested)) {
          candidates.push(nested);
        }
      }
    }
  }

  return candidates;
}

function pickId(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return undefined;
}

function describeRegistrationPayload(payload) {
  if (Array.isArray(payload)) {
    const length = payload.length;
    const first = payload[0];
    const firstKeys =
      first && typeof first === "object" && !Array.isArray(first)
        ? Object.keys(first).slice(0, 8)
        : [];
    return `array(len=${length}, firstKeys=${firstKeys.join(",")})`;
  }

  const record = asRecord(payload);
  if (!record) {
    return `type=${typeof payload}`;
  }

  const keys = Object.keys(record);
  const previewKeys = keys.slice(0, 8).join(",");

  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value) && value.length > 0) {
      const nested = value[0];
      const nestedKeys =
        nested && typeof nested === "object" && !Array.isArray(nested)
          ? Object.keys(nested).slice(0, 8)
          : [];
      return `object(keys=${previewKeys}, firstArray=${key}, firstArrayKeys=${nestedKeys.join(",")})`;
    }
  }

  return `object(keys=${previewKeys})`;
}

function toAmount(minor, minorUnit) {
  const divider = 10 ** minorUnit;
  return Number((minor / divider).toFixed(minorUnit));
}

async function pollStatusOnce(config, auth, providerId) {
  const registrationId = await resolveRegistrationId(config, auth);
  const targetUrl = joinUrl(
    config.baseUrl,
    `/v1/einvoices/registrations/${encodeURIComponent(registrationId)}/orders/${encodeURIComponent(providerId)}`
  );

  const response = await fetch(targetUrl, {
    method: "GET",
    headers: {
      ...auth.headers,
      Accept: "application/json"
    }
  });

  const payload = await parseJson(response);

  if (response.status === 404) {
    return "error";
  }

  if (!response.ok) {
    const errorBody = await safeReadBody(response, payload);
    throw new Error(
      `Status check failed (${response.status} ${response.statusText}): ${errorBody}`
    );
  }

  const provider = extractProviderResponse(payload);
  const status = mapProviderDeliveryStatus(provider.status);
  if (status !== "queued") {
    return status;
  }
  const deliveryStatus = extractDocumentDeliveryStatus(payload);
  return mapProviderDeliveryStatus(deliveryStatus);
}

function joinUrl(base, suffix) {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = suffix.startsWith("/") ? suffix.slice(1) : suffix;
  return `${normalizedBase}/${normalizedPath}`;
}

async function parseJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function safeReadBody(response, parsed) {
  if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
    try {
      return JSON.stringify(parsed);
    } catch {
      // fall through
    }
  }
  try {
    const text = await response.text();
    return text || "<empty>";
  } catch (error) {
    return `failed to read body: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function pickString(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return undefined;
}

function normalizeExpires(expires) {
  if (typeof expires === "number" && Number.isFinite(expires)) {
    return expires * 1000;
  }
  if (typeof expires === "string") {
    const parsed = Number.parseInt(expires, 10);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed * 1000;
    }
  }
  return undefined;
}

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractOrderIdFromList(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const id = pickString(
      record.OrderID ?? record.orderID ?? record.orderId ?? record.id ?? record.ID
    );
    if (id) {
      return id;
    }
  }
  return undefined;
}

function extractProviderResponse(payload) {
  const candidate = asRecord(payload);
  if (!candidate) {
    throw new Error("Billit response did not include a JSON object");
  }

  const nested =
    asRecord(candidate.data) ??
    asRecord(candidate.payload) ??
    asRecord(candidate.result) ??
    asRecord(candidate.response);

  const orderRecord =
    asRecord(candidate.order) ??
    asRecord(candidate.Order) ??
    (nested && (asRecord(nested.order) ?? asRecord(nested.Order)));

  const providerId =
    pickString(candidate.OrderID ?? candidate.orderID ?? candidate.orderId) ??
    pickString(orderRecord?.OrderID ?? orderRecord?.orderId) ??
    pickString(nested?.OrderID ?? nested?.orderId) ??
    pickString(candidate.providerId) ??
    pickString(candidate.id) ??
    pickString(orderRecord?.Id) ??
    pickString(nested?.id) ??
    extractOrderIdFromList(candidate.orders) ??
    extractOrderIdFromList(nested?.orders);

  if (!providerId) {
    throw new Error("Billit response did not include an order identifier");
  }

  const status =
    pickString(candidate.status ?? candidate.Status) ??
    pickString(orderRecord?.status ?? orderRecord?.Status) ??
    pickString(nested?.status ?? nested?.Status) ??
    extractDocumentDeliveryStatus(candidate) ??
    extractDocumentDeliveryStatus(orderRecord) ??
    extractDocumentDeliveryStatus(nested);

  const message =
    pickString(candidate.message ?? candidate.Message ?? candidate.detail ?? candidate.Detail) ??
    pickFirstError(candidate.errors ?? candidate.Errors) ??
    pickFirstError(orderRecord?.Errors ?? orderRecord?.errors) ??
    pickFirstError(nested?.Errors ?? nested?.errors);

  return {
    providerId,
    status,
    message
  };
}

function pickFirstError(value) {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const record = asRecord(entry);
      if (record) {
        const message = pickString(
          record.Description ??
            record.description ??
            record.Detail ??
            record.detail ??
            record.Message ??
            record.message
        );
        if (message) {
          return message;
        }
      }
      const text = pickString(entry);
      if (text) {
        return text;
      }
    }
    return undefined;
  }
  const record = asRecord(value);
  if (record) {
    return pickString(
      record.Description ?? record.description ?? record.Detail ?? record.detail ?? record.Message ?? record.message
    );
  }
  return pickString(value);
}

function extractDocumentDeliveryStatus(payload) {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }

  const details =
    asRecord(record.CurrentDocumentDeliveryDetails ?? record.currentDocumentDeliveryDetails) ??
    asRecord(record.DocumentDeliveryDetails ?? record.documentDeliveryDetails);

  if (details) {
    return (
      pickString(
        details.DocumentDeliveryStatus ??
          details.documentDeliveryStatus ??
          details.Status ??
          details.status
      ) ?? (details.IsDocumentDelivered ? "Delivered" : undefined)
    );
  }

  const fallbacks = ["order", "Order", "data", "payload", "result", "response"];
  for (const key of fallbacks) {
    const nested = record[key];
    if (nested) {
      const status = extractDocumentDeliveryStatus(nested);
      if (status) {
        return status;
      }
    }
  }

  return undefined;
}

function mapProviderSendStatus(status) {
  const normalized = status ? String(status).trim().toLowerCase() : "";
  if (!normalized) {
    return "queued";
  }
  if (["queued", "pending", "processing", "received", "created", "accepted"].includes(normalized)) {
    return "queued";
  }
  if (["sent", "submitted", "transmitted", "completed", "processed", "success"].includes(normalized)) {
    return "sent";
  }
  if (["failed", "error", "rejected", "declined"].includes(normalized)) {
    return "error";
  }
  return "queued";
}

function mapProviderDeliveryStatus(status) {
  const normalized = status ? String(status).trim().toLowerCase() : "";
  if (!normalized) {
    return "queued";
  }
  if (["queued", "pending", "processing", "received", "accepted"].includes(normalized)) {
    return "queued";
  }
  if (["sent", "submitted", "transmitted"].includes(normalized)) {
    return "sent";
  }
  if (["delivered", "completed", "processed", "success", "done"].includes(normalized)) {
    return "delivered";
  }
  if (["failed", "error", "rejected", "declined"].includes(normalized)) {
    return "error";
  }
  return "sent";
}

function pruneEmpty(input) {
  if (!input || typeof input !== "object") {
    return input;
  }
  const output = Array.isArray(input) ? [] : {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      output[key] = trimmed;
      continue;
    }
    if (Array.isArray(value)) {
      const pruned = value
        .map((entry) => pruneEmpty(entry))
        .filter((entry) => entry !== undefined && entry !== null);
      if (pruned.length === 0) {
        continue;
      }
      output[key] = pruned;
      continue;
    }
    if (typeof value === "object") {
      const nested = pruneEmpty(value);
      if (Object.keys(nested).length === 0) {
        continue;
      }
      output[key] = nested;
      continue;
    }
    output[key] = value;
  }
  return output;
}

function toIsoDate(value) {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function redactHeaders(headers) {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") {
      sanitized[key] = value;
      continue;
    }
    const lower = key.toLowerCase();
    if (lower === "apikey" || lower === "api-key") {
      sanitized[key] = "***present***";
    } else if (lower === "authorization") {
      const [scheme] = value.split(/\s+/, 1);
      sanitized[key] = `${scheme ?? "Bearer"} ***present***`;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function buildIdempotencyKey(config, orderNumber) {
  const parts = [config.registrationId, orderNumber];
  const raw = parts
    .filter(Boolean)
    .join(":")
    .replace(/\s+/g, "-")
    .slice(0, 255);
  return raw || randomUUID();
}
