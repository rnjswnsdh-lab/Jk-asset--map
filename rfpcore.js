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
    'codes', 'access', 'ca', 'marketing', 'notices', 'buyers', 'bidSubs', 'lenders', 'loiconf',
    /* 2026-11-28 — 발주~접수·분석·선정 파이프라인 */
    'advisor_contacts', 'ca_deal', 'participants', 'ca_parties', 'evaluations', 'selection', 'history', 'requests', 'performance', 'locations', 'lists', 'submits', 'fin_offers', 'fin_requests', 'market_posts', 'services', 'advisor_checks'];

  var DOC_KINDS = [
    { k: 'rentroll', label: '렌트롤 (Rent Roll)', icon: '🏢', note: '임차인·면적·임대료·만기 표' },
    { k: 'opex', label: '오펙스 (OpEx)', icon: '🧾', note: '운영비 항목·연간 금액' },
    { k: 'im', label: 'IM · 티저', icon: '📄', note: '매각 안내문·투자설명서(Teaser)' },
    { k: 'pm', label: 'PM 월간 리포트', icon: '📅', note: '매달 받는 PM 리포트 파일' },
    { k: 'etc', label: '기타 자료', icon: '📎', note: '도면·감정평가서·등기 등' },
    { k: 'ca', label: 'CA 양식(딜별)', icon: '🔒', note: '발주처가 준 비밀유지약정서/서약서 양식' }
  ];

  /* ── 상태 흐름(발주 → 배포 → 접수 → 분석 → 담당자 검토 → 외부 보고 → 선정) ── */
  var FLOW = ['초안', '배포', '접수', '분석', '담당자 검토', '외부 보고', '선정'];
  var STATUS_ALIAS = { '작성': '초안', '제안 접수': '접수', '평가': '분석', '제안접수': '접수' };

  /* ── CA 수기 절차 단계(플랫폼은 기록·추적만; 전자서명·외부 연동 없음) ── */
  var CA_STAGES = ['미착수', '양식 다운로드', '결재 요청', '결재 완료', '날인본 등록', '발송 완료'];
  var CA_STATUS = ['CA 미제출', 'CA 접수', '반려'];
  var SPECIALTIES = ['감정평가', '회계·세무', '법률', '기술사', '건축·CM', 'PM', '부동산 자문', '금융 자문', '기타'];

  /* RFP 표준 골격은 rfp_template.js(데이터)에서 읽습니다 — 양식 교체 시 그 파일만 수정. */
  var TPL = window.NAI_RFP_TEMPLATE || null;
  var DEFAULT_CRITERIA = (TPL && TPL.criteria ? TPL.criteria : [
    { key: 'track', label: '용역수행 실적(최근 3년 유사용역)', weight: 20 },
    { key: 'understand', label: '물건·시장 이해도', weight: 15 },
    { key: 'strategy', label: '매각 추진전략·수행방안', weight: 15 },
    { key: 'price', label: '예상 매각가격 적정성', weight: 20 },
    { key: 'buyers', label: '매수의향자 확보', weight: 15 },
    { key: 'team', label: '조직·인력(업무분담)', weight: 7 },
    { key: 'fee', label: '용역보수(기본+성과)', weight: 8 }
  ]).map(function (c) { return { key: c.key, label: c.label, weight: c.weight }; });

  var DEFAULT_DOCS = (TPL && TPL.docs ? TPL.docs.slice() : [
    '제안서 (A4, 자율양식)',
    'CA(비밀유지약정서) 또는 입찰참가 서약서 날인본',
    '입찰참가 신청서 (대리인 재직증명·사용인감계·법인등기부등본)',
    '매입·매각 자문 실적표 (최근 3년, 본건 유사물건 중심)'
  ]);
  var TPL_OPTIONS = (TPL && TPL.options) || {};
  var TPL_MATERIALS = (TPL && TPL.materials) || [];

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
    var loc = locOf(assetId);
    var lines = [];
    lines.push('소재지: ' + (a.address || '미정') + (loc.lat ? ' (좌표 확인됨 · ' + (loc.precision || '정밀도 미표기') + ')' : ' (좌표 미확인)'));
    if (loc.region) lines.push('권역: ' + loc.region);
    if (loc.map_url) lines.push('지도: ' + loc.map_url);
    if (rs) {
      lines.push('임차 현황: 임차인 ' + rs.tenantCount + '명 · 임대면적 ' + n0(rs.leasedArea) + '평 · 공실률 ' + n0(rs.vacancyRate) + '%');
      lines.push('월 임대료: ' + n0(rs.monthlyRent, 0) + '원 (연 ' + n0(rs.annualRent, 0) + '원) · 평균 ' + n0(rs.avgRentPerPy, 0) + '원/평·월');
      if (rs.wale != null) lines.push('WALE: ' + rs.wale.toFixed(1) + '년 (임대료 가중)');
    } else lines.push('임차 현황: 렌트롤 미등록 — 자료 업로드 후 자동 반영됩니다.');
    if (os) lines.push('오펙스: 연 ' + n0(os.total, 0) + '원' + (os.perPy ? ' (평당 ' + n0(os.perPy, 0) + '원)' : ''));
    if (b.pmLatest) lines.push('PM 리포트: 최근 ' + (b.pmLatest.month || when(b.pmLatest.at).slice(0, 7)) + ' (' + b.pm.length + '건 보관)');
    var sch = (TPL && TPL.schedule) || { offer_days: 14, pt_days: 21, select_days: 24, loi_days: 49, close_days: 90 };
    var d = function (n) { return addDays(today(), n); };
    var scopeLines = [
      '① 매각 준비 — 자료 정리(Rent roll·OPEX·CAPEX·만기·WALE), Q&A 대응',
      '② 마케팅 — Teaser/TM 제작, 투자자(Long list) 발굴·접촉, 마케팅 리스트 운영',
      '③ 투자자 관리 — CA 배포·회수, VDR 운영, 실사 지원',
      '④ 입찰 — LOI/LOC·자금조달 계획서 접수, 매수자 평가·숏리스트',
      '⑤ 협상·계약 — 우선협상대상자 선정, SPA·PF 협의, 소유권이전 지원',
      '⑥ 보고 — 주간 진행보고, 이슈·리스크 보고'
    ];
    var noteLines = [
      '· 제출서류 미비·미기재 항목은 평가하지 않을 수 있습니다.',
      '· 담합·영향력 행사가 확인된 업체는 제안서 접수 대상에서 배제합니다.',
      '· 상기 일정·평가기준은 발주처 사정에 따라 변경될 수 있습니다.',
      '· 평가 결과·배점은 외부에 공개하지 않습니다.'
    ];
    return {
      id: '', asset_id: assetId, asset_name: a.name || '', client: (me() && me().company) || 'NAI Korea',
      title: (a.name || '물건') + ' 매각 자문 RFP',
      issue_date: today(), due_date: d(sch.offer_days || 14), loi_due: d(sch.loi_days || 49),
      status: '초안', guide_eok: price || '',
      region: loc.region || '', scale_info: (assetFull(assetId) || {}).scale_info || '',
      material_ids: docsOf(assetId).filter(function (d0) { return d0.kind !== 'pm' && d0.kind !== 'ca'; }).map(function (d0) { return d0.id; }),
      materials_meta: {}, owner: (me() && me().name) || '',
      tpl_version: (TPL && TPL.version) || '',
      /* 딜별 옵션 — 실물 5건의 차이를 담는 자리 */
      submit_mode: (TPL_OPTIONS.submit_mode || ['Soft copy(PDF)'])[1] || 'Soft copy(PDF)',
      language: (TPL_OPTIONS.language || ['국문'])[2] || '국·영문 택1',
      fee_sealed: (TPL_OPTIONS.fee_sealed || ['제안서에 포함'])[0],
      consortium: (TPL_OPTIONS.consortium || ['불가'])[0],
      signature_doc: (TPL_OPTIONS.signature_doc || ['CA(비밀유지약정서)'])[0],
      ca_form_id: '', ca_form_name: '',
      overview: lines.join('\n'),
      scope: scopeLines.join('\n'),
      schedule: 'RFP 발송 ' + today() + ' → 제안서 접수 마감 ' + d(sch.offer_days || 14) + ' 16:00 → 제안설명회(PT) ' + d(sch.pt_days || 21) +
        ' → 우선협상대상자 선정 ' + d(sch.select_days || 24) + ' → LOI 마감 ' + d(sch.loi_days || 49) + ' → 협상·종결 ' + d(sch.close_days || 90),
      proposal: '· 제출 방식: ' + ((TPL_OPTIONS.submit_mode || ['Soft copy(PDF)'])[1] || 'Soft copy(PDF)') + '\n' +
        '· 언어: ' + ((TPL_OPTIONS.language || ['국문'])[2] || '국·영문 택1') + '\n' +
        '· 구성: 일반사항 → 용역 수행방안 → 매수의향자 확보 → 조직·인력 → 용역보수\n' +
        '· 모든 제출서류는 본 시스템의 제안 제출 화면에서 파일로 업로드합니다(마감 전까지 수정 가능).',
      docs: DEFAULT_DOCS.slice(),
      criteria: defaultCriteria(),
      nda: '제안서 작성에 필요한 자료 제공은 발주처 ' + ((TPL_OPTIONS.signature_doc || ['CA(비밀유지약정서)'])[0]) + ' 날인·회신 이후에 진행됩니다. ' +
        '자료는 VDR을 통해서만 제공하며, CA 접수된 참여자에게만 열람·다운로드가 열립니다(미제출 시 목록만).',
      note: noteLines.join('\n'), invites: [], selected_advisor_id: '', created_at: new Date().toISOString()
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
    var loc = locOf(rfp.asset_id);
    h += '<table class="rfp-doc-meta"><tbody>' +
      '<tr><th>대상 물건</th><td>' + esc(rfp.asset_name || '-') + '</td>' +
      '<th>가격 가이던스</th><td>' + (rfp.guide_eok ? esc(n0(rfp.guide_eok, 0) + '억원') : '미제시') + '</td></tr>' +
      '<tr><th>소재지</th><td colspan="3">' + esc(locLine(loc)) +
        (loc.map_url ? ' · 지도 ' + esc(loc.map_url) : ' · 좌표 미확인') + '</td></tr>' +
      '<tr><th>의뢰인</th><td>' + esc(rfp.client || '-') + '</td><th>상태</th><td>' + esc(flowOf(rfp)) + '</td></tr>' +
      '</tbody></table>';
    /* 딜별 옵션 — 실물 5건의 차이(Hard/Soft, 국·영문, 밀봉 보수 등) */
    h += '<table class="rfp-doc-table opt"><tbody><tr>' +
      '<th>제출 방식</th><td>' + esc(rfp.submit_mode || '-') + '</td>' +
      '<th>언어</th><td>' + esc(rfp.language || '-') + '</td></tr><tr>' +
      '<th>보수 제출</th><td>' + esc(rfp.fee_sealed || '제안서에 포함') + '</td>' +
      '<th>컨소시엄</th><td>' + esc(rfp.consortium || '불가') + '</td></tr><tr>' +
      '<th>비밀유지 서류</th><td colspan="3">' + esc(rfp.signature_doc || 'CA(비밀유지약정서)') + '</td></tr>' +
      '</tbody></table>';
    h += '<section><h3>I. 용역 개요</h3><div class="rfp-pre">' + esc(rfp.overview || '') + '</div></section>';
    h += '<section><h3>II. 용역 범위</h3><div class="rfp-pre">' + esc(rfp.scope || '') + '</div></section>';
    h += '<section><h3>III. 추진 일정</h3><div class="rfp-pre">' + esc(rfp.schedule || '') + '</div></section>';
    h += '<section><h3>IV. 제안서 목차 · 작성 방법</h3><div class="rfp-pre">' + esc(rfp.proposal || '') + '</div></section>';
    h += '<section><h3>V. 제출 요구 서류</h3><ul class="rfp-doc-list">' +
      (rfp.docs || []).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
      '<p class="rfp-doc-note">모든 서류는 본 시스템의 제안 제출 화면에서 파일로 업로드합니다(마감 전까지 수정 가능). ' +
      'CA(비밀유지약정서) 날인·회신 후에 자료가 제공됩니다.</p></section>';
    if (opts.criteria !== false) {
      var showW = !!opts.weights;
      h += '<section><h3>VI. 평가 기준</h3><table class="rfp-doc-table"><thead><tr><th>평가 항목</th>' + (showW ? '<th>가중치</th>' : '') + '</tr></thead><tbody>' +
        (rfp.criteria || []).map(function (c) { return '<tr><td>' + esc(c.label) + '</td>' + (showW ? '<td class="num">' + n0(c.weight, 0) + '</td>' : '') + '</tr>'; }).join('') +
        (showW ? '<tr class="sum"><td>합계</td><td class="num">' + n0(criterionWeightTotal(rfp.criteria), 0) + '</td></tr>' : '') + '</tbody></table>' +
        '<p class="rfp-doc-note">' + (showW
          ? '항목별 100점 환산 점수 × 가중치로 총점을 산정합니다(발주처 내부 평가·외부 비공개).'
          : '배점·평가 결과는 발주처 내부 기준에 따라 운영되며 외부에 공개되지 않습니다.') + '</p></section>';
    }
    h += '<section><h3>VII. 기타 · 유의사항</h3><div class="rfp-pre">' + esc(rfp.note || '') + '</div></section>';
    h += '<section><h3>별첨 양식</h3><ul class="rfp-doc-list">' +
      '<li>입찰참가 신청서 (대리인 재직증명서·사용인감계·법인등기부등본 첨부)</li>' +
      '<li>입찰참가 서약서' + (rfp.signature_doc && /통합/.test(rfp.signature_doc) ? ' — CA와 통합 가능' : '') + '</li>' +
      '<li>매입·매각 자문 실적표 (최근 3년, 본건 유사물건 중심)</li>' +
      '<li>' + esc(rfp.signature_doc || 'CA(비밀유지약정서)') + (rfp.ca_form_name ? ' — ' + esc(rfp.ca_form_name) : '') + '</li></ul>' +
      '<p class="rfp-doc-note">입찰 서류 패키징·제출 형식은 표준 샘플 교체 예정입니다(샘플 수령 후 반영).</p></section>';
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
    /* 비교 대상이 1건뿐이면 상대평가가 의미 없어 기본 70점에서 시작합니다. */
    var single = subs.length < 2;
    subs.forEach(function (s) {
      var v = {};
      var fee = num(s.fee_success);
      v.fee = !single && minFee > 0 && fee > 0 ? Math.max(0, Math.min(100, minFee / fee * 100)) : 70;
      var p = num(s.price_expect);
      v.price = !single && maxPrice > 0 && p > 0 ? Math.max(0, Math.min(100, p / maxPrice * 100)) : 70;
      var m = num(s.period_months);
      v.period = !single && minPeriod > 0 && m > 0 ? Math.max(0, Math.min(100, minPeriod / m * 100)) : 70;
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
  /* 공개 범위 표기 정규화 — '렌트롤, 오펙스' 처럼 한글·대문자로 들어와도 코드로 바꿉니다. */
  function normScope(v) {
    var KO = { '렌트롤': 'rentroll', '렌트롤(rent roll)': 'rentroll', 'rentroll': 'rentroll', 'rent': 'rentroll',
      '오펙스': 'opex', 'opex': 'opex', '운영비': 'opex',
      'im': 'im', 'im·티저': 'im', 'im티저': 'im', '티저': 'im', 'teaser': 'im', '투자설명서': 'im',
      'pm': 'pm', 'pm리포트': 'pm', 'pm 월간 리포트': 'pm', 'pm 리포트': 'pm',
      '기타': 'etc', 'etc': 'etc', '도면': 'etc', '등기': 'etc', '감정평가': 'etc' };
    var arr = (Array.isArray(v) ? v : String(v || '').split(',')).map(function (x) { return String(x).trim(); }).filter(Boolean);
    var out = [];
    arr.forEach(function (x) {
      var k = KO[x.toLowerCase()] || KO[x] || (['rentroll', 'opex', 'pm', 'etc'].indexOf(x.toLowerCase()) >= 0 ? x.toLowerCase() : '');
      if (k && out.indexOf(k) < 0) out.push(k);
    });
    return out.length ? out : ['rentroll', 'opex', 'pm', 'etc'];
  }

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
      scope: normScope(o.scope || ['rentroll', 'opex', 'pm', 'etc']),
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
    if (isAdvisorSession(ss)) {
      /* 코드에 자문사 id 가 없으면(직접 발급) 회사명으로 본인 제출을 찾습니다. */
      return all.filter(function (s) {
        if (ss.holder_id) return String(s.advisor_id || '') === String(ss.holder_id);
        return String(s.advisor_company || '') === String(ss.holder || '');
      });
    }
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

  /* ═══════════════════════════════════════════════════════════════════════
     2026-11-28 — 발주 → 배포 → 접수 → 분석 → 담당자 검토 → 외부 보고 → 선정
     + 선정 후 자문 수행 · CA 수기 절차 · 제출 폴더
     ═══════════════════════════════════════════════════════════════════════ */
  var CA_TEMPLATE = {
    ver: 'v0-임시',
    name: 'CA_표준양식_임시.doc',
    /* 실제 NAI 표준 CA 양식을 받으면 아래 URL 만 채우면 됩니다(파일 교체 지점).
       예: 'assets/CA_NAI_표준양식_2026.docx'  — docs/CA_양식_교체_지점.md 참고 */
    url: (CFG.CA_TEMPLATE_URL || ''),
    note: '표준 CA 양식 교체 예정 — 지금 파일은 자리 표시용(임시)이며 법무 확정본이 아닙니다.'
  };
  var PERF_STAGES = ['선정·착수', '자료 인계', 'TM·IM 제작', '마케팅·티저', '입찰·LOI', '협상·계약', '종결'];

  /* ── 물건 위치 — 물건 지도(assets)와 같은 데이터·좌표를 그대로 씁니다 ── */
  function assetFull(id) {
    var st = window.naiMap && window.naiMap.state;
    if (!st) return null;
    if (st.index && st.index[id]) return st.index[id];
    var base = st.base || [];
    for (var i = 0; i < base.length; i++) if (String(base[i].id) === String(id)) return base[i];
    return null;
  }
  function mapUrl(lat, lng, name) {
    if (!(isFinite(lat) && isFinite(lng)) || !lat || !lng) return '';
    return 'https://map.kakao.com/link/map/' + encodeURIComponent(name || '물건') + ',' + lat + ',' + lng;
  }
  function roadviewUrl(lat, lng) {
    if (!(isFinite(lat) && isFinite(lng)) || !lat || !lng) return '';
    return 'https://map.kakao.com/link/roadview/' + lat + ',' + lng;
  }
  function locVerifyOf(assetId) {
    var a = list('locations');
    for (var i = 0; i < a.length; i++) if (String(a[i].asset_id) === String(assetId)) return a[i];
    return null;
  }
  function setLocVerify(assetId, memo, confirmed) {
    var exist = locVerifyOf(assetId);
    var m = me() || {};
    var rec = exist || { id: uid('loc'), asset_id: assetId };
    rec.confirmed = confirmed !== false;
    rec.memo = memo != null ? memo : (rec.memo || '');
    rec.by = m.name || role();
    rec.at = new Date().toISOString();
    return commit('locations', rec);
  }
  /* 값이 있는 것만 채우고, 좌표가 없으면 없는 그대로 표기(임의 좌표 생성 금지) */
  function locLine(loc) {
    loc = loc || {};
    return [loc.address, loc.jibun && loc.jibun !== loc.address ? '지번 ' + loc.jibun : '', loc.region]
      .filter(Boolean).join(' · ') || '주소 미확인';
  }
  function locOf(assetId) {
    var a = assetFull(assetId) || {};
    var w = workOf(assetId) || {};
    var lat = Number(a.lat), lng = Number(a.lng);
    var has = isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0;
    var v = locVerifyOf(assetId);
    return {
      asset_id: assetId, name: a.name || w.name || '', address: a.address || w.address || '',
      jibun: a.jibun || a.address_jibun || a.lot_addr || '', region: a.region || w.region || '',
      lat: has ? lat : null, lng: has ? lng : null,
      precision: a.coord_precision || a.coordPrecision || '',
      map_url: has ? mapUrl(lat, lng, a.name || w.name) : '',
      road_url: has ? roadviewUrl(lat, lng) : '',
      verified: !!(v && v.confirmed), verify: v
    };
  }

  /* ── 상태 흐름 ─────────────────────────────────────────────────── */
  function normStatus(s) {
    var v = String(s == null ? '' : s).trim();
    return STATUS_ALIAS[v] || (FLOW.indexOf(v) >= 0 ? v : '초안');
  }
  function flowOf(rfp) { return normStatus(rfp && rfp.status); }
  function flowIndex(s) { return FLOW.indexOf(normStatus(s)); }
  function historyOf(rfpId) {
    return list('history').filter(function (h) { return !rfpId || h.rfp_id === rfpId; })
      .sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }
  function logHistory(rfpId, from, to, note) {
    var m = me() || {};
    return commit('history', {
      id: uid('his'), rfp_id: rfpId, from: normStatus(from), to: normStatus(to),
      by: m.name || '', role: role(), note: note || '', at: new Date().toISOString()
    });
  }
  function flowGuard(rfp, to) {
    to = normStatus(to);
    var subs = submissionsOf(rfp.id), evals = evaluationsOf(rfp.id), sel = selectionOf(rfp.id);
    if (to === '배포' && !(rfp.invites || []).length) return '배포할 자문사를 1명 이상 선택하세요.';
    if (to === '접수' && !subs.length) return '제안서가 1건 이상 접수된 뒤에 넘어갈 수 있습니다.';
    if (to === '분석' && !subs.length) return '분석할 제안서가 없습니다.';
    if (to === '분석' && !evals.length) return '먼저 「제안서 분석 → 평가 초안」을 만들어 주세요.';
    if (to === '담당자 검토') {
      if (!evals.length) return '평가 초안이 없습니다.';
      var pend = subs.filter(function (s) {
        var e = evaluationOf(rfp.id, s.advisor_id);
        return !e || e.status !== '검토 완료';
      });
      if (pend.length) return pend.length + '건의 제안서 평가가 아직 「검토 완료」가 아닙니다.';
    }
    if (to === '외부 보고') {
      var rv = (sel && sel.review) || null;
      if (!rv || !rv.at) return '운용사 담당자 확인(승인/조건부/보류)을 먼저 기록하세요.';
      if (rv.result === '보류') return '운용사 담당자 확인이 「보류」입니다.';
    }
    if (to === '선정' && !(sel && sel.advisor_id)) return '선정할 자문사를 먼저 확정하세요.';
    return '';
  }
  function setStatus(rfp, to, note) {
    var from = rfp.status || '초안';
    rfp.status = normStatus(to);
    commit('rfps', rfp);
    logHistory(rfp.id, from, rfp.status, note || '');
    return rfp.status;
  }

  /* ── 자문사 컨택포인트 ─────────────────────────────────────────── */
  function contacts() {
    return list('advisor_contacts').filter(function (c) { return c.active !== false; })
      .sort(function (a, b) { return String(a.company || '').localeCompare(String(b.company || '')); });
  }
  function contactOf(id) {
    var a = list('advisor_contacts');
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }
  /* 검증용 가상 인물 — 실제 자문사·개인정보가 아닙니다. 실데이터는 시트(rfp_advisor_contacts)에서 읽습니다. */
  function sampleContacts() {
    return [
      { company: '[샘플] 한빛감정평가', name: '샘플담당1', title: '이사', specialty: ['감정평가'], email: 'sample1@example.com', phone: '010-0000-1001', deals: '업무용 오피스 감정 3건(샘플)', note: '검증용 가상 데이터' },
      { company: '[샘플] 새길회계법인', name: '샘플담당2', title: '파트너', specialty: ['회계·세무'], email: 'sample2@example.com', phone: '010-0000-1002', deals: '부동산 실사·세무 검토 5건(샘플)', note: '검증용 가상 데이터' },
      { company: '[샘플] 도담법률사무소', name: '샘플담당3', title: '변호사', specialty: ['법률'], email: 'sample3@example.com', phone: '010-0000-1003', deals: '매각·PF 자문 4건(샘플)', note: '검증용 가상 데이터' },
      { company: '[샘플] 정연기술사사무소', name: '샘플담당4', title: '기술사', specialty: ['기술사'], email: 'sample4@example.com', phone: '010-0000-1004', deals: '구조·설비 진단 6건(샘플)', note: '검증용 가상 데이터' },
      { company: '[샘플] 우리PM', name: '샘플담당5', title: 'PM팀장', specialty: ['PM'], email: 'sample5@example.com', phone: '010-0000-1005', deals: '오피스 PM 2건(샘플)', note: '검증용 가상 데이터' },
      { company: '[샘플] 가람건축사사무소', name: '샘플담당6', title: '소장', specialty: ['건축·CM'], email: 'sample6@example.com', phone: '010-0000-1006', deals: '리모델링 CM 2건(샘플)', note: '검증용 가상 데이터' },
      { company: '[샘플] 바른부동산자문', name: '샘플담당7', title: '대표', specialty: ['부동산 자문'], email: 'sample7@example.com', phone: '010-0000-1007', deals: '오피스 매각 자문 3건(샘플)', note: '검증용 가상 데이터' },
      { company: '[샘플] 첫빛금융자문', name: '샘플담당8', title: '상무', specialty: ['금융 자문'], email: 'sample8@example.com', phone: '010-0000-1008', deals: 'PF·대출 주선 3건(샘플)', note: '검증용 가상 데이터' }
    ];
  }
  function seedContacts() {
    var have = {};
    list('advisor_contacts').forEach(function (c) { have[String(c.company) + '|' + String(c.name)] = 1; });
    var n = 0;
    sampleContacts().forEach(function (c) {
      if (have[String(c.company) + '|' + String(c.name)]) return;
      commit('advisor_contacts', {
        id: uid('ctc'), company: c.company, name: c.name, title: c.title,
        specialty: c.specialty, email: c.email, phone: c.phone, deals: c.deals, note: c.note,
        active: true, at: new Date().toISOString()
      });
      n++;
    });
    return n;
  }
  function specText(c) { return (c.specialty || []).join(' · '); }

  /* ── 제출 자료 세트 · CA 게이트(한 곳에서 제어) ─────────────────── */
  function materialIds(rfp) {
    if (rfp && Array.isArray(rfp.material_ids)) return rfp.material_ids.slice();
    /* 기본값: 물건 자료 중 PM 월간 리포트를 뺀 나머지(렌트롤·OPEX·IM·기타) */
    return docsOf(rfp && rfp.asset_id).filter(function (d) { return d.kind !== 'pm' && d.kind !== 'ca'; }).map(function (d) { return d.id; });
  }
  function materialsOf(rfp) {
    if (!rfp) return [];
    var ids = materialIds(rfp), all = docsOf(rfp.asset_id), out = [];
    ids.forEach(function (id) {
      var d = null;
      for (var i = 0; i < all.length; i++) if (all[i].id === id) { d = all[i]; break; }
      if (d) out.push({ doc_id: d.id, kind: d.kind, label: d.label || d.kind, name: d.name, size: d.size || 0, at: d.at || '', month: d.month || '', doc: d });
      else {
        var meta = (rfp.materials_meta || {})[id];
        if (meta) out.push({ doc_id: id, kind: meta.kind, label: meta.label || meta.kind, name: meta.name || '(파일 없음)', size: meta.size || 0, at: meta.at || '', month: meta.month || '', missing: true, doc: null });
      }
    });
    return out;
  }

  /* ── 자료별 공개 등급 · 열람 판정(참여자 단위) ────────────────────
     기본 세트(IM/티저 · 렌트롤 · OPEX)는 CA 접수 시 바로 열리고,
     기타 자료는 기본이 '요청 시 개방'(참여자 요청 → 담당자 승인). */
  var BASE_KINDS = ['im', 'rentroll', 'opex'];
  function materialAcl(doc) {
    var a = doc && doc.access;
    if (a === '기본 개방' || a === '요청 시 개방' || a === '비공개') return a;
    return BASE_KINDS.indexOf((doc || {}).kind) >= 0 ? '기본 개방' : '요청 시 개방';
  }
  function requestApproved(rfpId, participantId, docId) {
    var a = list('requests');
    for (var i = 0; i < a.length; i++) {
      if (String(a[i].rfp_id) === String(rfpId) && String(a[i].participant_id) === String(participantId) &&
        String(a[i].doc_id || '') && String(a[i].doc_id) === String(docId) && a[i].status === '승인') return a[i];
    }
    return null;
  }
  function materialAccess(rfp, doc, ref) {
    var acl = materialAcl(doc);
    if (!ref) return { ok: true, acl: acl, reason: '', staff: true };
    var p = typeof ref === 'string' ? findParticipant(rfp.id, { id: ref, ref_id: ref }) : findParticipant(rfp.id, ref);
    if (!p) p = typeof ref === 'string' ? null : ensureParticipant(rfp.id, ref.party_type || '투자자', ref);
    if (acl === '비공개') return { ok: false, acl: acl, reason: '비공개 자료', participant: p };
    if (!p || !caOpenFor(rfp.id, p.id)) return { ok: false, acl: acl, reason: 'CA 미제출', participant: p };
    if (acl === '기본 개방') return { ok: true, acl: acl, reason: '', participant: p };
    var ap = requestApproved(rfp.id, p.id, doc.id);
    if (ap) return { ok: true, acl: acl, reason: '요청 승인', participant: p, request: ap };
    return { ok: false, acl: acl, reason: '요청 시 개방 — 열람 요청 필요', canRequest: true, participant: p };
  }
  function viewersOf(docId) {
    var a = list('access').filter(function (x) { return String(x.doc_id) === String(docId); });
    return { count: a.length, last: a[0] || null, list: a };
  }
  /* 자료 목록(버전·배포일·열람자·권한) — VDR·포털·RFP가 같은 함수를 씁니다 */
  function materialGroups(rfp, ref) {
    if (!rfp) return [];
    var docs = materialsOf(rfp).filter(function (m) { return m.doc; });
    var a = assetFull(rfp.asset_id) || {};
    var groups = [
      { kind: 'im', label: 'IM · 티저', icon: '📄' },
      { kind: 'rentroll', label: '렌트롤 (Rent Roll)', icon: '🏢' },
      { kind: 'opex', label: 'OPEX (운영비)', icon: '🧾' },
      { kind: 'etc', label: '기타 자료', icon: '📎' }
    ];
    var out = groups.map(function (g) {
      var items = docs.filter(function (m) { return m.kind === g.kind; })
        .sort(function (x, y) { return String(x.at || '').localeCompare(String(y.at || '')); })
        .map(function (m, i, arr) {
          var ac = materialAccess(rfp, m.doc, ref);
          var vw = viewersOf(m.doc_id);
          return {
            doc_id: m.doc_id, name: m.name, size: m.size, at: m.at, month: m.month,
            version: i + 1, latest: i === arr.length - 1, doc: m.doc,
            access: ac.acl, can_view: ac.ok, reason: ac.reason, can_request: !!ac.canRequest,
            download: m.doc.download !== false, tags: m.doc.tags || [],
            uploaded_by: m.doc.uploaded_by || '', viewers: vw.count, last_view: vw.last,
            url: m.doc.url || '', note: m.doc.note || '', acl_reason: ac.reason
          };
        });
      var hasAssetIm = g.kind === 'im' && (a.im_url || a.im_label);
      return { kind: g.kind, label: g.label, icon: g.icon, items: items, asset_im: hasAssetIm ? { url: a.im_url || '', label: a.im_label || '' } : null };
    });
    return out;
  }
  function requestAdd(rfpId, ref, info) {
    var p = typeof ref === 'string' ? findParticipant(rfpId, { id: ref, ref_id: ref }) : findParticipant(rfpId, ref);
    if (!p && ref && typeof ref === 'object') p = ensureParticipant(rfpId, ref.party_type || '투자자', ref);
    var m = me() || {};
    return commit('requests', {
      id: uid('req'), rfp_id: rfpId, participant_id: p ? p.id : '', party_type: p ? p.party_type : '',
      company: (p && p.company) || info.company || '', name: (p && p.name) || info.name || '',
      kind: info.kind || '자료 열람 요청', doc_id: info.doc_id || '', doc_label: info.doc_label || '',
      topic: info.topic || '', message: info.message || '', status: '요청',
      at: new Date().toISOString(), by: m.name || role()
    });
  }
  function requestDecide(reqId, result, memo) {
    var a = list('requests');
    for (var i = 0; i < a.length; i++) {
      if (a[i].id !== reqId) continue;
      var r = a[i];
      r.status = result === '승인' ? '승인' : (result === '반려' ? '반려' : '완료');
      r.decided_by = (me() && me().name) || role();
      r.decided_at = new Date().toISOString();
      if (memo != null) r.memo = memo;
      return commit('requests', r);
    }
    return null;
  }
  function requestMemo(reqId, memo) {
    var a = list('requests');
    for (var i = 0; i < a.length; i++) {
      if (a[i].id !== reqId) continue;
      a[i].memo = memo;
      a[i].memo_by = (me() && me().name) || role();
      a[i].memo_at = new Date().toISOString();
      return commit('requests', a[i]);
    }
    return null;
  }
  function pendingRequests(rfpId) {
    return requestsOf(rfpId).filter(function (r) { return r.status === '요청'; });
  }
  function caDealOf(rfpId) {
    var a = list('ca_deal');
    for (var i = 0; i < a.length; i++) if (a[i].rfp_id === rfpId) return a[i];
    return null;
  }
  function caDeal(rfpId) {
    var r = caDealOf(rfpId);
    if (!r) r = commit('ca_deal', { id: uid('cad'), rfp_id: rfpId, status: '미착수', template_ver: CA_TEMPLATE.ver, downloads: [], approval: null, sealed: null, sends: [], at: new Date().toISOString() });
    return r;
  }
  /* ── 참여자(자문사 · 투자자 · 금융기관)와 CA 대장 ──────────────
     같은 회사라도 담당자(participant)별로 CA 제출·열람 권한을 구분합니다.
     CA 게이트 판정은 caOpenFor() 한 곳에서만 하고, 포털·VDR·RFP 화면과
     서버가 같은 규칙을 씁니다. */
  var PARTY_TYPES = ['자문사', '투자자', '금융기관'];
  function participantsOf(rfpId) {
    return list('participants').filter(function (p) { return !rfpId || p.rfp_id === rfpId; })
      .sort(function (a, b) { return String(a.party_type || '').localeCompare(String(b.party_type || '')) || String(a.company || '').localeCompare(String(b.company || '')); });
  }
  function participantOf(rfpId, id) {
    var a = list('participants');
    for (var i = 0; i < a.length; i++) if (a[i].rfp_id === rfpId && a[i].id === id) return a[i];
    return null;
  }
  function findParticipant(rfpId, by) {
    var a = list('participants');
    for (var i = 0; i < a.length; i++) {
      var p = a[i];
      if (String(p.rfp_id) !== String(rfpId)) continue;
      if (by.id && p.id === by.id) return p;
      if (by.ref_id && String(p.ref_id) === String(by.ref_id)) return p;
      if (by.company && String(p.company) === String(by.company) && (!by.name || String(p.name) === String(by.name))) return p;
    }
    return null;
  }
  function ensureParticipant(rfpId, partyType, info) {
    info = info || {};
    var p = findParticipant(rfpId, { ref_id: info.ref_id, company: info.company, name: info.name }) || null;
    if (p) {
      p.party_type = p.party_type || partyType;
      if (info.email && !p.email) p.email = info.email;
      if (info.phone && !p.phone) p.phone = info.phone;
      if (info.name && !p.name) p.name = info.name;
      return commit('participants', p);
    }
    return commit('participants', {
      id: uid('prt'), rfp_id: rfpId, party_type: partyType, company: info.company || '',
      name: info.name || '', title: info.title || '', email: info.email || '', phone: info.phone || '',
      ref_id: info.ref_id || '', note: info.note || '', at: new Date().toISOString()
    });
  }
  function caRecordOf(rfpId, participantId) {
    var a = list('ca_parties');
    for (var i = 0; i < a.length; i++) {
      if (String(a[i].rfp_id) === String(rfpId) && String(a[i].participant_id) === String(participantId)) return a[i];
    }
    return null;
  }
  /* 자문사 id / 참여자 id / 회사·담당자명 어느 것으로도 찾을 수 있게 */
  function caReceiptOf(rfpId, ref) {
    var p = typeof ref === 'string' ? findParticipant(rfpId, { id: ref, ref_id: ref }) : findParticipant(rfpId, ref || {});
    if (!p && typeof ref === 'string') {
      var a = list('ca_parties');
      for (var i = 0; i < a.length; i++) if (String(a[i].rfp_id) === String(rfpId) && String(a[i].ref_id) === String(ref)) return a[i];
      return null;
    }
    return p ? caRecordOf(rfpId, p.id) : null;
  }
  /* CA 접수 여부 — 포털·VDR·RFP·서버가 모두 이 한 함수를 씁니다(중복 로직 금지). */
  function caOpenFor(rfpId, ref) {
    var r = caReceiptOf(rfpId, ref);
    return !!(r && r.status === 'CA 접수');
  }
  function caOpen(rfpId, ref) { return caOpenFor(rfpId, ref); }
  function caReceiptCommit(rfpId, party, data) {
    data = data || {};
    var p = party && party.id ? participantOf(rfpId, party.id) : null;
    if (!p) p = ensureParticipant(rfpId, data.party_type || '자문사', {
      ref_id: (party && party.ref_id) || data.ref_id || (typeof party === 'string' ? party : ''),
      company: (party && party.company) || data.company || '',
      name: (party && party.name) || data.manager || '',
      email: (party && party.email) || data.email || ''
    });
    var exist = caRecordOf(rfpId, p.id);
    var rec = exist || { id: uid('cap'), version: 0, files: [] };
    rec = Object.assign(rec, {
      rfp_id: rfpId, participant_id: p.id, party_type: p.party_type || data.party_type || '자문사',
      company: p.company, manager: data.manager || rec.manager || p.name || '',
      ref_id: p.ref_id || rec.ref_id || '',
      signed_date: data.signed_date || rec.signed_date || '',
      deal_scope: data.deal_scope || rec.deal_scope || '',
      note: data.note != null ? data.note : (rec.note || ''),
      status: data.status || rec.status || 'CA 미제출',
      version: (rec.version || 0) + 1,
      at: new Date().toISOString(), by: (me() && me().name) || role()
    });
    if (data.files && data.files.length) rec.files = data.files;
    return commit('ca_parties', rec);
  }
  function caSummaryOf(rfpId) {
    var ps = participantsOf(rfpId), out = { total: ps.length, ca: 0, pending: 0, byType: {} };
    ps.forEach(function (p) {
      var open = caOpenFor(rfpId, p.id);
      out.byType[p.party_type] = out.byType[p.party_type] || { total: 0, ca: 0 };
      out.byType[p.party_type].total++;
      if (open) { out.ca++; out.byType[p.party_type].ca++; } else out.pending++;
    });
    return out;
  }
  /* 코드 세션 → 이 딜의 참여자 */
  function partyOfSession(ss) {
    if (!ss) return null;
    var rfpId = ss.rfp_id || '';
    if (!rfpId) return null;
    var p = findParticipant(rfpId, { ref_id: ss.holder_id, company: ss.holder });
    if (p) return p;
    var pt = ss.holder_type === '자문사' ? '자문사' : (ss.holder_type === '금융기관' ? '금융기관' : '투자자');
    return ensureParticipant(rfpId, pt, { ref_id: ss.holder_id || '', company: ss.holder || '' });
  }

  /* ── CA 양식(임시) · 교체 지점 ─────────────────────────────────── */
  function caTemplateHTML(rfp) {
    var b = rfp ? assetBrief(rfp.asset_id) : {};
    var a = (b && b.asset) || {};
    return '<div class="rfp-doc"><div class="rfp-doc-head">' +
      '<span class="rfp-doc-kicker">CONFIDENTIALITY AGREEMENT · 서명본 제출 양식</span>' +
      '<h1>비밀유지계약(CA) 확인서 — 임시 양식</h1>' +
      '<p>' + esc([(rfp && rfp.client) || '', rfp ? rfp.asset_name : '', today()].filter(Boolean).join(' · ')) + '</p></div>' +
      '<p class="rfp-doc-note"><b>※ ' + esc(CA_TEMPLATE.note) + '</b><br>' +
      '이 파일은 자문사가 내려받아 회사 내부 결재·날인 후 서명본을 다시 업로드하기 위한 자리 표시 양식입니다. ' +
      '전자서명·외부 서명 연동은 이번 범위에 없습니다(추후 시스템 연동 검토 — Phase 2).</p>' +
      '<table class="rfp-doc-meta"><tbody>' +
      '<tr><th>대상 물건</th><td>' + esc((rfp && rfp.asset_name) || '-') + (a.address ? ' (' + esc(a.address) + ')' : '') + '</td>' +
      '<th>적용 딜</th><td>' + esc(rfp ? (rfp.title || '') + ' / RFP ' + (rfp.id || '') : '-') + '</td></tr>' +
      '<tr><th>발주처</th><td>' + esc((rfp && rfp.client) || '') + '</td><th>양식 버전</th><td>' + esc(CA_TEMPLATE.ver) + '</td></tr>' +
      '</tbody></table>' +
      '<section><h3>1. 서명자 정보</h3><table class="rfp-doc-table"><tbody>' +
      '<tr><th>회사명</th><td></td><th>사업자등록번호</th><td></td></tr>' +
      '<tr><th>담당자(성명·직함)</th><td></td><th>연락처·이메일</th><td></td></tr>' +
      '<tr><th>서명일</th><td></td><th>서명·날인</th><td></td></tr>' +
      '</tbody></table></section>' +
      '<section><h3>2. 첨부</h3><ul class="rfp-doc-list"><li>사업자등록증 사본</li><li>법인인감증명서(필요 시)</li><li>서명·날인 완료된 CA 원본 스캔본</li></ul></section>' +
      '<p class="rfp-doc-foot">표준 NAI CA 양식으로 교체 예정 · 교체 지점: docs/CA_양식_교체_지점.md (' + esc(CA_TEMPLATE.url || '미설정') + ')</p></div>';
  }
  function caTemplateDownload(rfp) {
    /* 딜에 발주처 원 양식(rfp.ca_form_id)이 연결돼 있으면 그 파일을 그대로 내려줍니다. */
    var form = rfp && rfp.ca_form_id ? byId('docs', rfp.ca_form_id) : null;
    if (form && downloadFile(form)) return 'form';
    if (CA_TEMPLATE.url) { try { window.open(CA_TEMPLATE.url, '_blank'); return 'link'; } catch (e) { /* noop */ } }
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">' +
      '<title>CA 제출 양식(임시)</title><style>body{font-family:"Malgun Gothic",sans-serif;font-size:10.5pt;line-height:1.7;color:#16202e}' +
      'h1{font-size:15pt}h3{font-size:11.5pt;margin:14pt 0 5pt;border-bottom:1px solid #dfe6ef;padding-bottom:3pt}' +
      'table{border-collapse:collapse;width:100%;margin:6pt 0}th,td{border:1px solid #b9c6d6;padding:6pt;font-size:9.5pt;vertical-align:top}' +
      'th{background:#eef2f7;text-align:left;width:22%}.rfp-doc-note{font-size:9pt;color:#b3262c}.rfp-doc-foot{margin-top:14pt;color:#6b7c91;font-size:8.5pt}</style></head><body>' +
      caTemplateHTML(rfp) + '</body></html>';
    download('CA_양식_임시_' + safeName((rfp && rfp.asset_name) || 'RFP') + '.doc', '\ufeff' + html, 'application/msword;charset=utf-8');
    return 'file';
  }

  /* ── 요구 서류 충족 점검 ────────────────────────────────────────── */
  var DOC_KEYS = [
    [/제안서|회사|인력|소개/i, ['제안서', '회사소개', '인력', '프로필']],
    [/수수료|성공보수|보수/i, ['수수료', '보수']],
    [/매각가|가격|기간/i, ['매각가', '가격', '기간']],
    [/실적|유사/i, ['실적', '유사']],
    [/투자자|접근/i, ['투자자', '접근', 'FI', 'SI']],
    [/NDA|비밀유지/i, ['NDA', '비밀유지', 'CA']],
    [/사업자등록|등기/i, ['사업자등록', '등기', '법인']]
  ];
  function checklistFor(rfp, sub) {
    var files = (sub && sub.files) || [];
    var names = files.map(function (f) { return String(f.name || '') + ' ' + String(f.note || ''); }).join(' ').toLowerCase();
    var text = String((sub && (sub.track_record || '') + ' ' + (sub.access_reach || '') + ' ' + (sub.extra || '')) || '').toLowerCase();
    return (rfp.docs || []).map(function (label) {
      var probe = DOC_KEYS.filter(function (p) { return p[0].test(label); })[0];
      var ok = false, note = '';
      if (files.length) {
        if (!probe) ok = files.length > 0;
        else ok = probe[1].some(function (k) { return names.indexOf(String(k).toLowerCase()) >= 0; });
      }
      if (!ok && probe && probe[1].some(function (k) { return text.indexOf(String(k).toLowerCase()) >= 0; })) { ok = true; note = '본문 기재'; }
      if (!ok && !files.length) note = '첨부 없음';
      return { label: label, ok: ok, note: note };
    });
  }

  /* ── 평가 초안(규칙 기반 · 확정 판단 아님) ─────────────────────── */
  function evaluationsOf(rfpId) {
    return list('evaluations').filter(function (e) { return e.rfp_id === rfpId; });
  }
  function evaluationOf(rfpId, advId) {
    var a = list('evaluations');
    for (var i = 0; i < a.length; i++) if (a[i].rfp_id === rfpId && String(a[i].advisor_id) === String(advId)) return a[i];
    return null;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function headcount(txt) {
    var m = String(txt || '').match(/(\d+)\s*명/);
    return m ? Number(m[1]) : 0;
  }
  function draftEvaluation(rfp, sub, subs) {
    subs = subs || submissionsOf(rfp.id);
    var fees = subs.map(function (s) { return num(s.fee_success); }).filter(function (x) { return x > 0; });
    var prices = subs.map(function (s) { return num(s.price_expect); }).filter(function (x) { return x > 0; });
    var periods = subs.map(function (s) { return num(s.period_months); }).filter(function (x) { return x > 0; });
    var minFee = fees.length ? Math.min.apply(null, fees) : 0;
    var maxPrice = prices.length ? Math.max.apply(null, prices) : 0;
    var minPeriod = periods.length ? Math.min.apply(null, periods) : 0;
    var single = subs.length < 2;
    var g = num(rfp.guide_eok);
    var items = {};
    function put(key, score, evidence, gap) { items[key] = { score: Math.round(clamp(score, 0, 100)), evidence: evidence, gap: gap || '' }; }
    var fee = num(sub.fee_success), pfee = num(sub.fee_fixed), price = num(sub.price_expect), per = num(sub.period_months);
    put('fee', single ? 70 : (minFee > 0 && fee > 0 ? minFee / fee * 100 : 70),
      '성공보수 ' + (fee ? n0(fee, 2) + '%' : '미기재') + (pfee ? ' · 고정 ' + n0(pfee, 2) + '억' : '') +
      (minFee ? ' / 제안 최저 ' + n0(minFee, 2) + '%' : ''),
      fee && minFee && fee > minFee * 1.15 ? '최저 제안 대비 ' + Math.round((fee / minFee - 1) * 100) + '% 높음' : '');
    put('price', single ? 70 : (maxPrice > 0 && price > 0 ? price / maxPrice * 100 : 70),
      price ? '예상 매각가 ' + n0(price, 0) + '억' + (g ? ' (가이드 ' + n0(g, 0) + '억 대비 ' + (price / g * 100).toFixed(1) + '%)' : '') : '예상 매각가 미기재',
      g && price && price < g * 0.97 ? '가이드 하회' : (price && maxPrice && price < maxPrice ? '제안 최고가 대비 ' + Math.round((1 - price / maxPrice) * 100) + '% 낮음' : ''));
    var tr = String(sub.track_record || '');
    var trN = (tr.match(/\d+\s*건/g) || []).length;
    put('track', tr ? clamp(60 + trN * 8 + (/억/.test(tr) ? 6 : 0), 55, 92) : 40,
      tr ? tr.slice(0, 90) : '유사 실적 미기재', tr ? (trN ? '' : '건수 표기 없음') : '실적 근거 없음');
    var ac = String(sub.access_reach || '');
    var pools = ['FI', 'SI', '화주', '해외'].filter(function (k) { return ac.toUpperCase().indexOf(k) >= 0; }).length;
    put('buyers', ac ? clamp(55 + pools * 8 + (/\d/.test(ac) ? 8 : 0), 50, 92) : 40,
      ac ? ac.slice(0, 90) : '투자자 접근 계획 미기재', ac && pools < 2 ? '접촉 대상 풀이 좁음' : '');
    /* 물건·시장 이해도 / 매각 전략 — 제안 본문(개요·일정·팀·추가서비스)에서 근거를 찾습니다. */
    var body = [sub.track_record, sub.access_reach, sub.team, sub.schedule, sub.extra, sub.memo].join(' ');
    put('understand', /시장|권역|공실|임대료|cap|금리/i.test(body) ? 72 : 55,
      /시장|권역|공실|임대료|cap|금리/i.test(body) ? '시장·물건 분석 언급 있음' : '물건·시장 분석 근거 미기재',
      /시장|권역|공실|임대료|cap|금리/i.test(body) ? '' : '분석 보완 요청');
    put('strategy', /전략|마케팅|티저|IM|투자자|입찰/i.test(body) ? 74 : 55,
      /전략|마케팅|티저|IM|입찰/i.test(body) ? '매각 전략·마케팅 계획 언급' : '매각 전략 근거 미기재',
      /전략|마케팅|티저|IM|입찰/i.test(body) ? '' : '전략 보완 요청');
    var hc = headcount(sub.team);
    put('team', hc >= 6 ? 85 : (hc >= 4 ? 78 : (hc ? 68 : 55)),
      sub.team ? sub.team.slice(0, 70) : '인력 구성 미기재', hc && hc <= 3 ? '전담 인력 ' + hc + '명' : '');
    put('sched', /D\s*\+/.test(String(sub.schedule || '')) ? 78 : (sub.schedule ? 70 : 55),
      sub.schedule ? sub.schedule.slice(0, 80) : '일정 미기재', sub.schedule && !/D\s*\+/.test(String(sub.schedule)) ? '구체 일자 없음' : '');
    put('extra', sub.extra ? clamp(65 + (String(sub.extra).length > 20 ? 10 : 0), 60, 85) : 55,
      sub.extra ? sub.extra.slice(0, 80) : '추가 서비스 미기재', '');
    put('period', single ? 70 : (minPeriod > 0 && per > 0 ? minPeriod / per * 100 : 70),
      per ? '예상 기간 ' + per + '개월' + (minPeriod ? ' / 최단 ' + minPeriod + '개월' : '') : '기간 미기재', '');

    var chk = checklistFor(rfp, sub);
    var missing = chk.filter(function (c) { return !c.ok; });
    var risks = [];
    if (missing.length) risks.push({ label: '요구 서류 미충족 ' + missing.length + '건', note: missing.map(function (m) { return m.label; }).join(', ') });
    if (g && price && price > g * 1.15) risks.push({ label: '가이드 대비 과도한 매각가', note: '실현 가능성·기간 리스크 확인 필요' });
    if (per && minPeriod && per - minPeriod >= 3) risks.push({ label: '기간이 최단 대비 김', note: per + '개월 vs ' + minPeriod + '개월' });
    if (!tr && !ac) risks.push({ label: '실적·투자자 접근 근거 부족', note: '추가 확인 요청 필요' });
    var wsum = 0, tsum = 0;
    (rfp.criteria || []).forEach(function (c) { var v = (items[c.key] || {}).score || 0; tsum += v * num(c.weight); wsum += num(c.weight); });
    var total = wsum > 0 ? Math.round(tsum / wsum) : 0;
    var best = Object.keys(items).sort(function (a, b) { return items[b].score - items[a].score; }).slice(0, 2);
    var label = function (k) { var hit = (rfp.criteria || []).filter(function (c) { return c.key === k; })[0]; return hit ? hit.label : k; };
    var summary = sub.advisor_company + ' — 종합 ' + total + '점(가중 평균). 강점: ' + best.map(label).join(' · ') +
      '. ' + (missing.length ? '요구 서류 ' + missing.length + '건 미충족.' : '요구 서류 충족.') +
      (risks.length ? ' 확인 필요: ' + risks.map(function (r) { return r.label; }).join(', ') + '.' : '');
    return {
      id: '', rfp_id: rfp.id, advisor_id: sub.advisor_id, company: sub.advisor_company,
      sub_id: sub.id, sub_version: sub.version || 1, draft: true, source: 'platform-draft',
      basis: '제출 제안서(항목값·첨부파일명) 대조 · 규칙 기반 계산 · 기준일 ' + today(),
      items: items, summary: summary, risks: risks, checklist: chk, total: total,
      status: '초안', at: new Date().toISOString()
    };
  }
  function draftAllEvaluations(rfp) {
    var subs = submissionsOf(rfp.id), out = [];
    subs.forEach(function (sub) {
      var d = draftEvaluation(rfp, sub, subs);
      var exist = evaluationOf(rfp.id, sub.advisor_id);
      var rec = exist || { id: uid('evl') };
      /* 사람이 수정한 score·comment 가 있으면 유지하고, 초안 재생성은 근거·요약만 갱신 */
      var items = {};
      (rfp.criteria || []).forEach(function (c) {
        var prev = (exist && exist.items && exist.items[c.key]) || {};
        var nw = d.items[c.key] || {};
        items[c.key] = {
          score: prev.score == null ? nw.score : prev.score,
          evidence: nw.evidence, gap: nw.gap,
          comment: prev.comment || ''
        };
      });
      rec = Object.assign(rec, {
        rfp_id: rfp.id, advisor_id: sub.advisor_id, company: sub.advisor_company,
        sub_id: sub.id, sub_version: sub.version || 1, draft: true, source: d.source, basis: d.basis,
        items: items, summary: exist && exist.summary_confirmed ? exist.summary : d.summary,
        risks: d.risks, checklist: d.checklist, total: d.total,
        status: (exist && exist.status === '검토 완료') ? '검토 완료' : '초안', at: new Date().toISOString()
      });
      commit('evaluations', rec);
      out.push(rec);
    });
    return out;
  }

  /* ── 선정 · 운용사 담당자 확인 ─────────────────────────────────── */
  function selectionOf(rfpId) {
    var a = list('selection');
    for (var i = 0; i < a.length; i++) if (a[i].rfp_id === rfpId) return a[i];
    return null;
  }
  function saveSelection(rfpId, patch) {
    var rec = selectionOf(rfpId) || { id: uid('sel'), rfp_id: rfpId, status: '후보', at: new Date().toISOString() };
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) rec[k] = patch[k];
    rec.updated_at = new Date().toISOString();
    return commit('selection', rec);
  }
  function pickAdvisor(rfp, advId, basis) {
    var rows = rankedScores(rfp.id);
    var row = rows.filter(function (r) { return String(r.sub.advisor_id) === String(advId); })[0];
    var m = me() || {};
    var sel = saveSelection(rfp.id, {
      advisor_id: advId, company: row ? row.sub.advisor_company : '',
      total: row ? row.total : 0, rank: row ? row.rank : 0, basis: basis || '',
      decided_by: m.name || '', decided_at: new Date().toISOString(), status: '선정'
    });
    list('submissions').forEach(function (s) {
      if (s.rfp_id !== rfp.id) return;
      s.status = String(s.advisor_id) === String(advId) ? '선정' : '미선정';
      commit('submissions', s);
    });
    rfp.selected_advisor_id = advId;
    return sel;
  }

  /* ── 선정 후 자문 수행 ─────────────────────────────────────────── */
  function perfOf(rfpId) {
    var a = list('performance');
    for (var i = 0; i < a.length; i++) if (a[i].rfp_id === rfpId) return a[i];
    return null;
  }
  function ensurePerf(rfp) {
    var p = perfOf(rfp.id);
    if (p) return p;
    var sel = selectionOf(rfp.id) || {};
    var base = rfp.issue_date ? new Date(rfp.issue_date + 'T00:00:00') : new Date();
    function dplus(n) { var d = new Date(base); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
    return commit('performance', {
      id: uid('prf'), rfp_id: rfp.id, advisor_id: sel.advisor_id || rfp.selected_advisor_id || '',
      company: sel.company || '', stage: '선정·착수', started_at: today(),
      milestones: [
        { name: '자료 인계(CA 접수)', due: dplus(21), done_at: '' },
        { name: 'TM/IM 완성', due: dplus(35), done_at: '' },
        { name: '마케팅 리스트 1차', due: dplus(38), done_at: '' },
        { name: 'LOI 마감', due: dplus(49), done_at: '' },
        { name: '최종 입찰', due: dplus(63), done_at: '' },
        { name: '계약·종결', due: dplus(90), done_at: '' }
      ],
      deliverables: [], reports: [], issues: [], at: new Date().toISOString()
    });
  }

  /* ── 문의·접촉 요청(VDR 접촉 창구) ─────────────────────────────── */
  function requestsOf(rfpId) {
    return list('requests').filter(function (r) { return !rfpId || r.rfp_id === rfpId; })
      .sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }
  function accessSummary(rfpId) {
    var a = accessLogOf(rfpId), by = {};
    a.forEach(function (x) { var k = x.holder || x.code || ''; by[k] = (by[k] || 0) + 1; });
    return { total: a.length, by: by };
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

  /* ── 투자자 LOI (기존 bidSubs 저장·검증 흐름 재사용) ─────────────── */
  var LOI_STATUS = ['접수', '검토중', '보완요청', '수용', '미수용'];
  function bidsOf(rfpId) {
    return list('bidSubs').filter(function (b) { return !rfpId || b.rfp_id === rfpId; })
      .sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }
  function loiOf(rfpId, participantId) {
    var a = bidsOf(rfpId);
    for (var i = 0; i < a.length; i++) {
      if (String(a[i].buyer_id) === String(participantId) && String(a[i].kind || 'LOI').toUpperCase() === 'LOI') return a[i];
    }
    return null;
  }
  function loiRows(rfp) {
    var ps = participantsOf(rfp.id).filter(function (p) { return p.party_type === '투자자' || p.party_type === '금융기관'; });
    var due = rfp.loi_due || '';
    var left = daysLeft(due);
    return ps.map(function (p) {
      var b = loiOf(rfp.id, p.id);
      var st = b ? (b.status || '접수') : '미제출';
      var flag = b ? '제출' : (left === null ? '미제출' : (left < 0 ? '지연' : (left <= 3 ? '임박' : '미제출')));
      return { participant: p, bid: b, status: st, flag: flag, left: left };
    });
  }
  function loiTemplateDownload(rfp, party) {
    var html = '<html><head><meta charset="utf-8"><title>LOI 제출 양식(임시)</title><style>body{font-family:"Malgun Gothic",sans-serif;font-size:10.5pt;line-height:1.7}' +
      'table{border-collapse:collapse;width:100%}th,td{border:1px solid #b9c6d6;padding:6pt;font-size:9.5pt}th{background:#eef2f7;text-align:left;width:24%}' +
      'h1{font-size:15pt}.n{font-size:9pt;color:#b3262c}</style></head><body>' +
      '<h1>Letter of Intent (LOI) — 임시 양식</h1>' +
      '<p class="n">※ 표준 LOI 양식 교체 예정. 이 파일은 자리 표시용이며 법무 확정본이 아닙니다. 전자서명·외부 연동 없음(Phase 2 검토).</p>' +
      '<table><tr><th>대상 물건</th><td>' + esc((rfp && rfp.asset_name) || '') + '</td></tr>' +
      '<tr><th>적용 딜</th><td>' + esc((rfp && rfp.title) || '') + ' / RFP ' + esc((rfp && rfp.id) || '') + '</td></tr>' +
      '<tr><th>제출자(회사)</th><td>' + esc((party && party.company) || '') + '</td></tr>' +
      '<tr><th>담당자·연락처</th><td>' + esc(((party && party.name) || '') + ' ' + ((party && party.email) || '')) + '</td></tr>' +
      '<tr><th>제시 매입가(억원)</th><td></td></tr><tr><th>자금조달(LTV·금리)</th><td></td></tr>' +
      '<tr><th>실사 기간·인수 시점</th><td></td></tr><tr><th>조건·비고</th><td></td></tr>' +
      '<tr><th>제출일·서명</th><td></td></tr></table></body></html>';
    download('LOI_양식_임시_' + safeName((rfp && rfp.asset_name) || 'RFP') + '.doc', '\ufeff' + html, 'application/msword;charset=utf-8');
  }

  /* ── 딜 카드용 요약 ─────────────────────────────────────────────── */
  function dealStats(rfp) {
    var inv = (rfp && rfp.invites) || [];
    var subs = submissionsOf(rfp.id);
    var cas = caSummaryOf(rfp.id);
    var evals = evaluationsOf(rfp.id);
    var sel = selectionOf(rfp.id);
    var perf = perfOf(rfp.id);
    return {
      invited: inv.length, submitted: subs.length, ca: cas.ca, parties: cas.total,
      evals: evals.length, evalsDone: evals.filter(function (e) { return e.status === '검토 완료'; }).length,
      dleft: daysLeft(rfp.due_date), loiLeft: daysLeft(rfp.loi_due || ''),
      loi: loiRows(rfp), selected: sel && sel.advisor_id ? sel : null,
      perf: perf, pendingReq: pendingRequests(rfp.id).length
    };
  }
  function nextActionOf(rfp) {
    var st = flowOf(rfp), s = dealStats(rfp);
    if (st === '초안') return s.invited ? '배포 단계로 넘기기' : '자문사 선택·배포';
    if (st === '배포') return s.submitted ? '접수 단계로 넘기기' : '제안서 접수 대기(미제출 ' + Math.max(0, s.invited - s.submitted) + ')';
    if (st === '접수') return s.evals ? '분석 단계로 넘기기' : '제안서 분석 → 평가 초안';
    if (st === '분석') return s.evalsDone < s.submitted ? '평가 검토 완료(' + s.evalsDone + '/' + s.submitted + ')' : '담당자 검토로 넘기기';
    if (st === '담당자 검토') return (s.selected && s.selected.review && s.selected.review.at) ? '외부 보고 단계로' : '운용사 담당자 확인 기록';
    if (st === '외부 보고') return s.selected ? '선정 확정' : '자문사 선정';
    if (st === '선정') return s.perf && s.perf.stage === '종결' ? '수행 종료' : '자문 수행 — ' + ((s.perf && s.perf.stage) || '선정·착수');
    return '';
  }
  function setPerfStage(rfp, stage, note) {
    var p = ensurePerf(rfp);
    p.stage = stage;
    if (stage === '종결') { p.closed_at = new Date().toISOString(); p.closed_by = (me() && me().name) || role(); }
    p.updated_at = new Date().toISOString();
    commit('performance', p);
    logHistory(rfp.id, flowOf(rfp), flowOf(rfp), '자문 수행 단계 → ' + stage + (note ? ' · ' + note : ''));
    return p;
  }

  /* ═══════════════════════════════════════════════════════════════
     투자자 제출물(LOI · LOC · 자금조달 계획서)과 롱/굿/숏리스트
     ═══════════════════════════════════════════════════════════════ */
  var SUBMIT_KINDS = [
    { k: 'LOI', label: 'LOI (매수의향서)', icon: '✉️', who: '투자자', hint: '매수후보가 제출하는 매수의향서' },
    { k: 'LOC', label: 'LOC (자금확보 확인서)', icon: '🏦', who: '금융기관', hint: '대출·금융주선 기관의 자금확보 확인서' },
    { k: '자금조달 계획서', label: '자금조달 계획서 (Source & Use)', icon: '📊', who: '투자자·금융기관', hint: '자금원천·증빙(S&U)' }
  ];
  var LIST_CRITERIA = [
    { key: 'price', label: '가격(제시 금액)', weight: 25 },
    { key: 'terms', label: '거래 조건', weight: 20 },
    { key: 'funding', label: '자금확보', weight: 25 },
    { key: 'dd', label: '실사 계획', weight: 15 },
    { key: 'track', label: '경험·실적', weight: 15 }
  ];
  function defaultListCriteria() { return LIST_CRITERIA.map(function (c) { return { key: c.key, label: c.label, weight: c.weight }; }); }
  function submitKindOf(k) {
    var key = String(k || '').toUpperCase().replace(/\s+/g, '');
    if (key === 'LOI') return 'LOI';
    if (key === 'LOC') return 'LOC';
    return '자금조달 계획서';
  }
  function submitRecords(rfpId, participantId, kind) {
    return list('submits').filter(function (s) {
      if (String(s.rfp_id) !== String(rfpId)) return false;
      if (participantId && String(s.participant_id) !== String(participantId)) return false;
      if (kind && submitKindOf(s.kind) !== submitKindOf(kind)) return false;
      return true;
    }).sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }
  function submitOf(rfpId, participantId, kind) { return submitRecords(rfpId, participantId, kind)[0] || null; }
  /* 참여자별 제출물 체크리스트 + 조합 표기 */
  function submitState(rfp, p) {
    var out = { kinds: {}, combo: '', count: 0, requiredMissing: [] };
    SUBMIT_KINDS.forEach(function (k) {
      var rec = submitOf(rfp.id, p.id, k.k);
      out.kinds[k.k] = rec;
      if (rec) out.count++;
    });
    var has = function (k) { return !!out.kinds[k]; };
    out.combo = has('LOI') && has('LOC') && has('자금조달 계획서') ? 'LOI+LOC+자금계획'
      : has('LOI') && has('LOC') ? 'LOI+LOC'
        : has('LOI') && has('자금조달 계획서') ? 'LOI+자금계획'
          : has('LOI') ? 'LOI만' : has('LOC') ? 'LOC만' : has('자금조달 계획서') ? '자금계획만' : '미제출';
    (rfp.require || []).forEach(function (k) { if (!has(submitKindOf(k))) out.requiredMissing.push(k); });
    return out;
  }
  function listsOf(rfpId) { return list('lists').filter(function (l) { return l.rfp_id === rfpId; }); }
  function listRowOf(rfpId, participantId) {
    var a = listsOf(rfpId);
    for (var i = 0; i < a.length; i++) if (String(a[i].participant_id) === String(participantId)) return a[i];
    return null;
  }
  function listMove(rfpId, participantId, toList, opts) {
    opts = opts || {};
    var rec = listRowOf(rfpId, participantId) || { id: uid('lst'), rfp_id: rfpId, participant_id: participantId, stage: '', history: [] };
    var from = rec.stage || '롱리스트';
    rec.stage = toList;
    rec.status = opts.status || (toList === '제외' ? '제외' : '통과');
    rec.reason_code = opts.reason_code || '';
    rec.memo = opts.memo != null ? opts.memo : (rec.memo || '');
    rec.by = (me() && me().name) || role();
    rec.at = new Date().toISOString();
    rec.history = (rec.history || []).concat([{ from: from, to: toList, status: rec.status, reason_code: rec.reason_code, memo: rec.memo, by: rec.by, at: rec.at }]);
    commit('lists', rec);
    logHistory(rfpId, flowOf(rfpOf(rfpId)), flowOf(rfpOf(rfpId)), '리스트 ' + from + ' → ' + toList + (opts.memo ? ' · ' + opts.memo : ''));
    return rec;
  }
  function listCriteria(rfp) { return (rfp && rfp.list_criteria && rfp.list_criteria.length) ? rfp.list_criteria : defaultListCriteria(); }
  /* 플랫폼 초안 점수(규칙 기반 · 확정 판단 아님) */
  function listDraftScores(rfp, p) {
    var st = submitState(rfp, p);
    var loi = st.kinds['LOI'], loc = st.kinds['LOC'], sny = st.kinds['자금조달 계획서'];
    var all = participantsOf(rfp.id).filter(function (x) { return x.party_type === '투자자' || x.party_type === '금융기관'; });
    var maxAmt = 0;
    all.forEach(function (x) { var s = submitState(rfp, x); ['LOI', 'LOC'].forEach(function (k) { maxAmt = Math.max(maxAmt, num(s.kinds[k] && s.kinds[k].amount_eok)); }); });
    var amt = Math.max(num(loi && loi.amount_eok), num(loc && loc.amount_eok));
    var v = {};
    v.price = amt > 0 && maxAmt > 0 ? clamp(amt / maxAmt * 100, 30, 100) : (amt ? 70 : 30);
    var termsLen = String((loi && loi.terms) || (loc && loc.terms) || '').length;
    v.terms = clamp(50 + Math.min(40, termsLen / 6), 40, 90);
    v.funding = (loc ? 55 : 0) + (sny ? 35 : 0) + (/확약|Commitment/i.test(String((sny && sny.note) || '')) ? 10 : 0) || 25;
    v.dd = /\(/.test(String((loi && loi.terms) || '')) || /실사/.test(String((loi && loi.terms) || '')) ? 70 : 50;
    v.track = clamp(50 + (String((loi && p.note) || '').length ? 10 : 0) + (loc ? 15 : 0), 40, 85);
    Object.keys(v).forEach(function (k) { v[k] = Math.round(clamp(v[k], 0, 100)); });
    var tot = 0, w = 0;
    listCriteria(rfp).forEach(function (c) { tot += (v[c.key] || 0) * num(c.weight); w += num(c.weight); });
    return { values: v, total: w > 0 ? Math.round(tot / w) : 0 };
  }
  function listOverview(rfp) {
    var ps = participantsOf(rfp.id).filter(function (p) { return p.party_type === '투자자' || p.party_type === '금융기관'; });
    return ps.map(function (p) {
      var st = submitState(rfp, p), row = listRowOf(rfp.id, p.id), draft = listDraftScores(rfp, p);
      return { p: p, submit: st, row: row, draft: draft, stage: (row && row.stage) || (st.count ? '롱리스트' : '') };
    });
  }

  /* ── 양식(임시) — 표준 샘플 교체 지점 ─────────────────────────── */
  var TEMPLATES = {
    'LOI': { name: 'LOI_양식_임시', note: '표준 LOI 양식 교체 예정(샘플 대기)' },
    'LOC': { name: 'LOC_양식_임시', note: '표준 LOC 양식 교체 예정(샘플 대기)' },
    '자금조달 계획서': { name: '자금조달계획서_S&U_임시', note: '표준 Source & Use 양식 교체 예정(샘플 대기)' },
    '입찰서류': { name: '입찰서류_패키지_임시', note: '표준 입찰 서류 패키지 교체 예정(샘플 대기 — 11/30~12/1 제공 예정)' },
    'CA': { name: 'CA_양식_임시', note: '표준 CA 양식 교체 예정(샘플 대기)' }
  };
  function templateDoc(kind, rfp, party) {
    var t = TEMPLATES[kind] || TEMPLATES['LOI'];
    var k = kind === '자금조달 계획서' ? 'S&U' : kind;
    var rows = '';
    if (kind === 'LOI') {
      rows = '<tr><th>제시 매입가(억원)</th><td></td></tr><tr><th>거래 조건</th><td></td></tr>' +
        '<tr><th>자금조달 개요</th><td></td></tr><tr><th>실사 기간·인수 시점</th><td></td></tr>';
    } else if (kind === 'LOC') {
      rows = '<tr><th>기관명·담당</th><td></td></tr><tr><th>확인 금액(억원)</th><td></td></tr>' +
        '<tr><th>LTV·금리·기간</th><td></td></tr><tr><th>선행조건</th><td></td></tr>';
    } else if (kind === '자금조달 계획서') {
      rows = '<tr><th>총 소요(억)</th><td></td></tr><tr><th>에쿼티(억)</th><td></td></tr><tr><th>선순위 대출(억)</th><td></td></tr>' +
        '<tr><th>중순위·기타(억)</th><td></td></tr><tr><th>증빙(확약서·계좌·IR)</th><td></td></tr>';
    } else {
      rows = '<tr><th>구성 서류</th><td>(샘플 수령 후 확정)</td></tr><tr><th>제출 형식</th><td>(샘플 수령 후 확정)</td></tr>';
    }
    var html = '<html><head><meta charset="utf-8"><title>' + esc(t.name) + '</title><style>body{font-family:"Malgun Gothic",sans-serif;font-size:10.5pt;line-height:1.7}' +
      'table{border-collapse:collapse;width:100%}th,td{border:1px solid #b9c6d6;padding:6pt;font-size:9.5pt}th{background:#eef2f7;text-align:left;width:26%}' +
      'h1{font-size:15pt}.n{font-size:9pt;color:#b3262c}</style></head><body>' +
      '<h1>' + esc(k) + ' 제출 양식 — 임시</h1>' +
      '<p class="n">※ ' + esc(t.note) + '. 이 파일은 자리 표시용이며 법무·실무 확정본이 아닙니다. 전자서명·외부 연동 없음(Phase 2 검토).</p>' +
      '<table><tr><th>대상 물건</th><td>' + esc((rfp && rfp.asset_name) || '') + '</td></tr>' +
      '<tr><th>적용 딜</th><td>' + esc((rfp && rfp.title) || '') + ' / RFP ' + esc((rfp && rfp.id) || '') + '</td></tr>' +
      '<tr><th>제출자(회사)</th><td>' + esc((party && party.company) || '') + '</td></tr>' +
      '<tr><th>담당자·연락처</th><td>' + esc(((party && party.name) || '') + ' ' + ((party && party.email) || '')) + '</td></tr>' +
      rows + '<tr><th>제출일·서명</th><td></td></tr></table></body></html>';
    download(t.name + '_' + safeName((rfp && rfp.asset_name) || 'RFP') + '.doc', '\ufeff' + html, 'application/msword;charset=utf-8');
  }

  function setCaForm(rfp, docId) {
    var d = docId ? byId('docs', docId) : null;
    rfp.ca_form_id = d ? d.id : '';
    rfp.ca_form_name = d ? d.name : '';
    commit('rfps', rfp);
    return rfp;
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
    codesOf: codesOf, validCode: validCode, findCode: findCode, issueCode: issueCode, normScope: normScope, logAccess: logAccess, accessLogOf: accessLogOf, makeCode: makeCode,
    session: session, setSession: setSession, codeLogin: codeLogin, clearApiToken: clearApiToken,
    visibleRfps: visibleRfps, visibleSubmissions: visibleSubmissions, visibleDocs: visibleDocs,
    poolOf: poolOf, loadInvestors: loadInvestors,
    modal: modal, closeModal: closeModal, fval: fval, fcheck: fcheck, fgroup: fgroup, field: field,
    download: download, downloadFile: downloadFile, csv: csv, printDoc: printDoc, exportWord: exportWord, safeName: safeName,
    exportAll: exportAll, importAll: importAll,
    /* 2026-11-28 파이프라인 */
    FLOW: FLOW, CA_STAGES: CA_STAGES, CA_STATUS: CA_STATUS, SPECIALTIES: SPECIALTIES, PARTY_TYPES: PARTY_TYPES,
    CA_TEMPLATE: CA_TEMPLATE, setCaForm: setCaForm, TPL: TPL, TPL_MATERIALS: TPL_MATERIALS, PERF_STAGES: PERF_STAGES, LOI_STATUS: LOI_STATUS, BASE_KINDS: BASE_KINDS,
    normStatus: normStatus, flowOf: flowOf, flowIndex: flowIndex, flowGuard: flowGuard, setStatus: setStatus,
    historyOf: historyOf, logHistory: logHistory,
    contacts: contacts, contactOf: contactOf, sampleContacts: sampleContacts, seedContacts: seedContacts, specText: specText,
    materialIds: materialIds, materialsOf: materialsOf, materialAcl: materialAcl, materialAccess: materialAccess,
    materialGroups: materialGroups, viewersOf: viewersOf,
    caDealOf: caDealOf, caDeal: caDeal, caReceiptOf: caReceiptOf, caOpenFor: caOpenFor, caOpen: caOpen,
    caReceiptCommit: caReceiptCommit, caSummaryOf: caSummaryOf,
    participantsOf: participantsOf, participantOf: participantOf, findParticipant: findParticipant,
    ensureParticipant: ensureParticipant, partyOfSession: partyOfSession,
    caTemplateHTML: caTemplateHTML, caTemplateDownload: caTemplateDownload,
    checklistFor: checklistFor, evaluationsOf: evaluationsOf, evaluationOf: evaluationOf,
    draftEvaluation: draftEvaluation, draftAllEvaluations: draftAllEvaluations,
    selectionOf: selectionOf, saveSelection: saveSelection, pickAdvisor: pickAdvisor,
    perfOf: perfOf, ensurePerf: ensurePerf, setPerfStage: setPerfStage,
    requestsOf: requestsOf, requestAdd: requestAdd, requestDecide: requestDecide, requestMemo: requestMemo,
    requestApproved: requestApproved, pendingRequests: pendingRequests, accessSummary: accessSummary,
    bidsOf: bidsOf, loiOf: loiOf, loiRows: loiRows, loiTemplateDownload: loiTemplateDownload,
    locOf: locOf, locLine: locLine, assetFull: assetFull, setLocVerify: setLocVerify, locVerifyOf: locVerifyOf, mapUrl: mapUrl, roadviewUrl: roadviewUrl,
    dealStats: dealStats, nextActionOf: nextActionOf,
    apiGetJSON: function (type, extra) { return apiGet(type, extra); },
    SUBMIT_KINDS: SUBMIT_KINDS, LIST_CRITERIA: LIST_CRITERIA, TEMPLATES: TEMPLATES,
    defaultListCriteria: defaultListCriteria, submitKindOf: submitKindOf, submitRecords: submitRecords,
    submitOf: submitOf, submitState: submitState, listsOf: listsOf, listRowOf: listRowOf, listMove: listMove,
    listCriteria: listCriteria, listDraftScores: listDraftScores, listOverview: listOverview, templateDoc: templateDoc
  };
})();
