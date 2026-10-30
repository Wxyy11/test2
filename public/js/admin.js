let ME, CATS = [], chart;

(async function init() {
  ME = await api('/api/me');
  $('#slipMonth').value = curMonth();
  showTab(location.hash.slice(1) || 'overview');
})();

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (t) showTab(t.dataset.tab);
  if (e.target.closest('.logout')) logout();
});

function showTab(t) {
  const loaders = { overview: loadOverview, users: loadUsers, slips: loadSlips, cats: loadCats };
  if (!loaders[t]) t = 'overview';
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + t));
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  history.replaceState(null, '', '#' + t);
  loaders[t]().catch(e => toast(e.message, 'err'));
}

// ---------- Overview ----------
async function loadOverview() {
  const s = await api('/api/admin/stats');
  $('#aUsers').textContent = s.users.total;
  $('#aUsersSub').textContent = `ใช้งานอยู่ ${s.users.active} คน`;
  $('#aSlips').textContent = s.slips.total.toLocaleString();
  $('#aToday').textContent = `วันนี้ +${s.today} สลิป`;
  $('#aIncome').textContent = baht(s.slips.income);
  $('#aExpense').textContent = baht(s.slips.expense);

  const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); return localDate(d); });
  const map = Object.fromEntries(s.trend.map(r => [r.day, r.n]));
  chart?.destroy();
  chart = new Chart($('#cAdmin'), {
    type: 'bar',
    data: {
      labels: days.map(d => new Date(d + 'T00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })),
      datasets: [{ label: 'สลิป', data: days.map(d => map[d] || 0), backgroundColor: '#6366f1', borderRadius: 8 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  });

  $('#topUsers').innerHTML = s.topUsers.length ? s.topUsers.map((u, i) => `
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white flex items-center justify-center font-bold">${i + 1}</div>
      <div class="flex-1 min-w-0"><p class="font-medium truncate">${esc(u.display_name)}</p><p class="text-xs text-slate-400">@${esc(u.username)}</p></div>
      <span class="text-sm font-semibold">${u.n} สลิป</span>
    </div>`).join('') : '<p class="text-sm text-slate-400">ยังไม่มีข้อมูล</p>';
}

// ---------- Users ----------
async function loadUsers() {
  const users = await api('/api/admin/users');
  $('#usersBody').innerHTML = users.map(u => {
    const self = u.id === ME.id;
    return `<tr class="border-t border-slate-100 hover:bg-slate-50/60">
      <td><p class="font-medium">${esc(u.display_name)}</p><p class="text-xs text-slate-400">@${esc(u.username)} · สมัคร ${thDate(u.created_at)}</p></td>
      <td><span class="px-2 py-1 rounded-lg text-xs font-medium ${u.role === 'admin' ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-slate-100 text-slate-600'}">${u.role}</span></td>
      <td><span class="px-2 py-1 rounded-lg text-xs font-medium ${u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">${u.is_active ? 'ใช้งาน' : 'ระงับ'}</span></td>
      <td class="text-right">${u.slip_count}</td>
      <td class="text-right text-emerald-600">${baht(u.income)}</td>
      <td class="text-right text-rose-600">${baht(u.expense)}</td>
      <td class="text-xs text-slate-500">${thDate(u.last_activity)}</td>
      <td class="text-right whitespace-nowrap space-x-1">
        ${self ? '<span class="text-xs text-slate-400">(บัญชีของคุณ)</span>' : `
        <button class="act" data-act="toggle" data-id="${u.id}" data-v="${u.is_active ? 0 : 1}">${u.is_active ? '⏸ ระงับ' : '▶ เปิดใช้'}</button>
        <button class="act" data-act="role" data-id="${u.id}" data-v="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? '⬇ เป็น user' : '⬆ เป็น admin'}</button>
        <button class="act" data-act="pw" data-id="${u.id}">🔑 รีเซ็ตรหัส</button>
        <button class="act !bg-rose-50 !text-rose-600" data-act="del" data-id="${u.id}" data-name="${esc(u.username)}">🗑</button>`}
      </td></tr>`;
  }).join('');
}

$('#usersBody').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id, v, name } = b.dataset;
  try {
    if (act === 'toggle') await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { is_active: v === '1' } });
    if (act === 'role') {
      if (!confirm(`ยืนยันเปลี่ยนสิทธิ์เป็น ${v}?`)) return;
      await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { role: v } });
    }
    if (act === 'pw') {
      const pw = prompt('กำหนดรหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)');
      if (!pw) return;
      await api(`/api/admin/users/${id}/reset-password`, { method: 'POST', body: { password: pw } });
    }
    if (act === 'del') {
      if (prompt(`ลบผู้ใช้และสลิปทั้งหมดของ "${name}" — พิมพ์ชื่อผู้ใช้เพื่อยืนยัน`) !== name) return;
      await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    }
    toast('ดำเนินการเรียบร้อย');
    loadUsers();
  } catch (err) { toast(err.message, 'err'); }
});

// ---------- Slips ----------
async function loadSlips() {
  if (!$('#slipUser').options.length) {
    const users = await api('/api/admin/users');
    $('#slipUser').innerHTML = '<option value="">ผู้ใช้ทั้งหมด</option>' +
      users.map(u => `<option value="${u.id}">${esc(u.display_name)} (@${esc(u.username)})</option>`).join('');
  }
  const p = new URLSearchParams({ user_id: $('#slipUser').value, month: $('#slipMonth').value });
  const list = await api('/api/admin/slips?' + p);
  $('#slipsBody').innerHTML = list.length ? list.map(s => `
    <tr class="border-t border-slate-100 hover:bg-slate-50/60">
      <td>${s.image_path ? `<a href="/api/slips/${s.id}/image" target="_blank"><img src="/api/slips/${s.id}/image" class="w-12 h-16 object-cover rounded-lg border"></a>` : '<span class="text-slate-300">—</span>'}</td>
      <td><p class="font-medium">${esc(s.display_name)}</p><p class="text-xs text-slate-400">@${esc(s.username)}</p></td>
      <td class="whitespace-nowrap">${thDate(s.txn_date)}</td>
      <td>${esc(s.category_icon || '❔')} ${esc(s.category_name || 'ไม่ระบุ')}</td>
      <td>${esc(s.bank || '-')}</td>
      <td class="max-w-[200px] truncate">${esc(s.note || '')}</td>
      <td class="text-right font-semibold ${s.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}">${s.type === 'income' ? '+' : '-'}${baht(s.amount)}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="text-center text-slate-400 py-10">ไม่มีข้อมูล</td></tr>';
}
['#slipUser', '#slipMonth'].forEach(id => $(id).addEventListener('change', loadSlips));

// ---------- Categories ----------
async function loadCats() {
  CATS = await api('/api/admin/categories');
  $('#catList').innerHTML = CATS.map(c => `
    <div class="card !p-4">
      <div class="flex items-start gap-3">
        <div class="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style="background:${esc(c.color)}22">${esc(c.icon)}</div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold">${esc(c.name)}</p>
          <p class="text-xs"><span class="${c.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}">${c.type === 'income' ? 'รายรับ' : 'รายจ่าย'}</span> · ใช้แล้ว ${c.used} รายการ</p>
        </div>
        <button class="act" data-edit="${c.id}">✏️</button>
        <button class="act !bg-rose-50 !text-rose-600" data-delcat="${c.id}">🗑</button>
      </div>
      <p class="text-xs text-slate-500 mt-3 line-clamp-2">${c.keywords ? esc(c.keywords) : '<i class="text-slate-300">ไม่มีคำค้น</i>'}</p>
    </div>`).join('');
}

function resetCatForm() {
  const f = $('#catForm');
  f.reset();
  f.elements.id.value = '';
  $('#catFormTitle').textContent = 'เพิ่มหมวดหมู่';
  $('#catCancel').classList.add('hidden');
}
$('#catCancel').onclick = resetCatForm;

$('#catList').addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-delcat]');
  if (ed) {
    const c = CATS.find(x => x.id == ed.dataset.edit);
    const f = $('#catForm');
    ['id', 'name', 'type', 'icon', 'color', 'keywords'].forEach(k => f.elements[k].value = c[k] ?? '');
    $('#catFormTitle').textContent = 'แก้ไขหมวดหมู่';
    $('#catCancel').classList.remove('hidden');
    f.scrollIntoView({ behavior: 'smooth' });
  }
  if (del) {
    if (!confirm('ลบหมวดนี้? รายการที่ใช้หมวดนี้จะกลายเป็น "ไม่ระบุ"')) return;
    await api('/api/admin/categories/' + del.dataset.delcat, { method: 'DELETE' });
    toast('ลบหมวดหมู่แล้ว');
    loadCats();
  }
});

$('#catForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    if (body.id) await api('/api/admin/categories/' + body.id, { method: 'PUT', body });
    else await api('/api/admin/categories', { method: 'POST', body });
    toast('บันทึกหมวดหมู่เรียบร้อย');
    resetCatForm();
    loadCats();
  } catch (err) { toast(err.message, 'err'); }
});