const ACCESS_TOKEN = "key_test_12345"; // dev only, must match API_KEY
const API_BASE = `${location.origin}/v1`;

function withToken(url) {
  const u = new URL(url, location.origin);
  u.searchParams.set("access_token", ACCESS_TOKEN);
  return u.toString();
}

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  headers["Authorization"] = `Bearer ${ACCESS_TOKEN}`;
  headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function fmt(n) { return Number(n || 0).toFixed(2); }

async function refresh() {
  const q = document.querySelector("#search").value.trim();
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  const data = await api(`/invoices?${qs.toString()}`);
  const tbody = document.querySelector("#tbl tbody");
  tbody.innerHTML = "";
  data.data.forEach((inv) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${inv.number}</td>
      <td>${inv.buyer?.name || ""}</td>
      <td>${inv.status}</td>
      <td>${fmt(inv.net)}</td>
      <td>${fmt(inv.tax)}</td>
      <td><b>${fmt(inv.gross)}</b></td>
      <td class="actions">
        <a class="btn" href="${withToken(`${API_BASE}/invoices/${inv.id}/xml`)}" target="_blank">XML</a>
        <a class="btn" href="${withToken(`${API_BASE}/invoices/${inv.id}/pdf`)}" target="_blank">PDF</a>
        <button class="btn pay" data-id="${inv.id}">Pay</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button.pay").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const headers = {
          "Authorization": `Bearer ${ACCESS_TOKEN}`,
          "X-Idempotency-Key": cryptoRandom()
        };
        const paid = await api(`/invoices/${btn.dataset.id}/pay`, { method: "POST", headers });
        alert(`Paid: ${paid.status} at ${paid.paidAt}`);
        await refresh();
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function cryptoRandom() {
  // simple random GUID-ish for browser
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

document.querySelector("#refresh").addEventListener("click", refresh);
document.querySelector("#search").addEventListener("keyup", (e) => {
  if (e.key === "Enter") refresh();
});

document.querySelector("#createForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    currency: document.querySelector("#currency").value,
    buyer: { name: document.querySelector("#buyerName").value, country: document.querySelector("#buyerCountry").value },
    lines: [{ name: document.querySelector("#lineName").value, qty: Number(document.querySelector("#lineQty").value), price: Number(document.querySelector("#linePrice").value) }]
  };
  try {
    const headers = { "Authorization": `Bearer ${ACCESS_TOKEN}`, "X-Idempotency-Key": cryptoRandom() };
    await api(`/invoices`, { method: "POST", headers, body: JSON.stringify(body) });
    await refresh();
  } catch (e) {
    alert(e.message);
  }
});

refresh();
