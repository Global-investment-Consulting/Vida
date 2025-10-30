import { useEffect, useState } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:3001";
const API_KEY = import.meta.env.VITE_API_KEY || "key_test_12345";
const TENANT = import.meta.env.VITE_TENANT || "";
const HISTORY_LIMIT = 20;
const DLQ_LIMIT = 25;

async function api(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  headers.set("x-api-key", API_KEY);
  if (TENANT) {
    headers.set("x-vida-tenant", TENANT);
  }
  if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    mode: "cors",
    credentials: "omit"
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return res.json();
  }
  if (ct.includes("text/plain")) {
    return res.text();
  }
  return res.blob();
}

function createDemoOrder() {
  const now = new Date();
  const orderNumber = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return {
    orderNumber,
    currency: "EUR",
    issueDate: now.toISOString().slice(0, 10),
    buyer: {
      name: "Acme GmbH",
      endpoint: { id: "9915:acme", scheme: "9915" },
      address: {
        streetName: "Alexanderplatz 1",
        cityName: "Berlin",
        postalZone: "10178",
        countryCode: "DE"
      },
      contact: {
        name: "Christina Berg",
        electronicMail: "accounting@acme.example"
      }
    },
    supplier: {
      name: "Vida Demo BV",
      registrationName: "Vida Demo BV",
      vatId: "BE0123456789",
      endpoint: { id: "0088:vida", scheme: "0088" },
      address: {
        streetName: "Rue Exemple 1",
        cityName: "Brussels",
        postalZone: "1000",
        countryCode: "BE"
      },
      contact: {
        name: "Vida Ops",
        electronicMail: "ops@vida.example"
      }
    },
    lines: [
      {
        description: "Consulting retainer",
        quantity: 1,
        unitPriceMinor: 50000,
        vatRate: 21
      },
      {
        description: "Implementation hours",
        quantity: 10,
        unitPriceMinor: 9000,
        discountMinor: 1000,
        vatRate: 21
      }
    ],
    defaultVatRate: 21
  };
}

function formatTimestamp(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value ?? "-";
  }
}

export default function App() {
  const [view, setView] = useState("history");
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [dlqItems, setDlqItems] = useState([]);
  const [dlqLoading, setDlqLoading] = useState(false);
  const [opsError, setOpsError] = useState("");
  const [opsMessage, setOpsMessage] = useState("");
  const [metricsText, setMetricsText] = useState("");

  async function refreshHistory() {
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(HISTORY_LIMIT) });
      if (TENANT) {
        params.set("tenant", TENANT);
      }
      const data = await api(`/history?${params.toString()}`, { method: "GET" });
      const list = Array.isArray(data?.history) ? data.history : [];
      setHistory(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    }
  }

  async function createInvoice() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const demoOrder = createDemoOrder();
      const response = await api("/api/invoice", { method: "POST", body: demoOrder });
      if (response instanceof Blob) {
        const url = URL.createObjectURL(response);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 15000);
        setMessage("Invoice generated and opened as XML.");
      } else {
        setMessage("Invoice generated.");
      }
      await refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invoice");
    } finally {
      setBusy(false);
    }
  }

  async function downloadXml(record) {
    if (!record.invoiceId) {
      setError("Invoice ID unavailable for this record.");
      return;
    }
    try {
      const blob = await api(`/invoice/${encodeURIComponent(record.invoiceId)}`, { method: "GET" });
      if (!(blob instanceof Blob)) {
        setError("Unexpected response while downloading invoice.");
        return;
      }
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download invoice");
    }
  }

  async function refreshStatus(record) {
    if (!record.invoiceId) {
      setError("Invoice ID unavailable for this record.");
      return;
    }
    try {
      const data = await api(`/invoice/${encodeURIComponent(record.invoiceId)}/status`, { method: "GET" });
      setHistory((prev) =>
        prev.map((item) =>
          item.invoiceId === record.invoiceId
            ? {
                ...item,
                peppolStatus: data?.status ?? item.peppolStatus,
                peppolId: data?.providerId ?? item.peppolId
              }
            : item
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh status");
    }
  }

  async function refreshDlq() {
    setDlqLoading(true);
    setOpsError("");
    setOpsMessage("");
    try {
      const data = await api(`/ops/dlq?limit=${DLQ_LIMIT}`, { method: "GET" });
      setDlqItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setOpsError(e instanceof Error ? e.message : "Failed to load DLQ items");
    } finally {
      setDlqLoading(false);
    }
  }

  async function refreshMetrics() {
    setOpsError("");
    try {
      const text = await api("/metrics", { method: "GET" });
      setMetricsText(typeof text === "string" ? text : "");
    } catch (e) {
      setOpsError(e instanceof Error ? e.message : "Failed to load metrics");
    }
  }

  async function retryDlq(item) {
    if (!item?.id && !item?.invoiceId) {
      setOpsError("Unable to retry DLQ entry without an identifier.");
      return;
    }
    setOpsError("");
    setOpsMessage("");
    try {
      const identifier = encodeURIComponent(item.id ?? `${item.tenant}:${item.invoiceId}`);
      await api(`/ops/dlq/${identifier}/retry`, { method: "POST" });
      setOpsMessage("Retry request accepted (placeholder — no action performed).");
    } catch (e) {
      setOpsError(e instanceof Error ? e.message : "Failed to trigger retry");
    }
  }

  useEffect(() => {
    void refreshHistory();
  }, []);

  useEffect(() => {
    if (view === "ops") {
      void (async () => {
        await refreshDlq();
        await refreshMetrics();
      })();
    }
  }, [view]);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1>ViDA Dashboard</h1>
      <p>
        <strong>API:</strong>{" "}
        <a href={API_BASE} target="_blank" rel="noreferrer">
          {API_BASE}
        </a>
      </p>
      {TENANT && (
        <p>
          <strong>Tenant:</strong> {TENANT}
        </p>
      )}

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <button onClick={() => setView("history")} disabled={view === "history"}>
          History
        </button>
        <button onClick={() => setView("ops")} disabled={view === "ops"}>
          Ops
        </button>
      </div>

      {view === "history" ? (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <button onClick={refreshHistory} disabled={busy}>
              Refresh history
            </button>
            <button onClick={createInvoice} disabled={busy}>
              Generate invoice (XML)
            </button>
          </div>
          {error && <div style={{ color: "crimson", marginBottom: 12 }}>Error: {error}</div>}
          {message && <div style={{ color: "seagreen", marginBottom: 12 }}>{message}</div>}
          <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th>Timestamp</th>
                <th>Invoice ID</th>
                <th>Status</th>
                <th>AP Status</th>
                <th>AP Provider</th>
                <th>Duration (ms)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.map((record) => (
                <tr key={`${record.requestId}-${record.timestamp}`} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td>{formatTimestamp(record.timestamp)}</td>
                  <td>{record.invoiceId ?? "-"}</td>
                  <td>{record.status}</td>
                  <td>{record.peppolStatus ?? "-"}</td>
                  <td>{record.peppolId ?? "-"}</td>
                  <td>{record.durationMs}</td>
                  <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => refreshStatus(record)} disabled={!record.invoiceId || busy}>
                      Refresh status
                    </button>
                    <button onClick={() => downloadXml(record)} disabled={!record.invoiceId}>
                      Download XML
                    </button>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ color: "#666" }}>
                    No history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <button onClick={refreshDlq} disabled={dlqLoading}>
              Refresh DLQ
            </button>
            <button onClick={refreshMetrics}>Refresh metrics</button>
          </div>
          {opsError && <div style={{ color: "crimson", marginBottom: 12 }}>Ops error: {opsError}</div>}
          {opsMessage && <div style={{ color: "seagreen", marginBottom: 12 }}>{opsMessage}</div>}

          <section style={{ marginBottom: 24 }}>
            <h2>Dead Letter Queue</h2>
            <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                  <th>ID</th>
                  <th>Tenant</th>
                  <th>Invoice</th>
                  <th>Timestamp</th>
                  <th>Error</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dlqItems.map((item) => (
                  <tr key={item.id ?? `${item.tenant}-${item.invoiceId}-${item.ts}`} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td>{item.id ?? "n/a"}</td>
                    <td>{item.tenant}</td>
                    <td>{item.invoiceId}</td>
                    <td>{formatTimestamp(item.ts)}</td>
                    <td style={{ maxWidth: 360, whiteSpace: "pre-wrap" }}>{item.error}</td>
                    <td>
                      <button onClick={() => retryDlq(item)}>Retry (placeholder)</button>
                    </td>
                  </tr>
                ))}
                {dlqItems.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ color: "#666" }}>
                      {dlqLoading ? "Loading DLQ entries..." : "DLQ empty."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Metrics Snapshot</h2>
            <pre
              style={{
                background: "#111",
                color: "#0f0",
                padding: 16,
                borderRadius: 4,
                maxHeight: 320,
                overflowY: "auto"
              }}
            >
              {metricsText || "# No metrics available."}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}
