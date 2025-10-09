// public/app.js
(() => {
  const logEl = document.getElementById('log');
  const form = document.getElementById('create-form');
  const tableBody = document.getElementById('tbody');
  const qInput = document.getElementById('q');
  const btnRefresh = document.getElementById('btn-refresh');

  const log = (msg) => {
    const ts = new Date().toISOString();
    logEl.value += `[${ts}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  };

  let ACCESS_TOKEN = null;

  async function getConfig() {
    const r = await fetch('/demo-config', { cache: 'no-store' });
    if (!r.ok) throw new Error(`demo-config failed: ${r.status}`);
    const j = await r.json();
    if (!j || !j.accessToken) throw new Error('demo-config missing accessToken');
    ACCESS_TOKEN = j.accessToken;
    log('Config loaded.');
  }

  const authHeaders = () => ({
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  });

  async function listInvoices() {
    const q = qInput.value.trim();
    const url = new URL('/v1/invoices', window.location.origin);
    if (q) url.searchParams.set('q', q);
    try {
      const r = await fetch(url, { headers: authHeaders() });
      if (!r.ok) throw new Error(`API /invoices -> ${r.status}: ${await r.text()}`);
      const { data } = await r.json();
      renderTable(data || []);
    } catch (e) {
      log(`ERROR loading /invoices -> ${e}`);
      renderTable([]);
    }
  }

  function renderTable(items) {
    tableBody.innerHTML = '';
    for (const inv of items) {
      const linkXml = `/v1/invoices/${inv.id}/xml?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;
      const linkPdf = `/v1/invoices/${inv.id}/pdf?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${inv.number}</td>
        <td>${inv.status}</td>
        <td>${inv.buyer?.name ?? ''}</td>
        <td>${inv.gross}</td>
        <td><a href="${linkXml}" target="_blank">XML</a></td>
        <td><a href="${linkPdf}" target="_blank">PDF</a></td>
        <td><button class="btn-pay" data-id="${inv.id}">Pay</button></td>
      `;
      tableBody.appendChild(tr);
    }
    tableBody.querySelectorAll('.btn-pay').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        try {
          const r = await fetch(`/v1/invoices/${id}/pay`, {
            method: 'POST',
            headers: { ...authHeaders(), 'X-Idempotency-Key': crypto.randomUUID() }
          });
          if (!r.ok) throw new Error(`POST /pay -> ${r.status}: ${await r.text()}`);
          log(`Paid ${id}`);
          listInvoices();
        } catch (e) { log(`ERROR pay -> ${e}`); }
      });
    });
  }

  async function createInvoice() {
    const buyer = document.getElementById('buyer').value || 'Persist Co';
    const country = document.getElementById('country').value || 'BE';
    const currency = document.getElementById('currency').value || 'EUR';
    const lineName = document.getElementById('line').value || 'Service';
    const qty = Number(document.getElementById('qty').value || '1');
    const price = Number(document.getElementById('price').value || '50');

    const body = { currency, buyer: { name: buyer, country }, lines: [{ name: lineName, qty, price }] };
    try {
      const r = await fetch('/v1/invoices', {
        method: 'POST',
        headers: { ...authHeaders(), 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error(`create -> ${r.status}: ${await r.text()}`);
      log('Created invoice');
      listInvoices();
    } catch (e) { log(`ERROR create -> ${e}`); }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); createInvoice(); });
  btnRefresh.addEventListener('click', listInvoices);
  qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') listInvoices(); });

  (async () => {
    try { await getConfig(); await listInvoices(); }
    catch (e) { log(String(e)); }
  })();
})();
