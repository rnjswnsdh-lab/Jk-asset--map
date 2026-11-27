/* =========================================================================
   Open AI Asset Bridge — adminhq.js  (🗂️ NAI 행정 — 팀장·월간 회의록, 2026-11-27)
   -------------------------------------------------------------------------
   팀장회의·월간(월요)회의 기록을 매각·임대(딜) 화면에서 떼어 내 별도 화면으로 둡니다.

   데이터
     GET  ?type=admin        — 비공개 시트 `admin` 탭 (회의록 전용, 관리자 응답에만 포함)
     GET  ?type=articles     — 위 응답이 없을 때의 임시 경로(이관 전 원본이 articles에 있는 경우)
     POST {action:'admin_save', item:{…}}  — `admin` 탭 upsert + 편집 이력(updated_by/edit_log)
     POST {action:'article_save', …}        — admin 액션이 서버에 아직 없을 때의 대체 저장 경로
     POST {action:'log_event', kind:'admin_edit', detail:'id=…|fields=…'} — 수정 이력(access_logs)

   권한
     관리자(role==='admin')만 데이터를 요청합니다. 권한이 바뀌면 받아 둔 배열을 즉시 비웁니다.
     이 파일에는 회의록 내용이 한 줄도 들어 있지 않습니다(전부 서버 응답에서 옵니다).
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var SYNC_URL = CFG.SYNC_URL || '';
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = {
    items: [], loaded: false, loading: false, err: '', src: '',
    q: '', kind: 'ALL', deal: 'ALL', sort: 'recent',
    open: {}, hist: null, histFor: '', built: false
  };
  var loadedToken = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }
  function assets() {
    var st = window.naiMap && window.naiMap.state;
    return (st && st.assets) ? st.assets : [];
  }
  function assetName(id) {
    if (!id) return '';
    var a = assets().filter(function (x) { return x.id === id; })[0];
    return a ? a.name : id;
  }
  function apiGet(qs) {
    if (!SYNC_URL) return Promise.reject(new Error('no_sync'));
    var u = SYNC_URL + (SYNC_URL.indexOf('?') < 0 ? '?' : '&') + qs + '&token=' + encodeURIComponent(token());
    return fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function apiPost(payload) {
    if (!SYNC_URL) return Promise.reject(new Error('no_sync'));
    var body = Object.assign({ token: token() }, payload);
    return fetch(SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }
  function toast(msg, err) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.background = err ? '#b3262c' : '';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.add('hidden'); el.style.background = ''; }, 3200);
  }

  /* ───────────────── 데이터 정규화 ───────────────── */

  function isMeeting(it) {
    var t = String((it && it.tags) || '') + ' ' + String((it && it.kind) || '');
    return t.indexOf('팀장회의') >= 0 || t.indexOf('월요회의') >= 0 || t.indexOf('월간회의') >= 0;
  }

  function norm(it) {
    var b = {}, raw = false;
    try { b = JSON.parse(it.body || '{}'); } catch (e) { b = { text: String(it.body || '') }; raw = true; }
    if (!b || typeof b !== 'object' || (!b.text && !b.section)) { b = { text: String(it.body || '') }; raw = true; }
    var kind = String(it.kind || '');
    if (!kind) kind = (String(it.tags || '').indexOf('팀장회의') >= 0) ? '팀장회의' : '월간회의';
    return {
      id: String(it.id || ''), date: String(it.date || '').slice(0, 10), kind: kind,
      title: String(it.title || ''), summary: String(it.summary || ''),
      section: String(it.section || b.section || ''), speaker: String(it.speaker || b.speaker || ''),
      due: String(it.due || b.due || ''), state: String(it.state || b.state || ''),
      asset: String(it.asset || b.asset || ''),
      dealTags: String(it.deal_tags || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
      tags: String(it.tags || ''),
      text: String(b.text || ''), raw: raw,
      body: String(it.body || ''),
      updated_at: String(it.updated_at || ''), updated_by: String(it.updated_by || ''),
      edit_log: String(it.edit_log || '')
    };
  }

  function clear() {
    S.items = []; S.loaded = false; S.loading = false; loadedToken = null; S.err = ''; S.src = '';
    window.NAI_TEAM = null;
    document.body.classList.remove('has-team');
  }

  function useItems(list, src) {
    S.items = list.map(norm).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    S.loaded = true; S.src = src; S.err = '';
    buildTeamIndex();
  }

  /** 지도·목록의 🔒 배지가 쓸 물건별 팀장회의 개수 */
  function buildTeamIndex() {
    var byAsset = {};
    S.items.forEach(function (t) {
      if (t.kind === '팀장회의' && t.asset) byAsset[t.asset] = (byAsset[t.asset] || 0) + 1;
    });
    window.NAI_TEAM = { items: S.items, byAsset: byAsset, ready: true };
    document.body.classList.toggle('has-team', Object.keys(byAsset).length > 0);
    if (window.naiMap && window.naiMap.reload && window.naiMap.state && window.naiMap.state.assets && window.naiMap.state.assets.length) {
      try { window.naiMap.reload(); } catch (e) { /* noop */ }
    }
  }

  function load(force) {
    if (!isAdmin() || !token()) { clear(); return Promise.resolve(false); }
    var tk = token();
    if (loadedToken && loadedToken !== tk) clear();
    if (S.loading) return Promise.resolve(false);
    if (S.loaded && !force) return Promise.resolve(true);
    S.loading = true;
    if (built()) render();
    return apiGet('type=admin').then(function (j) {
      if (j && j.ok && Array.isArray(j.items)) {
        S.loading = false; loadedToken = tk;
        useItems(j.items.filter(isMeeting), 'admin');
        if (built()) render();
        return true;
      }
      /* 서버에 admin 액션이 아직 없을 때 — 이관 전 원본(articles)에서 회의록만 골라 보여 줍니다. */
      return apiGet('type=articles').then(function (k) {
        S.loading = false; loadedToken = tk;
        var items = (k && k.ok && Array.isArray(k.items)) ? k.items.filter(isMeeting) : [];
        useItems(items, 'articles');
        if (built()) render();
        return items.length > 0;
      });
    }).catch(function () {
      S.loading = false; loadedToken = tk; S.loaded = true;
      S.err = '회의록을 불러오지 못했습니다(네트워크).';
      if (built()) render();
      return false;
    });
  }

  /* ───────────────── 필터 ───────────────── */

  function rows() {
    var q = S.q.trim().toLowerCase();
    return S.items.filter(function (t) {
      if (S.kind !== 'ALL' && t.kind !== S.kind) return false;
      if (S.deal !== 'ALL' && t.dealTags.indexOf(S.deal) < 0) return false;
      if (!q) return true;
      var hay = [t.title, t.summary, t.text, t.section, t.speaker, t.state, t.due, t.tags, t.dealTags.join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    }).sort(function (a, b) {
      if (S.sort === 'old') return String(a.date).localeCompare(String(b.date));
      if (S.sort === 'kind') {
        var d = (a.kind === b.kind ? 0 : (a.kind === '팀장회의' ? -1 : 1));
        if (d) return d;
      }
      return String(b.date).localeCompare(String(a.date));
    });
  }

  /* ───────────────── 렌더 ───────────────── */

  function built() { return !!$('#adminHqBody'); }

  function shellHTML() {
    return '<div class="ad-wrap hq-wrap">' +
      '<div class="ad-head">' +
      '<div class="ad-title"><h1>🗂️ NAI 행정 — 회의록</h1>' +
      '<p>팀장회의(화 08:31)·월간회의 기록을 <b>매각·임대(딜) 화면과 분리</b>해 두는 자리입니다. 관리자만 열람·수정할 수 있고, 수정할 때마다 누가·언제·무엇을 고쳤는지 기록이 남습니다.</p></div>' +
      '<div class="ad-tools">' +
      '<button type="button" class="btn btn-ghost" id="hqRefresh">↻ 새로고침</button>' +
      '<button type="button" class="btn btn-outline" id="hqNew">＋ 회의록 등록</button>' +
      '</div></div>' +
      '<div id="hqKpi" class="ad-kpi"></div>' +
      '<div class="ad-bar">' +
      '<div class="hq-chips" id="hqKindChips"></div>' +
      '<div class="hq-chips" id="hqDealChips"></div>' +
      '<div class="ad-filters">' +
      '<input id="hqQ" type="search" data-enter="search" placeholder="검색 — 제목 · 본문 · 담당 · 물건" value="' + esc(S.q) + '" autocomplete="off">' +
      '<select id="hqSort">' +
      [['recent', '최신순'], ['old', '오래된순'], ['kind', '구분별']].map(function (o) {
        return '<option value="' + o[0] + '"' + (S.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>' +
      '<span id="hqNote" class="ad-note"></span>' +
      '</div></div>' +
      '<div id="adminHqBody" class="hq-body"></div>' +
      '</div>';
  }

  function renderKpi() {
    var host = $('#hqKpi');
    if (!host) return;
    var team = S.items.filter(function (t) { return t.kind === '팀장회의'; }).length;
    var mon = S.items.length - team;
    var tr = 0, lm = 0, buy = 0, sell = 0;
    S.items.forEach(function (t) {
      if (t.dealTags.indexOf('TR') >= 0) tr++;
      if (t.dealTags.indexOf('LM') >= 0) lm++;
      if (t.dealTags.indexOf('매입') >= 0) buy++;
      if (t.dealTags.indexOf('매각') >= 0) sell++;
    });
    var k = [
      ['회의록', S.items.length + '건', S.src === 'admin' ? '시트 admin 탭' : (S.src ? 'articles(이관 전)' : '—')],
      ['팀장회의', team + '건', '화 08:31'],
      ['월간회의', mon + '건', '월요·월간'],
      ['TR·LM', tr + ' / ' + lm, '임차·임대'],
      ['매입·매각', buy + ' / ' + sell, '딜 구분']
    ];
    host.innerHTML = k.map(function (x) {
      return '<div class="ad-k"><span>' + esc(x[0]) + '</span><strong>' + esc(x[1]) + '</strong><em>' + esc(x[2]) + '</em></div>';
    }).join('');
  }

  function renderChips() {
    var kc = $('#hqKindChips');
    if (kc) {
      kc.innerHTML = [['ALL', '전체'], ['팀장회의', '팀장회의'], ['월간회의', '월간회의']].map(function (o) {
        return '<button type="button" class="pf-chip' + (S.kind === o[0] ? ' on' : '') + '" data-hq-kind="' + o[0] + '">' + o[1] + '</button>';
      }).join('');
    }
    var dc = $('#hqDealChips');
    if (dc) {
      dc.innerHTML = [['ALL', '딜 구분 전체'], ['TR', 'TR 임차'], ['LM', 'LM 임대'], ['매입', '매입'], ['매각', '매각']].map(function (o) {
        return '<button type="button" class="pf-chip' + (S.deal === o[0] ? ' on' : '') + '" data-hq-deal="' + o[0] + '">' + o[1] + '</button>';
      }).join('');
    }
  }

  function groupsHTML(list) {
    var g = {};
    list.forEach(function (t) { (g[t.date] = g[t.date] || []).push(t); });
    var dates = Object.keys(g).sort(function (a, b) { return S.sort === 'old' ? a.localeCompare(b) : b.localeCompare(a); });
    return dates.map(function (d) {
      var items = g[d];
      return '<div class="nt-date"><span class="nt-d">' + esc(d) + '</span><span class="nt-c">' + items.length + '건</span></div>' +
        '<div class="nt-grid">' + items.map(cardHTML).join('') + '</div>';
    }).join('');
  }

  function cardHTML(t) {
    var a = t.asset ? assetName(t.asset) : '';
    var body = t.text.length > 260 ? t.text.slice(0, 260) + '…' : t.text;
    return '<article class="nt-card hq-card">' +
      '<div class="nt-tags">' +
      '<span class="nt-tag hq-kind">' + esc(t.kind) + '</span>' +
      (t.section ? '<span class="nt-tag">' + esc(t.section) + '</span>' : '') +
      (t.dealTags.length ? t.dealTags.map(function (x) { return '<span class="nt-tag hq-deal">' + esc(x) + '</span>'; }).join('') : '') +
      (t.state ? '<span class="nt-tag state">' + esc(t.state) + '</span>' : '') +
      (t.due ? '<span class="nt-tag due">기한 ' + esc(t.due) + '</span>' : '') +
      '</div>' +
      '<h4>' + esc(String(t.title).replace(/^\[[^\]]*\]\s*/, '')) + '</h4>' +
      '<p>' + esc(body) + '</p>' +
      (t.speaker ? '<span class="nt-spk">' + esc(t.speaker) + '</span>' : '') +
      '<div class="hq-acts">' +
      '<button type="button" class="mini-btn" data-hq-read="' + esc(t.id) + '">📄 원문</button>' +
      '<button type="button" class="mini-btn" data-hq-edit="' + esc(t.id) + '">✏️ 수정</button>' +
      '<button type="button" class="mini-btn" data-hq-hist="' + esc(t.id) + '">🕘 이력</button>' +
      (t.asset ? '<button type="button" class="mini-btn" data-hq-asset="' + esc(t.asset) + '">🗂 ' + esc(a) + '</button>' : '') +
      '</div></article>';
  }

  function renderBody() {
    var host = $('#adminHqBody');
    if (!host) return;
    var note = $('#hqNote');
    if (note) note.textContent = S.loading ? '불러오는 중…' : (S.err || (S.src === 'articles' ? '※ 시트 admin 이관 전 원본(articles) 표시' : ''));
    if (S.loading && !S.items.length) { host.innerHTML = '<p class="ad-empty">회의록을 불러오는 중…</p>'; return; }
    if (!S.items.length) {
      host.innerHTML = '<div class="hq-empty">' +
        '<b>표시할 회의록이 없습니다.</b>' +
        '<p>' + esc(S.err || '시트 admin 탭에 회의록 48건이 들어 있습니다. 앱에서 표시·수정하려면 Apps Script에 Admin.gs(앱 배포용 패치)를 한 번 붙여 주세요.') + '</p>' +
        '</div>';
      return;
    }
    var list = rows();
    if (!list.length) { host.innerHTML = '<p class="ad-empty">조건에 맞는 회의록이 없습니다.</p>'; return; }
    host.innerHTML = '<div class="hq-count">' + list.length + '건</div>' + groupsHTML(list);
  }

  function render() {
    var host = $('#adminHqView');
    if (!host) return;
    if (!built()) { host.innerHTML = shellHTML(); bindShell(); }
    renderKpi(); renderChips(); renderBody();
  }

  function bindShell() {
    var host = $('#adminHqView');
    if (!host) return;
    var rf = $('#hqRefresh');
    if (rf) rf.addEventListener('click', function () { load(true); });
    var nw = $('#hqNew');
    if (nw) nw.addEventListener('click', function () { openEditor(null); });
    var q = $('#hqQ');
    if (q) {
      var t = null;
      q.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () { S.q = q.value; renderBody(); }, 180);
      });
      q.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        e.preventDefault(); e.stopPropagation();
        S.q = q.value; renderBody();
      });
    }
    var so = $('#hqSort');
    if (so) so.addEventListener('change', function () { S.sort = so.value; renderBody(); });
    host.addEventListener('click', function (e) {
      var k = e.target.closest('[data-hq-kind]');
      if (k) { S.kind = k.getAttribute('data-hq-kind'); renderChips(); renderBody(); return; }
      var d = e.target.closest('[data-hq-deal]');
      if (d) { S.deal = d.getAttribute('data-hq-deal'); renderChips(); renderBody(); return; }
      var r = e.target.closest('[data-hq-read]');
      if (r) { openReader(r.getAttribute('data-hq-read')); return; }
      var ed = e.target.closest('[data-hq-edit]');
      if (ed) { openEditor(byId(ed.getAttribute('data-hq-edit'))); return; }
      var hs = e.target.closest('[data-hq-hist]');
      if (hs) { openHistory(hs.getAttribute('data-hq-hist')); return; }
      var as = e.target.closest('[data-hq-asset]');
      if (as) {
        var id = as.getAttribute('data-hq-asset');
        if (window.naiShowView) window.naiShowView('map');
        if (window.naiMap && window.naiMap.select) window.naiMap.select(id);
      }
    });
    var modal = $('#poolModal');
    if (modal && !modal._hqBound) {
      modal._hqBound = true;
      modal.addEventListener('click', function (e) {
        if (e.target === modal || e.target.closest('[data-close-modal]')) modal.classList.add('hidden');
      });
    }
  }

  function byId(id) { return S.items.filter(function (x) { return x.id === id; })[0] || null; }

  function modalOpen(title, body) {
    var modal = $('#poolModal');
    if (!modal) { toast('화면을 열 수 없습니다.', true); return; }
    modal.innerHTML = '<div class="modal-card wide"><div class="modal-head"><h3>' + title + '</h3>' +
      '<button type="button" class="icon-btn" data-close-modal="1">×</button></div>' +
      '<div class="modal-body">' + body + '</div></div>';
    modal.classList.remove('hidden');
  }

  function paragraphs(text) {
    return String(text || '').split(/\n{2,}/).map(function (p) {
      return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function openReader(id) {
    var t = byId(id);
    if (!t) return;
    var body = '<div class="read-meta">' + esc(t.date) + ' · ' + esc(t.kind) +
      (t.dealTags.length ? ' · ' + esc(t.dealTags.join(' / ')) : '') + ' · 관리자 전용</div>' +
      '<h2 class="read-title">' + esc(String(t.title).replace(/^\[[^\]]*\]\s*/, '')) + '</h2>' +
      (t.summary ? '<p class="read-sum">' + esc(t.summary) + '</p>' : '') +
      '<div class="read-body nw-body">' + (t.text ? paragraphs(t.text) : '<p class="hs-empty">본문이 비어 있습니다.</p>') + '</div>' +
      (t.asset ? '<p class="hq-meta">연결 물건: <b>' + esc(assetName(t.asset)) + '</b></p>' : '') +
      '<p class="hq-meta">최근 수정 ' + esc(t.updated_at || '—') + (t.updated_by ? ' · ' + esc(t.updated_by) : '') + '</p>';
    modalOpen('📄 회의록 원문', body);
  }

  function options(cur, list) {
    return list.map(function (o) {
      return '<option value="' + esc(o) + '"' + (cur === o ? ' selected' : '') + '>' + esc(o || '—') + '</option>';
    }).join('');
  }

  function openEditor(t) {
    var isNew = !t;
    var item = t || { id: '', date: todayStr(), kind: '팀장회의', title: '', summary: '', section: '', speaker: '', due: '', state: '', asset: '', dealTags: [], text: '' };
    var assetOpts = ['<option value="">— 없음 —</option>'].concat(assets().filter(function (a) {
      return String(a.source || '').indexOf('NAI') === 0 || String(a.id).indexOf('nai-') === 0 || String(a.id).indexOf('mtg-') === 0 || String(a.id).indexOf('hotel-') === 0;
    }).slice(0, 400).map(function (a) {
      return '<option value="' + esc(a.id) + '"' + (item.asset === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
    })).join('');
    var body = '<div class="fm-grid">' +
      '<label class="fm-row"><span>구분</span><select id="hqKind">' + options(item.kind, ['팀장회의', '월간회의']) + '</select></label>' +
      '<label class="fm-row"><span>일자</span><input id="hqDate" type="date" value="' + esc(item.date) + '"></label>' +
      '<label class="fm-row wide"><span>제목 *</span><input id="hqTitle" type="text" value="' + esc(String(item.title).replace(/^\[[^\]]*\]\s*/, '')) + '"></label>' +
      '<label class="fm-row"><span>섹션</span><input id="hqSection" type="text" value="' + esc(item.section) + '"></label>' +
      '<label class="fm-row"><span>발언·담당</span><input id="hqSpeaker" type="text" value="' + esc(item.speaker) + '"></label>' +
      '<label class="fm-row"><span>상태</span><input id="hqState" type="text" value="' + esc(item.state) + '"></label>' +
      '<label class="fm-row"><span>기한</span><input id="hqDue" type="text" value="' + esc(item.due) + '" placeholder="예) 2026-12-01"></label>' +
      '<label class="fm-row wide"><span>연결 물건</span><select id="hqAsset">' + assetOpts + '</select></label>' +
      '<label class="fm-row wide"><span>딜 구분 (TR/LM/매입/매각)</span><div class="hq-dealpick">' +
      ['TR', 'LM', '매입', '매각'].map(function (x) {
        return '<label><input type="checkbox" class="hq-dealck" value="' + x + '"' + (item.dealTags.indexOf(x) >= 0 ? ' checked' : '') + '> ' + x + '</label>';
      }).join('') + '</div></label>' +
      '<label class="fm-row wide"><span>요약</span><input id="hqSummary" type="text" value="' + esc(item.summary) + '"></label>' +
      '<label class="fm-row wide"><span>본문 *</span><textarea id="hqText" rows="12">' + esc(item.text) + '</textarea></label>' +
      '</div>' +
      '<p class="hq-meta">저장하면 ‘admin’ 탭의 updated_by·updated_at과 edit_log, 그리고 접속 로그(access_logs)에 수정 이력이 함께 남습니다.</p>' +
      '<div class="fm-actions"><button type="button" class="btn btn-solid" id="hqSave">저장</button></div>' +
      '<div class="fm-err hidden" id="hqErr"></div>';
    modalOpen(isNew ? '＋ 회의록 등록' : '✏️ 회의록 수정', body);
    var btn = $('#hqSave');
    if (btn) btn.addEventListener('click', function () { save(t); });
  }

  function todayStr() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function val(id) { var el = $('#' + id); return el ? String(el.value || '').trim() : ''; }
  function formErr(msg) {
    var el = $('#hqErr');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  }

  /** 저장 — 구조화(JSON) 회의록은 text 필드만 바꾸고 나머지 키는 보존합니다. */
  function save(orig) {
    var title = val('hqTitle');
    var text = val('hqText');
    if (!title) { formErr('제목을 입력하세요.'); return; }
    if (!text) { formErr('본문을 입력하세요.'); return; }
    var kind = val('hqKind') || '팀장회의';
    var deal = $$('.hq-dealck').filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
    var body = text;
    if (orig && orig.raw === false) {
      var obj = {};
      try { obj = JSON.parse(orig.body || '{}') || {}; } catch (e) { obj = {}; }
      obj.section = val('hqSection'); obj.speaker = val('hqSpeaker');
      obj.due = val('hqDue'); obj.state = val('hqState'); obj.asset = val('hqAsset');
      obj.text = text;
      body = JSON.stringify(obj);
    }
    var tags = orig ? String(orig.tags || '') : '';
    tags = tags.split(',').map(function (x) { return x.trim(); }).filter(function (x) {
      return x && x !== '팀장회의' && x !== '월요회의' && x !== '월간회의' && !/^\d{4}-\d{2}-\d{2}$/.test(x);
    });
    tags.unshift(kind === '팀장회의' ? '팀장회의' : '월요회의');
    tags.push(val('hqDate'));
    var item = {
      id: orig ? orig.id : ('team-' + val('hqDate').replace(/-/g, '') + '-' + String(Date.now()).slice(-4)),
      date: val('hqDate') || todayStr(),
      kind: kind,
      title: '[' + kind + '] ' + title.replace(/^\[[^\]]*\]\s*/, ''),
      summary: val('hqSummary') || (val('hqSection') ? val('hqSection') + ' · ' + title : title),
      body: body,
      section: val('hqSection'), speaker: val('hqSpeaker'), due: val('hqDue'),
      state: val('hqState'), asset: val('hqAsset'),
      deal_tags: deal.join(','),
      tags: tags.join(','),
      source: orig ? '' : ('NAI 웹앱 직접 등록 ' + todayStr()),
      status: '비공개',
      updated_by: (window.naiMap && window.naiMap.state && window.naiMap.state.me && window.naiMap.state.me.name) || '관리자',
      updated_at: new Date().toISOString()
    };
    var btn = $('#hqSave');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
    var changed = orig ? changedFields(orig, item) : ['신규 등록'];

    apiPost({ action: 'admin_save', item: item }).then(function (j) {
      if (j && j.ok) return j;
      /* 서버에 admin_save 가 아직 없을 때 — 기존 articles 경로로 저장(이관 전 호환) */
      return apiPost({
        action: 'article_save',
        item: {
          id: item.id, title: item.title, date: item.date, status: '비공개',
          summary: item.summary, body: item.body, tags: item.tags, source: item.source || 'NAI 웹앱 직접 등록'
        }
      }).then(function (k) {
        if (k && k.ok) { k.via = 'articles'; return k; }
        return k;
      });
    }).then(function (j) {
      if (!j || !j.ok) {
        if (btn) { btn.disabled = false; btn.textContent = '저장'; }
        formErr('저장하지 못했습니다: ' + ((j && j.error) || '서버 응답 없음'));
        return;
      }
      var detail = 'id=' + item.id + '|fields=' + changed.join('·').slice(0, 90) + '|by=' + item.updated_by;
      apiPost({ action: 'log_event', kind: 'admin_edit', detail: detail }).catch(function () { /* 로그 실패는 저장과 무관 */ });
      var modal = $('#poolModal');
      if (modal) modal.classList.add('hidden');
      toast(j.via === 'articles' ? '수정했습니다. (articles 경로 — admin 탭은 이관 시 동기화)' : '회의록을 저장했습니다.');
      load(true);
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = '저장'; }
      formErr('네트워크 오류로 저장하지 못했습니다.');
    });
  }

  function changedFields(a, b) {
    var out = [];
    if (a.title !== b.title) out.push('제목');
    if (a.date !== b.date) out.push('일자');
    if (a.kind !== b.kind) out.push('구분');
    if (a.summary !== b.summary) out.push('요약');
    if (a.section !== b.section) out.push('섹션');
    if (a.speaker !== b.speaker) out.push('발언');
    if (a.state !== b.state) out.push('상태');
    if (a.due !== b.due) out.push('기한');
    if (a.asset !== b.asset) out.push('물건');
    if (a.dealTags.join(',') !== b.deal_tags) out.push('딜구분');
    if (a.text !== b.body) out.push('본문');
    return out.length ? out : ['변경 없음'];
  }

  /* 수정 이력 — access_logs(admin_edit) + 행의 updated_by/edit_log */
  function openHistory(id) {
    var t = byId(id);
    var body = '<div class="read-meta">' + esc(t ? t.title : id) + '</div>' +
      (t && t.edit_log ? '<p class="hq-meta">시트 기록: ' + esc(t.edit_log) + '</p>' : '') +
      '<div id="hqHistBody"><p class="hs-empty">이력을 불러오는 중…</p></div>';
    modalOpen('🕘 수정 이력', body);
    var host = $('#hqHistBody');
    apiGet('type=logs').then(function (j) {
      var logs = (j && j.ok && Array.isArray(j.logs)) ? j.logs : [];
      var hit = logs.filter(function (l) {
        return l.action === 'admin_edit' && String(l.detail || '').indexOf(id) >= 0;
      });
      if (!host) return;
      if (!hit.length) {
        host.innerHTML = '<p class="hs-empty">아직 앱에서 남긴 수정 이력이 없습니다.' +
          (t && t.updated_at ? '<br>시트 최근 수정: ' + esc(t.updated_at) + (t.updated_by ? ' · ' + esc(t.updated_by) : '') : '') + '</p>';
        return;
      }
      host.innerHTML = '<div class="ad-tablewrap"><table class="ad-table"><thead><tr><th>시각</th><th>수정자</th><th>내용</th></tr></thead><tbody>' +
        hit.sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); }).map(function (l) {
          return '<tr><td class="nowrap">' + esc(String(l.timestamp || '').replace('T', ' ').slice(0, 16)) + '</td>' +
            '<td>' + esc(l.name || l.role || '—') + '</td><td class="ad-det">' + esc(l.detail || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function () {
      if (host) host.innerHTML = '<p class="hs-empty">이력을 불러오지 못했습니다.</p>';
    });
  }

  /* ───────────────── 공개 인터페이스 ───────────────── */

  function show() {
    if (!isAdmin()) {
      toast('관리자 전용 화면입니다.', true);
      if (window.naiShowView) window.naiShowView('home');
      return;
    }
    render();
    load(false);
  }
  function reset() {
    clear();
    if ($('#adminHqView') && !$('#adminHqView').classList.contains('hidden')) { render(); load(false); }
  }
  function prefetch() { if (isAdmin()) load(false); }

  window.NAI_HQ = {
    show: show, reset: reset, prefetch: prefetch, load: load,
    state: S, team: function () { return S.items; }, isReady: function () { return S.loaded; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { prefetch(); });
  else prefetch();
})();
