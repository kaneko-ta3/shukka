/* =============================================================
 *  印刷マン（複数宛先ラベル） — 別紙のExcelから、B2に上げる26列のCSVを作る
 *
 *  別紙はこのブラウザの中で読むだけで、どこにも送りません。
 *  依頼主（倉庫の住所・電話）もこのブラウザにだけ保存します。
 *
 *  流れ
 *    1. 別紙を入れる（ドラッグ／ファイル選択／貼り付け）
 *    2. 見出しの行と、どの列が何かを選ぶ（見出しから自動で当てます）
 *    3. 一覧で確認・手直し（個口・指定日・〒のずれ）
 *    4. CSVをダウンロード
 * ============================================================= */

'use strict';

/* =================== 設定 =================== */

const CFG = {
  /* 対応表の項目。multi は複数の列をつなげられる項目 */
  ITEMS: [
    {key: 'store', label: '店名・宛先名', need: true, multi: true,
     hint: '列を2つ選ぶと、1つ目が「お届け先名」、2つ目が「備考(住所4)」に入ります。会社名を入れたときは、選んだ列はすべて「備考(住所4)」へ'},
    {key: 'tel',   label: '電話', need: true, hint: '行ごとに電話が空のときは「0」で出し、保存のときに知らせます'},
    {key: 'zip',   label: '〒', need: true, hint: '住所の列に〒が入っているなら空でOK'},
    {key: 'addr',  label: '住所', need: true, multi: true, hint: '2〜3列に分かれていれば全部選ぶとつなげます'},
    {key: 'qty1',  label: '商品1の数量'},
    {key: 'qty2',  label: '商品2の数量'},
    {key: 'boxes', label: '個口数', hint: '別紙に個口数そのものが書いてある場合だけ'},
    {key: 'due',   label: '指定日'},
    {key: 'ship',  label: '出荷日'},
    {key: 'time',  label: '時間指定'},
    {key: 'memo2', label: '備考2(記事欄)', multi: true}
  ],

  /* 見出しの自動判定。上の項目から順に、1つの列は1つの項目にだけ当てます */
  GUESS_ORDER: ['zip', 'tel', 'addr', 'boxes', 'due', 'ship', 'time', 'qty1', 'store', 'memo2'],
  GUESS: {
    zip:   ['〒', '郵便'],
    tel:   ['電話', 'TEL', 'Tel', 'tel', '携帯'],
    addr:  ['住所', '所在地'],
    boxes: ['個口', '口数', '箱数', 'ケース数'],
    due:   ['指定日', '着日', '納品日', '希望日', '納入日', 'お届け日', '配達日'],
    ship:  ['出荷日', '発送日'],
    time:  ['時間'],
    qty1:  ['数量', '個数', '発注数', '注文数', '納品数', 'トイレ'],
    /* 「社名」と「拠点名」のように並んでいれば、左から1つ目→お届け先名、2つ目→住所4 になります */
    store: ['お届け先名', '届け先名', '納品先', '宛先', '社名', '施設名', '学校名', '店舗名', '店名', '事業所名', '名称', '拠点', '営業所'],
    memo2: ['備考', '記事']
  },

  /* 出荷日が空の行は「指定日 −（東京からの輸送日数＋1）」にし、営業日でなければ前の営業日まで戻します。
     輸送1日：関東・甲信越・北陸・東海・近畿（兵庫まで）・東北（青森まで）／それ以外は2日 */
  TRANSIT_NEAR: 1,
  TRANSIT_FAR: 2,
  NEAR_PREF: ['東京都', '神奈川県', '埼玉県', '千葉県', '茨城県', '栃木県', '群馬県',
              '山梨県', '長野県', '新潟県', '静岡県', '愛知県', '岐阜県', '三重県',
              '富山県', '石川県', '福井県', '滋賀県', '京都府', '大阪府', '兵庫県',
              '奈良県', '和歌山県',
              '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  /* 祝日（振替休日・国民の休日を含む）。年が変わる前に次の年を足してください */
  HOLIDAYS: [
    '2026/01/01', '2026/01/12', '2026/02/11', '2026/02/23', '2026/03/20', '2026/04/29',
    '2026/05/03', '2026/05/04', '2026/05/05', '2026/05/06', '2026/07/20', '2026/08/11',
    '2026/09/21', '2026/09/22', '2026/09/23', '2026/10/12', '2026/11/03', '2026/11/23',
    '2027/01/01', '2027/01/11', '2027/02/11', '2027/02/23', '2027/03/21', '2027/03/22',
    '2027/04/29', '2027/05/03', '2027/05/04', '2027/05/05', '2027/07/19', '2027/08/11',
    '2027/09/20', '2027/09/23', '2027/10/11', '2027/11/03', '2027/11/23'
  ],

  TIMES: [['', '指定なし'], ['0812', '午前中'], ['1416', '14〜16時'], ['1618', '16〜18時'],
          ['1820', '18〜20時'], ['1921', '19〜21時']],

  /* B2の文字数。バイトで数えます（全角2・半角1） */
  NAME_BYTES: 32,
  CSV_MAX_ROWS: 1000,        // これを超えたらCSVを分けます（B2に1度に上げる件数）
  ADDR1_BYTES: 38,

  CSV_HEAD: ['備考(住所4)', 'お届け先電話', '備考2(記事欄)', '商品名1', '商品名2',
             '名前', 'お届け先〒', '住所1', '-', '住所2', '-', '個口数',
             '出荷日', '指定日', '時間指定', '依頼主コード', 'ラベル種別',
             '依頼主電話', '依頼主名', '依頼主〒', '依頼主住所', '依頼主建物マンション名',
             'くくりキー', '-', '受注ID', '受注ID'],

  LS_SENDERS: 'label.senders.v1',
  LS_SENDER_SEL: 'label.sender.sel.v1',
  LS_ITEMS: 'label.items.v1'
};


/* =================== 状態 =================== */

const S = {
  fileName: '',
  book: null,               // {sheetName: grid}
  sheet: '',
  grid: [],                 // [行][列] 文字列 or {y,m,d}
  headTop: -1, headBottom: -1, dataFrom: 0,
  map: {},                  // 項目 -> [列番号]
  fill: new Set(),          // 上の値で埋める列
  company: '',
  item1: {name: '', per: ''},
  item2: {name: '', per: ''},
  boxMode: 'each',          // 個口の計算。each＝商品ごとに割って切り上げてから足す／mix＝割ったまま足して最後に切り上げ
  rows: [],                 // 組み立てた行
  edits: {},                // 元の行番号 -> {項目: 手で入れた値}
  include: {},              // 元の行番号 -> true/false（手で発行する／外す）
  sel: new Set(),           // 選択中の元の行番号
  lastClick: null,
  checks: {},               // `${〒}|${住所}` -> 照合結果
  senders: [],
  senderId: ''
};


/* =================== 小道具 =================== */

const $ = (s, el) => (el || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function lsGet(k, def) {
  try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
}

function colLetter(n) {       // 0 -> A
  let s = ''; n += 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object' && 'y' in v) return v.y + '/' + pad2(v.m) + '/' + pad2(v.d);
  return String(v).trim();
}
function pad2(n) { return String(n).padStart(2, '0'); }

/* 全角の英数記号とカタカナを半角にします（スプシのASCと同じ。今のラベル出しは名前と住所にこれを掛けています） */
const KANA_F = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォッャュョー・「」、。';
const KANA_H = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｯｬｭｮｰ･｢｣､｡';
const DAKU_F = 'ガギグゲゴザジズゼゾダヂヅデドバビブベボ';
const DAKU_B = 'カキクケコサシスセソタチツテトハヒフヘホ';
const HANDAKU_F = 'パピプペポ';
const HANDAKU_B = 'ハヒフヘホ';
function asc(s) {
  let out = '';
  for (const c of String(s == null ? '' : s)) {
    const code = c.charCodeAt(0);
    if (code >= 0xFF01 && code <= 0xFF5E) { out += String.fromCharCode(code - 0xFEE0); continue; }
    if (c === '　') { out += ' '; continue; }
    let i = KANA_F.indexOf(c);
    if (i >= 0) { out += KANA_H[i]; continue; }
    i = DAKU_F.indexOf(c);
    if (i >= 0) { out += KANA_H[KANA_F.indexOf(DAKU_B[i])] + 'ﾞ'; continue; }
    i = HANDAKU_F.indexOf(c);
    if (i >= 0) { out += KANA_H[KANA_F.indexOf(HANDAKU_B[i])] + 'ﾟ'; continue; }
    if (c === 'ヴ') { out += 'ｳﾞ'; continue; }
    out += c;
  }
  return out;
}
function bytes(s) {
  let b = 0;
  for (const c of String(s)) {
    const code = c.charCodeAt(0);
    b += (code < 0x80 || (code >= 0xFF61 && code <= 0xFF9F)) ? 1 : 2;
  }
  return b;
}
/* 住所1と住所2の切れ目。今のスプシ（LEFTB）と同じ切り方にしています。
   英数字は1バイト、それ以外は半角カナも2バイトと数え、n バイト目にまたがる文字までを前に入れます */
function leftB(s, n) {
  let b = 0, out = '';
  for (const c of String(s)) {
    if (b >= n) break;
    b += c.charCodeAt(0) < 0x80 ? 1 : 2;
    out += c;
  }
  return out;
}

/* 電話。数字だけにします（「03(5422)7609」→「0354227609」）。Excelで頭の0が落ちたものは戻します */
function normTel(v) {
  const d = String(v == null ? '' : v).normalize('NFKC').replace(/[^0-9]/g, '');
  if (!d) return '';
  if (!/^0/.test(d) && (d.length === 9 || d.length === 10)) return '0' + d;
  return d;
}

/* 住所マスタ（ネコポスと同じ表）。半角にした住所に、上から順に置き換えを掛けます。
   「ｹ丘→ケ丘」のように、半角のままだとB2の〒の自動判定で止まる町名を戻すためのものです */
let ADDR_MASTER = [];
async function loadAddrMaster() {
  try {
    const r = await fetch('data/addr_master.csv', {cache: 'no-cache'});
    if (!r.ok) throw new Error(r.status);
    const grid = parseDelimited(await r.text(), ',');
    ADDR_MASTER = grid.slice(1).filter(x => x[0]).map(x => [x[0], x[1] || '']);
  } catch (e) {
    ADDR_MASTER = [];
    toast('住所マスタが読めませんでした。ｹ丘などが半角のまま出ます');
  }
}
function applyMaster(s) {
  let t = String(s);
  ADDR_MASTER.forEach(([a, b]) => { t = t.split(a).join(b); });
  return t;
}
/* 照合と出力に使う住所。半角にして住所マスタを掛けたもの */
function addrNorm(row) {
  const a = String(val(row, 'addr') || '').replace(/\s+/g, ' ').trim();
  return applyMaster(asc(a.replace(/,/g, '，')));
}

/* 〒。「NNN-NNNN」にします。6桁は頭の0落ちとみなします */
function normZip(v) {
  const d = String(v == null ? '' : v).normalize('NFKC').replace(/[^0-9]/g, '');
  if (d.length === 7) return d.slice(0, 3) + '-' + d.slice(3);
  if (d.length === 6) return '0' + d.slice(0, 2) + '-' + d.slice(2);
  return '';
}

/* 日付。いろいろな書き方を yyyy/MM/dd にします。読めなければ null */
function parseDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object' && 'y' in v) return fmtYMD(v.y, v.m, v.d);
  let t = String(v).normalize('NFKC').trim().replace(/\(.\)|（.）/g, '').replace(/\s+/g, '');
  if (!t) return '';
  let m = t.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
  if (m) return fmtYMD(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[\/\-.月](\d{1,2})日?$/);
  if (m) {
    const now = new Date();
    let y = now.getFullYear();
    /* 年が無いときは、今日から見て近い方の年にします（12月に1月の日付が来たら翌年） */
    const cand = new Date(y, +m[1] - 1, +m[2]);
    if (cand - now < -1000 * 60 * 60 * 24 * 60) y += 1;
    return fmtYMD(y, +m[1], +m[2]);
  }
  m = t.match(/^(\d{5})$/);                      // Excelの日付の通し番号
  if (m && +m[1] > 40000 && +m[1] < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + (+m[1]) * 86400000);
    return fmtYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}
function fmtYMD(y, m, d) {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return y + '/' + pad2(m) + '/' + pad2(d);
}
function weekday(ymd) {
  if (!ymd) return '';
  const a = ymd.split('/').map(Number);
  return '日月火水木金土'[new Date(a[0], a[1] - 1, a[2]).getDay()];
}

/* 出荷日の自動。指定日からリードタイム分さかのぼり、土日なら金曜まで戻します */
function autoShip(due, addr) {
  if (!due) return '';
  const a = due.split('/').map(Number);
  const d = new Date(a[0], a[1] - 1, a[2]);
  const pref = Addr.prefOf(addr);
  const transit = CFG.NEAR_PREF.includes(pref) ? CFG.TRANSIT_NEAR : CFG.TRANSIT_FAR;
  d.setDate(d.getDate() - (transit + 1));
  const ymd = () => fmtYMD(d.getFullYear(), d.getMonth() + 1, d.getDate());
  while (d.getDay() === 0 || d.getDay() === 6 || CFG.HOLIDAYS.includes(ymd())) d.setDate(d.getDate() - 1);
  return ymd();
}

/* 時間指定。B2のコードにします。読めなければ null */
function normTime(v) {
  const t = String(v == null ? '' : v).normalize('NFKC').replace(/\s+/g, '');
  if (!t || /^(なし|指定なし|-)$/.test(t)) return '';
  if (/午前/.test(t)) return '0812';
  const d = t.replace(/[^0-9]/g, '');
  if (['0812', '1416', '1618', '1820', '1921'].includes(d)) return d;
  const m = t.match(/(\d{1,2})\D+(\d{1,2})/);
  if (m) {
    const c = pad2(+m[1]) + pad2(+m[2]);
    if (c === '0812' || c === '0912') return '0812';
    if (['1416', '1618', '1820', '1921'].includes(c)) return c;
  }
  return null;
}

function num(v) {
  const t = String(v == null ? '' : v).normalize('NFKC').replace(/,/g, '');
  const m = t.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}


/* =================== 別紙の読み込み =================== */

async function readFile(file) {
  S.fileName = file.name;
  const buf = await file.arrayBuffer();
  let wb;
  if (/\.(csv|tsv|txt)$/i.test(file.name)) {
    let text;
    try { text = new TextDecoder('utf-8', {fatal: true}).decode(buf); }
    catch (e) { text = new TextDecoder('shift_jis').decode(buf); }
    S.book = {[file.name]: parseDelimited(text, /\t/.test(text.split(/\r?\n/)[0]) ? '\t' : ',')};
  } else {
    wb = XLSX.read(buf, {type: 'array', cellNF: true, cellDates: false, cellStyles: true});
    S.book = {};
    wb.SheetNames.forEach(n => { S.book[n] = sheetToGrid(wb.Sheets[n]); });
  }
  const names = Object.keys(S.book);
  /* 中身のあるシートの最初を選んでおきます */
  S.sheet = names.find(n => S.book[n].length) || names[0];
  loadSheet();
}

function readPaste(text) {
  S.fileName = '貼り付け';
  S.book = {'貼り付け': parseDelimited(text, '\t')};
  S.sheet = '貼り付け';
  loadSheet();
}

/* Excelのシートを [行][列] にします。結合セルは結合範囲の全部に同じ値を入れます。
   Excelで非表示にしている列と行は grid.hc / grid.hr に覚えておきます（列の記号はExcelと同じに保つため、消さずに隠します） */
function sheetToGrid(ws) {
  if (!ws || !ws['!ref']) return [];
  const rg = XLSX.utils.decode_range(ws['!ref']);
  const grid = [];
  for (let r = 0; r <= rg.e.r; r++) {
    const row = [];
    for (let c = 0; c <= rg.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({r, c})];
      row.push(cellValue(cell));
    }
    grid.push(row);
  }
  (ws['!merges'] || []).forEach(m => {
    const v = grid[m.s.r] && grid[m.s.r][m.s.c];
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) {
      if (r === m.s.r && c === m.s.c) continue;
      if (grid[r]) grid[r][c] = (typeof v === 'object' && v) ? Object.assign({merged: true}, v) : v;
    }
  });
  const g = trimGrid(grid);
  g.hc = new Set();
  g.hr = new Set();
  (ws['!cols'] || []).forEach((c, i) => { if (c && c.hidden) g.hc.add(i); });
  (ws['!rows'] || []).forEach((r, i) => { if (r && r.hidden) g.hr.add(i); });
  return g;
}

function cellValue(cell) {
  if (!cell || cell.v == null) return '';
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    const p = XLSX.SSF.parse_date_code(cell.v);
    if (p) return {y: p.y, m: p.m, d: p.d};
  }
  if (cell.t === 'd' && cell.v instanceof Date) {
    return {y: cell.v.getFullYear(), m: cell.v.getMonth() + 1, d: cell.v.getDate()};
  }
  return cell.w != null ? String(cell.w) : String(cell.v);
}

/* 右端と下端の空の列・行を落とします */
function trimGrid(grid) {
  let lastR = -1, lastC = -1;
  grid.forEach((row, r) => row.forEach((v, c) => { if (cellText(v)) { lastR = Math.max(lastR, r); lastC = Math.max(lastC, c); } }));
  return grid.slice(0, lastR + 1).map(row => {
    const a = row.slice(0, lastC + 1);
    while (a.length < lastC + 1) a.push('');
    return a;
  });
}

/* 区切り文字のテキスト（Excelから貼り付けたもの＝タブ区切り）を読みます。"..." の中の改行もそのまま */
function parseDelimited(text, sep) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"' && cur === '') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const w = Math.max(0, ...rows.map(r => r.length));
  return trimGrid(rows.map(r => { while (r.length < w) r.push(''); return r; }));
}

function loadSheet() {
  S.grid = S.book[S.sheet] || [];
  S.hc = S.grid.hc || new Set();
  S.hr = S.grid.hr || new Set();
  S.edits = {}; S.include = {}; S.sel = new Set(); S.fill = new Set(); S.lastClick = null; S.moreOpen = null; S.view = '';
  detectHeader();
  guessMap();
  rebuild();
}


/* =================== 見出しの行と、列の当てはめ =================== */

function allWords() {
  return [].concat(...Object.values(CFG.GUESS), ['お届け先', '届け先', 'No', 'NO', '№', '番号', '氏名', '名前', '担当']);
}
/* Excelで見えている列の値だけ */
function vis(row) { return row.filter((_, c) => !S.hc.has(c)); }
function visCols() { const a = []; for (let c = 0; c < ncols(); c++) if (!S.hc.has(c)) a.push(c); return a; }

function rowScore(row) {
  row = vis(row);
  const words = allWords();
  return row.filter(v => { const t = cellText(v); return t && t.length <= 20 && words.some(w => t.indexOf(w) >= 0); }).length;
}

/* 中身の行らしいか。〒・電話・日付・数字・県から始まる住所のどれかがあれば中身とみなします */
function rowLooksData(row) {
  return vis(row).some(v => {
    if (v && typeof v === 'object') return true;                 // 日付
    const t = cellText(v).normalize('NFKC');
    if (!t) return false;
    if (/^-?[\d,.]+$/.test(t)) return true;
    if (/(^|[^\d])\d{3}-\d{4}([^\d]|$)/.test(t) || /^〒?\d{7}$/.test(t)) return true;
    if (/\d{2,4}[-(]\d{2,4}[-)]\d{3,4}/.test(t)) return true;
    return /^(北海道|東京都|京都府|大阪府|.{2,3}県).+\d/.test(t);
  });
}
/* 値が1つしかない行（「〇〇納品先一覧」のようなタイトル）。見出しには含めません */
function rowIsTitle(row) {
  return new Set(vis(row).map(cellText).filter(Boolean)).size <= 1;
}
function headerish(row) {
  return row && rowScore(row) > 0 && !rowLooksData(row) && !rowIsTitle(row);
}

/* 先頭15行のうち、見出しらしい言葉がいちばん多い行を見出しにします。
   上下の行も見出しらしければ（2段の見出し）、まとめて見出しとみなします */
function detectHeader() {
  const g = S.grid;
  let best = -1, bestScore = 0;
  for (let r = 0; r < Math.min(15, g.length); r++) {
    if (rowLooksData(g[r])) continue;
    const sc = rowScore(g[r]);
    if (sc > bestScore) { best = r; bestScore = sc; }
  }
  if (best < 0) { S.headTop = -1; S.headBottom = -1; S.dataFrom = 0; return; }
  let bottom = best;
  while (bottom + 1 < g.length && bottom - best < 2 && headerish(g[bottom + 1])) bottom++;
  setHeader(bottom);
  while (S.headTop > best) S.headTop--;
}
function setHeader(bottom) {
  S.headBottom = bottom;
  let top = bottom;
  while (top - 1 >= 0 && bottom - top < 2 && headerish(S.grid[top - 1])) top--;
  S.headTop = top;
  S.dataFrom = bottom + 1;
}
function headText(c) {
  if (S.headBottom < 0) return '';
  const parts = [];
  for (let r = S.headTop; r <= S.headBottom; r++) {
    const t = cellText(S.grid[r] && S.grid[r][c]);
    if (t && !parts.includes(t)) parts.push(t);
  }
  return parts.join(' ');
}
function sampleText(c) {
  for (let r = S.dataFrom; r < Math.min(S.grid.length, S.dataFrom + 8); r++) {
    const t = cellText(S.grid[r][c]);
    if (t) return t;
  }
  return '';
}
function ncols() { return S.grid.reduce((m, r) => Math.max(m, r.length), 0); }

function guessMap() {
  S.map = {};
  CFG.ITEMS.forEach(it => { S.map[it.key] = []; });
  const used = new Set();
  const n = ncols();
  CFG.GUESS_ORDER.forEach(k => {
    const words = CFG.GUESS[k] || [];
    const it = CFG.ITEMS.find(x => x.key === k);
    for (let c = 0; c < n; c++) {
      if (used.has(c) || S.hc.has(c)) continue;
      const h = headText(c);
      if (!h || !words.some(w => h.indexOf(w) >= 0)) continue;
      /* 「お届け先住所」を住所に、「お届け先名」を宛先名に。電話の列の「TEL」も住所には当てません */
      S.map[k].push(c); used.add(c);
      if (!it.multi) break;
      if (S.map[k].length >= 3) break;
    }
  });
  /* 住所が2列に分かれていて、2列目の見出しが「建物名」などの場合 */
  if (S.map.addr.length === 1) {
    let c = S.map.addr[0] + 1;
    while (c < n && S.hc.has(c)) c++;                  // Excelで非表示の列は飛ばします
    if (c < n && !used.has(c) && /建物|ビル|マンション|番地|住所2/.test(headText(c))) { S.map.addr.push(c); used.add(c); }
  }
}


/* =================== 行の組み立て =================== */

function pickRaw(row, key) {
  return (S.map[key] || []).map(c => cellText(row[c])).filter(Boolean).join(' ');
}

function isTotalRow(row) {
  return vis(row).some(v => /^(合\s*計|小\s*計|総\s*計|計)$|合計|小計|総計/.test(cellText(v)));
}

/**
 * 別紙と対応表から、一覧の行を組み立てます。
 * 手で直した値（S.edits）は上書きせずに残します。
 */
function rebuild() {
  const g = S.grid;
  const rows = [];
  const last = {};                       // 上の値で埋める列の、直前の値
  const fillFirstEmpty = new Set();

  for (let r = S.dataFrom; r < g.length; r++) {
    const raw = g[r].slice();
    const total = isTotalRow(raw);
    const hidden = S.hr.has(r);
    const filled = new Set();
    /* 埋める元にも埋める先にも、Excelで非表示の行は使いません（画面で見えている上の値で埋めるため） */
    if (!total && !hidden) {
      S.fill.forEach(c => {
        const t = cellText(raw[c]);
        if (t) last[c] = raw[c];
        else if (c in last) { raw[c] = last[c]; filled.add(c); }
        else fillFirstEmpty.add(c);
      });
    }
    if (!raw.some(v => cellText(v))) continue;          // まったくの空行は数えません

    const auto = {};
    CFG.ITEMS.forEach(it => { auto[it.key] = pickRaw(raw, it.key); });
    /* 〒と住所が1つのセルに入っている（〒141-0021 東京都…） */
    const zm = auto.addr.normalize('NFKC').match(/^〒?\s*(\d{3}-?\d{4})\s*(.*)$/);
    if (zm) { if (!auto.zip) auto.zip = zm[1]; auto.addr = zm[2]; }
    const dueRaw = (S.map.due || []).map(c => raw[c]).find(v => cellText(v));
    const shipRaw = (S.map.ship || []).map(c => raw[c]).find(v => cellText(v));
    auto.due = dueRaw == null ? '' : dueRaw;
    auto.ship = shipRaw == null ? '' : shipRaw;

    const filledKeys = new Set();
    CFG.ITEMS.forEach(it => { if ((S.map[it.key] || []).some(c => filled.has(c))) filledKeys.add(it.key); });

    let why = '';
    if (hidden) why = 'Excelで非表示の行';
    else if (total && !auto.zip) why = '合計の行';
    else if (!auto.zip && !auto.addr) why = '〒も住所もない行';
    rows.push({src: r, raw, auto, filledKeys, autoExclude: why});
  }
  S.rows = rows;
  S.fillFirstEmpty = fillFirstEmpty;
  rows.forEach(computeRow);
  renderAll();
  runChecks();
}

function val(row, key) {
  const e = S.edits[row.src];
  return (e && key in e) ? e[key] : row.auto[key];
}
function edited(row, key) {
  const e = S.edits[row.src];
  return !!(e && key in e);
}
function setEdit(src, key, v) {
  (S.edits[src] || (S.edits[src] = {}))[key] = v;
}
function included(row) {
  return (row.src in S.include) ? S.include[row.src] : !row.autoExclude;
}

/* 名前（お届け先名）と備考(住所4)の自動の値
     会社名あり                → 名前＝会社名、備考＝選んだ列を全部つなげたもの
     会社名なし・列を2つ以上   → 名前＝1つ目の列、備考＝2つ目以降の列
     会社名なし・列が1つ       → 名前＝その列、備考＝空 */
function autoNameMemo(row) {
  const company = S.company.trim();
  const parts = (S.map.store || []).map(c => cellText(row.raw[c]));
  if (company) return [company, parts.filter(Boolean).join(' ')];
  if (parts.length >= 2) return [parts[0], parts.slice(1).filter(Boolean).join(' ')];
  return [parts.filter(Boolean).join(' '), ''];
}

/* 1行ぶんの出力値と、問題の一覧を作ります */
function computeRow(row) {
  const err = [], warn = [];
  const [nameAuto, memoAuto] = autoNameMemo(row);

  const nameSrc = edited(row, 'name') ? String(val(row, 'name')) : nameAuto;
  const memoSrc = edited(row, 'memo') ? String(val(row, 'memo')) : memoAuto;
  /* 名前は半角にして数えます（英数字と、カタカナ→半角カナ。ひらがな・漢字はそのまま） */
  const name = asc(nameSrc).trim();
  if (!name) err.push('名前が空です');
  else if (bytes(name) > CFG.NAME_BYTES) err.push('名前が長すぎます（半角にしても ' + bytes(name) + 'バイト。上限 ' + CFG.NAME_BYTES + 'バイト＝全角16文字）');

  let tel = normTel(val(row, 'tel'));
  const telEmpty = !tel;
  if (telEmpty) { tel = '0'; warn.push('電話が空なので「0」で出します'); }

  const zipRaw = String(val(row, 'zip') || '');
  const zip = normZip(zipRaw);                       // 別紙（または手直し）の〒。照合にはこちらを使います
  let zipOut = zip, zipFilled = '';                  // CSVに出す〒。住所から補ったときは zipFilled に元の〒

  const addrIn = String(val(row, 'addr') || '').replace(/\s+/g, ' ').trim();
  if (!addrIn) err.push('住所が空です');

  /* 住所の照合結果。照合は半角＋住所マスタ済みの住所で行います */
  const addrN = addrNorm(row);
  const ck = S.checks[zip + '|' + addrN];
  let addr = addrN, check = null;
  if (addrIn) {
    if (!ck) check = {status: 'pending'};
    else {
      check = ck;
      if (ck.added) { addr = ck.addr; warn.push('「' + ck.added + '」を補いました'); }
      const okSig = S.edits[row.src] && S.edits[row.src].addrOk;
      /* 相手が入れた〒は書き換えません（相手の〒で出して違っていたら相手のデータの問題だが、
         こちらで変えて元が合っていたらこちらのミスになるため）。
         住所から〒を入れるのは、〒が空で、住所から1つに決まるときだけです */
      const canFill = ck.status === 'nozip' && ck.byAddr.length === 1;
      if (ck.status === 'ok') { if (ck.biz) warn.push('会社専用の〒です（' + ck.biz + '）'); }
      else if (ck.status === 'nodata') warn.push(ck.msg);
      else if (okSig === zip + '|' + addrIn) warn.push('〒と住所の照合：このまま出すことにしました');
      else if (canFill) {
        zipOut = Addr.fmtZip(ck.byAddr[0].zip);
        zipFilled = '（空）';
        warn.push('〒が空なので、住所から ' + zipOut + ' を入れました');
      }
      else if (ck.zipUnknown && zip) warn.push('〒 ' + zip + ' は郵便番号データにありません（会社やビル専用の〒かもしれません）。書き換えずにそのまま出します');
      else err.push('check');
    }
  }
  if (!zipOut && !(check && check.status === 'pending')) err.push(zipRaw ? '〒が7桁になりません（' + zipRaw + '）' : '〒が空です');

  /* 商品と数量 */
  const q1 = String(val(row, 'qty1') || '').trim();
  const q2 = String(val(row, 'qty2') || '').trim();
  const item = (it, q, label) => {
    const nm = itemName(it === S.item1 ? 'item1' : 'item2');
    /* 数量の列を選んでいないとき、商品1は名前だけを出します。商品2は出しません（名前が残っていても） */
    if (!q) return label === '商品1' && nm && !(S.map.qty1 || []).length ? nm : '';
    const n = num(q);
    if (isNaN(n)) { err.push(label + 'の数量が数字ではありません（' + q + '）'); return nm; }
    if (n === 0) return '';                          // 数量0の商品は出しません
    if (!nm) { err.push(label + 'の商品名を上の欄に入れてください'); return ''; }
    return nm + '(' + n + ')';
  };
  let item1 = item(S.item1, q1, '商品1');
  let item2 = item(S.item2, q2, '商品2');
  /* 商品1が出ないときは、商品2を商品名1に詰めます */
  if (!item1 && item2) { item1 = item2; item2 = ''; }
  const qtyMapped = (S.map.qty1 || []).length || (S.map.qty2 || []).length;
  if (qtyMapped && !item1 && !err.some(e => /商品/.test(e))) err.push('数量がどれも0（または空）です。発行から外すか、数量を直してください');

  /* 個口数。手入力 > 別紙の個口数 > 数量÷入数 > 1
       each：商品ごとに割って切り上げてから足す（別々の箱に詰める）
       mix ：割ったまま足して、最後に切り上げ（同じ箱に混ぜて詰める） */
  let boxesAuto = 0;
  const bcol = String(row.auto.boxes || '').trim();
  if (bcol && !isNaN(num(bcol))) boxesAuto = Math.round(num(bcol));
  else {
    let frac = 0;
    [[q1, S.item1.per], [q2, S.item2.per]].forEach(([q, per]) => {
      const n = num(q), p = num(per);
      if (isNaN(n) || n <= 0 || isNaN(p) || p <= 0) return;
      if (S.boxMode === 'mix') frac += n / p;
      else boxesAuto += Math.ceil(n / p);
    });
    /* 0.1＋0.2 のような小数のずれで 1 口増えないよう、ごく小さい差は丸めてから切り上げます */
    if (S.boxMode === 'mix' && frac > 0) boxesAuto = Math.ceil(Math.round(frac * 1e9) / 1e9);
  }
  if (!boxesAuto) boxesAuto = 1;
  let boxes = boxesAuto;
  if (edited(row, 'boxes')) {
    const b = num(val(row, 'boxes'));
    if (isNaN(b) || b < 1 || Math.round(b) !== b) err.push('個口数は1以上の整数にしてください');
    else boxes = b;
  }

  const dueV = val(row, 'due');
  const due = parseDate(dueV);
  if (due === null) err.push('指定日が日付として読めません（' + cellText(dueV) + '）');
  const shipV = val(row, 'ship');
  let ship = parseDate(shipV), shipAuto = false;
  if (ship === null) err.push('出荷日が日付として読めません（' + cellText(shipV) + '）');
  else if (!ship) { ship = autoShip(due, addr); shipAuto = !!ship; }
  if (ship === '' ) err.push('出荷日か指定日を入れてください');
  if (due && ship && ship > due) err.push('出荷日が指定日より後になっています');

  const timeV = val(row, 'time');
  const time = normTime(timeV);
  if (time === null) err.push('時間指定が読めません（' + timeV + '）');

  const memo2 = String(val(row, 'memo2') || '').trim();

  /* 補った県・市（全角）にも同じ変換を掛けます */
  const addrA = applyMaster(asc(addr.replace(/,/g, '，')));
  const addr1 = leftB(addrA, CFG.ADDR1_BYTES);
  const addr2 = addrA.slice(addr1.length);

  row.out = {name, memo: memoSrc.trim(), tel, telEmpty, zip: zipOut, zipIn: zip, zipFilled, addr, addr1, addr2, item1, item2,
             boxes, boxesAuto, due: due || '', ship: ship || '', shipAuto, time: time || '', memo2, q1, q2};
  row.err = err; row.warn = warn; row.check = check;
}


/* =================== 住所の照合（非同期） =================== */

let checkRunning = false, checkAgain = false;
async function runChecks() {
  if (checkRunning) { checkAgain = true; return; }
  checkRunning = true;
  const fresh = new Set();          // 今回あらたに照合した 〒|住所
  try {
    await Addr.loadIndex();
    $('#dataVer').textContent = Addr.ver ? '郵便番号データ ' + Addr.ver + ' 版' : '';
    for (const row of S.rows) {
      if (!included(row) || !row.out.addr && !row.out.zipIn) continue;
      const zip = row.out.zipIn;
      const addrN = addrNorm(row);
      const k = zip + '|' + addrN;
      if (!addrN || S.checks[k]) continue;
      fresh.add(k);
      try { S.checks[k] = await Addr.check(zip, addrN); }
      catch (e) { S.checks[k] = {status: 'nodata', msg: '郵便番号データが読めませんでした', addr: addrN, added: ''}; }
    }
  } catch (e) {
    S.rows.forEach(row => {
      const addrN = addrNorm(row);
      const k = row.out.zipIn + '|' + addrN;
      if (!S.checks[k]) S.checks[k] = {status: 'nodata', msg: e.message, addr: addrN, added: ''};
    });
  }
  checkRunning = false;
  /* 結果が変わった行だけ計算し直して描き直します。多ければ表ごと描き直します */
  const changed = S.rows.filter(r => fresh.has(r.out.zipIn + '|' + addrNorm(r)) || (r.check && r.check.status === 'pending'));
  changed.forEach(computeRow);
  if (changed.length > 40 || !document.querySelector('#rowsTable tbody')) renderRows();
  else if (changed.length) updateRows(changed.map(r => r.src));
  if (checkAgain) { checkAgain = false; runChecks(); }
}


/* =================== 依頼主 =================== */

function loadSenders() {
  S.senders = lsGet(CFG.LS_SENDERS, []) || [];
  /* 住所の無いものは依頼主として使えません。前の版で請求先の行が紛れ込んだものも、ここで外します */
  const before = S.senders.length;
  S.senders = S.senders.filter(s => s && s.name && s.addr);
  if (S.senders.length !== before) lsSet(CFG.LS_SENDERS, S.senders);
  S.senderId = lsGet(CFG.LS_SENDER_SEL, '') || '';
  if (!S.senders.find(s => s.id === S.senderId)) S.senderId = S.senders.length ? S.senders[0].id : '';
}
function saveSenders() {
  lsSet(CFG.LS_SENDERS, S.senders);
  lsSet(CFG.LS_SENDER_SEL, S.senderId);
}
function currentSender() { return S.senders.find(s => s.id === S.senderId) || null; }
function senderProblems(s) {
  if (!s) return ['依頼主が設定されていません'];
  const p = [];
  if (!s.name) p.push('依頼主の名前が空です');
  if (!normTel(s.tel)) p.push('依頼主の電話が空です');
  if (!normZip(s.zip)) p.push('依頼主の〒が7桁になりません');
  if (!s.addr) p.push('依頼主の住所が空です');
  return p;
}
function newId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

const SENDER_COLS = [
  ['code', ['依頼主コード', 'コード']],
  ['name', ['依頼主名', '名前', '名称', '会社名']],
  ['tel',  ['依頼主電話', '電話', 'TEL']],
  ['zip',  ['依頼主〒', '郵便番号', '〒']],
  ['addr', ['依頼主住所', '住所']],
  ['bldg', ['依頼主建物マンション名', '建物名', '建物', 'ビル名']]
];

/* 依頼主の設定CSVを読みます。同じ名前と電話の依頼主は上書き、ほかは追加します */
async function importSenders(file) {
  const buf = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(buf); }
  catch (e) { text = new TextDecoder('shift_jis').decode(buf); }
  const grid = parseDelimited(text, /\t/.test(text.split(/\r?\n/)[0]) ? '\t' : ',');
  if (grid.length < 2) throw new Error('中身がありません（1行目が見出し、2行目から）');
  const head = grid[0].map(h => String(h).trim());
  /* 1つにまとめた設定ファイル。「種類」の列で依頼主と請求先を分けて読みます */
  const ti = head.indexOf('種類');
  if (ti >= 0) {
    const pick = w => [grid[0]].concat(grid.slice(1).filter(r => String(r[ti] || '').indexOf(w) >= 0));
    const sg = pick('依頼主'), ag = pick('請求先');
    const res = sg.length > 1 ? importSenderGrid(sg) : {added: 0, updated: 0};
    res.accounts = ag.length > 1 ? Issued.importAccounts(ag) : 0;
    res.combined = true;
    return res;
  }
  /* 前の形（依頼主だけ／請求先だけのファイル）もそのまま読めます */
  if (head.some(h => h.indexOf('顧客コード') >= 0)) return {accounts: Issued.importAccounts(grid)};
  return importSenderGrid(grid);
}

function importSenderGrid(grid) {
  const head = grid[0].map(h => String(h).trim());
  const idx = {};
  SENDER_COLS.forEach(([k, words]) => {
    idx[k] = head.findIndex(h => words.some(w => h === w)) ;
    if (idx[k] < 0) idx[k] = head.findIndex(h => words.some(w => h.indexOf(w) >= 0));
  });
  if (idx.name < 0 || idx.addr < 0) throw new Error('見出しに「名前」と「住所」の列が見つかりません');
  let added = 0, updated = 0;
  grid.slice(1).forEach(r => {
    const s = {};
    SENDER_COLS.forEach(([k]) => { s[k] = idx[k] >= 0 ? String(r[idx[k]] || '').trim() : ''; });
    if (!s.name || !s.addr) return;                  // 住所の無い行（請求先の行など）は依頼主にしません
    const old = S.senders.find(x => x.name === s.name && normTel(x.tel) === normTel(s.tel));
    if (old) { Object.assign(old, s); updated++; }
    else { s.id = newId(); S.senders.push(s); added++; }
  });
  if (!S.senderId && S.senders.length) S.senderId = S.senders[0].id;
  saveSenders();
  return {added, updated};
}

/* 依頼主と請求先を1つのファイルに書き出します。ほかのPCにはこれ1つを渡せば済みます */
function exportSettings() {
  const head = ['種類', '依頼主コード', '名前', '電話', '郵便番号', '住所', '建物名', '請求先顧客コード', '分類コード', 'メイン'];
  const lines = [head]
    .concat(S.senders.map(s => ['依頼主', s.code, s.name, s.tel, s.zip, s.addr, s.bldg, '', '', '']))
    .concat(Issued.accounts().map(a => ['請求先', '', a.name, '', '', '', '', a.code, a.cls, a.main ? '○' : '']));
  /* Excelで開いても文字化けしないよう、この設定ファイルだけBOMを付けます */
  download('ラベル設定.csv', '﻿' + lines.map(csvLine).join('\r\n') + '\r\n');
}


/* =================== CSV =================== */

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvLine(a) { return a.map(csvCell).join(','); }

/* CSVは商品名1（同じなら商品名2）の昇順に並べて出します。数字は数として比べます（(2) が (10) より前）。
   同じ商品名どうしは一覧の順のまま */
const ITEM_ORDER = new Intl.Collator('ja', {numeric: true});
function outRows() {
  const s = currentSender();
  const list = S.rows.filter(included)
    .map((row, i) => ({row, i}))
    .sort((a, b) => ITEM_ORDER.compare(a.row.out.item1, b.row.out.item1) || ITEM_ORDER.compare(a.row.out.item2, b.row.out.item2) || a.i - b.i)
    .map(x => x.row);
  return list.map((row, i) => {
    const o = row.out;
    const kind = o.boxes > 1 ? 6 : 0;               // 宅急便。複数口は6
    return [o.memo, o.tel, o.memo2, o.item1, o.item2,
            o.name, o.zip, o.addr1, '', o.addr2, '', o.boxes,
            o.ship, o.due, o.time, s.code || '', kind,
            s.tel, s.name, normZip(s.zip), s.addr, s.bldg || '',
            kind === 6 ? i + 2 : '', '', 0, 0];
  });
}

function download(name, text) {
  const blob = new Blob([text], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function downloadCsv() {
  const noTel = S.rows.filter(r => included(r) && r.out.telEmpty);
  if (noTel.length) {
    const list = noTel.slice(0, 10).map(r => '　' + (r.src + 1) + '行目　' + (r.out.memo || r.out.name)).join('\n');
    const ok = confirm('電話が空の宛先が ' + noTel.length + '件あります。電話は「0」で出します。\n\n' + list +
      (noTel.length > 10 ? '\n　ほか ' + (noTel.length - 10) + '件' : '') + '\n\nこのままCSVを保存しますか。');
    if (!ok) return;
  }
  const rows = outRows();
  const d = new Date();
  const stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes());

  /* 1000件を超えたら1000件ずつのファイルに分けます（商品名順に並べ替えたあとで分ける）。
     くくりキー（複数口の印＝ファイルの中の行番号）は、ファイルごとに振り直します */
  const parts = [];
  for (let i = 0; i < rows.length; i += CFG.CSV_MAX_ROWS) {
    const chunk = rows.slice(i, i + CFG.CSV_MAX_ROWS).map((r, j) => {
      const a = r.slice();
      if (a[16] === 6) a[22] = j + 2;
      return a;
    });
    const total = Math.ceil(rows.length / CFG.CSV_MAX_ROWS);
    parts.push({
      name: 'ラベル_' + stamp + (total > 1 ? '_' + (parts.length + 1) + 'of' + total : '') + '.csv',
      from: i + 1, to: i + chunk.length,
      /* 今スプシから落としているCSVと同じ形（UTF-8、BOMなし、改行CRLF） */
      text: [CFG.CSV_HEAD].concat(chunk).map(csvLine).join('\r\n') + '\r\n'
    });
  }
  /* 続けて保存します。ブラウザに止められたときのために、ファイルごとのボタンも出します */
  parts.forEach((p, i) => setTimeout(() => download(p.name, p.text), i * 700));
  const box = $('#dlParts');
  if (parts.length > 1) {
    box.innerHTML = '<div class="tiny">' + rows.length + '件を ' + parts.length + 'つのファイルに分けました（1ファイル最大' + CFG.CSV_MAX_ROWS + '件）。保存されていないファイルがあれば、ここから保存してください：</div>' +
      '<div class="btns" style="margin-top:4px">' + parts.map((p, i) => '<button class="btn small" data-part="' + i + '">' + esc(p.name) + '（' + p.from + '〜' + p.to + '件目）</button>').join('') + '</div>';
    box.onclick = e => { const b = e.target.closest('[data-part]'); if (b) { const p = parts[Number(b.dataset.part)]; download(p.name, p.text); } };
  } else box.innerHTML = '';

  /* 発行済データと照合するための控え（〒・名前・店名・出荷日だけ）。このブラウザに保存します */
  Issued.saveBatch('ラベル_' + stamp + '.csv', S.rows.filter(included).map(r => r.out));
  toast('CSVを保存しました（' + rows.length + '件' + (parts.length > 1 ? '・' + parts.length + 'ファイル' : '') + '）');
}


/* =================== 画面 =================== */

function renderAll() {
  renderSender();
  renderSource();
  renderMap();
  renderRows();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.tm);
  toast.tm = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ---- 依頼主 ---- */
function renderSender() {
  const s = currentSender();
  const box = $('#senderBox');
  const opts = S.senders.map(x => '<option value="' + esc(x.id) + '"' + (x.id === S.senderId ? ' selected' : '') + '>' +
    esc(x.name) + (x.code ? '（' + esc(x.code) + '）' : '') + '</option>').join('');
  if (!S.senders.length) {
    box.innerHTML =
      '<div class="notice warn">依頼主がまだ設定されていません。最初に1回だけ、依頼主設定のCSVを読み込んでください。</div>' +
      '<div class="btns"><label class="btn primary">設定CSVを読み込む<input type="file" accept=".csv,.txt" id="senderFile" multiple hidden></label>' +
      '<button class="btn" id="senderNew">手で入力する</button></div>';
  } else {
    const p = senderProblems(s);
    box.innerHTML =
      '<div class="sender-row"><select id="senderSel">' + opts + '<option value="__new">＋ 新しく入力する（取引先が依頼主の場合など）</option></select>' +
      '<button class="btn small" id="senderEdit">直す</button>' +
      '<details class="more"><summary>設定ファイル</summary><div class="btns">' +
      '<label class="btn small">設定CSVを読み込む<input type="file" accept=".csv,.txt" id="senderFile" multiple hidden></label>' +
      '<button class="btn small" id="senderExport" title="依頼主と請求先を1つのファイルに書き出します。ほかのPCにはこれを渡してください">設定を書き出す</button>' +
      '<button class="btn small danger" id="senderDel">この依頼主を消す</button></div></details></div>' +
      '<div class="sender-detail">' + esc(s.code ? 'コード ' + s.code + '　' : 'コード なし　') +
      esc(normZip(s.zip)) + '　' + esc(s.addr) + ' ' + esc(s.bldg || '') + '　' + esc(s.tel) + '</div>' +
      (p.length ? '<div class="notice err">' + p.map(esc).join('<br>') + '</div>' : '');
  }
}

function openSenderDialog(s) {
  const d = $('#senderDlg');
  const f = $('#senderForm');
  f.reset();
  f.dataset.id = s ? s.id : '';
  ['code', 'name', 'tel', 'zip', 'addr', 'bldg'].forEach(k => { f.elements[k].value = s ? (s[k] || '') : ''; });
  $('#senderDlgTitle').textContent = s ? '依頼主を直す' : '依頼主を新しく入力';
  $('#senderZipNote').textContent = '';
  f.dataset.zipAuto = '';
  $('#senderMore').open = !!(s && (s.code || s.bldg));
  d.showModal();
}

/* 依頼主の住所から〒を引いて入れます。〒が空か、前に自動で入れたものだけを書き換えます */
async function senderZipFromAddr() {
  const f = $('#senderForm');
  const addr = f.elements.addr.value.trim();
  const note = $('#senderZipNote');
  const zipNow = f.elements.zip.value.trim();
  if (!addr || (zipNow && zipNow !== f.dataset.zipAuto)) return;
  note.textContent = '〒を探しています…';
  note.className = 'tiny muted';
  let r;
  try { r = await Addr.check('', addr); } catch (e) { note.textContent = '郵便番号データが読めませんでした。〒は手で入れてください'; return; }
  if (r.byAddr && r.byAddr.length === 1) {
    const z = Addr.fmtZip(r.byAddr[0].zip);
    f.elements.zip.value = z;
    f.dataset.zipAuto = z;
    note.textContent = '住所から入れました（' + r.byAddr[0].label + '）';
    note.className = 'tiny warn-ink';
  } else if (r.byAddr && r.byAddr.length > 1) {
    note.textContent = '候補が複数あります。手で入れてください：' + r.byAddr.map(c => Addr.fmtZip(c.zip) + ' ' + c.label).join('　');
    note.className = 'tiny warn-ink';
  } else {
    note.textContent = '住所から〒が分かりませんでした。手で入れてください' + (r.msg ? '（' + r.msg + '）' : '');
    note.className = 'tiny err-ink';
  }
}

/* ---- 別紙 ---- */
function renderSource() {
  const has = S.grid.length > 0;
  $('#srcInfo').innerHTML = has
    ? esc(S.fileName) + '　' + S.grid.length + '行 × ' + ncols() + '列'
    : '';
  const names = S.book ? Object.keys(S.book) : [];
  $('#sheetSel').innerHTML = names.map(n => '<option' + (n === S.sheet ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
  $('#sheetWrap').hidden = names.length < 2;
  $('#step2').hidden = !has;
  $('#step3').hidden = !has;
  if (!has) return;

  /* 見出しの行と中身の開始行 */
  $('#headInfo').innerHTML = S.headBottom < 0
    ? '見出しは<b>なし</b>、中身は<b>' + (S.dataFrom + 1) + '行目</b>から'
    : '見出しは<b>' + (S.headTop + 1) + (S.headTop !== S.headBottom ? '〜' + (S.headBottom + 1) : '') + '行目</b>、中身は<b>' + (S.dataFrom + 1) + '行目</b>から';
  $('#dataFrom').value = S.dataFrom + 1;

  /* 別紙を表で見せます。行番号を押すとそこを見出しにします。Excelで非表示の列は出しません */
  const cols = visCols();
  const hiddenCols = [];
  for (let c = 0; c < ncols(); c++) if (S.hc.has(c)) hiddenCols.push(colLetter(c));
  $('#hiddenInfo').textContent = (hiddenCols.length ? 'Excelで非表示の列（' + hiddenCols.join('・') + '）は出していません。' : '') +
    (S.hr.size ? 'Excelで非表示の行が ' + S.hr.size + '行あります（一覧では除外）。' : '');
  const mapped = {};
  CFG.ITEMS.forEach(it => (S.map[it.key] || []).forEach(c => { (mapped[c] || (mapped[c] = [])).push(it.label); }));
  const showTo = Math.min(S.grid.length, 300);
  let h = '<table class="src"><thead><tr><th class="rn"></th>';
  cols.forEach(c => { h += '<th>' + colLetter(c) + '</th>'; });
  h += '</tr><tr class="fillrow"><th class="rn" title="空欄を上の値で埋める">上で埋める</th>';
  cols.forEach(c => {
    const warnFirst = S.fill.has(c) && S.fillFirstEmpty && S.fillFirstEmpty.has(c);
    h += '<th><label class="fill' + (S.fill.has(c) ? ' on' : '') + '" title="この列の空欄を上の値で埋める"><input type="checkbox" data-fill="' + c + '"' +
      (S.fill.has(c) ? ' checked' : '') + '>埋める</label>' + (warnFirst ? '<div class="tiny warn-ink">先頭が空</div>' : '') + '</th>';
  });
  h += '</tr><tr class="maprow"><th class="rn">使い道</th>';
  cols.forEach(c => { h += '<th>' + (mapped[c] ? mapped[c].map(l => '<span class="chip">' + esc(l) + '</span>').join('') : '') + '</th>'; });
  h += '</tr></thead><tbody>';

  /* 上で埋めた値も薄く見せます */
  const filledAt = {};
  if (S.fill.size) {
    const last = {};
    for (let r = S.dataFrom; r < showTo; r++) {
      const row = S.grid[r];
      if (isTotalRow(row) || S.hr.has(r)) continue;
      S.fill.forEach(c => {
        if (cellText(row[c])) last[c] = row[c];
        else if (c in last) filledAt[r + ':' + c] = cellText(last[c]);
      });
    }
  }
  for (let r = 0; r < showTo; r++) {
    const cls = (r >= S.headTop && r <= S.headBottom) ? 'head' : (r < S.dataFrom ? 'above' : (S.hr.has(r) ? 'hid' : ''));
    h += '<tr class="' + cls + '"' + (S.hr.has(r) ? ' title="Excelで非表示の行"' : '') + '><th class="rn"><button class="rnbtn" data-head="' + r + '" title="この行を見出しにする">' + (r + 1) + '</button></th>';
    for (const c of cols) {
      const t = cellText(S.grid[r][c]);
      const f = filledAt[r + ':' + c];
      h += f != null ? '<td class="filled">' + esc(f.slice(0, 24)) + '</td>'
                     : '<td title="' + esc(t) + '">' + esc(t.slice(0, 24)) + '</td>';
    }
    h += '</tr>';
  }
  h += '</tbody></table>';
  if (S.grid.length > showTo) h += '<div class="tiny muted">ほか ' + (S.grid.length - showTo) + '行</div>';
  $('#srcTable').innerHTML = h;
}

/* ---- 列の対応 ---- */
function renderMap() {
  if (!S.grid.length) return;
  /* 選べるのはExcelで見えている列だけ（すでに選ばれている非表示の列は残します） */
  const opts = sel => '<option value="">―</option>' + visCols().concat(sel >= 0 && S.hc.has(sel) ? [sel] : []).map(c => {
    const ht = headText(c), sm = sampleText(c);
    return '<option value="' + c + '"' + (sel === c ? ' selected' : '') + '>' + colLetter(c) + '：' +
      esc((ht || '（見出しなし）').slice(0, 14)) + (sm ? '　例 ' + esc(sm.slice(0, 14)) : '') + '</option>';
  }).join('');
  /* 1項目1行。説明は項目名に重ねると出ます。使う機会の少ない列は「その他の列」に畳みます */
  const row = it => {
    const cols = S.map[it.key] || [];
    const emptyReq = it.need && !cols.length && !(it.key === 'zip' && S.rows.some(r => r.auto.zip));
    const slots = it.multi ? Math.min(3, cols.length + 1) : 1;
    let r = '<div class="mr"><div class="ml"' + (it.hint ? ' title="' + esc(it.hint) + '"' : '') + '>' + esc(it.label) +
      (it.need ? '<span class="need">必須</span>' : '') + (it.hint ? '<span class="q">?</span>' : '') + '</div><div class="ms">';
    for (let i = 0; i < slots; i++) {
      r += '<select data-map="' + it.key + '" data-i="' + i + '"' + (i === 0 && emptyReq ? ' class="req-empty"' : '') + '>' + opts(cols[i] == null ? -1 : cols[i]) + '</select>';
    }
    r += '</div></div>';
    if (it.key === 'qty1' || it.key === 'qty2') {
      const o = it.key === 'qty1' ? S.item1 : S.item2;
      const p = it.key === 'qty1' ? 'item1' : 'item2';
      /* 商品1の名前はいつも必須。商品2は数量の列を選んだときだけ必須 */
      const nameNeed = p === 'item1' || cols.length > 0;
      /* 商品名は「入力」か「数量の列の見出し」を選べます */
      const fromHead = o.src === 'head';
      const nm = itemName(p);
      r += '<div class="mr sub"><div class="ml tiny muted" title="ラベルの商品名は「' + esc(nm || '商品名') + '(10)」の形で出ます">└ 商品名・入数' + (nameNeed ? '<span class="need">必須</span>' : '') + '</div><div class="ms inline">' +
        '<select data-item="' + p + '" data-f="src" class="srcsel" title="商品名を入力するか、数量の列の見出しをそのまま使うか">' +
          '<option value="input"' + (fromHead ? '' : ' selected') + '>入力</option><option value="head"' + (fromHead ? ' selected' : '') + '>見出し</option></select>' +
        (fromHead
          ? '<input type="text" readonly value="' + esc(nm) + '" placeholder="数量の列を選ぶと見出しが入ります" title="数量の列の見出しを使います"' + (nameNeed && !nm ? ' class="req-empty"' : ' class="fromhead"') + '>'
          : '<input type="text" data-item="' + p + '" data-f="name" data-need="' + (nameNeed ? 1 : '') + '" value="' + esc(o.name) + '" placeholder="例：非常用トイレ"' + (nameNeed && !nm ? ' class="req-empty"' : '') + '>') +
        '<span class="plus">÷</span><input type="number" min="1" data-item="' + p + '" data-f="per" value="' + esc(o.per) + '" placeholder="入数" class="w4" title="1箱に入る数。個口＝数量÷入数"><span class="plus">個/箱</span></div></div>';
      /* 個口の計算のしかた。商品1と商品2の両方にかかるので、商品2の下に1回だけ出します */
      if (it.key === 'qty2') {
        const opt = (v, label, tip) => '<label class="boxmode" title="' + tip + '"><input type="radio" name="boxMode" value="' + v + '"' + (S.boxMode === v ? ' checked' : '') + '> ' + label + '</label>';
        r += '<div class="mr sub"><div class="ml tiny muted">└ 個口の計算</div><div class="ms">' +
          opt('each', '割って切り上げてから足す', '商品ごとに 数量÷入数 を切り上げて足します（別々の箱に詰める）。例：30÷48→1、30÷24→2、合計3口') +
          opt('mix', '割ったまま足して最後に切り上げ', '数量÷入数 を切り上げずに足して、最後に切り上げます（同じ箱に混ぜて詰める）。例：0.625＋1.25＝1.875→2口') +
          '</div></div>';
      }
    }
    if (it.key === 'store') {
      r += '<div class="mr sub"><div class="ml tiny muted" title="入れると「名前」に会社名、「備考(住所4)」に店名が入ります。空なら店名が「名前」に入ります">└ 会社名</div><div class="ms">' +
        '<input type="text" id="company" value="' + esc(S.company) + '" placeholder="全行共通。例：株式会社△△（付けないなら空）"></div></div>';
    }
    return r;
  };
  /* まとまりごとに少し間を空けます（宛先／商品と個口／日付と時間／記事） */
  const GROUP_START = ['qty1', 'due', 'memo2'];
  let h = CFG.ITEMS.map(it => (GROUP_START.includes(it.key) ? '<div class="moregap"></div>' : '') + row(it)).join('');
  $('#mapBox').innerHTML = h;
}

/* ---- 一覧 ---- */
/* 表全体を描き直します（別紙を入れた・列を変えた・一括で入れた とき）。
   1行だけ変わったときは updateRows で、その行だけ描き直します（172行で全体は0.2〜0.3秒かかるため） */
function renderRows() {
  if (!S.grid.length) return;
  const focus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.cell;
  const ae = document.activeElement;
  const focusSel = focus && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;

  renderSummary();
  const showQ2 = (S.map.qty2 || []).length || itemName('item2');
  let h = '<table class="rows"><thead><tr>' +
    '<th class="c-sel"><input type="checkbox" id="selAll" title="全部選ぶ"></th><th class="c-rn">行</th><th class="c-inc" title="チェックが入っている行だけCSVに出します">発行</th>' +
    '<th>名前</th><th>備考(住所4)</th><th>電話</th><th>〒</th><th class="c-addr">住所</th>' +
    '<th>数量1</th>' + (showQ2 ? '<th>数量2</th>' : '') + '<th>個口</th><th>指定日</th><th>出荷日</th><th>時間</th><th>記事</th>' +
    '</tr></thead>';
  /* 1行ぶんを <tbody> 1つにまとめ、行だけ差し替えられるようにします */
  visibleRows().forEach(row => { h += '<tbody data-row="' + row.src + '">' + rowHtml(row) + '</tbody>'; });
  h += '</table>';
  $('#rowsTable').innerHTML = h;
  const all = $('#selAll');
  if (all) all.checked = visibleRows().length > 0 && visibleRows().every(r => S.sel.has(r.src));

  if (S.pendingFocus) focusCell(S.pendingFocus);
  else if (focus) {
    /* 描き直しても、入っていたセルと選んでいた範囲はそのままにします */
    const el = document.querySelector('[data-cell="' + focus + '"]');
    if (el) {
      el.focus();
      if (focusSel && el.setSelectionRange) { try { el.setSelectionRange(focusSel[0], focusSel[1]); } catch (e) { /* 選べない欄 */ } }
    }
  }
  renderPreview();
}

/* 指定した行だけ描き直します */
function updateRows(srcs) {
  const focus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.cell;
  srcs.forEach(src => {
    const row = S.rows.find(r => r.src === src);
    const tb = document.querySelector('#rowsTable tbody[data-row="' + src + '"]');
    if (row && tb) tb.innerHTML = rowHtml(row);
  });
  renderSummary();
  if (S.pendingFocus) focusCell(S.pendingFocus);
  else if (focus && !document.activeElement.dataset.cell) {
    const el = document.querySelector('[data-cell="' + focus + '"]');
    if (el) el.focus();
  }
  renderPreview();
}

/* 選択の印（行の色とチェック）だけを塗り直します。表は描き直しません */
function paintSel(srcs) {
  srcs.forEach(src => {
    const tb = document.querySelector('#rowsTable tbody[data-row="' + src + '"]');
    if (!tb) return;
    const on = S.sel.has(src);
    const tr = tb.querySelector('tr');
    if (tr) tr.classList.toggle('selected', on);
    const cb = tb.querySelector('[data-sel]');
    if (cb) cb.checked = on;
  });
  renderSummary();
}

/* 件数・保存ボタン・選択中の表示 */
function renderSummary() {
  const inc = S.rows.filter(included);
  const nErr = inc.filter(r => r.err.length).length;
  const nPending = inc.filter(r => r.check && r.check.status === 'pending').length;
  const nChk = inc.filter(r => r.err.includes('check')).length;
  const boxes = inc.reduce((a, r) => a + (r.out.boxes || 0), 0);
  const sumQ = k => inc.reduce((a, r) => { const n = num(r.out[k]); return a + (isNaN(n) ? 0 : n); }, 0);
  const excl = S.rows.length - inc.length;
  const sp = senderProblems(currentSender());

  /* 件数のうち、問題の件数は押すとその行だけに絞り込めます（もう一度押すと全部に戻る） */
  const chip = (view, cls, label, n) => n ? '<button type="button" class="stat stat-btn ' + cls + (S.view === view ? ' on' : '') + '" data-view="' + view + '" title="押すとこの行だけを表に出します">' +
    label + ' ' + n + (view === 'excl' ? '行' : '件') + (S.view === view ? ' ✕' : '') + '</button>' : '';
  $('#summary').innerHTML =
    '<span class="stat"><b>' + inc.length + '</b>件</span>' +
    '<span class="stat">個口合計 <b>' + boxes + '</b></span>' +
    ((S.map.qty1 || []).length ? '<span class="stat">' + esc(itemName('item1') || '商品1') + ' <b>' + sumQ('q1') + '</b></span>' : '') +
    ((S.map.qty2 || []).length ? '<span class="stat">' + esc(itemName('item2') || '商品2') + ' <b>' + sumQ('q2') + '</b></span>' : '') +
    chip('excl', 'muted', '除外', excl) +
    chip('chk', 'warn-ink', '〒の確認', nChk) +
    chip('filled', 'warn-ink', '〒を住所から入れた', inc.filter(r => r.out.zipFilled).length) +
    chip('bad', 'err-ink', '要修正', inc.filter(r => r.err.some(e => e !== 'check')).length) +
    (S.view ? '<button type="button" class="stat stat-btn" data-view="">全部表示に戻す（' + visibleRows().length + '/' + S.rows.length + '行を表示中）</button>' : '') +
    (nPending ? '<span class="stat muted">照合中…</span>' : '');

  const block = [];
  if (!inc.length) block.push('宛先が0件です');
  CFG.ITEMS.forEach(it => {
    if (it.need && !(S.map[it.key] || []).length && !(it.key === 'zip' && S.rows.some(r => r.auto.zip))) block.push('「' + it.label + '」の列を選んでください');
  });
  if (!itemName('item1')) block.push('商品1の商品名を入れてください');
  if ((S.map.qty2 || []).length && !itemName('item2')) block.push('商品2の商品名を入れてください');
  sp.forEach(p => block.push(p));
  if (nErr) block.push('直すところが残っています（赤い行）');
  if (nPending) block.push('住所の照合が終わっていません');
  const btn = $('#dlBtn');
  btn.disabled = block.length > 0;
  $('#dlWhy').textContent = block.join('　／　');

  /* 選択中の行への一括操作 */
  /* 幅は固定。選んでも右のボタンが動かないように、文字の長さを変えません */
  $('#selInfo').textContent = '選択 ' + S.sel.size + '行';
  $('#bulk').classList.toggle('dim', !S.sel.size);

  const all = $('#selAll');
  if (all) all.checked = visibleRows().length > 0 && visibleRows().every(r => S.sel.has(r.src));
}

/* 絞り込み。'' は全部、chk＝〒の確認、filled＝〒を住所から入れた、bad＝要修正、excl＝除外 */
function inView(row) {
  const inn = included(row);
  switch (S.view) {
    case 'chk':    return inn && row.err.includes('check');
    case 'filled': return inn && !!row.out.zipFilled;
    case 'bad':    return inn && row.err.some(e => e !== 'check');
    case 'excl':   return !inn;
    default:       return true;
  }
}
function visibleRows() { return S.rows.filter(inView); }

/* 商品名。src が 'head' なら数量の列の見出しを、そうでなければ入力した名前を使います */
function itemName(p) {
  const it = S[p];
  if (it.src === 'head') {
    const c = (S.map[p === 'item1' ? 'qty1' : 'qty2'] || [])[0];
    return c == null ? '' : headText(c).trim();
  }
  return String(it.name || '').trim();
}

function showQ2() { return (S.map.qty2 || []).length || itemName('item2'); }

/* 1行ぶんの HTML（本体の行と、問題・お知らせの行） */
function rowHtml(row) {
  const cols = 14 + (showQ2() ? 1 : 0);
  const cell = (row, key, shown, cls, extra) => {
    const ed = edited(row, key);
    const orig = row.auto[key];
    const title = ed ? '元の値：' + (cellText(orig) || '（空）') : (row.filledKeys.has(key) ? '上の値で埋めました' : '');
    return '<td class="' + (cls || '') + (ed ? ' edited' : '') + (row.filledKeys.has(key) && !ed ? ' filled' : '') + '"' +
      (title ? ' title="' + esc(title) + '"' : '') + '><input data-cell="' + row.src + ':' + key + '" value="' + esc(shown) + '"' + (extra || '') + '></td>';
  };
    const inn = included(row);
    const o = row.out;
    const bad = inn && row.err.some(e => e !== 'check');
    const chk = inn && row.err.includes('check');
    const cls = !inn ? 'excl' : (bad ? 'bad' : (chk ? 'chk' : ''));
    const [nameAuto, memoAuto] = autoNameMemo(row);
    const nameShown = edited(row, 'name') ? val(row, 'name') : nameAuto;
    const memoShown = edited(row, 'memo') ? val(row, 'memo') : memoAuto;
    const hasEdits = S.edits[row.src] && Object.keys(S.edits[row.src]).length;
    let h = '<tr class="' + cls + (S.sel.has(row.src) ? ' selected' : '') + '">' +
      '<td class="c-sel"><input type="checkbox" data-sel="' + row.src + '"' + (S.sel.has(row.src) ? ' checked' : '') + '></td>' +
      '<td class="c-rn">' + (row.src + 1) + (hasEdits ? '<button class="undo" data-undo="' + row.src + '" title="この行の手直しを全部戻す">↺</button>' : '') + '</td>' +
      '<td class="c-inc"><input type="checkbox" data-inc="' + row.src + '"' + (inn ? ' checked' : '') + '></td>' +
      cell(row, 'name', nameShown, 'w-name') +
      cell(row, 'memo', memoShown, 'w-memo') +
      cell(row, 'tel', edited(row, 'tel') ? val(row, 'tel') : o.tel, 'w-tel') +
      (o.zipFilled && !edited(row, 'zip')
        ? '<td class="w-zip filledzip" title="住所から入れました（元の〒：' + esc(o.zipFilled) + '）"><input data-cell="' + row.src + ':zip" value="' + esc(o.zip) + '"></td>'
        : cell(row, 'zip', edited(row, 'zip') ? val(row, 'zip') : (o.zip || row.auto.zip), 'w-zip')) +
      cell(row, 'addr', edited(row, 'addr') ? val(row, 'addr') : row.auto.addr, 'c-addr') +
      cell(row, 'qty1', val(row, 'qty1'), 'w-num') +
      (showQ2() ? cell(row, 'qty2', val(row, 'qty2'), 'w-num') : '') +
      '<td class="w-num' + (edited(row, 'boxes') ? ' edited' : '') + '" title="' + (edited(row, 'boxes') ? '自動なら ' + o.boxesAuto : '自動') + '">' +
        '<input data-cell="' + row.src + ':boxes" value="' + esc(o.boxes) + '">' +
        (edited(row, 'boxes') && o.boxesAuto !== o.boxes ? '<div class="tiny muted">自動 ' + o.boxesAuto + '</div>' : '') + '</td>' +
      cell(row, 'due', o.due ? o.due.slice(5) + '(' + weekday(o.due) + ')' : cellText(val(row, 'due')), 'w-date') +
      '<td class="w-date' + (edited(row, 'ship') ? ' edited' : '') + (o.shipAuto ? ' auto' : '') + '" title="' + (o.shipAuto ? '指定日から自動で出しました' : '') + '">' +
        '<input data-cell="' + row.src + ':ship" value="' + esc(o.ship ? o.ship.slice(5) + '(' + weekday(o.ship) + ')' : cellText(val(row, 'ship'))) + '"></td>' +
      '<td class="w-time' + (edited(row, 'time') ? ' edited' : '') + '"><select data-cell="' + row.src + ':time">' +
        CFG.TIMES.map(([v, l]) => '<option value="' + v + '"' + (o.time === v ? ' selected' : '') + '>' + l + '</option>').join('') +
        (o.time === '' && val(row, 'time') && normTime(val(row, 'time')) === null ? '<option selected>' + esc(val(row, 'time')) + '（読めません）</option>' : '') +
        '</select></td>' +
      cell(row, 'memo2', val(row, 'memo2'), 'w-memo') +
      '</tr>';

    /* 問題とお知らせは、その行のすぐ下に出します */
    const msgs = [];
    if (!inn) msgs.push('<span class="muted">除外' + (row.autoExclude && !(row.src in S.include) ? '（' + esc(row.autoExclude) + '）' : '') + '</span>');
    else {
      row.err.filter(e => e !== 'check').forEach(e => msgs.push('<span class="err-ink">✕ ' + esc(e) + '</span>'));
      if (chk) msgs.push(checkUi(row));
      row.warn.forEach(w => msgs.push('<span class="warn-ink">△ ' + esc(w) + '</span>'));
      if (o.addr2 && bytes(o.addr2) > 32) msgs.push('<span class="warn-ink">△ 住所が長く、2行目が ' + bytes(o.addr2) + 'バイトあります</span>');
    }
    if (msgs.length) h += '<tr class="msg ' + cls + '"><td colspan="3"></td><td colspan="' + (cols - 3) + '">' + msgs.join('　') + '</td></tr>';
    return h;
}

/* 表のセルに入ります。中身を選んだ状態にするので、そのまま打てば上書きできます */
function focusCell(id) {
  const el = document.querySelector('[data-cell="' + id + '"]');
  if (!el) return;
  S.pendingFocus = '';
  el.focus();
  if (el.select) el.select();
}

/* 〒と住所がずれている行の、選ぶところ */
function checkUi(row) {
  const ck = row.check;
  const zip = row.out.zipIn;
  let h = '<div class="ck"><div class="ck-title">〒と住所が合いません。どちらが正しいか選んでください' + (ck.msg ? '（' + esc(ck.msg) + '）' : '') + '</div>';
  h += '<div class="ck-opts">';
  ck.byAddr.forEach(c => {
    h += '<button class="btn small primary" data-fixzip="' + row.src + '" data-zip="' + c.zip + '">住所どおり：〒を ' + Addr.fmtZip(c.zip) + ' にする</button>' +
      '<span class="tiny">' + esc(c.label) + '</span>';
  });
  if (!ck.byAddr.length) h += '<span class="tiny muted">住所からは〒を引けませんでした。住所か〒を手で直してください</span>';
  h += '</div><div class="ck-opts">';
  h += '<span class="tiny">今の〒 ' + esc(zip || '（なし）') + ' は：' + esc(ck.byZip || '―') + '</span>';
  if (zip) h += '<button class="btn small" data-keep="' + row.src + '">このまま出す</button>';
  h += '</div></div>';
  return h;
}

/* CSVの先頭を見せます */
function renderPreview() {
  const s = currentSender();
  const box = $('#csvPreview');
  if (!s || !S.rows.some(included)) { box.innerHTML = ''; return; }
  const rows = outRows().slice(0, 5);
  let h = '<table class="src"><thead><tr>' + CFG.CSV_HEAD.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>';
  rows.forEach(r => { h += '<tr>' + r.map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>'; });
  h += '</tbody></table>';
  box.innerHTML = h;
}


/* =================== 操作 =================== */

function commitCell(el) {
  const [src, key] = el.dataset.cell.split(':');
  const row = S.rows.find(r => String(r.src) === src);
  if (!row) return;
  let v = el.value;
  const trimmed = String(v).trim();

  /* 表示用に「10/01(水)」の形にしているので、同じなら触っていないとみなします */
  if (key === 'due' || key === 'ship') {
    const shown = row.out[key] ? row.out[key].slice(5) + '(' + weekday(row.out[key]) + ')' : cellText(val(row, key));
    if (trimmed === shown) return;
    v = trimmed.replace(/\(.\)$/, '');
    if (v && /^\d{1,2}\/\d{1,2}$/.test(v)) v = parseDate(v) || v;
  }
  if (key === 'boxes') {
    if (trimmed === String(row.out.boxesAuto) && !edited(row, 'boxes')) return;
    if (trimmed === String(row.out.boxesAuto)) { delete S.edits[row.src].boxes; recomputeRow(row); return; }
  }
  const autoV = key === 'name' ? autoNameMemo(row)[0]
              : key === 'memo' ? autoNameMemo(row)[1]
              : key === 'tel' ? normTel(row.auto.tel)
              : cellText(row.auto[key]);
  if (!edited(row, key) && trimmed === String(autoV)) return;
  if (trimmed === String(autoV)) delete S.edits[row.src][key];
  else setEdit(row.src, key, key === 'time' ? v : trimmed);
  recomputeRow(row);
}

/* 1行だけ計算し直して、その行だけ描き直します */
function recomputeRow(row) {
  computeRow(row);
  updateRows([row.src]);
  runChecks();
}

function recompute() {
  S.rows.forEach(computeRow);
  renderRows();
  runChecks();
}

function bindEvents() {
  /* 別紙を入れる */
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f).catch(err => toast('読めませんでした：' + err.message));
  });
  $('#fileIn').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) readFile(f).catch(err => toast('読めませんでした：' + err.message));
    e.target.value = '';
  });
  $('#pasteIn').addEventListener('paste', e => {
    const t = e.clipboardData.getData('text/plain');
    if (t) { e.preventDefault(); readPaste(t); e.target.value = ''; toast('貼り付けた表を読みました'); }
  });
  $('#sheetSel').addEventListener('change', e => { S.sheet = e.target.value; loadSheet(); });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset && t.dataset.item && t.dataset.f === 'name') t.classList.toggle('req-empty', !!t.dataset.need && !t.value.trim());
  });
  document.addEventListener('toggle', e => { if (e.target.id === 'moreCols') S.moreOpen = e.target.open; }, true);

  /* 見出し */
  document.addEventListener('click', e => {
    const hb = e.target.closest('[data-head]');
    if (hb) { setHeader(Number(hb.dataset.head)); guessMap(); rebuild(); return; }
  });
  $('#noHead').addEventListener('click', () => { S.headTop = -1; S.headBottom = -1; S.dataFrom = 0; guessMap(); rebuild(); });
  $('#reguess').addEventListener('click', () => { guessMap(); rebuild(); toast('見出しから当て直しました'); });
  $('#dataFrom').addEventListener('change', e => {
    const n = Math.max(1, Math.min(S.grid.length, Number(e.target.value) || 1));
    S.dataFrom = n - 1;
    if (S.headBottom >= S.dataFrom) { S.headBottom = S.dataFrom - 1; S.headTop = Math.min(S.headTop, S.headBottom); }
    rebuild();
  });

  /* 上の値で埋める・列の対応・商品・会社名 */
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.fill != null) {
      const c = Number(t.dataset.fill);
      if (t.checked) S.fill.add(c); else S.fill.delete(c);
      rebuild(); return;
    }
    if (t.dataset.map) {
      const k = t.dataset.map, i = Number(t.dataset.i);
      const a = (S.map[k] || []).slice();
      if (t.value === '') a.splice(i, 1); else a[i] = Number(t.value);
      S.map[k] = a.filter(x => x != null);
      rebuild(); return;
    }
    if (t.dataset.item) {
      S[t.dataset.item][t.dataset.f] = t.value;
      lsSet(CFG.LS_ITEMS, {item1: S.item1, item2: S.item2, boxMode: S.boxMode});
      renderMap(); recompute(); return;
    }
    if (t.name === 'boxMode') {
      S.boxMode = t.value === 'mix' ? 'mix' : 'each';
      lsSet(CFG.LS_ITEMS, {item1: S.item1, item2: S.item2, boxMode: S.boxMode});
      recompute(); return;
    }
    if (t.id === 'company') { S.company = t.value; recompute(); return; }
    if (t.dataset.cell) { commitCell(t); return; }
    if (t.dataset.inc != null) {
      const src = Number(t.dataset.inc);
      const row = S.rows.find(r => r.src === src);
      if (t.checked === !row.autoExclude) delete S.include[src]; else S.include[src] = t.checked;
      recomputeRow(row); return;
    }
    if (t.id === 'senderSel') {
      if (t.value === '__new') { renderSender(); openSenderDialog(null); return; }
      S.senderId = t.value; saveSenders(); renderSender(); renderRows(); return;
    }
    if (t.id === 'senderFile') {
      const fs = Array.from(t.files || []);
      (async () => {
        const msg = [];
        for (const f of fs) {
          try {
            const r = await importSenders(f);
            msg.push(r.combined ? '依頼主 ' + (r.added + r.updated) + '件・請求先 ' + r.accounts + '件'
                     : r.accounts != null ? '請求先 ' + r.accounts + '件' : '依頼主（追加 ' + r.added + '・更新 ' + r.updated + '）');
          } catch (err) { msg.push(f.name + ' は読めませんでした：' + err.message); }
        }
        toast('読み込みました：' + msg.join(' ／ '));
        renderSender(); renderRows();
      })();
      t.value = '';
      return;
    }
  });
  /* 表の中は Enter で下、Tab で右（Shift を押しながらで上・左）。行の右端の Tab は次の行の左端へ */
  document.addEventListener('keydown', e => {
    const t = e.target;
    if (!t.dataset || !t.dataset.cell) return;
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    const [src, key] = t.dataset.cell.split(':');
    const cells = Array.from(document.querySelectorAll('table.rows [data-cell]'));
    const keys = [], srcs = [];
    cells.forEach(c => {
      const [s, k] = c.dataset.cell.split(':');
      if (!keys.includes(k)) keys.push(k);
      if (!srcs.includes(s)) srcs.push(s);
    });
    let si = srcs.indexOf(src), ki = keys.indexOf(key);
    if (e.key === 'Enter') si += e.shiftKey ? -1 : 1;
    else {
      ki += e.shiftKey ? -1 : 1;
      if (ki >= keys.length) { ki = 0; si++; }
      if (ki < 0) { ki = keys.length - 1; si--; }
    }
    const next = (si >= 0 && si < srcs.length) ? srcs[si] + ':' + keys[ki] : '';
    /* 値を変えていれば確定（表を描き直すので、描き直したあとに移り先へ入ります） */
    S.pendingFocus = next;
    const changed = t.tagName === 'SELECT' ? false : t.value !== t.defaultValue;
    if (changed) commitCell(t);
    if (S.pendingFocus) focusCell(S.pendingFocus);
    if (!next) t.blur();
  });

  /* 行の選択（Shiftで範囲） */
  document.addEventListener('click', e => {
    /* チェックの周り（マス全体）を押しても、チェックを押したことにします */
    const td = e.target.closest && e.target.closest('td.c-sel, td.c-inc');
    if (td && e.target === td) {
      const cb = td.querySelector('input[type=checkbox]');
      if (cb) cb.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, shiftKey: e.shiftKey}));
      return;
    }
    const t = e.target;
    if (t.id === 'selAll') {
      /* 絞り込み中は、表に出ている行だけを選びます */
      const vis = visibleRows();
      vis.forEach(r => { if (t.checked) S.sel.add(r.src); else S.sel.delete(r.src); });
      paintSel(vis.map(r => r.src)); return;
    }
    const vb = t.closest && t.closest('[data-view]');
    if (vb) { S.view = S.view === vb.dataset.view ? '' : vb.dataset.view; renderRows(); return; }
    if (t.dataset && t.dataset.sel != null) {
      const src = Number(t.dataset.sel);
      if (e.shiftKey && S.lastClick != null) {
        const ids = visibleRows().map(r => r.src);
        const a = ids.indexOf(S.lastClick), b = ids.indexOf(src);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) { if (t.checked) S.sel.add(ids[i]); else S.sel.delete(ids[i]); }
      } else if (t.checked) S.sel.add(src); else S.sel.delete(src);
      S.lastClick = src;
      paintSel(S.rows.map(r => r.src)); return;
    }
    if (t.dataset && t.dataset.undo != null) {
      const row = S.rows.find(r => r.src === Number(t.dataset.undo));
      delete S.edits[row.src]; recomputeRow(row); return;
    }
    if (t.dataset && t.dataset.fixzip != null) {
      const row = S.rows.find(r => r.src === Number(t.dataset.fixzip));
      setEdit(row.src, 'zip', Addr.fmtZip(t.dataset.zip)); recomputeRow(row); return;
    }
    if (t.dataset && t.dataset.keep != null) {
      const row = S.rows.find(r => r.src === Number(t.dataset.keep));
      const addrIn = String(val(row, 'addr') || '').replace(/\s+/g, ' ').trim();
      setEdit(row.src, 'addrOk', row.out.zipIn + '|' + addrIn); recomputeRow(row); return;
    }
    if (t.id === 'senderNew') { openSenderDialog(null); return; }
    if (t.id === 'senderEdit') { openSenderDialog(currentSender()); return; }
    if (t.id === 'senderExport') { exportSettings(); return; }
    if (t.id === 'senderDel') {
      const s = currentSender();
      if (s && confirm('「' + s.name + '」をこのブラウザから消しますか')) {
        S.senders = S.senders.filter(x => x.id !== s.id);
        S.senderId = S.senders.length ? S.senders[0].id : '';
        saveSenders(); renderSender(); renderRows();
      }
      return;
    }
  });

  /* 選択中の行への一括操作 */
  const bulk = (fn) => { if (!S.sel.size) { toast('先に行を選んでください'); return; } S.sel.forEach(fn); recompute(); };
  /* 日付や時間を選んだ時点で、選択中の行に入れます（入れるボタンは無し） */
  /* 入れたら欄を空に戻します。同じ日付を別の行にもう一度入れられるように */
  const bulkSet = (el, key, label, conv) => el.addEventListener('change', e => {
    const raw = e.target.value;
    if (raw === '' || raw === '__') return;
    const v = conv(raw);
    const n = S.sel.size;
    if (n) {
      bulk(src => setEdit(src, key, v));
      toast(label + '「' + (key === 'time' ? (CFG.TIMES.find(t => t[0] === v) || ['', v])[1] : v.slice(5)) + '」を ' + n + '行に入れました');
    } else toast('先に行を選んでください');
    e.target.value = key === 'time' ? '__' : '';
  });
  /* 日付の欄は、どこを押してもカレンダーを出します（右端のアイコンだけでなく） */
  ['#vDue', '#vShip'].forEach(id => $(id).addEventListener('click', e => {
    try { if (e.target.showPicker) e.target.showPicker(); } catch (err) { /* 出せないブラウザでは通常どおり */ }
  }));
  bulkSet($('#vDue'), 'due', '指定日', v => v.replace(/-/g, '/'));
  bulkSet($('#vShip'), 'ship', '出荷日', v => v.replace(/-/g, '/'));
  bulkSet($('#vTime'), 'time', '時間', v => v);
  $('#bBoxAuto').addEventListener('click', () => bulk(src => { if (S.edits[src]) delete S.edits[src].boxes; }));
  $('#bExcl').addEventListener('click', () => bulk(src => { const r = S.rows.find(x => x.src === src); if (r.autoExclude) delete S.include[src]; else S.include[src] = false; }));
  $('#bIncl').addEventListener('click', () => bulk(src => { const r = S.rows.find(x => x.src === src); if (!r.autoExclude) delete S.include[src]; else S.include[src] = true; }));
  $('#bClear').addEventListener('click', () => { S.sel.clear(); renderRows(); });

  $('#dlBtn').addEventListener('click', downloadCsv);

  /* 依頼主の入力 */
  $('#senderForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    /* 〒が空のまま保存を押したら、先に住所から引いてみます */
    if (!normZip(f.elements.zip.value) && f.elements.addr.value.trim()) await senderZipFromAddr();
    const s = {};
    ['code', 'name', 'tel', 'zip', 'addr', 'bldg'].forEach(k => { s[k] = f.elements[k].value.trim(); });
    const miss = [];
    if (!s.name) miss.push('名称');
    if (!normTel(s.tel)) miss.push('電話');
    if (!s.addr) miss.push('住所');
    if (!normZip(s.zip)) miss.push('〒（7桁）');
    if (miss.length) { toast(miss.join('・') + ' を入れてください'); return; }
    s.zip = normZip(s.zip);
    const id = f.dataset.id;
    if (id) Object.assign(S.senders.find(x => x.id === id), s);
    else { s.id = newId(); S.senders.push(s); S.senderId = s.id; }
    saveSenders();
    $('#senderDlg').close();
    renderSender(); renderRows();
  });
  $('#senderCancel').addEventListener('click', () => { $('#senderDlg').close(); renderSender(); });
  $('#senderForm').elements.addr.addEventListener('change', senderZipFromAddr);
}


/* =================== 起動 =================== */

function init() {
  loadSenders();
  const it = lsGet(CFG.LS_ITEMS, null);
  if (it) {
    S.item1 = Object.assign(S.item1, it.item1 || {}); S.item2 = Object.assign(S.item2, it.item2 || {});
    if (it.boxMode === 'mix') S.boxMode = 'mix';
  }
  /* 先頭の「選ぶ」は何も入れない印。時間を入れたらここに戻します */
  $('#vTime').innerHTML = '<option value="__">（選ぶ）</option>' + CFG.TIMES.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('');
  bindEvents();
  Issued.bind();
  renderAll();
  loadAddrMaster().then(() => { if (S.rows.length) { S.checks = {}; recompute(); } });
  Addr.loadIndex().then(() => { $('#dataVer').textContent = Addr.ver ? '郵便番号データ ' + Addr.ver + ' 版' : ''; })
    .catch(e => { $('#dataVer').textContent = e.message; });
}

document.addEventListener('DOMContentLoaded', init);
