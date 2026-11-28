/* =========================================================================
   Open AI Asset Bridge — adminlogs.js  (🛰️ 관리자 탭, 2026-11-24)
   -------------------------------------------------------------------------
   접속·열람 로그 뷰어 (관리자 전용)

   데이터 (기존 Apps Script API 그대로 사용)
     GET ?type=logs           — access_logs 최근 500건 (관리자)
     GET ?type=sessions       — ext_sessions (외부 방문자 세션)
     GET ?type=new_contacts   — new_contacts (신규 컨택)
     GET ?type=lois           — lois (인수·임차의향서 + TR 임차의뢰)
     POST {action:'submission_status'} — TR 접수 상태 변경

   물건별 열람 추적
     브라우저가 물건 상세·IM·밸류에이션·등기·TM/IM·TR 을 열 때마다
     POST {action:'log_event', kind:'asset_view', detail:'id=…|name=…|act=…'}
     로 기록하고, 이 화면이 사후에 파싱해 방문자별 / 물건별로 묶습니다.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = {
    built: false, sub: 'visitor', loaded: false, loading: false,
    logs: [], byVisitor: {}, byAsset: {}, byId: {}, nameToId: {},
    sessions: null, contacts: null, contactsRows: [], lois: null, extLoaded: false, extLoading: false, loisLoading: false,
    q: '', role: 'ALL', days: 0, sort: 'recent',
    expand: {}, assetFocus: null, note: '', dirty: false
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }
  function nfmt(v) { return (v == null || !isFinite(v)) ? '0' : Number(v).toLocaleString('ko-KR'); }

  function toast(msg, err) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3000);
  }

  function apiGet(type, extra) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var url = base + (base.indexOf('?') < 0 ? '?' : '&') + 'type=' + encodeURIComponent(type) +
      '&token=' + encodeURIComponent(getToken()) + (extra ? '&' + extra : '');
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function apiPost(payload) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var body = Object.assign({ token: getToken() }, payload);
    return fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  /* ───────────────────── 파싱 · 집계 ───────────────────── */

  function roleLabel(r) {
    return r === 'admin' ? '관리자' : (r === 'internal' ? '내부용' : (r === 'external' ? '외부' : (r || '—')));
  }
  function roleCls(r) {
    return r === 'admin' ? 'ra' : (r === 'internal' ? 'ri' : (r === 'external' ? 're' : ''));
  }
  function fmtTime(iso) {
    var d = new Date(String(iso || ''));
    if (!isFinite(d.getTime())) return String(iso || '');
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtFull(iso) {
    var d = new Date(String(iso || ''));
    if (!isFinite(d.getTime())) return String(iso || '');
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function tsOf(iso) { var t = new Date(String(iso || '')).getTime(); return isFinite(t) ? t : 0; }

  var ACT_LABEL = {
    상세: '상세', IM: 'IM', IM제작: 'IM 제작', TM제작: 'TM 제작',
    밸류에이션: '밸류에이션', 등기: '등기부', TR: 'TR', 시뮬: '시뮬레이션'
  };

  function parseLog(l) {
    var r = {
      ts: l.timestamp, role: l.role, name: l.name, company: l.company, phone: l.phone,
      action: l.action, detail: l.detail, assetId: '', assetName: '', act: ''
    };
    if (l.action === 'asset_view') {
      var m = String(l.detail || '').match(/^id=([^|]*)\|name=([^|]*)\|act=(.*)$/);
      if (m) { r.assetId = m[1]; r.assetName = m[2]; r.act = m[3]; }
      else { r.act = String(l.detail || ''); }
    } else if (l.action === 'asset') {
      r.act = '상세'; r.assetName = String(l.detail || '');
    }
    if (!r.assetId && r.assetName) {
      var st = window.naiMap && window.naiMap.state;
      var hit = st && st.assets ? st.assets.filter(function (a) { return a.name === r.assetName; })[0] : null;
      if (hit) r.assetId = hit.id;
    }
    r.isView = !!(r.assetId || r.assetName) && (l.action === 'asset_view' || l.action === 'asset');
    return r;
  }

  function rebuild() {
    S.byVisitor = {}; S.byAsset = {}; S.byId = {};
    var views = 0;
    S.logs.forEach(function (l) {
      var r = parseLog(l);
      l._p = r;
      if (r.isView) {
        views++;
        var vk = [r.role, r.name, r.company].join('|');
        var v = S.byVisitor[vk] || (S.byVisitor[vk] = {
          key: vk, role: r.role, name: r.name || '(미상)', company: r.company || '', items: [], assets: {}, last: 0
        });
        v.items.push(r);
        if (r.assetId) v.assets[r.assetId] = (v.assets[r.assetId] || 0) + 1;
        v.last = Math.max(v.last, tsOf(r.ts));

        var ak = r.assetId || ('name:' + r.assetName);
        var a = S.byAsset[ak] || (S.byAsset[ak] = {
          key: ak, id: r.assetId, name: r.assetName || '(이름 미상)', items: [], visitors: {}, last: 0
        });
        a.items.push(r);
        a.visitors[vk] = (a.visitors[vk] || 0) + 1;
        a.last = Math.max(a.last, tsOf(r.ts));
      }
    });
    S.viewCount = views;
    S.visitorCount = Object.keys(S.byVisitor).length;
    S.assetCount = Object.keys(S.byAsset).length;
  }

  /* ───────────────────── 수집 ───────────────────── */

  function load(force) {
    if (!isAdmin()) return Promise.resolve(false);
    if (S.loading) return Promise.resolve(false);
    if (S.loaded && !force) return Promise.resolve(true);
    S.loading = true;
    var host = $('#adminView');
    if (host && !S.built) renderShell();
    setLoadNote('불러오는 중…');
    return apiGet('logs').then(function (j) {
      S.loading = false;
      if (!j || !j.ok) {
        S.note = (j && j.error === 'readonly') ? '관리자 권한이 없습니다.' : ('불러오지 못했습니다: ' + ((j && j.error) || '오류'));
        S.loaded = false;
        setLoadNote(S.note);
        render();
        return false;
      }
      S.logs = (j.logs || []).slice();
      S.loaded = true;
      S.note = '';
      S.dirty = false;
      setLoadNote('마지막 수집 ' + fmtTime(new Date().toISOString()));
      rebuild();
      render();
      maybeRefreshDetail();
      return true;
    }).catch(function () {
      S.loading = false;
      S.note = '네트워크 오류로 로그를 불러오지 못했습니다.';
      setLoadNote(S.note);
      render();
      return false;
    });
  }

  function loadExt(force) {
    if (S.extLoading) return;
    if (S.extLoaded && !force) return;
    S.extLoading = true;
    Promise.all([apiGet('sessions'), apiGet('new_contacts'), apiGet('lois')]).then(function (arr) {
      var se = arr[0], ct = arr[1], lo = arr[2];
      S.sessions = (se && se.ok) ? (se.sessions || []) : [];
      S.contactsRows = (ct && ct.ok) ? (ct.contacts || []) : [];
      S.contacts = S.contactsRows.length;
      if (lo && lo.ok) S.lois = lo.items || [];
      S.extLoaded = true;
      S.extLoading = false;
      render();
    }).catch(function () {
      S.sessions = []; S.contactsRows = []; S.extLoaded = true; S.extLoading = false;
      render();
    });
  }

  function loadLois(force) {
    if (S.loisLoading) return;
    if (S.lois && !force) return;
    S.loisLoading = true;
    apiGet('lois').then(function (j) {
      S.lois = (j && j.ok) ? (j.items || []) : [];
      S.loisLoading = false;
      render();
    }).catch(function () { S.lois = []; S.loisLoading = false; render(); });
  }

  function setLoadNote(t) {
    var el = $('#adNote');
    if (el) el.textContent = t || '';
  }

  /* ───────────────────── NAI 주소록 · 권한 명단 (adminhq.js 모달 재사용) ─────────────────────
     관리자 탭에서도 같은 모달을 바로 엽니다. 명단(시트 admin_access)·직원 검색·권한 판정은
     adminhq.js 한 곳에서만 관리하고, 이 화면은 여는 역할만 합니다(중복 구현 방지). */
  function ensureModalClose() {
    var modal = $('#poolModal');
    if (!modal || modal._adAclBound) return;
    modal._adAclBound = true;
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-close-modal]')) modal.classList.add('hidden');
    });
  }
  function openAclModal() {
    if (!isAdmin()) { toast('관리자 전용 화면입니다.', true); return; }
    if (window.NAI_ACL && window.NAI_ACL.open) { try { window.NAI_ACL.open(); return; } catch (eA) { /* 아래 예비 경로 */ } }
    if (!(window.NAI_HQ && window.NAI_HQ.openAcl)) {
      toast('주소록·권한 명단 화면(adminhq.js)을 불러오지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.', true);
      return;
    }
    ensureModalClose();
    try { window.NAI_HQ.openAcl(); }
    catch (e) { toast('주소록·권한 명단을 열지 못했습니다.', true); }
  }
  function maybeRefreshDetail() {
    /* 상세 패널의 👁️ 열람 이력 배지를 갱신 */
    if (window.naiMap && window.naiMap.repaintDetail) {
      try { window.naiMap.repaintDetail(); } catch (e) { /* noop */ }
    }
  }

  /* ───────────────────── 필터 ───────────────────── */

  function inPeriod(ts) {
    if (!S.days) return true;
    var t = tsOf(ts);
    return (Date.now() - t) <= S.days * 24 * 3600 * 1000;
  }
  function visitorRows() {
    var q = S.q.trim().toLowerCase();
    return Object.keys(S.byVisitor).map(function (k) { return S.byVisitor[k]; })
      .filter(function (v) {
        if (S.role !== 'ALL' && v.role !== S.role) return false;
        if (S.days && !inPeriod(new Date(v.last).toISOString())) return false;
        if (q) {
          var hay = (v.name + ' ' + v.company).toLowerCase();
          if (hay.indexOf(q) < 0 && !v.items.some(function (x) { return String(x.assetName || '').toLowerCase().indexOf(q) >= 0; })) return false;
        }
        return true;
      })
      .sort(function (a, b) { return S.sort === 'count' ? (b.items.length - a.items.length) : (b.last - a.last); });
  }
  function assetRows() {
    var q = S.q.trim().toLowerCase();
    return Object.keys(S.byAsset).map(function (k) { return S.byAsset[k]; })
      .filter(function (a) {
        if (q && (a.name + ' ' + (a.id || '')).toLowerCase().indexOf(q) < 0) return false;
        if (S.days && !inPeriod(new Date(a.last).toISOString())) return false;
        if (S.role !== 'ALL' && !a.items.some(function (x) { return x.role === S.role; })) return false;
        return true;
      })
      .sort(function (a, b) { return S.sort === 'count' ? (b.items.length - a.items.length) : (b.last - a.last); });
  }
  function rawRows() {
    var q = S.q.trim().toLowerCase();
    return S.logs.filter(function (l) {
      var p = l._p || parseLog(l);
      if (S.role !== 'ALL' && p.role !== S.role) return false;
      if (S.days && !inPeriod(p.ts)) return false;
      if (q) {
        var hay = [p.name, p.company, p.action, p.detail, p.assetName].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function trRows() {
    var q = S.q.trim().toLowerCase();
    return (S.lois || []).filter(function (it) {
      var isTr = /^TR-/i.test(String(it.asset_id || '')) || String(it.memo || '').indexOf('[TR') === 0;
      if (!isTr) return false;
      if (S.days && !inPeriod(it.timestamp)) return false;
      if (q) {
        var hay = [it.company, it.name, it.asset_name, it.memo].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  /* ───────────────────── 렌더 ───────────────────── */

  var SUBS = [
    { k: 'visitor', l: '👤 방문자별' },
    { k: 'asset', l: '🏢 물건별' },
    { k: 'raw', l: '📜 전체 로그' },
    { k: 'tr', l: '📋 TR 접수' },
    { k: 'ext', l: '🔐 세션·신규컨택' }
  ];

  function renderShell() {
    var host = $('#adminView');
    if (!host) return;
    var html = '';
    html += '<div class="ad-wrap">';
    html += '<div class="ad-head">';
    html += '<div class="ad-title"><h1>🛰️ 관리자 · 접속 로그</h1>' +
      '<p>누가 언제 어떤 물건을 봤는지 — 방문자별 · 물건별로 추적합니다. (access_logs 최근 500건 기준)<br>' +
      '사람별 탭·데이터 범위 권한, 개인 접속코드, 게스트 초대 링크는 상단 <b>🔐 사람별 권한 · 주소록</b>에서 줍니다.</p></div>';
    html += '<div class="ad-tools">' +
      '<button type="button" class="btn btn-primary" id="adAcl">🔐 사람별 권한 · 주소록</button>' +
      '<button type="button" class="btn btn-ghost" id="adRefresh">↻ 새로고침</button>' +
      '<button type="button" class="btn btn-outline" id="adCsv">CSV 내보내기</button>' +
      '</div></div>';
    html += '<div id="adKpi" class="ad-kpi"></div>';
    html += '<div class="ad-bar">';
    html += '<div class="ad-subs">' + SUBS.map(function (s) {
      return '<button type="button" class="ad-sub' + (S.sub === s.k ? ' is-active' : '') + '" data-ad-sub="' + s.k + '">' + s.l + '</button>';
    }).join('') + '</div>';
    html += '<div class="ad-filters">';
    html += '<input id="adQ" type="search" data-enter="search" placeholder="검색 — 방문자 · 회사 · 물건명 · 동작" value="' + esc(S.q) + '" autocomplete="off">';
    html += '<select id="adRole">' +
      ['ALL', 'admin', 'internal', 'external'].map(function (r) {
        return '<option value="' + r + '"' + (S.role === r ? ' selected' : '') + '>' + (r === 'ALL' ? '권한 전체' : roleLabel(r)) + '</option>';
      }).join('') + '</select>';
    html += '<select id="adDays">' +
      [[0, '기간 전체'], [1, '오늘'], [7, '최근 7일'], [30, '최근 30일']].map(function (d) {
        return '<option value="' + d[0] + '"' + (S.days === d[0] ? ' selected' : '') + '>' + d[1] + '</option>';
      }).join('') + '</select>';
    html += '<select id="adSort">' +
      [[ 'recent', '최근순' ], [ 'count', '건수순' ]].map(function (d) {
        return '<option value="' + d[0] + '"' + (S.sort === d[0] ? ' selected' : '') + '>' + d[1] + '</option>';
      }).join('') + '</select>';
    html += '<span id="adNote" class="ad-note"></span>';
    html += '</div></div>';
    html += '<div id="adBody" class="ad-body"></div>';
    html += '</div>';
    host.innerHTML = html;
    S.built = true;

    $('#adRefresh').addEventListener('click', function () { load(true); });
    $('#adCsv').addEventListener('click', exportCsv);
    var adAcl = $('#adAcl');
    if (adAcl) adAcl.addEventListener('click', openAclModal);
    var adQ = $('#adQ');
    adQ.addEventListener('input', function (e) { S.q = e.target.value; render(); });
    adQ.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      S.q = adQ.value;
      render();
      var n = $('#adQ');
      if (n) { if (window.innerWidth <= 900) n.blur(); else { try { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } catch (e1) { /* noop */ } } }
    });
    $('#adRole').addEventListener('change', function (e) { S.role = e.target.value; render(); });
    $('#adDays').addEventListener('change', function (e) { S.days = Number(e.target.value) || 0; render(); });
    $('#adSort').addEventListener('change', function (e) { S.sort = e.target.value; render(); });
    host.addEventListener('click', onClick);
    host.addEventListener('change', onStatusChange);
    render();
  }

  function onClick(e) {
    var rv = e.target.closest('[data-ad-review]');
    if (rv) {
      if (window.NAI_TRREVIEW) window.NAI_TRREVIEW.open();
      else toast('매칭 검토 모듈을 불러오지 못했습니다.', true);
      return;
    }
    var sub = e.target.closest('[data-ad-sub]');
    if (sub) {
      S.sub = sub.getAttribute('data-ad-sub');
      S.assetFocus = null;
      $$('.ad-sub', $('#adminView')).forEach(function (b) { b.classList.toggle('is-active', b === sub); });
      if (S.sub === 'ext') loadExt();
      if (S.sub === 'tr') loadLois();
      render();
      return;
    }
    var exp = e.target.closest('[data-ad-exp]');
    if (exp) {
      var k = exp.getAttribute('data-ad-exp');
      S.expand[k] = !S.expand[k];
      render();
      return;
    }
    var openAsset = e.target.closest('[data-ad-open]');
    if (openAsset) {
      var id = openAsset.getAttribute('data-ad-open');
      if (window.naiShowView) window.naiShowView('map');
      if (window.naiMap && window.naiMap.select) window.naiMap.select(id);
      return;
    }
  }

  /* TR 접수 상태 변경 (select) */
  function onStatusChange(e) {
    var sel = e.target.closest('[data-ad-tr-status]');
    if (!sel) return;
    var id = sel.getAttribute('data-ad-tr-status');
    var stt = sel.value;
    sel.disabled = true;
    apiPost({ action: 'submission_status', kind: 'lois', id: id, status: stt }).then(function (j) {
      sel.disabled = false;
      if (j && j.ok) {
        (S.lois || []).forEach(function (x) { if (x.id === id) x.status = stt; });
        toast('상태를 “' + stt + '”(으)로 바꿨습니다.');
      } else {
        toast('변경 실패: ' + ((j && j.error) || '오류'), true);
      }
    }).catch(function () { sel.disabled = false; toast('변경 실패(네트워크)', true); });
  }

  function renderKpi() {
    var host = $('#adKpi');
    if (!host) return;
    var tr = trRows().length;
    host.innerHTML = [
      ['기록', nfmt(S.logs.length) + '건', 'access_logs 최근'],
      ['방문자', nfmt(S.visitorCount || 0) + '명', '열람 기록 기준'],
      ['열람 물건', nfmt(S.assetCount || 0) + '건', '물건별 이력'],
      ['물건 열람', nfmt(S.viewCount || 0) + '회', '상세·IM·밸류·등기'],
      ['TR 접수', S.lois ? nfmt(tr) + '건' : '—', S.lois ? '임차의뢰' : '탭 열면 조회']
    ].map(function (k) {
      return '<div class="ad-k"><span>' + esc(k[0]) + '</span><strong>' + esc(k[1]) + '</strong><em>' + esc(k[2]) + '</em></div>';
    }).join('');
  }

  function render() {
    if (!S.built) { renderShell(); return; }
    renderKpi();
    var host = $('#adBody');
    if (!host) return;
    if (!S.loaded && S.loading) { host.innerHTML = '<p class="ad-empty">로그를 불러오는 중…</p>'; return; }
    if (!S.loaded) { host.innerHTML = '<p class="ad-empty">' + esc(S.note || '로그를 불러오지 못했습니다.') + '</p>'; return; }

    if (S.sub === 'visitor') host.innerHTML = renderVisitor();
    else if (S.sub === 'asset') host.innerHTML = renderAsset();
    else if (S.sub === 'raw') host.innerHTML = renderRaw();
    else if (S.sub === 'tr') {
      host.innerHTML = renderTr();
      /* TR 접수 목록 — 더블클릭 또는 ⤢ 로 확대 (2026-11-28) */
      if (window.OAAB_GROW) {
        var tc = host.querySelector('.ad-trwrap');
        if (tc) window.OAAB_GROW.attach(tc, { head: '.ad-trhead', mode: 'panel' });
      }
    }
    else if (S.sub === 'ext') host.innerHTML = renderExt();
  }

  function renderVisitor() {
    var rows = visitorRows();
    if (!rows.length) return '<p class="ad-empty">조건에 맞는 열람 이력이 없습니다. (물건 상세·IM·밸류에이션을 열면 기록됩니다)</p>';
    var html = '<div class="ad-hint">방문자별 — 누가 · 언제 · 어떤 물건을 · 어떻게(상세/IM/밸류에이션/등기) 봤는지. 행을 누르면 이력이 펼쳐집니다.</div>';
    html += '<div class="ad-list">';
    rows.forEach(function (v) {
      var open = !!S.expand[v.key];
      var uniq = Object.keys(v.assets).length;
      html += '<div class="ad-row' + (open ? ' is-open' : '') + '">';
      html += '<button type="button" class="ad-row-main" data-ad-exp="' + esc(v.key) + '">';
      html += '<span class="ad-role ' + roleCls(v.role) + '">' + esc(roleLabel(v.role)) + '</span>';
      html += '<span class="ad-who"><strong>' + esc(v.name) + '</strong><em>' + esc(v.company || '—') + '</em></span>';
      html += '<span class="ad-cnt">' + nfmt(v.items.length) + '회 · 물건 ' + nfmt(uniq) + '건</span>';
      html += '<span class="ad-when">' + esc(fmtTime(new Date(v.last).toISOString())) + '</span>';
      html += '<span class="ad-caret">' + (open ? '▾' : '▸') + '</span>';
      html += '</button>';
      if (open) {
        html += '<div class="ad-detail"><table class="ad-table"><thead><tr><th>시각</th><th>물건</th><th>동작</th><th></th></tr></thead><tbody>';
        v.items.slice().sort(function (a, b) { return tsOf(b.ts) - tsOf(a.ts); }).forEach(function (it) {
          html += '<tr><td>' + esc(fmtTime(it.ts)) + '</td><td>' + esc(it.assetName || '(미상)') + '</td>' +
            '<td><span class="ad-act">' + esc(ACT_LABEL[it.act] || it.act || '상세') + '</span></td>' +
            '<td>' + (it.assetId ? '<button type="button" class="mini-btn" data-ad-open="' + esc(it.assetId) + '">물건 열기</button>' : '') + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderAsset() {
    var rows = assetRows();
    if (!rows.length) return '<p class="ad-empty">조건에 맞는 물건 이력이 없습니다.</p>';
    if (S.assetFocus) {
      rows.sort(function (a, b) { return (b.key === S.assetFocus ? 1 : 0) - (a.key === S.assetFocus ? 1 : 0); });
      S.expand[S.assetFocus] = true;
    }
    var html = '<div class="ad-hint">물건(딜)별 — 특정 물건을 누가 몇 번 봤는지. 행을 누르면 방문자·시각·동작이 펼쳐집니다.</div>';
    html += '<div class="ad-list">';
    rows.forEach(function (a) {
      var open = !!S.expand[a.key];
      var uniq = Object.keys(a.visitors).length;
      html += '<div class="ad-row' + (open ? ' is-open' : '') + (a.key === S.assetFocus ? ' is-focus' : '') + '">';
      html += '<button type="button" class="ad-row-main" data-ad-exp="' + esc(a.key) + '">';
      html += '<span class="ad-who"><strong>' + esc(a.name) + '</strong><em>' + esc(a.id || 'ID 미상') + '</em></span>';
      html += '<span class="ad-cnt">' + nfmt(a.items.length) + '회 · 방문자 ' + nfmt(uniq) + '명</span>';
      html += '<span class="ad-when">' + esc(fmtTime(new Date(a.last).toISOString())) + '</span>';
      html += '<span class="ad-caret">' + (open ? '▾' : '▸') + '</span>';
      html += '</button>';
      if (open) {
        html += '<div class="ad-detail"><table class="ad-table"><thead><tr><th>시각</th><th>방문자</th><th>권한</th><th>동작</th></tr></thead><tbody>';
        a.items.slice().sort(function (x, y) { return tsOf(y.ts) - tsOf(x.ts); }).forEach(function (it) {
          html += '<tr><td>' + esc(fmtTime(it.ts)) + '</td><td>' + esc(it.name || '—') + (it.company ? ' · ' + esc(it.company) : '') + '</td>' +
            '<td><span class="ad-role ' + roleCls(it.role) + '">' + esc(roleLabel(it.role)) + '</span></td>' +
            '<td><span class="ad-act">' + esc(ACT_LABEL[it.act] || it.act || '상세') + '</span></td></tr>';
        });
        html += '</tbody></table>' +
          (a.id ? '<div class="ad-drow"><button type="button" class="mini-btn" data-ad-open="' + esc(a.id) + '">🗺️ 지도·상세 열기</button></div>' : '') +
          '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderRaw() {
    var rows = rawRows();
    if (!rows.length) return '<p class="ad-empty">조건에 맞는 로그가 없습니다.</p>';
    var html = '<div class="ad-hint">전체 로그 — 접속·조회·열람·접수·AI 매칭·TR 이벤트를 시간 역순으로. (최대 500건)</div>';
    html += '<div class="ad-tablewrap"><table class="ad-table ad-raw"><thead><tr>' +
      '<th>시각</th><th>권한</th><th>방문자</th><th>회사</th><th>이벤트</th><th>내용</th></tr></thead><tbody>';
    rows.forEach(function (l) {
      var p = l._p || parseLog(l);
      html += '<tr><td class="nowrap">' + esc(fmtFull(p.ts)) + '</td>' +
        '<td><span class="ad-role ' + roleCls(p.role) + '">' + esc(roleLabel(p.role)) + '</span></td>' +
        '<td>' + esc(p.name || '—') + '</td><td>' + esc(p.company || '—') + '</td>' +
        '<td><code>' + esc(p.action) + '</code></td>' +
        '<td class="ad-det">' + esc(p.assetName ? (p.assetName + ' · ' + (ACT_LABEL[p.act] || p.act)) : p.detail) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function renderTr() {
    if (!S.lois) { loadLois(); return '<p class="ad-empty">TR 접수를 불러오는 중…</p>'; }
    var rows = trRows();
    if (!rows.length) return '<p class="ad-empty">접수된 TR(임차의뢰)이 없습니다. <b>홈 › 🧾 업무 신청 › TR 신청</b> 또는 AI 매칭 결과의 <b>📋 TR</b> 버튼으로 들어옵니다.</p>';
    var html = '<div class="ad-trwrap">' +
      '<div class="ad-trhead"><b>📋 TR 접수 목록</b>' +
      '<span>확대하면 폭과 함께 행 높이·글자 크기가 커집니다 — 더블클릭 또는 ⤢</span>' +
      '<button type="button" class="mini-btn" data-ad-review="1" title="접수 → AI 후보 → 관리자 승인 → 담당자 연결 → 요청자 전달">🧠 매칭 검토</button></div>' +
      '<div class="ad-hint">TR 접수 — 외부 화주·임차인의 임차 의뢰. 상태를 바꾸면 비공개 시트(lois)에 반영됩니다.</div>';
    html += '<div class="ad-tablewrap"><table class="ad-table"><thead><tr>' +
      '<th>접수</th><th>요청</th><th>거래</th><th>면적</th><th>임대료·예산</th><th>시기</th><th>회사·담당</th><th>연락처</th><th>상태</th></tr></thead><tbody>';
    rows.forEach(function (it) {
      var st = String(it.status || '접수');
      html += '<tr><td class="nowrap">' + esc(fmtTime(it.timestamp)) + '</td>' +
        '<td><b>' + esc(it.asset_name || '') + '</b><div class="ad-det">' + esc(String(it.memo || '').slice(0, 120)) + '</div></td>' +
        '<td>' + esc(it.deal_type || '') + '</td><td>' + esc(it.area_py || '—') + '</td>' +
        '<td>' + esc(it.rent || it.price || '—') + '</td><td>' + esc(it.timeline || '—') + '</td>' +
        '<td>' + esc(it.company || '') + '<div class="ad-det">' + esc([it.name, it.title].filter(Boolean).join(' · ')) + '</div></td>' +
        '<td class="nowrap">' + esc(it.phone || '—') + '</td>' +
        '<td><select class="ad-st" data-ad-tr-status="' + esc(it.id) + '">' +
        ['접수', '검토중', '후보제시', '매칭완료', '종결'].map(function (x) {
          return '<option value="' + x + '"' + (st === x ? ' selected' : '') + '>' + x + '</option>';
        }).join('') + '</select></td></tr>';
    });
    html += '</tbody></table></div>';
    html += '</div>'; /* ad-trwrap */
    return html;
  }

  function renderExt() {
    var html = '';
    html += '<div class="ad-hint">외부 방문자 세션(ext_sessions)과 신규 컨택(new_contacts) — 명함 인증·신규 등록으로 발급된 접근 기록.</div>';
    if (!S.extLoaded) { loadExt(); html += '<p class="ad-empty">불러오는 중…</p>'; return html; }
    html += '<h4 class="ad-h4">🔐 외부 세션 (' + nfmt((S.sessions || []).length) + ')</h4>';
    if (!(S.sessions || []).length) html += '<p class="ad-empty">발급된 외부 세션이 없습니다.</p>';
    else {
      html += '<div class="ad-tablewrap"><table class="ad-table"><thead><tr><th>발급</th><th>성명</th><th>회사</th><th>경로</th><th>만료</th><th>최근</th></tr></thead><tbody>';
      S.sessions.forEach(function (s) {
        html += '<tr><td class="nowrap">' + esc(fmtTime(s.issued_at)) + '</td><td>' + esc(s.name || '—') + '</td><td>' + esc(s.company || '—') + '</td>' +
          '<td>' + esc(s.source || '—') + '</td><td class="nowrap">' + esc(fmtTime(s.expires_at)) + '</td><td class="nowrap">' + esc(fmtTime(s.last_seen)) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '<h4 class="ad-h4">🆕 신규 컨택 (' + nfmt((S.contactsRows || []).length) + ')</h4>';
    if (!(S.contactsRows || []).length) html += '<p class="ad-empty">신규 등록한 외부 방문자가 없습니다.</p>';
    else {
      html += '<div class="ad-tablewrap"><table class="ad-table"><thead><tr><th>일시</th><th>성명</th><th>회사</th><th>직책</th><th>연락처</th><th>이메일</th><th>관심</th><th>친추</th></tr></thead><tbody>';
      S.contactsRows.forEach(function (c) {
        html += '<tr><td class="nowrap">' + esc(fmtTime(c.timestamp)) + '</td><td>' + esc(c.name || '') + '</td><td>' + esc(c.company || '') + '</td>' +
          '<td>' + esc(c.title || '') + '</td><td>' + esc(c.phone || '') + '</td><td>' + esc(c.email || '') + '</td>' +
          '<td>' + esc(c.interest_sector || '') + '</td><td>' + esc(c.remember_checked || '') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    return html;
  }

  /* ───────────────────── 내보내기 ───────────────────── */

  function exportCsv() {
    var rows;
    if (S.sub === 'visitor') { rows = visitorRows(); }
    else if (S.sub === 'asset') rows = assetRows();
    else if (S.sub === 'tr') rows = trRows();
    else rows = rawRows().map(function (l) { return l._p || parseLog(l); });

    var head, lines = [];
    var cell = function (v) {
      var s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    if (S.sub === 'visitor') {
      head = ['권한', '방문자', '회사', '열람횟수', '물건수', '마지막'];
      rows.forEach(function (v) {
        lines.push([roleLabel(v.role), v.name, v.company, v.items.length, Object.keys(v.assets).length, fmtFull(new Date(v.last).toISOString())]);
      });
    } else if (S.sub === 'asset') {
      head = ['물건', 'ID', '열람횟수', '방문자수', '마지막'];
      rows.forEach(function (a) {
        lines.push([a.name, a.id || '', a.items.length, Object.keys(a.visitors).length, fmtFull(new Date(a.last).toISOString())]);
      });
    } else if (S.sub === 'tr') {
      head = ['접수', '요청', '거래', '면적', '임대료·예산', '시기', '회사', '담당', '연락처', '상태'];
      rows.forEach(function (it) {
        lines.push([fmtFull(it.timestamp), it.asset_name, it.deal_type, it.area_py, it.rent || it.price, it.timeline, it.company, it.name, it.phone, it.status]);
      });
    } else {
      head = ['시각', '권한', '방문자', '회사', '이벤트', '물건', '동작', '내용'];
      rows.forEach(function (p) { lines.push([fmtFull(p.ts), roleLabel(p.role), p.name, p.company, p.action, p.assetName, p.act, p.detail]); });
    }
    var csv = '\uFEFF' + head.map(cell).join(',') + '\r\n' + lines.map(function (r) { return r.map(cell).join(','); }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    a.href = url;
    a.download = 'NAI_접속로그_' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '_' + S.sub + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
    toast('CSV로 내보냈습니다.');
  }

  /* ───────────────────── 공개 인터페이스 ───────────────────── */

  var sessionViews = {};
  function noteView(assetId) {
    if (!assetId) return;
    sessionViews[assetId] = (sessionViews[assetId] || 0) + 1;
  }
  function countFor(assetId) {
    if (!assetId) return 0;
    var n = 0;
    var a = S.byAsset[assetId];
    if (a) n = a.items.length;
    else {
      /* id 없이 이름만 남은 legacy 기록 */
      var st = window.naiMap && window.naiMap.state;
      var nm = st && st.index && st.index[assetId] ? st.index[assetId].name : '';
      if (nm) { var g = S.byAsset['name:' + nm]; n = g ? g.items.length : 0; }
    }
    return Math.max(n, sessionViews[assetId] || 0);
  }
  function recentFor(assetId, n) {
    var a = S.byAsset[assetId];
    if (!a) return [];
    return a.items.slice().sort(function (x, y) { return tsOf(y.ts) - tsOf(x.ts); }).slice(0, n || 3);
  }

  function show(assetId) {
    if (!isAdmin()) { toast('관리자 전용 화면입니다.', true); if (window.naiShowView) window.naiShowView('home'); return; }
    if (!S.built) renderShell();
    if (assetId) {
      S.sub = 'asset';
      S.assetFocus = assetId;
      S.expand = {}; S.expand[assetId] = true;
      var st = window.naiMap && window.naiMap.state;
      var a = st && st.index ? st.index[assetId] : null;
      if (a) { /* 이름만 남은 기록도 함께 보이도록 검색어는 비워 둔다 */ }
      $$('.ad-sub', $('#adminView')).forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-ad-sub') === 'asset');
      });
    }
    loadExt(false);
    load(false).then(function () { if (assetId && S.loaded) render(); });
    render();
  }

  function prefetch() {
    if (!isAdmin()) return;
    load(false);
  }

  window.NAI_LOGS = {
    show: show,
    load: load,
    prefetch: prefetch,
    openAcl: openAclModal,
    countFor: countFor,
    noteView: noteView,
    recentFor: recentFor,
    isReady: function () { return S.loaded; }
  };
})();
