/* =========================================================================
   Open AI Asset Bridge — 🏢 NAI 매각·LM 탭 (2026-11-24 신설)
   -------------------------------------------------------------------------
   · assets 시트에서 source 가 'NAI 매각·LM' 으로 시작하는 물건만 모아 보여 줍니다.
     (지도 탭의 '물건 구분 → 🏢 NAI 매각·LM' 칩과 같은 기준)
   · 매각 IM/Flyer·LM Flyer 로 확보한 물건 + 월요회의·팀장회의 자료를 연결합니다.
   · 🔒 팀장회의 영역은 '비공개' 아티클(articles, status='비공개')만 읽습니다.
     서버(Apps Script homeGet_)가 role !== 'admin' 이면 비공개 글을 응답에서 지우므로,
     내부(nai2026)·외부(리멤버) 권한에서는 데이터 자체가 내려오지 않습니다.
     이 파일에는 팀장회의 내용이 한 줄도 들어 있지 않습니다.
   ========================================================================= */
(function () {
  'use strict';

  var TAG = 'NAI 매각·LM';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var CFG = window.NAI_MAP_CONFIG || {};
  var SYNC_URL = CFG.SYNC_URL || '';

  var S = {
    q: '', kind: 'ALL', sector: 'ALL', sort: 'kind',
    teams: [], weekly: [], loaded: false, loading: false, err: '', open: {}
  };
  /** 어느 토큰으로 팀장회의 데이터를 받았는지 기록 — 권한이 바뀌면 반드시 버린다 */
  var loadedToken = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }
  function assets() {
    var st = window.naiMap && window.naiMap.state;
    return (st && st.assets) ? st.assets : [];
  }
  function token() {
    try { return localStorage.getItem((CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1') || ''; } catch (e) { return ''; }
  }
  function apiGet(qs) {
    if (!SYNC_URL) return Promise.reject(new Error('no_sync'));
    var u = SYNC_URL + (SYNC_URL.indexOf('?') < 0 ? '?' : '&') + qs + '&token=' + encodeURIComponent(token());
    return fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function toast(msg, err) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.background = err ? '#b3262c' : '';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.add('hidden'); el.style.background = ''; }, 3000);
  }

  function isNai(a) { return !!a && String(a.source || '').indexOf(TAG) === 0; }
  function fact(a, label) {
    var fs = (a && a.facts) || [];
    for (var i = 0; i < fs.length; i++) if (String(fs[i].label) === label) return String(fs[i].value || '');
    return '';
  }
  function naiKind(a) {
    var k = fact(a, 'NAI 구분');
    if (/LM/.test(k) && /매각/.test(k)) return '매각·LM';
    if (/LM/.test(k)) return 'LM';
    if (/참고/.test(k)) return '참고';
    if (/개발/.test(k)) return '개발';
    return '매각';
  }
  var SECTOR_LABEL = {
    hotel: '호텔', logistics: '물류', office: '오피스', datacenter: '데이터센터',
    retail: '리테일', living: '리빙', land: '토지·개발', shipper: '화주'
  };
  function sectorLabel(k) { return SECTOR_LABEL[k] || k || '기타'; }

  /* ───────────────── 데이터 ─────────────────
     🔒 팀장회의·월요회의는 '비공개' 아티클(관리자 응답에만 포함)로만 받습니다.
     관리자가 아닌 권한에서는 아예 요청하지 않고, 권한이 바꾸면 받아 둔 것을 즉시 버립니다. */
  function clearTeam() {
    S.teams = [];
    S.weekly = [];
    S.loaded = false;
    S.loading = false;
    loadedToken = null;
    buildTeamIndex();
  }

  function loadTeam(force) {
    var tk = token();
    if (!tk || role() !== 'admin') { clearTeam(); return Promise.resolve(false); }
    if (loadedToken !== tk) { S.teams = []; S.weekly = []; S.loaded = false; }
    if (S.loading) return Promise.resolve();
    if (S.loaded && loadedToken === tk && !force) return Promise.resolve();
    S.loading = true;
    return apiGet('type=articles').then(function (j) {
      S.loading = false;
      S.loaded = true;
      loadedToken = tk;
      var items = (j && j.items) || [];
      S.teams = [];
      S.weekly = [];
      items.forEach(function (it) {
        var tags = String(it.tags || '');
        if (tags.indexOf('팀장회의') >= 0) {
          var b = {}, raw = false;
          try { b = JSON.parse(it.body || '{}'); } catch (e) { b = { text: String(it.body || '') }; raw = true; }
          if (!b || typeof b !== 'object' || (!b.text && !b.section)) { b = { text: String(it.body || '') }; raw = true; }
          /* 본문이 JSON 이 아닌 요약 원문(오래된 회의록)은 카드에 전문을 붙이지 않고 모달로 */
          var long = raw && String(b.text || '').length > 400;
          S.teams.push({
            id: it.id, date: it.date || '', title: it.title || '', summary: it.summary || '',
            section: b.section || '', speaker: b.speaker || '', due: b.due || '',
            state: b.state || '', asset: b.asset || '', raw: long,
            text: long ? String(b.text || '').slice(0, 200) + '…' : (b.text || ''),
            full: long ? String(b.text || '') : ''
          });
        } else if (tags.indexOf('월요회의') >= 0) {
          S.weekly.push({ id: it.id, date: it.date || '', title: it.title || '', body: it.body || '' });
        }
      });
      buildTeamIndex();
      return true;
    }).catch(function () { S.loading = false; S.loaded = true; return false; });
  }

  /** 지도·목록에서 쓸 수 있게 물건별 팀장회의 개수를 노출 (관리자 응답에만 존재) */
  function buildTeamIndex() {
    var byAsset = {};
    S.teams.forEach(function (t) { if (t.asset) byAsset[t.asset] = (byAsset[t.asset] || 0) + 1; });
    window.NAI_TEAM = { items: S.teams, byAsset: byAsset, ready: true };
    document.body.classList.toggle('has-team', S.teams.length > 0);
    /* 지도·목록 배지(🔒)를 다시 그린다 — 팀장회의 응답은 로그인 후 비동기로 도착 */
    if (window.naiMap && window.naiMap.reload && window.naiMap.state && window.naiMap.state.assets && window.naiMap.state.assets.length) {
      try { window.naiMap.reload(); } catch (e) { /* noop */ }
    }
  }

  /* ───────────── 필터 ───────────── */
  function list() {
    var q = S.q.trim().toLowerCase();
    return assets().filter(isNai).filter(function (a) {
      if (S.kind !== 'ALL' && naiKind(a) !== S.kind) return false;
      if (S.sector !== 'ALL' && a.sector !== S.sector) return false;
      if (!q) return true;
      var hay = [a.name, a.address, a.owner_amc, a.tenants, a.notes, a.scale_info, a.price_info, a.sub_type, a.region]
        .concat((a.facts || []).map(function (f) { return f.label + ' ' + f.value; })).join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    }).sort(function (x, y) {
      if (S.sort === 'kind') {
        var order = { '매각': 1, '매각·LM': 2, 'LM': 3, '개발': 4, '참고': 9 };
        var d = (order[naiKind(x)] || 5) - (order[naiKind(y)] || 5);
        if (d) return d;
      }
      if (S.sort === 'price') {
        var px = parseFloat(String(x.price_info || '').replace(/[^\d.]/g, '')) || 0;
        var py = parseFloat(String(y.price_info || '').replace(/[^\d.]/g, '')) || 0;
        if (px !== py) return py - px;
      }
      return String(x.name || '').localeCompare(String(y.name || ''), 'ko');
    });
  }

  /* ───────────── 렌더 ───────────── */
  function headerHTML(all) {
    var sale = all.filter(function (a) { var k = naiKind(a); return k === '매각' || k === '매각·LM' || k === '개발'; }).length;
    var lm = all.filter(function (a) { var k = naiKind(a); return k === 'LM' || k === '매각·LM'; }).length;
    var ref = all.filter(function (a) { return naiKind(a) === '참고'; }).length;
    var team = S.teams.length;
    return '<div class="nai-head"><div class="nai-title"><h2>🏢 NAI 매각·LM</h2>' +
      '<p>NAI Korea 가 실제로 매각·임대 주관하는 물건입니다. 매각안내문(IM)·Flyer 로 확보한 스펙과 ' +
      '가격·임대조건을 그대로 담았고, 물건을 누르면 섹터별 밸류에이션 계산기가 열립니다.</p>' +
      '<p class="nai-meta">매각·개발 ' + sale + '건 · LM ' + lm + '건' + (ref ? ' · 참고 ' + ref + '건' : '') + ' · 자료 2026-11-24 동기화' +
      (isAdmin() ? ' · <b class="team-flag">🔒 팀장회의 ' + team + '건</b>' : '') + '</p></div>' +
      '<div class="nai-tools">' +
      '<label class="nai-search"><span aria-hidden="true">⌕</span><input id="naiSearch" type="search" placeholder="물건명 · 주소 · 매도인 검색" value="' + esc(S.q) + '"></label>' +
      '<button type="button" class="btn btn-ghost" id="naiRefresh">↻ 새로고침</button>' +
      (isAdmin() ? '<button type="button" class="btn btn-ghost" id="naiTeamJump">🔒 팀장회의</button>' : '') +
      '</div></div>';
  }

  function chipsHTML() {
    var kinds = [['ALL', '전체'], ['매각', '매각'], ['LM', 'LM(임대)'], ['개발', '개발'], ['참고', '참고자료']];
    var sectors = ['ALL'].concat(Object.keys(SECTOR_LABEL).filter(function (k) {
      return assets().some(function (a) { return isNai(a) && a.sector === k; });
    }));
    return '<div class="nai-filters">' +
      '<div class="chip-wrap">' + kinds.map(function (k) {
        return '<button type="button" class="pf-chip' + (S.kind === k[0] ? ' on' : '') + '" data-nai-kind="' + k[0] + '">' + k[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="chip-wrap">' + sectors.map(function (k) {
        return '<button type="button" class="pf-chip' + (S.sector === k ? ' on' : '') + '" data-nai-sector="' + k + '">' + (k === 'ALL' ? '섹터 전체' : sectorLabel(k)) + '</button>';
      }).join('') + '</div>' +
      '<span class="nai-sort">정렬 <button type="button" class="mini-btn' + (S.sort === 'kind' ? ' on' : '') + '" data-nai-sort="kind">구분</button>' +
      '<button type="button" class="mini-btn' + (S.sort === 'price' ? ' on' : '') + '" data-nai-sort="price">가격</button>' +
      '<button type="button" class="mini-btn' + (S.sort === 'name' ? ' on' : '') + '" data-nai-sort="name">이름</button></span>' +
      '</div>';
  }

  function cardHTML(a) {
    var kind = naiKind(a);
    var tcount = (window.NAI_TEAM && window.NAI_TEAM.byAsset[a.id]) || 0;
    var facts = (a.facts || []).filter(function (f) {
      return ['NAI 구분', 'NAI 상태'].indexOf(String(f.label)) < 0 && String(f.label).indexOf('§') !== 0;
    });
    var key = ['규모', '희망매각가', '가격', '임대조건', '투자 구조', '매각가', '임차·운영', '도입', ' 컨버전 규모', '재분석 결론', '공시지가', '개별공시지가', '부지', '개발', '모집 규모'];
    var picks = [];
    key.forEach(function (lbl) {
      var v = fact(a, lbl);
      if (v && picks.length < 4) picks.push([lbl, v]);
    });
    var rows = picks.map(function (r) {
      return '<div class="nc-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>';
    }).join('');
    return '<article class="nai-card' + (kind === '참고' ? ' is-ref' : '') + '" data-nai-card="' + esc(a.id) + '">' +
      '<div class="nc-top"><span class="nc-kind ' + esc(kind.replace('·', '')) + '">' + esc(kind) + '</span>' +
      '<span class="nc-sector">' + esc(sectorLabel(a.sector)) + '</span>' +
      (tcount ? '<span class="nc-team" title="팀장회의에서 다룬 물건">🔒 팀장회의 ' + tcount + '</span>' : '') +
      '</div>' +
      '<h3 class="nc-name">' + esc(a.name) + '</h3>' +
      '<p class="nc-addr">' + esc(a.address || '') + '</p>' +
      '<div class="nc-rows">' + rows + '</div>' +
      '<p class="nc-state">' + esc(a.status || '') + '</p>' +
      '<div class="nc-foot">' + esc(a.owner_amc || '') + '</div>' +
      '<div class="nc-acts">' +
      '<button type="button" class="mini-btn act" data-nai-val="' + esc(a.id) + '">📊 밸류에이션</button>' +
      '<button type="button" class="mini-btn act" data-nai-im="' + esc(a.id) + '">📘 IM 프리뷰</button>' +
      '<button type="button" class="mini-btn act" data-nai-map="' + esc(a.id) + '">🗺 지도</button>' +
      '<button type="button" class="mini-btn act" data-nai-open="' + esc(a.id) + '">상세</button>' +
      '</div></article>';
  }

  function teamSectionHTML() {
    if (!S.teams.length) return '';
    var groups = {};
    S.teams.forEach(function (t) { (groups[t.date] = groups[t.date] || []).push(t); });
    var dates = Object.keys(groups).sort().reverse();
    var html = '<section class="nai-team" id="naiTeamSection">' +
      '<div class="nt-head"><h3>🔒 팀장회의 <span class="nt-lock">관리자 전용</span></h3>' +
      '<p>NAI 내부 팀장회의(화 08:31) 안건·실행항목·수치입니다. 내부용·외부 방문자에게는 서버가 이 데이터를 내려주지 않습니다.</p></div>';
    dates.forEach(function (d) {
      var items = groups[d];
      html += '<div class="nt-date"><span class="nt-d">' + esc(d) + '</span><span class="nt-c">' + items.length + '건</span>' +
        '<button type="button" class="mini-btn" data-nt-toggle="' + esc(d) + '">접기/펼치기</button></div>';
      html += '<div class="nt-grid" data-nt-body="' + esc(d) + '">';
      items.forEach(function (t) {
        var a = t.asset ? (assets().filter(function (x) { return x.id === t.asset; })[0] || null) : null;
        html += '<article class="nt-card"><div class="nt-tags">' +
          (t.section ? '<span class="nt-tag">' + esc(t.section) + '</span>' : '') +
          (t.state ? '<span class="nt-tag state">' + esc(t.state) + '</span>' : '') +
          (t.due ? '<span class="nt-tag due">기한 ' + esc(t.due) + '</span>' : '') + '</div>' +
          '<h4>' + esc(String(t.title).replace(/^\[팀장회의\]\s*/, '')) + '</h4>' +
          '<p>' + esc(t.text) + '</p>' +
          (t.speaker ? '<span class="nt-spk">' + esc(t.speaker) + '</span>' : '') +
          (t.raw ? '<button type="button" class="mini-btn" data-nt-raw="' + esc(t.id) + '">📄 원문 보기</button>' : '') +
          (a ? '<button type="button" class="mini-btn" data-nt-asset="' + esc(a.id) + '">🗂 ' + esc(a.name) + '</button>' : '') +
          '</article>';
      });
      html += '</div>';
    });
    html += '</section>';
    return html;
  }

  function weeklySectionHTML() {
    if (!S.weekly.length) return '';
    var rows = S.weekly.slice().sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); });
    return '<section class="nai-weekly"><h3>📅 월요회의 · 월간회의 자료 (내부)</h3>' +
      '<p class="nw-note">네이버웍스 → Gmail 로 전달받은 7회분. 주간 계약현황·전속계약·매수/임차 홍보·신규 매물 홍보가 담겨 있습니다. 관리자 전용 비공개 자료입니다.</p>' +
      '<div class="nw-list">' + rows.map(function (w) {
        return '<button type="button" class="nw-item" data-nw-open="' + esc(w.id) + '"><span class="nw-d">' + esc(w.date) + '</span>' +
          '<span class="nw-t">' + esc(String(w.title).replace(/^\[[^\]]*\]\s*/, '')) + '</span><span class="nw-o">열기 ↗</span></button>';
      }).join('') + '</div></section>';
  }

  function render() {
    var host = $('#naiView');
    if (!host) return;
    var all = assets().filter(isNai);
    var items = list();
    var html = '<div class="nai-shell">' + headerHTML(all) + chipsHTML();
    if (!all.length) {
      html += '<div class="empty-state">NAI 매각·LM 물건을 불러오는 중입니다. 데이터가 없으면 <b>↻ 새로고침</b>을 눌러 주세요.</div>';
    } else if (!items.length) {
      html += '<div class="empty-state">조건에 맞는 물건이 없습니다.</div>';
    } else {
      html += '<div class="nai-count">' + items.length + '건</div><div class="nai-grid">' + items.map(cardHTML).join('') + '</div>';
    }
    html += teamSectionHTML() + weeklySectionHTML() + '</div>';
    host.innerHTML = html;
    bind();
  }

  function openRaw(id) {
    var t = S.teams.filter(function (x) { return x.id === id; })[0];
    if (!t || !t.full) return;
    var modal = $('#poolModal');
    if (!modal) return;
    modal.innerHTML = '<div class="modal-card wide"><div class="modal-head"><h3>🔒 ' + esc(t.title) + '</h3>' +
      '<button type="button" class="icon-btn" data-close-modal="1">×</button></div><div class="modal-body">' +
      '<div class="read-meta">' + esc(t.date) + ' · 관리자 전용</div>' +
      '<div class="read-body nw-body">' + String(t.full).split(/\n{2,}/).map(function (p) {
        return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
      }).join('') + '</div></div></div>';
    modal.classList.remove('hidden');
  }

  function openWeekly(id) {
    var w = S.weekly.filter(function (x) { return x.id === id; })[0];
    if (!w) return;
    var body = String(w.body || '');
    var html = '<div class="read-meta">' + esc(w.date) + ' · 관리자 전용</div><h2 class="read-title">' + esc(w.title) + '</h2>' +
      '<div class="read-body nw-body">' + body.split(/\n{2,}/).map(function (p) {
        if (/^###/.test(p)) return '<h4>' + esc(p.replace(/^#+\s*/, '')) + '</h4>';
        return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
      }).join('') + '</div>';
    var modal = $('#poolModal');
    if (!modal) return;
    modal.innerHTML = '<div class="modal-card wide"><div class="modal-head"><h3>📅 월요회의 자료</h3>' +
      '<button type="button" class="icon-btn" data-close-modal="1">×</button></div><div class="modal-body">' + html + '</div></div>';
    modal.classList.remove('hidden');
  }

  function bind() {
    var host = $('#naiView');
    if (!host) return;
    var q = $('#naiSearch');
    if (q) {
      var t = null;
      q.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () { S.q = q.value; render(); var n = $('#naiSearch'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 180);
      });
    }
    var rf = $('#naiRefresh');
    if (rf) rf.addEventListener('click', function () { if (window.naiMap && window.naiMap.reload) window.naiMap.reload(); loadTeam(true).then(render); });
    var tj = $('#naiTeamJump');
    if (tj) tj.addEventListener('click', function () {
      var s = $('#naiTeamSection');
      if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    host.addEventListener('click', function (e) {
      var k = e.target.closest('[data-nai-kind]');
      if (k) { S.kind = k.getAttribute('data-nai-kind'); render(); return; }
      var sc = e.target.closest('[data-nai-sector]');
      if (sc) { S.sector = sc.getAttribute('data-nai-sector'); render(); return; }
      var so = e.target.closest('[data-nai-sort]');
      if (so) { S.sort = so.getAttribute('data-nai-sort'); render(); return; }
      var tg = e.target.closest('[data-nt-toggle]');
      if (tg) {
        var d = tg.getAttribute('data-nt-toggle');
        var box = $('[data-nt-body="' + d + '"]', host);
        if (box) box.classList.toggle('hidden');
        return;
      }
      var val = e.target.closest('[data-nai-val]');
      if (val) { openVal(val.getAttribute('data-nai-val')); return; }
      var im = e.target.closest('[data-nai-im]');
      if (im) { openIm(im.getAttribute('data-nai-im')); return; }
      var mp = e.target.closest('[data-nai-map]');
      if (mp) { gotoMap(mp.getAttribute('data-nai-map')); return; }
      var op = e.target.closest('[data-nai-open]');
      if (op) { gotoDetail(op.getAttribute('data-nai-open')); return; }
      var nt = e.target.closest('[data-nt-asset]');
      if (nt) { gotoDetail(nt.getAttribute('data-nt-asset')); return; }
      var nw = e.target.closest('[data-nw-open]');
      if (nw) { openWeekly(nw.getAttribute('data-nw-open')); return; }
      var raw = e.target.closest('[data-nt-raw]');
      if (raw) { openRaw(raw.getAttribute('data-nt-raw')); return; }
      var card = e.target.closest('[data-nai-card]');
      if (card) { gotoDetail(card.getAttribute('data-nai-card')); }
    });
    var modal = $('#poolModal');
    if (modal && !modal._naiBound) {
      modal._naiBound = true;
      modal.addEventListener('click', function (e) {
        if (e.target === modal || e.target.closest('[data-close-modal]')) modal.classList.add('hidden');
      });
    }
  }

  function byId(id) { return assets().filter(function (a) { return a.id === id; })[0] || null; }
  function openVal(id) {
    var a = byId(id);
    if (!a) return;
    if (window.NAI_VAL && window.NAI_VAL.openForAsset) window.NAI_VAL.openForAsset(a);
  }
  function openIm(id) {
    var a = byId(id);
    if (!a) return;
    if (window.NAI_HOME && window.NAI_HOME.brief) window.NAI_HOME.brief(a.id, 'IM');
    else toast('IM 미리보기를 불러오지 못했습니다.', true);
  }
  function gotoMap(id) {
    if (window.naiShowView) window.naiShowView('map');
    if (window.naiMap && window.naiMap.select) window.naiMap.select(id);
  }
  function gotoDetail(id) { gotoMap(id); }

  function show() {
    loadTeam(false).then(function () { render(); });
    render();
  }

  /** 권한 변경·로그아웃 시 호출 — 받아 둔 팀장회의 데이터를 즉시 파기하고 다시 그린다 */
  function reset() {
    clearTeam();
    var host = $('#naiView');
    var visible = host && !host.classList.contains('hidden');
    if (visible) render();
    /* 관리자로 (다시) 들어온 경우에만 비공개 자료를 새로 받는다 */
    if (role() === 'admin' && token()) {
      loadTeam(false).then(function () { if (visible) render(); });
    }
  }

  window.NAI_NAI = { show: show, reset: reset, state: S, isNai: isNai, team: function () { return S.teams; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { loadTeam(false); });
  else loadTeam(false);
})();
