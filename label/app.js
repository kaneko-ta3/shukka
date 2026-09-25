/* =============================================================
 *  複数宛先ラベル — 別紙のExcelから、B2に上げる26列のCSVを作る
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
     hint: '会社名を入れたときは「備考(住所4)」へ、空のときは「名前」へ入ります'},
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
    store: ['お届け先名', '届け先名', '納品先', '宛先', '施設名', '学校名', '店舗名', '店名', '事業所名', '名称', '拠点', '営業所'],
    memo2: ['備考', '記事']
  },

  /* リードタイム。出荷日が空の行は、指定日からこの日数さかのぼります（土日は金曜へ） */
  LEAD_NEAR: 1,
  LEAD_FAR: 2,
  NEAR_PREF: ['東京都', '神奈川県', '埼玉県', '千葉県', '茨城県', '栃木県', '群馬県',
              '山梨県', '長野県', '新潟県', '静岡県', '愛知県', '岐阜県', '三重県',
              '富山県', '石川県', '福井県', '滋賀県', '京都府', '大阪府', '兵庫県',
              '奈良県', '和歌山県'],

  TIMES: [['', '指定なし'], ['0812', '午前中'], ['1416', '14〜16時'], ['1618', '16〜18時'],
          ['1820', '18〜20時'], ['1921', '19〜21時']],

  /* B2の文字数。バイトで数えます（全角2・半角1） */
  NAME_BYTES: 32,
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
  rows: [],                 // 組み立てた行
  edits: {},                // 元の行番号 -> {項目: 手で入れた値}
  include: {},              // 元の行番号 -> true/false（手で含める／外す）
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
  d.setDate(d.getDate() - (CFG.NEAR_PREF.includes(pref) ? CFG.LEAD_NEAR : CFG.LEAD_FAR));
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return fmtYMD(d.getFullYear(), d.getMonth() + 1, d.getDate());
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
  S.edits = {}; S.include = {}; S.sel = new Set(); S.fill = new Set(); S.lastClick = null; S.moreOpen = null;
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

/* 1行ぶんの出力値と、問題の一覧を作ります */
function computeRow(row) {
  const err = [], warn = [];
  const company = S.company.trim();
  const store = String(val(row, 'store') || '').trim();

  const nameSrc = edited(row, 'name') ? String(val(row, 'name')) : (company || store);
  const memoSrc = edited(row, 'memo') ? String(val(row, 'memo')) : (company ? store : '');
  const name = asc(nameSrc).trim();
  if (!name) err.push('名前が空です');
  else if (bytes(name) > CFG.NAME_BYTES) err.push('名前が長すぎます（全角16文字まで。今 ' + Math.ceil(bytes(name) / 2) + '文字）');

  let tel = normTel(val(row, 'tel'));
  const telEmpty = !tel;
  if (telEmpty) { tel = '0'; warn.push('電話が空なので「0」で出します'); }

  const zipRaw = String(val(row, 'zip') || '');
  const zip = normZip(zipRaw);
  if (!zip) err.push(zipRaw ? '〒が7桁になりません（' + zipRaw + '）' : '〒が空です');

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
      if (ck.status === 'ok') { if (ck.biz) warn.push('会社専用の〒です（' + ck.biz + '）'); }
      else if (ck.status === 'nodata') warn.push(ck.msg);
      else if (okSig === zip + '|' + addrIn) warn.push('〒と住所の照合：このまま出すことにしました');
      else if (zip || ck.status !== 'nozip') err.push('check');
    }
  }

  /* 商品と数量 */
  const q1 = String(val(row, 'qty1') || '').trim();
  const q2 = String(val(row, 'qty2') || '').trim();
  const item = (it, q, label) => {
    const nm = it.name.trim();
    /* 数量の列を選んでいないとき、商品1は名前だけを出します。商品2は出しません（名前が残っていても） */
    if (!q) return label === '商品1' && nm && !(S.map.qty1 || []).length ? nm : '';
    const n = num(q);
    if (isNaN(n)) { err.push(label + 'の数量が数字ではありません（' + q + '）'); return nm; }
    if (!nm) { err.push(label + 'の商品名を上の欄に入れてください'); return ''; }
    return nm + '(' + n + ')';
  };
  const item1 = item(S.item1, q1, '商品1');
  const item2 = item(S.item2, q2, '商品2');

  /* 個口数。手入力 > 別紙の個口数 > 数量÷入数（切り上げ、商品ごとに足す） > 1 */
  let boxesAuto = 0;
  const bcol = String(row.auto.boxes || '').trim();
  if (bcol && !isNaN(num(bcol))) boxesAuto = Math.round(num(bcol));
  else {
    [[q1, S.item1.per], [q2, S.item2.per]].forEach(([q, per]) => {
      const n = num(q), p = num(per);
      if (!isNaN(n) && n > 0 && !isNaN(p) && p > 0) boxesAuto += Math.ceil(n / p);
    });
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

  row.out = {name, memo: memoSrc.trim(), tel, telEmpty, zip, addr, addr1, addr2, item1, item2,
             boxes, boxesAuto, due: due || '', ship: ship || '', shipAuto, time: time || '', memo2, q1, q2};
  row.err = err; row.warn = warn; row.check = check;
}


/* =================== 住所の照合（非同期） =================== */

let checkRunning = false, checkAgain = false;
async function runChecks() {
  if (checkRunning) { checkAgain = true; return; }
  checkRunning = true;
  try {
    await Addr.loadIndex();
    $('#dataVer').textContent = Addr.ver ? '郵便番号データ ' + Addr.ver + ' 版' : '';
    for (const row of S.rows) {
      if (!included(row) || !row.out.addr && !row.out.zip) continue;
      const zip = row.out.zip;
      const addrN = addrNorm(row);
      const k = zip + '|' + addrN;
      if (!addrN || S.checks[k]) continue;
      try { S.checks[k] = await Addr.check(zip, addrN); }
      catch (e) { S.checks[k] = {status: 'nodata', msg: '郵便番号データが読めませんでした', addr: addrN, added: ''}; }
    }
  } catch (e) {
    S.rows.forEach(row => {
      const addrN = addrNorm(row);
      const k = row.out.zip + '|' + addrN;
      if (!S.checks[k]) S.checks[k] = {status: 'nodata', msg: e.message, addr: addrN, added: ''};
    });
  }
  checkRunning = false;
  S.rows.forEach(computeRow);
  renderRows();
  if (checkAgain) { checkAgain = false; runChecks(); }
}


/* =================== 依頼主 =================== */

function loadSenders() {
  S.senders = lsGet(CFG.LS_SENDERS, []) || [];
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
  if (grid.length < 2) throw new Error('中身がありません（1行目が見出し、2行目から依頼主）');
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
    if (!s.name) return;
    const old = S.senders.find(x => x.name === s.name && normTel(x.tel) === normTel(s.tel));
    if (old) { Object.assign(old, s); updated++; }
    else { s.id = newId(); S.senders.push(s); added++; }
  });
  if (!S.senderId && S.senders.length) S.senderId = S.senders[0].id;
  saveSenders();
  return {added, updated};
}

function exportSenders() {
  const head = ['依頼主コード', '依頼主名', '依頼主電話', '依頼主〒', '依頼主住所', '依頼主建物マンション名'];
  const lines = [head].concat(S.senders.map(s => [s.code, s.name, s.tel, s.zip, s.addr, s.bldg]));
  /* Excelで開いても文字化けしないよう、この設定ファイルだけBOMを付けます */
  download('依頼主設定.csv', '﻿' + lines.map(csvLine).join('\r\n') + '\r\n');
}


/* =================== CSV =================== */

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvLine(a) { return a.map(csvCell).join(','); }

function outRows() {
  const s = currentSender();
  const list = S.rows.filter(included);
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
  /* 今スプシから落としているCSVと同じ形（UTF-8、BOMなし、改行CRLF） */
  const text = [CFG.CSV_HEAD].concat(rows).map(csvLine).join('\r\n') + '\r\n';
  const d = new Date();
  const stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes());
  download('ラベル_' + stamp + '.csv', text);
  toast('CSVを保存しました（' + rows.length + '件）');
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
      '<div class="btns"><label class="btn primary">依頼主設定CSVを読み込む<input type="file" accept=".csv,.txt" id="senderFile" hidden></label>' +
      '<button class="btn" id="senderNew">手で入力する</button></div>';
  } else {
    const p = senderProblems(s);
    box.innerHTML =
      '<div class="sender-row"><select id="senderSel">' + opts + '<option value="__new">＋ 新しく入力する（取引先が依頼主の場合など）</option></select>' +
      '<button class="btn small" id="senderEdit">直す</button>' +
      '<details class="more"><summary>設定ファイル</summary><div class="btns">' +
      '<label class="btn small">CSVを読み込む<input type="file" accept=".csv,.txt" id="senderFile" hidden></label>' +
      '<button class="btn small" id="senderExport">CSVに書き出す</button>' +
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
  d.showModal();
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
      r += '<div class="mr sub"><div class="ml tiny muted" title="ラベルの商品名は「' + esc(o.name || '商品名') + '(10)」の形で出ます">└ 商品名・入数' + (nameNeed ? '<span class="need">必須</span>' : '') + '</div><div class="ms inline">' +
        '<input type="text" data-item="' + p + '" data-f="name" data-need="' + (nameNeed ? 1 : '') + '" value="' + esc(o.name) + '" placeholder="例：非常用トイレ"' + (nameNeed && !o.name.trim() ? ' class="req-empty"' : '') + '>' +
        '<input type="number" min="1" data-item="' + p + '" data-f="per" value="' + esc(o.per) + '" placeholder="入数" class="w4"><span class="plus">個/箱</span></div></div>';
    }
    if (it.key === 'store') {
      r += '<div class="mr sub"><div class="ml tiny muted" title="入れると「名前」に会社名、「備考(住所4)」に店名が入ります。空なら店名が「名前」に入ります">└ 会社名</div><div class="ms">' +
        '<input type="text" id="company" value="' + esc(S.company) + '" placeholder="全行共通。例：株式会社△△（付けないなら空）"></div></div>';
    }
    return r;
  };
  const MORE = ['qty2', 'boxes', 'ship', 'time', 'memo2'];
  const main = CFG.ITEMS.filter(it => !MORE.includes(it.key));
  const more = CFG.ITEMS.filter(it => MORE.includes(it.key));
  const used = more.filter(it => (S.map[it.key] || []).length).map(it => it.label);
  if (S.moreOpen == null) S.moreOpen = used.length > 0 || !!S.item2.name;
  let h = main.map(row).join('');
  h += '<details class="morecols" id="moreCols"' + (S.moreOpen ? ' open' : '') + '><summary>その他の列（' +
    (used.length ? '使用中：' + esc(used.join('・')) : more.map(it => it.label).join('・')) + '）</summary>' + more.map(row).join('') + '</details>';
  $('#mapBox').innerHTML = h;
}

/* ---- 一覧 ---- */
function renderRows() {
  if (!S.grid.length) return;
  const focus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.cell;

  const inc = S.rows.filter(included);
  const nErr = inc.filter(r => r.err.length).length;
  const nPending = inc.filter(r => r.check && r.check.status === 'pending').length;
  const nChk = inc.filter(r => r.err.includes('check')).length;
  const boxes = inc.reduce((a, r) => a + (r.out.boxes || 0), 0);
  const sumQ = k => inc.reduce((a, r) => { const n = num(r.out[k]); return a + (isNaN(n) ? 0 : n); }, 0);
  const excl = S.rows.length - inc.length;
  const sp = senderProblems(currentSender());

  $('#summary').innerHTML =
    '<span class="stat"><b>' + inc.length + '</b>件</span>' +
    '<span class="stat">個口合計 <b>' + boxes + '</b></span>' +
    ((S.map.qty1 || []).length ? '<span class="stat">' + esc(S.item1.name || '商品1') + ' <b>' + sumQ('q1') + '</b></span>' : '') +
    ((S.map.qty2 || []).length ? '<span class="stat">' + esc(S.item2.name || '商品2') + ' <b>' + sumQ('q2') + '</b></span>' : '') +
    (excl ? '<span class="stat muted">除外 ' + excl + '行</span>' : '') +
    (nChk ? '<span class="stat warn-ink">〒の確認 ' + nChk + '件</span>' : '') +
    (nErr - nChk > 0 || (nErr && !nChk) ? '<span class="stat err-ink">要修正 ' + (inc.filter(r => r.err.some(e => e !== 'check')).length) + '件</span>' : '') +
    (nPending ? '<span class="stat muted">照合中…</span>' : '');

  const block = [];
  if (!inc.length) block.push('宛先が0件です');
  CFG.ITEMS.forEach(it => {
    if (it.need && !(S.map[it.key] || []).length && !(it.key === 'zip' && S.rows.some(r => r.auto.zip))) block.push('「' + it.label + '」の列を選んでください');
  });
  if (!S.item1.name.trim()) block.push('商品1の商品名を入れてください');
  if ((S.map.qty2 || []).length && !S.item2.name.trim()) block.push('商品2の商品名を入れてください');
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

  const showQ2 = (S.map.qty2 || []).length || S.item2.name;
  let h = '<table class="rows"><thead><tr>' +
    '<th class="c-sel"><input type="checkbox" id="selAll" title="全部選ぶ"></th><th class="c-rn">行</th><th class="c-inc">含める</th>' +
    '<th>名前</th><th>備考(住所4)</th><th>電話</th><th>〒</th><th class="c-addr">住所</th>' +
    '<th>数量1</th>' + (showQ2 ? '<th>数量2</th>' : '') + '<th>個口</th><th>指定日</th><th>出荷日</th><th>時間</th><th>記事</th>' +
    '</tr></thead><tbody>';
  const cell = (row, key, shown, cls, extra) => {
    const ed = edited(row, key);
    const orig = row.auto[key];
    const title = ed ? '元の値：' + (cellText(orig) || '（空）') : (row.filledKeys.has(key) ? '上の値で埋めました' : '');
    return '<td class="' + (cls || '') + (ed ? ' edited' : '') + (row.filledKeys.has(key) && !ed ? ' filled' : '') + '"' +
      (title ? ' title="' + esc(title) + '"' : '') + '><input data-cell="' + row.src + ':' + key + '" value="' + esc(shown) + '"' + (extra || '') + '></td>';
  };
  const cols = 14 + (showQ2 ? 1 : 0);

  S.rows.forEach(row => {
    const inn = included(row);
    const o = row.out;
    const bad = inn && row.err.some(e => e !== 'check');
    const chk = inn && row.err.includes('check');
    const cls = !inn ? 'excl' : (bad ? 'bad' : (chk ? 'chk' : ''));
    const nameShown = edited(row, 'name') ? val(row, 'name') : (S.company.trim() || String(val(row, 'store') || ''));
    const memoShown = edited(row, 'memo') ? val(row, 'memo') : (S.company.trim() ? String(val(row, 'store') || '') : '');
    const hasEdits = S.edits[row.src] && Object.keys(S.edits[row.src]).length;
    h += '<tr class="' + cls + (S.sel.has(row.src) ? ' selected' : '') + '">' +
      '<td class="c-sel"><input type="checkbox" data-sel="' + row.src + '"' + (S.sel.has(row.src) ? ' checked' : '') + '></td>' +
      '<td class="c-rn">' + (row.src + 1) + (hasEdits ? '<button class="undo" data-undo="' + row.src + '" title="この行の手直しを全部戻す">↺</button>' : '') + '</td>' +
      '<td class="c-inc"><input type="checkbox" data-inc="' + row.src + '"' + (inn ? ' checked' : '') + '></td>' +
      cell(row, 'name', nameShown, 'w-name') +
      cell(row, 'memo', memoShown, 'w-memo') +
      cell(row, 'tel', edited(row, 'tel') ? val(row, 'tel') : o.tel, 'w-tel') +
      cell(row, 'zip', edited(row, 'zip') ? val(row, 'zip') : (o.zip || row.auto.zip), 'w-zip') +
      cell(row, 'addr', edited(row, 'addr') ? val(row, 'addr') : row.auto.addr, 'c-addr') +
      cell(row, 'qty1', val(row, 'qty1'), 'w-num') +
      (showQ2 ? cell(row, 'qty2', val(row, 'qty2'), 'w-num') : '') +
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
  });
  h += '</tbody></table>';
  $('#rowsTable').innerHTML = h;
  const all = $('#selAll');
  if (all) all.checked = S.rows.length > 0 && S.rows.every(r => S.sel.has(r.src));

  if (focus) {
    const el = document.querySelector('[data-cell="' + focus + '"]');
    if (el) el.focus();
  }
  renderPreview();
}

/* 〒と住所がずれている行の、選ぶところ */
function checkUi(row) {
  const ck = row.check;
  const zip = row.out.zip;
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
    if (trimmed === String(row.out.boxesAuto)) { delete S.edits[row.src].boxes; recompute(); return; }
  }
  const autoV = key === 'name' ? (S.company.trim() || String(row.auto.store || ''))
              : key === 'memo' ? (S.company.trim() ? String(row.auto.store || '') : '')
              : key === 'tel' ? normTel(row.auto.tel)
              : cellText(row.auto[key]);
  if (!edited(row, key) && trimmed === String(autoV)) return;
  if (trimmed === String(autoV)) delete S.edits[row.src][key];
  else setEdit(row.src, key, key === 'time' ? v : trimmed);
  recompute();
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
      lsSet(CFG.LS_ITEMS, {item1: S.item1, item2: S.item2});
      renderMap(); recompute(); return;
    }
    if (t.id === 'company') { S.company = t.value; recompute(); return; }
    if (t.dataset.cell) { commitCell(t); return; }
    if (t.dataset.inc != null) {
      const src = Number(t.dataset.inc);
      const row = S.rows.find(r => r.src === src);
      if (t.checked === !row.autoExclude) delete S.include[src]; else S.include[src] = t.checked;
      recompute(); return;
    }
    if (t.id === 'senderSel') {
      if (t.value === '__new') { renderSender(); openSenderDialog(null); return; }
      S.senderId = t.value; saveSenders(); renderSender(); renderRows(); return;
    }
    if (t.id === 'senderFile') {
      const f = t.files[0];
      if (f) importSenders(f).then(r => { toast('依頼主を読み込みました（追加 ' + r.added + '・更新 ' + r.updated + '）'); renderSender(); renderRows(); })
        .catch(err => toast('読めませんでした：' + err.message));
      return;
    }
  });
  /* 表の中は Enter で確定 */
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.cell) { e.preventDefault(); e.target.blur(); }
  });

  /* 行の選択（Shiftで範囲） */
  document.addEventListener('click', e => {
    const t = e.target;
    if (t.id === 'selAll') {
      if (t.checked) S.rows.forEach(r => S.sel.add(r.src)); else S.sel.clear();
      renderRows(); return;
    }
    if (t.dataset && t.dataset.sel != null) {
      const src = Number(t.dataset.sel);
      if (e.shiftKey && S.lastClick != null) {
        const ids = S.rows.map(r => r.src);
        const a = ids.indexOf(S.lastClick), b = ids.indexOf(src);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) { if (t.checked) S.sel.add(ids[i]); else S.sel.delete(ids[i]); }
      } else if (t.checked) S.sel.add(src); else S.sel.delete(src);
      S.lastClick = src;
      renderRows(); return;
    }
    if (t.dataset && t.dataset.undo != null) { delete S.edits[Number(t.dataset.undo)]; recompute(); return; }
    if (t.dataset && t.dataset.fixzip != null) {
      setEdit(Number(t.dataset.fixzip), 'zip', Addr.fmtZip(t.dataset.zip)); recompute(); return;
    }
    if (t.dataset && t.dataset.keep != null) {
      const row = S.rows.find(r => r.src === Number(t.dataset.keep));
      const addrIn = String(val(row, 'addr') || '').replace(/\s+/g, ' ').trim();
      setEdit(row.src, 'addrOk', row.out.zip + '|' + addrIn); recompute(); return;
    }
    if (t.id === 'senderNew') { openSenderDialog(null); return; }
    if (t.id === 'senderEdit') { openSenderDialog(currentSender()); return; }
    if (t.id === 'senderExport') { exportSenders(); return; }
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
  $('#bDue').addEventListener('click', () => { const v = $('#vDue').value; bulk(src => setEdit(src, 'due', v ? v.replace(/-/g, '/') : '')); });
  $('#bShip').addEventListener('click', () => { const v = $('#vShip').value; bulk(src => setEdit(src, 'ship', v ? v.replace(/-/g, '/') : '')); });
  $('#bTime').addEventListener('click', () => { const v = $('#vTime').value; bulk(src => setEdit(src, 'time', v)); });
  $('#bBoxAuto').addEventListener('click', () => bulk(src => { if (S.edits[src]) delete S.edits[src].boxes; }));
  $('#bExcl').addEventListener('click', () => bulk(src => { const r = S.rows.find(x => x.src === src); if (r.autoExclude) delete S.include[src]; else S.include[src] = false; }));
  $('#bIncl').addEventListener('click', () => bulk(src => { const r = S.rows.find(x => x.src === src); if (!r.autoExclude) delete S.include[src]; else S.include[src] = true; }));
  $('#bClear').addEventListener('click', () => { S.sel.clear(); renderRows(); });

  $('#dlBtn').addEventListener('click', downloadCsv);

  /* 依頼主の入力 */
  $('#senderForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const s = {};
    ['code', 'name', 'tel', 'zip', 'addr', 'bldg'].forEach(k => { s[k] = f.elements[k].value.trim(); });
    if (!s.name || !s.addr) { toast('名前と住所は必ず入れてください'); return; }
    const id = f.dataset.id;
    if (id) Object.assign(S.senders.find(x => x.id === id), s);
    else { s.id = newId(); S.senders.push(s); S.senderId = s.id; }
    saveSenders();
    $('#senderDlg').close();
    renderSender(); renderRows();
  });
  $('#senderCancel').addEventListener('click', () => { $('#senderDlg').close(); renderSender(); });
}


/* =================== 起動 =================== */

function init() {
  loadSenders();
  const it = lsGet(CFG.LS_ITEMS, null);
  if (it) { S.item1 = Object.assign(S.item1, it.item1 || {}); S.item2 = Object.assign(S.item2, it.item2 || {}); }
  $('#vTime').innerHTML = CFG.TIMES.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('');
  bindEvents();
  renderAll();
  loadAddrMaster().then(() => { if (S.rows.length) { S.checks = {}; recompute(); } });
  Addr.loadIndex().then(() => { $('#dataVer').textContent = Addr.ver ? '郵便番号データ ' + Addr.ver + ' 版' : ''; })
    .catch(e => { $('#dataVer').textContent = e.message; });
}

document.addEventListener('DOMContentLoaded', init);
