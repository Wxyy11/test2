const $ = s => document.querySelector(s);

async function api(url, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}) } };
  if (o.body && !(o.body instanceof FormData)) {
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }
  const res = await fetch(url, o);
  if (res.status === 401) { location.href = '/login.html'; throw new Error('unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baht = n => '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thDate = s => s ? new Date(String(s).replace(' ', 'T')).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
const pad2 = n => String(n).padStart(2, '0');
const curMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const localDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const nowLocal = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }); };

function toast(msg, type = 'ok') {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    box.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[60] space-y-2 w-[90%] max-w-sm';
    document.body.appendChild(box);
  }
  const color = { ok: 'bg-emerald-600', err: 'bg-rose-600', warn: 'bg-amber-500' }[type] || 'bg-emerald-600';
  const el = document.createElement('div');
  el.className = `${color} text-white px-4 py-3 rounded-xl shadow-xl text-sm transition-opacity duration-300`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login.html';
}

if (window.Chart) Chart.defaults.font.family = "'IBM Plex Sans Thai', sans-serif";