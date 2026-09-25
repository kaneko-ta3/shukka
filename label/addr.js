/* =============================================================
 *  住所と〒の照合
 *
 *  data/ に県ごとの郵便番号データ（日本郵便の公開データを分けたもの）が置いてあり、
 *  貼った住所に出てくる県の分だけを読みます。
 *    index.json … 都道府県名、〒の頭3桁→県、市区町村の一覧
 *    pNN.json   … 県NNの住所の〒   {市区町村: [[〒, 町域, 注記], ...]}
 *    bNN.json   … 県NNの事業所の〒 {市区町村: [[〒, 町域, 番地, 名称], ...]}
 *
 *  照合は2方向です。
 *    〒 → 町域   … その〒の町名が住所の文字列に入っているか
 *    住所 → 〒   … 住所の市区町村＋町名から、正しい〒を引く
 *  基本は住所の文字列が正しいものとして扱い、ずれていたら両方を出して人に選んでもらいます。
 * ============================================================= */

const Addr = (() => {
  const BASE = 'data/';
  let index = null;
  let cityIdx = null;           // 県コード -> [{key, cities:[市区町村名]}]（長い順）
  const files = {};

  const PREF_RE = /^(北海道|東京都|京都府|大阪府|.{2,3}県)/;

  async function loadIndex() {
    if (index) return index;
    const r = await fetch(BASE + 'index.json', {cache: 'force-cache'});
    if (!r.ok) throw new Error('郵便番号データが読めません（' + r.status + '）');
    index = await r.json();
    buildCityIdx_();
    return index;
  }

  function loadFile_(kind, pc) {
    const k = kind + String(pc).padStart(2, '0');
    if (!(k in files)) {
      files[k] = fetch(BASE + k + '.json', {cache: 'force-cache'})
        .then(r => r.ok ? r.json() : (kind === 'b' ? {} : null))
        .catch(() => null);
    }
    return files[k];
  }

  /* 市区町村の一覧に、住所で省かれがちな書き方も足しておきます
       西多摩郡奥多摩町 … 「奥多摩町」でも当てる
       横浜市都筑区     … 「横浜市」だけ（区なし）でも、全部の区を候補にする */
  function buildCityIdx_() {
    cityIdx = {};
    const add = (pc, name, city) => {
      const list = cityIdx[pc] || (cityIdx[pc] = {});
      const k = key(name);
      (list[k] || (list[k] = {key: k, cities: []})).cities.push(city);
    };
    index.cities.forEach(([pc, city]) => {
      add(pc, city, city);
      const g = city.match(/^(.+?郡)(.+[町村])$/);
      if (g) add(pc, g[2], city);
      const w = city.match(/^(.+?市)(.+区)$/);
      if (w) add(pc, w[1], city);
    });
    Object.keys(cityIdx).forEach(pc => {
      cityIdx[pc] = Object.values(cityIdx[pc]).sort((a, b) => b.key.length - a.key.length);
    });
  }

  /* 見比べ用の文字列。表記ゆれ（全角半角・ヶケ・之ノ・漢数字）をならします */
  const KNUM = {'〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9};
  const KUNIT = {'十': 10, '百': 100, '千': 1000};
  function kanjiNum_(s) {
    if (!/[十百千]/.test(s)) return s.split('').map(c => KNUM[c]).join('');
    let total = 0, cur = 0;
    for (const c of s) {
      if (c in KUNIT) { total += (cur || 1) * KUNIT[c]; cur = 0; }
      else cur = cur * 10 + KNUM[c];
    }
    return String(total + cur);
  }
  function key(s) {
    return String(s == null ? '' : s).normalize('NFKC')
      .replace(/\s+/g, '')
      .replace(/[ヶヵケが]/g, 'ケ')
      .replace(/[之の]/g, 'ノ')
      .replace(/[‐‑‒–—―−－]/g, '-')
      .replace(/[〇一二三四五六七八九十百千]+/g, kanjiNum_);
  }

  function digits7(z) {
    const d = String(z == null ? '' : z).normalize('NFKC').replace(/[^0-9]/g, '');
    return d.length === 7 ? d : '';
  }
  function fmtZip(z) { return z ? z.slice(0, 3) + '-' + z.slice(3) : ''; }

  function uniq(a) { return Array.from(new Set(a)); }

  /* 住所の頭から市区町村を当てます。いちばん長く一致したものを採ります */
  function matchCity_(pcs, aKey, prefer) {
    let best = null, tie = false;
    pcs.forEach(pc => {
      const list = cityIdx[pc] || [];
      for (const c of list) {
        if (!c.key || !aKey.startsWith(c.key)) continue;
        if (!best || c.key.length > best.len) { best = {pc, cities: c.cities, len: c.key.length}; tie = false; }
        else if (c.key.length === best.len && pc !== best.pc) {
          /* 同じ名前の市が別の県にもある（府中市など）。〒の県を優先します */
          if (prefer.includes(pc) && !prefer.includes(best.pc)) best = {pc, cities: c.cities, len: c.key.length};
          else if (prefer.includes(pc) === prefer.includes(best.pc)) tie = true;
        }
        break;                  // 長い順に並んでいるので、この県はこれで決まり
      }
    });
    if (best && tie) return {ambiguous: true};
    return best;
  }

  function label_(pc, city, town, note) {
    return index.prefs[pc - 1] + city + (town || '') + (note ? '（' + note + '）' : '');
  }

  /**
   * 1行ぶんを照合します。
   * 戻り値
   *   status   ok / mismatch（〒と住所がずれている）/ nozip（〒が無い）/ unknown（住所が読めない）
   *   addr     都道府県を補ったあとの住所（補っていなければ元のまま）
   *   added    補った文字（'大阪府' など）。補っていなければ ''
   *   byZip    その〒が指している場所の説明
   *   byAddr   住所から引いた〒の候補 [{zip, label}]
   *   biz      事業所の〒だった場合の名称
   */
  async function check(zipRaw, addrRaw) {
    await loadIndex();
    const zip = digits7(zipRaw);
    const a = String(addrRaw == null ? '' : addrRaw).trim();
    const res = {status: '', addr: a, added: '', byZip: '', byAddr: [], biz: '', msg: ''};
    if (!a) { res.status = 'unknown'; res.msg = '住所が空です'; return res; }

    /* 〒の側。頭3桁の県のファイルを見て、無ければ事業所の〒を見ます */
    const zpcs = zip ? (index.zip3[zip.slice(0, 3)] || []) : [];
    const zipHits = [], bizHits = [];
    for (const pc of zpcs) {
      const p = await loadFile_('p', pc);
      if (p === null) { res.status = 'nodata'; res.msg = '郵便番号データが読めませんでした'; return res; }
      for (const city in p) p[city].forEach(r => { if (r[0] === zip) zipHits.push({pc, city, town: r[1], note: r[2] || ''}); });
    }
    if (zip && !zipHits.length) {
      for (const pc of zpcs) {
        const b = await loadFile_('b', pc) || {};
        for (const city in b) b[city].forEach(r => { if (r[0] === zip) bizHits.push({pc, city, town: r[1], banchi: r[2], name: r[3]}); });
      }
    }
    if (zipHits.length) res.byZip = uniq(zipHits.map(h => label_(h.pc, h.city, h.town))).join(' ／ ');
    else if (bizHits.length) res.byZip = label_(bizHits[0].pc, bizHits[0].city, bizHits[0].town + bizHits[0].banchi) + '（' + bizHits[0].name + '）';
    else if (zip) res.byZip = 'この〒は郵便番号データにありません';

    /* 住所の側。都道府県 → 市区町村 → 町名 の順に当てます */
    const aN = a.normalize('NFKC');
    const m = aN.match(PREF_RE);
    let pc = (m && index.prefs.indexOf(m[1]) >= 0) ? index.prefs.indexOf(m[1]) + 1 : 0;
    const aKey = key(pc ? aN.slice(m[1].length) : aN);
    const prefer = uniq(zpcs.concat(zipHits.map(h => h.pc)));

    let hit = matchCity_(pc ? [pc] : prefer, aKey, prefer);
    /* 県も市も抜けていて「北区梅田…」「上大崎…」から始まる場合は、〒の市区町村で補います。
       全国から探すより先にやります（「北区」は東京にもあるので） */
    if (!pc && (!hit || hit.ambiguous) && zipHits.length) {
      const h = zipHits[0];
      const ward = (h.city.match(/^.+?[市郡](.+[区町村])$/) || [])[1];
      if (ward && aKey.startsWith(key(ward))) hit = {pc: h.pc, cities: [h.city], len: key(ward).length, insert: h.city.slice(0, h.city.length - ward.length)};
      else if (h.town && aKey.startsWith(key(h.town))) hit = {pc: h.pc, cities: [h.city], len: 0, insert: h.city};
    }
    if (!pc && !hit) {
      const all = [];
      for (let i = 1; i <= 47; i++) all.push(i);
      hit = matchCity_(all, aKey, prefer);
    }
    if (!hit || hit.ambiguous) {
      res.status = 'unknown';
      res.msg = hit && hit.ambiguous ? '同じ名前の市区町村が複数の県にあり、県が決められません'
              : (pc ? '市区町村が読み取れません' : '都道府県と市区町村が読み取れません');
      return res;
    }
    if (!pc) {
      pc = hit.pc;
      res.added = index.prefs[pc - 1] + (hit.insert || '');
      res.addr = res.added + a;
    }

    const rest = aKey.slice(hit.len).replace(/^(大字|字)/, '');
    const p = await loadFile_('p', pc);
    if (p === null) { res.status = 'nodata'; res.msg = '郵便番号データが読めませんでした'; return res; }
    const entries = [];
    hit.cities.forEach(c => (p[c] || []).forEach(r => entries.push({city: c, zip: r[0], town: r[1], note: r[2] || ''})));

    let best = [], bestLen = 0;
    const take = (e, k) => {
      if (k.length > bestLen) { best = [e]; bestLen = k.length; }
      else if (k.length === bestLen) best.push(e);
    };
    entries.forEach(e => { const k = key(e.town); if (k && rest.startsWith(k)) take(e, k); });
    /* 京都は「烏丸通三条上る〇〇町」のように通り名が先に来るので、途中に町名があれば当てます */
    if (!best.length && /^京都市/.test(hit.cities[0])) {
      entries.forEach(e => { const k = key(e.town); if (k && k.length >= 2 && rest.indexOf(k) >= 0) take(e, k); });
    }
    const townKnown = best.length > 0;
    if (!townKnown) best = entries.filter(e => !e.town);

    const zipsA = uniq(best.map(e => e.zip));
    let ok = !!zip && zipsA.includes(zip);
    /* ビルごとの〒（西新宿〇〇ビル（1階）など）。町名がその〒の町域の頭と合えばよしとします */
    if (!ok && zip && townKnown && zipHits.length) {
      ok = zipHits.some(h => hit.cities.includes(h.city) && best.some(e => key(h.town).startsWith(key(e.town))));
    }
    /* 会社専用の〒。市区町村と町名が合えばよしとします */
    if (!ok && zip && bizHits.length) {
      const bh = bizHits.find(h => hit.cities.includes(h.city) && (!h.town || rest.startsWith(key(h.town))));
      if (bh) { ok = true; res.biz = bh.name; }
    }
    /* 町名がデータに無い地域（「以下に掲載がない場合」の〒）。市区町村が合えばよしとします */
    if (!ok && zip && !townKnown && zipHits.length) {
      ok = zipHits.some(h => hit.cities.includes(h.city) && !h.town);
    }

    res.byAddr = zipsA.slice(0, 4).map(z => {
      const es = best.filter(e => e.zip === z);
      return {zip: z, label: label_(pc, es[0].city, es[0].town, es.map(e => e.note).filter(Boolean).join('、'))};
    });
    if (ok) res.status = 'ok';
    else if (!zip) res.status = 'nozip';
    else res.status = 'mismatch';
    if (!ok && !townKnown) res.msg = '町名が郵便番号データに見つかりません';
    return res;
  }

  function prefOf(addr) {
    const m = String(addr || '').normalize('NFKC').match(PREF_RE);
    return m ? m[1] : '';
  }

  return {loadIndex, check, digits7, fmtZip, prefOf, key, get ver() { return index ? index.ver : ''; }};
})();
