/* =============================================================
 *  発行済データ → 取引先への返却用ファイル
 *
 *  B2で発行したあとの「発行済データ」を入れると、1宛先1行の一覧を作ります。
 *    - 複数口は「複数口くくりキー」（BV列＝親の伝票番号）で束ね、全口の伝票番号を並べます
 *    - 半角カナは全角に戻します（送り状に合わせて半角にしてあるため）
 *    - こちらの情報（依頼主・請求先アカウント）は画面に出して確かめるだけで、返却用には入れません
 *
 *  発行済データにはほかの案件の行も混ざるので、このツールで直近に作ったCSVと照合して、
 *  その分だけを拾います。照合用の控え（〒・名前・店名・出荷日だけ）はこのブラウザに保存します。
 * ============================================================= */

'use strict';

const Issued = (() => {
  const LS_BATCHES = 'label.batches.v1';
  const KEEP = 10;
  /* 請求先アカウント。ご請求先顧客コード（AN列）＋分類コード（AO列）で見分けます。
     コードは電話番号なので、ここには書きません。設定CSVを読み込んで、このブラウザにだけ保存します。
     「メイン」に印のあるアカウント以外は「別アカウントです」と出します */
  const LS_ACCOUNTS = 'label.accounts.v1';
  function accounts() {
    try { return JSON.parse(localStorage.getItem(LS_ACCOUNTS) || '[]') || []; } catch (e) { return []; }
  }
  const acctKey = (code, cls) => digits(code).padStart(11, '0') + '｜' + (digits(cls) ? digits(cls).padStart(2, '0') : '');

  /* 請求先の設定CSV：1行目が見出し（請求先顧客コード, 分類コード, 名前, メイン） */
  function importAccounts(grid) {
    const head = grid[0].map(h => String(h).trim());
    const col = words => head.findIndex(h => words.some(w => h.indexOf(w) >= 0));
    const ci = col(['顧客コード']), cc = col(['分類']), cn = col(['名前', 'アカウント名', '名称']), cm = col(['メイン']);
    if (ci < 0 || cn < 0) throw new Error('見出しに「請求先顧客コード」と「名前」の列が見つかりません');
    const list = accounts();
    let n = 0;
    grid.slice(1).forEach(r => {
      if (!digits(r[ci])) return;
      const a = {code: digits(r[ci]).padStart(11, '0'), cls: cc >= 0 && digits(r[cc]) ? digits(r[cc]).padStart(2, '0') : '',
                 name: String(r[cn] || '').trim(), main: cm >= 0 && /^(○|◯|〇|1|true|はい|メイン)$/i.test(String(r[cm] || '').trim())};
      const i = list.findIndex(x => x.code === a.code && x.cls === a.cls);
      if (i >= 0) list[i] = a; else list.push(a);
      n++;
    });
    try { localStorage.setItem(LS_ACCOUNTS, JSON.stringify(list)); } catch (e) { throw new Error('ブラウザに保存できませんでした'); }
    render();
    return n;
  }
  function exportAccounts() {
    const lines = [['請求先顧客コード', '分類コード', '名前', 'メイン']].concat(accounts().map(a => [a.code, a.cls, a.name, a.main ? '○' : '']));
    download('請求先設定.csv', '\uFEFF' + lines.map(csvLine).join('\r\n') + '\r\n');
  }

  /* 発行済データの列。見出しの名前で探し、見つからなければB2の標準の位置を使います */
  const COLS = {
    no:        ['伝票番号', 3],
    ship:      ['出荷予定日', 4],
    due:       ['お届け予定（指定）日', 5],
    time:      ['配達時間帯', 6],
    tel:       ['お届け先電話番号', 8],
    zip:       ['お届け先郵便番号', 10],
    addr1:     ['お届け先住所', 11],
    addr2:     ['お届け先住所（アパートマンション名）', 12],
    dept1:     ['お届け先会社・部門名１', 13],
    dept2:     ['お届け先会社・部門名２', 14],
    name:      ['お届け先名', 15],
    sCode:     ['ご依頼主コード', 18],
    sTel:      ['ご依頼主電話番号', 19],
    sZip:      ['ご依頼主郵便番号', 21],
    sAddr1:    ['ご依頼主住所', 22],
    sAddr2:    ['ご依頼主住所（アパートマンション名）', 23],
    sName:     ['ご依頼主名', 24],
    item1:     ['品名１', 27],
    item2:     ['品名２', 29],
    memo:      ['記事', 32],
    billCode:  ['ご請求先顧客コード', 39],
    billClass: ['ご請求先分類コード', 40],
    bundle:    ['複数口くくりキー', 73]
  };

  const TIME_LABEL = {'': '指定なし', '0000': '指定なし', '0812': '午前中', '1416': '14〜16時', '1618': '16〜18時', '1820': '18〜20時', '1921': '19〜21時'};

  /* 返却用の列 */
  const OUT_HEAD = ['伝票番号', '伝票番号（全口）', '個口数', 'お届け先名', '会社・部門名1', '会社・部門名2（店名）',
                    '郵便番号', '住所', '住所2（建物名）', '電話番号', '品名1', '品名2', '記事',
                    'お届け指定日', '出荷日', '配達時間帯'];

  const st = {groups: [], file: '', batchSel: 0, pick: {}};

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const full = s => String(s == null ? '' : s).normalize('NFKC').trim();          // 半角カナ→全角
  const norm = s => full(s).replace(/\s+/g, '');
  const digits = s => String(s == null ? '' : s).replace(/[^0-9]/g, '');
  const fmtZip = z => { const d = digits(z); return d.length === 7 ? d.slice(0, 3) + '-' + d.slice(3) : String(z || ''); };
  const key = (zip, name, dept2) => digits(zip) + '|' + norm(name) + '|' + norm(dept2);

  /* ---- 照合用の控え（CSVを保存するたびに1件） ---- */
  function batches() {
    try { return JSON.parse(localStorage.getItem(LS_BATCHES) || '[]') || []; } catch (e) { return []; }
  }
  function saveBatch(file, rows) {
    const list = batches();
    list.unshift({at: Date.now(), file, rows: rows.map(r => ({zip: r.zip, name: r.name, memo: r.memo, ship: r.ship}))});
    try { localStorage.setItem(LS_BATCHES, JSON.stringify(list.slice(0, KEEP))); } catch (e) { /* 保存できなくても続けます */ }
  }
  function batchLabel(b) {
    const d = new Date(b.at);
    const ships = Array.from(new Set(b.rows.map(r => r.ship).filter(Boolean))).sort();
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') +
      ' に作ったCSV（' + b.rows.length + '件' + (ships.length ? '・出荷 ' + ships.map(s => s.slice(5)).join('／') : '') + '）';
  }

  /* ---- 発行済データを読む ---- */
  async function read(file) {
    const buf = await file.arrayBuffer();
    let grid;
    if (/\.(csv|tsv|txt)$/i.test(file.name)) {
      let text;
      try { text = new TextDecoder('utf-8', {fatal: true}).decode(buf); }
      catch (e) { text = new TextDecoder('shift_jis').decode(buf); }
      grid = parseDelimited(text, /\t/.test(text.split(/\r?\n/)[0]) ? '\t' : ',');
    } else {
      const wb = XLSX.read(buf, {type: 'array', cellNF: true});
      const name = wb.SheetNames.find(n => /発行済/.test(n)) || wb.SheetNames[0];
      grid = sheetToGrid(wb.Sheets[name]);
    }
    const hr = grid.findIndex(r => r.some(v => cellText(v) === '伝票番号') && r.some(v => cellText(v) === 'お届け先名'));
    if (hr < 0) throw new Error('見出しに「伝票番号」と「お届け先名」がありません。B2の発行済データを入れてください');
    const head = grid[hr].map(cellText);
    const idx = {};
    Object.entries(COLS).forEach(([k, [label, pos]]) => { const i = head.indexOf(label); idx[k] = i >= 0 ? i : pos; });

    /* 複数口はくくりキー（親の伝票番号）で束ねます */
    const byKey = new Map();
    grid.slice(hr + 1).forEach(r => {
      const v = k => cellText(r[idx[k]]);
      const no = digits(v('no'));
      if (!no) return;
      const b = digits(v('bundle')) || no;
      if (!byKey.has(b)) byKey.set(b, {parent: b, nos: [], rows: []});
      const g = byKey.get(b);
      g.nos.push(no);
      const rec = {};
      Object.keys(COLS).forEach(k => { rec[k] = v(k); });
      g.rows.push(rec);
    });
    st.groups = Array.from(byKey.values()).map(g => {
      const head = g.rows.find(x => digits(x.no) === g.parent) || g.rows[0];
      g.nos.sort((a, b) => (a === g.parent ? -1 : b === g.parent ? 1 : a.localeCompare(b)));
      return Object.assign({}, head, {parent: g.nos[0], nos: g.nos, boxes: g.nos.length});
    });
    st.file = file.name;
    st.batchSel = batches().length ? 0 : -1;
    st.pick = {};
    render();
  }

  /* ---- 今回の分を選ぶ ---- */
  function selected() {
    const bs = batches();
    if (st.batchSel >= 0 && bs[st.batchSel]) {
      const b = bs[st.batchSel];
      const pool = new Map();
      st.groups.forEach(g => {
        const k = key(g.zip, g.name, g.dept2);
        if (!pool.has(k)) pool.set(k, []);
        pool.get(k).push(g);
      });
      const hit = [], missing = [];
      b.rows.forEach(r => {
        const list = pool.get(key(r.zip, r.name, r.memo));
        if (list && list.length) hit.push(list.shift()); else missing.push(r);
      });
      return {rows: hit, missing, other: st.groups.length - hit.length, mode: 'batch'};
    }
    /* 照合しない：出荷予定日×依頼主で選んだものだけ */
    const rows = st.groups.filter(g => st.pick[combo(g)] !== false);
    return {rows, missing: [], other: st.groups.length - rows.length, mode: 'pick'};
  }
  function combo(g) { return g.ship + '｜' + full(g.sName); }

  /* ---- 画面 ---- */
  function render() {
    const box = $('#issuedBody');
    if (!st.groups.length) { box.innerHTML = ''; return; }
    const bs = batches();
    const sel = selected();
    let h = '<div class="btns" style="margin:8px 0">' +
      '<span class="tiny">' + esc(st.file) + '　発行済 ' + st.groups.length + '件（複数口は1件に束ねて数えています）</span></div>';

    h += '<div class="btns" style="margin-bottom:8px"><b>今回の分</b><select id="batchSel">' +
      bs.map((b, i) => '<option value="' + i + '"' + (st.batchSel === i ? ' selected' : '') + '>' + esc(batchLabel(b)) + ' と照合</option>').join('') +
      '<option value="-1"' + (st.batchSel < 0 ? ' selected' : '') + '>照合しない（出荷日と依頼主で選ぶ）</option></select></div>';

    if (sel.mode === 'pick') {
      const combos = {};
      st.groups.forEach(g => { const c = combo(g); combos[c] = (combos[c] || 0) + 1; });
      h += '<div class="btns" style="margin-bottom:8px">' + Object.keys(combos).sort().map(c =>
        '<label class="tiny pick"><input type="checkbox" data-pick="' + esc(c) + '"' + (st.pick[c] !== false ? ' checked' : '') + '> 出荷 ' + esc(c) + '（' + combos[c] + '件）</label>').join('') + '</div>';
      if (!bs.length) h += '<div class="tiny muted" style="margin-bottom:8px">このブラウザには、照合に使えるCSVの控えがありません（CSVを作ったのが別のPC・ブラウザの場合など）。</div>';
    }

    h += '<div class="stats">' +
      '<span class="stat">返却する <b>' + sel.rows.length + '</b>件・<b>' + sel.rows.reduce((a, g) => a + g.boxes, 0) + '</b>口</span>' +
      (sel.other ? '<span class="stat muted">ほかの行 ' + sel.other + '件は除外</span>' : '') +
      (sel.missing.length ? '<span class="stat err-ink">CSVにあるのに発行済データに無い ' + sel.missing.length + '件</span>' : '') + '</div>';
    if (sel.missing.length) {
      h += '<div class="notice err tiny">' + sel.missing.slice(0, 15).map(r => esc(r.memo || r.name) + '（' + esc(r.zip) + '）').join('、') +
        (sel.missing.length > 15 ? ' ほか' : '') + '<br>B2で発行されていないか、名前・店名がB2側で変わっています。</div>';
    }

    /* こちらの情報。確かめるためだけに出し、返却用には入れません */
    h += '<div class="ours"><div class="tiny muted" style="margin-bottom:4px">確認用（返却用には入りません）</div>' + account(sel.rows) + senders(sel.rows) + '</div>';

    h += '<div class="btns" style="margin:10px 0"><button class="btn primary" id="retXlsx"' + (sel.rows.length ? '' : ' disabled') + '>Excelで保存</button>' +
      '<button class="btn" id="retCsv"' + (sel.rows.length ? '' : ' disabled') + '>CSVで保存</button>' +
      '<span class="tiny muted">取引先にそのまま渡せる形です</span></div>';

    const out = outRows(sel.rows);
    h += '<div class="scroll" style="max-height:50vh"><table class="src"><thead><tr>' + OUT_HEAD.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' +
      out.map(r => '<tr>' + r.map(v => '<td title="' + esc(v) + '">' + esc(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    box.innerHTML = h;
  }

  function account(rows) {
    const kinds = {};
    rows.forEach(g => { const k = acctKey(g.billCode, g.billClass); kinds[k] = (kinds[k] || 0) + 1; });
    const ks = Object.keys(kinds);
    if (!ks.length) return '';
    const list = accounts();
    if (!list.length) return '<div class="acct ng">請求先アカウントが未設定です。依頼主の欄の「設定ファイル」から請求先の設定CSVを読み込んでください</div>';
    const find = k => list.find(a => acctKey(a.code, a.cls) === k);
    const main = list.find(a => a.main);
    if (ks.length === 1 && find(ks[0]) && find(ks[0]).main) return '<div class="acct ok">' + esc(find(ks[0]).name) + 'アカウント</div>';
    return '<div class="acct ng">別アカウントです　' + ks.map(k => {
      const a = find(k);
      return (a ? '<b>' + esc(a.name) + '</b>' : '登録なし（' + esc(k.replace('｜', '-').replace(/-$/, '')) + '）') + ' ' + kinds[k] + '件';
    }).join('　') + (main ? '' : '<div class="tiny">メインのアカウントが設定されていません</div>') + '</div>';
  }

  function senders(rows) {
    const kinds = {};
    rows.forEach(g => {
      const k = [g.sCode, g.sName, g.sTel, fmtZip(g.sZip), (g.sAddr1 + ' ' + g.sAddr2).trim()].join('｜');
      kinds[k] = (kinds[k] || 0) + 1;
    });
    return '<table class="src ours-t"><thead><tr><th>依頼主コード</th><th>依頼主名</th><th>電話</th><th>〒</th><th>住所</th><th>件数</th></tr></thead><tbody>' +
      Object.keys(kinds).map(k => '<tr>' + k.split('｜').map(v => '<td>' + esc(v || '（空）') + '</td>').join('') + '<td>' + kinds[k] + '</td></tr>').join('') +
      '</tbody></table>';
  }

  function outRows(rows) {
    return rows.map(g => [
      g.parent, g.nos.join('、'), g.boxes, full(g.name), full(g.dept1), full(g.dept2),
      fmtZip(g.zip), full(g.addr1), full(g.addr2), g.tel, full(g.item1), full(g.item2), full(g.memo),
      g.due, g.ship, TIME_LABEL[digits(g.time)] || g.time
    ]);
  }

  function stamp() {
    const d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  function saveXlsx() {
    const rows = outRows(selected().rows);
    /* 番号は全部文字として入れます（頭の0が消えないように） */
    const aoa = [OUT_HEAD].concat(rows.map(r => r.map(v => String(v == null ? '' : v))));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [16, 30, 7, 26, 18, 22, 10, 36, 22, 14, 22, 22, 16, 12, 12, 11].map(w => ({wch: w}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '発送一覧');
    XLSX.writeFile(wb, '発送一覧_' + stamp() + '.xlsx');
  }
  function saveCsv() {
    const rows = outRows(selected().rows);
    /* 取引先がExcelで開いても化けないよう、BOMを付けます */
    download('発送一覧_' + stamp() + '.csv', '﻿' + [OUT_HEAD].concat(rows).map(csvLine).join('\r\n') + '\r\n');
  }

  function bind() {
    const drop = $('#issuedDrop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) read(f).catch(err => toast('読めませんでした：' + err.message));
    });
    $('#issuedFile').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) read(f).catch(err => toast('読めませんでした：' + err.message));
      e.target.value = '';
    });
    $('#issuedBody').addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'batchSel') { st.batchSel = Number(t.value); render(); }
      if (t.dataset.pick != null) { st.pick[t.dataset.pick] = t.checked; render(); }
    });
    $('#issuedBody').addEventListener('click', e => {
      if (e.target.id === 'retXlsx') saveXlsx();
      if (e.target.id === 'retCsv') saveCsv();
    });
  }

  return {bind, read, saveBatch, importAccounts, accounts, get state() { return st; }, selected, outRows};
})();
