require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const { scanSlip } = require('./ocr');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 3600 * 1000 },
}));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  const u = db.prepare('SELECT id,username,display_name,role,is_active FROM users WHERE id=?').get(req.session.user.id);
  if (!u || !u.is_active) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'บัญชีถูกระงับหรือไม่พบผู้ใช้' });
  }
  req.user = u;
  next();
}
const requireAdmin = (req, res, next) =>
  requireAuth(req, res, () => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบ' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, String(req.user.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = { 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

const removeImage = rel => {
  if (!rel) return;
  const f = path.join(UPLOAD_DIR, rel);
  if (f.startsWith(UPLOAD_DIR)) fs.rm(f, { force: true }, () => {});
};

app.get('/', (req, res) => res.redirect(req.session.user ? '/app.html' : '/login.html'));
app.get('/app.html', (req, res, next) => req.session.user ? next() : res.redirect('/login.html'));
app.get('/admin.html', (req, res, next) => req.session.user?.role === 'admin' ? next() : res.redirect('/login.html'));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', (req, res) => {
  const { username, password, display_name } = req.body || {};
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username || '')) return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, _ หรือ . ยาว 3-30 ตัว' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  if (!display_name?.trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อที่แสดง' });
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' });

  const info = db.prepare('INSERT INTO users (username,password_hash,display_name,role) VALUES (?,?,?,?)')
    .run(username, bcrypt.hashSync(password, 10), display_name.trim(), 'user');
    
  req.session.regenerate(() => {
    req.session.user = { id: Number(info.lastInsertRowid), role: 'user' };
    res.json({ ok: true, role: 'user' });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username || '');
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  if (!u.is_active) return res.status(403).json({ error: 'บัญชีนี้ถูกระงับ กรุณาติดต่อผู้ดูแลระบบ' });
  req.session.regenerate(() => {
    req.session.user = { id: u.id, role: u.role };
    res.json({ ok: true, role: u.role });
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', requireAuth, (req, res) => res.json(req.user));
app.get('/api/categories', requireAuth, (req, res) =>
  res.json(db.prepare('SELECT id,name,type,icon,color FROM categories ORDER BY type DESC, id').all()));

// ---------- Shopping List API ----------
app.get('/api/shopping', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM shopping_list WHERE user_id=? ORDER BY id DESC').all(req.user.id));
});

app.post('/api/shopping', requireAuth, (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'กรุณาระบุชื่อรายการ' });
  const est_amount = Number(req.body.est_amount) || 0;
  const info = db.prepare('INSERT INTO shopping_list (user_id, title, est_amount) VALUES (?, ?, ?)').run(req.user.id, title, est_amount);
  res.json({ id: Number(info.lastInsertRowid) });
});

app.patch('/api/shopping/:id', requireAuth, (req, res) => {
  const item = db.prepare('SELECT id FROM shopping_list WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const is_checked = req.body.is_checked ? 1 : 0;
  db.prepare('UPDATE shopping_list SET is_checked=? WHERE id=?').run(is_checked, item.id);
  res.json({ ok: true });
});

app.delete('/api/shopping/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM shopping_list WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- Slips ----------
app.post('/api/slips/scan', requireAuth, upload.single('slip'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาเลือกรูปสลิป (jpg / png / webp)' });
  const rel = `${req.user.id}/${req.file.filename}`;
  try {
    const categories = db.prepare('SELECT * FROM categories').all();
    const parsed = await scanSlip(req.file.path, { categories, userName: req.user.display_name });
    const duplicate = parsed.ref_no
      ? db.prepare('SELECT id,amount,txn_date FROM slips WHERE user_id=? AND ref_no=?').get(req.user.id, parsed.ref_no) || null
      : null;
    res.json({ image_path: rel, parsed, duplicate });
  } catch (e) {
    console.error('OCR error:', e);
    res.json({ image_path: rel, parsed: null, error: 'อ่านสลิปอัตโนมัติไม่สำเร็จ กรุณากรอกข้อมูลเอง' });
  }
});

function slipPayload(b) {
  const amount = Number(b.amount);
  if (!(amount > 0)) throw new Error('จำนวนเงินไม่ถูกต้อง');
  if (!b.txn_date) throw new Error('กรุณาระบุวันที่');
  const s = v => (v ? String(v).trim().slice(0, 200) : null);
  return {
    type: b.type === 'income' ? 'income' : 'expense',
    amount: Math.round(amount * 100) / 100,
    category_id: b.category_id ? Number(b.category_id) : null,
    bank: s(b.bank), sender: s(b.sender), receiver: s(b.receiver),
    ref_no: s(b.ref_no), txn_date: String(b.txn_date).slice(0, 16), note: s(b.note),
  };
}

app.post('/api/slips', requireAuth, (req, res) => {
  try {
    const p = slipPayload(req.body);
    let img = req.body.image_path || null;
    if (img && (!img.startsWith(`${req.user.id}/`) || img.includes('..'))) img = null;
    const info = db.prepare(`INSERT INTO slips
      (user_id,type,amount,category_id,bank,sender,receiver,ref_no,txn_date,note,image_path,raw_text)
      VALUES (@user_id,@type,@amount,@category_id,@bank,@sender,@receiver,@ref_no,@txn_date,@note,@image_path,@raw_text)`)
      .run({ ...p, user_id: req.user.id, image_path: img, raw_text: req.body.raw_text || null });
    res.json({ id: Number(info.lastInsertRowid) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/slips', requireAuth, (req, res) => {
  const { month, type, category_id, q } = req.query;
  let sql = `SELECT s.id,s.type,s.amount,s.category_id,s.bank,s.sender,s.receiver,s.ref_no,s.txn_date,s.note,
      s.image_path,s.created_at, c.name category_name, c.icon category_icon, c.color category_color
    FROM slips s LEFT JOIN categories c ON c.id=s.category_id WHERE s.user_id=?`;
  const params = [req.user.id];
  if (/^\d{4}-\d{2}$/.test(month || '')) { sql += ' AND substr(s.txn_date,1,7)=?'; params.push(month); }
  if (type === 'income' || type === 'expense') { sql += ' AND s.type=?'; params.push(type); }
  if (category_id) { sql += ' AND s.category_id=?'; params.push(category_id); }
  if (q) {
    sql += ' AND (s.note LIKE ? OR s.sender LIKE ? OR s.receiver LIKE ? OR s.bank LIKE ? OR s.ref_no LIKE ?)';
    params.push(...Array(5).fill(`%${q}%`));
  }
  sql += ' ORDER BY s.txn_date DESC, s.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

app.put('/api/slips/:id', requireAuth, (req, res) => {
  const s = db.prepare('SELECT id FROM slips WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).json({ error: 'ไม่พบรายการ' });
  try {
    db.prepare(`UPDATE slips SET type=@type,amount=@amount,category_id=@category_id,bank=@bank,sender=@sender,
      receiver=@receiver,ref_no=@ref_no,txn_date=@txn_date,note=@note WHERE id=@id`)
      .run({ ...slipPayload(req.body), id: s.id });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/slips/:id', requireAuth, (req, res) => {
  const s = db.prepare('SELECT id,image_path FROM slips WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).json({ error: 'ไม่พบรายการ' });
  db.prepare('DELETE FROM slips WHERE id=?').run(s.id);
  removeImage(s.image_path);
  res.json({ ok: true });
});

app.get('/api/slips/:id/image', requireAuth, (req, res) => {
  const s = db.prepare('SELECT user_id,image_path FROM slips WHERE id=?').get(req.params.id);
  if (!s?.image_path || (s.user_id !== req.user.id && req.user.role !== 'admin')) return res.sendStatus(404);
  res.sendFile(path.join(UPLOAD_DIR, s.image_path));
});

app.get('/api/summary', requireAuth, (req, res) => {
  const d = new Date();
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const uid = req.user.id;
  const SUMS = `COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) income,
                COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) expense`;

  const totals = db.prepare(`SELECT ${SUMS}, COUNT(*) count FROM slips WHERE user_id=? AND substr(txn_date,1,7)=?`).get(uid, month);
  const byCategory = db.prepare(`SELECT s.type, COALESCE(c.name,'ไม่ระบุ') name, COALESCE(c.icon,'❔') icon,
      COALESCE(c.color,'#94a3b8') color, SUM(s.amount) total, COUNT(*) count
    FROM slips s LEFT JOIN categories c ON c.id=s.category_id
    WHERE s.user_id=? AND substr(s.txn_date,1,7)=? GROUP BY s.type, s.category_id ORDER BY total DESC`).all(uid, month);
  const daily = db.prepare(`SELECT substr(txn_date,1,10) day, ${SUMS} FROM slips
    WHERE user_id=? AND substr(txn_date,1,7)=? GROUP BY day ORDER BY day`).all(uid, month);
  const trend = db.prepare(`SELECT substr(txn_date,1,7) month, ${SUMS} FROM slips
    WHERE user_id=? GROUP BY month ORDER BY month DESC LIMIT 6`).all(uid).reverse();

  res.json({ month, totals: { ...totals, balance: totals.income - totals.expense }, byCategory, daily, trend });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json({
    users: db.prepare('SELECT COUNT(*) total, COALESCE(SUM(is_active),0) active FROM users').get(),
    slips: db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) expense FROM slips`).get(),
    today: db.prepare("SELECT COUNT(*) n FROM slips WHERE date(created_at)=date('now','localtime')").get().n,
    trend: db.prepare(`SELECT substr(created_at,1,10) day, COUNT(*) n FROM slips
      WHERE created_at >= date('now','localtime','-13 days') GROUP BY day ORDER BY day`).all(),
    topUsers: db.prepare(`SELECT u.display_name, u.username, COUNT(s.id) n FROM users u
      JOIN slips s ON s.user_id=u.id GROUP BY u.id ORDER BY n DESC LIMIT 5`).all(),
  });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT u.id,u.username,u.display_name,u.role,u.is_active,u.created_at,
      COUNT(s.id) slip_count,
      COALESCE(SUM(CASE WHEN s.type='income' THEN s.amount END),0) income,
      COALESCE(SUM(CASE WHEN s.type='expense' THEN s.amount END),0) expense,
      MAX(s.created_at) last_activity
    FROM users u LEFT JOIN slips s ON s.user_id=u.id GROUP BY u.id ORDER BY u.id`).all());
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'ไม่สามารถแก้ไขสิทธิ์/สถานะบัญชีของตัวเองได้' });
  const { is_active, role } = req.body || {};
  if (is_active !== undefined) db.prepare('UPDATE users SET is_active=? WHERE id=?').run(is_active ? 1 : 0, id);
  if (role === 'admin' || role === 'user') db.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/reset-password', requireAdmin, (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'ไม่สามารถลบบัญชีตัวเองได้' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  fs.rm(path.join(UPLOAD_DIR, String(id)), { recursive: true, force: true }, () => {});
  res.json({ ok: true });
});

app.get('/api/admin/slips', requireAdmin, (req, res) => {
  let sql = `SELECT s.id,s.type,s.amount,s.txn_date,s.bank,s.note,s.image_path,s.sender,s.receiver,
      u.display_name,u.username,c.name category_name,c.icon category_icon
    FROM slips s JOIN users u ON u.id=s.user_id LEFT JOIN categories c ON c.id=s.category_id WHERE 1=1`;
  const p = [];
  if (req.query.user_id) { sql += ' AND s.user_id=?'; p.push(req.query.user_id); }
  if (/^\d{4}-\d{2}$/.test(req.query.month || '')) { sql += ' AND substr(s.txn_date,1,7)=?'; p.push(req.query.month); }
  sql += ' ORDER BY s.txn_date DESC LIMIT 300';
  res.json(db.prepare(sql).all(...p));
});

function catPayload(b) {
  if (!b.name?.trim()) throw new Error('กรุณาระบุชื่อหมวดหมู่');
  return {
    name: b.name.trim().slice(0, 50),
    type: b.type === 'income' ? 'income' : 'expense',
    icon: (b.icon || '📦').slice(0, 8),
    color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#6366f1',
    keywords: (b.keywords || '').trim(),
  };
}
app.get('/api/admin/categories', requireAdmin, (req, res) =>
  res.json(db.prepare(`SELECT c.*, COUNT(s.id) used FROM categories c LEFT JOIN slips s ON s.category_id=c.id
    GROUP BY c.id ORDER BY c.type DESC, c.id`).all()));
app.post('/api/admin/categories', requireAdmin, (req, res) => {
  try {
    const info = db.prepare('INSERT INTO categories (name,type,icon,color,keywords) VALUES (@name,@type,@icon,@color,@keywords)').run(catPayload(req.body));
    res.json({ id: Number(info.lastInsertRowid) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/categories/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('UPDATE categories SET name=@name,type=@type,icon=@icon,color=@color,keywords=@keywords WHERE id=@id')
      .run({ ...catPayload(req.body), id: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'ไฟล์ใหญ่เกิน 10MB' });
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
});

app.listen(PORT, () => console.log(`🚀 SlipBox พร้อมใช้งานที่ http://localhost:${PORT}`));