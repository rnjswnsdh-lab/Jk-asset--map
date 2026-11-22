/* =========================================================================
   Open AI Asset Bridge (가칭) — app.js
   - NAI Korea 상업용 부동산 통합 지도 (프로토타입)
   - 상단 탭: 🗺️ 물건 지도 | 🤝 SI·화주 풀 | 🏦 FI 풀 | 📊 밸류에이션
   - 카카오맵 JavaScript API 기반 (키 없으면 좌표 미리보기 모드)
   - 7개 섹터(호텔·물류·오피스·데이터센터·화주·임차수요·리테일·멀티패밀리·임대·코리빙) 통합 조회
   - 필터/검색, 상세 패널, 인라인 수정, 신규 추가, localStorage 저장,
     JSON/CSV 내보내기, 원격 동기화 어댑터, IM(투자설명서) 링크
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var SECTORS = CFG.SECTORS || {
    hotel: { label: '호텔', color: '#e5484d', short: 'H' },
    logistics: { label: '물류센터', color: '#2f6fed', short: 'L' },
    office: { label: '오피스', color: '#12a06b', short: 'O' },
    datacenter: { label: '데이터센터', color: '#8b5cf6', short: 'D' },
    shipper: { label: '화주·임차수요', color: '#f97316', short: 'S' },
    retail: { label: '리테일', color: '#db2777', short: 'R' },
    living: { label: '멀티패밀리·임대·코리빙', color: '#0891b2', short: 'M' }
  };
  var STATUS_COLORS = CFG.STATUS_GROUPS || {};
  var SECTOR_KEYS = Object.keys(SECTORS);
  var DEFAULT_CENTER = CFG.DEFAULT_CENTER || { lat: 37.5665, lng: 126.978 };
  var DEFAULT_LEVEL = CFG.DEFAULT_LEVEL || 8;
  var LIST_LIMIT = CFG.LIST_RENDER_LIMIT || 600;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ────────────────────────────── 상태 ────────────────────────────── */
  var state = {
    meta: {},
    base: [],
    assets: [],
    index: {},              // id -> asset
    filtered: [],
    filters: {
      sectors: {},          // sector -> bool
      statuses: {},         // statusGroup -> bool
      region: 'ALL',
      subType: 'ALL',
      query: '',
      onlyIm: false
    },
    selectedId: null,
    role: 'external',      // admin | internal | external — 토큰 권한으로 서버가 정합니다
    me: null,              // { name, company } — 외부 방문자 신원
    panelMode: 'view',      // view | edit | add
    addMode: false,
    cluster: true,
    roadview: false,
    map: null,
    mapReady: false,
    geocoder: null,
    rvClient: null,
    rv: null,
    clusterer: null,
    markers: [],
    markerIndex: {},        // assetId -> marker
    markerMeta: {},         // marker key -> {sector,count}
    markerImageCache: {},
    preview: null,
    overlay: { savedAt: 0, added: [], updated: {}, deleted: [] },
    listExpanded: false,
    mapInitDone: false
  };

  /* ────────────────────────────── 유틸 ────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }
  function fmt(v) {
    if (v === null || v === undefined || v === '') return '';
    return String(v);
  }
  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function sectorLabel(k) { return (SECTORS[k] && SECTORS[k].label) || k || '기타'; }
  function sectorColor(k) { return (SECTORS[k] && SECTORS[k].color) || '#64748b'; }

  /* 섹터별 상세 스펙 라벨 — 같은 필드를 섹터에 맞는 이름으로 보여 줍니다. */
  var DETAIL_LABELS = {
    shipper: {
      '운용사/소유주': '화주사 · 업종',
      '펀드/리츠': '',
      '규모': '사용·임차 규모',
      '가격': '',
      '임차인/운영': '담당자',
      '만기/일정': '부족·확장 권역 / 일정'
    },
    retail: {
      '규모': '연면적·GLA',
      '임차인/운영': '주요 임차·운영'
    },
    living: {
      '규모': '연면적·세대수',
      '임차인/운영': '운영·임차',
      '만기/일정': '준공·만기 / 일정'
    }
  };
  function detailLabel(sector, key) {
    var m = DETAIL_LABELS[sector];
    return (m && Object.prototype.hasOwnProperty.call(m, key)) ? m[key] : key;
  }
  function statusColor(g) { return STATUS_COLORS[g] || '#64748b'; }
  function isHttp(u) { return /^https?:\/\//i.test(String(u || '').trim()); }
  function coordKey(a) { return (Number(a.lat).toFixed(5) + ',' + Number(a.lng).toFixed(5)); }

  var toastTimer = null;
  function toast(msg, isErr) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2800);
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  }

  /* ──────────────── 접속코드 · 저장(localStorage) · 구글시트 동기화 ──────────────── */
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var CACHE_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':cache:v1';
  var PENDING_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':pending:v1';

  function isRemote() { return !!(CFG.SYNC_URL && String(CFG.SYNC_URL).trim()); }

  function normCode(s) { return String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase(); }

  function sha256Hex(text) {
    if (!(window.crypto && window.crypto.subtle)) {
      return Promise.reject(new Error('이 브라우저에서는 HTTPS(또는 localhost) 접속에서만 접속코드를 쓸 수 있습니다.'));
    }
    var buf = new TextEncoder().encode(text);
    return window.crypto.subtle.digest('SHA-256', buf).then(function (h) {
      return Array.prototype.map.call(new Uint8Array(h), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  /** 사용자가 입력한 접속코드 → 서버 토큰. 64자리 원문 토큰을 넣어도 됩니다. */
  function codeToToken(code) {
    var raw = String(code || '').trim();
    if (normCode(raw).length >= 40) return Promise.resolve(raw);
    return sha256Hex('nai-asset-map:' + normCode(raw));
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* noop */ } }
  function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* noop */ } }

  function syncGet(token) {
    var url = CFG.SYNC_URL + (CFG.SYNC_URL.indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(token);
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }

  function syncPost(payload) {
    var body = Object.assign({ token: getToken() }, payload);
    return fetch(CFG.SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function newOpKey() { return 'op-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }

  function readPending() {
    try {
      var v = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function writePending(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-300))); } catch (e) { /* noop */ }
  }
  function enqueue(op) {
    op.key = op.key || newOpKey();
    var l = readPending();
    l.push(op);
    writePending(l);
  }

  /** 저장 대기 중인 변경을 서버로 밀어 넣습니다. */
  function flushPending() {
    var list = readPending();
    if (!canEdit()) { writePending([]); return Promise.resolve(); }
    if (!list.length || !isRemote() || !getToken()) return Promise.resolve();
    setSyncStatus('저장 중…');
    return list.reduce(function (p, op) {
      return p.then(function () {
        var body = op.action === 'delete'
          ? { action: 'delete', id: op.target }
          : { action: 'upsert', asset: op.asset };
        return syncPost(body).then(function (j) {
          if (j && j.ok) {
            writePending(readPending().filter(function (x) { return x.key !== op.key; }));
          }
        }).catch(function () { /* 다음 기회에 재시도 */ });
      });
    }, Promise.resolve()).then(function () {
      var left = readPending().length;
      setSyncStatus(left ? '저장 대기 ' + left + '건' : '동기화됨', !!left);
    });
  }

  /** 단건 추가·수정·삭제를 서버에 반영합니다. 실패하면 대기열에 남겨 다시 시도합니다. */
  function pushOp(op) {
    if (!canEdit()) { toast('읽기 전용 모드입니다.', true); return Promise.resolve(false); }
    if (!isRemote()) return Promise.resolve(true);
    op.key = op.key || newOpKey();
    if (!getToken()) {
      enqueue(op);
      setSyncStatus('접속 필요', true);
      return Promise.resolve(false);
    }
    setSyncStatus('저장 중…');
    var body = op.action === 'delete'
      ? { action: 'delete', id: op.target }
      : { action: 'upsert', asset: op.asset };
    return syncPost(body).then(function (j) {
      if (j && j.ok) { setSyncStatus('동기화됨'); return true; }
      setSyncStatus(j && j.error === 'unauthorized' ? '접속코드 확인' : '동기화 실패', true);
      enqueue(op);
      return false;
    }).catch(function (e) {
      console.warn('[sync] push 실패', e);
      setSyncStatus('오프라인 저장', true);
      enqueue(op);
      return false;
    });
  }

  function cacheSave() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        saved_at: Date.now(), meta: state.meta, assets: state.base
      }));
    } catch (e) { /* noop */ }
  }

  function cacheLoad() {
    try {
      var o = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (o && Array.isArray(o.assets) && o.assets.length) return o;
    } catch (e) { /* noop */ }
    return null;
  }

  function computeMeta(assets) {
    var c = { total: assets.length, with_coords: 0, by_sector: {} };
    assets.forEach(function (a) {
      var has = !!(a.lat && a.lng);
      if (has) c.with_coords++;
      var s = a.sector || 'etc';
      var b = c.by_sector[s] || { total: 0, with_coords: 0 };
      b.total++;
      if (has) b.with_coords++;
      c.by_sector[s] = b;
    });
    var days = {};
    assets.forEach(function (a) { if (a.updated_at) days[a.updated_at] = 1; });
    return {
      version: Object.keys(days).sort().pop() || '-',
      counts: c,
      source: 'Google Sheets(비공개) · Apps Script 실시간 동기화'
    };
  }

  /** 서버 데이터(또는 캐시)를 앱 상태에 반영합니다. */
  function applyDataset(assets, meta) {
    state.base = assets;
    state.meta = meta || computeMeta(assets);
    rebuild();
  }

  function stripInternal(a) {
    var o = Object.assign({}, a);
    delete o._hay; delete o._edited; delete o._added;
    return o;
  }

  /** 목록(여러 건)을 한 번에 저장합니다(IM 일괄 등록 등). */
  function commitUpserts(list) {
    if (!list || !list.length) return;
    if (!canEdit()) { toast('읽기 전용 모드입니다.', true); return; }
    var byId = {};
    state.base.forEach(function (a) { byId[a.id] = a; });
    list.forEach(function (a) { byId[a.id] = a; });
    state.base = Object.keys(byId).map(function (k) { return byId[k]; });
    state.meta = computeMeta(state.base);
    rebuild();
    cacheSave();
    if (!isRemote()) return;
    var payload = list.map(stripInternal);
    setSyncStatus('저장 중…');
    syncPost({ action: 'upsert', assets: payload }).then(function (j) {
      if (j && j.ok) setSyncStatus('동기화됨');
      else {
        setSyncStatus('동기화 실패', true);
        payload.forEach(function (a) { enqueue({ action: 'upsert', asset: a }); });
      }
    }).catch(function () {
      setSyncStatus('오프라인 저장', true);
      payload.forEach(function (a) { enqueue({ action: 'upsert', asset: a }); });
    });
  }

  function setSyncStatus(text, isErr) {
    var el = $('#syncStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    el.className = 'sync-chip' + (isErr ? ' err' : '') + (text === '저장 중…' ? ' busy' : '');
  }

  /* ──────────────────── 권한 3단 (관리자 / 내부용 / 외부 방문자) ──────────────────── */
  function canEdit() { return state.role === 'admin'; }
  function isExternal() { return state.role === 'external'; }
  function roleLabel(r) { return r === 'admin' ? '관리자' : (r === 'internal' ? '내부용' : '외부 방문자'); }

  /** 접속 권한에 따른 화면 잠금: 내부용은 수정 불가, 외부용은 수정·추가·삭제·메일 바를 숨깁니다. */
  function applyRoleUI() {
    var role = state.role;
    var admin = role === 'admin';
    var ext = role === 'external';
    document.body.classList.toggle('readonly', !admin);
    document.body.classList.toggle('role-external', ext);
    document.body.classList.toggle('role-internal', role === 'internal');
    var addBtn = $('#btnAdd');
    if (addBtn) { addBtn.classList.toggle('hidden', !admin); addBtn.disabled = !admin; }
    var badge = $('#roleBadge');
    if (badge) {
      badge.classList.remove('hidden');
      badge.textContent = roleLabel(role);
      badge.className = 'role-chip' + (role === 'internal' ? ' is-internal' : (ext ? ' is-external' : ''));
      badge.title = ext
        ? ('리멤버 명함 인증 세션' + (state.me && state.me.name ? ' · ' + state.me.name : '') + ' — 담당자 연락처 비공개')
        : (role === 'internal' ? '내부용 — 전화번호는 서버에서 가려집니다' : '관리자 — 전체 조회·수정·저장·삭제');
    }
    var codeBtn = $('#btnCodeChange');
    if (codeBtn) codeBtn.title = ext ? '외부 세션 종료 (접속 화면으로)' : '접속코드 변경 (관리자 / 내부용)';
    $$('#exportMenu [data-export="im-import"], #exportMenu [data-export="reset"]').forEach(function (b) {
      b.classList.toggle('hidden', !admin);
    });
    var compose = $('#poolCompose');
    if (compose) compose.classList.toggle('hidden', ext);
    var mailToggle = $('#poolOnlyEmail');
    if (mailToggle && mailToggle.parentNode) mailToggle.parentNode.classList.toggle('hidden', ext);
    if (!admin && (state.panelMode === 'edit' || state.panelMode === 'add')) {
      state.panelMode = 'view';
      if (state.selectedId) renderDetail();
      else $('#detailPanel').classList.add('hidden');
    }
    if (window.NAI_POOL_ROLE_SYNC) { try { window.NAI_POOL_ROLE_SYNC(); } catch (e) { /* noop */ } }
  }

  /** 주요 조회·탭 이동·물건 클릭을 비동기로 서버(access_logs)에 남깁니다. */
  var lastLog = { key: '', at: 0 };
  function logEvent(kind, detail) {
    if (!isRemote() || !getToken()) return;
    var key = String(kind || '') + '|' + String(detail || '');
    var now = Date.now();
    if (key === lastLog.key && now - lastLog.at < 4000) return;
    lastLog = { key: key, at: now };
    try {
      syncPost({ action: 'log_event', kind: String(kind || 'event'), detail: String(detail || '').slice(0, 160) })
        .catch(function () { /* 로그 실패는 화면과 무관 */ });
    } catch (e) { /* noop */ }
  }


  function persistOverlay(silent) {
    cacheSave();
    if (!silent) updateStorageHint();
  }

  function hasChanges() {
    return readPending().length > 0;
  }

  function updateStorageHint() {
    var line = $('#metaLine');
    if (!line) return;
    var c = state.meta.counts || {};
    var bits = [];
    bits.push((c.total || state.assets.length) + '건');
    if (c.with_coords !== undefined) bits.push('좌표 ' + c.with_coords + '건');
    bits.push('기준 ' + (state.meta.version || '-'));
    var pend = readPending().length;
    if (pend) bits.push('저장 대기 ' + pend + '건');
    line.textContent = bits.join(' · ');
  }

  /* ────────────────────────────── 데이터 ────────────────────────────── */


  function buildAssets() {
    // 서버(비공개 Google 시트)에서 받은 목록이 원본입니다.
    state.index = {};
    state.assets = state.base.slice();
    state.assets.forEach(function (a) { state.index[a.id] = a; });
    indexSearch();
  }

  function indexSearch() {
    state.assets.forEach(function (a) {
      if (a._hay) return;
      var parts = [a.name, a.owner_amc, a.fund_vehicle, a.address, a.tenants, a.notes,
        a.sub_type, a.status, a.status_group, a.region, a.scale_info, a.price_info, a.source];
      if (a.facts) a.facts.forEach(function (f) { parts.push(f.label + ' ' + f.value); });
      a._hay = parts.join(' ').toLowerCase();
    });
  }

  /* ────────────────────────────── 필터 ────────────────────────────── */
  function initFilters() {
    var sc = {}, gc = {}, regions = {}, subTypes = {};
    state.assets.forEach(function (a) {
      sc[a.sector] = (sc[a.sector] || 0) + 1;
      if (a.status_group) gc[a.status_group] = (gc[a.status_group] || 0) + 1;
      if (a.region) regions[a.region] = (regions[a.region] || 0) + 1;
      if (a.sub_type) subTypes[a.sub_type] = (subTypes[a.sub_type] || 0) + 1;
    });
    SECTOR_KEYS.forEach(function (k) {
      if (state.filters.sectors[k] === undefined) state.filters.sectors[k] = true;
    });
    // 섹터 칩
    var host = $('#sectorFilters');
    host.innerHTML = SECTOR_KEYS.map(function (k) {
      var on = state.filters.sectors[k] !== false;
      return '<button type="button" class="chip sector-chip ' + (on ? 'is-on' : 'is-off') + '" data-sector="' + k + '" ' +
        'style="color:' + sectorColor(k) + '" aria-pressed="' + on + '">' +
        '<span class="dot" style="background:' + sectorColor(k) + '"></span>' +
        '<span style="color:var(--text)">' + esc(SECTORS[k].label) + '</span>' +
        '<span class="cnt">' + (sc[k] || 0) + '</span></button>';
    }).join('');

    // 상태 칩 (데이터에 있는 그룹만, 의미 있는 순서)
    var order = ['운영중', '개발중', '거래진행중', '거래완료', '만기·매각예정', '검토중', '매각철회'];
    Object.keys(gc).forEach(function (g) { if (order.indexOf(g) === -1) order.push(g); });
    var statuses = order.filter(function (g) { return gc[g]; });
    var shost = $('#statusFilters');
    shost.innerHTML = statuses.map(function (g) {
      var on = state.filters.statuses[g] !== false;
      return '<button type="button" class="chip ' + (on ? 'is-on' : 'is-off') + '" data-status="' + esc(g) + '" ' +
        'style="color:' + statusColor(g) + '" aria-pressed="' + on + '">' +
        '<span class="dot" style="background:' + statusColor(g) + '"></span>' +
        '<span style="color:var(--text)">' + esc(g) + '</span>' +
        '<span class="cnt">' + gc[g] + '</span></button>';
    }).join('');

    // 지역
    var sel = $('#regionSelect');
    var rs = Object.keys(regions).sort(function (a, b) { return regions[b] - regions[a]; });
    sel.innerHTML = '<option value="ALL">전체 지역 (' + state.assets.length + ')</option>' +
      rs.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + ' (' + regions[r] + ')</option>'; }).join('');
    if (state.filters.region !== 'ALL' && rs.indexOf(state.filters.region) === -1) state.filters.region = 'ALL';
    sel.value = state.filters.region;

    // 구분(sub_type)
    var stSel = $('#subTypeSelect');
    if (stSel) {
      var sts = Object.keys(subTypes).sort(function (a, b) { return subTypes[b] - subTypes[a]; });
      stSel.innerHTML = '<option value="ALL">전체 구분</option>' +
        sts.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + ' (' + subTypes[t] + ')</option>'; }).join('');
      if (state.filters.subType !== 'ALL' && sts.indexOf(state.filters.subType) === -1) state.filters.subType = 'ALL';
      stSel.value = state.filters.subType;
    }

    updateSectorAllLabel();
  }

  function updateSectorAllLabel() {
    var allOn = SECTOR_KEYS.every(function (k) { return state.filters.sectors[k] !== false; });
    var btn = $('#btnSectorAll');
    if (btn) btn.textContent = allOn ? '전체 해제' : '전체 선택';
  }

  function applyFilters() {
    var f = state.filters;
    var tokens = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);

    state.filtered = state.assets.filter(function (a) {
      if (f.sectors[a.sector] === false) return false;
      if (f.statuses[a.status_group] === false) return false;
      if (f.region !== 'ALL' && a.region !== f.region) return false;
      if (f.subType !== 'ALL' && a.sub_type !== f.subType) return false;
      if (f.onlyIm && !isHttp(a.im_url)) return false;
      if (tokens.length) {
        var hay = a._hay || '';
        for (var i = 0; i < tokens.length; i++) {
          if (hay.indexOf(tokens[i]) === -1) return false;
        }
      }
      return true;
    });

    state.filtered.sort(function (a, b) {
      var sa = SECTOR_KEYS.indexOf(a.sector), sb = SECTOR_KEYS.indexOf(b.sector);
      if (sa !== sb) return sa - sb;
      return String(a.name).localeCompare(String(b.name), 'ko');
    });

    renderList();
    renderMarkers();
    updateResultCount();
  }

  function updateResultCount() {
    var n = state.filtered.length;
    var withCoord = state.filtered.filter(function (a) { return a.lat && a.lng; }).length;
    $('#resultCount').textContent = n + '건' + (withCoord < n ? ' (지도 표시 ' + withCoord + ')' : '');
  }

  /* ────────────────────────────── 목록 ────────────────────────────── */
  function renderList() {
    var host = $('#assetList');
    var items = state.filtered;
    var limit = state.listExpanded ? items.length : Math.min(items.length, LIST_LIMIT);
    if (!items.length) {
      host.innerHTML = '<div class="empty-state">조건에 맞는 물건이 없습니다.<br>검색어나 필터를 조정해 보세요.</div>';
      $('#listMore').classList.add('hidden');
      return;
    }
    var html = [];
    for (var i = 0; i < limit; i++) {
      var a = items[i];
      var color = sectorColor(a.sector);
      var edited = !!(a._edited || a._added);
      html.push(
        '<button type="button" class="asset-row' + (a.id === state.selectedId ? ' is-selected' : '') + '" data-id="' + esc(a.id) + '" role="listitem">' +
        '<span class="bar" style="background:' + color + '"></span>' +
        '<span class="row-main">' +
        '<span class="row-name">' + esc(a.name) + (isHttp(a.im_url) ? ' <span class="im-mini" title="IM 링크 있음">📄</span>' : '') + '</span>' +
        '<span class="row-sub">' + esc([a.owner_amc, a.region, a.scale_info].filter(Boolean).join(' · ')) + '</span>' +
        '</span>' +
        '<span class="row-right">' +
        '<span class="pill" style="background:' + statusColor(a.status_group) + '">' + esc(a.status_group || a.status || '') + '</span>' +
        '<span class="row-meta">' + esc(a.maturity_schedule && a.maturity_schedule !== '미기재' ? a.maturity_schedule : (a.sub_type || '')) + '</span>' +
        '</span></button>'
      );
    }
    host.innerHTML = html.join('');
    var more = $('#listMore');
    if (items.length > limit) {
      more.classList.remove('hidden');
      more.innerHTML = '전체 ' + items.length + '건 중 ' + limit + '건 표시 — <button type="button" class="mini-btn" id="btnListMore">모두 보기</button>';
    } else {
      more.classList.add('hidden');
    }
  }

  function scrollSelectedIntoView() {
    var el = $('.asset-row.is-selected');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  /* ────────────────────────────── 선택 ────────────────────────────── */
  function selectAsset(id, opts) {
    opts = opts || {};
    var a = state.index[id];
    if (!a) return;
    if (state.addMode) setAddMode(false);
    var prev = state.selectedId;
    state.selectedId = id;
    state.panelMode = 'view';
    renderDetail();
    $('#detailPanel').classList.remove('hidden');
    closeSidebarOnMobile();
    highlightRows(prev, id);
    if (opts.pan !== false) panTo(a);
    if (state.roadview) showRoadview(a);
    logEvent('asset', a.name || id);
    try { history.replaceState(null, '', '#' + encodeURIComponent(id)); } catch (e) { /* file:// 등 */ }
  }

  function highlightRows(prevId, id) {
    if (prevId) {
      var p = $('.asset-row[data-id="' + cssEscape(prevId) + '"]');
      if (p) p.classList.remove('is-selected');
    }
    var el = $('.asset-row[data-id="' + cssEscape(id) + '"]');
    if (el) { el.classList.add('is-selected'); el.scrollIntoView({ block: 'nearest' }); }
    updateMarkerStyle(prevId, false);
    updateMarkerStyle(id, true);
  }

  function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function panTo(a) {
    if (!a.lat || !a.lng) return;
    if (state.map) {
      var pos = new kakao.maps.LatLng(a.lat, a.lng);
      state.map.panTo(pos);
      if (state.map.getLevel() > 6) state.map.setLevel(5);
    } else if (state.preview) {
      state.preview.focus(a);
    }
  }

  /* ────────────────────────────── 상세 패널 ────────────────────────────── */
  function renderDetail() {
    var root = $('#detailPanel');
    if (state.panelMode === 'add') { renderAddForm(root, state._addPrefill || {}); return; }
    var a = state.index[state.selectedId];
    if (!a) { root.classList.add('hidden'); root.innerHTML = ''; return; }

    if (state.panelMode === 'edit') { renderEditForm(root, a); return; }

    var groupsNow = groupByCoord(state.filtered);
    var siblings = groupsNow[coordKey(a)] || [];
    var rows = [
      ['섹터', sectorLabel(a.sector)],
      ['구분', a.sub_type],
      ['진행상태', a.status || a.status_group],
      ['운용사/소유주', a.owner_amc],
      ['펀드/리츠', a.fund_vehicle],
      ['규모', a.scale_info],
      ['가격', a.price_info],
      ['임차인/운영', a.tenants],
      ['만기/일정', a.maturity_schedule],
      ['주소', a.address],
      ['좌표', (a.lat && a.lng) ? (a.lat + ', ' + a.lng) : '좌표 미확정'],
      ['좌표 정확도', a.coord_precision],
      ['최종 갱신', a.updated_at]
    ].map(function (r) { return [detailLabel(a.sector, r[0]), r[1]]; })
      .filter(function (r) { return r[0] && r[1] !== undefined && r[1] !== null && String(r[1]).trim() !== ''; });

    var badges = [];
    badges.push('<span class="badge status" style="background:' + statusColor(a.status_group) + '">' + esc(a.status_group || '상태 미정') + '</span>');
    if (a.sub_type && a.sub_type !== a.status_group) badges.push('<span class="badge type">' + esc(a.sub_type) + '</span>');
    if (a._added) badges.push('<span class="badge added">신규 추가됨</span>');
    else if (a._edited) badges.push('<span class="badge edited">수정됨</span>');
    if (!(a.lat && a.lng)) badges.push('<span class="badge warn">좌표 미확정</span>');

    var html = '';
    html += '<div class="detail-head">';
    html += '<div class="detail-top"><span class="sector-dot" style="background:' + sectorColor(a.sector) + '"></span>';
    html += '<h2 class="detail-title">' + esc(a.name) + '</h2>';
    html += '<button type="button" class="detail-close" data-act="close" aria-label="닫기">×</button></div>';
    html += '<div class="detail-sub">' + esc([sectorLabel(a.sector), a.region, a.address].filter(Boolean).join(' · ')) + '</div>';
    html += '<div class="badges">' + badges.join('') + '</div>';
    html += '<div class="detail-actions">';
    html += '<button type="button" class="action-btn sim" data-act="simulate" title="렌트롤·OPEX 기준 수익성·민감도 시뮬레이터로 이동">📊 수익성 시뮬레이션</button>';
    if (canEdit()) {
      html += '<button type="button" class="action-btn primary" data-act="edit">✏️ 수정</button>';
      if (a.lat && a.lng && state.mapReady) html += '<button type="button" class="action-btn" data-act="roadview">🛣 로드뷰</button>';
      html += '<button type="button" class="action-btn" data-act="kakaomap">카카오맵에서 열기</button>';
      html += '<button type="button" class="action-btn" data-act="copy">주소 복사</button>';
      html += '<button type="button" class="action-btn danger" data-act="delete">삭제</button>';
    } else {
      if (a.lat && a.lng && state.mapReady) html += '<button type="button" class="action-btn" data-act="roadview">🛣 로드뷰</button>';
      html += '<button type="button" class="action-btn" data-act="kakaomap">카카오맵에서 열기</button>';
      html += '<button type="button" class="action-btn" data-act="copy">주소 복사</button>';
    }
    html += '</div>';
    if (isHttp(a.im_url)) {
      html += '<a class="im-btn" href="' + esc(a.im_url) + '" target="_blank" rel="noopener noreferrer">' +
        '<span>📄 IM 열기</span>' +
        (a.im_label ? '<span class="im-btn-label">' + esc(a.im_label) + '</span>' : '') +
        '<span class="im-btn-arrow" aria-hidden="true">↗</span></a>';
    }
    html += '</div>';

    html += '<div class="detail-scroll">';
    html += '<section class="detail-section"><h4>기본 정보</h4><div class="kv-grid">';
    rows.forEach(function (r) {
      var val = r[1];
      html += '<div class="kv"><span class="kv-label">' + esc(r[0]) + '</span><span class="kv-value">' + esc(val) + '</span></div>';
    });
    html += '</div></section>';

    if (a.facts && a.facts.length) {
      html += '<section class="detail-section"><h4>상세 스펙</h4><table class="facts">';
      a.facts.forEach(function (f) {
        html += '<tr><th>' + esc(f.label) + '</th><td>' + esc(f.value) + '</td></tr>';
      });
      html += '</table></section>';
    }

    if (siblings.length > 1) {
      html += '<section class="detail-section"><h4>같은 위치의 물건 ' + siblings.length + '건</h4><div class="sibling-list">';
      siblings.forEach(function (s) {
        html += '<button type="button" class="sibling-btn" data-act="sibling" data-id="' + esc(s.id) + '">' +
          '<span class="dot" style="background:' + sectorColor(s.sector) + '"></span>' +
          '<span>' + esc(s.name) + '</span>' +
          '<span style="margin-left:auto;color:var(--muted);font-size:10.5px">' + esc(s.status_group || '') + '</span></button>';
      });
      html += '</div></section>';
    }

    if (a.notes) {
      html += '<section class="detail-section"><h4>비고 · 메모</h4><div class="detail-note">' + esc(a.notes) + '</div></section>';
    }
    if (isHttp(a.im_url)) {
      html += '<section class="detail-section"><h4>IM (투자설명서)</h4><div class="detail-source" style="word-break:break-all">' +
        '<a href="' + esc(a.im_url) + '" target="_blank" rel="noopener noreferrer">' + esc(a.im_url) + '</a>' +
        (a.im_label ? '<br>' + esc(a.im_label) : '') + '</div></section>';
    }
    if (a.links && a.links.length) {
      html += '<section class="detail-section"><h4>관련 링크</h4><div class="link-list">';
      a.links.forEach(function (l) {
        if (isHttp(l.url)) html += '<a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.label || '링크') + ' ↗</a>';
      });
      html += '</div></section>';
    }
    if (a.source) {
      html += '<section class="detail-section"><h4>출처</h4><div class="detail-source">' + esc(a.source) + '</div></section>';
    }
    html += '<section class="detail-section"><div class="detail-source" style="font-size:10.5px">ID ' + esc(a.id) + '</div></section>';
    html += '</div>';

    root.innerHTML = html;
    root.classList.remove('hidden');
    $('.detail-scroll', root).scrollTop = 0;
  }

  function formField(label, name, value, opts) {
    opts = opts || {};
    var type = opts.type || 'text';
    var cls = 'field' + (opts.wide ? ' wide' : '');
    var input;
    if (type === 'textarea') {
      input = '<textarea name="' + name + '" placeholder="' + esc(opts.placeholder || '') + '">' + esc(value) + '</textarea>';
    } else if (type === 'select') {
      input = '<select name="' + name + '">' + opts.options.map(function (o) {
        return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('') + '</select>';
    } else {
      input = '<input name="' + name + '" type="' + type + '" value="' + esc(value) + '" placeholder="' + esc(opts.placeholder || '') + '"' +
        (opts.step ? ' step="' + opts.step + '"' : '') + '>';
    }
    return '<div class="' + cls + '"><label>' + esc(label) + '</label>' + input +
      (opts.hint ? '<span class="hint">' + opts.hint + '</span>' : '') + '</div>';
  }

  function sectorOptions(selected) {
    return SECTOR_KEYS.map(function (k) { return { value: k, label: SECTORS[k].label }; });
  }
  function statusGroupOptions(selected) {
    var order = ['운영중', '개발중', '거래진행중', '거래완료', '만기·매각예정', '검토중', '매각철회'];
    return order.map(function (g) { return { value: g, label: g }; });
  }

  function renderEditForm(root, a) {
    if (!canEdit()) return;
    var html = '';
    html += '<div class="detail-head">';
    html += '<div class="detail-top"><span class="sector-dot" style="background:' + sectorColor(a.sector) + '"></span>';
    html += '<h2 class="detail-title">물건 수정</h2>';
    html += '<button type="button" class="detail-close" data-act="cancelEdit" aria-label="닫기">×</button></div>';
    html += '<div class="detail-sub">' + esc(a.name) + '</div>';
    html += '</div>';
    html += '<div class="detail-scroll"><form id="assetForm" data-mode="edit" data-id="' + esc(a.id) + '"><section class="detail-section">';
    html += '<div class="form-grid">';
    html += formField('물건명 *', 'name', a.name, { wide: true });
    html += formField('섹터', 'sector', a.sector, { type: 'select', options: sectorOptions() });
    html += formField('구분', 'sub_type', a.sub_type, { placeholder: '예: 운영중, 컨버전, 신축·개발' });
    html += formField('진행상태', 'status', a.status, { placeholder: '예: 공사 중, 출현 예상' });
    html += formField('상태 그룹', 'status_group', a.status_group, { type: 'select', options: statusGroupOptions() });
    html += formField(detailLabel(a.sector, '운용사/소유주') || '운용사/소유주', 'owner_amc', a.owner_amc);
    html += formField('펀드/리츠/법인', 'fund_vehicle', a.fund_vehicle);
    html += formField(detailLabel(a.sector, '규모') || '규모', 'scale_info', a.scale_info, { placeholder: '예: 434실 · 5성 / 연면적 12,163㎡' });
    html += formField('가격', 'price_info', a.price_info, { placeholder: '예: 매입 4,150억원' });
    html += formField('임차인/운영사', 'tenants', a.tenants);
    html += formField(detailLabel(a.sector, '만기/일정') || '만기/일정', 'maturity_schedule', a.maturity_schedule);
    html += formField('주소', 'address', a.address, { wide: true });
    html += formField('위도', 'lat', a.lat, { type: 'number', step: '0.0000001' });
    html += formField('경도', 'lng', a.lng, { type: 'number', step: '0.0000001' });
    html += formField('IM 링크 (클라우드 URL)', 'im_url', a.im_url, {
      wide: true, type: 'url', placeholder: 'https://drive.worksmobile.com/... (네이버웍스 드라이브 등)',
      hint: 'IM·티저 링크를 붙여넣으면 상세 패널에 <b>📄 IM 열기</b> 버튼이 생깁니다.'
    });
    html += formField('IM 표시 이름', 'im_label', a.im_label, { wide: true, placeholder: '예: 그랑서울 IM_v3.pdf' });
    html += formField('비고', 'notes', a.notes, { wide: true, type: 'textarea' });
    html += formField('출처', 'source', a.source, { wide: true });
    html += '</div>';
    html += '<div class="form-actions">';
    html += '<button type="submit" class="btn btn-solid">저장</button>';
    html += '<button type="button" class="btn btn-outline" data-act="cancelEdit">취소</button>';
    html += '<button type="button" class="btn btn-outline" data-act="pickLocation">지도에서 위치 지정</button>';
    html += '</div>';
    html += '<div class="save-hint">저장하면 <b>비공개 Google 시트</b>에 바로 반영되어 다른 기기에서도 같게 보입니다. 상단의 <b>내보내기</b>로 JSON/CSV를 받을 수 있습니다.</div>';
    html += '<div class="form-error hidden" id="formError"></div>';
    html += '</section></form></div>';
    root.innerHTML = html;
    root.classList.remove('hidden');
    bindForm();
  }

  function renderAddForm(root, prefill) {
    prefill = prefill || {};
    var html = '';
    html += '<div class="detail-head">';
    html += '<div class="detail-top"><span class="sector-dot" style="background:' + sectorColor(prefill.sector || 'office') + '"></span>';
    html += '<h2 class="detail-title">신규 물건 추가</h2>';
    html += '<button type="button" class="detail-close" data-act="cancelAdd" aria-label="닫기">×</button></div>';
    html += '<div class="detail-sub">주소 검색 또는 지도 클릭으로 위치를 지정하세요.</div>';
    html += '</div>';
    html += '<div class="detail-scroll"><form id="assetForm" data-mode="add"><section class="detail-section">';
    html += '<div class="field wide"><label>주소로 위치 찾기 (카카오)</label><div class="row-inline">' +
      '<input name="addrSearch" id="addrSearch" type="text" placeholder="예: 서울 종로구 청진동 70">' +
      '<button type="button" class="btn btn-outline" data-act="addrSearch">검색</button></div>' +
      '<span class="hint">카카오 앱키가 없으면 위도·경도를 직접 입력하거나, 아래 <b>지도에서 위치 지정</b>을 쓰세요.</span></div>';
    html += '<div class="form-grid">';
    html += formField('물건명 *', 'name', '', { wide: true });
    html += formField('섹터', 'sector', prefill.sector || 'office', { type: 'select', options: sectorOptions() });
    html += formField('구분', 'sub_type', '', { placeholder: '예: 매각 검토, 신축·개발' });
    html += formField('진행상태', 'status', '', { placeholder: '예: 매물 검토' });
    html += formField('상태 그룹', 'status_group', '검토중', { type: 'select', options: statusGroupOptions() });
    html += formField('운용사/소유주', 'owner_amc', '');
    html += formField('펀드/리츠/법인', 'fund_vehicle', '');
    html += formField('규모', 'scale_info', '', { placeholder: '예: 연면적 10,000평' });
    html += formField('가격', 'price_info', '', { placeholder: '예: 희망가 1,200억원' });
    html += formField('임차인/운영사', 'tenants', '');
    html += formField('만기/일정', 'maturity_schedule', '');
    html += formField('주소', 'address', prefill.address || '', { wide: true });
    html += formField('위도', 'lat', prefill.lat || '', { type: 'number', step: '0.0000001' });
    html += formField('경도', 'lng', prefill.lng || '', { type: 'number', step: '0.0000001' });
    html += formField('IM 링크 (클라우드 URL)', 'im_url', '', {
      wide: true, type: 'url', placeholder: 'https://drive.worksmobile.com/...',
      hint: '네이버웍스 드라이브·구글 드라이브 등 IM 링크를 붙여넣으세요.'
    });
    html += formField('IM 표시 이름', 'im_label', '', { wide: true, placeholder: '예: OO타워 IM.pdf' });
    html += formField('비고', 'notes', '', { wide: true, type: 'textarea' });
    html += formField('출처', 'source', '', { wide: true });
    html += '</div>';
    html += '<div class="form-actions">';
    html += '<button type="submit" class="btn btn-solid">추가 저장</button>';
    html += '<button type="button" class="btn btn-outline" data-act="cancelAdd">취소</button>';
    html += '<button type="button" class="btn btn-outline" data-act="pickLocation">지도에서 위치 지정</button>';
    html += '</div>';
    html += '<div class="form-error hidden" id="formError"></div>';
    html += '</section></form></div>';
    root.innerHTML = html;
    root.classList.remove('hidden');
    bindForm();
  }

  function readForm(form) {
    var fd = new FormData(form);
    var o = {};
    fd.forEach(function (v, k) { o[k] = String(v).trim(); });
    return o;
  }

  function validate(o) {
    if (!o.name) return '물건명을 입력하세요.';
    if (o.lat !== '' && num(o.lat) === null) return '위도는 숫자로 입력하세요.';
    if (o.lng !== '' && num(o.lng) === null) return '경도는 숫자로 입력하세요.';
    if (o.im_url && !isHttp(o.im_url)) return 'IM 링크는 http:// 또는 https:// 로 시작해야 합니다.';
    return '';
  }

  function showFormError(msg) {
    var el = $('#formError');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  }

  function bindForm() {
    var form = $('#assetForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var o = readForm(form);
      var err = validate(o);
      if (err) { showFormError(err); return; }
      var payload = {
        name: o.name,
        sector: o.sector,
        sub_type: o.sub_type,
        status: o.status,
        status_group: o.status_group,
        owner_amc: o.owner_amc,
        fund_vehicle: o.fund_vehicle,
        scale_info: o.scale_info,
        price_info: o.price_info,
        tenants: o.tenants,
        maturity_schedule: o.maturity_schedule,
        im_url: o.im_url,
        im_label: o.im_label,
        address: o.address,
        notes: o.notes,
        source: o.source,
        lat: o.lat === '' ? null : num(o.lat),
        lng: o.lng === '' ? null : num(o.lng)
      };
      if (form.dataset.mode === 'edit') saveEdited(form.dataset.id, payload);
      else saveNew(payload);
    });
  }

  function saveEdited(id, payload) {
    var base = state.index[id];
    if (!base) return;
    payload.updated_at = today();
    var coordChanged = num(base.lat) !== payload.lat || num(base.lng) !== payload.lng;
    if (coordChanged) payload.coord_precision = (payload.lat && payload.lng) ? '직접 입력·수정' : '좌표 없음';
    else payload.coord_precision = base.coord_precision || '';
    var merged = Object.assign(stripInternal(base), payload);
    upsertLocal(merged);
    rebuild();
    state.panelMode = 'view';
    renderDetail();
    toast('수정 내용을 저장했습니다.');
    pushOp({ action: 'upsert', asset: stripInternal(merged) });
  }

  function saveNew(payload) {
    var id = 'user-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000);
    var asset = Object.assign({
      id: id,
      region: '',
      coord_precision: payload.lat && payload.lng ? '직접 입력' : '좌표 없음',
      facts: [],
      links: []
    }, payload, { id: id, updated_at: today() });
    delete asset._hay; delete asset._edited; delete asset._added;
    // 지역 추정
    if (!asset.region && asset.address) {
      asset.region = asset.address.split(/\s+/)[0];
    }
    upsertLocal(asset);
    rebuild();
    state.selectedId = id;
    state.panelMode = 'view';
    renderDetail();
    highlightRows(null, id);
    if (asset.lat && asset.lng) panTo(asset);
    toast('새 물건을 추가했습니다.');
    pushOp({ action: 'upsert', asset: asset });
  }

  function deleteAsset(id) {
    if (!canEdit()) { toast('읽기 전용 모드입니다. 삭제할 수 없습니다.', true); return; }
    var a = state.index[id];
    if (!a) return;
    showModal({
      title: '물건 삭제',
      body: '<b>' + esc(a.name) + '</b> 을(를) 삭제할까요?<br><br>' +
        '삭제하면 <b>비공개 Google 시트에서도 함께 지워집니다</b>(다른 기기에도 반영). ' +
        '필요하면 먼저 <b>내보내기 → 전체 데이터 JSON</b>으로 백업하세요.',
      actions: [{ label: '취소', value: false, cls: 'btn-outline' }, { label: '삭제', value: true, cls: 'btn-solid', danger: true }]
    }).then(function (ok) {
      if (!ok) return;
      removeLocal(id);
      if (state.selectedId === id) state.selectedId = null;
      rebuild();
      $('#detailPanel').classList.add('hidden');
      toast('삭제했습니다.');
      pushOp({ action: 'delete', target: id });
    });
  }

  /* 데이터 원본(구글 시트에서 받은 목록)에 직접 반영합니다. */
  function upsertLocal(asset) {
    var found = false;
    state.base = state.base.map(function (a) {
      if (a.id !== asset.id) return a;
      found = true;
      return Object.assign({}, a, asset);
    });
    if (!found) state.base.push(asset);
    state.meta = computeMeta(state.base);
    cacheSave();
  }

  function removeLocal(id) {
    state.base = state.base.filter(function (a) { return a.id !== id; });
    state.meta = computeMeta(state.base);
    cacheSave();
  }

  /* ────────────────────────────── 지도 ────────────────────────────── */
  function loadKakaoSDK(key) {
    return new Promise(function (resolve, reject) {
      if (window.kakao && window.kakao.maps && window.kakao.maps.Map) return resolve();
      var existing = document.getElementById('kakaoSdk');
      var onReady = function () {
        try {
          window.kakao.maps.load(function () { resolve(); });
        } catch (e) { reject(e); }
      };
      if (existing) { existing.addEventListener('load', onReady); return; }
      var s = document.createElement('script');
      s.id = 'kakaoSdk';
      s.async = true;
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(key) + '&libraries=services,clusterer&autoload=false';
      s.onload = onReady;
      s.onerror = function () { reject(new Error('SDK_LOAD_FAIL')); };
      document.head.appendChild(s);
      setTimeout(function () {
        if (!(window.kakao && window.kakao.maps)) reject(new Error('SDK_TIMEOUT'));
      }, 8000);
    });
  }

  function initMap() {
    var key = String(CFG.KAKAO_JS_KEY || '').trim();
    if (!key) { startPreview('no-key'); return; }
    loadKakaoSDK(key).then(function () {
      try {
        startKakaoMap();
      } catch (e) {
        console.warn(e);
        startPreview('init-fail');
      }
    }).catch(function (e) {
      console.warn('Kakao SDK load failed', e);
      startPreview('load-fail');
    });
  }

  function startKakaoMap() {
    $('#previewMap').classList.add('hidden');
    $('#previewBanner').classList.add('hidden');
    $('#mapNotice').classList.add('hidden');
    $('#map').classList.remove('hidden');
    $('#btnRoadview').disabled = false;

    state.map = new kakao.maps.Map($('#map'), {
      center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
      level: DEFAULT_LEVEL
    });
    state.mapReady = true;
    state.geocoder = new kakao.maps.services.Geocoder();
    state.rvClient = new kakao.maps.RoadviewClient();
    state.rv = new kakao.maps.Roadview($('#roadview'));

    kakao.maps.event.addListener(state.map, 'click', function (e) {
      onMapClick(e.latLng.getLat(), e.latLng.getLng());
    });

    state.clusterer = new kakao.maps.MarkerClusterer({
      map: state.cluster ? state.map : null,
      markers: [],
      averageCenter: true,
      minLevel: 6,
      gridSize: 60,
      disableClickZoom: false
    });

    renderMarkers();
    fitBounds();
    buildLegend();
  }

  function onMapClick(lat, lng) {
    if (!state.addMode) return;
    var form = $('#assetForm');
    if (!form) return;
    var latEl = form.querySelector('[name="lat"]'), lngEl = form.querySelector('[name="lng"]');
    if (latEl) latEl.value = lat.toFixed(6);
    if (lngEl) lngEl.value = lng.toFixed(6);
    setAddMode(false);
    toast('위치를 지정했습니다. 주소를 확인해 주세요.');
    if (state.geocoder) {
      state.geocoder.coord2Address(lng, lat, function (result, status) {
        if (status === kakao.maps.services.Status.OK && result[0]) {
          var addrEl = form.querySelector('[name="address"]');
          var r = result[0];
          var addr = (r.roadAddress && r.roadAddress.address_name) || (r.address && r.address.address_name) || '';
          if (addrEl && addr && !addrEl.value.trim()) addrEl.value = addr;
        }
      });
    }
  }

  function setAddMode(on) {
    state.addMode = !!on;
    $('#addModeBar').classList.toggle('hidden', !state.addMode);
    if (state.map) {
      $('#map').style.cursor = state.addMode ? 'crosshair' : '';
    }
  }

  var markerCache = {};
  function markerImage(sector, count, selected) {
    var key = sector + '|' + count + '|' + (selected ? 1 : 0);
    if (markerCache[key]) return markerCache[key];
    var color = selected ? '#111827' : sectorColor(sector);
    var size = count > 1 ? 34 : 27;
    var r = size / 2 - 2;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r + '" fill="' + color + '" stroke="#ffffff" stroke-width="2.5"/>' +
      (count > 1
        ? '<text x="' + (size / 2) + '" y="' + (size / 2 + 3.5) + '" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="#ffffff">' + count + '</text>'
        : '<circle cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + (r * 0.38) + '" fill="#ffffff" opacity="0.95"/>') +
      '</svg>';
    var img = new kakao.maps.MarkerImage(
      'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
      new kakao.maps.Size(size, size),
      { offset: new kakao.maps.Point(size / 2, size / 2) }
    );
    markerCache[key] = img;
    return img;
  }

  function groupByCoord(list) {
    var groups = {};
    list.forEach(function (a) {
      if (!a.lat || !a.lng) return;
      var k = coordKey(a);
      (groups[k] = groups[k] || []).push(a);
    });
    state.coordGroups = groups;
    return groups;
  }

  function clearMarkers() {
    state.markers.forEach(function (m) { m.setMap(null); });
    state.markers = [];
    state.markerIndex = {};
    if (state.clusterer) state.clusterer.clear();
  }

  function renderMarkers() {
    if (!state.mapReady) {
      if (state.preview) state.preview.render();
      return;
    }
    clearMarkers();
    var groups = groupByCoord(state.filtered);
    var markers = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      var a = g[0];
      var selected = g.some(function (x) { return x.id === state.selectedId; });
      var marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(a.lat, a.lng),
        image: markerImage(a.sector, g.length, selected),
        title: a.name + (g.length > 1 ? ' 외 ' + (g.length - 1) + '건' : ''),
        zIndex: selected ? 10 : 1
      });
      marker.__assets = g;
      kakao.maps.event.addListener(marker, 'click', function () {
        var target = g.filter(function (x) { return x.id === state.selectedId; })[0] || g[0];
        selectAsset(target.id, { pan: false });
      });
      g.forEach(function (x) { state.markerIndex[x.id] = marker; });
      markers.push(marker);
    });
    state.markers = markers;

    if (state.cluster && state.clusterer) {
      state.clusterer.clear();
      state.clusterer.addMarkers(markers);
      state.clusterer.setMap(state.map);
    } else {
      markers.forEach(function (m) { m.setMap(state.map); });
    }
  }

  function updateMarkerStyle(id, selected) {
    if (!state.mapReady || !id) return;
    var m = state.markerIndex[id];
    if (!m) return;
    var g = m.__assets || [];
    var a = g[0];
    if (!a) return;
    try {
      m.setImage(markerImage(a.sector, g.length, selected));
      m.setZIndex(selected ? 10 : 1);
    } catch (e) { /* noop */ }
  }

  function toggleCluster() {
    state.cluster = !state.cluster;
    var btn = $('#btnCluster');
    btn.setAttribute('aria-pressed', String(state.cluster));
    if (!state.mapReady) return;
    if (state.cluster) {
      state.markers.forEach(function (m) { m.setMap(null); });
      state.clusterer.addMarkers(state.markers);
      state.clusterer.setMap(state.map);
    } else {
      state.clusterer.clear();
      state.clusterer.setMap(null);
      state.markers.forEach(function (m) { m.setMap(state.map); });
    }
  }

  function fitBounds() {
    var pts = state.filtered.filter(function (a) { return a.lat && a.lng; });
    if (state.mapReady && pts.length) {
      var b = new kakao.maps.LatLngBounds();
      pts.forEach(function (a) { b.extend(new kakao.maps.LatLng(a.lat, a.lng)); });
      if (pts.length === 1) {
        state.map.setCenter(new kakao.maps.LatLng(pts[0].lat, pts[0].lng));
        state.map.setLevel(4);
      } else {
        state.map.setBounds(b, 70, 70, 70, 70);
      }
    } else if (state.preview) {
      state.preview.fit();
    }
  }

  function buildLegend() {
    var html = SECTOR_KEYS.map(function (k) {
      return '<span class="legend-item"><span class="dot" style="background:' + sectorColor(k) + '"></span>' + esc(SECTORS[k].label) + '</span>';
    }).join('');
    $('#legend').innerHTML = html + '<span class="legend-sep"></span><span class="legend-item"><b>숫자</b> = 같은 위치 중첩</span>';
  }

  /* ────────────────────────────── 로드뷰 ────────────────────────────── */
  function setRoadview(on, skipPano) {
    if (!state.mapReady) { toast('카카오맵 앱키를 입력하면 로드뷰를 쓸 수 있습니다.', true); return; }
    state.roadview = !!on;
    $('#btnMapView').classList.toggle('is-active', !on);
    $('#btnRoadview').classList.toggle('is-active', on);
    if (on) {
      $('#map').classList.add('hidden');
      $('#roadview').classList.remove('hidden');
      try { state.rv.relayout(); } catch (e) { /* noop */ }
      var a = state.index[state.selectedId];
      if (!skipPano) {
        if (a && a.lat && a.lng) showRoadview(a);
        else toast('물건을 선택하면 그 위치의 로드뷰를 보여줍니다.');
      }
    } else {
      $('#roadview').classList.add('hidden');
      $('#map').classList.remove('hidden');
      try { state.map.relayout(); } catch (e) { /* noop */ }
    }
  }

  function showRoadview(a) {
    if (!state.mapReady || !a || !a.lat || !a.lng) return;
    if (!state.roadview) setRoadview(true, true);
    var pos = new kakao.maps.LatLng(a.lat, a.lng);
    state.rvClient.getNearestPanoId(pos, 60, function (panoId) {
      if (panoId === null || panoId === undefined) {
        toast('이 위치 주변에는 로드뷰가 없습니다.', true);
        return;
      }
      state.rv.setPanoId(panoId, pos);
      state.rv.setViewpoint({ pan: 0, tilt: 0, zoom: 0 });
    });
  }

  /* ─────────────────────── 좌표 미리보기(키 없을 때) ─────────────────────── */
  function startPreview(reason) {
    $('#map').classList.add('hidden');
    $('#roadview').classList.add('hidden');
    $('#previewMap').classList.remove('hidden');
    $('#previewBanner').classList.remove('hidden');
    $('#btnRoadview').disabled = true;
    $('#btnCluster').style.display = 'none';

    if (reason === 'load-fail' || reason === 'init-fail') {
      showMapNotice(
        '카카오 지도를 불러오지 못했습니다',
        '<p>JavaScript 키가 맞는지, 그리고 <b>이 페이지를 여는 도메인이 카카오 개발자 콘솔의 Web 플랫폼에 등록</b>되어 있는지 확인하세요.</p>' +
        '<ol><li><code>config.js</code>의 <code>KAKAO_JS_KEY</code> 확인</li>' +
        '<li>카카오 개발자 콘솔 → 플랫폼 → Web 플랫폼에 도메인 등록</li>' +
        '<li><code>file://</code>로 열었다면 로컬 서버(<code>python3 -m http.server</code>)로 다시 열기</li></ol>' +
        '<p>지금은 좌표 미리보기로 계속 사용할 수 있습니다.</p>',
        '미리보기 계속'
      );
    }

    state.preview = createPreview($('#previewMap'));
    state.preview.fit();
    buildLegend();
  }

  function showMapNotice(title, bodyHtml, btnLabel) {
    var el = $('#mapNotice');
    el.classList.remove('hidden');
    el.innerHTML = '<div class="notice-card"><h3>' + title + '</h3>' + bodyHtml +
      '<button type="button" class="btn" id="btnNoticeClose">' + (btnLabel || '닫기') + '</button></div>';
    $('#btnNoticeClose').addEventListener('click', function () { el.classList.add('hidden'); });
  }

  function createPreview(container) {
    var NS = 'http://www.w3.org/2000/svg';
    var WORLD = { lng0: 124.3, lat0: 39.2, k: 1000 };
    var view = { x: 0, y: 0, w: 5600, h: 6400 };
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    container.innerHTML = '';
    container.appendChild(svg);

    function px(lng) { return (lng - WORLD.lng0) * WORLD.k; }
    function py(lat) { return (WORLD.lat0 - lat) * WORLD.k; }
    function unx(x) { return WORLD.lng0 + x / WORLD.k; }
    function uny(y) { return WORLD.lat0 - y / WORLD.k; }

    var gLand = document.createElementNS(NS, 'g');
    var gGrid = document.createElementNS(NS, 'g');
    var gLabels = document.createElementNS(NS, 'g');
    var gMarks = document.createElementNS(NS, 'g');
    svg.appendChild(gLand); svg.appendChild(gGrid); svg.appendChild(gLabels); svg.appendChild(gMarks);

    function ringPath(flat) {
      var d = '';
      for (var i = 0; i < flat.length; i += 2) {
        d += (i ? 'L' : 'M') + px(flat[i]).toFixed(1) + ' ' + py(flat[i + 1]).toFixed(1);
      }
      return d ? d + 'Z' : '';
    }

    function drawLand() {
      var frag = document.createDocumentFragment();
      // 1) 국토 실루엣(면) — 시도 단순화 사이의 틈을 메워 고배율에서도 바다로 보이지 않게 함
      if (typeof KOREA_LAND !== 'undefined') {
        KOREA_LAND.forEach(function (flat) {
          var d = ringPath(flat);
          if (!d) return;
          var path = document.createElementNS(NS, 'path');
          path.setAttribute('d', d);
          path.setAttribute('fill', '#f7fbfe');
          path.setAttribute('stroke', '#bfd0e2');
          path.setAttribute('stroke-width', '1');
          path.setAttribute('stroke-linejoin', 'round');
          path.setAttribute('vector-effect', 'non-scaling-stroke');
          frag.appendChild(path);
        });
      }
      // 2) 시도 경계(선)
      if (typeof KOREA_GEO !== 'undefined') {
        KOREA_GEO.forEach(function (prov) {
          prov.forEach(function (flat) {
            var d = ringPath(flat);
            if (!d) return;
            var path = document.createElementNS(NS, 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', '#d2dfec');
            path.setAttribute('stroke-width', '1');
            path.setAttribute('vector-effect', 'non-scaling-stroke');
            frag.appendChild(path);
          });
        });
      }
      gLand.appendChild(frag);
    }
    drawLand();

    function setView() {
      svg.setAttribute('viewBox', view.x + ' ' + view.y + ' ' + view.w + ' ' + view.h);
      // 도시권까지 확대하면 단순화된 해안선이 거칠어 보이므로 배경 지형을 숨긴다
      if (gLand) gLand.style.display = view.w < 1400 ? 'none' : '';
      drawGrid();
    }

    function drawGrid() {
      gGrid.innerHTML = '';
      var step = view.w > 3000 ? 1000 : (view.w > 1200 ? 500 : 200);
      var x0 = Math.floor(view.x / step) * step, x1 = view.x + view.w;
      var y0 = Math.floor(view.y / step) * step, y1 = view.y + view.h;
      var sw = Math.max(1, view.w / 2200);
      for (var x = x0; x <= x1; x += step) {
        var l = document.createElementNS(NS, 'line');
        l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('y1', y0); l.setAttribute('y2', y1);
        l.setAttribute('stroke', '#cfdae6'); l.setAttribute('stroke-width', sw); l.setAttribute('opacity', '0.75');
        gGrid.appendChild(l);
      }
      for (var y = y0; y <= y1; y += step) {
        var l2 = document.createElementNS(NS, 'line');
        l2.setAttribute('y1', y); l2.setAttribute('y2', y); l2.setAttribute('x1', x0); l2.setAttribute('x2', x1);
        l2.setAttribute('stroke', '#cfdae6'); l2.setAttribute('stroke-width', sw); l2.setAttribute('opacity', '0.75');
        gGrid.appendChild(l2);
      }
      // 기준 도시 라벨 (지도 없이 위치 감각을 잡기 위한 참고점)
      var cities = [
        ['서울', 37.5665, 126.9780], ['인천', 37.4563, 126.7052], ['수원', 37.2636, 127.0286],
        ['대전', 36.3504, 127.3845], ['대구', 35.8714, 128.6014], ['광주', 35.1595, 126.8526],
        ['부산', 35.1796, 129.0756], ['울산', 35.5384, 129.3114], ['제주', 33.4996, 126.5312]
      ];
      gLabels.innerHTML = '';
      var fs = view.w / 60;
      cities.forEach(function (c) {
        var t = document.createElementNS(NS, 'text');
        t.setAttribute('x', px(c[2]) + fs * 0.5);
        t.setAttribute('y', py(c[1]) - fs * 0.3);
        t.setAttribute('fill', '#a7b4c4');
        t.setAttribute('font-size', fs);
        t.setAttribute('font-family', 'system-ui, sans-serif');
        t.setAttribute('font-weight', '600');
        t.textContent = c[0];
        gLabels.appendChild(t);
      });
    }

    function render() {
      gMarks.innerHTML = '';
      var list = state.filtered.filter(function (a) { return a.lat && a.lng; });
      var r = Math.max(3.2, view.w / 150);
      var groups = {};
      list.forEach(function (a) {
        var k = coordKey(a);
        (groups[k] = groups[k] || []).push(a);
      });
      Object.keys(groups).forEach(function (k) {
        var g = groups[k], a = g[0];
        var cx = px(a.lng), cy = py(a.lat);
        var sel = g.some(function (x) { return x.id === state.selectedId; });
        if (sel) {
          var ring = document.createElementNS(NS, 'circle');
          ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('r', r * 1.9);
          ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#111827'); ring.setAttribute('stroke-width', r * 0.32);
          gMarks.appendChild(ring);
        }
        var c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', g.length > 1 ? r * 1.25 : r);
        c.setAttribute('fill', sectorColor(a.sector));
        c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', Math.max(1, r * 0.2));
        c.style.cursor = 'pointer';
        var title = document.createElementNS(NS, 'title');
        title.textContent = a.name + (g.length > 1 ? ' 외 ' + (g.length - 1) + '건' : '');
        c.appendChild(title);
        c.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        c.addEventListener('click', function (e) {
          e.stopPropagation();
          var target = g.filter(function (x) { return x.id === state.selectedId; })[0] || g[0];
          selectAsset(target.id, { pan: false });
        });
        gMarks.appendChild(c);
        if (g.length > 1 && view.w < 2600) {
          var t = document.createElementNS(NS, 'text');
          t.setAttribute('x', cx); t.setAttribute('y', cy + r * 0.45);
          t.setAttribute('text-anchor', 'middle');
          t.setAttribute('font-size', r * 1.25);
          t.setAttribute('font-weight', '700');
          t.setAttribute('fill', '#fff');
          t.setAttribute('pointer-events', 'none');
          t.textContent = g.length;
          gMarks.appendChild(t);
        }
      });
    }

    function fit() {
      var list = state.filtered.filter(function (a) { return a.lat && a.lng; });
      if (!list.length) {
        view = { x: 0, y: 0, w: 5600, h: 6400 };
        setView(); render(); return;
      }
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      list.forEach(function (a) {
        var x = px(a.lng), y = py(a.lat);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      var padX = Math.max(120, (maxX - minX) * 0.09);
      var padY = Math.max(120, (maxY - minY) * 0.09);
      var w = (maxX - minX) + padX * 2, h = (maxY - minY) + padY * 2;
      var rect = container.getBoundingClientRect();
      var aspect = (rect.width && rect.height) ? rect.width / rect.height : 1.3;
      if (w / h < aspect) w = h * aspect; else h = w / aspect;
      var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      view = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
      setView();
      render();
    }

    function focus(a) {
      if (!a.lat || !a.lng) return;
      if (view.w > 1600) view.w = 1200, view.h = 1200 * (6400 / 5600);
      view.x = px(a.lng) - view.w / 2;
      view.y = py(a.lat) - view.h / 2;
      setView();
      render();
    }

    // 드래그 팬
    var drag = null;
    container.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: 0 };
      container.classList.add('is-dragging');
      try { container.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    });
    container.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var rect = container.getBoundingClientRect();
      var dx = (e.clientX - drag.x) * view.w / rect.width;
      var dy = (e.clientY - drag.y) * view.h / rect.height;
      drag.moved = Math.max(drag.moved, Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y));
      view.x = drag.vx - dx;
      view.y = drag.vy - dy;
      setView();
    });
    container.addEventListener('pointerup', function (e) {
      var moved = drag ? drag.moved : 0;
      drag = null;
      container.classList.remove('is-dragging');
      if (moved < 5 && state.addMode) {
        var rect = container.getBoundingClientRect();
        var relX = (e.clientX - rect.left) / rect.width;
        var relY = (e.clientY - rect.top) / rect.height;
        var lng = unx(view.x + relX * view.w);
        var lat = uny(view.y + relY * view.h);
        if (lat > 32 && lat < 40 && lng > 124 && lng < 131) onMapClick(lat, lng);
      }
    });
    container.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = container.getBoundingClientRect();
      var relX = (e.clientX - rect.left) / rect.width;
      var relY = (e.clientY - rect.top) / rect.height;
      var factor = e.deltaY > 0 ? 1.18 : 0.85;
      var wx = view.x + relX * view.w, wy = view.y + relY * view.h;
      view.w = Math.min(6000, Math.max(120, view.w * factor));
      view.h = view.w * (6400 / 5600);
      view.x = wx - relX * view.w;
      view.y = wy - relY * view.h;
      setView();
      render();
    }, { passive: false });

    setView();
    window.addEventListener('resize', function () { render(); });
    return { render: render, fit: fit, focus: focus, draw: function () { drawGrid(); render(); } };
  }

  /* ────────────────────────────── 모달 ────────────────────────────── */
  function showModal(opt) {
    return new Promise(function (resolve) {
      var root = $('#modalRoot');
      var actions = (opt.actions || [{ label: '확인', value: true, cls: 'btn-solid' }]);
      root.innerHTML = '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">' +
        '<h3>' + esc(opt.title || '') + '</h3><div class="modal-body">' + (opt.body || '') + '</div>' +
        '<div class="modal-actions">' + actions.map(function (a, i) {
          return '<button type="button" class="btn ' + (a.cls || 'btn-outline') + '" data-i="' + i + '"' +
            (a.danger ? ' style="background:#d93636;border-color:#d93636;color:#fff"' : '') + '>' + esc(a.label) + '</button>';
        }).join('') + '</div></div></div>';
      function close(val) { root.innerHTML = ''; document.removeEventListener('keydown', onKey); resolve(val); }
      function onKey(e) { if (e.key === 'Escape') close(null); }
      document.addEventListener('keydown', onKey);
      $$('.modal-actions button', root).forEach(function (b) {
        b.addEventListener('click', function () {
          var a = actions[Number(b.dataset.i)];
          close(a.value);
        });
      });
      $('.modal-backdrop', root).addEventListener('click', function (e) {
        if (e.target === e.currentTarget) close(null);
      });
    });
  }

  function showHelp() {
    var keyOk = String(CFG.KAKAO_JS_KEY || '').trim().length > 0;
    showModal({
      title: '사용 안내',
      body: '<p><b>1. 화면(탭)</b> — <b>🗺️ 물건 지도</b> · <b>🤝 SI·화주 풀</b> · <b>🏦 FI 풀</b> · <b>📊 밸류에이션</b>. SI·화주 풀과 FI 풀은 같은 <code>investors</code> 시트를 분류만 나누어 봅니다(SI: 오피스 SI·물류 화주 / FI: 블라인드펀드·리츠·해외투자사·연기금·LP).</p>' +
        '<p><b>2. 카카오 지도 켜기</b><br>' +
        (keyOk ? '앱키가 입력되어 있습니다. 지도가 보이지 않으면 카카오 콘솔의 Web 플랫폼 도메인 등록을 확인하세요.'
          : '<code>config.js</code> → <code>KAKAO_JS_KEY</code> 에 JavaScript 키를 넣으세요. 키가 없으면 좌표 미리보기로 동작합니다.') + '</p>' +
        '<p><b>3. 조회</b> — 섹터·진행상태 칩, 지역 선택, 통합 검색(건물명·운용사·주소·임차인·비고)으로 좁힙니다. 마커 숫자는 같은 좌표의 중첩 건수입니다.</p>' +
        '<p><b>4. 수정·추가</b> — 상세 패널의 <b>✏️ 수정</b>, 상단 <b>＋ 신규 물건</b>. 저장 즉시 브라우저(localStorage)에 보관되어 새로고침해도 유지됩니다.</p>' +
        '<p><b>5. IM</b> — 수정/추가 폼의 <b>IM 링크</b>에 네이버웍스 드라이브 등 URL을 넣으면 상세 패널에 <b>📄 IM 열기</b> 버튼이 생깁니다.</p>' +
        '<p><b>6. 내보내기</b> — 상단 <b>내보내기</b>에서 전체/변경분을 JSON·CSV로 받습니다. <b>변경사항 초기화</b>로 원본 상태로 되돌립니다.</p>' +
        '<p><b>7. 다른 기기와 공유</b> — <code>config.js</code>의 <code>SYNC_URL</code>에 Apps Script 웹앱 주소를 넣으면 수정분이 서버에 저장됩니다(README 참고).</p>',
      actions: [{ label: '닫기', value: true, cls: 'btn-solid' }]
    });
  }

  /* ─────────────────────── IM 링크 일괄 등록 ─────────────────────── */
  function openImImport() {
    var root = $('#modalRoot');
    var sample = '그랑서울|https://drive.worksmobile.com/.../그랑서울_IM.pdf\n' +
      '센터원\thttps://drive.worksmobile.com/.../센터원_IM_v2.pdf';
    root.innerHTML = '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" style="width:560px">' +
      '<h3>IM 링크 일괄 등록</h3>' +
      '<div class="modal-body">한 줄에 <code>물건명 | URL</code> (또는 탭 구분)로 붙여넣으면 해당 물건의 상세 패널에 <b>📄 IM 열기</b> 버튼이 생깁니다. ' +
      'ID(<code>hotel-op-001</code> 등)로도 지정할 수 있습니다.' +
      '<textarea id="imBulkText" style="width:100%;height:170px;margin-top:10px;border:1px solid var(--line);border-radius:8px;padding:9px;font-size:12px;font-family:inherit;line-height:1.5" ' +
      'placeholder="' + esc(sample) + '"></textarea>' +
      '<div id="imBulkResult" style="margin-top:8px;font-size:12px"></div></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-outline" data-im="cancel">닫기</button>' +
      '<button type="button" class="btn btn-solid" data-im="apply">등록</button></div></div></div>';

    function close() { root.innerHTML = ''; }
    root.querySelector('[data-im="cancel"]').addEventListener('click', close);
    root.querySelector('.modal-backdrop').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) close();
    });
    root.querySelector('[data-im="apply"]').addEventListener('click', function () {
      var text = $('#imBulkText').value || '';
      var res = applyImLinks(text);
      $('#imBulkResult').innerHTML = '<b>' + res.ok + '건 등록</b>' +
        (res.miss.length ? ' · 확인 실패 ' + res.miss.length + '건: ' + esc(res.miss.slice(0, 8).join(', ')) + (res.miss.length > 8 ? ' 외' : '') : '') +
        (res.bad.length ? ' · 형식 오류 ' + res.bad.length + '건' : '');
      if (res.ok) {
        commitUpserts(res.changed);
        rebuild();
        if (state.selectedId) renderDetail();
      }
    });
  }

  function applyImLinks(text) {
    var lines = String(text).split(/\r?\n/);
    var ok = 0, miss = [], bad = [], changed = [];
    var byId = {};
    lines.forEach(function (line) {
      var raw = line.trim();
      if (!raw || raw.charAt(0) === '#') return;
      var parts = raw.split(/\s*[|\t]\s*/);
      if (parts.length < 2) { bad.push(raw.slice(0, 30)); return; }
      var key = parts[0].trim();
      var url = parts.slice(1).join(' ').trim();
      if (!isHttp(url)) { bad.push(key); return; }
      var target = state.index[key] ||
        state.assets.filter(function (a) { return a.name === key; })[0] ||
        state.assets.filter(function (a) { return a.name.indexOf(key) >= 0; })[0];
      if (!target) { miss.push(key); return; }
      var label = '';
      try {
        var seg = decodeURIComponent(url.split('?')[0].split('/').pop() || '');
        label = seg && seg.length < 80 ? seg : '';
      } catch (e) { label = ''; }
      var merged = Object.assign(stripInternal(byId[target.id] || target), {
        im_url: url, im_label: label, updated_at: today()
      });
      byId[target.id] = merged;
      ok++;
    });
    Object.keys(byId).forEach(function (k) { changed.push(byId[k]); });
    return { ok: ok, miss: miss, bad: bad, changed: changed };
  }

  /* ────────────────────────────── 내보내기 ────────────────────────────── */
  var CSV_FIELDS = ['id', 'sector', 'sub_type', 'name', 'status', 'status_group', 'region', 'address',
    'lat', 'lng', 'coord_precision', 'owner_amc', 'fund_vehicle', 'scale_info', 'price_info',
    'tenants', 'maturity_schedule', 'im_url', 'im_label', 'notes', 'source', 'updated_at'];

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCsv(rows, fields) {
    var head = fields.map(csvCell).join(',');
    var body = rows.map(function (r) {
      return fields.map(function (f) { return csvCell(r[f]); }).join(',');
    }).join('\r\n');
    return '\uFEFF' + head + '\r\n' + body;
  }

  function exportAll(kind) {
    var stamp = today().replace(/-/g, '');
    if (kind === 'json') {
      download('NAI_통합지도_' + stamp + '.json', JSON.stringify({
        meta: Object.assign({}, state.meta, { exported_at: new Date().toISOString(), count: state.assets.length }),
        assets: state.assets.map(function (a) {
          var c = Object.assign({}, a);
          delete c._hay; delete c._added; delete c._edited;
          return c;
        })
      }, null, 1), 'application/json;charset=utf-8');
    } else {
      download('NAI_통합지도_' + stamp + '.csv', toCsv(state.assets, CSV_FIELDS), 'text/csv;charset=utf-8');
    }
    toast('내보냈습니다.');
  }

  function exportChanges(kind) {
    var queue = readPending();
    var stamp = today().replace(/-/g, '');
    if (!queue.length) { toast('저장 대기 중인 변경사항이 없습니다.'); return; }
    if (kind === 'json') {
      download('NAI_변경사항_' + stamp + '.json', JSON.stringify({
        base_version: state.meta.version || '',
        exported_at: new Date().toISOString(),
        pending: queue
      }, null, 1), 'application/json;charset=utf-8');
    } else {
      var rows = queue.map(function (op) {
        return op.action === 'delete'
          ? Object.assign({ _change: '삭제' }, (state.index[op.target] || { id: op.target }))
          : Object.assign({ _change: '저장' }, op.asset || {});
        });
      var fields = ['_change'].concat(CSV_FIELDS);
      download('NAI_변경사항_' + stamp + '.csv', toCsv(rows, fields), 'text/csv;charset=utf-8');
    }
    toast('변경사항을 내보냈습니다.');
  }

  function resetChanges() {
    showModal({
      title: '구글 시트 기준으로 새로고침',
      body: '화면을 <b>비공개 Google 시트의 최신 내용</b>으로 다시 불러옵니다.<br><br>' +
        '아직 서버에 저장되지 않은 변경이 있으면 함께 사라집니다.',
      actions: [{ label: '취소', value: false, cls: 'btn-outline' }, { label: '새로고침', value: true, cls: 'btn-solid' }]
    }).then(function (ok) {
      if (!ok) return;
      writePending([]);
      var t = getToken();
      if (!t) { showGate(''); return; }
      setSyncStatus('불러오는 중…');
      connect(t, false).then(function () {
        state.selectedId = null;
        $('#detailPanel').classList.add('hidden');
        toast('구글 시트에서 다시 불러왔습니다.');
      }).catch(function () {
        toast('다시 불러오지 못했습니다.', true);
      });
    });
  }

  /* ────────────────────────────── 재구성 ────────────────────────────── */
  function rebuild() {
    buildAssets();
    initFilters();
    applyFilters();
    updateStorageHint();
  }

  /* ────────────────────────────── 이벤트 ────────────────────────────── */
  function closeSidebarOnMobile() {
    if (window.innerWidth <= 900) {
      $('#sidebar').classList.remove('is-open');
      $('#sidebarBackdrop').classList.add('hidden');
      $('#btnMenu').setAttribute('aria-expanded', 'false');
    }
  }

  function onPanelClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var a = state.index[state.selectedId];
    if (act === 'close') {
      $('#detailPanel').classList.add('hidden');
      state.panelMode = 'view';
      updateMarkerStyle(state.selectedId, false);
      state.selectedId = null;
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* noop */ }
      renderList();
      return;
    }
    if (act === 'simulate' && a) {
      if (window.NAI_VAL && window.NAI_VAL.openForAsset) window.NAI_VAL.openForAsset(a);
      else toast('시뮬레이터를 불러오지 못했습니다. 페이지를 새로고침해 주세요.', true);
      return;
    }
    if (act === 'edit' && a) {
      if (!canEdit()) { toast('읽기 전용 모드입니다. 수정할 수 없습니다.', true); return; }
      state.panelMode = 'edit'; renderDetail(); return;
    }
    if (act === 'cancelEdit') { state.panelMode = 'view'; renderDetail(); return; }
    if (act === 'cancelAdd') { setAddMode(false); $('#detailPanel').classList.add('hidden'); state.panelMode = 'view'; return; }
    if (act === 'pickLocation') {
      if (!state.mapReady) { toast('카카오 지도가 없어 지도 클릭을 쓸 수 없습니다. 위도·경도를 직접 입력하세요.', true); return; }
      setAddMode(true);
      toast('지도에서 위치를 클릭하세요.');
      return;
    }
    if (act === 'roadview' && a) { showRoadview(a); return; }
    if (act === 'kakaomap' && a) {
      var q = encodeURIComponent(a.name + ' ' + (a.address || ''));
      window.open('https://map.kakao.com/?q=' + q, '_blank', 'noopener');
      return;
    }
    if (act === 'copy' && a) {
      var text = [a.name, a.address].filter(Boolean).join(' ');
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('복사했습니다.'); });
      else toast('복사할 수 없습니다.', true);
      return;
    }
    if (act === 'delete' && a) {
      if (!canEdit()) { toast('읽기 전용 모드입니다. 삭제할 수 없습니다.', true); return; }
      deleteAsset(a.id); return;
    }
    if (act === 'sibling') {
      var id = btn.getAttribute('data-id');
      if (id) { state.selectedId = id; renderDetail(); highlightRows(null, id); panTo(state.index[id]); }
      return;
    }
    if (act === 'addrSearch') {
      var input = $('#addrSearch');
      var q2 = input && input.value.trim();
      if (!q2) { toast('주소를 입력하세요.'); return; }
      if (!state.geocoder) { toast('카카오 앱키를 입력하면 주소 검색을 쓸 수 있습니다.', true); return; }
      state.geocoder.addressSearch(q2, function (result, status) {
        if (status === kakao.maps.services.Status.OK && result[0]) {
          var r = result[0];
          var form = $('#assetForm');
          if (!form) return;
          form.querySelector('[name="lat"]').value = Number(r.y).toFixed(6);
          form.querySelector('[name="lng"]').value = Number(r.x).toFixed(6);
          var addrEl = form.querySelector('[name="address"]');
          if (addrEl && !addrEl.value.trim()) addrEl.value = r.address_name || q2;
          toast('위치를 찾았습니다: ' + (r.address_name || ''));
          panTo({ lat: Number(r.y), lng: Number(r.x) });
        } else {
          toast('주소를 찾지 못했습니다. 더 구체적으로 입력해 보세요.', true);
        }
      });
      return;
    }
  }

  function bindUI() {
    // 검색
    var searchTimer = null;
    $('#searchInput').addEventListener('input', function (e) {
      var v = e.target.value;
      $('#btnClearSearch').classList.toggle('hidden', !v);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.filters.query = v;
        applyFilters();
      }, 140);
    });
    $('#btnClearSearch').addEventListener('click', function () {
      $('#searchInput').value = '';
      $('#btnClearSearch').classList.add('hidden');
      state.filters.query = '';
      applyFilters();
      $('#searchInput').focus();
    });

    // 섹터·상태 칩 (위임)
    $('#sectorFilters').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-sector]');
      if (!btn) return;
      var k = btn.getAttribute('data-sector');
      state.filters.sectors[k] = state.filters.sectors[k] === false;
      btn.classList.toggle('is-on', state.filters.sectors[k] !== false);
      btn.classList.toggle('is-off', state.filters.sectors[k] === false);
      btn.setAttribute('aria-pressed', String(state.filters.sectors[k] !== false));
      updateSectorAllLabel();
      applyFilters();
    });
    $('#btnSectorAll').addEventListener('click', function () {
      var allOn = SECTOR_KEYS.every(function (k) { return state.filters.sectors[k] !== false; });
      SECTOR_KEYS.forEach(function (k) { state.filters.sectors[k] = !allOn; });
      initFilters();
      applyFilters();
    });
    $('#statusFilters').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-status]');
      if (!btn) return;
      var g = btn.getAttribute('data-status');
      state.filters.statuses[g] = state.filters.statuses[g] === false;
      btn.classList.toggle('is-on', state.filters.statuses[g] !== false);
      btn.classList.toggle('is-off', state.filters.statuses[g] === false);
      btn.setAttribute('aria-pressed', String(state.filters.statuses[g] !== false));
      applyFilters();
    });
    $('#btnStatusAll').addEventListener('click', function () {
      state.filters.statuses = {};
      $$('#statusFilters .chip').forEach(function (c) { c.classList.add('is-on'); c.classList.remove('is-off'); });
      applyFilters();
    });
    $('#regionSelect').addEventListener('change', function (e) {
      state.filters.region = e.target.value;
      applyFilters();
    });
    var stSel = $('#subTypeSelect');
    if (stSel) stSel.addEventListener('change', function (e) {
      state.filters.subType = e.target.value;
      applyFilters();
    });
    $('#btnOnlyIm').addEventListener('click', function (e) {
      state.filters.onlyIm = !state.filters.onlyIm;
      e.currentTarget.setAttribute('aria-pressed', String(state.filters.onlyIm));
      applyFilters();
    });
    $('#btnResetFilters').addEventListener('click', function () {
      state.filters = { sectors: {}, statuses: {}, region: 'ALL', subType: 'ALL', query: '', onlyIm: false };
      $('#searchInput').value = '';
      $('#btnClearSearch').classList.add('hidden');
      $('#btnOnlyIm').setAttribute('aria-pressed', 'false');
      initFilters();
      applyFilters();
    });

    // 목록
    $('#assetList').addEventListener('click', function (e) {
      var row = e.target.closest('.asset-row');
      if (!row) return;
      selectAsset(row.getAttribute('data-id'), { pan: true });
    });
    $('#listMore').addEventListener('click', function (e) {
      if (e.target.id === 'btnListMore') { state.listExpanded = true; renderList(); }
    });

    // 상세 패널
    $('#detailPanel').addEventListener('click', onPanelClick);
    $('#detailPanel').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.form) {
        e.preventDefault();
        e.target.form.requestSubmit ? e.target.form.requestSubmit() : e.target.form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });

    // 헤더
    $('#btnCluster').addEventListener('click', toggleCluster);
    $('#btnFit').addEventListener('click', fitBounds);
    $('#btnLocate').addEventListener('click', function () {
      if (state.map) { state.map.setCenter(new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng)); state.map.setLevel(DEFAULT_LEVEL); }
      else if (state.preview) state.preview.fit();
    });
    $('#btnMapView').addEventListener('click', function () { setRoadview(false); });
    $('#btnRoadview').addEventListener('click', function () { setRoadview(!state.roadview); });
    $('#btnHelp').addEventListener('click', showHelp);
    $('#btnPreviewHelp').addEventListener('click', showHelp);
    var btnCode = $('#btnCodeChange');
    if (btnCode) btnCode.addEventListener('click', changeAccessCode);

    $('#btnAdd').addEventListener('click', function () {
      if (!canEdit()) { toast('읽기 전용 모드입니다. 물건을 추가할 수 없습니다.', true); return; }
      state.panelMode = 'add';
      state.selectedId = null;
      state._addPrefill = {};
      renderDetail();
      $('#detailPanel').classList.remove('hidden');
      closeSidebarOnMobile();
    });
    $('#btnAddCancel').addEventListener('click', function () { setAddMode(false); });

    // 내보내기 메뉴
    var menu = $('#exportMenu');
    $('#btnExportMenu').addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle('hidden');
      this.setAttribute('aria-expanded', String(!open));
    });
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-export]');
      if (!b) return;
      var kind = b.getAttribute('data-export');
      menu.classList.add('hidden');
      $('#btnExportMenu').setAttribute('aria-expanded', 'false');
      if (kind === 'json' || kind === 'csv') exportAll(kind);
      else if (kind === 'changes-json' || kind === 'changes-csv') exportChanges(kind.replace('changes-', ''));
      else if (kind === 'im-import') { if (!canEdit()) { toast('읽기 전용 모드입니다.', true); return; } openImImport(); }
      else if (kind === 'reset') resetChanges();
    });
    document.addEventListener('click', function (e) {
      if (!menu.classList.contains('hidden') && !e.target.closest('.menu-wrap')) {
        menu.classList.add('hidden');
        $('#btnExportMenu').setAttribute('aria-expanded', 'false');
      }
    });

    // 모바일 사이드바
    $('#btnMenu').addEventListener('click', function () {
      var open = $('#sidebar').classList.toggle('is-open');
      $('#sidebarBackdrop').classList.toggle('hidden', !open);
      this.setAttribute('aria-expanded', String(open));
    });
    $('#sidebarBackdrop').addEventListener('click', closeSidebarOnMobile);

    // 키보드
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (state.addMode) { setAddMode(false); return; }
        if (state.panelMode === 'edit') { state.panelMode = 'view'; renderDetail(); return; }
        if (state.panelMode === 'add') { $('#detailPanel').classList.add('hidden'); state.panelMode = 'view'; return; }
        if (!$('#detailPanel').classList.contains('hidden')) $('#detailPanel').classList.add('hidden');
        closeSidebarOnMobile();
      }
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        $('#searchInput').focus();
      }
    });

    window.addEventListener('hashchange', function () {
      var id = decodeURIComponent((location.hash || '').replace('#', ''));
      if (id && state.index[id]) selectAsset(id, { pan: true });
    });
  }

  /* 미리보기 모드용 대한민국 실루엣 (KOSTAT 2013, shapely union·단순화, lng/lat) */
  var KOREA_LAND = [[126.467,37.802,126.51,37.781,126.517,37.767,126.514,37.761,126.529,37.745,126.528,37.735,126.53,37.746,126.517,37.764,126.538,37.769,126.561,37.765,126.571,37.752,126.594,37.755,126.612,37.75,126.641,37.776,126.669,37.782,126.664,37.787,126.676,37.828,126.661,37.837,126.682,37.843,126.694,37.866,126.686,37.871,126.675,37.867,126.679,37.871,126.674,37.875,126.684,37.877,126.682,37.882,126.675,37.879,126.677,37.883,126.672,37.885,126.679,37.895,126.678,37.904,126.687,37.91,126.668,37.916,126.674,37.937,126.672,37.953,126.693,37.941,126.72,37.933,126.727,37.945,126.737,37.941,126.747,37.949,126.739,37.963,126.75,37.976,126.765,37.982,126.775,37.976,126.775,37.982,126.784,37.978,126.798,37.991,126.832,37.99,126.825,38.009,126.831,38.017,126.839,38.014,126.838,38.022,126.833,38.023,126.834,38.031,126.855,38.029,126.875,38.016,126.887,38.033,126.883,38.038,126.895,38.049,126.892,38.065,126.896,38.071,126.869,38.078,126.858,38.09,126.849,38.092,126.838,38.086,126.848,38.07,126.839,38.08,126.825,38.076,126.821,38.086,126.787,38.08,126.782,38.083,126.787,38.097,126.774,38.102,126.77,38.112,126.75,38.118,126.75,38.125,126.772,38.152,126.803,38.178,126.875,38.22,126.897,38.202,126.931,38.198,126.931,38.205,126.954,38.208,126.964,38.202,126.956,38.195,126.962,38.186,126.967,38.195,126.977,38.197,126.986,38.208,126.979,38.219,126.983,38.224,126.978,38.232,126.994,38.234,127.0,38.228,126.999,38.239,127.028,38.255,127.072,38.268,127.118,38.292,127.139,38.307,127.15,38.332,127.161,38.332,127.17,38.32,127.184,38.314,127.199,38.316,127.246,38.336,127.261,38.329,127.296,38.325,127.313,38.314,127.34,38.329,127.356,38.327,127.387,38.337,127.405,38.336,127.427,38.332,127.451,38.315,127.475,38.317,127.489,38.301,127.505,38.301,127.553,38.327,127.59,38.337,127.613,38.338,127.62,38.33,127.641,38.326,127.677,38.327,127.692,38.33,127.702,38.341,127.732,38.335,127.749,38.345,127.764,38.343,127.78,38.351,127.804,38.323,127.853,38.329,127.868,38.333,127.871,38.34,127.887,38.341,127.928,38.334,127.957,38.324,127.975,38.326,127.986,38.315,128.034,38.317,128.036,38.313,128.066,38.311,128.218,38.38,128.284,38.433,128.304,38.469,128.308,38.504,128.316,38.512,128.312,38.523,128.318,38.562,128.314,38.595,128.323,38.607,128.36,38.614,128.374,38.59,128.405,38.563,128.407,38.552,128.413,38.553,128.409,38.547,128.413,38.544,128.405,38.541,128.426,38.52,128.424,38.504,128.43,38.503,128.428,38.498,128.436,38.486,128.445,38.483,128.441,38.481,128.444,38.472,128.451,38.47,128.471,38.448,128.458,38.444,128.46,38.427,128.481,38.4,128.518,38.369,128.518,38.355,128.529,38.336,128.54,38.335,128.542,38.322,128.553,38.311,128.571,38.266,128.586,38.252,128.592,38.24,128.587,38.228,128.605,38.212,128.604,38.21,128.605,38.205,128.605,38.202,128.604,38.208,128.597,38.208,128.597,38.204,128.602,38.204,128.598,38.203,128.598,38.198,128.617,38.178,128.612,38.176,128.613,38.171,128.608,38.171,128.615,38.142,128.628,38.127,128.633,38.126,128.64,38.112,128.669,38.089,128.681,38.072,128.679,38.064,128.689,38.053,128.729,38.021,128.739,38.02,128.736,38.003,128.752,37.99,128.754,37.984,128.767,37.978,128.763,37.974,128.769,37.97,128.766,37.966,128.772,37.956,128.793,37.942,128.791,37.935,128.801,37.924,128.833,37.904,128.837,37.895,128.833,37.881,128.88,37.838,128.882,37.827,128.93,37.786,128.953,37.77,128.958,37.761,128.952,37.752,128.969,37.753,128.991,37.74,128.997,37.724,129.017,37.705,129.061,37.671,129.056,37.663,129.058,37.652,129.047,37.64,129.048,37.634,129.055,37.624,129.06,37.623,129.067,37.62,129.056,37.623,129.075,37.603,129.118,37.577,129.125,37.556,129.12,37.543,129.119,37.547,129.114,37.547,129.115,37.537,129.128,37.523,129.127,37.515,129.151,37.495,129.138,37.501,129.134,37.499,129.139,37.494,129.126,37.488,129.128,37.485,129.147,37.494,129.144,37.489,129.149,37.49,129.164,37.472,129.19,37.453,129.199,37.43,129.194,37.435,129.19,37.436,129.19,37.435,129.194,37.435,129.195,37.422,129.203,37.41,129.23,37.39,129.253,37.378,129.263,37.378,129.255,37.373,129.254,37.361,129.27,37.34,129.271,37.321,129.29,37.307,129.302,37.308,129.304,37.289,129.312,37.289,129.314,37.283,129.324,37.286,129.323,37.281,129.332,37.276,129.33,37.261,129.343,37.252,129.344,37.246,129.352,37.246,129.352,37.236,129.359,37.233,129.344,37.223,129.35,37.209,129.342,37.191,129.344,37.175,129.376,37.132,129.376,37.122,129.384,37.117,129.379,37.107,129.382,37.097,129.398,37.081,129.43,37.062,129.432,37.056,129.418,37.051,129.416,37.042,129.42,37.031,129.412,37.028,129.422,36.99,129.411,36.977,129.424,36.937,129.418,36.907,129.424,36.895,129.418,36.886,129.43,36.848,129.46,36.812,129.465,36.786,129.481,36.765,129.47,36.754,129.48,36.73,129.475,36.718,129.479,36.697,129.471,36.691,129.473,36.683,129.468,36.684,129.472,36.682,129.467,36.682,129.469,36.676,129.459,36.678,129.44,36.667,129.431,36.646,129.42,36.636,129.415,36.62,129.419,36.601,129.413,36.595,129.416,36.581,129.443,36.549,129.446,36.509,129.456,36.505,129.449,36.501,129.448,36.486,129.436,36.478,129.44,36.46,129.436,36.438,129.439,36.424,129.433,36.407,129.411,36.385,129.396,36.354,129.392,36.354,129.392,36.345,129.382,36.33,129.385,36.32,129.38,36.304,129.382,36.291,129.377,36.285,129.384,36.272,129.378,36.267,129.375,36.252,129.388,36.236,129.384,36.227,129.389,36.22,129.387,36.209,129.375,36.204,129.375,36.193,129.396,36.179,129.404,36.152,129.397,36.139,129.4,36.132,129.428,36.111,129.433,36.11,129.433,36.111,129.44,36.111,129.443,36.11,129.435,36.111,129.443,36.108,129.443,36.097,129.439,36.097,129.439,36.093,129.433,36.097,129.421,36.086,129.421,36.071,129.407,36.068,129.399,36.06,129.385,36.059,129.381,36.049,129.384,36.048,129.387,36.043,129.384,36.047,129.375,36.048,129.384,36.044,129.38,36.038,129.388,36.03,129.386,36.027,129.391,36.029,129.396,36.023,129.41,36.027,129.394,36.009,129.407,36.011,129.41,36.006,129.414,36.012,129.426,35.997,129.454,35.989,129.461,36.001,129.505,36.023,129.506,36.034,129.527,36.055,129.536,36.055,129.534,36.059,129.548,36.073,129.548,36.076,129.548,36.077,129.549,36.08,129.548,36.081,129.56,36.083,129.564,36.075,129.572,36.076,129.571,36.065,129.577,36.061,129.577,36.06,129.578,36.057,129.58,36.055,129.579,36.054,129.58,36.053,129.58,36.053,129.58,36.053,129.58,36.053,129.58,36.051,129.58,36.051,129.58,36.05,129.58,36.05,129.58,36.049,129.582,36.049,129.58,36.046,129.586,36.043,129.58,36.031,129.585,36.026,129.58,36.022,129.587,36.014,129.58,36.009,129.58,36.0,129.575,36.001,129.569,35.994,129.57,35.987,129.555,35.984,129.556,35.98,129.562,35.982,129.554,35.976,129.557,35.965,129.55,35.961,129.55,35.948,129.542,35.946,129.533,35.929,129.527,35.931,129.521,35.924,129.53,35.902,129.54,35.897,129.528,35.893,129.528,35.885,129.534,35.883,129.531,35.874,129.523,35.878,129.522,35.872,129.538,35.868,129.53,35.861,129.529,35.85,129.521,35.84,129.523,35.835,129.512,35.822,129.515,35.805,129.506,35.804,129.509,35.803,129.502,35.797,129.504,35.79,129.494,35.786,129.5,35.771,129.494,35.756,129.497,35.749,129.487,35.74,129.489,35.726,129.476,35.702,129.478,35.683,129.468,35.674,129.467,35.663,129.457,35.661,129.451,35.645,129.444,35.641,129.444,35.627,129.456,35.613,129.453,35.615,129.452,35.612,129.461,35.61,129.467,35.584,129.455,35.575,129.461,35.555,129.454,35.533,129.457,35.524,129.441,35.526,129.441,35.516,129.448,35.519,129.446,35.523,129.453,35.522,129.448,35.508,129.435,35.508,129.434,35.502,129.444,35.505,129.446,35.499,129.435,35.497,129.434,35.491,129.444,35.493,129.449,35.488,129.443,35.488,129.434,35.475,129.43,35.475,129.434,35.477,129.431,35.482,129.426,35.481,129.431,35.477,129.419,35.477,129.412,35.468,129.405,35.474,129.41,35.49,129.405,35.497,129.38,35.498,129.373,35.497,129.365,35.502,129.37,35.495,129.382,35.497,129.392,35.485,129.386,35.48,129.387,35.47,129.365,35.457,129.37,35.455,129.367,35.454,129.357,35.457,129.355,35.462,129.342,35.472,129.341,35.477,129.339,35.479,129.337,35.479,129.351,35.452,129.355,35.451,129.351,35.452,129.352,35.445,129.362,35.445,129.357,35.435,129.369,35.44,129.366,35.431,129.371,35.429,129.358,35.41,129.365,35.408,129.365,35.403,129.355,35.4,129.36,35.392,129.349,35.386,129.355,35.383,129.348,35.377,129.358,35.371,129.366,35.358,129.347,35.348,129.343,35.353,129.337,35.352,129.336,35.346,129.325,35.343,129.316,35.327,129.305,35.325,129.301,35.315,129.291,35.316,129.284,35.324,129.268,35.316,129.261,35.303,129.266,35.296,129.26,35.285,129.263,35.278,129.255,35.268,129.247,35.269,129.245,35.261,129.236,35.259,129.242,35.254,129.254,35.257,129.256,35.244,129.246,35.234,129.248,35.228,129.241,35.217,129.231,35.218,129.236,35.211,129.227,35.183,129.217,35.183,129.215,35.178,129.202,35.176,129.197,35.158,129.183,35.152,129.167,35.156,129.153,35.149,129.155,35.154,129.149,35.15,129.137,35.158,129.14,35.154,129.139,35.151,129.123,35.135,129.121,35.133,129.114,35.132,129.119,35.127,129.123,35.131,129.129,35.117,129.126,35.096,129.115,35.1,129.097,35.096,129.094,35.105,129.09,35.1,129.077,35.1,129.069,35.105,129.076,35.114,129.072,35.115,129.075,35.119,129.068,35.12,129.068,35.127,129.058,35.115,129.055,35.118,129.058,35.122,129.052,35.12,129.055,35.113,129.05,35.116,129.053,35.111,129.047,35.113,129.043,35.105,129.047,35.103,129.042,35.103,129.046,35.1,129.04,35.101,129.042,35.092,129.051,35.092,129.052,35.096,129.054,35.092,129.053,35.097,129.06,35.098,129.073,35.091,129.087,35.071,129.086,35.076,129.097,35.078,129.093,35.071,129.082,35.068,129.099,35.057,129.095,35.049,129.085,35.047,129.08,35.057,129.073,35.055,129.067,35.065,129.035,35.082,129.034,35.086,129.039,35.087,129.033,35.09,129.039,35.089,129.038,35.093,129.031,35.093,129.027,35.073,129.018,35.071,129.026,35.059,129.018,35.05,129.011,35.048,129.015,35.05,129.011,35.059,129.014,35.062,129.008,35.068,129.007,35.081,129.001,35.08,129.004,35.077,128.995,35.081,129.004,35.045,128.993,35.046,128.987,35.057,128.975,35.054,128.985,35.049,128.984,35.045,128.972,35.044,128.975,35.04,128.969,35.037,128.974,35.034,128.968,35.03,128.967,35.043,128.958,35.049,128.953,35.075,128.941,35.075,128.923,35.083,128.915,35.081,128.914,35.076,128.898,35.076,128.903,35.108,128.908,35.115,128.903,35.116,128.884,35.057,128.861,35.067,128.877,35.067,128.877,35.076,128.837,35.077,128.836,35.063,128.84,35.072,128.861,35.061,128.848,35.057,128.853,35.038,128.838,35.013,128.843,34.994,128.83,34.985,128.832,34.991,128.824,34.991,128.824,34.998,128.82,34.998,128.826,35.003,128.822,35.006,128.828,35.011,128.808,35.017,128.806,35.021,128.817,35.022,128.81,35.03,128.814,35.037,128.799,35.05,128.808,35.053,128.808,35.057,128.825,35.058,128.824,35.067,128.833,35.07,128.833,35.077,128.812,35.079,128.809,35.084,128.831,35.086,128.835,35.083,128.825,35.096,128.824,35.089,128.804,35.086,128.804,35.08,128.794,35.076,128.787,35.077,128.784,35.083,128.792,35.091,128.8,35.09,128.805,35.096,128.79,35.095,128.794,35.099,128.791,35.11,128.785,35.109,128.782,35.1,128.775,35.096,128.765,35.102,128.766,35.091,128.754,35.09,128.743,35.097,128.737,35.087,128.731,35.087,128.733,35.091,128.727,35.094,128.716,35.092,128.715,35.104,128.713,35.1,128.705,35.102,128.705,35.097,128.697,35.094,128.688,35.104,128.703,35.113,128.702,35.122,128.696,35.13,128.699,35.135,128.693,35.135,128.695,35.137,128.69,35.139,128.693,35.144,128.685,35.15,128.677,35.149,128.68,35.144,128.672,35.14,128.68,35.123,128.669,35.115,128.664,35.119,128.667,35.122,128.661,35.133,128.651,35.132,128.646,35.138,128.645,35.145,128.649,35.143,128.649,35.147,128.637,35.146,128.639,35.143,128.629,35.145,128.63,35.139,128.624,35.133,128.609,35.134,128.617,35.142,128.61,35.154,128.613,35.161,128.607,35.157,128.596,35.168,128.591,35.197,128.611,35.209,128.622,35.209,128.612,35.21,128.588,35.207,128.567,35.181,128.594,35.155,128.594,35.147,128.588,35.143,128.6,35.139,128.589,35.133,128.59,35.127,128.581,35.136,128.577,35.13,128.59,35.126,128.595,35.131,128.603,35.13,128.603,35.121,128.594,35.118,128.603,35.117,128.605,35.101,128.62,35.092,128.616,35.088,128.628,35.084,128.623,35.077,128.608,35.076,128.608,35.071,128.615,35.073,128.612,35.067,128.616,35.067,128.628,35.072,128.639,35.069,128.639,35.065,128.606,35.052,128.577,35.049,128.574,35.052,128.58,35.058,128.598,35.067,128.589,35.069,128.583,35.061,128.572,35.066,128.564,35.064,128.566,35.07,128.564,35.08,128.583,35.086,128.552,35.092,128.547,35.089,128.549,35.097,128.543,35.098,128.55,35.104,128.538,35.104,128.539,35.116,128.533,35.103,128.524,35.101,128.521,35.094,128.506,35.095,128.497,35.103,128.473,35.094,128.462,35.103,128.453,35.103,128.451,35.093,128.481,35.079,128.48,35.074,128.476,35.073,128.472,35.079,128.464,35.068,128.455,35.071,128.442,35.069,128.43,35.052,128.417,35.052,128.418,35.059,128.398,35.048,128.386,35.047,128.385,35.043,128.376,35.047,128.375,35.039,128.384,35.032,128.372,35.028,128.376,35.019,128.371,35.02,128.357,35.007,128.37,35.013,128.391,35.014,128.391,35.032,128.401,35.038,128.44,35.043,128.441,35.047,128.453,35.049,128.444,35.057,128.447,35.065,128.457,35.068,128.462,35.06,128.47,35.066,128.471,35.073,128.48,35.066,128.478,35.062,128.484,35.063,128.478,35.053,128.485,35.05,128.482,35.044,128.462,35.044,128.476,35.032,128.477,35.039,128.489,35.036,128.485,35.025,128.506,35.014,128.494,35.002,128.486,35.008,128.487,34.996,128.479,34.995,128.481,34.989,128.468,34.994,128.471,34.989,128.465,34.984,128.461,34.989,128.41,34.991,128.41,34.98,128.42,34.984,128.437,34.982,128.446,34.975,128.439,34.963,128.442,34.959,128.434,34.954,128.434,34.941,128.428,34.939,128.439,34.929,128.432,34.925,128.433,34.911,128.426,34.907,128.429,34.901,128.422,34.89,128.423,34.87,128.434,34.874,128.434,34.885,128.448,34.886,128.441,34.89,128.453,34.9,128.442,34.91,128.456,34.911,128.455,34.908,128.463,34.902,128.462,34.9,128.457,34.899,128.456,34.898,128.466,34.896,128.468,34.889,128.476,34.891,128.48,34.886,128.471,34.884,128.469,34.868,128.46,34.87,128.463,34.877,128.458,34.879,128.46,34.87,128.454,34.87,128.459,34.862,128.452,34.865,128.449,34.861,128.456,34.852,128.454,34.843,128.443,34.839,128.436,34.841,128.435,34.838,128.444,34.838,128.437,34.835,128.427,34.839,128.425,34.83,128.444,34.823,128.444,34.8,128.438,34.8,128.436,34.807,128.433,34.798,128.442,34.791,128.436,34.786,128.432,34.788,128.423,34.791,128.422,34.789,128.438,34.779,128.426,34.767,128.426,34.759,128.423,34.762,128.409,34.759,128.41,34.765,128.4,34.762,128.399,34.777,128.389,34.773,128.393,34.783,128.391,34.787,128.383,34.79,128.386,34.794,128.377,34.791,128.38,34.791,128.377,34.786,128.376,34.791,128.366,34.793,128.371,34.798,128.375,34.796,128.375,34.796,128.375,34.8,128.38,34.796,128.381,34.812,128.36,34.823,128.348,34.822,128.338,34.814,128.332,34.826,128.339,34.823,128.336,34.831,128.343,34.825,128.344,34.832,128.341,34.832,128.339,34.838,128.34,34.84,128.344,34.838,128.347,34.828,128.35,34.839,128.356,34.84,128.361,34.836,128.359,34.829,128.367,34.832,128.368,34.828,128.373,34.831,128.375,34.826,128.38,34.827,128.378,34.823,128.384,34.821,128.388,34.81,128.386,34.826,128.394,34.82,128.407,34.829,128.401,34.832,128.396,34.826,128.394,34.832,128.381,34.833,128.391,34.837,128.385,34.841,128.377,34.838,128.374,34.841,128.379,34.842,128.372,34.846,128.373,34.85,128.387,34.853,128.386,34.859,128.391,34.86,128.399,34.86,128.399,34.855,128.403,34.859,128.416,34.855,128.423,34.86,128.417,34.864,128.417,34.861,128.387,34.865,128.392,34.872,128.383,34.87,128.387,34.879,128.383,34.886,128.378,34.888,128.382,34.882,128.377,34.878,128.373,34.882,128.379,34.868,128.375,34.866,128.358,34.868,128.359,34.877,128.355,34.876,128.351,34.884,128.353,34.873,128.347,34.869,128.343,34.879,128.336,34.88,128.34,34.874,128.331,34.872,128.326,34.876,128.33,34.883,128.322,34.876,128.311,34.882,128.311,34.891,128.3,34.897,128.31,34.906,128.341,34.905,128.348,34.901,128.358,34.906,128.353,34.913,128.355,34.913,128.357,34.916,128.348,34.918,128.353,34.92,128.345,34.923,128.343,34.919,128.337,34.918,128.34,34.924,128.343,34.921,128.348,34.926,128.348,34.934,128.346,34.937,128.338,34.933,128.344,34.938,128.343,34.945,128.336,34.941,128.331,34.945,128.335,34.951,128.323,34.958,128.319,34.956,128.323,34.941,128.317,34.939,128.317,34.935,128.31,34.938,128.311,34.934,128.302,34.933,128.301,34.924,128.307,34.916,128.301,34.914,128.303,34.909,128.291,34.907,128.284,34.913,128.285,34.901,128.275,34.896,128.273,34.902,128.278,34.902,128.278,34.907,128.268,34.909,128.27,34.915,128.26,34.926,128.266,34.924,128.271,34.927,128.27,34.937,128.266,34.934,128.262,34.937,128.259,34.933,128.252,34.94,128.247,34.933,128.248,34.941,128.229,34.938,128.225,34.943,128.22,34.936,128.215,34.94,128.211,34.933,128.209,34.938,128.198,34.933,128.207,34.924,128.199,34.909,128.206,34.896,128.203,34.89,128.19,34.89,128.189,34.902,128.187,34.892,128.177,34.903,128.174,34.9,128.179,34.892,128.171,34.894,128.17,34.899,128.169,34.894,128.158,34.905,128.149,34.901,128.153,34.896,128.144,34.899,128.143,34.89,128.135,34.885,128.124,34.901,128.114,34.9,128.103,34.911,128.114,34.92,128.122,34.918,128.114,34.922,128.11,34.919,128.104,34.922,128.1,34.917,128.098,34.923,128.088,34.915,128.09,34.923,128.08,34.924,128.076,34.919,128.072,34.921,128.074,34.924,128.055,34.927,128.051,34.923,128.046,34.921,128.04,34.916,128.036,34.917,128.037,34.924,128.042,34.92,128.055,34.928,128.041,34.937,128.032,34.955,128.052,34.967,128.054,34.974,128.047,34.977,128.041,34.993,128.053,35.013,128.047,35.021,128.04,35.015,128.037,35.02,128.044,35.029,128.041,35.035,128.045,35.044,128.04,35.048,128.045,35.06,128.064,35.076,128.058,35.077,128.059,35.084,128.055,35.076,128.035,35.065,128.037,35.059,128.029,35.052,128.034,35.047,128.023,35.025,128.011,35.027,128.004,35.039,127.997,35.043,127.987,35.042,127.978,35.03,127.99,35.03,127.991,35.036,127.998,35.035,127.997,35.029,128.011,35.019,128.011,35.01,128.021,35.007,128.017,34.988,128.01,34.993,128.014,34.983,128.01,34.979,128.006,34.98,128.008,34.985,128.002,34.98,128.004,34.986,128.0,34.993,127.997,34.982,127.991,34.986,127.994,34.978,127.985,34.973,127.975,34.983,127.974,34.991,127.966,34.991,127.959,34.981,127.95,34.98,127.955,34.978,127.951,34.976,127.955,34.972,127.943,34.976,127.936,34.979,127.946,34.981,127.94,34.986,127.936,34.982,127.934,34.99,127.937,34.993,127.942,34.99,127.94,34.994,127.947,34.996,127.938,34.995,127.942,35.001,127.925,35.011,127.919,34.994,127.925,34.987,127.92,34.984,127.922,34.978,127.911,34.98,127.914,34.969,127.901,34.964,127.904,34.952,127.897,34.955,127.889,34.949,127.887,34.953,127.885,34.946,127.877,34.944,127.865,34.943,127.86,34.948,127.85,34.943,127.843,34.959,127.841,34.951,127.838,34.956,127.839,34.947,127.831,34.948,127.821,34.939,127.82,34.946,127.812,34.945,127.818,34.936,127.81,34.936,127.809,34.941,127.788,34.937,127.767,34.97,127.782,34.985,127.767,34.975,127.763,34.963,127.757,34.959,127.74,34.952,127.735,34.952,127.732,34.96,127.731,34.96,127.734,34.952,127.72,34.941,127.714,34.933,127.702,34.928,127.699,34.915,127.69,34.921,127.695,34.914,127.675,34.901,127.671,34.905,127.673,34.9,127.642,34.883,127.62,34.913,127.618,34.91,127.615,34.918,127.61,34.919,127.607,34.935,127.602,34.935,127.6,34.923,127.582,34.919,127.581,34.916,127.593,34.916,127.616,34.889,127.594,34.878,127.592,34.872,127.607,34.858,127.61,34.848,127.616,34.85,127.626,34.841,127.639,34.844,127.637,34.835,127.629,34.837,127.629,34.827,127.641,34.817,127.641,34.828,127.664,34.841,127.672,34.834,127.697,34.862,127.701,34.856,127.723,34.856,127.731,34.86,127.738,34.861,127.73,34.857,127.745,34.848,127.745,34.855,127.764,34.862,127.767,34.861,127.776,34.858,127.777,34.854,127.779,34.855,127.783,34.848,127.778,34.852,127.774,34.849,127.777,34.834,127.769,34.822,127.777,34.818,127.769,34.815,127.77,34.797,127.761,34.797,127.759,34.783,127.747,34.774,127.757,34.76,127.754,34.752,127.759,34.749,127.755,34.75,127.754,34.743,127.75,34.744,127.758,34.738,127.77,34.748,127.771,34.741,127.752,34.733,127.747,34.736,127.739,34.729,127.737,34.721,127.738,34.719,127.727,34.723,127.706,34.717,127.68,34.733,127.683,34.738,127.669,34.745,127.665,34.737,127.668,34.745,127.665,34.754,127.659,34.752,127.661,34.743,127.655,34.741,127.641,34.715,127.637,34.716,127.645,34.704,127.628,34.709,127.631,34.714,127.627,34.715,127.624,34.705,127.616,34.704,127.63,34.693,127.626,34.684,127.642,34.68,127.632,34.676,127.629,34.679,127.627,34.677,127.622,34.681,127.62,34.68,127.635,34.667,127.638,34.658,127.631,34.652,127.632,34.646,127.645,34.647,127.642,34.643,127.635,34.643,127.643,34.641,127.635,34.633,127.643,34.634,127.647,34.624,127.638,34.623,127.636,34.63,127.627,34.627,127.627,34.631,127.617,34.64,127.592,34.649,127.577,34.645,127.582,34.628,127.567,34.652,127.556,34.655,127.555,34.666,127.566,34.672,127.552,34.679,127.555,34.691,127.56,34.691,127.562,34.697,127.583,34.691,127.579,34.699,127.566,34.698,127.565,34.706,127.555,34.697,127.559,34.711,127.551,34.708,127.553,34.717,127.566,34.721,127.563,34.729,127.569,34.725,127.581,34.73,127.58,34.736,127.586,34.736,127.585,34.743,127.606,34.74,127.586,34.747,127.592,34.753,127.585,34.766,127.581,34.758,127.575,34.757,127.577,34.767,127.574,34.771,127.561,34.774,127.575,34.78,127.561,34.793,127.559,34.804,127.548,34.807,127.546,34.803,127.534,34.802,127.525,34.807,127.528,34.819,127.54,34.829,127.546,34.839,127.535,34.838,127.534,34.833,127.534,34.839,127.524,34.847,127.524,34.856,127.517,34.867,127.52,34.878,127.506,34.871,127.493,34.874,127.49,34.866,127.497,34.864,127.497,34.858,127.49,34.855,127.496,34.843,127.487,34.837,127.468,34.842,127.452,34.836,127.452,34.831,127.436,34.837,127.436,34.831,127.403,34.822,127.382,34.835,127.37,34.832,127.356,34.836,127.385,34.824,127.394,34.811,127.43,34.811,127.397,34.793,127.399,34.786,127.394,34.789,127.39,34.785,127.396,34.781,127.39,34.781,127.39,34.776,127.372,34.776,127.395,34.774,127.403,34.764,127.399,34.754,127.383,34.747,127.375,34.738,127.381,34.724,127.395,34.716,127.389,34.712,127.399,34.704,127.404,34.705,127.406,34.702,127.415,34.701,127.417,34.704,127.425,34.698,127.437,34.698,127.447,34.687,127.447,34.694,127.456,34.693,127.455,34.686,127.447,34.682,127.451,34.68,127.446,34.679,127.422,34.698,127.404,34.7,127.42,34.688,127.426,34.689,127.428,34.679,127.436,34.677,127.43,34.671,127.442,34.677,127.445,34.67,127.449,34.671,127.448,34.659,127.46,34.666,127.469,34.659,127.474,34.663,127.467,34.663,127.465,34.668,127.48,34.669,127.477,34.658,127.472,34.659,127.478,34.655,127.477,34.651,127.483,34.653,127.483,34.647,127.49,34.648,127.494,34.64,127.479,34.645,127.477,34.639,127.471,34.638,127.466,34.646,127.461,34.644,127.463,34.638,127.494,34.629,127.495,34.633,127.5,34.629,127.499,34.612,127.505,34.608,127.511,34.589,127.499,34.587,127.489,34.575,127.49,34.571,127.483,34.575,127.478,34.575,127.478,34.57,127.467,34.575,127.46,34.588,127.455,34.585,127.46,34.581,127.447,34.573,127.435,34.579,127.436,34.585,127.421,34.579,127.415,34.588,127.398,34.584,127.396,34.578,127.401,34.573,127.411,34.577,127.406,34.566,127.418,34.566,127.419,34.572,127.432,34.563,127.423,34.564,127.423,34.561,127.408,34.558,127.406,34.566,127.399,34.557,127.425,34.554,127.419,34.55,127.422,34.548,127.433,34.552,127.429,34.544,127.435,34.549,127.44,34.546,127.435,34.54,127.428,34.541,127.437,34.537,127.438,34.532,127.431,34.534,127.429,34.528,127.424,34.527,127.433,34.516,127.424,34.515,127.433,34.51,127.427,34.508,127.415,34.518,127.405,34.512,127.409,34.509,127.406,34.502,127.396,34.502,127.391,34.507,127.388,34.501,127.38,34.501,127.394,34.485,127.389,34.48,127.385,34.483,127.385,34.475,127.38,34.484,127.373,34.477,127.361,34.488,127.353,34.478,127.343,34.486,127.34,34.48,127.345,34.478,127.327,34.473,127.339,34.464,127.335,34.46,127.334,34.465,127.33,34.463,127.326,34.467,127.322,34.46,127.318,34.461,127.339,34.454,127.341,34.442,127.33,34.438,127.329,34.443,127.325,34.438,127.316,34.441,127.315,34.446,127.308,34.445,127.306,34.45,127.318,34.452,127.315,34.457,127.311,34.455,127.312,34.459,127.304,34.454,127.306,34.462,127.299,34.46,127.303,34.467,127.27,34.479,127.276,34.489,127.285,34.488,127.28,34.492,127.285,34.494,127.284,34.498,127.276,34.499,127.256,34.518,127.247,34.518,127.247,34.511,127.233,34.515,127.235,34.522,127.227,34.523,127.223,34.531,127.217,34.521,127.211,34.524,127.214,34.513,127.196,34.529,127.181,34.528,127.174,34.517,127.169,34.523,127.139,34.52,127.123,34.527,127.123,34.538,127.114,34.543,127.115,34.556,127.13,34.57,127.138,34.57,127.135,34.575,127.146,34.581,127.144,34.587,127.151,34.598,127.152,34.591,127.162,34.588,127.173,34.591,127.169,34.599,127.175,34.603,127.175,34.624,127.197,34.642,127.198,34.649,127.205,34.635,127.2,34.594,127.228,34.581,127.204,34.594,127.21,34.626,127.226,34.633,127.235,34.678,127.245,34.68,127.239,34.69,127.244,34.69,127.243,34.697,127.25,34.699,127.248,34.703,127.256,34.702,127.253,34.709,127.265,34.714,127.271,34.709,127.277,34.717,127.283,34.716,127.279,34.709,127.284,34.703,127.282,34.697,127.289,34.693,127.285,34.691,127.289,34.689,127.283,34.684,127.282,34.67,127.288,34.664,127.317,34.662,127.322,34.669,127.319,34.679,127.329,34.686,127.334,34.704,127.346,34.706,127.345,34.713,127.335,34.712,127.329,34.748,127.306,34.746,127.295,34.728,127.288,34.733,127.28,34.731,127.281,34.735,127.274,34.738,127.264,34.729,127.254,34.739,127.248,34.758,127.24,34.756,127.247,34.76,127.246,34.772,127.243,34.772,127.237,34.76,127.231,34.76,127.231,34.755,127.237,34.757,127.237,34.755,127.211,34.734,127.214,34.728,127.208,34.716,127.187,34.691,127.146,34.69,127.131,34.703,127.117,34.691,127.109,34.674,127.074,34.658,127.069,34.661,127.066,34.648,127.056,34.639,127.047,34.64,127.049,34.632,127.042,34.633,127.031,34.625,127.014,34.621,126.966,34.623,126.996,34.621,126.997,34.611,127.011,34.605,127.002,34.601,127.002,34.595,126.995,34.591,126.995,34.579,126.981,34.571,127.0,34.563,127.007,34.567,127.006,34.553,127.0,34.559,126.991,34.559,126.991,34.537,126.975,34.54,126.96,34.528,126.967,34.52,126.976,34.521,126.98,34.508,126.97,34.507,126.971,34.502,126.963,34.497,126.969,34.489,126.979,34.485,126.981,34.468,126.97,34.475,126.966,34.465,126.959,34.465,126.944,34.48,126.94,34.473,126.949,34.454,126.941,34.444,126.932,34.444,126.928,34.45,126.875,34.453,126.889,34.431,126.887,34.419,126.877,34.432,126.87,34.436,126.867,34.431,126.864,34.439,126.847,34.448,126.826,34.445,126.813,34.452,126.809,34.447,126.806,34.456,126.811,34.465,126.787,34.466,126.789,34.474,126.799,34.477,126.794,34.486,126.794,34.507,126.789,34.509,126.792,34.538,126.797,34.544,126.793,34.544,126.791,34.555,126.797,34.564,126.788,34.574,126.791,34.583,126.78,34.592,126.784,34.595,126.78,34.614,126.784,34.63,126.772,34.613,126.774,34.594,126.768,34.56,126.771,34.552,126.767,34.542,126.77,34.539,126.766,34.537,126.766,34.53,126.775,34.522,126.761,34.523,126.764,34.5,126.768,34.495,126.761,34.492,126.763,34.488,126.741,34.483,126.751,34.47,126.756,34.473,126.756,34.468,126.75,34.469,126.727,34.438,126.721,34.442,126.716,34.436,126.7,34.437,126.689,34.426,126.677,34.424,126.68,34.413,126.665,34.423,126.665,34.417,126.653,34.419,126.648,34.405,126.637,34.408,126.63,34.399,126.626,34.404,126.619,34.399,126.624,34.393,126.615,34.383,126.617,34.377,126.625,34.374,126.621,34.371,126.623,34.356,126.605,34.346,126.613,34.339,126.606,34.335,126.604,34.317,126.608,34.312,126.599,34.309,126.588,34.317,126.561,34.319,126.547,34.3,126.531,34.297,126.535,34.297,126.527,34.289,126.518,34.292,126.517,34.303,126.522,34.309,126.514,34.316,126.529,34.331,126.522,34.342,126.522,34.358,126.505,34.362,126.5,34.354,126.493,34.356,126.476,34.345,126.468,34.355,126.47,34.361,126.478,34.352,126.483,34.355,126.478,34.362,126.483,34.358,126.489,34.361,126.477,34.37,126.483,34.373,126.475,34.375,126.483,34.38,126.478,34.378,126.473,34.381,126.484,34.382,126.485,34.386,126.499,34.383,126.489,34.398,126.492,34.4,126.489,34.405,126.511,34.403,126.519,34.411,126.51,34.424,126.516,34.43,126.51,34.436,126.499,34.428,126.486,34.431,126.484,34.422,126.456,34.446,126.467,34.451,126.473,34.445,126.479,34.447,126.469,34.454,126.473,34.466,126.465,34.465,126.457,34.474,126.458,34.479,126.467,34.481,126.458,34.486,126.466,34.493,126.458,34.498,126.473,34.504,126.464,34.518,126.442,34.521,126.462,34.529,126.445,34.536,126.436,34.531,126.44,34.535,126.434,34.542,126.438,34.547,126.426,34.552,126.418,34.543,126.404,34.542,126.405,34.535,126.388,34.529,126.38,34.536,126.391,34.548,126.386,34.55,126.385,34.559,126.365,34.555,126.362,34.561,126.355,34.562,126.356,34.567,126.353,34.564,126.336,34.57,126.316,34.564,126.307,34.57,126.311,34.573,126.306,34.574,126.315,34.585,126.301,34.587,126.297,34.597,126.294,34.589,126.282,34.592,126.285,34.601,126.29,34.602,126.282,34.609,126.266,34.606,126.261,34.609,126.271,34.612,126.281,34.609,126.285,34.614,126.282,34.619,126.291,34.618,126.295,34.626,126.291,34.632,126.287,34.627,126.279,34.627,126.262,34.638,126.262,34.642,126.269,34.64,126.27,34.644,126.261,34.65,126.265,34.656,126.257,34.661,126.262,34.673,126.257,34.677,126.265,34.682,126.26,34.69,126.263,34.705,126.269,34.701,126.276,34.715,126.282,34.715,126.276,34.726,126.287,34.755,126.301,34.759,126.335,34.738,126.337,34.728,126.333,34.718,126.352,34.706,126.351,34.696,126.342,34.692,126.34,34.682,126.363,34.646,126.363,34.635,126.373,34.634,126.376,34.623,126.372,34.602,126.376,34.612,126.383,34.615,126.391,34.605,126.411,34.604,126.412,34.598,126.454,34.579,126.452,34.586,126.467,34.591,126.438,34.595,126.429,34.601,126.43,34.611,126.407,34.622,126.42,34.633,126.408,34.63,126.407,34.643,126.421,34.653,126.404,34.642,126.403,34.625,126.396,34.623,126.376,34.641,126.363,34.665,126.39,34.69,126.38,34.706,126.375,34.703,126.381,34.692,126.377,34.691,126.378,34.685,126.366,34.676,126.355,34.674,126.346,34.683,126.349,34.692,126.37,34.696,126.377,34.711,126.386,34.717,126.391,34.728,126.369,34.735,126.365,34.74,126.368,34.746,126.382,34.75,126.382,34.754,126.377,34.753,126.384,34.761,126.381,34.764,126.451,34.78,126.443,34.796,126.391,34.777,126.392,34.784,126.384,34.776,126.371,34.778,126.368,34.787,126.36,34.791,126.364,34.791,126.367,34.801,126.362,34.802,126.389,34.826,126.39,34.834,126.399,34.835,126.402,34.841,126.414,34.84,126.407,34.845,126.405,34.861,126.397,34.866,126.404,34.877,126.394,34.88,126.388,34.875,126.396,34.892,126.393,34.897,126.402,34.896,126.407,34.907,126.394,34.917,126.391,34.924,126.4,34.932,126.389,34.942,126.395,34.961,126.381,34.968,126.382,34.985,126.376,34.986,126.374,34.996,126.368,34.978,126.373,34.97,126.362,34.965,126.363,34.959,126.37,34.96,126.377,34.954,126.368,34.94,126.377,34.94,126.369,34.93,126.374,34.921,126.371,34.916,126.355,34.919,126.346,34.911,126.331,34.913,126.328,34.927,126.308,34.925,126.307,34.932,126.312,34.93,126.323,34.941,126.311,34.946,126.297,34.962,126.307,34.982,126.316,34.985,126.312,34.973,126.318,34.972,126.322,34.978,126.33,34.964,126.35,34.973,126.353,34.979,126.36,34.981,126.361,34.99,126.342,34.994,126.335,34.991,126.391,35.021,126.39,35.033,126.382,35.045,126.354,35.036,126.349,35.046,126.354,35.049,126.351,35.053,126.333,35.058,126.342,35.062,126.345,35.069,126.335,35.084,126.324,35.086,126.319,35.084,126.32,35.075,126.314,35.073,126.32,35.067,126.303,35.058,126.317,35.052,126.306,35.042,126.297,35.038,126.304,35.043,126.293,35.046,126.297,35.052,126.285,35.059,126.279,35.051,126.262,35.05,126.266,35.039,126.276,35.031,126.269,35.026,126.268,35.019,126.262,35.016,126.261,35.012,126.258,35.012,126.258,35.01,126.249,35.011,126.245,35.024,126.243,35.016,126.231,35.014,126.229,35.02,126.234,35.023,126.23,35.035,126.237,35.041,126.235,35.05,126.225,35.055,126.211,35.05,126.206,35.054,126.212,35.042,126.207,35.036,126.196,35.053,126.206,35.054,126.204,35.059,126.184,35.055,126.182,35.063,126.175,35.06,126.169,35.069,126.163,35.064,126.168,35.08,126.159,35.086,126.16,35.096,126.192,35.11,126.212,35.1,126.22,35.104,126.235,35.095,126.238,35.099,126.252,35.094,126.244,35.103,126.25,35.108,126.242,35.104,126.263,35.142,126.273,35.142,126.272,35.147,126.276,35.148,126.282,35.133,126.289,35.132,126.294,35.139,126.32,35.128,126.332,35.138,126.328,35.147,126.336,35.146,126.348,35.157,126.349,35.134,126.343,35.127,126.346,35.112,126.334,35.09,126.346,35.089,126.355,35.097,126.355,35.085,126.345,35.083,126.347,35.074,126.353,35.077,126.363,35.072,126.367,35.077,126.37,35.074,126.366,35.072,126.37,35.068,126.368,35.062,126.372,35.059,126.384,35.074,126.382,35.079,126.39,35.084,126.4,35.08,126.389,35.076,126.387,35.064,126.393,35.062,126.4,35.074,126.41,35.057,126.401,35.05,126.405,35.047,126.396,35.045,126.393,35.04,126.404,35.04,126.401,35.03,126.404,35.024,126.429,35.025,126.42,35.039,126.443,35.053,126.454,35.07,126.459,35.071,126.438,35.083,126.46,35.087,126.467,35.097,126.448,35.103,126.423,35.103,126.405,35.132,126.393,35.135,126.385,35.15,126.361,35.166,126.354,35.178,126.342,35.183,126.369,35.192,126.381,35.205,126.379,35.209,126.364,35.194,126.337,35.188,126.32,35.177,126.309,35.175,126.306,35.183,126.301,35.184,126.303,35.193,126.3,35.193,126.316,35.207,126.302,35.207,126.3,35.213,126.306,35.242,126.313,35.252,126.327,35.24,126.335,35.244,126.326,35.248,126.33,35.256,126.327,35.259,126.334,35.264,126.327,35.268,126.325,35.285,126.346,35.29,126.36,35.286,126.376,35.298,126.38,35.326,126.399,35.366,126.406,35.366,126.407,35.36,126.421,35.362,126.43,35.355,126.446,35.353,126.45,35.346,126.448,35.354,126.433,35.357,126.432,35.365,126.413,35.372,126.413,35.376,126.422,35.378,126.41,35.379,126.404,35.393,126.41,35.397,126.406,35.4,126.414,35.402,126.405,35.401,126.424,35.427,126.429,35.423,126.452,35.429,126.448,35.432,126.43,35.431,126.437,35.448,126.443,35.447,126.464,35.478,126.484,35.518,126.487,35.52,126.499,35.507,126.503,35.521,126.521,35.531,126.547,35.524,126.548,35.53,126.569,35.54,126.593,35.539,126.596,35.532,126.619,35.554,126.619,35.567,126.626,35.565,126.636,35.572,126.65,35.567,126.669,35.551,126.671,35.563,126.676,35.565,126.667,35.574,126.676,35.583,126.663,35.582,126.654,35.592,126.644,35.589,126.639,35.597,126.638,35.59,126.627,35.59,126.619,35.582,126.606,35.583,126.6,35.591,126.595,35.585,126.543,35.585,126.531,35.576,126.519,35.578,126.517,35.584,126.511,35.576,126.494,35.583,126.481,35.599,126.473,35.6,126.468,35.596,126.469,35.603,126.462,35.607,126.464,35.617,126.472,35.617,126.462,35.619,126.47,35.628,126.458,35.634,126.467,35.637,126.468,35.641,126.481,35.642,126.486,35.653,126.506,35.656,126.523,35.673,126.53,35.674,126.535,35.688,126.541,35.687,126.556,35.697,126.572,35.692,126.596,35.709,126.614,35.734,126.629,35.745,126.625,35.786,126.634,35.797,126.701,35.796,126.73,35.791,126.771,35.771,126.779,35.755,126.77,35.782,126.779,35.798,126.736,35.815,126.725,35.825,126.687,35.841,126.7,35.854,126.722,35.857,126.733,35.864,126.768,35.859,126.767,35.863,126.791,35.862,126.801,35.871,126.798,35.88,126.803,35.891,126.827,35.895,126.84,35.908,126.793,35.902,126.772,35.886,126.738,35.889,126.727,35.883,126.701,35.891,126.678,35.892,126.67,35.88,126.616,35.883,126.612,35.914,126.617,35.94,126.597,35.945,126.54,35.939,126.536,35.93,126.528,35.931,126.533,35.941,126.524,35.945,126.523,35.968,126.68,35.98,126.678,35.988,126.688,35.99,126.682,35.996,126.726,35.992,126.737,35.998,126.678,36.006,126.668,36.002,126.663,36.008,126.666,36.017,126.661,36.026,126.669,36.03,126.646,36.053,126.631,36.051,126.633,36.074,126.627,36.078,126.62,36.074,126.626,36.082,126.635,36.079,126.648,36.086,126.646,36.091,126.633,36.088,126.633,36.097,126.622,36.099,126.614,36.093,126.6,36.118,126.579,36.135,126.572,36.138,126.57,36.13,126.558,36.126,126.556,36.134,126.545,36.142,126.52,36.149,126.509,36.147,126.503,36.139,126.506,36.126,126.496,36.133,126.5,36.139,126.496,36.145,126.497,36.156,126.522,36.163,126.529,36.174,126.526,36.182,126.533,36.192,126.569,36.186,126.569,36.192,126.563,36.196,126.554,36.192,126.54,36.196,126.54,36.207,126.534,36.216,126.528,36.216,126.533,36.222,126.532,36.236,126.548,36.266,126.542,36.275,126.537,36.273,126.542,36.276,126.53,36.294,126.519,36.296,126.503,36.322,126.508,36.328,126.517,36.324,126.532,36.334,126.545,36.336,126.563,36.349,126.547,36.352,126.511,36.378,126.481,36.381,126.483,36.393,126.488,36.398,126.499,36.429,126.494,36.442,126.485,36.45,126.475,36.5,126.491,36.515,126.483,36.513,126.463,36.536,126.449,36.582,126.454,36.594,126.444,36.597,126.466,36.595,126.48,36.605,126.476,36.614,126.459,36.623,126.47,36.651,126.463,36.662,126.464,36.682,126.453,36.691,126.444,36.664,126.446,36.634,126.426,36.597,126.419,36.596,126.397,36.615,126.377,36.613,126.367,36.624,126.363,36.666,126.35,36.673,126.348,36.718,126.342,36.698,126.343,36.665,126.352,36.629,126.362,36.622,126.357,36.62,126.359,36.615,126.338,36.616,126.338,36.609,126.331,36.604,126.318,36.586,126.309,36.592,126.294,36.581,126.284,36.589,126.285,36.619,126.298,36.627,126.297,36.641,126.283,36.665,126.266,36.669,126.269,36.678,126.262,36.687,126.264,36.694,126.274,36.702,126.273,36.726,126.254,36.71,126.244,36.714,126.245,36.707,126.238,36.714,126.237,36.705,126.243,36.705,126.244,36.7,126.231,36.69,126.214,36.69,126.199,36.672,126.191,36.669,126.182,36.674,126.175,36.669,126.173,36.676,126.133,36.665,126.126,36.68,126.133,36.686,126.139,36.685,126.139,36.681,126.152,36.683,126.148,36.7,126.162,36.704,126.161,36.709,126.168,36.714,126.187,36.714,126.197,36.705,126.208,36.703,126.219,36.709,126.224,36.718,126.217,36.723,126.203,36.718,126.213,36.737,126.202,36.733,126.184,36.743,126.187,36.75,126.167,36.755,126.164,36.75,126.144,36.751,126.154,36.746,126.154,36.728,126.125,36.704,126.123,36.709,126.128,36.715,126.123,36.722,126.136,36.738,126.135,36.747,126.119,36.753,126.104,36.77,126.117,36.772,126.12,36.768,126.137,36.773,126.131,36.777,126.132,36.784,126.139,36.782,126.147,36.79,126.144,36.793,126.15,36.793,126.152,36.8,126.145,36.806,126.154,36.809,126.15,36.814,126.156,36.814,126.161,36.824,126.148,36.834,126.155,36.836,126.151,36.844,126.157,36.842,126.163,36.847,126.166,36.839,126.178,36.841,126.174,36.809,126.187,36.812,126.182,36.817,126.188,36.82,126.179,36.825,126.177,36.833,126.189,36.839,126.197,36.851,126.192,36.853,126.192,36.863,126.186,36.864,126.192,36.875,126.179,36.882,126.182,36.886,126.197,36.885,126.203,36.894,126.198,36.898,126.205,36.902,126.215,36.898,126.241,36.907,126.24,36.91,126.242,36.907,126.255,36.912,126.249,36.905,126.244,36.886,126.227,36.886,126.22,36.877,126.237,36.87,126.238,36.863,126.244,36.861,126.253,36.867,126.255,36.877,126.274,36.874,126.272,36.882,126.277,36.895,126.283,36.9,126.292,36.898,126.285,36.907,126.295,36.926,126.285,36.967,126.296,36.967,126.307,36.977,126.31,36.971,126.309,36.959,126.316,36.952,126.305,36.941,126.312,36.927,126.304,36.915,126.316,36.902,126.322,36.902,126.323,36.889,126.335,36.888,126.329,36.881,126.316,36.88,126.315,36.87,126.305,36.86,126.307,36.854,126.298,36.85,126.297,36.84,126.319,36.836,126.318,36.831,126.297,36.821,126.285,36.822,126.283,36.815,126.291,36.811,126.29,36.796,126.295,36.796,126.298,36.805,126.308,36.812,126.32,36.811,126.324,36.817,126.33,36.811,126.34,36.813,126.326,36.824,126.33,36.834,126.317,36.839,126.327,36.844,126.326,36.848,126.322,36.848,126.321,36.85,126.327,36.849,126.333,36.86,126.35,36.858,126.344,36.845,126.357,36.83,126.367,36.827,126.358,36.846,126.372,36.854,126.372,36.867,126.366,36.874,126.381,36.88,126.4,36.878,126.397,36.89,126.406,36.888,126.407,36.895,126.415,36.891,126.424,36.898,126.433,36.898,126.429,36.903,126.41,36.906,126.413,36.91,126.405,36.918,126.419,36.927,126.413,36.932,126.398,36.932,126.394,36.927,126.388,36.927,126.383,36.941,126.376,36.944,126.361,36.935,126.358,36.939,126.362,36.948,126.352,36.949,126.352,36.958,126.336,36.957,126.335,36.972,126.341,36.972,126.34,36.978,126.33,36.984,126.328,36.993,126.33,36.998,126.335,36.995,126.343,36.998,126.337,37.003,126.342,37.009,126.352,37.001,126.36,37.012,126.363,37.004,126.369,37.01,126.41,37.009,126.412,37.014,126.405,37.016,126.408,37.021,126.417,37.017,126.415,37.012,126.428,37.012,126.434,37.005,126.454,37.002,126.48,36.966,126.489,36.941,126.479,36.902,126.492,36.935,126.485,36.967,126.489,36.98,126.456,37.023,126.488,37.049,126.485,37.06,126.493,37.057,126.5,37.062,126.511,37.06,126.512,37.062,126.515,37.061,126.511,37.06,126.522,37.057,126.531,37.041,126.544,37.034,126.562,37.035,126.566,37.026,126.577,37.021,126.583,37.024,126.621,37.002,126.642,36.995,126.697,36.997,126.703,36.995,126.699,36.993,126.707,36.997,126.743,36.982,126.785,36.973,126.782,36.965,126.799,36.937,126.794,36.934,126.804,36.922,126.809,36.928,126.814,36.922,126.819,36.894,126.829,36.887,126.829,36.875,126.825,36.874,126.83,36.873,126.834,36.859,126.849,36.86,126.85,36.875,126.855,36.88,126.864,36.877,126.883,36.885,126.914,36.888,126.907,36.923,126.889,36.933,126.866,36.93,126.864,36.946,126.852,36.943,126.846,36.951,126.848,36.957,126.827,36.984,126.828,36.992,126.802,36.997,126.792,36.991,126.78,36.999,126.8,37.005,126.797,37.023,126.753,37.026,126.747,37.033,126.75,37.046,126.772,37.061,126.765,37.06,126.763,37.065,126.772,37.099,126.76,37.108,126.762,37.114,126.778,37.129,126.785,37.132,126.797,37.126,126.803,37.136,126.817,37.14,126.81,37.142,126.803,37.151,126.794,37.147,126.783,37.149,126.803,37.16,126.794,37.17,126.799,37.177,126.8,37.187,126.797,37.179,126.78,37.162,126.75,37.164,126.744,37.15,126.733,37.146,126.73,37.136,126.716,37.127,126.708,37.128,126.688,37.109,126.68,37.112,126.685,37.113,126.686,37.12,126.675,37.135,126.686,37.147,126.697,37.15,126.686,37.157,126.691,37.165,126.685,37.157,126.672,37.153,126.651,37.152,126.663,37.159,126.655,37.178,126.663,37.175,126.672,37.186,126.662,37.188,126.653,37.18,126.657,37.188,126.653,37.188,126.694,37.2,126.701,37.211,126.694,37.211,126.691,37.205,126.686,37.207,126.675,37.197,126.668,37.214,126.679,37.221,126.667,37.234,126.658,37.232,126.654,37.236,126.648,37.245,126.652,37.251,126.657,37.244,126.671,37.24,126.679,37.244,126.682,37.253,126.677,37.255,126.679,37.258,126.683,37.254,126.689,37.26,126.719,37.253,126.728,37.256,126.736,37.248,126.743,37.252,126.759,37.252,126.777,37.245,126.78,37.235,126.784,37.232,126.788,37.23,126.78,37.236,126.78,37.243,126.791,37.242,126.794,37.266,126.813,37.264,126.801,37.276,126.807,37.283,126.813,37.284,126.813,37.278,126.846,37.264,126.83,37.277,126.83,37.289,126.809,37.296,126.775,37.287,126.728,37.299,126.719,37.305,126.725,37.311,126.689,37.331,126.693,37.334,126.688,37.338,126.691,37.346,126.704,37.348,126.703,37.352,126.733,37.384,126.744,37.381,126.736,37.385,126.739,37.393,126.663,37.34,126.619,37.34,126.619,37.345,126.609,37.344,126.609,37.352,126.614,37.352,126.614,37.371,126.6,37.382,126.6,37.426,126.611,37.425,126.617,37.435,126.61,37.438,126.62,37.442,126.612,37.445,126.613,37.451,126.603,37.436,126.595,37.439,126.595,37.448,126.598,37.448,126.595,37.452,126.604,37.454,126.595,37.455,126.594,37.462,126.626,37.455,126.616,37.461,126.614,37.474,126.609,37.473,126.612,37.466,126.605,37.463,126.598,37.469,126.608,37.484,126.612,37.48,126.607,37.478,126.607,37.477,126.616,37.476,126.621,37.483,126.614,37.481,126.612,37.485,126.628,37.49,126.634,37.485,126.63,37.49,126.643,37.493,126.643,37.503,126.637,37.503,126.629,37.494,126.606,37.494,126.606,37.507,126.616,37.51,126.613,37.525,126.605,37.525,126.601,37.531,126.601,37.536,126.607,37.537,126.608,37.551,126.596,37.551,126.575,37.585,126.566,37.584,126.568,37.591,126.556,37.607,126.552,37.624,126.54,37.634,126.531,37.65,126.533,37.636,126.545,37.62,126.549,37.602,126.521,37.591,126.53,37.584,126.521,37.577,126.503,37.587,126.482,37.581,126.475,37.595,126.467,37.593,126.464,37.586,126.449,37.592,126.406,37.591,126.388,37.605,126.371,37.61,126.379,37.616,126.376,37.628,126.366,37.633,126.397,37.639,126.407,37.648,126.389,37.653,126.398,37.662,126.389,37.687,126.354,37.703,126.345,37.718,126.344,37.746,126.357,37.739,126.356,37.776,126.353,37.776,126.351,37.789,126.396,37.823,126.416,37.822,126.429,37.831,126.439,37.828,126.467,37.802],[126.782,33.564,126.799,33.553,126.804,33.557,126.811,33.555,126.812,33.556,126.814,33.557,126.814,33.559,126.816,33.56,126.818,33.558,126.83,33.557,126.835,33.538,126.844,33.536,126.845,33.535,126.843,33.532,126.844,33.531,126.854,33.531,126.861,33.523,126.874,33.528,126.905,33.523,126.91,33.518,126.902,33.508,126.916,33.505,126.918,33.498,126.914,33.489,126.92,33.484,126.907,33.484,126.905,33.476,126.911,33.476,126.915,33.47,126.916,33.469,126.916,33.473,126.918,33.47,126.922,33.472,126.923,33.466,126.93,33.473,126.927,33.467,126.93,33.466,126.938,33.474,126.94,33.462,126.95,33.454,126.943,33.451,126.933,33.455,126.924,33.44,126.927,33.432,126.939,33.427,126.938,33.423,126.931,33.419,126.924,33.423,126.925,33.431,126.919,33.43,126.921,33.424,126.905,33.4,126.909,33.388,126.883,33.379,126.875,33.362,126.87,33.36,126.872,33.352,126.859,33.335,126.846,33.33,126.85,33.317,126.837,33.305,126.817,33.304,126.811,33.298,126.78,33.303,126.769,33.295,126.768,33.287,126.741,33.273,126.735,33.278,126.701,33.267,126.681,33.267,126.679,33.264,126.673,33.267,126.663,33.264,126.666,33.267,126.661,33.271,126.663,33.265,126.646,33.264,126.642,33.254,126.622,33.247,126.62,33.237,126.601,33.233,126.58,33.241,126.573,33.24,126.569,33.237,126.573,33.234,126.568,33.232,126.563,33.24,126.561,33.234,126.553,33.238,126.55,33.234,126.523,33.237,126.511,33.226,126.49,33.227,126.478,33.218,126.463,33.227,126.456,33.237,126.434,33.228,126.413,33.241,126.372,33.225,126.363,33.233,126.336,33.231,126.337,33.235,126.33,33.237,126.297,33.217,126.293,33.202,126.298,33.194,126.292,33.191,126.287,33.197,126.274,33.191,126.264,33.195,126.264,33.206,126.258,33.204,126.251,33.21,126.229,33.235,126.204,33.242,126.188,33.253,126.171,33.271,126.17,33.278,126.163,33.282,126.168,33.315,126.163,33.321,126.162,33.335,126.169,33.343,126.181,33.344,126.181,33.355,126.202,33.363,126.217,33.376,126.214,33.378,126.224,33.388,126.232,33.391,126.236,33.387,126.238,33.392,126.243,33.393,126.242,33.398,126.252,33.399,126.252,33.406,126.259,33.408,126.256,33.409,126.255,33.413,126.258,33.41,126.265,33.413,126.262,33.419,126.26,33.414,126.254,33.414,126.264,33.423,126.264,33.434,126.275,33.434,126.279,33.441,126.302,33.444,126.315,33.467,126.337,33.464,126.388,33.487,126.402,33.48,126.412,33.487,126.421,33.486,126.427,33.493,126.453,33.494,126.457,33.501,126.465,33.5,126.469,33.507,126.485,33.508,126.487,33.515,126.495,33.518,126.515,33.513,126.53,33.516,126.542,33.528,126.553,33.517,126.564,33.525,126.568,33.521,126.577,33.526,126.586,33.524,126.599,33.535,126.605,33.532,126.63,33.538,126.635,33.534,126.646,33.553,126.653,33.551,126.651,33.547,126.66,33.549,126.668,33.54,126.675,33.542,126.677,33.549,126.69,33.547,126.692,33.55,126.717,33.552,126.732,33.56,126.742,33.558,126.741,33.553,126.751,33.558,126.761,33.556,126.768,33.564,126.782,33.564],[128.689,35.036,128.7,35.028,128.702,35.034,128.724,35.021,128.72,35.006,128.715,35.002,128.711,35.006,128.705,35.003,128.71,34.994,128.696,34.992,128.704,34.988,128.698,34.978,128.699,34.97,128.706,34.969,128.71,34.962,128.719,34.962,128.718,34.954,128.73,34.944,128.728,34.934,128.724,34.933,128.724,34.935,128.722,34.938,128.718,34.933,128.723,34.93,128.719,34.922,128.726,34.911,128.723,34.906,128.713,34.907,128.72,34.894,128.71,34.896,128.708,34.887,128.699,34.888,128.698,34.878,128.717,34.872,128.721,34.873,128.72,34.879,128.726,34.879,128.726,34.887,128.736,34.889,128.742,34.882,128.74,34.886,128.755,34.891,128.746,34.881,128.747,34.876,128.741,34.875,128.746,34.865,128.736,34.859,128.731,34.859,128.732,34.864,128.726,34.862,128.737,34.849,128.737,34.84,128.728,34.838,128.719,34.846,128.704,34.836,128.713,34.826,128.719,34.835,128.727,34.83,128.728,34.823,128.722,34.822,128.723,34.813,128.74,34.796,128.743,34.784,128.712,34.791,128.717,34.799,128.71,34.809,128.699,34.804,128.703,34.801,128.701,34.794,128.694,34.793,128.69,34.797,128.694,34.804,128.671,34.809,128.669,34.79,128.677,34.783,128.66,34.771,128.648,34.775,128.641,34.76,128.655,34.74,128.68,34.741,128.686,34.735,128.678,34.733,128.678,34.725,128.674,34.727,128.673,34.736,128.669,34.732,128.656,34.736,128.654,34.731,128.641,34.732,128.631,34.727,128.63,34.733,128.623,34.727,128.632,34.726,128.634,34.717,128.645,34.711,128.64,34.706,128.628,34.71,128.612,34.698,128.593,34.705,128.579,34.699,128.576,34.703,128.582,34.713,128.59,34.714,128.585,34.72,128.595,34.72,128.609,34.728,128.608,34.732,128.579,34.738,128.58,34.75,128.584,34.753,128.581,34.759,128.603,34.761,128.593,34.767,128.599,34.774,128.578,34.775,128.566,34.763,128.557,34.763,128.554,34.772,128.571,34.783,128.559,34.786,128.545,34.772,128.542,34.776,128.546,34.781,128.54,34.785,128.55,34.786,128.553,34.791,128.565,34.788,128.586,34.794,128.586,34.814,128.597,34.826,128.578,34.84,128.589,34.838,128.591,34.844,128.584,34.843,128.585,34.847,128.575,34.851,128.565,34.841,128.566,34.83,128.543,34.833,128.539,34.826,128.536,34.83,128.526,34.829,128.53,34.826,128.523,34.824,128.531,34.818,128.522,34.819,128.526,34.813,128.519,34.805,128.513,34.806,128.511,34.815,128.503,34.822,128.504,34.83,128.51,34.835,128.497,34.83,128.484,34.837,128.48,34.847,128.484,34.852,128.477,34.853,128.48,34.855,128.474,34.874,128.495,34.899,128.5,34.895,128.504,34.9,128.499,34.904,128.509,34.901,128.502,34.908,128.516,34.906,128.517,34.912,128.529,34.921,128.57,34.896,128.578,34.898,128.573,34.906,128.588,34.911,128.595,34.901,128.6,34.898,128.609,34.903,128.609,34.897,128.614,34.898,128.62,34.888,128.627,34.889,128.628,34.895,128.619,34.906,128.62,34.914,128.611,34.911,128.613,34.92,128.606,34.922,128.585,34.945,128.589,34.944,128.59,34.95,128.599,34.948,128.603,34.956,128.6,34.962,128.608,34.967,128.614,34.962,128.608,34.955,128.619,34.961,128.634,34.959,128.634,34.964,128.646,34.956,128.653,34.956,128.648,34.964,128.652,34.976,128.633,34.975,128.631,34.972,128.633,34.977,128.625,34.98,128.618,34.97,128.611,34.972,128.614,34.982,128.624,34.983,128.628,34.99,128.617,34.992,128.619,34.996,128.636,34.996,128.633,35.006,128.639,35.012,128.646,35.01,128.651,35.02,128.659,35.007,128.649,34.997,128.655,34.993,128.648,34.991,128.65,34.978,128.66,34.977,128.655,34.981,128.658,34.988,128.668,34.987,128.661,34.991,128.661,34.995,128.666,34.995,128.663,34.998,128.668,34.997,128.668,34.991,128.673,34.996,128.678,34.989,128.676,34.986,128.681,34.984,128.684,34.988,128.675,34.997,128.685,34.999,128.684,35.004,128.669,35.004,128.673,35.01,128.671,35.023,128.677,35.018,128.677,35.029,128.686,35.03,128.677,35.038,128.689,35.036],[126.241,34.583,126.282,34.578,126.284,34.574,126.293,34.575,126.294,34.569,126.307,34.569,126.313,34.56,126.305,34.555,126.309,34.549,126.328,34.538,126.329,34.544,126.341,34.548,126.345,34.545,126.339,34.54,126.347,34.539,126.347,34.535,126.356,34.529,126.353,34.524,126.362,34.524,126.37,34.512,126.379,34.509,126.385,34.5,126.375,34.497,126.375,34.493,126.384,34.489,126.381,34.484,126.387,34.478,126.381,34.475,126.377,34.482,126.36,34.477,126.362,34.47,126.374,34.469,126.373,34.462,126.36,34.454,126.367,34.439,126.354,34.428,126.344,34.412,126.338,34.411,126.339,34.397,126.33,34.394,126.323,34.402,126.33,34.403,126.323,34.41,126.329,34.412,126.322,34.421,126.321,34.416,126.313,34.413,126.317,34.397,126.305,34.411,126.309,34.4,126.295,34.406,126.293,34.4,126.299,34.395,126.292,34.391,126.299,34.388,126.305,34.392,126.307,34.386,126.299,34.381,126.31,34.382,126.312,34.378,126.308,34.377,126.314,34.373,126.3,34.365,126.294,34.371,126.291,34.361,126.282,34.368,126.287,34.377,126.286,34.386,126.294,34.388,126.286,34.391,126.279,34.387,126.278,34.393,126.267,34.394,126.262,34.384,126.27,34.382,126.269,34.375,126.258,34.378,126.248,34.377,126.236,34.365,126.233,34.371,126.222,34.364,126.216,34.367,126.204,34.368,126.212,34.366,126.216,34.357,126.19,34.353,126.188,34.348,126.182,34.348,126.183,34.356,126.176,34.35,126.163,34.35,126.158,34.355,126.159,34.358,126.163,34.359,126.164,34.361,126.158,34.358,126.155,34.363,126.146,34.361,126.148,34.355,126.132,34.356,126.133,34.362,126.138,34.361,126.132,34.362,126.139,34.366,126.136,34.371,126.147,34.375,126.146,34.38,126.132,34.382,126.128,34.375,126.116,34.378,126.113,34.391,126.092,34.411,126.093,34.419,126.099,34.419,126.096,34.427,126.102,34.428,126.099,34.433,126.12,34.446,126.132,34.44,126.127,34.444,126.129,34.449,126.12,34.45,126.118,34.457,126.142,34.465,126.163,34.48,126.175,34.482,126.175,34.492,126.193,34.511,126.197,34.509,126.19,34.493,126.207,34.493,126.21,34.498,126.2,34.507,126.205,34.512,126.225,34.513,126.214,34.524,126.221,34.53,126.227,34.527,126.228,34.538,126.232,34.532,126.239,34.534,126.239,34.529,126.249,34.529,126.248,34.537,126.257,34.534,126.263,34.545,126.257,34.556,126.248,34.56,126.247,34.565,126.241,34.563,126.242,34.573,126.247,34.577,126.241,34.583],[127.906,34.938,127.928,34.937,127.923,34.93,127.93,34.929,127.933,34.922,127.927,34.925,127.928,34.918,127.942,34.909,127.932,34.911,127.925,34.896,127.928,34.888,127.907,34.879,127.905,34.881,127.9,34.872,127.91,34.849,127.918,34.845,127.92,34.832,127.926,34.828,127.934,34.83,127.947,34.826,127.943,34.815,127.946,34.807,127.956,34.802,127.968,34.806,127.961,34.81,127.973,34.813,127.981,34.817,127.978,34.822,127.994,34.83,128.022,34.827,128.032,34.832,128.035,34.827,128.053,34.825,128.069,34.815,128.064,34.803,128.067,34.797,128.061,34.793,128.062,34.797,128.055,34.797,128.054,34.791,128.061,34.791,128.051,34.778,128.061,34.748,128.059,34.742,128.051,34.739,128.054,34.736,128.038,34.728,128.037,34.721,128.048,34.711,128.056,34.712,128.063,34.706,128.049,34.707,128.045,34.703,128.051,34.702,128.046,34.699,128.032,34.705,128.027,34.697,128.022,34.698,128.028,34.716,128.016,34.721,128.01,34.718,128.014,34.713,128.01,34.708,128.003,34.713,127.994,34.711,127.991,34.717,127.986,34.715,127.99,34.71,127.987,34.706,127.971,34.709,127.959,34.706,127.955,34.712,127.96,34.716,127.952,34.723,127.956,34.728,127.95,34.727,127.946,34.744,127.95,34.763,127.956,34.769,127.951,34.774,127.931,34.773,127.906,34.763,127.915,34.733,127.908,34.724,127.894,34.718,127.859,34.724,127.864,34.729,127.853,34.735,127.857,34.738,127.855,34.744,127.838,34.747,127.837,34.753,127.844,34.755,127.846,34.76,127.843,34.764,127.854,34.766,127.846,34.776,127.847,34.784,127.837,34.79,127.834,34.804,127.837,34.805,127.83,34.808,127.815,34.832,127.815,34.845,127.809,34.85,127.813,34.854,127.809,34.854,127.821,34.873,127.829,34.871,127.832,34.877,127.826,34.881,127.835,34.889,127.826,34.891,127.833,34.892,127.828,34.9,127.844,34.895,127.844,34.904,127.849,34.898,127.853,34.904,127.853,34.9,127.866,34.901,127.859,34.909,127.853,34.907,127.858,34.911,127.852,34.911,127.856,34.919,127.861,34.918,127.856,34.924,127.861,34.926,127.859,34.931,127.868,34.929,127.874,34.942,127.875,34.938,127.897,34.944,127.906,34.938],[126.362,36.61,126.387,36.603,126.398,36.593,126.398,36.568,126.388,36.556,126.399,36.516,126.429,36.459,126.426,36.454,126.432,36.45,126.435,36.429,126.432,36.429,126.438,36.418,126.43,36.409,126.43,36.396,126.421,36.395,126.421,36.402,126.413,36.403,126.414,36.409,126.402,36.409,126.398,36.415,126.393,36.409,126.384,36.415,126.374,36.407,126.363,36.413,126.359,36.42,126.353,36.421,126.348,36.433,126.366,36.438,126.334,36.434,126.334,36.452,126.33,36.456,126.335,36.456,126.335,36.463,126.326,36.466,126.332,36.473,126.336,36.494,126.327,36.517,126.33,36.524,126.328,36.544,126.312,36.566,126.312,36.582,126.322,36.585,126.325,36.596,126.337,36.603,126.344,36.606,126.35,36.602,126.35,36.608,126.362,36.61],[126.587,37.487,126.509,37.463,126.498,37.445,126.444,37.418,126.422,37.419,126.412,37.435,126.402,37.431,126.406,37.437,126.397,37.444,126.392,37.436,126.383,37.436,126.383,37.432,126.379,37.438,126.366,37.439,126.374,37.444,126.371,37.453,126.363,37.454,126.358,37.465,126.362,37.471,126.375,37.469,126.434,37.501,126.467,37.497,126.485,37.501,126.496,37.513,126.5,37.529,126.516,37.532,126.568,37.512,126.58,37.501,126.587,37.487],[126.689,34.4,126.695,34.394,126.706,34.395,126.716,34.385,126.729,34.38,126.736,34.363,126.731,34.359,126.735,34.356,126.733,34.35,126.74,34.345,126.738,34.34,126.746,34.333,126.743,34.329,126.756,34.322,126.751,34.318,126.757,34.312,126.768,34.315,126.775,34.309,126.764,34.298,126.78,34.284,126.75,34.288,126.737,34.301,126.734,34.299,126.74,34.283,126.72,34.294,126.705,34.294,126.697,34.289,126.681,34.301,126.684,34.305,126.679,34.311,126.672,34.313,126.671,34.321,126.657,34.324,126.655,34.328,126.645,34.324,126.651,34.33,126.643,34.338,126.647,34.343,126.643,34.361,126.648,34.364,126.639,34.376,126.65,34.39,126.645,34.391,126.642,34.386,126.638,34.385,126.641,34.391,126.63,34.392,126.626,34.397,126.646,34.396,126.647,34.392,126.657,34.39,126.667,34.396,126.674,34.394,126.671,34.4,126.679,34.396,126.689,34.4],[126.099,34.768,126.126,34.773,126.133,34.759,126.14,34.755,126.165,34.755,126.177,34.751,126.182,34.739,126.196,34.729,126.198,34.716,126.178,34.697,126.175,34.697,126.161,34.695,126.147,34.683,126.128,34.68,126.119,34.681,126.111,34.693,126.101,34.694,126.096,34.704,126.08,34.702,126.074,34.709,126.069,34.704,126.066,34.709,126.073,34.729,126.072,34.737,126.083,34.747,126.065,34.766,126.07,34.769,126.089,34.763,126.078,34.77,126.081,34.776,126.099,34.768],[130.91,37.546,130.913,37.539,130.922,37.538,130.914,37.535,130.911,37.526,130.921,37.511,130.916,37.484,130.924,37.482,130.887,37.468,130.877,37.45,130.869,37.457,130.843,37.459,130.83,37.468,130.815,37.47,130.803,37.481,130.806,37.501,130.794,37.51,130.793,37.521,130.805,37.516,130.826,37.527,130.83,37.524,130.845,37.532,130.869,37.534,130.876,37.54,130.894,37.538,130.9,37.544,130.91,37.546],[127.752,34.73,127.789,34.713,127.793,34.699,127.782,34.693,127.785,34.686,127.779,34.678,127.787,34.667,127.795,34.669,127.803,34.664,127.796,34.662,127.797,34.658,127.809,34.658,127.8,34.652,127.801,34.642,127.797,34.641,127.803,34.627,127.795,34.627,127.796,34.62,127.791,34.613,127.794,34.608,127.79,34.604,127.805,34.598,127.804,34.593,127.81,34.594,127.803,34.583,127.752,34.59,127.739,34.602,127.74,34.607,127.721,34.61,127.712,34.619,127.726,34.63,127.719,34.641,127.724,34.651,127.744,34.661,127.75,34.666,127.749,34.672,127.765,34.684,127.756,34.695,127.759,34.711,127.749,34.711,127.739,34.727,127.752,34.73],[127.218,34.493,127.241,34.471,127.232,34.468,127.232,34.46,127.224,34.452,127.22,34.434,127.211,34.426,127.168,34.432,127.165,34.425,127.147,34.426,127.143,34.418,127.139,34.425,127.118,34.436,127.117,34.445,127.111,34.445,127.11,34.439,127.101,34.44,127.101,34.447,127.108,34.452,127.095,34.468,127.098,34.471,127.105,34.467,127.116,34.474,127.119,34.48,127.112,34.482,127.117,34.487,127.127,34.487,127.13,34.476,127.139,34.477,127.142,34.47,127.15,34.478,127.165,34.476,127.179,34.489,127.192,34.492,127.2,34.485,127.218,34.493],[126.08,34.929,126.078,34.92,126.085,34.923,126.083,34.917,126.094,34.92,126.086,34.909,126.1,34.908,126.098,34.901,126.106,34.896,126.098,34.872,126.087,34.861,126.052,34.85,126.046,34.84,126.034,34.855,126.028,34.856,126.026,34.852,126.019,34.857,126.024,34.862,126.011,34.855,125.999,34.862,125.995,34.858,125.99,34.862,125.985,34.858,125.976,34.861,125.982,34.864,125.979,34.869,125.97,34.867,125.968,34.87,125.97,34.874,125.991,34.874,125.997,34.88,125.994,34.886,126.001,34.886,126.016,34.91,126.033,34.906,126.039,34.917,126.048,34.909,126.055,34.91,126.06,34.917,126.052,34.92,126.06,34.921,126.057,34.936,126.08,34.929],[128.031,34.903,128.018,34.89,128.013,34.865,128.022,34.861,128.026,34.863,128.022,34.87,128.024,34.879,128.036,34.894,128.041,34.895,128.041,34.89,128.05,34.894,128.044,34.89,128.052,34.885,128.05,34.879,128.061,34.881,128.06,34.876,128.069,34.871,128.067,34.859,128.056,34.85,128.065,34.853,128.064,34.841,128.081,34.841,128.079,34.836,128.087,34.834,128.089,34.825,128.08,34.825,128.073,34.833,128.066,34.827,128.056,34.835,128.049,34.832,128.027,34.843,128.026,34.836,128.022,34.84,128.021,34.834,128.002,34.831,127.971,34.84,127.973,34.845,127.967,34.849,127.964,34.867,127.98,34.877,127.98,34.883,127.992,34.892,127.99,34.9,128.016,34.918,128.034,34.919,128.031,34.903],[124.692,37.977,124.707,37.982,124.723,37.979,124.732,37.975,124.737,37.961,124.748,37.956,124.743,37.954,124.735,37.959,124.732,37.956,124.739,37.953,124.737,37.949,124.727,37.951,124.71,37.941,124.7,37.922,124.702,37.917,124.692,37.912,124.682,37.919,124.639,37.92,124.624,37.944,124.627,37.951,124.613,37.958,124.611,37.966,124.618,37.976,124.642,37.966,124.672,37.979,124.68,37.977,124.686,37.982,124.692,37.977],[126.147,35.134,126.123,35.096,126.125,35.073,126.118,35.063,126.118,35.055,126.108,35.054,126.111,35.046,126.099,35.044,126.078,35.05,126.076,35.064,126.066,35.062,126.065,35.052,126.059,35.053,126.058,35.06,126.039,35.062,126.039,35.068,126.048,35.07,126.043,35.075,126.043,35.082,126.055,35.094,126.05,35.099,126.073,35.102,126.087,35.109,126.102,35.129,126.111,35.13,126.115,35.141,126.167,35.143,126.147,35.134],[126.003,34.791,125.998,34.777,126.003,34.77,126.001,34.757,125.994,34.752,125.989,34.758,125.979,34.749,125.965,34.749,125.965,34.744,125.957,34.749,125.944,34.75,125.941,34.747,125.953,34.729,125.945,34.731,125.945,34.724,125.942,34.724,125.945,34.72,125.94,34.716,125.91,34.713,125.903,34.716,125.905,34.722,125.896,34.723,125.895,34.729,125.888,34.727,125.896,34.745,125.892,34.753,125.896,34.757,125.891,34.762,125.901,34.778,125.912,34.777,125.913,34.773,125.918,34.773,125.917,34.777,125.927,34.772,125.938,34.773,125.955,34.781,125.954,34.786,125.965,34.783,125.976,34.8,125.994,34.804,126.003,34.791],[126.323,37.717,126.348,37.696,126.374,37.692,126.382,37.679,126.379,37.665,126.345,37.641,126.327,37.639,126.329,37.664,126.319,37.679,126.287,37.693,126.27,37.708,126.286,37.712,126.289,37.74,126.326,37.752,126.333,37.746,126.323,37.717],[126.298,34.919,126.308,34.917,126.306,34.911,126.311,34.912,126.314,34.904,126.323,34.905,126.321,34.91,126.338,34.906,126.346,34.896,126.354,34.895,126.352,34.884,126.347,34.891,126.339,34.89,126.337,34.884,126.328,34.889,126.332,34.876,126.322,34.881,126.315,34.876,126.328,34.87,126.318,34.864,126.323,34.859,126.356,34.862,126.365,34.853,126.37,34.854,126.374,34.84,126.368,34.833,126.373,34.836,126.375,34.83,126.368,34.828,126.37,34.821,126.363,34.82,126.36,34.812,126.33,34.818,126.329,34.822,126.338,34.824,126.339,34.831,126.348,34.832,126.346,34.839,126.338,34.837,126.336,34.845,126.331,34.848,126.318,34.843,126.315,34.85,126.296,34.847,126.294,34.852,126.279,34.853,126.265,34.837,126.243,34.845,126.229,34.844,126.235,34.862,126.262,34.854,126.271,34.87,126.276,34.861,126.281,34.86,126.283,34.884,126.295,34.878,126.306,34.884,126.301,34.895,126.283,34.907,126.298,34.919],[126.266,37.816,126.296,37.799,126.319,37.801,126.327,37.806,126.337,37.795,126.319,37.772,126.293,37.76,126.274,37.767,126.246,37.762,126.237,37.75,126.229,37.75,126.205,37.767,126.223,37.783,126.224,37.803,126.24,37.814,126.259,37.812,126.266,37.816],[125.963,34.734,125.98,34.713,125.983,34.719,125.994,34.717,125.993,34.708,126.0,34.703,125.999,34.716,126.007,34.717,125.994,34.723,125.993,34.728,126.001,34.728,126.012,34.718,126.017,34.707,126.011,34.701,126.017,34.698,126.013,34.695,126.01,34.681,125.99,34.675,125.99,34.67,125.982,34.669,125.981,34.659,125.968,34.653,125.956,34.655,125.956,34.669,125.942,34.66,125.933,34.666,125.938,34.67,125.934,34.674,125.93,34.674,125.927,34.665,125.922,34.668,125.924,34.676,125.92,34.673,125.917,34.678,125.924,34.683,125.916,34.684,125.918,34.708,125.948,34.711,125.949,34.72,125.963,34.734],[126.588,37.29,126.574,37.28,126.571,37.269,126.575,37.273,126.585,37.271,126.593,37.261,126.618,37.256,126.617,37.248,126.628,37.241,126.625,37.234,126.653,37.222,126.65,37.206,126.654,37.211,126.657,37.208,126.648,37.203,126.653,37.197,126.649,37.188,126.643,37.195,126.649,37.208,126.631,37.215,126.624,37.233,126.621,37.226,126.613,37.231,126.612,37.227,126.602,37.224,126.614,37.216,126.616,37.204,126.6,37.208,126.605,37.213,126.604,37.218,126.604,37.214,126.593,37.21,126.589,37.218,126.579,37.219,126.572,37.197,126.565,37.19,126.551,37.202,126.545,37.203,126.54,37.196,126.537,37.195,126.543,37.204,126.547,37.204,126.543,37.212,126.549,37.213,126.548,37.22,126.543,37.221,126.544,37.231,126.571,37.234,126.559,37.245,126.565,37.253,126.557,37.268,126.535,37.286,126.558,37.281,126.562,37.275,126.579,37.288,126.573,37.295,126.581,37.293,126.614,37.312,126.647,37.322,126.649,37.319,126.617,37.31,126.581,37.29,126.588,37.29],[126.837,34.441,126.837,34.428,126.842,34.431,126.848,34.427,126.846,34.417,126.826,34.416,126.843,34.408,126.852,34.417,126.856,34.41,126.85,34.405,126.86,34.405,126.861,34.393,126.868,34.394,126.87,34.387,126.849,34.387,126.835,34.38,126.833,34.374,126.825,34.384,126.821,34.379,126.805,34.382,126.795,34.379,126.783,34.366,126.784,34.359,126.779,34.354,126.782,34.349,126.775,34.351,126.774,34.354,126.768,34.356,126.781,34.379,126.76,34.38,126.751,34.376,126.76,34.391,126.77,34.396,126.766,34.406,126.79,34.43,126.818,34.431,126.822,34.436,126.837,34.441],[126.135,35.024,126.167,35.02,126.184,34.994,126.179,34.991,126.185,34.991,126.19,34.982,126.177,34.943,126.172,34.945,126.174,34.941,126.16,34.935,126.147,34.938,126.143,34.944,126.128,34.939,126.126,34.943,126.137,34.964,126.136,34.997,126.124,34.997,126.116,34.989,126.115,34.994,126.107,34.991,126.105,34.997,126.099,34.997,126.102,35.005,126.11,35.002,126.116,35.007,126.117,35.015,126.129,35.024,126.134,35.021,126.135,35.024]];

  /* 미리보기 모드용 시도 경계 (KOSTAT 2013 단순화, lng/lat) */
  var KOREA_GEO = [[[126.957,33.522,126.973,33.499,126.969,33.486,126.95,33.49,126.943,33.501,126.957,33.522],[126.783,33.564,126.802,33.554,126.83,33.557,126.833,33.543,126.86,33.524,126.904,33.523,126.918,33.498,126.907,33.484,126.915,33.47,126.938,33.471,126.942,33.459,126.929,33.449,126.909,33.388,126.875,33.368,126.838,33.305,126.811,33.298,126.781,33.303,126.747,33.275,126.661,33.268,126.621,33.238,126.6,33.233,126.588,33.241,126.523,33.237,126.472,33.219,126.452,33.237,126.433,33.229,126.415,33.241,126.387,33.228,126.322,33.235,126.274,33.191,126.234,33.231,126.184,33.256,126.161,33.289,126.169,33.343,126.262,33.414,126.262,33.431,126.307,33.448,126.31,33.463,126.337,33.464,126.388,33.487,126.397,33.481,126.495,33.518,126.517,33.513,126.542,33.528,126.551,33.518,126.599,33.535,126.635,33.535,126.646,33.553,126.783,33.564]],[[128.239,34.648,128.268,34.643,128.279,34.616,128.245,34.62,128.226,34.633,128.239,34.648],[128.178,34.708,128.2,34.704,128.204,34.688,128.185,34.688,128.178,34.708],[128.486,34.813,128.496,34.779,128.511,34.764,128.493,34.754,128.474,34.758,128.475,34.772,128.462,34.785,128.486,34.813],[128.239,34.837,128.266,34.815,128.249,34.797,128.216,34.804,128.202,34.82,128.219,34.835,128.239,34.837],[128.198,34.857,128.213,34.849,128.198,34.826,128.184,34.824,128.169,34.839,128.173,34.851,128.198,34.857],[128.036,34.916,128.039,34.895,128.069,34.867,128.066,34.827,128.027,34.843,128.025,34.836,127.989,34.833,127.971,34.84,127.964,34.867,127.998,34.907,128.009,34.916,128.036,34.916],[127.898,34.943,127.92,34.937,127.932,34.911,127.901,34.869,127.926,34.828,127.945,34.823,127.957,34.802,127.992,34.83,128.063,34.819,128.064,34.796,128.053,34.792,128.059,34.742,128.028,34.716,128.016,34.721,127.958,34.706,127.948,34.73,127.951,34.774,127.906,34.763,127.915,34.733,127.889,34.719,127.869,34.723,127.858,34.74,127.838,34.747,127.854,34.766,127.809,34.854,127.829,34.871,127.833,34.894,127.853,34.9,127.857,34.923,127.873,34.939,127.898,34.943],[128.682,35.037,128.697,35.027,128.715,35.029,128.724,35.015,128.705,35.003,128.698,34.976,128.73,34.944,128.721,34.933,128.726,34.912,128.719,34.897,128.698,34.886,128.717,34.872,128.737,34.888,128.746,34.865,128.704,34.837,128.743,34.789,128.712,34.791,128.711,34.809,128.676,34.81,128.669,34.79,128.677,34.783,128.641,34.76,128.655,34.74,128.686,34.735,128.626,34.729,128.635,34.716,128.612,34.698,128.582,34.713,128.608,34.732,128.579,34.738,128.54,34.785,128.587,34.799,128.58,34.851,128.519,34.805,128.504,34.83,128.484,34.837,128.474,34.874,128.529,34.921,128.55,34.905,128.585,34.911,128.614,34.898,128.588,34.943,128.622,34.959,128.649,34.96,128.652,34.976,128.624,34.983,128.633,35.006,128.649,35.015,128.655,34.985,128.682,35.037],[128.373,35.608,128.384,35.604,128.434,35.62,128.449,35.635,128.507,35.636,128.511,35.672,128.529,35.679,128.539,35.621,128.561,35.612,128.587,35.583,128.609,35.577,128.66,35.595,128.694,35.591,128.706,35.575,128.789,35.563,128.803,35.585,128.856,35.594,128.875,35.618,128.914,35.635,128.94,35.632,128.984,35.605,129.006,35.617,129.023,35.612,129.022,35.581,128.973,35.558,128.997,35.526,129.109,35.492,129.112,35.477,129.142,35.446,129.18,35.429,129.199,35.436,129.222,35.406,129.196,35.358,129.177,35.348,129.151,35.361,129.13,35.342,129.114,35.306,129.076,35.287,129.062,35.292,129.052,35.277,129.015,35.27,129.0,35.231,128.886,35.211,128.873,35.199,128.884,35.179,128.868,35.164,128.846,35.155,128.796,35.155,128.804,35.139,128.834,35.126,128.844,35.104,128.804,35.086,128.781,35.099,128.735,35.089,128.705,35.102,128.691,35.147,128.665,35.127,128.637,35.146,128.616,35.142,128.596,35.169,128.588,35.207,128.567,35.181,128.603,35.13,128.605,35.101,128.639,35.065,128.58,35.048,128.536,35.109,128.521,35.094,128.491,35.104,128.47,35.094,128.464,35.068,128.443,35.069,128.43,35.052,128.414,35.059,128.383,35.046,128.391,35.032,128.447,35.048,128.45,35.067,128.485,35.061,128.474,35.038,128.505,35.011,128.481,34.989,128.441,34.991,128.442,34.959,128.434,34.954,128.436,34.929,128.423,34.892,128.434,34.874,128.453,34.912,128.471,34.884,128.458,34.874,128.454,34.843,128.425,34.83,128.444,34.824,128.438,34.776,128.428,34.762,128.409,34.759,128.392,34.787,128.379,34.792,128.381,34.812,128.341,34.825,128.361,34.837,128.378,34.823,128.38,34.849,128.396,34.861,128.377,34.878,128.366,34.867,128.301,34.899,128.358,34.906,128.336,34.941,128.302,34.933,128.303,34.909,128.285,34.901,128.268,34.91,128.272,34.931,128.243,34.941,128.198,34.934,128.205,34.891,128.124,34.901,128.057,34.925,128.032,34.953,128.054,34.975,128.041,34.998,128.052,35.013,128.028,35.03,128.01,35.021,128.018,34.989,127.991,34.986,127.985,34.975,127.963,34.985,127.95,34.974,127.934,34.99,127.93,35.01,127.906,34.955,127.877,34.944,127.787,34.937,127.767,34.97,127.789,35.014,127.774,35.026,127.771,35.047,127.742,35.059,127.74,35.075,127.721,35.079,127.697,35.1,127.697,35.127,127.624,35.185,127.612,35.259,127.598,35.265,127.58,35.306,127.623,35.329,127.612,35.363,127.642,35.402,127.664,35.414,127.669,35.445,127.647,35.447,127.638,35.459,127.639,35.475,127.655,35.483,127.626,35.531,127.593,35.551,127.59,35.562,127.613,35.582,127.615,35.604,127.63,35.615,127.622,35.639,127.647,35.695,127.663,35.707,127.664,35.756,127.722,35.794,127.748,35.84,127.774,35.836,127.833,35.867,127.843,35.864,127.854,35.887,127.89,35.912,127.887,35.89,127.918,35.889,127.933,35.875,127.935,35.853,127.988,35.854,128.014,35.826,128.034,35.833,128.053,35.826,128.073,35.838,128.126,35.819,128.131,35.786,128.155,35.783,128.166,35.76,128.189,35.751,128.204,35.72,128.204,35.681,128.166,35.67,128.166,35.65,128.187,35.655,128.203,35.641,128.238,35.638,128.246,35.653,128.263,35.64,128.308,35.652,128.357,35.639,128.373,35.608]],[[129.452,35.648,129.356,35.677,129.305,35.645,129.263,35.651,129.257,35.663,129.265,35.688,129.256,35.698,129.21,35.718,129.163,35.712,129.148,35.722,129.138,35.709,129.091,35.699,129.072,35.678,129.076,35.637,129.05,35.647,128.984,35.605,128.94,35.632,128.914,35.635,128.875,35.618,128.856,35.594,128.803,35.585,128.789,35.563,128.706,35.575,128.694,35.591,128.66,35.595,128.609,35.577,128.587,35.583,128.561,35.612,128.539,35.621,128.529,35.679,128.546,35.716,128.582,35.736,128.619,35.734,128.612,35.722,128.625,35.7,128.686,35.719,128.698,35.755,128.685,35.787,128.719,35.803,128.711,35.824,128.754,35.854,128.765,35.881,128.759,35.912,128.741,35.925,128.748,35.968,128.728,36.002,128.693,36.012,128.62,36.003,128.592,35.976,128.558,35.968,128.529,35.973,128.537,35.937,128.526,35.915,128.495,35.893,128.478,35.892,128.47,35.904,128.478,35.933,128.443,35.932,128.42,35.918,128.388,35.862,128.392,35.847,128.425,35.848,128.48,35.824,128.471,35.805,128.422,35.806,128.389,35.76,128.395,35.743,128.435,35.722,128.435,35.7,128.42,35.69,128.353,35.7,128.358,35.678,128.405,35.639,128.388,35.609,128.373,35.608,128.357,35.639,128.308,35.652,128.263,35.64,128.246,35.653,128.238,35.638,128.203,35.641,128.187,35.655,128.166,35.65,128.166,35.67,128.204,35.681,128.204,35.72,128.189,35.751,128.166,35.76,128.155,35.783,128.131,35.786,128.126,35.819,128.073,35.838,128.053,35.826,128.034,35.833,128.014,35.826,127.988,35.854,127.935,35.853,127.933,35.875,127.918,35.889,127.887,35.89,127.884,35.925,127.911,35.938,127.897,35.982,127.878,35.994,127.879,36.019,127.919,36.051,127.938,36.048,127.964,36.065,127.96,36.092,127.969,36.115,127.989,36.126,127.998,36.15,127.978,36.185,128.016,36.206,128.041,36.191,128.055,36.198,128.032,36.237,128.049,36.254,128.012,36.269,127.97,36.248,127.951,36.254,127.933,36.275,127.894,36.289,127.882,36.272,127.853,36.273,127.843,36.307,127.854,36.327,127.893,36.354,127.875,36.403,127.885,36.419,127.875,36.434,127.883,36.478,127.909,36.505,127.903,36.522,127.876,36.535,127.876,36.552,127.864,36.565,127.826,36.568,127.8,36.588,127.826,36.61,127.852,36.61,127.85,36.63,127.865,36.632,127.876,36.652,127.892,36.627,127.934,36.615,127.941,36.648,127.934,36.662,127.89,36.688,127.934,36.69,127.934,36.703,127.963,36.734,127.989,36.715,128.024,36.723,128.05,36.705,128.074,36.704,128.071,36.719,128.035,36.745,128.061,36.813,128.086,36.801,128.109,36.803,128.114,36.816,128.142,36.831,128.167,36.817,128.221,36.812,128.216,36.846,128.236,36.845,128.244,36.87,128.285,36.854,128.323,36.812,128.369,36.798,128.384,36.811,128.423,36.809,128.451,36.846,128.45,36.862,128.427,36.874,128.443,36.899,128.444,36.925,128.516,36.974,128.517,36.984,128.547,36.99,128.574,37.013,128.567,37.029,128.586,37.041,128.633,37.036,128.654,37.063,128.702,37.038,128.737,37.037,128.754,37.026,128.764,37.032,128.754,37.055,128.787,37.085,128.829,37.075,128.849,37.049,128.898,37.042,128.925,37.089,128.947,37.092,128.963,37.075,128.985,37.081,129.067,37.065,129.079,37.09,129.098,37.098,129.143,37.079,129.197,37.038,129.235,37.042,129.228,37.071,129.268,37.099,129.274,37.114,129.297,37.112,129.306,37.126,129.366,37.144,129.384,37.117,129.382,37.097,129.43,37.061,129.417,37.05,129.413,37.021,129.421,37.003,129.411,36.977,129.422,36.948,129.418,36.886,129.432,36.845,129.46,36.812,129.481,36.765,129.47,36.755,129.48,36.73,129.479,36.696,129.44,36.667,129.415,36.62,129.413,36.592,129.443,36.549,129.449,36.5,129.437,36.48,129.439,36.426,129.382,36.33,129.377,36.286,129.384,36.272,129.375,36.252,129.387,36.237,129.387,36.209,129.375,36.204,129.402,36.162,129.4,36.132,129.443,36.097,129.379,36.047,129.386,36.027,129.432,35.994,129.454,35.989,129.505,36.023,129.549,36.082,129.572,36.074,129.586,36.017,129.559,35.988,129.557,35.965,129.536,35.933,129.521,35.924,129.53,35.902,129.522,35.87,129.53,35.861,129.512,35.821,129.517,35.813,129.494,35.784,129.499,35.768,129.475,35.7,129.478,35.683,129.452,35.648],[130.908,37.546,130.921,37.511,130.916,37.479,130.866,37.457,130.803,37.481,130.806,37.5,130.794,37.51,130.908,37.546]],[[126.933,33.984,126.937,33.966,126.919,33.965,126.912,33.979,126.933,33.984],[127.295,34.06,127.303,34.009,127.283,34.031,127.295,34.06],[125.097,34.094,125.113,34.092,125.148,34.049,125.118,34.048,125.114,34.06,125.096,34.066,125.097,34.094],[126.551,34.176,126.586,34.167,126.579,34.141,126.527,34.118,126.507,34.134,126.517,34.167,126.551,34.176],[126.663,34.192,126.684,34.182,126.671,34.16,126.683,34.136,126.665,34.108,126.636,34.125,126.629,34.142,126.65,34.165,126.636,34.176,126.652,34.197,126.663,34.192],[126.766,34.209,126.772,34.187,126.752,34.185,126.766,34.209],[126.894,34.213,126.927,34.171,126.918,34.151,126.886,34.148,126.849,34.171,126.874,34.207,126.894,34.213],[126.57,34.231,126.617,34.213,126.627,34.2,126.612,34.193,126.619,34.177,126.589,34.169,126.55,34.186,126.57,34.231],[127.259,34.248,127.265,34.224,127.259,34.208,127.229,34.214,127.235,34.233,127.259,34.248],[126.62,34.247,126.629,34.236,126.595,34.231,126.606,34.246,126.62,34.247],[126.042,34.316,126.057,34.301,126.082,34.305,126.097,34.274,126.076,34.279,126.056,34.271,126.05,34.28,126.03,34.28,126.023,34.3,126.042,34.316],[126.988,34.337,127.017,34.329,127.005,34.311,126.974,34.298,126.959,34.31,126.959,34.326,126.988,34.337],[126.032,34.337,126.056,34.329,126.04,34.319,126.032,34.337],[126.842,34.35,126.85,34.342,126.871,34.347,126.9,34.329,126.886,34.307,126.869,34.312,126.847,34.295,126.834,34.32,126.811,34.323,126.801,34.315,126.782,34.324,126.79,34.344,126.805,34.33,126.842,34.35],[127.037,34.373,127.056,34.358,127.093,34.355,127.099,34.332,127.052,34.326,127.009,34.355,127.013,34.373,127.037,34.373],[126.687,34.399,126.734,34.373,126.731,34.359,126.751,34.318,126.773,34.31,126.762,34.289,126.696,34.289,126.651,34.33,126.641,34.379,126.65,34.39,126.687,34.399],[126.947,34.409,126.953,34.399,126.92,34.353,126.866,34.37,126.887,34.401,126.933,34.387,126.947,34.409],[127.248,34.411,127.274,34.377,127.252,34.383,127.248,34.411],[126.837,34.439,126.868,34.387,126.793,34.377,126.775,34.351,126.767,34.357,126.777,34.378,126.757,34.383,126.766,34.403,126.79,34.43,126.837,34.439],[127.05,34.454,127.068,34.448,127.077,34.426,127.069,34.401,127.038,34.421,127.034,34.446,127.05,34.454],[127.808,34.458,127.81,34.413,127.788,34.415,127.808,34.458],[127.466,34.469,127.504,34.459,127.509,34.465,127.539,34.445,127.537,34.426,127.495,34.409,127.493,34.43,127.467,34.437,127.457,34.452,127.466,34.469],[127.225,34.49,127.237,34.472,127.215,34.429,127.127,34.428,127.1,34.463,127.127,34.486,127.139,34.47,127.19,34.491,127.225,34.49],[126.061,34.494,126.074,34.478,126.043,34.454,126.041,34.478,126.061,34.494],[127.139,34.515,127.133,34.503,127.1,34.506,127.116,34.519,127.139,34.515],[127.461,34.543,127.481,34.533,127.464,34.507,127.493,34.505,127.504,34.492,127.454,34.476,127.446,34.494,127.461,34.5,127.436,34.516,127.461,34.543],[127.743,34.55,127.759,34.549,127.799,34.49,127.774,34.484,127.728,34.513,127.716,34.536,127.743,34.55],[127.661,34.582,127.682,34.566,127.662,34.55,127.642,34.572,127.661,34.582],[126.253,34.586,126.306,34.568,126.309,34.549,126.34,34.543,126.384,34.502,126.374,34.463,126.36,34.453,126.368,34.44,126.317,34.402,126.295,34.406,126.287,34.391,126.267,34.394,126.265,34.376,126.175,34.35,126.137,34.357,126.136,34.371,126.116,34.378,126.091,34.415,126.104,34.438,126.147,34.473,126.175,34.482,126.18,34.499,126.2,34.505,126.227,34.532,126.257,34.534,126.263,34.545,126.243,34.566,126.253,34.586],[127.548,34.616,127.567,34.61,127.551,34.593,127.532,34.6,127.548,34.616],[125.858,34.627,125.863,34.601,125.829,34.597,125.823,34.612,125.858,34.627],[126.07,34.632,126.113,34.586,126.098,34.571,126.104,34.552,126.088,34.551,126.082,34.538,126.05,34.526,126.048,34.562,126.067,34.558,126.082,34.575,126.065,34.606,126.05,34.605,126.051,34.626,126.07,34.632],[126.051,34.656,126.053,34.638,126.039,34.612,126.059,34.6,126.067,34.581,126.057,34.564,126.021,34.561,126.012,34.628,126.03,34.633,126.03,34.644,126.051,34.656],[126.149,34.671,126.186,34.659,126.193,34.629,126.164,34.613,126.13,34.617,126.11,34.643,126.119,34.661,126.149,34.671],[126.086,34.681,126.081,34.64,126.066,34.652,126.067,34.682,126.086,34.681],[125.397,34.694,125.373,34.663,125.362,34.672,125.397,34.694],[126.198,34.703,126.199,34.68,126.183,34.67,126.163,34.677,126.162,34.69,126.198,34.703],[125.444,34.697,125.467,34.69,125.45,34.677,125.447,34.66,125.429,34.656,125.432,34.641,125.417,34.635,125.416,34.619,125.395,34.625,125.387,34.64,125.4,34.674,125.415,34.695,125.444,34.697],[125.214,34.708,125.205,34.677,125.178,34.669,125.214,34.708],[127.751,34.731,127.788,34.714,127.793,34.699,127.779,34.678,127.797,34.658,127.803,34.627,127.794,34.608,127.808,34.587,127.752,34.589,127.712,34.62,127.727,34.634,127.726,34.653,127.75,34.667,127.76,34.686,127.751,34.731],[125.971,34.727,126.017,34.707,126.01,34.681,125.99,34.675,125.968,34.653,125.918,34.674,125.917,34.707,125.944,34.711,125.963,34.734,125.971,34.727],[126.083,34.776,126.099,34.768,126.126,34.773,126.14,34.755,126.165,34.755,126.196,34.729,126.198,34.716,126.147,34.683,126.122,34.68,126.07,34.714,126.082,34.75,126.07,34.769,126.083,34.776],[126.328,34.784,126.322,34.756,126.308,34.762,126.309,34.777,126.328,34.784],[125.999,34.802,126.001,34.757,125.944,34.75,125.953,34.731,125.944,34.718,125.921,34.711,125.896,34.723,125.891,34.762,125.911,34.773,125.938,34.773,125.976,34.8,125.999,34.802],[126.331,34.813,126.339,34.796,126.315,34.791,126.319,34.81,126.331,34.813],[126.172,34.8,126.177,34.759,126.138,34.759,126.125,34.776,126.102,34.775,126.102,34.789,126.135,34.797,126.158,34.82,126.172,34.8],[127.636,34.846,127.616,34.855,127.636,34.868,127.649,34.854,127.636,34.846],[126.117,34.88,126.14,34.872,126.153,34.842,126.116,34.823,126.122,34.8,126.103,34.794,126.06,34.846,126.084,34.856,126.105,34.848,126.117,34.88],[127.72,34.896,127.748,34.888,127.749,34.87,127.72,34.865,127.694,34.882,127.72,34.896],[126.298,34.919,126.313,34.906,126.338,34.906,126.345,34.891,126.327,34.887,126.327,34.858,126.359,34.861,126.374,34.844,126.36,34.812,126.334,34.816,126.336,34.845,126.279,34.853,126.257,34.837,126.23,34.847,126.284,34.864,126.304,34.89,126.283,34.907,126.298,34.919],[126.232,34.935,126.257,34.928,126.236,34.906,126.221,34.921,126.232,34.935],[126.065,34.933,126.094,34.92,126.106,34.898,126.098,34.872,126.052,34.85,125.999,34.862,125.991,34.874,126.016,34.91,126.033,34.906,126.06,34.917,126.065,34.933],[127.739,34.944,127.741,34.929,127.767,34.929,127.787,34.912,127.787,34.883,127.763,34.89,127.761,34.903,127.706,34.909,127.727,34.945,127.739,34.944],[127.762,34.957,127.771,34.931,127.747,34.931,127.743,34.948,127.762,34.957],[126.217,34.983,126.233,34.977,126.197,34.912,126.19,34.943,126.203,34.975,126.217,34.983],[126.251,35.004,126.264,35.003,126.273,34.973,126.251,34.977,126.251,35.004],[126.136,35.024,126.174,35.012,126.19,34.983,126.177,34.943,126.16,34.935,126.125,34.948,126.137,34.964,126.135,34.998,126.118,34.992,126.1,34.998,126.136,35.024],[126.149,35.055,126.203,35.035,126.198,35.022,126.151,35.031,126.135,35.048,126.149,35.055],[126.164,35.141,126.13,35.113,126.121,35.058,126.093,35.049,126.05,35.058,126.043,35.082,126.05,35.099,126.087,35.109,126.12,35.14,126.164,35.141],[126.023,35.361,126.042,35.34,126.018,35.339,126.023,35.361],[127.58,35.306,127.598,35.265,127.612,35.259,127.624,35.185,127.697,35.127,127.697,35.1,127.721,35.079,127.74,35.075,127.742,35.059,127.771,35.047,127.774,35.026,127.789,35.014,127.763,34.963,127.73,34.95,127.693,34.912,127.642,34.883,127.62,34.913,127.593,34.916,127.616,34.889,127.592,34.872,127.613,34.846,127.645,34.827,127.664,34.841,127.672,34.834,127.701,34.856,127.777,34.857,127.772,34.809,127.747,34.773,127.757,34.76,127.752,34.733,127.706,34.717,127.66,34.752,127.642,34.712,127.626,34.698,127.642,34.643,127.623,34.636,127.592,34.649,127.572,34.64,127.554,34.659,127.553,34.686,127.592,34.755,127.582,34.759,127.559,34.804,127.526,34.807,127.54,34.829,127.517,34.875,127.475,34.842,127.403,34.822,127.422,34.808,127.397,34.793,127.389,34.776,127.403,34.764,127.375,34.738,127.393,34.708,127.454,34.692,127.452,34.668,127.48,34.669,127.476,34.652,127.489,34.649,127.508,34.589,127.489,34.575,127.459,34.58,127.447,34.573,127.414,34.587,127.396,34.578,127.41,34.558,127.436,34.549,127.403,34.501,127.381,34.499,127.379,34.483,127.332,34.47,127.341,34.442,127.324,34.438,127.289,34.474,127.27,34.479,127.285,34.494,127.259,34.516,127.212,34.517,127.196,34.529,127.171,34.519,127.138,34.52,127.114,34.544,127.115,34.556,127.146,34.581,127.174,34.592,127.175,34.624,127.202,34.645,127.21,34.626,127.23,34.64,127.235,34.677,127.253,34.707,127.281,34.716,127.288,34.695,127.282,34.67,127.317,34.662,127.336,34.705,127.326,34.749,127.306,34.746,127.295,34.728,127.273,34.738,127.264,34.729,127.241,34.764,127.183,34.689,127.13,34.699,127.109,34.674,127.071,34.66,127.056,34.639,126.997,34.611,127.011,34.602,126.995,34.591,126.985,34.567,126.99,34.537,126.974,34.54,126.961,34.528,126.975,34.513,126.964,34.499,126.979,34.484,126.939,34.445,126.879,34.454,126.889,34.425,126.792,34.463,126.795,34.567,126.774,34.6,126.76,34.491,126.743,34.485,126.75,34.469,126.73,34.442,126.7,34.437,126.62,34.399,126.623,34.355,126.605,34.344,126.606,34.321,126.56,34.318,126.547,34.3,126.519,34.295,126.514,34.316,126.529,34.331,126.522,34.358,126.483,34.355,126.483,34.378,126.497,34.386,126.492,34.4,126.519,34.411,126.491,34.432,126.479,34.423,126.46,34.446,126.469,34.459,126.458,34.474,126.473,34.504,126.462,34.529,126.434,34.541,126.432,34.552,126.404,34.541,126.382,34.56,126.336,34.57,126.316,34.563,126.308,34.587,126.281,34.593,126.287,34.627,126.272,34.63,126.257,34.661,126.26,34.691,126.276,34.709,126.288,34.755,126.302,34.759,126.337,34.735,126.353,34.7,126.342,34.692,126.344,34.671,126.379,34.615,126.437,34.587,126.43,34.611,126.376,34.641,126.346,34.683,126.37,34.696,126.391,34.728,126.369,34.735,126.382,34.75,126.381,34.764,126.451,34.78,126.443,34.796,126.403,34.78,126.371,34.778,126.364,34.788,126.372,34.81,126.409,34.849,126.397,34.866,126.404,34.877,126.391,34.887,126.407,34.908,126.394,34.917,126.389,34.944,126.396,34.959,126.381,34.968,126.369,34.925,126.345,34.912,126.297,34.962,126.308,34.983,126.335,34.968,126.361,34.984,126.346,34.999,126.391,35.022,126.383,35.044,126.354,35.036,126.346,35.067,126.33,35.085,126.303,35.045,126.293,35.056,126.262,35.05,126.276,35.035,126.258,35.01,126.229,35.02,126.237,35.041,126.225,35.055,126.163,35.064,126.169,35.101,126.193,35.11,126.235,35.095,126.259,35.139,126.327,35.131,126.347,35.148,126.337,35.089,126.37,35.068,126.399,35.074,126.409,35.061,126.401,35.03,126.443,35.053,126.454,35.07,126.442,35.081,126.462,35.089,126.448,35.103,126.422,35.104,126.405,35.132,126.342,35.19,126.309,35.175,126.3,35.224,126.313,35.252,126.326,35.25,126.325,35.285,126.36,35.286,126.38,35.303,126.38,35.326,126.408,35.406,126.424,35.425,126.481,35.421,126.491,35.408,126.484,35.383,126.522,35.347,126.52,35.323,126.533,35.304,126.553,35.31,126.594,35.302,126.583,35.321,126.606,35.332,126.647,35.317,126.669,35.348,126.701,35.347,126.707,35.362,126.733,35.373,126.732,35.392,126.754,35.42,126.75,35.447,126.766,35.463,126.815,35.466,126.828,35.483,126.907,35.438,126.9,35.43,126.935,35.392,126.979,35.4,126.972,35.424,127.037,35.462,127.04,35.433,127.051,35.428,127.044,35.396,127.033,35.387,127.049,35.374,127.059,35.381,127.072,35.363,127.067,35.333,127.054,35.337,127.049,35.315,127.118,35.297,127.171,35.329,127.217,35.313,127.225,35.334,127.263,35.309,127.29,35.311,127.308,35.3,127.358,35.318,127.387,35.3,127.433,35.356,127.474,35.364,127.504,35.356,127.58,35.306],[126.909,35.256,126.808,35.216,126.758,35.231,126.766,35.251,126.739,35.249,126.72,35.209,126.689,35.212,126.68,35.191,126.662,35.189,126.673,35.166,126.656,35.162,126.654,35.117,126.68,35.103,126.742,35.104,126.764,35.088,126.78,35.05,126.797,35.058,126.821,35.049,126.858,35.075,126.874,35.071,126.924,35.087,126.934,35.071,126.954,35.07,126.969,35.086,126.989,35.091,127.011,35.121,127.01,35.152,127.023,35.164,127.004,35.185,126.978,35.184,126.933,35.248,126.909,35.256],[126.425,34.736,126.4,34.736,126.39,34.717,126.455,34.703,126.453,34.684,126.473,34.656,126.481,34.677,126.496,34.663,126.545,34.652,126.53,34.704,126.501,34.732,126.473,34.735,126.461,34.726,126.425,34.736]],[[126.306,35.619,126.316,35.611,126.307,35.594,126.265,35.568,126.25,35.584,126.272,35.587,126.278,35.601,126.293,35.602,126.306,35.619],[127.64,36.065,127.657,36.053,127.662,36.036,127.687,36.059,127.699,36.053,127.708,36.03,127.79,36.011,127.803,36.024,127.856,36.036,127.879,36.019,127.878,35.994,127.897,35.982,127.911,35.938,127.884,35.925,127.89,35.912,127.854,35.887,127.843,35.864,127.833,35.867,127.774,35.836,127.748,35.84,127.722,35.794,127.664,35.756,127.663,35.707,127.647,35.695,127.622,35.639,127.63,35.615,127.615,35.604,127.613,35.582,127.59,35.562,127.593,35.551,127.626,35.531,127.655,35.483,127.639,35.475,127.638,35.459,127.647,35.447,127.669,35.445,127.664,35.414,127.642,35.402,127.612,35.363,127.623,35.329,127.594,35.308,127.58,35.306,127.504,35.356,127.474,35.364,127.433,35.356,127.387,35.3,127.358,35.318,127.308,35.3,127.29,35.311,127.263,35.309,127.225,35.334,127.217,35.313,127.171,35.329,127.118,35.297,127.049,35.315,127.054,35.337,127.067,35.333,127.072,35.363,127.059,35.381,127.049,35.374,127.033,35.387,127.044,35.396,127.051,35.428,127.04,35.433,127.037,35.462,126.972,35.424,126.979,35.4,126.935,35.392,126.9,35.43,126.907,35.438,126.828,35.483,126.815,35.466,126.766,35.463,126.75,35.447,126.754,35.42,126.732,35.392,126.733,35.373,126.707,35.362,126.701,35.347,126.669,35.348,126.647,35.317,126.606,35.332,126.583,35.321,126.594,35.302,126.553,35.31,126.533,35.304,126.52,35.323,126.522,35.347,126.484,35.383,126.491,35.408,126.481,35.421,126.431,35.435,126.485,35.516,126.521,35.531,126.544,35.524,126.564,35.538,126.605,35.54,126.619,35.567,126.65,35.567,126.667,35.552,126.674,35.578,126.638,35.59,126.619,35.582,126.543,35.585,126.53,35.576,126.494,35.583,126.47,35.601,126.467,35.631,126.535,35.684,126.573,35.692,126.604,35.717,126.629,35.745,126.625,35.786,126.645,35.795,126.701,35.796,126.772,35.775,126.779,35.798,126.735,35.816,126.694,35.849,126.733,35.864,126.79,35.862,126.801,35.871,126.803,35.891,126.786,35.899,126.772,35.886,126.678,35.892,126.67,35.88,126.617,35.883,126.617,35.94,126.53,35.937,126.523,35.968,126.645,35.976,126.669,35.981,126.682,35.996,126.727,35.992,126.751,36.021,126.812,36.031,126.866,36.058,126.875,36.11,126.894,36.138,126.925,36.136,126.959,36.153,126.992,36.142,127.006,36.146,127.026,36.134,127.052,36.139,127.063,36.091,127.084,36.075,127.136,36.067,127.139,36.084,127.171,36.081,127.181,36.091,127.202,36.083,127.207,36.097,127.248,36.092,127.254,36.11,127.275,36.105,127.297,36.11,127.308,36.123,127.341,36.128,127.357,36.105,127.363,36.05,127.377,36.031,127.403,36.005,127.428,36.023,127.458,35.981,127.47,35.985,127.49,35.975,127.536,35.989,127.54,36.03,127.594,36.022,127.62,36.005,127.633,36.038,127.621,36.039,127.626,36.064,127.64,36.065]],[[126.359,36.352,126.362,36.327,126.342,36.331,126.359,36.352],[126.435,36.383,126.461,36.352,126.398,36.365,126.388,36.378,126.435,36.383],[126.343,36.402,126.341,36.376,126.325,36.385,126.343,36.402],[126.363,36.61,126.387,36.603,126.401,36.579,126.393,36.548,126.399,36.516,126.429,36.459,126.437,36.416,126.421,36.402,126.383,36.415,126.373,36.407,126.34,36.436,126.328,36.465,126.336,36.488,126.312,36.582,126.342,36.606,126.363,36.61],[126.43,37.062,126.453,37.051,126.425,37.041,126.43,37.062],[126.911,36.902,126.998,36.933,127.034,36.925,127.076,36.936,127.116,36.97,127.132,36.962,127.146,36.969,127.204,36.949,127.246,36.915,127.272,36.91,127.31,36.882,127.308,36.86,127.338,36.852,127.336,36.828,127.358,36.826,127.404,36.792,127.397,36.781,127.414,36.769,127.414,36.754,127.399,36.744,127.39,36.756,127.339,36.75,127.343,36.729,127.327,36.73,127.31,36.718,127.31,36.702,127.288,36.688,127.25,36.692,127.206,36.722,127.165,36.731,127.136,36.704,127.145,36.689,127.163,36.689,127.167,36.675,127.157,36.662,127.158,36.603,127.184,36.593,127.195,36.578,127.196,36.562,127.175,36.533,127.184,36.519,127.173,36.509,127.207,36.456,127.203,36.439,127.26,36.405,127.284,36.412,127.283,36.372,127.273,36.358,127.28,36.346,127.262,36.324,127.252,36.28,127.283,36.262,127.285,36.233,127.317,36.218,127.343,36.186,127.367,36.217,127.362,36.261,127.375,36.269,127.392,36.262,127.389,36.248,127.41,36.21,127.445,36.191,127.47,36.22,127.533,36.246,127.581,36.23,127.6,36.214,127.595,36.192,127.604,36.159,127.592,36.131,127.64,36.065,127.626,36.064,127.621,36.039,127.633,36.038,127.62,36.005,127.594,36.022,127.54,36.03,127.536,35.989,127.49,35.975,127.47,35.985,127.458,35.981,127.428,36.023,127.403,36.005,127.363,36.05,127.357,36.105,127.341,36.128,127.308,36.123,127.297,36.11,127.275,36.105,127.254,36.11,127.248,36.092,127.207,36.097,127.202,36.083,127.181,36.091,127.171,36.081,127.139,36.084,127.136,36.067,127.084,36.075,127.063,36.091,127.052,36.139,127.026,36.134,127.006,36.146,126.992,36.142,126.959,36.153,126.925,36.136,126.894,36.138,126.875,36.11,126.866,36.058,126.812,36.031,126.751,36.021,126.737,35.998,126.663,36.008,126.67,36.029,126.646,36.053,126.634,36.053,126.635,36.09,126.579,36.135,126.562,36.127,126.54,36.145,126.514,36.149,126.526,36.182,126.545,36.194,126.532,36.236,126.549,36.261,126.505,36.322,126.554,36.345,126.511,36.377,126.482,36.38,126.499,36.424,126.475,36.5,126.487,36.513,126.464,36.536,126.449,36.583,126.453,36.594,126.478,36.603,126.476,36.614,126.459,36.623,126.47,36.651,126.463,36.662,126.444,36.664,126.446,36.641,126.426,36.597,126.367,36.624,126.363,36.666,126.343,36.665,126.358,36.624,126.295,36.581,126.284,36.593,126.298,36.627,126.287,36.661,126.265,36.671,126.273,36.723,126.231,36.69,126.214,36.69,126.199,36.672,126.132,36.665,126.132,36.685,126.149,36.684,126.148,36.701,126.173,36.716,126.21,36.703,126.223,36.719,126.205,36.724,126.187,36.75,126.167,36.755,126.149,36.748,126.154,36.728,126.138,36.716,126.124,36.724,126.136,36.738,126.104,36.77,126.131,36.772,126.144,36.786,126.16,36.823,126.148,36.836,126.165,36.844,126.177,36.833,126.195,36.846,126.19,36.865,126.211,36.898,126.251,36.909,126.244,36.886,126.223,36.878,126.244,36.861,126.255,36.877,126.272,36.881,126.295,36.927,126.286,36.961,126.31,36.971,126.316,36.952,126.305,36.941,126.304,36.919,126.322,36.903,126.323,36.889,126.297,36.84,126.319,36.836,126.283,36.815,126.299,36.806,126.34,36.815,126.323,36.835,126.326,36.854,126.365,36.848,126.373,36.862,126.366,36.874,126.412,36.905,126.383,36.941,126.336,36.957,126.341,36.972,126.328,36.991,126.377,37.009,126.428,37.012,126.453,37.003,126.48,36.966,126.489,36.98,126.456,37.023,126.5,37.062,126.642,36.995,126.707,36.997,126.783,36.974,126.804,36.922,126.814,36.922,126.834,36.859,126.85,36.875,126.914,36.888,126.911,36.902]],[[128.654,37.063,128.633,37.036,128.586,37.041,128.567,37.029,128.574,37.013,128.547,36.99,128.517,36.984,128.516,36.974,128.444,36.925,128.443,36.899,128.427,36.874,128.45,36.862,128.451,36.846,128.423,36.809,128.384,36.811,128.369,36.798,128.323,36.812,128.285,36.854,128.244,36.87,128.236,36.845,128.216,36.846,128.221,36.812,128.167,36.817,128.142,36.831,128.114,36.816,128.109,36.803,128.086,36.801,128.061,36.813,128.035,36.745,128.071,36.719,128.074,36.704,128.05,36.705,128.024,36.723,127.989,36.715,127.963,36.734,127.934,36.703,127.934,36.69,127.89,36.688,127.934,36.662,127.941,36.648,127.934,36.615,127.892,36.627,127.876,36.652,127.865,36.632,127.85,36.63,127.852,36.61,127.826,36.61,127.8,36.588,127.826,36.568,127.864,36.565,127.876,36.552,127.876,36.535,127.903,36.522,127.909,36.505,127.883,36.478,127.875,36.434,127.885,36.419,127.875,36.403,127.893,36.354,127.854,36.327,127.843,36.307,127.853,36.273,127.882,36.272,127.894,36.289,127.933,36.275,127.951,36.254,127.97,36.248,128.012,36.269,128.049,36.254,128.032,36.237,128.055,36.198,128.041,36.191,128.016,36.206,127.978,36.185,127.998,36.15,127.989,36.126,127.969,36.115,127.96,36.092,127.964,36.065,127.938,36.048,127.919,36.051,127.879,36.019,127.856,36.036,127.803,36.024,127.79,36.011,127.708,36.03,127.699,36.053,127.687,36.059,127.662,36.036,127.657,36.053,127.592,36.131,127.604,36.159,127.595,36.192,127.6,36.214,127.581,36.23,127.533,36.246,127.495,36.235,127.488,36.256,127.503,36.33,127.529,36.366,127.527,36.384,127.557,36.396,127.545,36.418,127.518,36.419,127.505,36.405,127.491,36.43,127.505,36.446,127.481,36.455,127.455,36.447,127.405,36.453,127.406,36.48,127.398,36.489,127.409,36.492,127.411,36.521,127.404,36.538,127.386,36.539,127.375,36.557,127.339,36.56,127.327,36.578,127.31,36.581,127.303,36.613,127.281,36.632,127.289,36.651,127.303,36.656,127.31,36.679,127.288,36.688,127.31,36.702,127.31,36.718,127.327,36.73,127.343,36.729,127.339,36.75,127.39,36.756,127.399,36.744,127.414,36.754,127.414,36.769,127.397,36.781,127.404,36.792,127.358,36.826,127.336,36.828,127.338,36.852,127.308,36.86,127.31,36.882,127.292,36.891,127.311,36.926,127.352,36.95,127.381,36.949,127.404,36.965,127.387,36.982,127.396,36.995,127.432,36.999,127.46,37.018,127.46,37.041,127.518,37.055,127.569,37.044,127.568,37.06,127.633,37.093,127.64,37.138,127.689,37.132,127.75,37.214,127.756,37.173,127.791,37.142,127.875,37.161,127.904,37.149,127.939,37.186,127.923,37.223,127.95,37.244,127.987,37.255,128.021,37.242,128.041,37.213,128.032,37.199,128.042,37.186,128.081,37.191,128.127,37.218,128.175,37.216,128.176,37.23,128.203,37.246,128.231,37.225,128.255,37.225,128.271,37.205,128.318,37.221,128.336,37.213,128.328,37.194,128.267,37.158,128.296,37.135,128.339,37.155,128.403,37.144,128.399,37.126,128.426,37.11,128.474,37.107,128.489,37.117,128.515,37.111,128.517,37.1,128.54,37.087,128.654,37.063]],[[129.366,37.144,129.306,37.126,129.297,37.112,129.274,37.114,129.268,37.099,129.228,37.071,129.235,37.042,129.197,37.038,129.143,37.079,129.098,37.098,129.079,37.09,129.067,37.065,128.985,37.081,128.963,37.075,128.947,37.092,128.925,37.089,128.898,37.042,128.849,37.049,128.829,37.075,128.787,37.085,128.754,37.055,128.764,37.032,128.754,37.026,128.737,37.037,128.702,37.038,128.691,37.05,128.63,37.072,128.54,37.087,128.517,37.1,128.515,37.111,128.489,37.117,128.474,37.107,128.426,37.11,128.399,37.126,128.403,37.144,128.339,37.155,128.296,37.135,128.267,37.158,128.328,37.194,128.336,37.213,128.318,37.221,128.271,37.205,128.255,37.225,128.231,37.225,128.203,37.246,128.176,37.23,128.175,37.216,128.127,37.218,128.081,37.191,128.042,37.186,128.032,37.199,128.041,37.213,128.021,37.242,127.987,37.255,127.95,37.244,127.923,37.223,127.939,37.186,127.904,37.149,127.875,37.161,127.791,37.142,127.756,37.173,127.746,37.208,127.76,37.255,127.757,37.295,127.771,37.305,127.762,37.364,127.78,37.368,127.78,37.386,127.806,37.426,127.776,37.503,127.809,37.532,127.845,37.536,127.852,37.55,127.815,37.562,127.795,37.583,127.71,37.584,127.699,37.598,127.605,37.649,127.582,37.63,127.561,37.626,127.539,37.64,127.555,37.659,127.552,37.683,127.565,37.718,127.51,37.728,127.547,37.758,127.524,37.789,127.538,37.806,127.528,37.821,127.535,37.839,127.587,37.873,127.603,37.872,127.62,37.904,127.616,37.937,127.605,37.952,127.546,37.965,127.542,37.998,127.504,37.997,127.46,38.013,127.443,38.105,127.433,38.112,127.415,38.099,127.406,38.11,127.386,38.112,127.323,38.092,127.313,38.113,127.285,38.114,127.278,38.134,127.291,38.174,127.273,38.179,127.258,38.16,127.225,38.144,127.192,38.158,127.169,38.197,127.165,38.229,127.151,38.24,127.132,38.23,127.112,38.239,127.111,38.289,127.161,38.332,127.184,38.314,127.246,38.336,127.313,38.314,127.34,38.329,127.39,38.337,127.427,38.332,127.451,38.315,127.478,38.315,127.489,38.301,127.511,38.301,127.544,38.323,127.59,38.337,127.641,38.326,127.692,38.33,127.702,38.341,127.732,38.335,127.78,38.351,127.804,38.323,127.887,38.341,127.98,38.318,128.066,38.311,128.218,38.38,128.284,38.433,128.304,38.469,128.318,38.562,128.313,38.589,128.323,38.607,128.353,38.611,128.399,38.564,128.442,38.475,128.47,38.449,128.458,38.444,128.46,38.427,128.518,38.369,128.529,38.336,128.553,38.311,128.592,38.24,128.599,38.196,128.612,38.181,128.612,38.148,128.669,38.089,128.68,38.063,128.729,38.021,128.775,37.952,128.837,37.895,128.833,37.882,128.882,37.827,129.059,37.673,129.06,37.658,129.047,37.64,129.057,37.619,129.12,37.574,129.124,37.554,129.115,37.537,129.125,37.518,129.19,37.453,129.2,37.413,129.253,37.378,129.272,37.32,129.305,37.301,129.303,37.29,129.332,37.278,129.329,37.263,129.359,37.233,129.344,37.223,129.35,37.209,129.342,37.192,129.366,37.144]],[[126.61,37.306,126.572,37.277,126.611,37.26,126.625,37.234,126.652,37.223,126.649,37.208,126.614,37.216,126.605,37.205,126.587,37.218,126.571,37.201,126.546,37.204,126.544,37.222,126.563,37.239,126.565,37.253,126.551,37.277,126.57,37.279,126.61,37.306],[127.75,37.214,127.689,37.132,127.64,37.138,127.633,37.093,127.568,37.06,127.569,37.044,127.518,37.055,127.46,37.041,127.46,37.018,127.432,36.999,127.396,36.995,127.387,36.982,127.404,36.965,127.381,36.949,127.352,36.95,127.311,36.926,127.292,36.891,127.272,36.91,127.222,36.927,127.204,36.949,127.116,36.97,127.076,36.936,127.034,36.925,126.998,36.933,126.911,36.902,126.907,36.923,126.889,36.933,126.866,36.93,126.864,36.946,126.826,36.993,126.8,37.005,126.791,37.026,126.753,37.026,126.75,37.046,126.772,37.1,126.761,37.108,126.771,37.125,126.797,37.126,126.807,37.149,126.792,37.172,126.78,37.162,126.749,37.163,126.73,37.136,126.691,37.113,126.675,37.135,126.685,37.146,126.663,37.159,126.668,37.206,126.679,37.221,126.667,37.234,126.689,37.26,126.791,37.242,126.792,37.264,126.828,37.286,126.728,37.299,126.725,37.311,126.695,37.331,126.691,37.346,126.755,37.42,126.771,37.425,126.78,37.448,126.77,37.469,126.744,37.484,126.747,37.511,126.762,37.514,126.77,37.551,126.824,37.538,126.831,37.524,126.816,37.49,126.824,37.473,126.842,37.473,126.87,37.491,126.905,37.431,126.928,37.446,126.942,37.433,126.965,37.438,127.006,37.464,127.013,37.453,127.039,37.454,127.038,37.438,127.068,37.426,127.1,37.456,127.149,37.474,127.163,37.497,127.142,37.506,127.165,37.542,127.181,37.544,127.184,37.558,127.176,37.577,127.103,37.557,127.104,37.581,127.12,37.602,127.11,37.642,127.094,37.647,127.097,37.686,127.084,37.694,127.052,37.685,127.018,37.698,126.995,37.675,126.982,37.652,126.987,37.634,126.977,37.629,126.949,37.656,126.915,37.642,126.904,37.592,126.878,37.577,126.853,37.573,126.808,37.601,126.796,37.579,126.727,37.589,126.701,37.615,126.659,37.635,126.638,37.625,126.63,37.604,126.575,37.585,126.556,37.607,126.531,37.65,126.537,37.664,126.525,37.674,126.529,37.7,126.521,37.71,126.53,37.746,126.517,37.764,126.538,37.769,126.557,37.766,126.569,37.753,126.612,37.75,126.664,37.787,126.676,37.828,126.662,37.836,126.693,37.864,126.674,37.884,126.679,37.895,126.668,37.918,126.675,37.953,126.716,37.937,126.747,37.949,126.742,37.97,126.798,37.991,126.832,37.99,126.825,38.009,126.834,38.031,126.875,38.016,126.895,38.049,126.895,38.072,126.852,38.092,126.83,38.076,126.824,38.085,126.798,38.079,126.75,38.125,126.772,38.152,126.875,38.22,126.897,38.202,126.955,38.208,126.967,38.195,126.986,38.209,126.977,38.231,127.111,38.289,127.112,38.239,127.132,38.23,127.151,38.24,127.165,38.229,127.169,38.197,127.192,38.158,127.225,38.144,127.258,38.16,127.273,38.179,127.291,38.174,127.278,38.134,127.285,38.114,127.313,38.113,127.323,38.092,127.386,38.112,127.406,38.11,127.415,38.099,127.433,38.112,127.443,38.105,127.46,38.013,127.504,37.997,127.542,37.998,127.546,37.965,127.605,37.952,127.616,37.937,127.62,37.904,127.603,37.872,127.587,37.873,127.535,37.839,127.528,37.821,127.538,37.806,127.524,37.789,127.547,37.758,127.51,37.728,127.565,37.718,127.552,37.683,127.555,37.659,127.539,37.64,127.561,37.626,127.582,37.63,127.605,37.649,127.699,37.598,127.71,37.584,127.795,37.583,127.815,37.562,127.852,37.55,127.845,37.536,127.809,37.532,127.776,37.503,127.806,37.426,127.78,37.386,127.78,37.368,127.762,37.364,127.771,37.305,127.757,37.295,127.76,37.255,127.751,37.245,127.75,37.214]],[[127.288,36.688,127.31,36.679,127.303,36.656,127.289,36.651,127.281,36.632,127.303,36.613,127.31,36.581,127.327,36.578,127.339,36.56,127.375,36.557,127.386,36.539,127.404,36.538,127.409,36.492,127.383,36.497,127.361,36.482,127.355,36.445,127.329,36.419,127.296,36.419,127.26,36.405,127.203,36.439,127.207,36.456,127.173,36.509,127.184,36.519,127.175,36.533,127.196,36.562,127.195,36.578,127.184,36.593,127.158,36.603,127.157,36.662,127.167,36.675,127.163,36.689,127.145,36.689,127.136,36.704,127.165,36.731,127.206,36.722,127.25,36.692,127.288,36.688]],[[129.452,35.648,129.444,35.628,129.465,35.601,129.467,35.583,129.455,35.569,129.461,35.556,129.442,35.483,129.387,35.472,129.352,35.445,129.367,35.439,129.365,35.408,129.348,35.373,129.361,35.353,129.325,35.343,129.307,35.326,129.282,35.338,129.286,35.36,129.268,35.383,129.22,35.376,129.205,35.385,129.222,35.406,129.199,35.436,129.163,35.432,129.112,35.477,129.109,35.492,128.997,35.526,128.973,35.558,129.022,35.581,129.023,35.612,129.006,35.617,129.05,35.647,129.076,35.637,129.072,35.678,129.091,35.699,129.138,35.709,129.148,35.722,129.163,35.712,129.21,35.718,129.256,35.698,129.265,35.688,129.257,35.663,129.263,35.651,129.305,35.645,129.356,35.677,129.452,35.648]],[[127.495,36.235,127.445,36.191,127.41,36.21,127.389,36.248,127.392,36.262,127.375,36.269,127.362,36.261,127.367,36.217,127.343,36.186,127.317,36.218,127.285,36.233,127.283,36.262,127.252,36.28,127.262,36.324,127.28,36.346,127.273,36.358,127.283,36.372,127.284,36.412,127.329,36.419,127.355,36.445,127.361,36.482,127.383,36.497,127.406,36.48,127.405,36.453,127.455,36.447,127.481,36.455,127.505,36.446,127.491,36.43,127.505,36.405,127.518,36.419,127.545,36.418,127.557,36.396,127.527,36.384,127.529,36.366,127.503,36.33,127.488,36.256,127.495,36.235]],[[126.909,35.256,126.933,35.248,126.978,35.184,127.004,35.185,127.023,35.164,127.01,35.152,127.011,35.121,126.989,35.091,126.969,35.086,126.954,35.07,126.934,35.071,126.924,35.087,126.874,35.071,126.858,35.075,126.821,35.049,126.797,35.058,126.78,35.05,126.764,35.088,126.742,35.104,126.68,35.103,126.654,35.117,126.656,35.162,126.673,35.166,126.662,35.189,126.68,35.191,126.689,35.212,126.72,35.209,126.739,35.249,126.766,35.251,126.758,35.231,126.808,35.216,126.909,35.256]],[[126.082,37.106,126.091,37.092,126.077,37.081,126.062,37.093,126.082,37.106],[126.099,37.184,126.115,37.168,126.096,37.164,126.099,37.184],[126.289,37.27,126.319,37.26,126.306,37.251,126.284,37.261,126.289,37.27],[126.11,37.27,126.147,37.236,126.163,37.233,126.144,37.211,126.119,37.206,126.115,37.219,126.093,37.227,126.092,37.244,126.11,37.27],[126.473,37.285,126.491,37.28,126.504,37.255,126.46,37.223,126.433,37.232,126.44,37.27,126.473,37.285],[126.414,37.409,126.443,37.383,126.437,37.368,126.415,37.363,126.401,37.398,126.414,37.409],[126.581,37.498,126.587,37.487,126.509,37.463,126.498,37.445,126.444,37.418,126.422,37.419,126.418,37.43,126.374,37.445,126.358,37.464,126.434,37.501,126.485,37.501,126.5,37.529,126.568,37.512,126.581,37.498],[126.463,37.542,126.476,37.535,126.469,37.508,126.434,37.523,126.463,37.542],[126.31,37.558,126.363,37.528,126.33,37.524,126.331,37.538,126.31,37.558],[126.796,37.579,126.77,37.551,126.762,37.514,126.747,37.511,126.744,37.484,126.77,37.469,126.78,37.448,126.771,37.425,126.755,37.42,126.731,37.385,126.663,37.34,126.619,37.34,126.614,37.371,126.6,37.382,126.595,37.461,126.606,37.494,126.608,37.551,126.575,37.585,126.63,37.604,126.638,37.625,126.659,37.635,126.701,37.615,126.727,37.589,126.796,37.579],[126.235,37.654,126.256,37.651,126.248,37.628,126.227,37.646,126.235,37.654],[125.718,37.677,125.712,37.663,125.685,37.651,125.685,37.678,125.718,37.677],[126.197,37.686,126.213,37.664,126.207,37.653,126.179,37.667,126.197,37.686],[126.331,37.747,126.323,37.713,126.348,37.696,126.374,37.692,126.379,37.665,126.345,37.641,126.327,37.639,126.319,37.679,126.272,37.706,126.287,37.715,126.291,37.741,126.331,37.747],[126.268,37.813,126.337,37.796,126.319,37.772,126.294,37.762,126.25,37.763,126.229,37.75,126.209,37.766,126.225,37.803,126.239,37.814,126.268,37.813],[126.528,37.735,126.525,37.674,126.537,37.664,126.533,37.636,126.549,37.602,126.526,37.594,126.518,37.577,126.503,37.587,126.482,37.581,126.475,37.595,126.406,37.591,126.38,37.607,126.374,37.63,126.407,37.648,126.389,37.687,126.354,37.703,126.345,37.718,126.344,37.746,126.357,37.756,126.351,37.789,126.396,37.823,126.439,37.828,126.467,37.802,126.51,37.781,126.528,37.735],[124.709,37.844,124.723,37.844,124.722,37.814,124.714,37.804,124.686,37.803,124.681,37.819,124.709,37.844],[124.687,37.979,124.731,37.976,124.733,37.951,124.71,37.941,124.698,37.913,124.639,37.921,124.613,37.958,124.617,37.974,124.64,37.966,124.687,37.979]],[[128.529,35.679,128.511,35.672,128.507,35.636,128.449,35.635,128.434,35.62,128.384,35.604,128.373,35.608,128.388,35.609,128.405,35.639,128.358,35.678,128.353,35.7,128.42,35.69,128.435,35.7,128.435,35.722,128.395,35.743,128.389,35.76,128.422,35.806,128.471,35.805,128.48,35.824,128.425,35.848,128.392,35.847,128.388,35.862,128.42,35.918,128.443,35.932,128.478,35.933,128.47,35.904,128.478,35.892,128.495,35.893,128.526,35.915,128.537,35.937,128.529,35.973,128.558,35.968,128.592,35.976,128.62,36.003,128.693,36.012,128.728,36.002,128.748,35.968,128.741,35.925,128.759,35.912,128.765,35.881,128.754,35.854,128.711,35.824,128.719,35.803,128.685,35.787,128.698,35.755,128.694,35.729,128.686,35.719,128.625,35.7,128.612,35.722,128.619,35.734,128.582,35.736,128.546,35.716,128.529,35.679]],[[129.307,35.326,129.268,35.316,129.263,35.278,129.245,35.261,129.256,35.244,129.227,35.183,129.201,35.175,129.196,35.158,129.139,35.151,129.123,35.131,129.125,35.097,129.097,35.096,129.069,35.105,129.068,35.12,129.052,35.12,129.043,35.105,129.071,35.093,129.082,35.068,129.098,35.057,129.085,35.047,129.037,35.082,129.025,35.059,129.004,35.045,128.984,35.045,128.969,35.03,128.953,35.075,128.923,35.083,128.914,35.076,128.837,35.077,128.852,35.03,128.838,35.01,128.808,35.017,128.814,35.037,128.799,35.051,128.823,35.058,128.833,35.07,128.825,35.096,128.844,35.104,128.834,35.126,128.804,35.139,128.796,35.155,128.846,35.155,128.868,35.164,128.884,35.179,128.873,35.199,128.886,35.211,129.0,35.231,129.015,35.27,129.052,35.277,129.062,35.292,129.076,35.287,129.114,35.306,129.13,35.342,129.151,35.361,129.177,35.348,129.196,35.358,129.205,35.385,129.22,35.376,129.268,35.383,129.286,35.36,129.282,35.338,129.307,35.326]],[[126.77,37.551,126.808,37.601,126.853,37.573,126.904,37.592,126.915,37.642,126.949,37.656,126.977,37.629,126.987,37.634,126.982,37.652,127.018,37.698,127.052,37.685,127.084,37.694,127.097,37.686,127.094,37.647,127.11,37.642,127.12,37.602,127.104,37.581,127.103,37.557,127.176,37.577,127.184,37.558,127.181,37.544,127.165,37.542,127.142,37.506,127.163,37.497,127.149,37.474,127.1,37.456,127.068,37.426,127.038,37.438,127.039,37.454,127.013,37.453,127.006,37.464,126.965,37.438,126.942,37.433,126.928,37.446,126.905,37.431,126.87,37.491,126.842,37.473,126.824,37.473,126.816,37.49,126.831,37.524,126.824,37.538,126.77,37.551]]];

  /* ───────────────────── 접속코드 게이트 · 구글 시트 실시간 연결 ───────────────────── */
  function showGate(msg, mode) {
    var g = $('#gate');
    if (!g) return;
    if (mode) setGateMode(mode);
    g.classList.remove('hidden');
    gateError(msg || '');
    var chip = $('#syncStatus');
    if (chip) chip.classList.add('hidden');
    setTimeout(function () {
      var i = (gateMode === 'code') ? $('#gateCode') : (gateExtTab === 'remember' ? $('#extNameA') : $('#extNameB'));
      if (i) i.focus();
    }, 60);
  }

  function hideGate() {
    var g = $('#gate');
    if (g) g.classList.add('hidden');
  }

  function gateError(msg) {
    var el = $('#gateError');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  var gateMode = 'code';       // code | ext
  var gateExtTab = 'remember'; // remember(명함 인증) | new(신규 등록)

  function setGateMode(mode) {
    gateMode = (mode === 'ext') ? 'ext' : 'code';
    var card = $('#gateCard');
    if (card) card.classList.toggle('wide', gateMode === 'ext');
    var pc = $('#gatePanelCode'), pe = $('#gatePanelExt');
    if (pc) pc.classList.toggle('hidden', gateMode !== 'code');
    if (pe) pe.classList.toggle('hidden', gateMode !== 'ext');
    $$('.gate-tab').forEach(function (b) {
      var on = b.getAttribute('data-gate-tab') === gateMode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    gateError('');
  }

  function setExtTab(tab) {
    gateExtTab = (tab === 'new') ? 'new' : 'remember';
    var pr = $('#extPanelRemember'), pn = $('#extPanelNew');
    if (pr) pr.classList.toggle('hidden', gateExtTab !== 'remember');
    if (pn) pn.classList.toggle('hidden', gateExtTab !== 'new');
    $$('.gate-stab').forEach(function (b) {
      var on = b.getAttribute('data-ext-tab') === gateExtTab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    gateError('');
  }

  function gateVal(sel) {
    var el = $(sel);
    return String((el && el.value) || '').trim();
  }

  function gateBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
      btn.disabled = true;
      btn.textContent = label || '확인 중…';
    } else {
      btn.disabled = false;
      var orig = btn.getAttribute('data-label');
      if (orig) btn.textContent = orig;
    }
  }

  /** 토큰 없이 호출하는 공개 액션(외부 명함 인증·신규 등록). */
  function postPublic(payload) {
    return fetch(CFG.SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  function digits(s) { return String(s || '').replace(/[^0-9]/g, ''); }

  /** Case A — 리멤버 명함 인증 (이름·회사·전화번호 → 명함첩 대조) */
  function submitExternalAuth(e) {
    e.preventDefault();
    var name = gateVal('#extNameA'), company = gateVal('#extCompanyA'), phone = gateVal('#extPhoneA');
    if (!name) { gateError('이름을 입력하세요.'); return; }
    if (!company) { gateError('회사를 입력하세요.'); return; }
    if (digits(phone).length < 4) { gateError('전화번호를 입력하세요.'); return; }
    var btn = $('#extSubmitA');
    gateError('');
    gateBusy(btn, true, '명함 대조 중…');
    postPublic({ action: 'auth_external', name: name, company: company, phone: phone, tag: 'web' })
      .then(function (j) {
        if (!j || j.ok !== true) {
          gateBusy(btn, false);
          if (j && j.error === 'not_found') {
            gateError('명함첩에서 일치하는 분을 찾지 못했습니다. 회사명을 포함해 다시 시도하시거나, [첫 방문 · 신규 등록]으로 정보를 남겨 주세요.');
          } else if (j && j.error === 'phone_mismatch') {
            gateError('이름은 확인됐지만 전화번호가 명함과 다릅니다. 명함에 적힌 번호로 다시 시도하시고, 바뀐 번호라면 [첫 방문 · 신규 등록]을 이용해 주세요.');
          } else {
            gateError('명함 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.');
          }
          return null;
        }
        return connect(j.token, true).then(function () {
          toast((j.name || '') + ' 님 — 리멤버 명함 인증 완료. 외부 열람 모드로 입장했습니다.');
        });
      })
      .catch(function () { gateBusy(btn, false); gateError('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); });
  }

  /** Case B — 리멤버 친추 + 본인 정보 등록 → new_contacts 저장 후 입장 */
  function submitExternalRegister(e) {
    e.preventDefault();
    var name = gateVal('#extNameB'), company = gateVal('#extCompanyB'), title = gateVal('#extTitleB');
    var phone = gateVal('#extPhoneB'), email = gateVal('#extEmailB');
    var sectorEl = $('#extSectorB'), chk = $('#extRememberB');
    var sector = sectorEl ? sectorEl.value : '';
    var checked = (chk && chk.checked) ? 'Y' : 'N';
    if (!name) { gateError('이름을 입력하세요.'); return; }
    if (!company) { gateError('회사를 입력하세요.'); return; }
    if (digits(phone).length < 9) { gateError('전화번호를 정확히 입력하세요.'); return; }
    if (email && email.indexOf('@') < 0) { gateError('이메일 형식을 확인하세요.'); return; }
    var btn = $('#extSubmitB');
    gateError('');
    gateBusy(btn, true, '등록 중…');
    postPublic({
      action: 'register_external', name: name, company: company, title: title,
      phone: phone, email: email, interest_sector: sector, remember_checked: checked, tag: 'web'
    }).then(function (j) {
      if (!j || j.ok !== true) {
        gateBusy(btn, false);
        gateError('등록하지 못했습니다' + (j && j.error ? ' (' + j.error + ')' : '') + '. 잠시 후 다시 시도해 주세요.');
        return null;
      }
      return connect(j.token, true).then(function () {
        toast((j.name || '') + ' 님 — 등록 완료. 외부 열람 모드로 입장했습니다.');
      });
    }).catch(function () { gateBusy(btn, false); gateError('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); });
  }

  /** 접속코드 다시 입력 / 외부 세션 종료. */
  function changeAccessCode() {
    var ext = isExternal();
    showModal({
      title: ext ? '외부 세션 종료' : '접속코드 변경',
      body: ext
        ? '이 브라우저의 외부 열람 세션을 종료하고 접속 화면으로 돌아갑니다. 다시 입장하려면 리멤버 명함 인증을 다시 해 주세요.'
        : '접속코드를 다시 입력합니다. <b>관리자 코드</b>는 수정·추가·삭제까지, <b>내부용 코드</b>는 조회(전화번호 가림)만 됩니다.',
      actions: [{ label: '취소', value: false, cls: 'btn-outline' }, { label: ext ? '세션 종료' : '코드 입력', value: true, cls: 'btn-solid' }]
    }).then(function (ok) {
      if (!ok) return;
      writePending([]);
      clearToken();
      state.role = 'external';
      state.me = null;
      state.selectedId = null;
      state.panelMode = 'view';
      $('#detailPanel').classList.add('hidden');
      var badge = $('#roleBadge');
      if (badge) badge.classList.add('hidden');
      applyRoleUI();
      showGate('', ext ? 'ext' : 'code');
    });
  }

  function bindGate() {
    $$('.gate-tab').forEach(function (b) {
      b.addEventListener('click', function () { setGateMode(b.getAttribute('data-gate-tab')); });
    });
    $$('.gate-stab').forEach(function (b) {
      b.addEventListener('click', function () { setExtTab(b.getAttribute('data-ext-tab')); });
    });

    var form = $('#gateForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = $('#gateCode');
        var code = String((input && input.value) || '').trim();
        if (!code) { gateError('접속코드를 입력하세요.'); return; }
        var btn = $('#gateSubmit');
        gateBusy(btn, true, '확인 중…');
        codeToToken(code).then(function (t) {
          return connect(t, true);
        }).then(function () {
          gateBusy(btn, false);
          if (input) input.value = '';
        }).catch(function (err) {
          gateBusy(btn, false);
          if (err && err.message === 'unauthorized') {
            gateError('접속코드가 올바르지 않습니다. 다시 확인해 주세요.');
          } else {
            gateError('연결하지 못했습니다: ' + (err && err.message ? err.message : '알 수 없는 오류'));
          }
        });
      });
    }

    var fa = $('#extFormA');
    if (fa) fa.addEventListener('submit', submitExternalAuth);
    var fb = $('#extFormB');
    if (fb) fb.addEventListener('submit', submitExternalRegister);
  }

  var connectPromise = null;

  function roleOfServer_(j) {
    var r = String((j && j.role) || '');
    if (r === 'admin') return 'admin';
    if (r === 'internal' || r === 'readonly') return 'internal';
    return 'external';
  }

  /** 접속 토큰으로 비공개 시트 데이터를 받아 앱에 올립니다. (관리자·내부용·외부 세션 공통) */
  function connect(token, isUserInput) {
    if (connectPromise) return connectPromise;
    setSyncStatus('연결 중…');
    connectPromise = syncGet(token).then(function (j) {
      connectPromise = null;
      if (!j || j.ok !== true) {
        if (j && j.error === 'unauthorized' && isUserInput) clearToken();
        throw new Error((j && j.error) ? String(j.error) : 'server_error');
      }
      if (!Array.isArray(j.assets) || !j.assets.length) throw new Error('데이터가 비어 있습니다.');
      state.role = roleOfServer_(j);
      state.me = j.me || null;
      setToken(token);
      hideGate();
      applyRoleUI();
      state.base = j.assets;
      state.meta = computeMeta(j.assets);
      state.meta.source = 'Google Sheets(비공개) · Apps Script 실시간 동기화';
      rebuild();
      cacheSave();
      if (!state.mapInitDone) { state.mapInitDone = true; initMap(); }
      setSyncStatus(state.role === 'external' ? '외부 열람' : '동기화됨');
      updateStorageHint();
      logEvent('session', 'role=' + state.role + (state.me && state.me.name ? ' · ' + state.me.name : ''));
      if (readPending().length) flushPending();
      var hashId = decodeURIComponent((location.hash || '').replace('#', ''));
      if (hashId && state.index[hashId]) setTimeout(function () { selectAsset(hashId, { pan: true }); }, 250);
      return true;
    }).catch(function (err) {
      connectPromise = null;
      setSyncStatus('연결 실패', true);
      throw err;
    });
    return connectPromise;
  }

  function showFatal(msg) {
    var list = $('#assetList');
    if (list) list.innerHTML = '<div class="empty-state"><b>앱을 시작할 수 없습니다.</b><br>' + esc(msg) + '</div>';
    var line = $('#metaLine');
    if (line) line.textContent = '설정 오류';
  }

  /* ────────────────────────────── 부팅 ────────────────────────────── */
  function boot() {
    bindUI();
    bindGate();

    if (!isRemote()) {
      showFatal('config.js 의 SYNC_URL 이 비어 있습니다. 설정을 확인해 주세요.');
      return;
    }

    var t = getToken();
    if (!t) { showGate(''); return; }

    connect(t, false).catch(function (err) {
      if (err && err.message === 'unauthorized') {
        clearToken();
        showGate('접속코드가 만료되었거나 올바르지 않습니다. 다시 입력해 주세요.');
      } else {
        showGate('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    });
  }

  /* 외부(Apps Script·다른 스크립트)에서 접근할 수 있는 최소 인터페이스 */
  window.naiMap = {
    state: state,
    sync: { connect: connect, push: pushOp, flush: flushPending },
    reload: function () { rebuild(); },
    select: function (id) { selectAsset(id, { pan: true }); },
    role: function () { return state.role; },
    me: function () { return state.me; },
    log: logEvent,
    openAdd: function (prefill) { state._addPrefill = prefill || {}; state.panelMode = 'add'; renderDetail(); $('#detailPanel').classList.remove('hidden'); }
  };
  window.naiLog = logEvent;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
