import React, { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const KEY = import.meta.env.VITE_API_KEY || "key_test_12345";

async function api(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  headers.set("Authorization", `Bearer ${KEY}`);
  if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers,
    mode: "cors",
    credentials: "omit",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.blob();
}

export default function App() {
  const [invoices, setInvoices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function refresh() {
    setErr("");
    try {
      const data = await api(`/v1/invoices?limit=10`, { method: "GET" });
      setInvoices(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      setErr(e.message || "Failed to fetch");
    }
  }

  async function createInvoice() {
    setBusy(true);
    setErr("");
    try {
      const body = {
        externalId: "ext_" + Math.random().toString(36).slice(2, 10),
        currency: "EUR",
        buyer: { name: "Test Buyer", vatId: "BE0123456789", email: "buyer@example.com" },
        lines: [{ description: "Service", quantity: 1, unitPriceMinor: 12345, vatRate: 21 }]
      };
      await api("/v1/invoices", { method: "POST", body });
      await refresh();
    } catch (e) {
      setErr(e.message || "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  function openDoc(inv, kind) {
    // Use query token so it opens nicely in a new tab
    const url = `${API}/v1/invoices/${inv.id}/${kind}?access_token=${encodeURIComponent(KEY)}`;
    window.open(url, "_blank");
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1>ViDA Dashboard</h1>
      <p><strong>API:</strong> <a href={API} target="_blank" rel="noreferrer">{API}</a></p>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <button onClick={refresh} disabled={busy}>Refresh</button>
        <button onClick={createInvoice} disabled={busy}>Create invoice</button>
      </div>
      {err && <div style={{ color: "crimson", marginBottom: 12 }}>Error: {err}</div>}
      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>ID</th><th>Number</th><th>Status</th><th>Buyer</th><th>Gross</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td>{inv.id}</td>
              <td>{inv.number}</td>
              <td>{inv.status}</td>
              <td>{inv.buyerName || inv.buyer?.name}</td>
              <td>{inv.gross ?? inv.totalMinor}</td>
              <td>
                <button onClick={() => openDoc(inv, "pdf")}>PDF</button>{" "}
                <button onClick={() => openDoc(inv, "xml")}>XML</button>
              </td>
            </tr>
          ))}
          {invoices.length === 0 && (
            <tr><td colSpan="6" style={{ color: "#666" }}>No invoices yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
