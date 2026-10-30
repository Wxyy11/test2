const { createWorker } = require('tesseract.js');

const sharp = require('sharp');


let workerP = null;

const getWorker = () => (workerP ??= createWorker(['tha', 'eng']));


const BANKS = [

  { name: 'กสิกรไทย (KBank)', keys: ['กสิกร', 'kasikorn', 'kplus', 'k+'] },

  { name: 'ไทยพาณิชย์ (SCB)', keys: ['ไทยพาณิชย์', 'scb'] },

  { name: 'กรุงไทย (KTB)', keys: ['กรุงไทย', 'krungthai', 'ktb', 'เป๋าตัง', 'paotang'] },

  { name: 'กรุงศรี (BAY)', keys: ['กรุงศรี', 'krungsri'] },

  { name: 'กรุงเทพ (BBL)', keys: ['ธนาคารกรุงเทพ', 'bangkokbank', 'bualuang', 'บัวหลวง'] },

  { name: 'ทีทีบี (ttb)', keys: ['ttb', 'ทีทีบี', 'ทหารไทยธนชาต'] },

  { name: 'ออมสิน (GSB)', keys: ['ออมสิน', 'gsb', 'mymo'] },

  { name: 'ธ.ก.ส. (BAAC)', keys: ['ธ.ก.ส', 'baac'] },

  { name: 'ยูโอบี (UOB)', keys: ['uob', 'ยูโอบี'] },

  { name: 'TrueMoney', keys: ['truemoney', 'ทรูมันนี่'] },

];


const TH_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

const TH_ABBR = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

const EN = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];


const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\CODEBLOCK4');

const pad = n => String(n).padStart(2, '0');


function normYear(y) {

  y = parseInt(y, 10);

  if (y < 100) y = y >= 50 ? y + 2500 : y + 2000; // 67 -> 2567, 24 -> 2024

  if (y > 2400) y -= 543;                         // พ.ศ. -> ค.ศ.

  return y;

}


function nowLocal() {

  const d = new Date();

  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

}


function parseDate(text) {

  let d, m, y;

  for (let i = 0; i < 12 && !d; i++) {

    for (const name of [TH_FULL[i], TH_ABBR[i]]) {

      const pat = name.includes('.') ? name.replace(/\./g, '\\.?\\s?') : esc(name);

      const mm = text.match(new RegExp(`(\\d{1,2})\\s*${pat}\\s*(\\d{2,4})`));

      if (mm) { d = +mm[1]; m = i + 1; y = normYear(mm[2]); break; }

    }

  }

  if (!d) {

    const mm = text.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{2,4})/i);

    if (mm) { d = +mm[1]; m = EN.indexOf(mm[2].toLowerCase()) + 1; y = normYear(mm[3]); }

  }

  if (!d) {

    const mm = text.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);

    if (mm) { d = +mm[1]; m = +mm[2]; y = normYear(mm[3]); }

  }

  if (!d || d > 31 || !m || m > 12) return { value: nowLocal(), found: false };


  let hh = '00', mi = '00';

  const t = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);

  if (t && +t[1] < 24 && +t[2] < 60) { hh = pad(t[1]); mi = t[2]; }

  return { value: `${y}-${pad(m)}-${pad(d)}T${hh}:${mi}`, found: true };

}


function parseAmount(text) {

  const t = text.replace(/(?<=\d),(?=\d{3})/g, ''); // 1,500.00 -> 1500.00

  let m = t.match(/(จำนวน\s*(?:เงิน)?|ยอด\s*(?:เงิน|โอน|ชำระ)|amount)[^\d]{0,20}(\d+(?:\.\d{1,2})?)/i);

  if (m) return parseFloat(m[2]);

  m = t.match(/(\d+\.\d{2})\s*(บาท|thb|฿)/i);

  if (m) return parseFloat(m[1]);

  const all = [...t.matchAll(/\b\d{1,7}\.\d{2}\b/g)].map(x => parseFloat(x[0])).filter(n => n > 0);

  return all.length ? Math.max(...all) : null;

}


function suggestCategory(compact, type, categories, receiver) {

  let best = null, bestScore = 0;

  for (const c of categories.filter(c => c.type === type)) {

    const kws = (c.keywords || '').split(',').map(k => k.trim().toLowerCase().replace(/\s+/g, '')).filter(Boolean);

    const score = kws.filter(k => compact.includes(k)).length;

    if (score > bestScore) { best = c; bestScore = score; }

  }

  if (!best && type === 'expense' && receiver && /^(นาย|นาง|น\.ส|mr|mrs|ms|miss)/i.test(receiver))

    best = categories.find(c => c.name === 'โอนให้บุคคล');

  if (!best && type === 'income') best = categories.find(c => c.name === 'เงินโอนเข้า');

  return best || null;

}


function parseSlipText(text, { categories = [], userName = '' } = {}) {

  const compact = text.replace(/\s+/g, '').toLowerCase();

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const detected = [];


  const bank = BANKS.find(b => b.keys.some(k => compact.includes(k.toLowerCase())));

  if (bank) detected.push('bank');


  const amount = parseAmount(text);

  if (amount) detected.push('amount');


  const date = parseDate(text);

  if (date.found) detected.push('txn_date');


  const refM = text.match(/(?:เลขที่รายการ|รหัสอ้างอิง|เลขที่อ้างอิง|หมายเลขอ้างอิง|รหัสรายการ|ref(?:erence)?\.?\s*(?:no\.?|id)?|transaction\s*(?:id|no\.?))\s*[:：]?\s*([A-Za-z0-9]{8,})/i);

  const ref_no = refM ? refM[1] : null;

  if (ref_no) detected.push('ref_no');


  // ชื่อผู้โอน/ผู้รับ: บรรทัดที่ขึ้นต้นด้วยคำนำหน้า (บรรทัดแรก = ผู้โอน, บรรทัดถัดไป = ผู้รับ)

  const nameRe = /(?:นางสาว|นาย|นาง|น\.ส\.?|ด\.ช\.?|ด\.ญ\.?|บริษัท|บจก\.?|หจก\.?|\b(?:mrs?|ms|miss)\.?\s)\s*[^\d\n]{2,40}/i;

  const names = lines.map(l => (l.match(nameRe) || [])[0]).filter(Boolean)

    .map(s => s.replace(/[|[\]{}<>]/g, '').trim().slice(0, 60));

  const sender = names[0] || null;

  const receiver = names[1] || null;

  if (sender) detected.push('sender');

  if (receiver) detected.push('receiver');


  const memoM = text.match(/(?:บันทึกช่วยจำ|memo)\s*[:：]?\s*(.+)/i);

  const note = memoM ? memoM[1].trim().slice(0, 100) : '';


  // รายรับหรือรายจ่าย

  let type = /รับเงิน|เงินเข้า|ได้รับเงิน|received/i.test(text) ? 'income' : 'expense';

  const first = (userName || '').trim().split(/\s+/)[0]?.toLowerCase();

  if (first && first.length >= 2) {

    const rc = (receiver || '').replace(/\s+/g, '').toLowerCase();

    const sc = (sender || '').replace(/\s+/g, '').toLowerCase();

    if (rc.includes(first)) type = 'income';

    else if (sc.includes(first)) type = 'expense';

  }


  const cat = suggestCategory(compact, type, categories, receiver);

  if (cat) detected.push('category_id');


  return {

    type, amount, txn_date: date.value, bank: bank?.name || null,

    sender, receiver, ref_no, note,

    category_id: cat?.id || null, category_name: cat?.name || null,

    detected, raw_text: text,

  };

}


async function scanSlip(filePath, opts) {

  const buf = await sharp(filePath).rotate()

    .resize({ width: 1500, withoutEnlargement: false })

    .grayscale().normalize().sharpen().toBuffer();

  const worker = await getWorker();

  const { data } = await worker.recognize(buf);

  return parseSlipText(data.text || '', opts);

}


module.exports = { scanSlip, parseSlipText };