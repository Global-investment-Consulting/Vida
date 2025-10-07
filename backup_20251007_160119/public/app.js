(async function run() {
  const status = (msg) => {
    const el = document.getElementById('status');
    const now = new Date().toISOString();
    el.textContent = `[${now}] ${msg}\n` + el.textContent;
  };

  let cfg;
  try {
    const r = await fetch('/demo-config');
    if (!r.ok) throw new Error(`demo-config failed: ${r.status}`);
    cfg = await r.json();
    status(`Loaded config: base=${cfg.apiBase}`);
  } catch (e) {
    status(`ERROR loading /demo-config → ${e.message}`);
    return;
  }

  const H = { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' };

  async function list() {
    const q = document.getElementById('search').value.trim();
    const url = `${cfg.apiBase}/invoices?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${cfg.apiKey}` } });
    if (!r.ok) { status(`List failed: ${r.status}`); return; }
    const data = await r.json();

    const tbody = document.getElementById('rows');
    tbody.innerHTML = '';
    for (const inv of (data.data || [])) {
      const tr = document.createElement('tr');

      const tdNum = document.createElement('td'); tdNum.textContent = inv.number;
      const tdSt  = document.createElement('td'); tdSt.textContent  = inv.status;
      const tdBy  = document.createElement('td'); tdBy.textContent  = (inv.buyer && inv.buyer.name) || '';
      const tdGr  = document.createElement('td'); tdGr.textContent  = String(inv.gross);

      const tdXml = document.createElement('td');
      const aXml = document.createElement('a'); aXml.className = 'btn'; aXml.textContent = 'XML';
      aXml.href = `${cfg.apiBase}/invoices/${encodeURIComponent(inv.id)}/xml`; // requires header, so open via fetch
      aXml.onclick = async (ev) => {
        ev.preventDefault();
        const r = await fetch(aXml.href, { headers: { 'Authorization': `Bearer ${cfg.apiKey}` } });
        if (!r.ok) return status(`XML failed: ${r.status}`);
        const txt = await r.text();
        const blob = new Blob([txt], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      };
      tdXml.appendChild(aXml);

      const tdPdf = document.createElement('td');
      const aPdf = document.createElement('a'); aPdf.className = 'btn'; aPdf.textContent = 'PDF';
      // PDF supports header OR query-token; we’ll use query so it opens directly in new tab
      aPdf.href = `${cfg.apiBase}/invoices/${encodeURIComponent(inv.id)}/pdf?access_token=${encodeURIComponent(cfg.apiKey)}`;
      aPdf.target = '_blank';
      tdPdf.appendChild(aPdf);

      const tdPay = document.createElement('td');
      const aPay = document.createElement('a'); aPay.className = 'btn'; aPay.textContent = 'Pay';
      aPay.href = '#';
      aPay.onclick = async (ev) => {
        ev.preventDefault();
        const r = await fetch(`${cfg.apiBase}/invoices/${encodeURIComponent(inv.id)}/pay`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'X-Idempotency-Key': crypto.randomUUID() }
        });
        if (!r.ok) { status(`Pay failed: ${r.status}`); return; }
        status(`Paid invoice ${inv.number}`);
        await list();
      };
      tdPay.appendChild(aPay);

      tr.append(tdNum, tdSt, tdBy, tdGr, tdXml, tdPdf, tdPay);
      tbody.appendChild(tr);
    }
  }

  document.getElementById('btnRefresh').onclick = list;

  document.getElementById('btnCreate').onclick = async () => {
    const body = {
      currency: 'EUR',
      buyer: { name: 'Persist Co', country: 'BE' },
      lines: [{ name: 'Service', qty: 1, price: 50 }]
    };
    const r = await fetch(`${cfg.apiBase}/invoices`, {
      method: 'POST',
      headers: { ...H, 'X-Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body)
    });
    if (!r.ok) return status(`Create failed: ${r.status} ${r.statusText}`);
    const inv = await r.json();
    status(`Created ${inv.number}`);
    await list();
  };

  // initial load
  await list();
})();
