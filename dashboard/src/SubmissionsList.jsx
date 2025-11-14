import { useEffect, useState } from "react";
import { listSubmissions } from "./api";

const STATUS_OPTIONS = ["", "PENDING", "DELIVERED", "QUEUED", "ERROR", "UNKNOWN"];

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export default function SubmissionsList({ onSelectSubmission }) {
  const [filters, setFilters] = useState({
    status: "",
    q: "",
    from: "",
    to: ""
  });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState("");

  async function loadSubmissions(signal) {
    setLoading(true);
    setError("");
    try {
      const response = await listSubmissions({
        status: filters.status || undefined,
        q: filters.q || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined
      });
      if (signal?.aborted) {
        return;
      }
      const nextItems = Array.isArray(response?.items) ? response.items : [];
      setItems(nextItems);
      setLastRefreshed(new Date().toISOString());
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : "Failed to load submissions");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadSubmissions(controller.signal);
    return () => controller.abort();
  }, [filters.status, filters.q, filters.from, filters.to]);

  function updateFilter(key, value) {
    setFilters((prev) => ({
      ...prev,
      [key]: value
    }));
  }

  function resetFilters() {
    setFilters({
      status: "",
      q: "",
      from: "",
      to: ""
    });
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Submissions</h2>
          <p className="muted">Read-only view of the latest ViDA submissions.</p>
        </div>
        <div className="panel-actions">
          <button type="button" className="ghost" onClick={resetFilters}>
            Reset
          </button>
          <button type="button" onClick={() => loadSubmissions()}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="filters">
        <label>
          Search
          <input
            type="search"
            placeholder="Invoice, doc ID, tenant..."
            value={filters.q}
            onChange={(event) => updateFilter("q", event.target.value)}
          />
        </label>
        <label>
          Status
          <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option || "all"} value={option}>
                {option ? option : "All"}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="datetime-local" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} />
        </label>
        <label>
          To
          <input type="datetime-local" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} />
        </label>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Invoice ID</th>
              <th>Document ID</th>
              <th>External Ref</th>
              <th>Status</th>
              <th>Tenant</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="muted center">
                  No submissions match the current filters.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.invoiceId} onClick={() => onSelectSubmission?.(item.invoiceId)}>
                <td>
                  <button type="button" className="linkish">
                    {item.invoiceId}
                  </button>
                </td>
                <td>{item.documentId ?? "—"}</td>
                <td>{item.externalReference ?? "—"}</td>
                <td>
                  <span className={`status-pill status-${(item.status || "unknown").toLowerCase()}`}>
                    {item.status ?? "UNKNOWN"}
                  </span>
                </td>
                <td>{item.tenant}</td>
                <td>{formatDate(item.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="panel-footer">
        <span className="muted">
          Showing {items.length} item{items.length === 1 ? "" : "s"}
        </span>
        {lastRefreshed && <span className="muted">Last synced: {formatDate(lastRefreshed)}</span>}
      </footer>
    </section>
  );
}
