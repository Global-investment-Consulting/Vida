import { useCallback, useEffect, useState } from "react";
import { apiFetch, listSubmissions } from "./api";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export default function Health() {
  const [basic, setBasic] = useState("");
  const [ready, setReady] = useState(null);
  const [webhookSeenAt, setWebhookSeenAt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [health, readiness, submissions] = await Promise.all([
        apiFetch("/_health", { skipAuth: true }),
        apiFetch("/health/ready", { skipAuth: true }),
        listSubmissions({ limit: 1 })
      ]);
      setBasic(typeof health === "string" ? health : "ok");
      setReady(readiness);
      const latest = submissions?.items?.[0];
      setWebhookSeenAt(latest?.updatedAt ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load health information");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const readyChecks = Array.isArray(ready?.checks) ? ready.checks : [];

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Service health</h2>
          <p className="muted">Cloud Run readiness and webhook freshness.</p>
        </div>
        <div className="panel-actions">
          <button type="button" onClick={refresh}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="health-cards">
        <article>
          <h3>/_health</h3>
          <p className={basic === "ok" ? "ok" : "error"}>{basic || "unknown"}</p>
        </article>
        <article>
          <h3>/health/ready</h3>
          <p className={ready?.ok ? "ok" : "error"}>{ready?.ok ? "passing" : "failing"}</p>
          <ul>
            {readyChecks.map((check) => (
              <li key={check.name}>
                <span>{check.name}</span>
                <span className={check.status === "ok" ? "ok" : check.status === "warn" ? "warn" : "error"}>
                  {check.status}
                </span>
              </li>
            ))}
          </ul>
        </article>
        <article>
          <h3>Webhook last seen</h3>
          <p>{webhookSeenAt ? formatDate(webhookSeenAt) : "No submissions yet"}</p>
        </article>
      </div>
    </section>
  );
}
