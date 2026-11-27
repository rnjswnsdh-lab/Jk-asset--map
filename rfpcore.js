/* =========================================================================
   Open AI Asset Bridge — rfpcore.js  (📑 RFP 발주 · 자문사 포털 공통 코어, 2026-11-27)
   -------------------------------------------------------------------------
   📑 RFP(의뢰인) 와 🤝 자문사 포털 두 탭이 함께 쓰는 저장·파싱·문서·권한 계층입니다.

   저장 경로
     ① Google Apps Script  GET ?type=rfp  →  { ok:true, data:{rfps,submissions,…} }
        POST { action:'rfp_save'|'rfp_delete', entity:'rfps', item:{…} }
        (서버 코드는 docs/RFP_서버_패치.md 참고 — 아직 배포 전이면 자동으로 ②로 동작)
     ② 브라우저 localStorage  `nai-map:rfp:v1`  (로컬 모드 · 화면에 표시)

   자문사·매수자·금융기관 접근 범위는 이 파일의 visible* 함수에서 데이터를
   꺼내는 단계에서 자릅니다(화면 숨김 이전에 데이터 자체를 주지 않음).
   서버가 붙으면 같은 규칙을 서버가 판정해야 합니다 — docs/RFP_서버_패치.md 참조.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var PREFIX = CFG.STORAGE_PREFIX || 'nai-map';
  var LS_KEY = PREFIX + ':rfp:v1';
  var SESSION_KEY = PREFIX + ':rfp:portal:v1';
  var TOKEN_KEY = PREFIX + ':token:v1';

  var COLLECTIONS = ['works', 'docs', 'rfps', 'advisors', 'submissions', 'scores',
    'codes', 'access', 'ca', 'marketing', 'notices', 'buyers', 'bidSubs', 'lenders', 'loiconf'];

  var DOC_KINDS = [
    { k: 'rentroll', label: '렌트롤 (Rent Roll)', icon: '🏢', note: '임차인·면적·임대료·만기 표' },
    { k: 'opex', label: '오펙스 (OpEx)', icon: '🧾', note: '운영비 항목·연간 금액' },
    { k: 'pm', label: 'PM 월간 리포트', icon: '📅', note: '매달 받는 PM 리포트 파일' },
    { k: 'etc', label: '기타 자료', icon: '📎', note: '도면·감정평가서·등기 등' }
  ];

  var DEFAULT_CRITERIA = [
    { key: 'fee', label: '수수료(성공보수·고정)', weight: 20 },
    { key: 'price', label: '예상 매각가', weight: 25 },
    { key: 'period', label: '예상 매각 기간', weight: 10 },
    { key: 'track', label: '유사 실적', weight: 15 },
    { key: 'access', label: '투자자 접근력', weight: 15 },
    { key: 'team', label: '인력 구성', weight: 5 },
    { key: 'sched', label: '일정', weight: 5 },
    { key: 'extra', label: '추가 서비스', weight: 5 }
  ];

  var DEFAULT_DOCS = [
    '제안서(회사·인력 소개 포함)', '수수료 제안서(성공보수·고정)', '예상 매각가·기간 제안',
    '유사 실적 3건 이상', '투자자 접근 계획', 'NDA 서명본', '사업자등록증·법인등기부등본'
  ];

  var MAX_FILE = 900 * 1024;   /* localStorage 보관 상한(파일 1건). 초과분은 세션에서만 파싱 */

  var _db = null;
  var SYNC = { mode: 'local', checked: false };
  var API_TOKEN = null;   /* 승인 코드 로그인으로 발급받은 서버 토큰(메모리만) */

  /* ─────────────────────────── 기본 유틸 ─────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function num(v, d) {
    var x = Number(String(v == null ? '' : v).replace(/[, \uC6D0\uC5B5]/g, ''));
    return isFinite(x) ? x : (d === undefined ? 0 : d);
  }
  function n0(v, d) {
    var x = Number(v);
    if (!isFinite(x)) return '-';
    return x.toLocaleString('ko-KR', { maximumFractionDigits: d === undefined ? 1 : d });
  }
  function uid(p) { return (p || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function today() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function addDays(iso, n) {
    var d = iso ? new Date(iso + 'T00:00:00') : new Date();
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function daysLeft(iso) {
    if (!iso) return null;
    var t = Date.parse(iso.length <= 10 ? iso + 'T23:59:59' : iso);
    if (isNaN(t)) return null;
    return Math.ceil((t - Date.now()) / 86400000);
  }
  function when(iso) { return String(iso || '').replace('T', ' ').slice(0, 16); }
  function bytes(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
    if (n >= 1024) return Math.round(n / 1024) + 'KB';
    return n + 'B';
  }
  function toast(m, err) {
    if (window.naiToast) { try { window.naiToast(m, !!err); return; } catch (e) { /* noop */ } }
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = m;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3200);
  }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function me() { return (window.naiMap && window.naiMap.me) ? window.naiMap.me() : null; }
  function isAdmin() { return role() === 'admin'; }
  function canClient() { var r = role(); return r === 'admin' || r === 'internal'; }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  /* 코드 세션이면 코드 토큰을, 아니면 앱 접속 토큰을 씁니다(RFP API 전용). */
  function apiToken() { return API_TOKEN || token(); }

  /* ─────────────────────────── 저장 계층 ─────────────────────────── */
  function blank() {
    var o = { v: 1, schema: 'rfp-2026-11-27' };
    COLLECTIONS.forEach(function (c) { o[c] = []; });
    return o;
  }
  function normalize(o) {
    var b = blank();
    if (!o || typeof o !== 'object') return b;
    COLLECTIONS.forEach(function (c) { if (Array.isArray(o[c])) b[c] = o[c]; });
    return b;
  }
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* noop */ }
    return blank();
  }
  function db() { if (!_db) _db = load(); return _db; }
  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(db()));
      return true;
    } catch (e) {
      toast('브라우저 저장 공간이 부족해 저장하지 못했습니다. 첨부 파일을 줄이거나 JSON으로 내려받아 주세요.', true);
      return false;
    }
  }
  function list(entity) { return db()[entity] || (db()[entity] = []); }
  function byId(entity, id) {
    if (!id) return null;
    var a = list(entity);
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }
  function commit(entity, item) {
    if (!item.id) item.id = uid(entity.slice(0, 3));
    var a = list(entity), i = -1;
    for (var k = 0; k < a.length; k++) if (a[k].id === item.id) { i = k; break; }
    item.updated_at = new Date().toISOString();
    if (i >= 0) a[i] = item; else a.push(item);
    persist();
    pushServer(entity, item);
    return item;
  }
  function drop(entity, id) {
    var a = list(entity), out = [];
    a.forEach(function (x) { if (x.id !== id) out.push(x); });
    db()[entity] = out;
    persist();
    pushServer(entity, { id: id, _deleted: true });
  }

  function apiGet(type, extra) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var qs = 'type=' + encodeURIComponent(type) + (extra || '') + '&token=' + encodeURIComponent(apiToken());
    return fetch(base + (base.indexOf('?') < 0 ? '?' : '&') + qs, { cache: 'no-store' })
      .then(function (r) { return r.json(); });
  }
  function apiPost(payload) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var body = {};
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k];
    body.token = apiToken();
    return fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }
  function pushServer(entity, item) {
    if (SYNC.mode !== 'server') return;
    var action = item && item._deleted ? 'rfp_delete' : 'rfp_save';
    apiPost({ action: action, entity: entity, item: item }).then(function (j) {
      if (!j || !j.ok) SYNC.mode = 'local';
    }).catch(function () { SYNC.mode = 'local'; });
  }
  /* 서버에 RFP API 가 있으면 그 데이터를 합칩니다(같은 id 는 최신 updated_at 우선). */
  function mergeRemote(remote) {
    var d = db();
    COLLECTIONS.forEach(function (c) {
      var inc = remote && Array.isArray(remote[c]) ? remote[c] : null;
      if (!inc) return;
      var map = {};
      (d[c] || []).forEach(function (x) { map[x.id] = x; });
      inc.forEach(function (x) {
        if (!x || !x.id) return;
        var cur = map[x.id];
        if (!cur || String(x.updated_at || '') > String(cur.updated_at || '')) map[x.id] = x;
      });
      d[c] = Object.keys(map).map(function (k) { return map[k]; });
    });
    persist();
  }
  function pullServer() {
    if (SYNC.checked) return Promise.resolve(SYNC.mode);
    SYNC.checked = true;
    if (!CFG.SYNC_URL || !apiToken()) return Promise.resolve(SYNC.mode);
    return apiGet('rfp').then(function (j) {
      if (j && j.ok && j.data && typeof j.data === 'object') {
        mergeRemote(j.data);
        SYNC.mode = 'server';
      }
      return SYNC.mode;
    }).catch(function () { return SYNC.mode; });
  }

  /* ─────────────────────────── 물건·자료 ─────────────────────────── */
  function assets() {
    var st = window.naiMap && window.naiMap.state;
    var base = (st && st.base) || [];
    return base.map(function (a) {
      return { id: String(a.id || ''), name: a.name || '', address: a.address || '', sector: a.sector || '', price_info: a.price_info || '' };
    });
  }
  function assetOf(id) {
    var all = assets();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function workOf(assetId) {
    var a = list('works');
    for (var i = 0; i < a.length; i++) if (a[i].id === assetId) return a[i];
    return null;
  }
  function pinAsset(assetId) {
    if (!assetId || workOf(assetId)) return workOf(assetId);
    var a = assetOf(assetId) || {};
    return commit('works', {
      id: assetId, asset_id: assetId, name: a.name || '', address: a.address || '',
      sector: a.sector || '', price_info: a.price_info || '', at: new Date().toISOString()
    });
  }
  function works() { return list('works').slice().sort(function (a, b) { return String(b.updated_at || b.at || '').localeCompare(String(a.updated_at || a.at || '')); }); }
  function docsOf(assetId) {
    return list('docs').filter(function (d) { return d.asset_id === assetId; })
      .sort(function (a, b) { return String(b.month || b.at || '').localeCompare(String(a.month || a.at || '')); });
  }
  function latestDoc(assetId, kind) {
    var a = docsOf(assetId).filter(function (d) { return d.kind === kind; });
    return a[0] || null;
  }

  /* ─────────────────────────── 파일 읽기 · 표 파싱 ─────────────────────────── */
  function parseDelimited(text) {
    text = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    if (!text.trim()) return [];
    var firstLine = text.split(/\r\n|\n|\r/)[0] || '';
    var tabs = (firstLine.match(/\t/g) || []).length;
    var commas = (firstLine.match(/,/g) || []).length;
    var semis = (firstLine.match(/;/g) || []).length;
    var d = tabs > 0 && tabs >= commas ? '\t' : (semis > commas ? ';' : ',');
    var rows = [], cur = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { cur.push(cell); cell = ''; }
      else if (ch === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = ''; }
      else if (ch === '\r') { /* skip */ }
      else cell += ch;
    }
    if (cell !== '' || cur.length) { cur.push(cell); rows.push(cur); }
    return rows.map(function (r) { return r.map(function (c) { return String(c).trim(); }); })
      .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  }
  function cleanRows(rows) {
    return (rows || []).map(function (r) { return (r || []).map(function (c) { return String(c == null ? '' : c).trim(); }); })
      .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  }
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var name = file.name || 'file';
      var size = file.size || 0;
      var mime = file.type || '';
      if (/\.(csv|tsv|txt)$/i.test(name) || /^text\//.test(mime)) {
        var r = new FileReader();
        r.onload = function () {
          var t = String(r.result || '');
          resolve({ name: name, size: size, mime: mime || 'text/plain', text: t, dataUrl: '', rows: parseDelimited(t) });
        };
        r.onerror = function () { reject(new Error('read_error')); };
        r.readAsText(file, 'utf-8');
        return;
      }
      if (/\.xlsx?$/i.test(name)) {
        if (!window.XLSX) { reject(new Error('xlsx_lib')); return; }
        var r2 = new FileReader();
        r2.onload = function () {
          try {
            var wb = window.XLSX.read(new Uint8Array(r2.result), { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
            resolve({ name: name, size: size, mime: mime || 'application/vnd.ms-excel', text: '', dataUrl: '', rows: cleanRows(rows) });
          } catch (e) { reject(new Error('xlsx_parse')); }
        };
        r2.onerror = function () { reject(new Error('read_error')); };
        r2.readAsArrayBuffer(file);
        return;
      }
      if (size > MAX_FILE) { reject(new Error('too_large')); return; }
      var r3 = new FileReader();
      r3.onload = function () {
        resolve({ name: name, size: size, mime: mime || 'application/octet-stream', text: '', dataUrl: String(r3.result || ''), rows: [] });
      };
      r3.onerror = function () { reject(new Error('read_error')); };
      r3.readAsDataURL(file);
    });
  }
  function pickFiles(multiple) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = !!multiple;
      inp.style.position = 'fixed';
      inp.style.left = '-9999px';
      document.body.appendChild(inp);
      inp.addEventListener('change', function () {
        var files = Array.prototype.slice.call(inp.files || []);
        setTimeout(function () { inp.remove(); }, 0);
        resolve(files);
      });
      inp.click();
    });
  }

  /* ─────────────────────────── 정규화 요약 ─────────────────────────── */
  function colIndex(head, re, fallback) {
    for (var i = 0; i < head.length; i++) if (re.test(String(head[i] || ''))) return i;
    return fallback === undefined ? -1 : fallback;
  }
  function parseMonth(name) {
    var s = String(name || '');
    var m = s.match(/(20\d{2})\s*[.\-년/]?\s*(1[0-2]|0[1-9]|[1-9])(?!\d)\s*월?/);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2);
    return '';
  }
  function parseDateLoose(v) {
    var s = String(v || '').trim();
    if (!s) return null;
    var m = s.match(/(20\d{2})\s*[.\-\/년]?\s*(0?[1-9]|1[0-2])?\s*[.\-\/월]?\s*(0?[1-9]|[12]\d|3[01])?/);
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2] || 12), da = Number(m[3] || 0);
    if (!y) return null;
    if (!da) {
      var last = new Date(y, mo, 0).getDate();
      da = last;
    }
    return new Date(y, mo - 1, da);
  }
  function rentRollSummary(rows) {
    rows = cleanRows(rows);
    if (rows.length < 2) return null;
    var head = rows[0];
    var body = rows.slice(1);
    var ci = {
      floor: colIndex(head, /층|구역|호실|unit|floor/i, 0),
      tenant: colIndex(head, /임차인|입주사|tenant|상호|업체|이용/i, 1),
      area: colIndex(head, /면적|전용|area|㎡|m2|평/i, 2),
      rent: colIndex(head, /임대료|rent|월세|월 임대/i),
      deposit: colIndex(head, /보증금|deposit/i),
      exp: colIndex(head, /만기|expir|종료|계약기간/i),
      note: colIndex(head, /비고|note|용도|업종/i)
    };
    var areaHead = String(head[ci.area] || '');
    var areaUnit = /㎡|m2|m²|제곱/i.test(areaHead) ? 'sqm' : 'py';
    var rentHead = String(head[ci.rent] || '');
    var rentPerPy = /평/.test(rentHead) && !/합계|총/i.test(rentHead);
    var items = [];
    body.forEach(function (r) {
      var tenant = String(r[ci.tenant] || '').trim();
      var areaRaw = num(r[ci.area]);
      if (!tenant && !areaRaw) return;
      var areaPy = areaUnit === 'sqm' ? areaRaw / 3.3058 : areaRaw;
      var rentRaw = ci.rent >= 0 ? num(r[ci.rent]) : 0;
      var rentMonth = rentPerPy ? rentRaw * areaPy : rentRaw;
      var exp = ci.exp >= 0 ? String(r[ci.exp] || '').trim() : '';
      var vacant = /공실|vacant|빈실|미임차|비어/i.test(tenant) || (!tenant && areaPy > 0);
      items.push({
        floor: String(r[ci.floor] || ''), tenant: tenant || '(공실)', area_py: areaPy,
        rent_month: vacant ? 0 : rentMonth, rent_raw: rentRaw, exp: exp,
        deposit: ci.deposit >= 0 ? String(r[ci.deposit] || '') : '',
        note: ci.note >= 0 ? String(r[ci.note] || '') : '', vacant: vacant
      });
    });
    if (!items.length) return null;
    var totalArea = 0, vacantArea = 0, rentSum = 0, wsum = 0, wale = 0;
    var now = Date.now();
    items.forEach(function (it) {
      totalArea += it.area_py;
      if (it.vacant) vacantArea += it.area_py;
      else rentSum += it.rent_month;
      var d = parseDateLoose(it.exp);
      if (d && !it.vacant) {
        var yrs = Math.max(0, (d.getTime() - now) / (365.25 * 86400000));
        var w = it.rent_month > 0 ? it.rent_month : it.area_py;
        wsum += w; wale += yrs * w;
      }
    });
    var leased = totalArea - vacantArea;
    return {
      items: items, cols: { floor: head[ci.floor], tenant: head[ci.tenant], area: head[ci.area], rent: head[ci.rent], exp: head[ci.exp], note: ci.note >= 0 ? head[ci.note] : '' },
      tenantCount: items.filter(function (x) { return !x.vacant; }).length,
      totalArea: totalArea, leasedArea: leased, vacantArea: vacantArea,
      vacancyRate: totalArea > 0 ? (vacantArea / totalArea * 100) : 0,
      monthlyRent: rentSum, annualRent: rentSum * 12,
      avgRentPerPy: leased > 0 ? rentSum / leased : 0,
      wale: wsum > 0 ? wale / wsum : null,
      areaUnit: areaUnit, rentPerPy: rentPerPy
    };
  }
  function opexSummary(rows, areaPy) {
    rows = cleanRows(rows);
    if (rows.length < 2) return null;
    var head = rows[0];
    var ci = {
      item: colIndex(head, /항목|비목|item|expense|내역/i, 0),
      amount: colIndex(head, /금액|amount|비용|원|억|단가/i, 1),
      note: colIndex(head, /비고|note|단가/i)
    };
    var headUnit = String(head[ci.amount] || '') + ' ' + String(head.join(' '));
    var mult = /억/.test(String(head[ci.amount] || '')) ? 1e8 : (/천원/.test(String(head[ci.amount] || '')) ? 1e3 : 1);
    var items = [], total = 0;
    rows.slice(1).forEach(function (r) {
      var label = String(r[ci.item] || '').trim();
      var amt = num(r[ci.amount]);
      if (!label && !amt) return;
      var won = amt * mult;
      items.push({ label: label, amount_won: won, raw: String(r[ci.amount] || ''), note: ci.note >= 0 ? String(r[ci.note] || '') : '' });
      total += won;
    });
    if (!items.length) return null;
    items.sort(function (a, b) { return b.amount_won - a.amount_won; });
    return {
      items: items, total: total, count: items.length,
      perPy: areaPy > 0 ? total / areaPy : 0, unit: mult === 1e8 ? '억원' : (mult === 1e3 ? '천원' : '원'),
      top: items.slice(0, 5), headUnit: headUnit.trim()
    };
  }
  function assetBrief(assetId) {
    var rr = latestDoc(assetId, 'rentroll');
    var ox = latestDoc(assetId, 'opex');
    var pms = docsOf(assetId).filter(function (d) { return d.kind === 'pm'; });
    var rs = rr && rr.summary ? rr.summary : null;
    var os = ox && ox.summary ? ox.summary : null;
    var a = assetOf(assetId) || (workOf(assetId) || {});
    return {
      rental: rs, opex: os, pm: pms, asset: a,
      pmLatest: pms[0] || null,
      missing: [!rr && '렌트롤', !ox && '오펙스', !pms.length && 'PM 리포트'].filter(Boolean)
    };
  }

  /* ─────────────────────────── RFP 문서 ─────────────────────────── */
  function defaultCriteria() { return DEFAULT_CRITERIA.map(function (c) { return { key: c.key, label: c.label, weight: c.weight }; }); }
  function rfpOf(id) { return byId('rfps', id); }
  function rfpsOf(assetId) {
    return list('rfps').filter(function (r) { return !assetId || r.asset_id === assetId; })
      .sort(function (a, b) { return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });
  }
  function newRfp(assetId) {
    var b = assetBrief(assetId);
    var a = b.asset || {};
    var rs = b.rental, os = b.opex;
    var price = String(a.price_info || '').replace(/[^0-9.]/g, '');
    var lines = [];
    lines.push('소재지: ' + (a.address || '미정'));
    if (rs) {
      lines.push('임차 현황: 임차인 ' + rs.tenantCount + '명 · 임대면적 ' + n0(rs.leasedArea) + '평 · 공실률 ' + n0(rs.vacancyRate) + '%');
      lines.push('월 임대료: ' + n0(rs.monthlyRent, 0) + '원 (연 ' + n0(rs.annualRent, 0) + '원) · 평균 ' + n0(rs.avgRentPerPy, 0) + '원/평·월');
      if (rs.wale != null) lines.push('WALE: ' + rs.wale.toFixed(1) + '년 (임대료 가중)');
    } else lines.push('임차 현황: 렌트롤 미등록 — 자료 업로드 후 자동 반영됩니다.');
    if (os) lines.push('오펙스: 연 ' + n0(os.total, 0) + '원' + (os.perPy ? ' (평당 ' + n0(os.perPy, 0) + '원)' : ''));
    if (b.pmLatest) lines.push('PM 리포트: 최근 ' + (b.pmLatest.month || when(b.pmLatest.at).slice(0, 7)) + ' (' + b.pm.length + '건 보관)');
    return {
      id: '', asset_id: assetId, asset_name: a.name || '', client: (me() && me().company) || 'NAI Korea',
      title: (a.name || '물건') + ' 매각 자문 RFP',
      issue_date: today(), due_date: addDays(today(), 14),
      status: '작성', guide_eok: price || '',
      overview: lines.join('\n'),
      scope: '매각 자문 일체 — ① 마케팅 리스트 작성 및 배포 ② TM/IM 제작 지원 ③ VDR 운영(렌트롤·오펙스·PM 리포트)\n' +
        '④ 매수자 CA 체결·실사 조율 ⑤ 입찰·LOI/LOC 접수 및 금융기관 검증 지원 ⑥ 우선협상·계약·종결 지원',
      schedule: 'RFP 배포 D+0 → 제안 마감 D+14 → 자문사 선정 D+21 → TM/IM 완성 D+35 → LOI 마감 D+49 → 최종 입찰 D+63 → 협상·종결 D+90',
      docs: DEFAULT_DOCS.slice(),
      criteria: defaultCriteria(),
      nda: '제안 단계에서 NDA 체결 필수. 자료는 VDR을 통해서만 제공하며, 매수자에게는 CA 체결 후 공개 범위 내에서만 열람을 허용합니다.',
      note: '', invites: [], selected_advisor_id: '', created_at: new Date().toISOString()
    };
  }
  function criterionWeightTotal(criteria) {
    var t = 0;
    (criteria || []).forEach(function (c) { t += num(c.weight); });
    return t || 1;
  }
  function rfpHTML(rfp, opts) {
    opts = opts || {};
    var b = assetBrief(rfp.asset_id);
    var a = b.asset || {};
    var h = '';
    h += '<div class="rfp-doc">';
    h += '<div class="rfp-doc-head"><span class="rfp-doc-kicker">REQUEST FOR PROPOSAL · 매각 자문</span>' +
      '<h1>' + esc(rfp.title) + '</h1>' +
      '<p>' + esc([rfp.client, '발주일 ' + (rfp.issue_date || '-'), '제출 마감 ' + (rfp.due_date || '-')].join(' · ')) + '</p></div>';
    h += '<table class="rfp-doc-meta"><tbody>' +
      '<tr><th>대상 물건</th><td>' + esc(rfp.asset_name || '-') + (a.address ? ' (' + esc(a.address) + ')' : '') + '</td>' +
      '<th>가격 가이던스</th><td>' + (rfp.guide_eok ? esc(n0(rfp.guide_eok, 0) + '억원') : '미제시') + '</td></tr>' +
      '<tr><th>의뢰인</th><td>' + esc(rfp.client || '-') + '</td><th>상태</th><td>' + esc(rfp.status || '작성') + '</td></tr>' +
      '</tbody></table>';
    h += '<section><h3>1. 물건 개요</h3><div class="rfp-pre">' + esc(rfp.overview || '') + '</div></section>';
    h += '<section><h3>2. 업무 범위</h3><div class="rfp-pre">' + esc(rfp.scope || '') + '</div></section>';
    h += '<section><h3>3. 일정</h3><div class="rfp-pre">' + esc(rfp.schedule || '') + '</div></section>';
    h += '<section><h3>4. 제출 요구 서류</h3><ul class="rfp-doc-list">' +
      (rfp.docs || []).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
      '<p class="rfp-doc-note">모든 서류는 본 시스템의 제안 제출 화면에서 파일로 업로드합니다(마감 전까지 수정 가능).</p></section>';
    if (opts.criteria !== false) {
      h += '<section><h3>5. 평가 항목·가중치</h3><table class="rfp-doc-table"><thead><tr><th>평가 항목</th><th>가중치</th></tr></thead><tbody>' +
        (rfp.criteria || []).map(function (c) { return '<tr><td>' + esc(c.label) + '</td><td class="num">' + n0(c.weight, 0) + '</td></tr>'; }).join('') +
        '<tr class="sum"><td>합계</td><td class="num">' + n0(criterionWeightTotal(rfp.criteria), 0) + '</td></tr></tbody></table>' +
        '<p class="rfp-doc-note">항목별 100점 환산 점수 × 가중치로 총점을 산정합니다(의뢰인 내부 평가).</p></section>';
    }
    h += '<section><h3>6. NDA·CA 조건</h3><div class="rfp-pre">' + esc(rfp.nda || '') + '</div></section>';
    if (rfp.note) h += '<section><h3>7. 기타</h3><div class="rfp-pre">' + esc(rfp.note) + '</div></section>';
    if (opts.invites) {
      var inv = rfp.invites || [];
      h += '<section><h3>배포 기록</h3>' + (inv.length
        ? '<table class="rfp-doc-table"><thead><tr><th>자문사</th><th>승인 코드</th><th>발송</th><th>만료</th><th>열람</th></tr></thead><tbody>' +
          inv.map(function (x) {
            return '<tr><td>' + esc(x.company || '-') + '</td><td class="mono">' + esc(x.code || '-') + '</td><td>' +
              esc(when(x.at)) + '</td><td>' + esc(x.expires_at || '-') + '</td><td>' + (x.viewed_at ? esc(when(x.viewed_at)) : '미열람') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="rfp-doc-note">아직 배부하지 않았습니다.</p>') + '</section>';
    }
    h += '<p class="rfp-doc-foot">' + esc(rfp.client || '') + ' · Open AI Asset Bridge RFP · ' + esc(today()) + '</p>';
    h += '</div>';
    return h;
  }

  /* ─────────────────────────── 제안서 · 점수 ─────────────────────────── */
  function submissionsOf(rfpId) {
    return list('submissions').filter(function (s) { return s.rfp_id === rfpId; })
      .sort(function (a, b) { return String(b.updated_at || b.at || '').localeCompare(String(a.updated_at || a.at || '')); });
  }
  function submissionOf(rfpId, advisorId) {
    var a = submissionsOf(rfpId);
    for (var i = 0; i < a.length; i++) if (a[i].advisor_id === advisorId) return a[i];
    return null;
  }
  function scoreOf(rfpId, advisorId) {
    var a = list('scores');
    for (var i = 0; i < a.length; i++) if (a[i].rfp_id === rfpId && a[i].advisor_id === advisorId) return a[i];
    return null;
  }
  function autoScores(rfp, subs) {
    var out = {};
    var fees = subs.map(function (s) { return num(s.fee_success); }).filter(function (x) { return x > 0; });
    var prices = subs.map(function (s) { return num(s.price_expect); }).filter(function (x) { return x > 0; });
    var periods = subs.map(function (s) { return num(s.period_months); }).filter(function (x) { return x > 0; });
    var minFee = fees.length ? Math.min.apply(null, fees) : 0;
    var maxPrice = prices.length ? Math.max.apply(null, prices) : 0;
    var minPeriod = periods.length ? Math.min.apply(null, periods) : 0;
    subs.forEach(function (s) {
      var v = {};
      var fee = num(s.fee_success);
      v.fee = minFee > 0 && fee > 0 ? Math.max(0, Math.min(100, minFee / fee * 100)) : 60;
      var p = num(s.price_expect);
      v.price = maxPrice > 0 && p > 0 ? Math.max(0, Math.min(100, p / maxPrice * 100)) : 60;
      var m = num(s.period_months);
      v.period = minPeriod > 0 && m > 0 ? Math.max(0, Math.min(100, minPeriod / m * 100)) : 60;
      ['track', 'access', 'team', 'sched', 'extra'].forEach(function (k) { v[k] = 70; });
      out[s.advisor_id] = v;
    });
    return out;
  }
  function totalScore(rfp, values) {
    var w = 0, sum = 0;
    (rfp.criteria || []).forEach(function (c) {
      var v = num((values || {})[c.key]);
      var wt = num(c.weight);
      sum += v * wt; w += wt;
    });
    return w > 0 ? Math.round(sum / w) : 0;
  }
  function rankedScores(rfpId) {
    var rfp = rfpOf(rfpId);
    if (!rfp) return [];
    var subs = submissionsOf(rfpId);
    var rows = subs.map(function (s) {
      var sc = scoreOf(rfpId, s.advisor_id) || {};
      return { sub: s, score: sc, total: totalScore(rfp, sc.values || {}) };
    }).sort(function (a, b) { return b.total - a.total; });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }

  /* ─────────────────────────── 승인 코드 · 접근 ─────────────────────────── */
  function makeCode(prefix) {
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var s = '';
    for (var i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return (prefix || 'RFP') + '-' + s;
  }
  function codesOf(rfpId) { return list('codes').filter(function (c) { return !rfpId || c.rfp_id === rfpId; }); }
  function validCode(c) {
    if (!c) return false;
    if (String(c.status || '') === '종료') return false;
    if (c.expires_at) {
      var left = daysLeft(c.expires_at);
      if (left !== null && left < 0) return false;
    }
    return true;
  }
  function findCode(code) {
    var s = String(code || '').trim().toUpperCase();
    if (!s) return null;
    var a = list('codes');
    for (var i = 0; i < a.length; i++) if (String(a[i].code || '').toUpperCase() === s) return a[i];
    return null;
  }
  function issueCode(o) {
    var c = {
      id: uid('code'), rfp_id: o.rfp_id || '', holder_type: o.holder_type || '자문사',
      holder: o.holder || '', holder_id: o.holder_id || '', code: o.code || makeCode(o.holder_type === '매수자' ? 'BUY' : (o.holder_type === '금융기관' ? 'FI' : 'ADV')),
      scope: o.scope || ['rentroll', 'opex', 'pm', 'etc'],
      issued_at: new Date().toISOString(), expires_at: o.expires_at || addDays(today(), 30),
      status: '발급', note: o.note || ''
    };
    return commit('codes', c);
  }
  function logAccess(codeRec, doc, action) {
    if (!codeRec) return;
    commit('access', {
      id: uid('acc'), rfp_id: codeRec.rfp_id || '', code: codeRec.code,
      holder: codeRec.holder || '', holder_type: codeRec.holder_type || '',
      doc_id: (doc && doc.id) || '', doc_label: (doc && doc.name) || (doc && doc.label) || '',
      action: action || '열람', at: new Date().toISOString()
    });
  }
  function accessLogOf(rfpId) {
    return list('access').filter(function (a) { return !rfpId || a.rfp_id === rfpId; })
      .sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }

  /* ─────────────────────────── 포털 세션 · 가시 범위 ─────────────────────────── */
  function session() {
    try {
      var o = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (o && o.code) {
        var rec = findCode(o.code);
        if (validCode(rec)) return { code: rec.code, holder: rec.holder, holder_type: rec.holder_type, holder_id: rec.holder_id, rfp_id: rec.rfp_id, rec: rec };
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (e) { /* noop */ }
    return null;
  }
  function setSession(codeRec) {
    try {
      if (!codeRec) localStorage.removeItem(SESSION_KEY);
      else localStorage.setItem(SESSION_KEY, JSON.stringify({ code: codeRec.code, at: Date.now() }));
    } catch (e) { /* noop */ }
  }
  /* 서버가 있으면 코드를 서버 세션으로 교환합니다(없으면 로컬 모드). 서버는 이 토큰으로
     자문사·매수자·금융기관별 가시 범위를 판정해야 합니다 — docs/RFP_서버_패치.md 참조. */
  function codeLogin(codeStr) {
    if (!CFG.SYNC_URL) return Promise.resolve(null);
    return apiPost({ action: 'rfp_code_login', code: String(codeStr || '') }).then(function (j) {
      if (j && j.ok && j.token) { API_TOKEN = String(j.token); return j; }
      return null;
    }).catch(function () { return null; });
  }
  function clearApiToken() { API_TOKEN = null; }
  function isAdvisorSession(ss) { return !!(ss && ss.holder_type === '자문사'); }
  function visibleRfps(ss) {
    var all = list('rfps');
    if (!ss) return isAdmin() ? all : [];
    if (isAdvisorSession(ss)) {
      return all.filter(function (r) {
        if (String(r.selected_advisor_id || '') === String(ss.holder_id || '')) return true;
        return (r.invites || []).some(function (x) { return String(x.advisor_id || '') === String(ss.holder_id || ''); }) ||
          String(ss.rfp_id || '') === String(r.id);
      });
    }
    return all.filter(function (r) { return String(r.id) === String(ss.rfp_id || ''); });
  }
  /* 자문사는 자기 제안서만, 매수자·금융기관은 제안서를 아예 받지 않습니다. */
  function visibleSubmissions(rfpId, ss) {
    var all = submissionsOf(rfpId);
    if (!ss) return isAdmin() ? all : [];
    if (isAdvisorSession(ss)) return all.filter(function (s) { return String(s.advisor_id || '') === String(ss.holder_id || ''); });
    return [];
  }
  function visibleDocs(assetId, ss) {
    var all = docsOf(assetId);
    if (!ss) return all;
    if (isAdvisorSession(ss) || ss.holder_type === '매수자') {
      var sc = (ss.rec && ss.rec.scope) || [];
      return all.filter(function (d) { return sc.indexOf(d.kind) >= 0; });
    }
    return all;
  }

  /* ─────────────────────────── 투자자 풀 (FI/SI/화주) ─────────────────────────── */
  var INV = { rows: null, loading: false };
  function poolOf(kind) {
    var k = String(kind || '');
    if (k === 'shipper') return '화주';
    if (k === 'office_si') return 'SI';
    if (k === 'blind_fund' || k === 'reit_foreign' || k === 'pension_lp') return 'FI';
    if (/FI|블라인드|리츠|연기금/.test(k)) return 'FI';
    if (/화주|물류/.test(k)) return '화주';
    return 'SI';
  }
  function loadInvestors() {
    if (INV.rows) return Promise.resolve(INV.rows);
    if (window.NAI_POOL_ROWS && window.NAI_POOL_ROWS.length) { INV.rows = window.NAI_POOL_ROWS; return Promise.resolve(INV.rows); }
    return apiGet('investors').then(function (j) {
      INV.rows = (j && j.items) || [];
      return INV.rows;
    }).catch(function () { INV.rows = []; return INV.rows; });
  }

  /* ─────────────────────────── 화면 공통 ─────────────────────────── */
  function modal(title, bodyHTML, opts) {
    opts = opts || {};
    var host = document.getElementById('rfpModal');
    if (!host) { host = document.createElement('div'); host.id = 'rfpModal'; document.body.appendChild(host); }
    host.className = 'rfp-modal';
    host.innerHTML = '<div class="rfp-card' + (opts.wide ? ' wide' : '') + (opts.plain ? ' plain' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="rfp-card-head"><strong>' + esc(title) + '</strong><button type="button" class="rfp-x" data-rfp="close" aria-label="닫기">×</button></div>' +
      '<div class="rfp-card-body">' + bodyHTML + '</div>' +
      (opts.footer === false ? '' : '<div class="rfp-card-foot">' + (opts.footer ||
        '<button type="button" class="btn btn-ghost" data-rfp="close">닫기</button>') + '</div>') +
      '</div>';
    host.classList.remove('hidden');
    host.onclick = function (e) {
      if (e.target === host || (e.target.closest && e.target.closest('[data-rfp="close"]'))) closeModal();
    };
    return host;
  }
  function closeModal() {
    var m = document.getElementById('rfpModal');
    if (m) { m.classList.add('hidden'); m.innerHTML = ''; }
  }
  function fval(root, name) {
    var el = root.querySelector('[name="' + name + '"]');
    return el ? String(el.value == null ? '' : el.value).trim() : '';
  }
  function fcheck(root, name) {
    var el = root.querySelector('[name="' + name + '"]');
    return !!(el && el.checked);
  }
  function fgroup(root, name) {
    return Array.prototype.slice.call(root.querySelectorAll('[name="' + name + '"]')).map(function (el) { return el.value; });
  }
  function field(name, label, value, type, opts) {
    opts = opts || {};
    var cls = 'rfp-f' + (opts.wide ? ' wide' : '');
    var ph = opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '';
    var dis = opts.disabled ? ' disabled' : '';
    var inner;
    if (type === 'textarea') inner = '<textarea name="' + name + '" rows="' + (opts.rows || 3) + '"' + ph + dis + '>' + esc(value) + '</textarea>';
    else if (type === 'select') inner = '<select name="' + name + '"' + dis + '>' + (opts.options || []).map(function (o) {
      var v = typeof o === 'string' ? o : o.v, l = typeof o === 'string' ? o : o.l;
      return '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('') + '</select>';
    else inner = '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '"' + ph + dis + (opts.step ? ' step="' + opts.step + '"' : '') + '>';
    return '<label class="' + cls + '"><span>' + label + (opts.req ? ' <b>*</b>' : '') + '</span>' + inner +
      (opts.hint ? '<em>' + esc(opts.hint) + '</em>' : '') + '</label>';
  }
  function download(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 600);
  }
  function downloadFile(doc) {
    if (doc.dataUrl) {
      var a = document.createElement('a');
      a.href = doc.dataUrl; a.download = doc.name || 'file';
      document.body.appendChild(a); a.click();
      setTimeout(function () { a.remove(); }, 600);
      return true;
    }
    if (doc.text) { download(doc.name || 'file.csv', '\ufeff' + doc.text, 'text/csv;charset=utf-8'); return true; }
    return false;
  }
  function csv(name, header, rows) {
    var q = function (v) {
      var s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var body = '\ufeff' + header.map(q).join(',') + '\n' +
      rows.map(function (r) { return r.map(q).join(','); }).join('\n');
    download(name, body, 'text/csv;charset=utf-8');
  }
  function safeName(s) { return String(s || 'document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 70); }
  function printDoc(title, innerHTML) {
    var w = document.getElementById('rfpPrint');
    if (!w) { w = document.createElement('div'); w.id = 'rfpPrint'; document.body.appendChild(w); }
    w.innerHTML = '<div class="rfp-print-bar"><b>' + esc(title) + '</b>' +
      '<span class="rfp-print-tools"><button type="button" class="btn btn-primary" data-rfp="print-go">🖨 인쇄 / PDF 저장</button>' +
      '<button type="button" class="btn btn-ghost" data-rfp="print-close">닫기</button></span></div>' +
      '<div class="rfp-paper">' + innerHTML + '</div>';
    w.classList.remove('hidden');
    document.body.classList.add('rfp-printing');
    w.onclick = function (e) {
      if (e.target.closest('[data-rfp="print-go"]')) { try { window.print(); } catch (er) { /* noop */ } return; }
      if (e.target.closest('[data-rfp="print-close"]') || e.target === w) {
        w.classList.add('hidden'); w.innerHTML = '';
        document.body.classList.remove('rfp-printing');
      }
    };
  }
  function exportWord(title, innerHTML) {
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
      'body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;font-size:10.5pt;line-height:1.65;color:#16202e}' +
      'h1{font-size:16pt;margin:0 0 6pt}h3{font-size:11.5pt;margin:14pt 0 5pt;border-bottom:1px solid #dfe6ef;padding-bottom:3pt}' +
      'table{border-collapse:collapse;width:100%;margin:6pt 0}th,td{border:1px solid #b9c6d6;padding:4pt 5pt;font-size:9.5pt;vertical-align:top}' +
      'th{background:#eef2f7;text-align:left}.num{text-align:right}.rfp-pre{white-space:pre-wrap}.rfp-doc-foot{margin-top:16pt;color:#6b7c91;font-size:9pt}' +
      '.rfp-doc-kicker{font-size:9pt;letter-spacing:.12em;color:#0b6bcb;font-weight:bold}' +
      '</style></head><body>' + innerHTML + '</body></html>';
    download(safeName(title) + '.doc', '\ufeff' + html, 'application/msword;charset=utf-8');
  }

  /* ─────────────────────────── 내보내기 · 가져오기 ─────────────────────────── */
  function exportAll() {
    return JSON.stringify(db(), null, 1);
  }
  function importAll(text) {
    try {
      var o = JSON.parse(text);
      if (!o || typeof o !== 'object') throw new Error('bad');
      var next = normalize(o);
      var counts = 0;
      COLLECTIONS.forEach(function (c) { counts += next[c].length; });
      if (!counts && !window.confirm('가져온 파일에 항목이 없습니다. 그래도 바꿀까요?')) return false;
      _db = next;
      persist();
      return true;
    } catch (e) { return false; }
  }

  window.NAI_RFPC = {
    DOC_KINDS: DOC_KINDS, DEFAULT_CRITERIA: DEFAULT_CRITERIA, DEFAULT_DOCS: DEFAULT_DOCS, MAX_FILE: MAX_FILE,
    SYNC: SYNC,
    esc: esc, num: num, n0: n0, uid: uid, today: today, addDays: addDays, daysLeft: daysLeft, when: when, bytes: bytes,
    toast: toast, role: role, me: me, isAdmin: isAdmin, canClient: canClient,
    db: db, list: list, byId: byId, commit: commit, drop: drop, persist: persist, pullServer: pullServer,
    assets: assets, assetOf: assetOf, works: works, pinAsset: pinAsset, workOf: workOf,
    docsOf: docsOf, latestDoc: latestDoc, assetBrief: assetBrief,
    parseDelimited: parseDelimited, cleanRows: cleanRows, readFile: readFile, pickFiles: pickFiles,
    rentRollSummary: rentRollSummary, opexSummary: opexSummary, parseMonth: parseMonth, parseDateLoose: parseDateLoose,
    defaultCriteria: defaultCriteria, newRfp: newRfp, rfpOf: rfpOf, rfpsOf: rfpsOf, rfpHTML: rfpHTML, criterionWeightTotal: criterionWeightTotal,
    submissionsOf: submissionsOf, submissionOf: submissionOf, scoreOf: scoreOf, autoScores: autoScores,
    totalScore: totalScore, rankedScores: rankedScores,
    codesOf: codesOf, validCode: validCode, findCode: findCode, issueCode: issueCode, logAccess: logAccess, accessLogOf: accessLogOf, makeCode: makeCode,
    session: session, setSession: setSession, codeLogin: codeLogin, clearApiToken: clearApiToken,
    visibleRfps: visibleRfps, visibleSubmissions: visibleSubmissions, visibleDocs: visibleDocs,
    poolOf: poolOf, loadInvestors: loadInvestors,
    modal: modal, closeModal: closeModal, fval: fval, fcheck: fcheck, fgroup: fgroup, field: field,
    download: download, downloadFile: downloadFile, csv: csv, printDoc: printDoc, exportWord: exportWord, safeName: safeName,
    exportAll: exportAll, importAll: importAll
  };
})();
