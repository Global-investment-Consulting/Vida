(async function () {
  const $ = (id) => document.getElementById(id);
  const logEl = $("log");
  const tblBody = document.querySelector("#tbl tbody");
  const btnCreate = $("btn-create");
  const btnRefresh = $("btn-refresh");
  const searchInput = $("search");

  // ----- logging -----
  function log(msg) {
    const ts = new Date().toISOString();
    logEl.textContent = `[${ts}] ${msg}\n` + logEl.textContent;
  }

  // ----- robust uuid for idempotency -----
  function newIdemKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // fallback
    return `idem_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  // ----- resolve API base (fallback if /demo-config is missing) -----
  let API_BASE = "/v1";
  try {
    const r = await fetch("/demo-config", { cache: "no-store" });
    if (r.ok) {
      const cfg = await r.json();
      if (cfg?.base) API_BASE = cfg.base;
      log(`Loaded config: base=${API_BASE}`);
    } else {
      log(`ERROR loading /demo-config → ${r.status}; using fallback base=/v1`);
    }
  } catch (e) {
    log(`ERROR loading /demo-config → ${e.message}; using fallback base=/v1`);
  }

  // ----- API helper -----
  const AUTH = { Authorization: "Bearer key_test_12345" }; // must match .env API_KEY

  async function apiJson(path, init = {}) {
    const r = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), ...AUTH, "Content-Type": "application/json" },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`${r.status} ${r.statusText} :: ${body}`);
    }
    return r.json();
  }

  // ----- render -----
  function renderRow(inv) {
    const tr = document.createElement("tr");

    const td = (t) => { const d = document.createElement("td"); d.textContent = t ?? "—"; return d; };
    tr.append(
      td(inv.number),
      td(inv.status),
      td(inv?.buyer?.name),
      td(inv.gross)
    );

    // XML link
    const tdXml = document.createElement("td");
    const aXml = document.createElement("a");
    aXml.textContent = "XML";
    aXml.href = `${API_BASE}/invoices/${encodeURIComponent(inv.id)}/xml?access_token=key_test_12345`;
    aXml.target = "_blank";
    tdXml.appendChild(aXml);
    tr.appendChild(tdXml);

    // PDF link (query-token so it works without custom headers)
    const tdPdf = document.createElement("td");
    const aPdf = document.createElement("a");
    aPdf.textContent = "PDF";
    aPdf.href = `${API_BASE}/invoices/${encodeURIComponent(inv.id)}/pdf?access_token=key_test_12345`;
    aPdf.target = "_blank";
    tdPdf.appendChild(aPdf);
    tr.appendChild(tdPdf);

    // Pay button
    const tdPay = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "Pay";
    btn.onclick = async () => {
      try {
        await apiJson(`/invoices/${encodeURIComponent(inv.id)}/pay`, {
          method: "POST",
          headers: { ...AUTH, "X-Idempotency-Key": newIdemKey() },
        });
        log(`Paid ${inv.number}`);
        await loadList();
      } catch (e) {
        log(`Pay failed: ${e.message}`);
      }
    };
    tdPay.appendChild(btn);
    tr.appendChild(tdPay);

    return tr;
  }

  async function loadList() {
    try {
      const q = searchInput.value.trim();
      const path = q ? `/invoices?limit=50&q=${encodeURIComponent(q)}` : `/invoices?limit=50`;
      const data = await apiJson(path, { method: "GET" });

      tblBody.innerHTML = "";
      for (const inv of data.data || []) {
        tblBody.appendChild(renderRow(inv));
      }
      log(`Loaded ${data.data?.length ?? 0} invoice(s).`);
    } catch (e) {
      log(`List failed: ${e.message}`);
      tblBody.innerHTML = "";
    }
  }

  // ----- wire up -----
  btnCreate.onclick = async () => {
    try {
      const idem = newIdemKey();
      const body = {
        currency: "EUR",
        buyer: { name: "Persist Co", country: "BE" },
        lines: [{ name: "Service", qty: 1, price: 50 }],
      };
      await apiJson("/invoices", {
        method: "POST",
        headers: { ...AUTH, "X-Idempotency-Key": idem },
        body: JSON.stringify(body),
      });
      log("Created invoice");
      await loadList();
    } catch (e) {
      log(`Create failed: ${e.message}`);
    }
  };

  btnRefresh.onclick = loadList;

  // initial load
  log("UI booting…");
  await loadList();
})();
