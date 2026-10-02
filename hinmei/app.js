/* ===================================================================
   送り状 余白書き換え  v18   (hinmei/app.js)

   v18 「何も書かない」：中身には一切触らず、送り状番号の順に並べ直すだけ（出す名前は 〜_番号順.pdf）

   v17 出すPDFのページを送り状番号の小さい順（＝発行済データの順）に並べ直す。
       B2のPDFは一部の地域が先頭にまとまるなど並びが割れることがあるため（中身は触らず順番だけ）

   v16 「全部に入れる」：入れた文字で全部の表を「その文字 × 送り状の枚数」にする（届け先が多い日用）

   v15 表を 届け先＋送り状（親番号）ごとに分ける。同じ届け先に別の送り状が来ても1つの表に混ざらない
       （複数口の子は「親伝票 送り状番号」で親にまとめる）。同じ届け先の表が複数なら見出しに送り状番号の下4桁

   v14 割れ物の目安の枠を、シール(5cm×4cm)より縦横0.8cm小さい 4.2cm×3.2cm に（貼ったシールで隠れるように）

   v13 割れ物：表の「割れ物」にチェック（入数マスタで割れ物にチェックがある商品は自動判別でチェック）すると、
       右に横5.7cmを空けてシール(5cm×4cm)の目安の薄い枠と「割れ」を入れ、品名は左に小さく入れる。
       帯下のときは帯も左だけ（入らなければ「この面を上に」を外す）

   v12 品名を上下のまん中に置く（前は最後の行の下の行間ぶん、字が少し上に寄っていた）。lineBases

   v11 空欄の送り状の枠の上下を右下パネルにそろえた（上＝お届け先控の上端、下＝お問い合わせ先の下端）

   v10 左下が空欄（ロゴが印刷されていない）送り状にも書ける。すぐ上の「ヤマト運輸株式会社」の画像を目印に、
       ロゴがあるときと同じ位置・大きさの枠に書く（findZone → blankZone）
   v8・v9 は index.html だけの変更（タブのマークを横長の送り状に／ドロップ欄の文言）

   v7  タブのマークを付けた（段ボールに黒帯。index.html に直接書いている）

   v6  品名だけのときは「商品名(数量)」を必ず数量の前で折る（1行と2行が混ざらないように）。
       商品名が1行に入らないときは、数量を最後の行の後ろに付ける

   v5  入力中に、1枚ずつの見本をその場で描いて見せる（PDFは作らない。同じ計算・同じフォント）。
       「そのまま」はロゴのまま、まだ入れていない枚は「未入力」と薄く出す

   v4  品名の表の並びを 商品名→枚数→そのまま｜入数で割るとき（任意）入数・総数 に。
       ふつうは商品名と枚数だけでよいと分かるように。Tabは 商品名→枚数→次の行

   v3  できるPDFの名前を 〜_アテンション.pdf から 〜_余白書き換え.pdf に
   v2  名前を「送り状 品名でかく」から「送り状 余白書き換え」に（URLは hinmei/ のまま）
       注意書きを天地無用のほか7つから選べるように（帯下は1つ、帯のみは2つまで）。
       「記事欄から」で送り状の記事欄の注意書きを拾う。自由入力も1つ
       品名の文字の大きさを 大・中・小 から選べるように（大＝今まで通り）
   v1  初版

   ヤマトの送り状PDF（B2・A5）の左下パネル（ヤマトのロゴが入っている枠）に、
   品名や「天地無用」を大きく入れる。

   ・PDFはこのブラウザの中で読んで描くだけ。どこにも送らない
   ・「アテンション自動判別」だけは、品名欄で読んだ商品名を入数マスタに送って入数を聞く
     （住所や電話番号は送らない）
   ・文字の大きさ・折り方・塗る場所は、Python版（送り状_品名でかく.py）と同じ決まり
   ・元のページの中身には触らず、上に描き足すだけ（バーコード・QR・文字はそのまま）
   =================================================================== */
(function () {
'use strict';

/* ---------------- 決まり（Python版と同じ値） ---------------- */
const MARGIN = 8;                        // 枠の内側の余白(pt)
// 品名の文字の大きさはこのどれかに固定する。大＝Python版と同じ。中・小は上限を下げるだけ
const SIZE_SET = {L: [47, 42, 36, 30], M: [36, 30], S: [30]};
const MIN_SIZE = 30;                     // 下限。送り状の上の仕分けコードの数字(27.8pt)より少し大きい
const MAX_LINES = 3;                     // 30ptを守れるのは3行まで
const LH = 1.22, BL = 0.88;              // 行の高さ、ベースラインの位置（文字の大きさに対する比）
// 割れ物：右に横5.7cmを空け、その中にシールの目安の薄い枠と「割れ」を入れる。品名は残りの左に小さく。
// 枠はシール(横5cm×縦4cm)より縦横0.8cm小さくして、貼ったシールで隠れるようにする
const CM = 72 / 2.54;
const FRAGILE = {w: 5.7 * CM, sw: 4.2 * CM, sh: 3.2 * CM, steps: [30, 26, 22, 18, 15], min: 15, gray: 0.6, label: '割れ', labelSize: 16};

// 右上の貼付票の「お届け先」と「品名」。左上の配達票は、子伝票だと住所が載らないので使わない
const HARI_TODOKE = [330, 28, 540, 110];
const HIN_FIELD = [340, 162, 520, 184];
const KIJI_FIELD = [340, 186, 520, 216];   // 貼付票の記事欄
const ADDR_LINE = /[都道府県市区町村郡]|様|御中|\d{2,4}-\d{2,4}-\d{3,4}|\d{3}-\d{4}/;
const ITEM = /^(.+?)\s*[(（]\s*(\d+)\s*[)）]$/;

// 注意書き。帯下に入れる文と、帯のみのときの文
const MARKS = [
  {key: 'tenchi', label: '天地無用', band: '天地無用　この面を上に'},
  {key: 'ware', label: 'ワレモノ注意'},
  {key: 'toriatsukai', label: '取扱注意'},
  {key: 'shitazumi', label: '下積厳禁'},
  {key: 'mizunure', label: '水濡厳禁'},
  {key: 'seimitsu', label: '精密機器'},
  {key: 'juryo', label: '重量物注意'},
];
const MARK_LIMIT = {band: 1, only: 2};                              // 帯下は1つ、帯のみは2つまで
const BAND = {h: 30, min: 12};                                      // 帯下の帯の高さ。帯の文字はこれより小さくしない
const ONLY = {inset: 6, frame: 5, sub: 'この面を上に', ratio: 0.62}; // 帯のみ（白地に黒文字＋太枠）

const KEEP = 'keep', BLANK = 'blank', TEXT = 'text';

/* ---------------- 状態 ---------------- */
const S = {
  src: null,        // {name, bytes, pages:[{w,h,view,rotate,items,images,zone,dest,hin}], groups:[...]}
  fontBytes: null,
  mfont: null,      // 測る用のフォント（pdf-lib）
  kind: 'name',     // name=品名だけ / band=品名＋注意書き(帯下) / only=注意書きだけ(帯のみ)
  marks: ['tenchi'],// 選んだ注意書き（選んだ順）。'free' は自由入力
  free: '',
  size: 'L',        // 品名の大きさ L=大 / M=中 / S=小
  out: null,        // できたPDF {bytes, name, url}
};

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const isInt = s => /^\d+$/.test(String(s).trim());
const sleep = ms => new Promise(r => setTimeout(r, ms));

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';


/* ================================================================
   文字の大きさと折り方（Python版 layout と同じ）
   ================================================================ */
function width(text, size) { return S.mfont.widthOfTextAtSize(text, size); }

function splitEvenly(text, n) {
  const ch = Array.from(text);
  if (n <= 1 || ch.length < n) return [text];
  const size = Math.ceil(ch.length / n);
  const out = [];
  for (let i = 0; i < ch.length; i += size) out.push(ch.slice(i, i + size).join(''));
  return out;
}

function snap(raw, steps) {
  for (const s of steps) if (raw >= s) return s;
  return raw;                            // 下限にも届かない。使う側で止める
}

/** 品名の折り方と大きさ。steps を省くと画面で選んでいる大中小 */
function layout(text, rect, steps) {
  steps = steps || SIZE_SET[S.size] || SIZE_SET.L;
  const snapTo = raw => snap(raw, steps);
  const w = rect[2] - rect[0] - MARGIN * 2;
  const h = rect[3] - rect[1] - MARGIN * 2;
  const raw = lines => {
    let s = h / (lines.length * LH);
    for (const ln of lines) {
      const u = width(ln, 1);
      if (u > 0) s = Math.min(s, w / u);
    }
    return s;
  };
  if (text.indexOf('\n') >= 0) {                       // 自分で改行した場合はその通りに
    const given = text.split('\n').map(s => s.trim()).filter(Boolean);
    if (given.length) return {lines: given, size: snapTo(raw(given))};
  }
  const m = text.match(/^(.+?)\s*([(（].*[)）])$/);      // 「品名」と「(数量)」
  if (m && S.kind === 'name') {
    // 品名だけのときは、どの枚も同じ形に揃える（1行と2行が混ざると見にくい）。
    // 商品名が1行に入るなら 商品名／(数量)。入らなければ商品名を折って、数量は最後の行の後ろに付ける
    const name = m[1], qty = m[2];
    const alt = [[name, qty]];
    for (let n = 2; n <= MAX_LINES; n++) {
      const ls = splitEvenly(name, n);
      if (ls.length === n) { ls[n - 1] += qty; alt.push(ls); }
    }
    let pick = null, pk = null;
    for (const ls of alt) {
      const k = [snapTo(raw(ls)), -ls.length];
      if (!pick || k[0] > pk[0] || (k[0] === pk[0] && k[1] > pk[1])) { pick = ls; pk = k; }
    }
    return {lines: pick, size: snapTo(raw(pick))};
  }
  const cands = [[text]];
  if (m) cands.push([m[1], m[2]]);
  for (let n = 2; n <= MAX_LINES; n++) {
    const ls = splitEvenly(text, n);
    if (ls.length === n) cands.push(ls);
  }
  // 段階に落としたサイズが最大のもの。同じなら行数が少ないほう（先に出たほう）
  let best = null, bk = null;
  for (const ls of cands) {
    const k = [snapTo(raw(ls)), -ls.length];
    if (!best || k[0] > bk[0] || (k[0] === bk[0] && k[1] > bk[1])) { best = ls; bk = k; }
  }
  return {lines: best, size: snapTo(raw(best))};
}


/** 各行のベースライン（上から）。字の高さ（ベースラインの上 BL・下 1−BL）で上下の真ん中に置く。
    行の高さ LH で並べた全体を真ん中にすると、最後の行の下の行間ぶん字が上に寄って見えるため */
function lineBases(f, nr) {
  const inkH = f.size * (LH * (f.lines.length - 1) + 1);
  const top = nr[1] + (nr[3] - nr[1] - inkH) / 2;
  return f.lines.map((ln, k) => top + f.size * (LH * k + BL));
}

/* ================================================================
   注意書き（帯下・帯のみ）
   ================================================================ */
/** 選んでいる注意書き（選んだ順）。自由入力は空なら数えない */
function selectedMarks() {
  return S.marks.map(k => {
    if (k === 'free') {
      const t = S.free.replace(/\s+/g, ' ').trim();
      return t ? {key: 'free', label: t} : null;
    }
    return MARKS.find(m => m.key === k) || null;
  }).filter(Boolean);
}

/** 帯下：帯に入れる文と大きさ。割れ物のときは帯も左（品名の下）だけ。
    入りきらなければ添え書きを外す（例「天地無用　この面を上に」→「天地無用」） */
function bandLayout(zone, fragile) {
  const m = selectedMarks()[0];
  if (!m) return null;
  const band = [zone[0], zone[3] - BAND.h, fragile ? zone[2] - FRAGILE.w : zone[2], zone[3]];
  const sizeOf = t => Math.min((band[2] - band[0] - 16) / width(t, 1), BAND.h * 0.68);
  let text = m.band || m.label;
  if (fragile && m.band && sizeOf(text) < BAND.min) text = m.label;
  const size = sizeOf(text);
  return {band: band, text: text, size: size, base: band[1] + (BAND.h + size * 0.72) / 2};
}

/** 割れ物の枠。左＝品名を入れるところ、frame＝シールの目安（空けた幅の中で上下左右まん中） */
function fragileSplit(zone) {
  const x = zone[2] - FRAGILE.w;
  const fx = x + (FRAGILE.w - FRAGILE.sw) / 2, fy = zone[1] + (zone[3] - zone[1] - FRAGILE.sh) / 2;
  return {left: [zone[0], zone[1], x, zone[3]], frame: [fx, fy, fx + FRAGILE.sw, fy + FRAGILE.sh]};
}

/** 割れ物の帯が入らないときの文（なければ ''） */
function fragileBandProblem(zone) {
  if (S.kind !== 'band') return '';
  const b = bandLayout(zone, true);
  return b && b.size < BAND.min ? '割れ物の帯に「' + b.text + '」が入りません（' + Math.round(b.size) + 'ptになります）' : '';
}

/** 帯のみ：枠と、行ごとの文・大きさ・ベースライン */
function onlyLayout(zone) {
  const ms = selectedMarks();
  const edge = ONLY.inset + ONLY.frame / 2;
  const box = [zone[0] + edge, zone[1] + edge, zone[2] - edge, zone[3] - edge];
  const pad = ONLY.frame / 2 + 8;
  const body = [box[0] + pad, box[1] + pad - 2, box[2] - pad, box[3] - pad + 2];
  const bw = body[2] - body[0], bh = body[3] - body[1];
  let lines;
  if (ms.length === 1 && ms[0].key === 'tenchi') {        // 天地無用だけのときは「この面を上に」を添える
    const s1 = Math.min(bw / width(ms[0].label, 1), bh / (1.12 + ONLY.ratio * 1.12));
    const s2 = Math.min(s1 * ONLY.ratio, bw / width(ONLY.sub, 1));
    lines = [{text: ms[0].label, size: s1, main: true}, {text: ONLY.sub, size: s2}];
  } else {                                                // 1つ1行、同じ大きさで積む
    let s = bh / (1.12 * Math.max(ms.length, 1));
    ms.forEach(m => { s = Math.min(s, bw / width(m.label, 1)); });
    lines = ms.map(m => ({text: m.label, size: s, main: true}));
  }
  let y = body[1] + (bh - lines.reduce((a, l) => a + l.size * 1.12, 0)) / 2;
  lines.forEach(l => { l.base = y + l.size * 0.90; y += l.size * 1.12; });
  return {box: box, body: body, lines: lines};
}

/** 注意書きの問題。無ければ null */
function marksProblem(zone) {
  if (S.kind === 'name' || S.kind === 'none') return null;
  const ms = selectedMarks();
  if (!ms.length) return '注意書きを1つ以上選んでください';
  if (ms.length > MARK_LIMIT[S.kind]) return '注意書きは' + (S.kind === 'band' ? '帯下では1つ' : '帯のみでは2つ') + 'までです';
  if (S.kind === 'band') {
    const b = bandLayout(zone);
    if (b.size < BAND.min) return '帯の注意書き「' + b.text + '」が長すぎます（' + Math.round(b.size) + 'ptになります）';
  } else {
    const o = onlyLayout(zone);
    const small = o.lines.find(l => l.main && l.size < MIN_SIZE);
    if (small) return '注意書き「' + small.text + '」が長すぎます（' + Math.round(small.size) + 'pt。' + MIN_SIZE + 'pt以上にしたいので短くしてください）';
  }
  return null;
}

function fitProblem(lines, fragile) {
  if (lines.length > MAX_LINES) return lines.length + '行は多すぎます（' + minFor(fragile) + 'ptを保てるのは' + MAX_LINES + '行まで）';
  const longest = lines.reduce((a, b) => (Array.from(b).length > Array.from(a).length ? b : a), '');
  return '1行が長すぎます（「' + longest + '」' + (fragile ? '。割れ物は右を空けるので幅が半分以下です' : '') + '）';
}

/** 入数と総数から箱を割り出す。端数の箱を頭に、そのあと満箱 */
function splitBoxes(name, per, total) {
  if (per <= 0 || total <= 0) return [];
  const full = Math.floor(total / per), rem = total % per;
  const out = [];
  if (rem) out.push([name + '(' + rem + ')', 1]);
  if (full) out.push([name + '(' + per + ')', full]);
  return out;
}

/** 品名を入れる枠。帯下のときは帯のぶん下を空ける。割れ物のときは右を空ける */
function nameRect(zone, fragile) {
  const z = fragile ? fragileSplit(zone).left : zone;
  return S.kind === 'band' ? [z[0], z[1], z[2], z[3] - BAND.h] : z;
}
const minFor = fragile => (fragile ? FRAGILE.min : MIN_SIZE);


/* ================================================================
   PDFを読む（pdf.js）。座標はすべて左上が原点のpt（Python版と同じ）
   ================================================================ */
async function readPdf(bytes) {
  const pdf = await pdfjsLib.getDocument({data: bytes.slice(0)}).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({scale: 1});
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string' || !it.str) continue;
      const t = it.transform;
      const p = vp.convertToViewportPoint(t[4], t[5]);
      items.push({str: it.str, x: p[0], y: p[1], w: it.width, size: Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1])});
    }
    const ops = await page.getOperatorList();
    pages.push({w: vp.width, h: vp.height, view: page.view.slice(), rotate: page.rotate,
                items: items, images: imageRects(ops, vp)});
    page.cleanup();
  }
  await pdf.destroy();
  return pages;
}

/** 画像（バーコード・QR・ロゴ）が置かれている四角 */
function imageRects(ops, vp) {
  const O = pdfjsLib.OPS, U = pdfjsLib.Util;
  const paints = [O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject,
                  O.paintJpegXObject, O.paintSolidColorImageMask].filter(v => v !== undefined);
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], out = [];
  const box = m => {
    const pts = [[0, 0], [1, 0], [0, 1], [1, 1]]
      .map(p => U.applyTransform(p, m)).map(p => vp.convertToViewportPoint(p[0], p[1]));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = U.transform(ctm, a);
    else if (fn === O.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(a[0]) && a[0].length === 6) ctm = U.transform(ctm, a[0]);
    }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (paints.indexOf(fn) >= 0) box(ctm);
    else if (fn === O.paintImageXObjectRepeat) {
      const sx = a[1], sy = a[2], pos = a[3] || [];
      for (let j = 0; j + 1 < pos.length; j += 2) box(U.transform(ctm, [sx, 0, 0, sy, pos[j], pos[j + 1]]));
    }
  }
  return out;
}

/** 左下パネルの色付きゾーン。左下にある、いちばん大きい画像（Python版 find_zone と同じ） */
function findZone(pg) {
  let best = null;
  for (const r of pg.images) {
    const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
    if (cx > pg.w / 2 || cy < pg.h / 2) continue;           // 左下パネル以外は無視
    if (r[2] - r[0] < 80 || r[3] - r[1] < 40) continue;     // 小さいマーク類は無視
    if (!best || (r[2] - r[0]) * (r[3] - r[1]) > (best[2] - best[0]) * (best[3] - best[1])) best = r;
  }
  return best || blankZone(pg);
}

/* 左下が空欄（ロゴが印刷されていない）送り状は、すぐ上の「ヤマト運輸株式会社」の画像を目印に枠を作る。
   左右はロゴと同じ（左は持ち手があるのでロゴより左へは出さない）。
   上下は右下パネルにそろえる：上＝「お届け先控」の上端、下＝いちばん下の「お問い合わせ先 0120-…」の下端
   （そこまでは印刷できている）。
   目印(48.2,256.3)-(107.5,264.6) に対して ロゴの左右 34.4〜306.0、お届け先控の上 271.9、問い合わせ先の下 405.1。
   印刷のずれで送り状全体が左右にずれることがあるので、目印からの相対位置で決める */
const NO_LOGO = {dx: -13.8, dy: 7.3, w: 271.6, h: 133.2};
function blankZone(pg) {
  const a = pg.images.find(r => {
    const w = r[2] - r[0], h = r[3] - r[1], cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
    return w > 55 && w < 64 && h > 7 && h < 10 && cx < pg.w / 2 && cy > pg.h / 2 && cy < pg.h * 0.7;
  });
  if (!a) return null;
  const z = [a[0] + NO_LOGO.dx, a[3] + NO_LOGO.dy, a[0] + NO_LOGO.dx + NO_LOGO.w, a[3] + NO_LOGO.dy + NO_LOGO.h];
  return z[0] >= 0 && z[3] <= pg.h ? z : null;
}

/** 四角の中の文字を行にする */
function linesIn(items, clip) {
  const inside = items.filter(it => {
    if (!it.str.trim()) return false;
    const cx = it.x + it.w / 2, cy = it.y - it.size * 0.35;
    return cx >= clip[0] && cx <= clip[2] && cy >= clip[1] && cy <= clip[3];
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of inside) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) < 1.5) last.items.push(it);
    else rows.push({y: it.y, items: [it]});
  }
  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    let s = '', x1 = null;
    for (const it of r.items) {
      if (x1 !== null && it.x - x1 > it.size * 0.3) s += ' ';
      s += it.str;
      x1 = it.x + it.w;
    }
    return s.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}

function readDestination(pg) {
  const lines = linesIn(pg.items, HARI_TODOKE).filter(s => ADDR_LINE.test(s));
  if (!lines.length) return null;
  const name = lines.find(s => /(様|御中)$/.test(s)) || '';
  const tel = /\d{2,4}-\d{2,4}-\d{3,4}/;
  let zip = '';
  for (const s of lines) {
    const m = s.replace(tel, ' ').match(/(^|[^\d])(\d{3}-\d{4})(?!\d)/);
    if (m) { zip = m[2]; break; }
  }
  const addr = lines.filter(s => s !== name && /[都道府県市区町村郡]/.test(s) && !/^\s*[\d-\s]+$/.test(s)).join(' ');
  return {key: lines.join('\n'), name: name, zip: zip, addr: addr};
}

function readHin(pg) {
  const lines = linesIn(pg.items, HIN_FIELD).filter(s => ['品', '名', '品名', '品 名'].indexOf(s) < 0);
  const items = [], junk = [];
  for (const s of lines) {
    const m = s.match(ITEM);
    if (m) items.push({name: m[1].trim(), total: Number(m[2])});
    else junk.push(s);
  }
  return {items: items, junk: junk};
}

/** 貼付票の記事欄。見出しの「記」「事」と、数字だけの行は除く */
function readKiji(pg) {
  return linesIn(pg.items, KIJI_FIELD)
    .filter(s => ['記', '事', '記事', '記 事'].indexOf(s) < 0 && !/^[\d\s]+$/.test(s));
}

const normMark = s => String(s).normalize('NFKC').replace(/[\s　]/g, '');

/** 送り状（1通）の番号。複数口の子は「親伝票 送り状番号」の番号、それ以外は自分の送り状番号
    （1枚に3か所印字されるので、いちばん多く出てくる番号）。読めなければ '' */
const SLIP_NO = /\d{4}-\d{4}-\d{4}/;
function readSlip(pg) {
  const nums = pg.items.filter(it => SLIP_NO.test(it.str)).map(it => ({no: it.str.match(SLIP_NO)[0], x: it.x, y: it.y}));
  if (!nums.length) return '';
  const label = pg.items.find(it => /親伝票/.test(it.str));
  if (label) {
    let best = null, bd = Infinity;
    for (const n of nums) {
      const dx = n.x - label.x, dy = Math.abs(n.y - label.y);
      if (dx > 0 && dx < 120 && dy < 16 && dx + dy * 4 < bd) { bd = dx + dy * 4; best = n; }
    }
    if (best) return best.no;
  }
  const cnt = {};
  nums.forEach(n => { cnt[n.no] = (cnt[n.no] || 0) + 1; });
  return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
}

/** 自分の送り状番号（1枚に3か所印字されるので、いちばん多く出てくる番号）。読めなければ '' */
function readOwnNo(pg) {
  const cnt = {};
  pg.items.forEach(it => { const m = it.str.match(SLIP_NO); if (m) cnt[m[0]] = (cnt[m[0]] || 0) + 1; });
  return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || '';
}

/** 出すPDFのページ順。送り状番号の小さい順（＝発行済データの順。B2のPDFは地域などで並びが割れることがある）。
    複数口は親の番号でまとめてから自分の番号順。最後の1桁はチェック数字なので比べない。
    番号が読めないページは直前のページのすぐ後ろ */
function pageOrder(pages) {
  const k = n => n.replace(/\D/g, '').slice(0, -1);
  let prev = ['', ''];
  const keys = pages.map(p => {
    const own = p.own ? k(p.own) : '';
    const key = own ? [k(p.slip || p.own), own] : prev;
    prev = key;
    return key;
  });
  return pages.map((p, i) => i).sort((a, b) =>
    (keys[a][0] < keys[b][0] ? -1 : keys[a][0] > keys[b][0] ? 1 : 0) ||
    (keys[a][1] < keys[b][1] ? -1 : keys[a][1] > keys[b][1] ? 1 : 0) || a - b);
}

/** 届け先と送り状（親番号）ごとにページをまとめる。同じ届け先でも別の送り状なら別の表にする
    （品名欄の総数は送り状ごとなので）。届け先が読めないページは直前と同じ届け先 */
function groupPages(pages) {
  const groups = [], byKey = {}, perDest = {};
  let last = null;
  pages.forEach((pg, i) => {
    const d = pg.dest || last || {key: '(届け先を読めません)', name: '(届け先を読めません)', zip: '', addr: ''};
    const key = d.key + '\n#' + (pg.slip || '');
    let g = byKey[key];
    if (!g) {
      g = {name: d.name, zip: d.zip, addr: d.addr, slip: pg.slip || '', pages: []};
      byKey[key] = g;
      groups.push(g);
      perDest[d.key] = (perDest[d.key] || 0) + 1;
      g.destKey = d.key;
    }
    g.pages.push(i);
    last = d;
  });
  // 同じ届け先の表が2つ以上あるときだけ、見出しに送り状番号の下4桁を添える
  groups.forEach(g => { g.slipTag = perDest[g.destKey] > 1 && g.slip ? '送り状 …' + g.slip.slice(-4) : ''; });
  return groups;
}

function pageRanges(ps) {
  const out = [];
  let a = null, b = null;
  ps.concat([null]).forEach(p => {
    if (a === null) { a = b = p; return; }
    if (p !== null && p === b + 1) { b = p; return; }
    out.push(a === b ? String(a + 1) : (a + 1) + '〜' + (b + 1));
    a = b = p;
  });
  return out.join(', ') + '枚目';
}


/* ================================================================
   画面：1 送り状PDF
   ================================================================ */
async function loadFont() {
  if (S.mfont) return;
  const r = await fetch('font/BIZUDGothic-Bold.ttf');
  if (!r.ok) throw new Error('フォントを読めませんでした（' + r.status + '）');
  S.fontBytes = new Uint8Array(await r.arrayBuffer());
  const d = await PDFLib.PDFDocument.create();
  d.registerFontkit(fontkit);
  S.mfont = await d.embedFont(S.fontBytes, {subset: true});
}

async function openPdf(bytes, name) {
  setMsg('#fileInfo', '読み込み中…', 'muted');
  $('#result').hidden = true;
  S.out = null;
  try {
    await loadFont();
    const pages = await readPdf(bytes);
    if (!pages.length) throw new Error('ページがありません');
    const rotated = pages.findIndex(p => p.rotate % 360 !== 0);
    if (rotated >= 0) throw new Error((rotated + 1) + '枚目が回転しています。回転していない送り状PDFを使ってください');
    const noZone = [];
    pages.forEach((pg, i) => {
      pg.zone = findZone(pg);
      if (!pg.zone) noZone.push(i + 1);
      pg.dest = readDestination(pg);
      pg.slip = readSlip(pg);
      pg.own = readOwnNo(pg);
      pg.hin = readHin(pg);
      pg.kiji = readKiji(pg);
    });
    if (noZone.length) {
      throw new Error(noZone.join('・') + '枚目に、左下のヤマトのロゴ（色付きの枠）が見つかりません。' +
                      'ヤマトの送り状（A5）のPDFか確かめてください');
    }
    S.src = {name: name, bytes: bytes, pages: pages, groups: groupPages(pages)};
    S.src.groups.forEach(g => { g.rows = [blankRow(), blankRow()]; g.status = null; });
    S.logo = null;
    renderFile();
    renderGroups();
    showSteps();
    prepSketch().catch(() => { /* 見本が出なくても作るのには困らない */ });
  } catch (e) {
    S.src = null;
    showSteps();
    setMsg('#fileInfo', e.message || String(e), 'err');
  }
}

function renderFile() {
  const s = S.src;
  const multi = s.groups.length > 1;
  $('#fileInfo').innerHTML =
    '<div class="fileline"><b>' + esc(s.name) + '</b>　全部で <b class="big">' + s.pages.length + ' 枚</b>' +
    (multi ? '　／　届け先 <b>' + s.groups.length + ' か所</b>' : '') + '</div>';
}

function showSteps() {
  const has = !!S.src;
  $('#secKind').hidden = !has;
  $('#secRows').hidden = !has || S.kind === 'only' || S.kind === 'none';
  $('#secMake').hidden = !has;
  $('#marksBox').hidden = !(has && S.kind !== 'name' && S.kind !== 'none');
  $('#onlyNote').hidden = !(has && S.kind === 'only');
  renderMarks();
}


/* ================================================================
   画面：2 注意書きの選び方
   ================================================================ */
function limitMarks() {
  const lim = MARK_LIMIT[S.kind];
  if (!lim) return;
  while (S.marks.length > lim) S.marks.shift();            // 上限を超えたら古いほうから外す
}

function renderMarks() {
  $('#markLimit').textContent = S.kind === 'band' ? '帯下は1つだけ（選び直すと入れ替わります）' : '帯のみは2つまで（3つ目を選ぶと、先に選んだほうが外れます）';
  $$('#marksBox input[data-mark]').forEach(el => { el.checked = S.marks.indexOf(el.dataset.mark) >= 0; });
  const f = $('#freeText');
  if (f.value !== S.free) f.value = S.free;
  const z = S.src ? S.src.pages[0].zone : null;
  const p = z ? marksProblem(z) : null;
  const note = $('#markMsg');
  if (p) { note.textContent = p; note.className = 'tiny err-ink'; }
  else if (S.kind !== 'name' && S.kind !== 'none' && z) {
    const ms = selectedMarks();
    note.className = 'tiny muted';
    if (S.kind === 'band') { const b = bandLayout(z); note.textContent = '帯：「' + b.text + '」' + Math.round(b.size) + 'pt'; }
    else note.textContent = onlyLayout(z).lines.map(l => l.text + ' ' + Math.round(l.size) + 'pt').join('　／　');
  } else note.textContent = '';
  sketchAll();
}

function onMarkInput(e) {
  const el = e.target;
  if (el.dataset.mark) {
    const k = el.dataset.mark;
    S.marks = S.marks.filter(x => x !== k);
    if (el.checked) S.marks.push(k);
  } else if (el.id === 'freeText') {
    S.free = el.value;
    S.marks = S.marks.filter(x => x !== 'free');
    if (S.free.trim()) S.marks.push('free');           // 書いたら自由入力を選んだことにする
  } else return;
  limitMarks();
  renderMarks();
  invalidateOut();
}

/** 記事欄にある注意書きに印を付ける */
function marksFromKiji() {
  const s = S.src;
  if (!s) return;
  const seen = [];
  s.pages.forEach(pg => pg.kiji.forEach(t => { if (seen.indexOf(t) < 0) seen.push(t); }));
  const hit = [], other = [];
  seen.forEach(t => {
    const m = MARKS.find(x => normMark(x.label) === normMark(t) || normMark(t).indexOf(normMark(x.label)) === 0);
    if (m) { if (hit.indexOf(m.key) < 0) hit.push(m.key); }
    else other.push(t);
  });
  const lim = MARK_LIMIT[S.kind] || 2;
  const msg = [];
  if (!seen.length) msg.push('記事欄に何も入っていませんでした');
  if (hit.length) {
    S.marks = hit.slice(0, lim);
    if (hit.length > lim) msg.push('記事欄の注意書きが ' + hit.length + ' つあります。上限の ' + lim + ' つだけ選びました');
  }
  if (other.length) msg.push('記事欄には「' + other.join('」「') + '」もあります。入れるなら自由入力へ');
  renderMarks();
  const note = $('#kijiMsg');
  note.textContent = hit.length ? '記事欄から選びました：' + hit.map(k => MARKS.find(m => m.key === k).label).join('・') + (msg.length ? '。' + msg.join('。') : '')
                                : msg.join('。');
  note.hidden = false;
  invalidateOut();
}

function setMsg(sel, text, cls) {
  const el = $(sel);
  el.className = 'notice ' + (cls || '');
  el.textContent = text;
  el.hidden = !text;
}


/* ================================================================
   画面：3 品名と枚数（届け先ごと）
   ================================================================ */
function blankRow() { return {name: '', per: '', total: '', count: '', keep: false, fragile: false}; }

function renderGroups() {
  const box = $('#groups');
  box.innerHTML = '';
  const multi = S.src.groups.length > 1;
  S.src.groups.forEach((g, gi) => {
    const el = document.createElement('div');
    el.className = 'group';
    el.dataset.gi = gi;
    const addr = (g.zip ? '〒' + g.zip + ' ' : '') + (g.addr || '');
    el.innerHTML =
      '<div class="gh"><b>■ ' + esc(g.name || '(届け先名なし)') + '</b>' +
      '<span class="cnt">' + g.pages.length + ' 枚</span>' +
      '<span class="muted tiny">' + esc(pageRanges(g.pages)) + '</span>' +
      (g.slipTag ? '<span class="muted tiny">' + esc(g.slipTag) + '</span>' : '') + '</div>' +
      (addr.trim() ? '<div class="ga tiny muted">' + esc(addr) + '</div>' : '') +
      '<div class="gs" hidden></div>' +
      '<table class="rows"><thead><tr>' +
      '<th class="c-name" rowspan="2">商品名 / 入れたい文字列</th><th class="c-num" rowspan="2">枚数</th>' +
      '<th class="c-keep" rowspan="2">そのまま</th>' +
      '<th class="c-keep" rowspan="2" title="右に割れ物シールの場所を空けます">割れ物</th>' +
      '<th class="c-opt opt-l" colspan="2">入数で割るとき（任意）</th>' +
      '<th class="c-det" rowspan="2">内訳</th><th class="c-del" rowspan="2"></th></tr><tr>' +
      '<th class="c-num opt-l">1箱の入数</th><th class="c-num">総数</th>' +
      '</tr></thead><tbody></tbody></table>' +
      '<div class="gf"><button class="btn small" data-act="add">＋ 入力欄を追加</button>' +
      '<span class="total"></span></div>' +
      '<details class="sk" open><summary class="tiny muted">見本（入力に合わせてすぐ変わります。最後はPDFを作ったあとのプレビューで確かめてください）</summary>' +
      '<div class="skgrid"></div></details>';
    box.appendChild(el);
    renderRows(gi);
    if (!multi) el.classList.add('single');
  });
}

function renderRows(gi) {
  const g = S.src.groups[gi];
  const tb = $('.group[data-gi="' + gi + '"] tbody');
  tb.innerHTML = '';
  g.rows.forEach((r, ri) => {
    const tr = document.createElement('tr');
    tr.dataset.ri = ri;
    tr.innerHTML =
      '<td class="c-name"><textarea rows="2" data-f="name" placeholder="例) 商品A">' + esc(r.name) + '</textarea></td>' +
      '<td class="c-num"><input type="text" inputmode="numeric" data-f="count" value="' + esc(r.count) + '"></td>' +
      '<td class="c-keep"><input type="checkbox" data-f="keep" tabindex="-1"' + (r.keep ? ' checked' : '') + '></td>' +
      '<td class="c-keep"><input type="checkbox" data-f="fragile" tabindex="-1"' + (r.fragile ? ' checked' : '') + '></td>' +
      '<td class="c-num opt-l"><input type="text" inputmode="numeric" data-f="per" class="opt" placeholder="入数" value="' + esc(r.per) + '"></td>' +
      '<td class="c-num"><input type="text" inputmode="numeric" data-f="total" class="opt" placeholder="総数" value="' + esc(r.total) + '"></td>' +
      '<td class="c-det"><span class="det"></span></td>' +
      '<td class="c-del"><button class="x" data-act="del" title="この行を消す" tabindex="-1">×</button></td>';
    tb.appendChild(tr);
  });
  refreshGroup(gi);
}

/** 1行の意味。auto=入数と総数から自動 / text / blank / keep / empty / err */
function rowInfo(r) {
  if (r.keep) {
    if (!String(r.count).trim()) return {kind: 'empty'};
    if (!isInt(r.count) || +r.count < 1) return {kind: 'err', msg: '枚数は1以上の数字で'};
    return {kind: KEEP, count: +r.count};
  }
  const per = String(r.per).trim(), total = String(r.total).trim();
  if (per || total) {
    if (!isInt(per) || !isInt(total)) return {kind: 'err', msg: '入数と総数の両方を数字で'};
    const name = r.name.replace(/\n/g, '').trim();
    if (!name) return {kind: 'err', msg: '商品名を入れてください'};
    const boxes = splitBoxes(name, +per, +total);
    if (!boxes.length) return {kind: 'err', msg: '入数・総数では箱が出せません'};
    return {kind: 'auto', boxes: boxes, count: boxes.reduce((s, b) => s + b[1], 0), fragile: !!r.fragile};
  }
  const c = String(r.count).trim();
  if (!c) return {kind: 'empty'};
  if (!isInt(c) || +c < 1) return {kind: 'err', msg: '枚数は1以上の数字で'};
  const text = r.name.trim();
  return text ? {kind: TEXT, text: text, count: +c, fragile: !!r.fragile} : {kind: BLANK, count: +c, fragile: !!r.fragile};
}

/** 品名の折り方と大きさ。割れ物のときは右を空けた残りに、小さい段階まで使って入れる */
function fitIn(text, zone, fragile) {
  const rect = nameRect(zone, fragile);
  if (!fragile) return layout(text, rect);
  // 割れ物は幅が狭いので、大きさより「商品名／(数量)」の形を優先する（商品名の途中で折らない）
  const m = text.indexOf('\n') < 0 && text.match(/^(.+?)\s*([(（].*[)）])$/);
  if (m) {
    const f = layout(m[1] + '\n' + m[2], rect, FRAGILE.steps);
    if (f.size >= FRAGILE.min) return f;
  }
  return layout(text, rect, FRAGILE.steps);
}
function fitOf(text, gi, fragile) {
  const g = S.src.groups[gi];
  return fitIn(text, S.src.pages[g.pages[0]].zone, fragile);
}

function refreshGroup(gi) {
  const g = S.src.groups[gi];
  const el = $('.group[data-gi="' + gi + '"]');
  let total = 0, bad = false;
  $$('tbody tr', el).forEach(tr => {
    const r = g.rows[+tr.dataset.ri];
    const info = rowInfo(r);
    const cnt = $('[data-f="count"]', tr);
    const det = $('.det', tr);
    tr.classList.toggle('keep', !!r.keep);
    $('[data-f="name"]', tr).disabled = !!r.keep;
    $('[data-f="per"]', tr).disabled = !!r.keep;
    $('[data-f="total"]', tr).disabled = !!r.keep;
    $('[data-f="fragile"]', tr).disabled = !!r.keep;
    if (info.kind === 'auto') {
      cnt.value = info.count;
      cnt.disabled = true;
      cnt.classList.add('auto');
    } else {
      cnt.disabled = false;
      cnt.classList.remove('auto');
      if (cnt.value !== String(r.count)) cnt.value = r.count;
    }
    det.className = 'det';
    if (info.kind === 'err') { det.textContent = info.msg; det.classList.add('err-ink'); bad = true; }
    else if (info.kind === 'empty') det.textContent = '';
    else if (info.kind === KEEP) { det.textContent = 'ロゴのまま'; det.classList.add('muted'); }
    else if (info.kind === BLANK) { det.textContent = '白紙' + (info.fragile ? '＋割れ物の枠' : ''); det.classList.add('muted'); }
    else if (info.kind === TEXT) {
      const f = fitOf(info.text, gi, info.fragile);
      if (f.size < minFor(info.fragile)) { det.textContent = fitProblem(f.lines, info.fragile); det.classList.add('err-ink'); }
      else { det.textContent = Math.round(f.size) + 'pt' + (info.fragile ? '＋割れ物の枠' : ''); det.classList.add('muted'); }
    } else if (info.kind === 'auto') {
      const worst = info.boxes.map(b => fitOf(b[0], gi, info.fragile)).reduce((a, b) => (b.size < a.size ? b : a));
      const ng = worst.size < minFor(info.fragile);
      det.textContent = info.boxes.map(b => b[0] + '×' + b[1]).join('　') +
                        (info.fragile ? '　＋割れ物の枠' : '') + (ng ? '　← 枠に入りません' : '');
      if (ng) det.classList.add('err-ink');
    }
    if (info.count) total += info.count;
  });
  const need = g.pages.length;
  const t = $('.total', el);
  t.className = 'total';
  if (bad) { t.textContent = '合計 ' + total + ' / ' + need + ' 枚　※直すところがあります'; t.classList.add('err-ink'); }
  else if (total === need) { t.textContent = '合計 ' + total + ' / ' + need + ' 枚　OK'; t.classList.add('ok-ink'); }
  else if (total < need) { t.textContent = '合計 ' + total + ' / ' + need + ' 枚　※あと ' + (need - total) + '枚 足りません'; t.classList.add('err-ink'); }
  else { t.textContent = '合計 ' + total + ' / ' + need + ' 枚　※' + (total - need) + '枚 多いです'; t.classList.add('err-ink'); }
  sketchLater(gi);
}

function onInput(e) {
  const el = e.target;
  const f = el.dataset && el.dataset.f;
  if (!f) return;
  const gEl = el.closest('.group'), tr = el.closest('tr');
  if (!gEl || !tr) return;
  const gi = +gEl.dataset.gi, ri = +tr.dataset.ri;
  const r = S.src.groups[gi].rows[ri];
  r[f] = (f === 'keep' || f === 'fragile') ? el.checked : el.value;
  refreshGroup(gi);
  invalidateOut();
}

/** Tab：商品名 → 枚数 → 次の行の商品名。入数・総数は使う行だけ（枚数が自動の行は 商品名 → 入数 → 総数） */
function onKey(e) {
  if (e.key !== 'Tab') return;
  const el = e.target;
  const tr = el.closest && el.closest('tbody tr');
  if (!tr) return;
  const all = $$('#groups tbody tr');
  const i = all.indexOf(tr);
  if (!e.shiftKey && el.dataset.f === 'count') {
    const next = all[i + 1];
    if (next) { e.preventDefault(); $('textarea', next).focus(); }
  } else if (e.shiftKey && el.dataset.f === 'name') {
    const prev = all[i - 1];
    if (prev) {
      e.preventDefault();
      const c = $('[data-f="count"]', prev);
      (c.disabled ? $('[data-f="total"]', prev) : c).focus();
    }
  }
}

function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const gEl = b.closest('.group');
  if (!gEl) return;
  const gi = +gEl.dataset.gi;
  const g = S.src.groups[gi];
  if (b.dataset.act === 'add') {
    g.rows.push(blankRow());
    renderRows(gi);
    const last = $$('tbody tr', gEl).pop();
    if (last) $('textarea', last).focus();
  } else if (b.dataset.act === 'del') {
    const ri = +b.closest('tr').dataset.ri;
    if (g.rows.length <= 1) g.rows[0] = blankRow();
    else g.rows.splice(ri, 1);
    renderRows(gi);
  }
  invalidateOut();
}

/* ================================================================
   見本（入力中）。PDFは作らず、同じ計算・同じフォントで画面に描く
   ================================================================ */
const SK_W = 190;                       // 見本1枚の幅(px)

/** フォントを画面用にも読み込み、元のロゴの絵を1枚だけ取っておく（「そのまま」「未入力」用） */
async function prepSketch() {
  if (!S.face && S.fontBytes) {
    S.face = new FontFace('HinmeiBIZ', S.fontBytes.buffer.slice(0));
    await S.face.load();
    document.fonts.add(S.face);
  }
  const s = S.src;
  if (s && !S.logo) {
    const zone = s.pages[0].zone;
    const dpr = window.devicePixelRatio || 1;
    const k = SK_W / (zone[2] - zone[0]) * dpr;
    const pdf = await pdfjsLib.getDocument({data: s.bytes.slice(0)}).promise;
    const page = await pdf.getPage(1);
    const c = document.createElement('canvas');
    c.width = Math.round((zone[2] - zone[0]) * k);
    c.height = Math.round((zone[3] - zone[1]) * k);
    await page.render({canvasContext: c.getContext('2d'), viewport: page.getViewport({scale: k}),
                       transform: [1, 0, 0, 1, -zone[0] * k, -zone[1] * k]}).promise;
    await pdf.destroy();
    if (S.src === s) S.logo = c;
  }
  sketchAll();
}

/** 届け先ひとつ分の「何枚目に何が入るか」。止めずに、足りない枚は未入力、おかしい行は注意で返す */
function sketchSeq(gi) {
  const g = S.src.groups[gi];
  if (S.kind === 'only') return g.pages.map(() => ({mode: 'only'}));
  const seq = [];
  for (const r of g.rows) {
    const info = rowInfo(r);
    if (info.kind === 'empty') continue;
    if (info.kind === 'err') { seq.push({mode: 'err', msg: info.msg}); continue; }
    const fr = !!info.fragile;
    if (info.kind === 'auto') info.boxes.forEach(b => { for (let k = 0; k < b[1]; k++) seq.push({mode: TEXT, text: b[0], fragile: fr}); });
    else if (info.kind === TEXT) for (let k = 0; k < info.count; k++) seq.push({mode: TEXT, text: info.text, fragile: fr});
    else for (let k = 0; k < info.count; k++) seq.push({mode: info.kind, fragile: fr});
  }
  return seq;
}

/** 1枚ぶんを描く。戻り値は問題の文（無ければ ''） */
function drawSketch(cv, zone, e) {
  const dpr = window.devicePixelRatio || 1;
  const zw = zone[2] - zone[0], zh = zone[3] - zone[1];
  const k = SK_W / zw;
  cv.width = Math.round(SK_W * dpr);
  cv.height = Math.round(zh * k * dpr);
  cv.style.aspectRatio = zw + ' / ' + zh;
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (e.mode === KEEP || e.mode === 'empty' || e.mode === 'err') {
    if (S.logo) ctx.drawImage(S.logo, 0, 0, cv.width, cv.height);
    return '';
  }
  ctx.setTransform(k * dpr, 0, 0, k * dpr, -zone[0] * k * dpr, -zone[1] * k * dpr);
  ctx.fillStyle = '#fff';
  ctx.fillRect(zone[0], zone[1], zw, zh);
  ctx.textBaseline = 'alphabetic';
  const text = (str, r, size, base, color) => {
    ctx.font = size + 'px HinmeiBIZ';
    ctx.fillStyle = color;
    ctx.fillText(str, r[0] + (r[2] - r[0] - width(str, size)) / 2, base);
  };
  let problem = '';
  if (e.mode === 'only') {
    const o = onlyLayout(zone);
    ctx.lineWidth = ONLY.frame;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(o.box[0], o.box[1], o.box[2] - o.box[0], o.box[3] - o.box[1]);
    o.lines.forEach(l => text(l.text, o.body, l.size, l.base, '#000'));
    return marksProblem(zone) || '';
  }
  const fr = !!e.fragile;
  if (S.kind === 'band') {
    const b = bandLayout(zone, fr);
    if (b) {
      ctx.fillStyle = '#000';
      ctx.fillRect(b.band[0], b.band[1], b.band[2] - b.band[0], b.band[3] - b.band[1]);
      text(b.text, b.band, b.size, b.base, '#fff');
    }
    problem = marksProblem(zone) || (fr ? fragileBandProblem(zone) : '');
  }
  if (fr) {                                         // シールの目安の薄い枠と「割れ」
    const fz = fragileSplit(zone).frame, g = Math.round(255 * FRAGILE.gray);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
    ctx.strokeRect(fz[0], fz[1], fz[2] - fz[0], fz[3] - fz[1]);
    text(FRAGILE.label, fz, FRAGILE.labelSize, (fz[1] + fz[3]) / 2 + FRAGILE.labelSize * 0.38, ctx.strokeStyle);
  }
  if (e.mode === TEXT) {
    const nr = nameRect(zone, fr);
    const f = fitIn(e.text, zone, fr);
    const base = lineBases(f, nr);
    f.lines.forEach((ln, i) => text(ln, nr, f.size, base[i], '#000'));
    if (f.size < minFor(fr)) problem = fitProblem(f.lines, fr);
  }
  return problem;
}

function sketchGroup(gi) {
  const s = S.src;
  if (!s || !S.face) return;
  const g = s.groups[gi];
  const box = $('.group[data-gi="' + gi + '"] .skgrid');
  if (!box) return;
  const seq = sketchSeq(gi);
  const cards = g.pages.map((p, j) => seq[j] || {mode: 'empty'});
  // 描き直すたびに作り直さず、枚数が変わったときだけ入れ物を足し引きする
  while (box.children.length > cards.length) box.lastChild.remove();
  while (box.children.length < cards.length) {
    const fig = document.createElement('figure');
    fig.innerHTML = '<canvas></canvas><figcaption></figcaption>';
    box.appendChild(fig);
  }
  cards.forEach((e, j) => {
    const fig = box.children[j];
    const problem = drawSketch($('canvas', fig), s.pages[g.pages[j]].zone, e);
    const marks = selectedMarks().map(m => m.label).join('・');
    let lab = e.mode === TEXT ? e.text.replace(/\n/g, ' / ') : e.mode === BLANK ? '白紙' : e.mode === KEEP ? 'ロゴのまま' :
              e.mode === 'only' ? marks : e.mode === 'err' ? e.msg : '未入力';
    if (S.kind === 'band' && (e.mode === TEXT || e.mode === BLANK)) lab += '＋' + marks;
    if (e.fragile && (e.mode === TEXT || e.mode === BLANK)) lab += '＋割れ物';
    fig.className = e.mode === 'empty' ? 'empty' : (e.mode === 'err' || problem) ? 'bad' : '';
    $('figcaption', fig).innerHTML = '<b>' + (g.pages[j] + 1) + '</b>　' + esc(problem ? problem : lab);
  });
  const over = seq.length - g.pages.length;
  let extra = box.parentNode.querySelector('.skover');
  if (over > 0) {
    if (!extra) { extra = document.createElement('div'); extra.className = 'skover tiny err-ink'; box.parentNode.appendChild(extra); }
    extra.textContent = '入力が送り状より ' + over + '枚 多いので、あふれた分は入りません';
  } else if (extra) extra.remove();
}

let skTimer = null;
const skDirty = new Set();
function sketchLater(gi) {
  skDirty.add(gi);
  if (skTimer) return;
  skTimer = requestAnimationFrame(() => {
    skTimer = null;
    skDirty.forEach(i => sketchGroup(i));
    skDirty.clear();
  });
}
function sketchAll() {
  if (!S.src) return;
  S.src.groups.forEach((g, gi) => sketchLater(gi));
  sketchOnly();
}

/** 帯のみのときは表が無いので、注意書きの欄に見本を1枚出す */
function sketchOnly() {
  const fig = $('#onlySketch');
  if (!fig) return;
  const on = !!(S.src && S.face && S.kind === 'only');
  fig.hidden = !on;
  if (!on) return;
  const problem = drawSketch($('canvas', fig), S.src.pages[0].zone, {mode: 'only'});
  fig.className = problem ? 'bad' : '';
  $('figcaption', fig).textContent = problem || ('全' + S.src.pages.length + '枚ともこの見た目');
}

function invalidateOut() {
  if (!S.out) return;
  $('#result').hidden = true;
  setMsg('#makeMsg', '内容が変わったので、もう一度「PDFを作る」を押してください', 'warn');
  S.out = null;
}


/* ================================================================
   アテンション自動判別：品名欄の「商品名(総数)」と入数マスタで表を埋める
   ================================================================ */
async function askMaster(names) {
  const api = window.HINMEI_IRISU_API;
  if (!api) throw new Error('入数マスタの接続先（config.js）が空です');
  const found = {}, missing = [], bad = [], fragile = [];
  for (let i = 0; i < names.length; i += 20) {         // 入数マスタは1回20商品まで
    const part = names.slice(i, i + 20);
    const u = api + '?q=' + encodeURIComponent(JSON.stringify(part));
    let j = null, last = null;
    for (let t = 0; t < 2 && !j; t++) {                  // Google側の一時的なエラーは1回だけやり直す
      try {
        const r = await fetch(u, {method: 'GET', redirect: 'follow'});
        const txt = await r.text();
        try { j = JSON.parse(txt); } catch (e) { throw new Error('入数マスタから思っていない返事が来ました'); }
      } catch (e) { last = e; j = null; await sleep(800); }
    }
    if (!j) throw last || new Error('入数マスタにつながりませんでした');
    if (j.error) throw new Error('入数マスタ: ' + j.error);
    Object.assign(found, j.found || {});
    missing.push.apply(missing, j.missing || []);
    bad.push.apply(bad, j.bad || []);
    fragile.push.apply(fragile, j.fragile || []);        // 入数マスタ v2 から。v1 のままなら空
  }
  return {found: found, missing: missing, bad: bad, fragile: fragile};
}

/** 全部の表を「同じ文字 × その送り状の枚数」にする（届け先が多い日用） */
function bulkFill() {
  const s = S.src;
  if (!s) return;
  const text = $('#bulkText').value.trim();
  if (!text) { setMsg('#autoMsg', '全部に入れる文字を書いてください', 'warn'); return; }
  const filled = s.groups.some(g => g.rows.some(r => r.name.trim() || String(r.per).trim() ||
                                                    String(r.total).trim() || String(r.count).trim() || r.keep));
  if (filled && !confirm('入力済みの内容を、全部「' + text + '」に置き換えます。よろしいですか？')) return;
  s.groups.forEach(g => {
    g.rows = [Object.assign(blankRow(), {name: text, count: String(g.pages.length)}), blankRow()];
    g.status = null;
  });
  renderGroups();
  setMsg('#autoMsg', '全部の表を「' + text + '」にしました（' + s.groups.length + 'か所・' + s.pages.length + '枚）', 'ok');
  invalidateOut();
}

async function autofill(masterOverride) {
  const s = S.src;
  if (!s) return;
  const filled = s.groups.some(g => g.rows.some(r => r.name.trim() || String(r.per).trim() ||
                                                    String(r.total).trim() || String(r.count).trim() || r.keep));
  if (filled && !masterOverride && !confirm('入力済みの内容を、品名欄と入数マスタから読んだ内容で置き換えます。よろしいですか？')) return;

  const btn = $('#autoBtn');
  btn.disabled = true;
  setMsg('#autoMsg', '品名欄を読んで、入数マスタに聞いています…', 'muted');
  try {
    // 届け先ごとに品名欄を読む（同じ届け先で品名欄が食い違っていたら、どれが正しいか決めない）
    const reads = s.groups.map(g => {
      const first = s.pages[g.pages[0]].hin;
      let mismatch = null;
      for (const p of g.pages.slice(1)) {
        const h = s.pages[p].hin;
        if (h.items.length && JSON.stringify(h.items) !== JSON.stringify(first.items)) { mismatch = p + 1; break; }
      }
      return {items: first.items, junk: first.junk, mismatch: mismatch};
    });
    const names = Array.from(new Set([].concat.apply([], reads.map(r => r.items.map(it => it.name)))));
    if (!names.length) throw new Error('品名欄から「商品名(総数)」が読めませんでした。表に手で入れてください');

    const ans = masterOverride || await askMaster(names);
    let problems = 0;
    s.groups.forEach((g, gi) => {
      const rd = reads[gi];
      const notes = [];
      if (rd.mismatch) notes.push(rd.mismatch + '枚目の品名欄が1枚目と違います。手で確かめてください');
      if (rd.junk.length) notes.push('品名欄に「商品名(数)」の形でない行があります：' + rd.junk.join(' / '));
      if (!rd.items.length) notes.push('品名欄から商品が読めませんでした');
      g.rows = rd.items.map(it => ({
        name: it.name,
        per: ans.found[it.name] !== undefined ? String(ans.found[it.name]) : '',
        total: String(it.total), count: '', keep: false,
        fragile: (ans.fragile || []).indexOf(it.name) >= 0     // 入数マスタで「割れ物」にチェックがある商品
      }));
      rd.items.forEach(it => {
        if (ans.missing.indexOf(it.name) >= 0) notes.push('「' + it.name + '」は入数マスタにありません。入数を手で入れてください');
        else if (ans.bad.indexOf(it.name) >= 0) notes.push('「' + it.name + '」は入数マスタの入数が数字ではありません');
      });
      if (!g.rows.length) g.rows = [blankRow()];
      g.rows.push(blankRow());
      const got = g.rows.map(rowInfo).reduce((n, x) => n + (x.count || 0), 0);
      const allKnown = rd.items.length && rd.items.every(it => ans.found[it.name] !== undefined);
      if (!notes.length && allKnown && got !== g.pages.length) {
        notes.push('計算は ' + got + '枚、送り状は ' + g.pages.length + '枚です。入数どおりに詰めていない箱があれば、表を直してください');
      }
      g.status = notes;
      if (notes.length) problems++;
    });
    renderGroups();
    s.groups.forEach((g, gi) => {
      const box = $('.group[data-gi="' + gi + '"] .gs');
      if (g.status && g.status.length) {
        box.innerHTML = g.status.map(t => '<div>' + esc(t) + '</div>').join('');
        box.className = 'gs notice warn';
        box.hidden = false;
      }
    });
    setMsg('#autoMsg', problems ? '読めたところまで埋めました。黄色の注意を見て、足りないところを手で直してください'
                                : '品名欄と入数マスタから埋めました。内容を確かめて「PDFを作る」へ', problems ? 'warn' : 'ok');
    invalidateOut();
  } catch (e) {
    setMsg('#autoMsg', e.message || String(e), 'err');
  } finally {
    btn.disabled = false;
  }
}


/* ================================================================
   4 PDFを作る（pdf-lib）。元の中身には触らず、上に描き足すだけ
   ================================================================ */
/** 1枚ごとに何を描くか。問題があれば文にして投げる。足りないときは確かめる */
function makePlan() {
  const s = S.src;
  const plan = new Array(s.pages.length).fill(null);
  if (S.kind === 'none') return plan.map(() => ({mode: KEEP}));   // 何も書かない（並べ直すだけ）
  const mp = marksProblem(s.pages[0].zone);
  if (mp) throw new Error(mp);
  if (S.kind === 'only') return plan.map(() => ({mode: 'only'}));

  const multi = s.groups.length > 1;
  for (let gi = 0; gi < s.groups.length; gi++) {
    const g = s.groups[gi];
    const where = multi ? '「' + (g.name || '届け先') + '」の' : '';
    const seq = [];
    for (const r of g.rows) {
      const info = rowInfo(r);
      if (info.kind === 'empty') continue;
      if (info.kind === 'err') throw new Error(where + '表に直すところがあります：' + info.msg);
      const fr = !!info.fragile;
      if (fr && info.kind !== KEEP) {
        const bp = fragileBandProblem(s.pages[g.pages[0]].zone);
        if (bp) throw new Error(where + bp);
      }
      if (info.kind === 'auto') {
        for (const b of info.boxes) {
          const f = fitOf(b[0], gi, fr);
          if (f.size < minFor(fr)) throw new Error(where + '「' + b[0] + '」が枠に入りません：' + fitProblem(f.lines, fr));
          for (let k = 0; k < b[1]; k++) seq.push({mode: TEXT, text: b[0], fragile: fr});
        }
      } else if (info.kind === TEXT) {
        const f = fitOf(info.text, gi, fr);
        if (f.size < minFor(fr)) throw new Error(where + '「' + info.text.replace(/\n/g, ' / ') + '」が枠に入りません：' + fitProblem(f.lines, fr));
        for (let k = 0; k < info.count; k++) seq.push({mode: TEXT, text: info.text, fragile: fr});
      } else {
        for (let k = 0; k < info.count; k++) seq.push({mode: info.kind, fragile: info.kind === KEEP ? false : fr});
      }
    }
    const need = g.pages.length;
    if (!seq.length) throw new Error(where + '枚数が入っていません');
    if (seq.length > need) throw new Error(where + '合計が ' + seq.length + '枚 で、送り状の ' + need + '枚 より多いです');
    if (seq.length < need) {
      if (!confirm(where + '合計が ' + seq.length + '枚 で、送り状は ' + need + '枚 あります。\n' +
                   '残りの ' + (need - seq.length) + '枚 は元のまま（ヤマトのロゴ）になります。このまま作りますか？')) return null;
      while (seq.length < need) seq.push({mode: KEEP});
    }
    g.pages.forEach((p, k) => { plan[p] = seq[k]; });
  }
  return plan;
}

async function buildPdf(plan) {
  const s = S.src;
  const doc = await PDFLib.PDFDocument.load(s.bytes, {updateMetadata: false});
  doc.registerFontkit(fontkit);
  // フォントは丸ごと埋め込む。使う文字だけに絞る(subset)と、このフォントでは字が消える
  // (pdf-lib 1.17.1 + fontkit 1.1.1 で確認。絞らなければPython版と画素まで一致)。
  // PDFは3MBほどになるが、Python版も同じ大きさ
  const font = S.kind === 'none' ? null : await doc.embedFont(S.fontBytes, {subset: false});   // 何も書かないならフォントも入れない
  const BLACK = PDFLib.rgb(0, 0, 0), WHITE = PDFLib.rgb(1, 1, 1);
  const pages = doc.getPages();
  if (pages.length !== s.pages.length) throw new Error('ページ数が読み込み時と違います');

  plan.forEach((p, i) => {
    if (!p || p.mode === KEEP) return;
    const info = s.pages[i], page = pages[i], zone = info.zone, v = info.view;
    // 左上原点のpt → PDFの座標（左下原点）
    const X = x => v[0] + x, Y = y => v[3] - y;
    const rect = (r, opt) => page.drawRectangle(Object.assign(
      {x: X(r[0]), y: Y(r[3]), width: r[2] - r[0], height: r[3] - r[1]}, opt));
    const text = (str, x, y, size, color) => page.drawText(str, {x: X(x), y: Y(y), size: size, font: font, color: color});
    const center = (str, r, size, baseline, color) => {
      const w = font.widthOfTextAtSize(str, size);
      text(str, r[0] + (r[2] - r[0] - w) / 2, baseline, size, color);
    };

    rect(zone, {color: WHITE});                          // ロゴの枠を白く塗る

    if (p.mode === 'only') {                              // 帯のみ：白地に黒文字＋太枠
      const o = onlyLayout(zone);
      rect(o.box, {borderColor: BLACK, borderWidth: ONLY.frame});
      o.lines.forEach(l => center(l.text, o.body, l.size, l.base, BLACK));
      return;
    }

    const fr = !!p.fragile;
    if (S.kind === 'band') {                              // 帯下：下に黒帯、注意書きは白抜き
      const b = bandLayout(zone, fr);
      rect(b.band, {color: BLACK});
      center(b.text, b.band, b.size, b.base, WHITE);
    }
    if (fr) {                                             // 割れ物：シールの目安の薄い枠と「割れ」
      const fz = fragileSplit(zone).frame, GRAY = PDFLib.rgb(FRAGILE.gray, FRAGILE.gray, FRAGILE.gray);
      rect(fz, {borderColor: GRAY, borderWidth: 0.8});
      center(FRAGILE.label, fz, FRAGILE.labelSize, (fz[1] + fz[3]) / 2 + FRAGILE.labelSize * 0.38, GRAY);
    }
    if (p.mode === TEXT) {                                // 品名（Python版 stamp と同じ置き方）
      const nr = nameRect(zone, fr);
      const f = fitIn(p.text, zone, fr);
      const base = lineBases(f, nr);
      f.lines.forEach((ln, k) => center(ln, nr, f.size, base[k], BLACK));
    }
  });
  // ページを送り状番号の小さい順に並べ直す（中身はそのまま、順番だけ）
  const order = pageOrder(s.pages);
  S.lastOrder = order;
  if (order.some((v, i) => v !== i)) {
    for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
    order.forEach(i => doc.addPage(pages[i]));
  }
  return await doc.save();
}

function outName() {
  const base = S.src.name.replace(/\.pdf$/i, '');
  return base + (S.kind === 'none' ? '_番号順.pdf' : '_余白書き換え.pdf');
}

async function make() {
  const btn = $('#makeBtn');
  setMsg('#makeMsg', '', '');
  let plan;
  try {
    plan = makePlan();
  } catch (e) {
    setMsg('#makeMsg', e.message || String(e), 'err');
    return;
  }
  if (!plan) return;
  btn.disabled = true;
  setMsg('#makeMsg', '作っています…', 'muted');
  try {
    const bytes = await buildPdf(plan);
    if (S.out && S.out.url) URL.revokeObjectURL(S.out.url);
    const url = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}));
    S.out = {bytes: bytes, name: outName(), url: url, plan: plan};
    const a = $('#dlLink');
    a.href = url;
    a.download = S.out.name;
    $('#outName').textContent = S.out.name;
    $('#result').hidden = false;
    const order = S.lastOrder || plan.map((p, i) => i);
    const moved = order.some((v, i) => v !== i);
    setMsg('#makeMsg', 'できました。' + (moved ? '元のPDFは並びが割れていたので、送り状番号の小さい順（発行済データの順）に並べ直しました。'
                                         : S.kind === 'none' ? '元のPDFはもともと送り状番号の順でした（中身も順番も元のままです）。' : '') +
                       'ダウンロードが始まらないときは下のボタンから', 'ok');
    a.click();
    await renderPreview(bytes, plan, order);
  } catch (e) {
    setMsg('#makeMsg', 'PDFを作れませんでした：' + (e.message || String(e)), 'err');
  } finally {
    btn.disabled = false;
  }
}

/** できたPDFの左下を並べて見せる（印刷前の確認用） */
async function renderPreview(bytes, plan, order) {
  const box = $('#preview');
  box.innerHTML = '';
  const pdf = await pdfjsLib.getDocument({data: bytes.slice(0)}).promise;
  const SC = 1.2;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({scale: SC});
    const full = document.createElement('canvas');
    full.width = Math.ceil(vp.width);
    full.height = Math.ceil(vp.height);
    await page.render({canvasContext: full.getContext('2d'), viewport: vp}).promise;
    const si = order ? order[i - 1] : i - 1;               // 出力の i 枚目 ＝ 元の si 枚目
    const z = S.src.pages[si].zone;
    const cut = [z[0] - 10, z[1] - 10, z[2] + 10, z[3] + 10].map(v => Math.round(v * SC));
    const c = document.createElement('canvas');
    c.width = cut[2] - cut[0];
    c.height = cut[3] - cut[1];
    c.getContext('2d').drawImage(full, cut[0], cut[1], c.width, c.height, 0, 0, c.width, c.height);
    const p = plan[si] || {mode: KEEP};
    const marks = selectedMarks().map(m => m.label).join('・');
    let lab = p.mode === 'only' ? marks : p.mode === KEEP ? (S.kind === 'none' ? '何も書かない' : 'ロゴのまま') : p.mode === BLANK ? '白紙' : p.text.replace(/\n/g, ' / ');
    if (S.kind === 'band' && p.mode !== KEEP) lab += '＋' + marks;
    if (p.fragile) lab += '＋割れ物';
    const fig = document.createElement('figure');
    fig.innerHTML = '<figcaption><b>' + i + '</b>　' + esc(lab) + '</figcaption>';
    fig.insertBefore(c, fig.firstChild);
    box.appendChild(fig);
    page.cleanup();
  }
  await pdf.destroy();
}


/* ================================================================
   つなぎ
   ================================================================ */
function readFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => openPdf(new Uint8Array(r.result), file.name);
  r.onerror = () => setMsg('#fileInfo', 'ファイルを読めませんでした', 'err');
  r.readAsArrayBuffer(file);
}

function wire() {
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => readFile(e.dataTransfer.files[0]));
  // 枠の外に落としてもブラウザでPDFが開かないように
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); if (e.target.closest && !e.target.closest('#drop')) readFile(e.dataTransfer.files[0]); });
  $('#file').addEventListener('change', e => { readFile(e.target.files[0]); e.target.value = ''; });

  $$('input[name="kind"]').forEach(el => el.addEventListener('change', () => {
    S.kind = $('input[name="kind"]:checked').value;
    limitMarks();
    showSteps();
    if (S.src) S.src.groups.forEach((g, gi) => refreshGroup(gi));
    invalidateOut();
  }));
  $$('input[name="size"]').forEach(el => el.addEventListener('change', () => {
    S.size = $('input[name="size"]:checked').value;
    if (S.src) S.src.groups.forEach((g, gi) => refreshGroup(gi));
    invalidateOut();
  }));
  // 注意書きの候補
  $('#markChecks').innerHTML = MARKS.map(m =>
    '<label class="mk"><input type="checkbox" data-mark="' + m.key + '">' + esc(m.label) + '</label>').join('');
  $('#marksBox').addEventListener('change', onMarkInput);
  $('#freeText').addEventListener('input', onMarkInput);
  $('#kijiBtn').addEventListener('click', marksFromKiji);
  $('#groups').addEventListener('input', onInput);
  $('#groups').addEventListener('change', onInput);
  $('#groups').addEventListener('click', onClick);
  $('#groups').addEventListener('keydown', onKey);
  $('#autoBtn').addEventListener('click', () => autofill());
  $('#bulkBtn').addEventListener('click', bulkFill);
  $('#bulkText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); bulkFill(); } });
  $('#makeBtn').addEventListener('click', make);
  $('#openBtn').addEventListener('click', () => { if (S.out) window.open(S.out.url, '_blank'); });
}

wire();
loadFont().catch(e => setMsg('#fileInfo', e.message || String(e), 'err'));

// 確かめる用（画面の動きには関係しない）
window.HINMEI = {
  open: openPdf, autofill: autofill, bulk: bulkFill, makePlan: makePlan, build: buildPdf, layout: layout,
  bandLayout: bandLayout, onlyLayout: onlyLayout, marksFromKiji: marksFromKiji,
  sketchAll: sketchAll, sketchGroup: sketchGroup,
  state: S, setKind: k => { $('input[name="kind"][value="' + k + '"]').click(); },
  setSize: k => { $('input[name="size"][value="' + k + '"]').click(); },
  setMarks: (keys, free) => { S.marks = keys.slice(); S.free = free || ''; limitMarks(); renderMarks(); }
};
})();
