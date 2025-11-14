import { useState } from "react";
import SubmissionsList from "./SubmissionsList.jsx";
import SubmissionDetail from "./SubmissionDetail.jsx";
import Health from "./Health.jsx";
import "./App.css";

export default function App() {
  const [view, setView] = useState("submissions");
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const showList = view === "submissions" && !selectedInvoice;
  const showDetail = view === "submissions" && Boolean(selectedInvoice);

  return (
    <div className="app-shell">
      <header>
        <div>
          <p className="eyebrow">Vida internal</p>
          <h1>Operator dashboard</h1>
          <p className="muted">Read-first view of submissions flowing through the staging service.</p>
        </div>
        <nav>
          <button
            type="button"
            className={view === "submissions" ? "active" : ""}
            onClick={() => {
              setView("submissions");
              setSelectedInvoice(null);
            }}
          >
            Submissions
          </button>
          <button
            type="button"
            className={view === "health" ? "active" : ""}
            onClick={() => {
              setView("health");
              setSelectedInvoice(null);
            }}
          >
            Health
          </button>
        </nav>
      </header>

      <main>
        {showList && (
          <SubmissionsList
            onSelectSubmission={(invoiceId) => {
              setSelectedInvoice(invoiceId);
            }}
          />
        )}
        {showDetail && selectedInvoice && (
          <SubmissionDetail
            invoiceId={selectedInvoice}
            onBack={() => {
              setSelectedInvoice(null);
            }}
          />
        )}
        {view === "health" && <Health />}
      </main>
    </div>
  );
}
