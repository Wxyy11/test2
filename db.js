const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  icon TEXT DEFAULT '📦',
  color TEXT DEFAULT '#6366f1',
  keywords TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS slips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  amount REAL NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  bank TEXT, sender TEXT, receiver TEXT, ref_no TEXT,
  txn_date TEXT NOT NULL,
  note TEXT,
  image_path TEXT,
  raw_text TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS shopping_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  est_amount REAL DEFAULT 0,
  is_checked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_slips_user_date ON slips(user_id, txn_date);
`);

if (!db.prepare('SELECT COUNT(*) n FROM categories').get().n) {
  const ins = db.prepare('INSERT INTO categories (name,type,icon,color,keywords) VALUES (?,?,?,?,?)');
  const seed = [
    ['อาหารและเครื่องดื่ม', 'expense', '🍜', '#f97316', '7-eleven,เซเว่น,cpall,ซีพีออลล์,makro,แม็คโคร,lotus,โลตัส,bigc,บิ๊กซี,ร้านอาหาร,กาแฟ,cafe,coffee,amazon,starbucks,kfc,mcdonald,foodpanda'],
    ['เดินทาง', 'expense', '🚗', '#0ea5e9', 'grab,bolt,lineman,bts,mrt,ptt,ปตท,บางจาก,bangchak,shell,caltex,esso,ทางด่วน,easypass,mpass'],
    ['ค่าน้ำ-ค่าไฟ', 'expense', '💡', '#eab308', 'การไฟฟ้า,กฟน,กฟภ,การประปา,กปน,กปภ,metropolitanelectricity,provincialelectricity'],
    ['โทรศัพท์/อินเทอร์เน็ต', 'expense', '📱', '#8b5cf6', 'ais,advancedinfo,truemove,trueonline,dtac,ดีแทค,3bb,อินเทอร์เน็ต'],
    ['ช้อปปิ้ง', 'expense', '🛍️', '#ec4899', 'shopee,ช้อปปี้,lazada,ลาซาด้า,tiktok,central,เซ็นทรัล,robinson,uniqlo,watsons,boots'],
    ['ที่พัก/ค่าเช่า', 'expense', '🏠', '#14b8a6', 'ค่าเช่า,หอพัก,คอนโด,อพาร์ทเมนท์,apartment,rent,นิติบุคคล'],
    ['สุขภาพ', 'expense', '💊', '#ef4444', 'โรงพยาบาล,hospital,คลินิก,clinic,ร้านยา,pharmacy,ทันตกรรม'],
    ['การศึกษา', 'expense', '📚', '#3b82f6', 'มหาวิทยาลัย,university,โรงเรียน,school,ค่าเทอม'],
    ['บันเทิง', 'expense', '🎬', '#a855f7', 'netflix,spotify,youtube,disney,majorcineplex,sfcinema,steam,playstation'],
    ['โอนให้บุคคล', 'expense', '💸', '#64748b', ''],
    ['อื่นๆ', 'expense', '📦', '#94a3b8', ''],
    ['เงินเดือน', 'income', '💼', '#10b981', 'เงินเดือน,salary,payroll'],
    ['ขายของ/รายได้เสริม', 'income', '🛒', '#22c55e', 'ขายของ,ค่าสินค้า'],
    ['เงินโอนเข้า', 'income', '💰', '#06b6d4', ''],
    ['รายรับอื่นๆ', 'income', '✨', '#84cc16', ''],
  ];
  db.transaction(() => seed.forEach(r => ins.run(...r)))();
}

const adminUser = process.env.ADMIN_USER || 'admin';
const adminPass = process.env.ADMIN_PASS || 'admin1234';
const existingAdmin = db.prepare("SELECT id FROM users WHERE role='admin'").get();

if (!existingAdmin) {
  db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')")
    .run(adminUser, bcrypt.hashSync(adminPass, 10), 'ผู้ดูแลระบบ');
  console.log(`👑 สร้างบัญชีแอดมินหลัก: ${adminUser} / ${adminPass}`);
} else {
  db.prepare("UPDATE users SET username=? WHERE id=?").run(adminUser, existingAdmin.id);
}

module.exports = db;