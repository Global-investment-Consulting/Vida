import { useEffect, useState } from "react";
import { fetchSubmission, resendSubmission } from "./api";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

const TABS = [
  { id: "request", label: "Request" },
  { id: "patched", label: "Patched UBL" },
  { id: "scrada", label: "Scrada" }
];

export default function SubmissionDetail({ invoiceId, onBack }) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("request");
  const [resending, setResending] = useState(false);

  async function loadDetails(signal) {
    setLoading(true);
    setError("");
    try {
      const response = await fetchSubmission(invoiceId);
      if (signal?.aborted) {
        return;
      }
      setRecord(response);
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : "Failed to load submission");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadDetails(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  async function handleResend() {
    setResending(true);
    setError("");
    setMessage("");
    try {
      const response = await resendSubmission(invoiceId);
      setMessage(`Resend requested. New invoice ID: ${response.invoiceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resend failed");
    } finally {
      setResending(false);
    }
  }

  const history = Array.isArray(record?.history) ? record.history : [];
  const attempts = Array.isArray(record?.attempts) ? record.attempts : [];

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <button type="button" className="ghost" onClick={onBack}>
            ← Back to list
          </button>
          <h2>Submission detail</h2>
          <p className="muted">
            Invoice <strong>{invoiceId}</strong>
          </p>
        </div>
        <div className="panel-actions">
          <button type="button" className="ghost" onClick={() => loadDetails()}>
            Reload
          </button>
          <button type="button" onClick={handleResend} disabled={resending}>
            {resending ? "Resending..." : "Resend"}
          </button>
        </div>
      </div>

      {loading && <div className="alert">Loading submission details…</div>}
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      {record && (
        <>
          <div className="detail-grid">
            <div>
              <p className="label">Document ID</p>
              <p>{record.documentId ?? "—"}</p>
            </div>
            <div>
              <p className="label">Status</p>
              <p>{record.statusSnapshot?.normalizedStatus ?? record.submission?.status ?? "UNKNOWN"}</p>
            </div>
            <div>
              <p className="label">External Reference</p>
              <p>{record.submission?.externalReference ?? "—"}</p>
            </div>
            <div>
              <p className="label">Tenant</p>
              <p>{record.submission?.tenant}</p>
            </div>
            <div>
              <p className="label">Updated at</p>
              <p>{formatDate(record.submission?.updatedAt)}</p>
            </div>
          </div>

          <div className="tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="tab-body">
            {activeTab === "request" && (
              <pre>{record.dto ? JSON.stringify(record.dto, null, 2) : "Request payload unavailable."}</pre>
            )}
            {activeTab === "patched" && (
              <pre className="code">{record.patchedUbl ?? "Patched UBL unavailable."}</pre>
            )}
            {activeTab === "scrada" && (
              <div className="flow">
                <div>
                  <p className="label">Scrada status</p>
                  <p>{record.statusSnapshot?.status ?? "unknown"}</p>
                </div>
                <div>
                  <p className="label">Scrada document</p>
                  <p>{record.statusSnapshot?.documentId ?? record.sendRecord?.documentId ?? "—"}</p>
                </div>
                <div>
                  <p className="label">Attempts</p>
                  <p>{attempts.length}</p>
                </div>
                <div>
                  <p className="label">Last fetched</p>
                  <p>{formatDate(record.statusSnapshot?.fetchedAt)}</p>
                </div>
                <h4>Attempts</h4>
                {attempts.length === 0 && <p className="muted">No send attempts recorded.</p>}
                {attempts.length > 0 && (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Channel</th>
                          <th>Status</th>
                          <th>Success</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attempts.map((attempt) => (
                          <tr key={attempt.attempt}>
                            <td>{attempt.attempt}</td>
                            <td>{attempt.channel}</td>
                            <td>{attempt.statusCode ?? "—"}</td>
                            <td>{attempt.success ? "Yes" : "No"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="timeline">
            <h3>Timeline</h3>
            {history.length === 0 && <p className="muted">No history recorded for this invoice.</p>}
            {history.map((event) => (
              <div key={`${event.timestamp}-${event.requestId ?? ""}`} className="timeline-event">
                <div>
                  <p className="label">{formatDate(event.timestamp)}</p>
                  <p>{event.status?.toUpperCase()}</p>
                </div>
                <div>
                  <p className="label">Peppol status</p>
                  <p>{event.peppolStatus ?? "—"}</p>
                </div>
                {event.error && (
                  <div>
                    <p className="label">Error</p>
                    <p className="error-text">{event.error}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="artifacts">
            <h3>Artifacts</h3>
            <ul>
              <li>
                <span>Request</span>
                <code>{record.artifacts?.requestPath ?? "n/a"}</code>
              </li>
              <li>
                <span>Send</span>
                <code>{record.artifacts?.sendPath ?? "n/a"}</code>
              </li>
              <li>
                <span>Status</span>
                <code>{record.artifacts?.statusPath ?? "n/a"}</code>
              </li>
              <li>
                <span>Patched XML</span>
                <code>{record.artifacts?.patchedPath ?? "n/a"}</code>
              </li>
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
