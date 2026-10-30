let ME, CATS = [], SLIPS = {}, charts = {}, current = {};
const monthEl = $('#month');

// ---------- Init ----------
(async function init() {
  ME = await api('/api/me');
  $('#hello').textContent = ME.display_name;
  $('#sideName').textContent = ME.display_name;
  $('#sideUser').textContent = '@' + ME.username;
  
  if (ME.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(e => e.classList.remove('hidden'));
  } else {
    document.querySelectorAll('.admin-only').forEach(e => e.remove());
  }

  CATS = await api('/api/categories');
  $('#fCat').innerHTML = '<option value="">ทุกหมวดหมู่</option>' +
    CATS.map(c => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('');
  monthEl.value = curMonth();
  resetUploadForm();
  showPage(location.hash.slice(1) || 'dash');
})();

// ---------- Navigation ----------
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-page]');
  if (nav) return showPage(nav.dataset.page);
  const item = e.target.closest('.slip-item');
  if (item) return openModal(SLIPS[item.dataset.id]);
  if (e.target.closest('[data-close]')) return closeModal();
  if (e.target.closest('.logout')) logout();
});
document.addEventListener('keydown', e => e.key === 'Escape' && closeModal());

function showPage(p) {
  if (!['dash', 'upload', 'history', 'shopping'].includes(p)) p = 'dash';
  document.querySelectorAll('.page').forEach(s => s.classList.toggle('hidden', s.id !== 'page-' + p));
  document.querySelectorAll('.nav-btn[data-page], .mnav').forEach(b => b.classList.toggle('active', b.dataset.page === p));
  history.replaceState(null, '', '#' + p);
  monthEl.classList.toggle('invisible', p === 'upload' || p === 'shopping');
  window.scrollTo({ top: 0 });
  if (p === 'dash') loadDash();
  if (p === 'history') loadHistory();
  if (p === 'shopping') loadShopping();
}
const currentPage = () => location.hash.slice(1) || 'dash';
const refresh = () => {
  const p = currentPage();
  if (p === 'history') loadHistory();
  else if (p === 'shopping') loadShopping();
  else loadDash();
};
monthEl.addEventListener('change', refresh);

// ---------- Shared UI ----------
function cacheSlips(list) { list.forEach(s => SLIPS[s.id] = s); }

function slipItem(s) {
  const inc = s.type === 'income';
  const who = inc ? s.sender : s.receiver;
  return `
  <button data-id="${s.id}" class="slip-item w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-50 transition text-left">
    <div class="w-12 h-12 rounded-2xl flex items-center justify-center text-xl shrink-0" style="background:${esc(s.category_color || '#94a3b8')}22">${esc(s.category_icon || '❔')}</div>
    <div class="flex-1 min-w-0">
      <p class="font-medium truncate">${esc(s.category_name || 'ไม่ระบุหมวด')}${s.note ? ` <span class="text-slate-400 font-normal">· ${esc(s.note)}</span>` : ''}</p>
      <p class="text-xs text-slate-500 truncate">${thDate(s.txn_date)}${s.bank ? ' · ' + esc(s.bank) : ''}${who ? ' · ' + esc(who) : ''}</p>
    </div>
    <div class="text-right shrink-0">
      <p class="font-semibold ${inc ? 'text-emerald-600' : 'text-rose-600'}">${inc ? '+' : '-'}${baht(s.amount)}</p>
      ${s.image_path ? '<p class="text-[10px] text-slate-400">🧾 มีสลิป</p>' : ''}
    </div>
  </button>`;
}

const emptyState = `<div class="text-center py-14 text-slate-400"><div class="text-5xl mb-3">🧾</div>ยังไม่มีรายการ<br>
  <button data-page="upload" class="mt-4 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm">+ เพิ่มสลิป</button></div>`;

function drawChart(id, cfg) {
  charts[id]?.destroy();
  cfg.options = { responsive: true, maintainAspectRatio: false, ...cfg.options };
  charts[id] = new Chart(document.getElementById(id), cfg);
}

// ---------- Dashboard ----------
async function loadDash() {
  const m = monthEl.value;
  const [s, list] = await Promise.all([api('/api/summary?month=' + m), api('/api/slips?month=' + m)]);
  const t = s.totals;
  $('#sBalance').textContent = baht(t.balance);
  $('#sIncome').textContent = baht(t.income);
  $('#sExpense').textContent = baht(t.expense);
  $('#sCount').textContent = `${t.count} รายการ · ${monthLabel(m)}`;

  const exp = s.byCategory.filter(c => c.type === 'expense');
  drawChart('cPie', {
    type: 'doughnut',
    data: { labels: exp.map(c => `${c.icon} ${c.name}`), datasets: [{ data: exp.map(c => c.total), backgroundColor: exp.map(c => c.color), borderWidth: 0 }] },
    options: { cutout: '70%', plugins: { legend: { display: false } } },
  });
  $('#catList').innerHTML = exp.length ? exp.map(c => {
    const pct = t.expense ? (c.total / t.expense) * 100 : 0;
    return `<div>
      <div class="flex justify-between text-sm"><span>${esc(c.icon)} ${esc(c.name)} <span class="text-slate-400">(${c.count})</span></span><span class="font-medium">${baht(c.total)}</span></div>
      <div class="h-2 bg-slate-100 rounded-full mt-1 overflow-hidden"><div class="h-full rounded-full" style="width:${pct.toFixed(1)}%;background:${esc(c.color)}"></div></div>
    </div>`;
  }).join('') : '<p class="text-sm text-slate-400 text-center">ยังไม่มีรายจ่ายเดือนนี้</p>';

  const [y, mo] = m.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  const map = Object.fromEntries(s.daily.map(d => [Number(d.day.slice(8, 10)), d]));
  const labels = Array.from({ length: days }, (_, i) => i + 1);
  drawChart('cDaily', {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'รายรับ', data: labels.map(d => map[d]?.income || 0), backgroundColor: '#10b981', borderRadius: 6 },
      { label: 'รายจ่าย', data: labels.map(d => map[d]?.expense || 0), backgroundColor: '#f43f5e', borderRadius: 6 },
    ] },
    options: { scales: { x: { grid: { display: false } }, y: { beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } },
  });

  drawChart('cTrend', {
    type: 'line',
    data: { labels: s.trend.map(r => monthLabel(r.month)), datasets: [
      { label: 'รายรับ', data: s.trend.map(r => r.income), borderColor: '#10b981', backgroundColor: '#10b98120', fill: true, tension: 0.4 },
      { label: 'รายจ่าย', data: s.trend.map(r => r.expense), borderColor: '#f43f5e', backgroundColor: '#f43f5e20', fill: true, tension: 0.4 },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } },
  });

  cacheSlips(list);
  $('#recent').innerHTML = list.slice(0, 6).map(slipItem).join('') || emptyState;
}

// ---------- Shopping List ----------
async function loadShopping() {
  const list = await api('/api/shopping');
  const totalEst = list.filter(i => !i.is_checked).reduce((sum, i) => sum + i.est_amount, 0);
  $('#shopTotal').textContent = `ยอดรวมที่ต้องซื้อ: ${baht(totalEst)}`;
  
  $('#shopList').innerHTML = list.length ? list.map(i => `
    <div class="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition">
      <label class="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
        <input type="checkbox" data-shop-check="${i.id}" ${i.is_checked ? 'checked' : ''} class="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500">
        <span class="${i.is_checked ? 'line-through text-slate-400' : 'text-slate-700 font-medium'} truncate">${esc(i.title)}</span>
      </label>
      <div class="flex items-center gap-3 shrink-0">
        <span class="text-sm font-semibold text-slate-600">${i.est_amount > 0 ? baht(i.est_amount) : ''}</span>
        <button data-shop-del="${i.id}" class="text-slate-400 hover:text-rose-500 p-1">🗑️</button>
      </div>
    </div>`).join('') : '<p class="text-center py-10 text-slate-400">ยังไม่มีรายการที่ต้องซื้อ</p>';
}

$('#shopForm').addEventListener('submit', async e => {
  e.preventDefault();
  const title = $('#shopTitle').value.trim();
  const est_amount = $('#shopAmount').value;
  if (!title) return;
  try {
    await api('/api/shopping', { method: 'POST', body: { title, est_amount } });
    $('#shopTitle').value = '';
    $('#shopAmount').value = '';
    loadShopping();
    toast('เพิ่มรายการสำเร็จ');
  } catch (err) { toast(err.message, 'err'); }
});

document.addEventListener('change', async e => {
  const id = e.target.dataset.shopCheck;
  if (id) {
    try {
      await api('/api/shopping/' + id, { method: 'PATCH', body: { is_checked: e.target.checked } });
      loadShopping();
    } catch (err) { toast(err.message, 'err'); }
  }
});

document.addEventListener('click', async e => {
  const id = e.target.dataset.shopDel;
  if (id) {
    if (!confirm('ยืนยันลบรายการนี้?')) return;
    try {
      await api('/api/shopping/' + id, { method: 'DELETE' });
      loadShopping();
      toast('ลบรายการเรียบร้อย');
    } catch (err) { toast(err.message, 'err'); }
  }
});

// ---------- Slip form ----------
function slipFormHTML(s = {}) {
  const t = s.type || 'expense';
  const v = k => esc(s[k] ?? '');
  const typeBtn = (x, label, color) => `
    <label class="cursor-pointer">
      <input type="radio" name="type" value="${x}" class="peer sr-only" ${t === x ? 'checked' : ''}>
      <div class="text-center py-2.5 rounded-xl border-2 border-slate-200 font-medium transition peer-checked:border-${color}-500 peer-checked:bg-${color}-50 peer-checked:text-${color}-600">${label}</div>
    </label>`;
  return `
    <div class="grid grid-cols-2 gap-2">${typeBtn('expense', '💸 รายจ่าย', 'rose')}${typeBtn('income', '💰 รายรับ', 'emerald')}</div>
    <div><label class="lbl">จำนวนเงิน (บาท)</label>
      <input name="amount" type="number" step="0.01" min="0" inputmode="decimal" class="inp text-2xl font-bold" value="${v('amount')}" placeholder="0.00" required></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="lbl">หมวดหมู่ (ค่าอะไร)</label><select name="category_id" class="inp"></select></div>
      <div><label class="lbl">วันที่-เวลา</label><input name="txn_date" type="datetime-local" class="inp" value="${v('txn_date')}" required></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="lbl">ผู้โอน</label><input name="sender" class="inp" value="${v('sender')}"></div>
      <div><label class="lbl">ผู้รับ</label><input name="receiver" class="inp" value="${v('receiver')}"></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="lbl">ธนาคาร</label><input name="bank" class="inp" list="bankList" value="${v('bank')}"></div>
      <div><label class="lbl">เลขอ้างอิง</label><input name="ref_no" class="inp" value="${v('ref_no')}"></div>
    </div>
    <div><label class="lbl">บันทึกเพิ่มเติม</label><input name="note" class="inp" value="${v('note')}" placeholder="เช่น ค่าข้าวกลางวัน, ค่าเช่าเดือน มี.ค."></div>`;
}

function fillCats(sel, type, selected) {
  sel.innerHTML = '<option value="">— ไม่ระบุ —</option>' + CATS.filter(c => c.type === type)
    .map(c => `<option value="${c.id}" ${c.id == selected ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('');
}
function bindSlipForm(form, selected) {
  const upd = sel => fillCats(form.elements.category_id, form.elements.type.value, sel);
  upd(selected);
  form.querySelectorAll('[name=type]').forEach(r => r.addEventListener('change', () => upd()));
}

// ---------- Upload ----------
function resetUploadForm() {
  const f = $('#slipForm');
  f.innerHTML = slipFormHTML({ txn_date: nowLocal() });
  bindSlipForm(f);
  current = {};
  $('#preview').classList.add('hidden');
  $('#dropHint').classList.remove('hidden');
  $('#detected').innerHTML = '';
  $('#dupWarn').classList.add('hidden');
}

['#fileCam', '#fileGal'].forEach(id => $(id).addEventListener('change', e => {
  handleFile(e.target.files[0]);
  e.target.value = '';
}));
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('border-indigo-500', 'bg-indigo-50'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('border-indigo-500', 'bg-indigo-50'); }));
drop.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));

async function compressImage(file, maxW = 1600) {
  const img = await new Promise((ok, fail) => {
    const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, maxW / img.width);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.9));
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return toast('กรุณาเลือกไฟล์รูปภาพ', 'err');
  const prev = $('#preview');
  prev.src = URL.createObjectURL(file);
  prev.classList.remove('hidden');
  $('#dropHint').classList.add('hidden');
  $('#scanning').classList.remove('hidden');
  $('#detected').innerHTML = '';
  $('#dupWarn').classList.add('hidden');

  let blob = file;
  try { blob = (await compressImage(file)) || file; } catch {}
  const fd = new FormData();
  fd.append('slip', blob, 'slip.jpg');

  try {
    const r = await api('/api/slips/scan', { method: 'POST', body: fd });
    current = { image_path: r.image_path, raw_text: r.parsed?.raw_text || null };
    if (r.parsed) { fillUploadForm(r.parsed); showDetected(r.parsed); }
    if (r.duplicate) {
      $('#dupWarn').textContent = `⚠️ สลิปนี้อาจซ้ำกับรายการเดิม (${baht(r.duplicate.amount)} เมื่อ ${thDate(r.duplicate.txn_date)})`;
      $('#dupWarn').classList.remove('hidden');
    }
    toast(r.error || 'อ่านสลิปเรียบร้อย กรุณาตรวจสอบก่อนบันทึก', r.error ? 'warn' : 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    $('#scanning').classList.add('hidden');
  }
}

function fillUploadForm(p) {
  const f = $('#slipForm');
  f.querySelector(`[name=type][value=${p.type}]`).checked = true;
  ['amount', 'txn_date', 'bank', 'sender', 'receiver', 'ref_no', 'note'].forEach(k => {
    if (p[k] != null && p[k] !== '') f.elements[k].value = p[k];
  });
  fillCats(f.elements.category_id, p.type, p.category_id);
}

function showDetected(p) {
  const LABELS = { amount: 'ยอดเงิน', txn_date: 'วันที่', bank: 'ธนาคาร', sender: 'ผู้โอน', receiver: 'ผู้รับ', ref_no: 'เลขอ้างอิง', category_id: 'หมวดหมู่' };
  const summary = p.amount ? `
    <div class="w-full p-3 rounded-2xl bg-indigo-50 text-indigo-700 text-sm">
      💡 ระบบคาดว่าเป็น <b>${esc(p.category_name || 'ไม่ทราบหมวด')}</b>
      (${p.type === 'income' ? 'รายรับ' : 'รายจ่าย'}) ยอด <b>${baht(p.amount)}</b>${p.bank ? ' ผ่าน ' + esc(p.bank) : ''}
    </div>` : '';
  $('#detected').innerHTML = summary + Object.entries(LABELS).map(([k, l]) => {
    const ok = p.detected?.includes(k);
    return `<span class="px-3 py-1 rounded-full text-xs font-medium ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}">${ok ? '✓' : '–'} ${l}</span>`;
  }).join('');
}

$('#slipForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { ...Object.fromEntries(new FormData(e.target)), ...current };
  try {
    await api('/api/slips', { method: 'POST', body });
    toast('บันทึกเรียบร้อย 🎉');
    resetUploadForm();
    showPage('history');
  } catch (err) { toast(err.message, 'err'); }
});

// ---------- History ----------
let qTimer;
$('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(loadHistory, 300); });
['#fType', '#fCat'].forEach(id => $(id).addEventListener('change', loadHistory));

async function loadHistory() {
  const params = new URLSearchParams({ month: monthEl.value, type: $('#fType').value, category_id: $('#fCat').value, q: $('#q').value.trim() });
  const list = await api('/api/slips?' + params);
  cacheSlips(list);
  const sum = t => list.filter(s => s.type === t).reduce((a, s) => a + s.amount, 0);
  $('#hIncome').textContent = baht(sum('income'));
  $('#hExpense').textContent = baht(sum('expense'));
  $('#hCount').textContent = `${list.length} รายการ`;

  const groups = {};
  list.forEach(s => (groups[s.txn_date.slice(0, 10)] ||= []).push(s));
  $('#histList').innerHTML = list.length ? Object.entries(groups).map(([d, arr]) => `
    <p class="px-3 pt-3 pb-1 text-xs font-semibold text-slate-400">
      ${new Date(d + 'T00:00').toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
    </p>${arr.map(slipItem).join('')}`).join('') : emptyState;
}

// ---------- Modal ----------
function openModal(s) {
  if (!s) return;
  const m = $('#modal');
  m.innerHTML = `
  <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" data-close></div>
  <div class="relative bg-white w-full md:max-w-4xl rounded-t-3xl md:rounded-3xl max-h-[92vh] overflow-y-auto md:grid md:grid-cols-2">
    <div class="bg-slate-100 p-4 flex items-center justify-center min-h-[180px]">
      ${s.image_path
        ? `<a href="/api/slips/${s.id}/image" target="_blank"><img src="/api/slips/${s.id}/image" class="max-h-[40vh] md:max-h-[75vh] rounded-2xl shadow-lg"></a>`
        : '<p class="text-slate-400">ไม่มีรูปสลิป</p>'}
    </div>
    <div class="p-5">
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-semibold text-lg">รายละเอียดรายการ</h3>
        <button data-close class="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200">✕</button>
      </div>
      <form id="editForm" class="space-y-3">${slipFormHTML(s)}</form>
      <p class="text-xs text-slate-400 mt-3">บันทึกเมื่อ ${thDate(s.created_at)}</p>
      <div class="flex gap-2 mt-4">
        <button id="delBtn" class="px-4 py-3 rounded-xl bg-rose-50 text-rose-600 font-medium hover:bg-rose-100">🗑️ ลบ</button>
        <button form="editForm" class="flex-1 py-3 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800">บันทึกการแก้ไข</button>
      </div>
    </div>
  </div>`;
  m.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');

  const f = $('#editForm');
  bindSlipForm(f, s.category_id);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/slips/' + s.id, { method: 'PUT', body: Object.fromEntries(new FormData(f)) });
      toast('แก้ไขเรียบร้อย');
      closeModal(); refresh();
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#delBtn').onclick = async () => {
    if (!confirm('ยืนยันลบรายการนี้? (รูปสลิปจะถูกลบด้วย)')) return;
    await api('/api/slips/' + s.id, { method: 'DELETE' });
    delete SLIPS[s.id];
    toast('ลบเรียบร้อย');
    closeModal(); refresh();
  };
}
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal').innerHTML = '';
  document.body.classList.remove('overflow-hidden');
}