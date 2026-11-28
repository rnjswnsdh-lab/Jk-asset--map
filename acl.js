/* =========================================================================
   Open AI Asset Bridge — acl.js  (🔐 사람별·범위별 접근권한, 2026-11-28)
   -------------------------------------------------------------------------
   관리자 화면(🛰️ 관리자 → 🔐 사람별 권한 · 주소록, 🗂️ NAI 행정 → 🔐 접근 권한)에서
   사람마다 **탭·데이터 범위**를 골라 권한을 주고, 개인 접속코드와 게스트 초대 링크를
   발급합니다. 실제 강제는 서버(Acl.gs)가 합니다 — 이 화면은 지정 도구입니다.

   서버 API
     GET  ?type=acl_people        사람별 권한 명단 (+ 범위 목록)
     GET  ?type=acl_guests        게스트 초대 목록
     GET  ?type=acl_audit         부여·회수 이력
     GET  ?type=acl_flags         공용 계정 상태 등
     GET  ?type=admin_directory   사내 직원 목록(권한 부여 후보)
     POST action=acl_person_save | acl_person_code | acl_person_revoke
     POST action=guest_invite_save | guest_invite_revoke
     POST action=acl_flag_save | admin_dir_save
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var SYNC_URL = CFG.SYNC_URL || '';
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var APP_URL = 'https://rnjswnsdh-lab.github.io/Jk-asset--map/';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = {
    tab: 'people', people: null, guests: null, audit: null, flags: null,
    scopes: [], labels: {}, dir: null, dirErr: '', busy: false,
    editing: null, lastCode: null, q: ''
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }

  function apiGet(qs) {
    if (!SYNC_URL) return Promise.reject(new Error('no_sync'));
    var u = SYNC_URL + (SYNC_URL.indexOf('?') < 0 ? '?' : '&') + qs + '&token=' + encodeURIComponent(getToken());
    return fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function apiPost(payload) {
    if (!SYNC_URL) return Promise.reject(new Error('no_sync'));
    var body = Object.assign({ token: getToken() }, payload);
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
    el._t = setTimeout(function () { el.classList.add('hidden'); el.style.background = ''; }, 3600);
  }
  function copyText(txt, okMsg) {
    var done = function () { toast(okMsg || '복사했습니다.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(function () { window.prompt('복사할 내용', txt); });
    } else window.prompt('복사할 내용', txt);
  }
  function ymd(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + Number(n || 0)); return d; }

  /* 서버가 라벨을 주기 전(구버전 서버)에도 한국어로 보이게 하는 기본 라벨 */
  var DEF_LABELS = {
    map: '물건 지도', nai_sale: 'NAI 매각', nai_lease: 'NAI 임대(LM)', match: 'AI 매물 매칭',
    pool: 'SI (사옥·전략투자) 풀', ship: '물류센터 화주 풀', fi: 'FI 풀', rfp: 'RFP 발주',
    vdr: '자문사 VDR', advise: '자문사 딜 현황', portal: '자문사 포털', finance: '매칭 마켓',
    valuation: '밸류에이션', adminhq: 'NAI 행정(회의록)', crm: '미팅·의향 로그',
    requests: '참여·접수 내역', admin: '관리자 화면'
  };
  function labelOf(k) { return S.labels[k] || DEF_LABELS[k] || k; }

  var SCOPE_GROUPS = [
    { label: '🗺️ 물건·딜', keys: ['map', 'nai_sale', 'nai_lease', 'match'] },
    { label: '🏢 풀', keys: ['pool', 'ship', 'fi'] },
    { label: '📑 RFP·자문사', keys: ['rfp', 'vdr', 'advise', 'portal', 'finance'] },
    { label: '📊 그 밖', keys: ['valuation', 'adminhq', 'crm', 'requests'] }
  ];

  /* ───────────────── 데이터 ───────────────── */

  function loadAll(force) {
    return Promise.all([
      (S.people && !force) ? Promise.resolve() : apiGet('type=acl_people').then(function (j) {
        if (j && j.ok) { S.people = j.items || []; S.scopes = j.scopes || []; S.labels = j.labels || {}; }
        else if (!S.people) S.people = [];
      }).catch(function () { if (!S.people) S.people = []; }),
      (S.guests && !force) ? Promise.resolve() : apiGet('type=acl_guests').then(function (j) {
        if (j && j.ok) S.guests = j.items || [];
        else if (!S.guests) S.guests = [];
      }).catch(function () { if (!S.guests) S.guests = []; }),
      (S.audit && !force) ? Promise.resolve() : apiGet('type=acl_audit').then(function (j) {
        if (j && j.ok) S.audit = j.items || [];
        else if (!S.audit) S.audit = [];
      }).catch(function () { if (!S.audit) S.audit = []; }),
      (S.flags && !force) ? Promise.resolve() : apiGet('type=acl_flags').then(function (j) {
        if (j && j.ok) S.flags = j.flags || {};
      }).catch(function () { /* noop */ })
    ]);
  }

  function loadDir() {
    return apiGet('type=admin_directory').then(function (j) {
      if (j && j.ok && Array.isArray(j.people) && j.people.length) {
        S.dir = j.people; S.dirErr = '';
        return true;
      }
      S.dirErr = 'empty';
      return false;
    }).catch(function () { S.dirErr = 'net'; return false; });
  }

  /* ───────────────── 공통 UI ───────────────── */

  function modalOpen(title, body) {
    var modal = $('#poolModal');
    if (!modal) { toast('화면을 열 수 없습니다.', true); return; }
    modal.innerHTML = '<div class="modal-card wide"><div class="modal-head"><h3>' + title + '</h3>' +
      '<button type="button" class="icon-btn" data-close-modal="1">×</button></div>' +
      '<div class="modal-body" id="aclBody">' + body + '</div></div>';
    modal.classList.remove('hidden');
    if (!modal._aclBound) {
      modal._aclBound = true;
      modal.addEventListener('click', function (e) {
        if (e.target === modal || (e.target.closest && e.target.closest('[data-close-modal]'))) modal.classList.add('hidden');
      });
    }
  }

  function scopeChips(selected, attr) {
    var n = selected || [];
    var html = '';
    SCOPE_GROUPS.forEach(function (g) {
      html += '<div style="margin:6px 0 2px;font-size:11.5px;opacity:.7">' + g.label + '</div><div style="display:flex;flex-wrap:wrap;gap:5px">';
      g.keys.forEach(function (k) {
        var on = n.indexOf(k) >= 0;
        html += '<label class="pf-chip' + (on ? ' on' : '') + '" style="cursor:pointer">' +
          '<input type="checkbox" ' + attr + ' value="' + k + '"' + (on ? ' checked' : '') + ' style="margin-right:4px">' +
          esc(labelOf(k)) + '</label>';
      });
      html += '</div>';
    });
    return html;
  }

  function chosenScopes(attr) {
    return $$('input[' + attr + ']:checked').map(function (i) { return i.value; });
  }

  function tabBar() {
    var tabs = [['people', '👤 사람별 권한'], ['guests', '🔗 게스트 초대'], ['audit', '🕘 부여 이력'], ['legacy', '⚙️ 공용 계정']];
    return '<div class="ad-subs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' + tabs.map(function (t) {
      return '<button type="button" class="ad-sub' + (S.tab === t[0] ? ' is-active' : '') + '" data-acl-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }

  /* ───────────────── 사람별 권한 ───────────────── */

  function peopleRows() {
    var q = S.q.trim().toLowerCase();
    return (S.people || []).filter(function (r) {
      if (!q) return true;
      return [r.name, r.org, r.email, r.scopes, r.note].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var sa = String(a.status || '허용') === '해제' ? 1 : 0;
      var sb = String(b.status || '허용') === '해제' ? 1 : 0;
      if (sa !== sb) return sa - sb;
      return String(b.updated_at || b.granted_at || '').localeCompare(String(a.updated_at || a.granted_at || ''));
    });
  }

  function statusChip(r) {
    var st = String(r.status || '허용');
    if (st === '해제') return '<span class="nt-tag" style="opacity:.6">해제</span>';
    var exp = String(r.expires_at || '');
    if (exp) {
      var days = Math.ceil((new Date(exp).getTime() - Date.now()) / 86400000);
      if (isFinite(days) && days < 0) return '<span class="nt-tag">만료</span>';
      if (days <= 14) return '<span class="nt-tag due">만료 ' + days + '일 전</span>';
    }
    return '<span class="nt-tag">허용</span>';
  }

  function peopleHTML() {
    var rows = peopleRows();
    var head = '<div class="ad-filters" style="margin-bottom:8px">' +
      '<input id="aclQ" type="search" placeholder="검색 — 이름 · 소속 · 이메일" value="' + esc(S.q) + '" autocomplete="off">' +
      '<button type="button" class="btn btn-solid" id="aclNew">＋ 권한 부여</button>' +
      '<button type="button" class="btn btn-ghost" id="aclRefresh">↻ 새로고침</button></div>';
    if (!S.people) return head + '<p class="hs-empty">불러오는 중…</p>';
    if (!rows.length) return head + '<p class="hs-empty">아직 권한을 받은 사람이 없습니다. [＋ 권한 부여]에서 직원을 골라 탭·데이터 범위를 지정하세요.</p>';
    return head + '<div class="ad-tablewrap"><table class="ad-table"><thead><tr>' +
      '<th>이름</th><th>소속</th><th>이메일</th><th>범위</th><th>수정</th><th>개인코드</th><th>만료</th><th>상태</th><th></th>' +
      '</tr></thead><tbody>' + rows.map(function (r) {
        var sc = (r.scopes_list || []).map(function (k) { return esc(labelOf(k)); });
        return '<tr><td><b>' + esc(r.name || '') + '</b></td><td>' + esc(r.org || '') + '</td>' +
          '<td>' + esc(r.email || '') + '</td>' +
          '<td style="max-width:280px">' + (sc.length ? sc.join(' · ') : '<span style="opacity:.6">—</span>') + '</td>' +
          '<td>' + (String(r.can_edit || '').toUpperCase() === 'Y' || String(r.access || '').toUpperCase() === 'EDIT' ? '✅' : '—') + '</td>' +
          '<td>' + (r.has_code ? '🔑 ' + esc(r.code_hint || '') : '<span style="opacity:.5">미발급</span>') + '</td>' +
          '<td class="nowrap">' + esc(String(r.expires_at || '').slice(0, 10) || '—') + '</td>' +
          '<td>' + statusChip(r) + '</td>' +
          '<td class="nowrap">' +
          '<button type="button" class="mini-btn" data-acl-edit="' + esc(r.id || r.email) + '">수정</button> ' +
          '<button type="button" class="mini-btn" data-acl-code="' + esc(r.id || r.email) + '">' + (r.has_code ? '재발급' : '코드 발급') + '</button> ' +
          (String(r.status || '허용') !== '해제' ? '<button type="button" class="mini-btn danger" data-acl-revoke="' + esc(r.id || r.email) + '">해제</button>' : '') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function personForm(r) {
    var item = r || { name: '', org: '', email: '', scopes_list: ['map'], can_edit: 'N', expires_at: '', sector_scope: '', note: '' };
    var sc = item.scopes_list || [];
    return '<div class="read-meta">' + (r ? '권한 수정 — ' + esc(r.name || r.email) : '새 권한 부여') + '</div>' +
      '<div class="hq-acl-pick">' +
      '<label style="display:block;font-size:12px;opacity:.75;margin-bottom:4px">직원 찾기 (사내 주소록)</label>' +
      '<input id="aclSearch" type="search" autocomplete="off" placeholder="이름 또는 이메일 — 예) 김광연, noah@" style="width:100%;padding:8px 10px;border:1px solid rgba(11,43,74,.18);border-radius:8px;font-size:13px">' +
      '<div id="aclHits" class="hq-acl-hits"></div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><span id="aclDirInfo" class="hq-meta" style="flex:1;min-width:180px"></span>' +
      '<label class="mini-btn" style="cursor:pointer;display:inline-block">직원 목록 파일<input id="aclDirFile" type="file" accept=".json,.csv,text/csv,application/json" style="display:none"></label>' +
      '<button type="button" class="mini-btn" id="aclDirSync">서버에서 새로고침</button></div>' +
      '</div>' +
      '<div class="hq-acl-form" style="margin-top:10px">' +
      '<label><span>이름 *</span><input id="aclName" type="text" value="' + esc(item.name || '') + '"></label>' +
      '<label><span>소속</span><input id="aclOrg" type="text" value="' + esc(item.org || '') + '"></label>' +
      '<label><span>이메일 *</span><input id="aclEmail" type="email" value="' + esc(item.email || '') + '"></label>' +
      '<label><span>만료일</span><input id="aclExpires" type="date" value="' + esc(String(item.expires_at || '').slice(0, 10)) + '"></label>' +
      '</div>' +
      '<div style="margin-top:8px"><span style="font-size:12px;opacity:.75">탭·데이터 범위 *</span>' + scopeChips(sc, 'data-acl-scope') + '</div>' +
      '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;align-items:center">' +
      '<label style="font-size:12.5px"><input type="checkbox" id="aclCanEdit"' + (String(item.can_edit || '').toUpperCase() === 'Y' || String(item.access || '').toUpperCase() === 'EDIT' ? ' checked' : '') + '> 수정 허용 (컨택트·회의록 등 부여 범위 안에서 저장)</label>' +
      '<label style="font-size:12.5px"><input type="checkbox" id="aclSectorLogi"' + (/logistics/.test(String(item.sector_scope || '')) ? ' checked' : '') + '> 물류센터 데이터만 (물건 지도 섹터 제한)</label>' +
      '</div>' +
      '<label class="fm-row wide" style="margin-top:8px"><span>부여 사유·메모</span><input id="aclNote" type="text" value="' + esc(item.note || '') + '" placeholder="예) 물류센터 TFT — 물류 화주·물류 데이터·물건 지도"></label>' +
      '<div class="fm-actions" style="margin-top:10px"><button type="button" class="btn btn-solid" id="aclSave">' + (r ? '저장' : '권한 부여') + '</button>' +
      '<button type="button" class="btn btn-outline" data-acl-back="1">목록으로</button></div>' +
      '<div class="fm-err hidden" id="aclErr"></div>';
  }

  function openPersonForm(r) {
    S.editing = r || null;
    var host = $('#aclBody');
    if (!host) return;
    host.innerHTML = tabBar() + personForm(r);
    bindPersonForm();
    if (!S.dir) {
      loadDir().then(function () { var i = $('#aclDirInfo'); if (i) i.innerHTML = dirInfoHTML(); renderHits(); });
    }
  }

  function dirInfoHTML() {
    if (S.dir && S.dir.length) return '직원 ' + S.dir.length + '명 — 이름·이메일로 찾을 수 있습니다. <span style="opacity:.7">사내 전용</span>';
    return S.dirErr === 'net' ? '주소록을 서버에서 읽지 못했습니다. 파일로 불러와 주세요.'
      : '사내 주소록이 아직 서버에 없습니다. 아래 <b>직원 목록 파일</b>(JSON/CSV)을 한 번 올리면 서버에 저장돼 다음부터 자동으로 뜹니다.';
  }

  function renderHits() {
    var host = $('#aclHits');
    if (!host) return;
    var q = String(($('#aclSearch') || {}).value || '').trim().toLowerCase();
    if (!S.dir || !S.dir.length) { host.innerHTML = ''; return; }
    if (!q) { host.innerHTML = ''; return; }
    var hits = S.dir.filter(function (p) {
      return [p.name, p.email, p.dept, p.org].join(' ').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 8);
    if (!hits.length) { host.innerHTML = '<div class="hq-meta" style="padding:6px 0">일치하는 직원이 없습니다.</div>'; return; }
    host.innerHTML = hits.map(function (p, i) {
      return '<button type="button" class="hq-acl-hit" data-acl-hit="' + i + '" style="display:block;width:100%;text-align:left;border:1px solid rgba(11,43,74,.14);background:#fff;border-radius:8px;padding:7px 10px;margin:4px 0;cursor:pointer">' +
        '<b>' + esc(p.name) + '</b> <span style="opacity:.75;font-size:11.5px">' + esc([p.dept, p.title].filter(Boolean).join(' · ')) + '</span><br>' +
        '<span style="font-size:11.5px;opacity:.85">' + esc(p.email || '') + '</span></button>';
    }).join('');
    $$('#aclHits [data-acl-hit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = hits[Number(b.getAttribute('data-acl-hit'))];
        if (!p) return;
        if ($('#aclName')) $('#aclName').value = p.name || '';
        if ($('#aclOrg')) $('#aclOrg').value = p.dept || p.org || '';
        if ($('#aclEmail')) $('#aclEmail').value = p.email || '';
        host.innerHTML = '<div class="hq-meta" style="padding:6px 0">선택: <b>' + esc(p.name) + '</b> · ' + esc(p.email || '') + ' — 범위를 고르고 [권한 부여]를 누르세요.</div>';
      });
    });
  }

  function bindPersonForm() {
    var s = $('#aclSearch');
    if (s) { s.addEventListener('input', renderHits); }
    var info = $('#aclDirInfo'); if (info) info.innerHTML = dirInfoHTML();
    var f = $('#aclDirFile');
    if (f) f.addEventListener('change', function () {
      var file = f.files && f.files[0];
      if (!file) return;
      var rd = new FileReader();
      rd.onload = function () {
        var people = parseDir(String(rd.result || ''));
        if (!people.length) { toast('직원 목록을 읽지 못했습니다(JSON/CSV 확인).', true); return; }
        apiPost({ action: 'admin_dir_save', people: people }).then(function (j) {
          if (j && j.ok) { S.dir = people; if (info) info.innerHTML = dirInfoHTML(); toast('직원 ' + people.length + '명을 서버에 저장했습니다.'); }
          else toast('저장하지 못했습니다: ' + ((j && j.error) || '응답 없음'), true);
        }).catch(function () { toast('저장하지 못했습니다(네트워크).', true); });
      };
      rd.readAsText(file, 'utf-8');
    });
    var sync = $('#aclDirSync');
    if (sync) sync.addEventListener('click', function () {
      sync.disabled = true; sync.textContent = '확인 중…';
      loadDir().then(function (ok) {
        sync.disabled = false; sync.textContent = '서버에서 새로고침';
        if (info) info.innerHTML = dirInfoHTML();
        if (!ok) toast('서버에 직원 목록이 없습니다. 파일로 한 번 올려 주세요.', true);
      });
    });
    var save = $('#aclSave');
    if (save) save.addEventListener('click', savePerson);
    $$('[data-acl-back]').forEach(function (b) {
      b.addEventListener('click', function () { S.editing = null; render(); });
    });
  }

  function parseDir(text) {
    var people = [];
    var t = String(text || '').replace(/^\ufeff/, '').trim();
    if (!t) return people;
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      var j = JSON.parse(t);
      people = (j && Array.isArray(j.people)) ? j.people : (Array.isArray(j) ? j : []);
    } else {
      var lines = t.split(/\r?\n/).filter(function (l) { return l.trim(); });
      var hdr = lines.shift().split(',').map(function (h) { return h.trim().replace(/^"|"$/g, ''); });
      lines.forEach(function (ln) {
        var cells = [], cur = '', q = false, i, c;
        for (i = 0; i < ln.length; i++) {
          c = ln.charAt(i);
          if (c === '"') { if (q && ln.charAt(i + 1) === '"') { cur += '"'; i++; } else q = !q; }
          else if (c === ',' && !q) { cells.push(cur); cur = ''; }
          else cur += c;
        }
        cells.push(cur);
        var o = {};
        hdr.forEach(function (h, k) { o[h] = String(cells[k] || '').trim(); });
        people.push(o);
      });
    }
    return people.filter(function (p) { return p && p.name && p.email; });
  }

  function savePerson() {
    var err = $('#aclErr');
    var fail = function (m) { if (err) { err.textContent = m; err.classList.remove('hidden'); } };
    var name = String(($('#aclName') || {}).value || '').trim();
    var email = String(($('#aclEmail') || {}).value || '').trim();
    var scopes = chosenScopes('data-acl-scope');
    if (!name) return fail('이름을 입력하세요.');
    if (!email || email.indexOf('@') < 1) return fail('이메일을 정확히 입력하세요(권한 판정 기준).');
    if (!scopes.length) return fail('범위를 하나 이상 고르세요.');
    var item = {
      id: S.editing ? (S.editing.id || '') : '',
      name: name, org: String(($('#aclOrg') || {}).value || '').trim(), email: email,
      scopes: scopes,
      can_edit: !!($('#aclCanEdit') && $('#aclCanEdit').checked),
      expires_at: String(($('#aclExpires') || {}).value || ''),
      sector_scope: ($('#aclSectorLogi') && $('#aclSectorLogi').checked) ? 'logistics' : '',
      note: String(($('#aclNote') || {}).value || '').trim()
    };
    var btn = $('#aclSave');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
    apiPost({ action: 'acl_person_save', item: item }).then(function (j) {
      if (btn) { btn.disabled = false; btn.textContent = '저장'; }
      if (!j || !j.ok) { fail('저장하지 못했습니다: ' + ((j && j.error) || '서버 응답 없음')); return; }
      var p = S.people.filter(function (x) { return x.id === j.id; })[0];
      if (!p) { S.people.unshift({ id: j.id, name: name, org: item.org, email: email, scopes: scopes.join(','), scopes_list: scopes, can_edit: item.can_edit ? 'Y' : 'N', status: '허용', expires_at: item.expires_at, sector_scope: item.sector_scope, note: item.note }); }
      else { p.scopes_list = scopes; p.scopes = scopes.join(','); p.can_edit = item.can_edit ? 'Y' : 'N'; p.expires_at = item.expires_at; p.sector_scope = item.sector_scope; p.note = item.note; p.name = name; p.org = item.org; }
      S.audit = null; S.editing = null;
      toast(name + ' 님에게 권한을 ' + (j.updated ? '저장했습니다' : '부여했습니다') + '. 개인 접속코드를 발급해 전달하세요.');
      render();
    }).catch(function () { if (btn) { btn.disabled = false; btn.textContent = '저장'; } fail('저장하지 못했습니다(네트워크).'); });
  }

  function issueCode(key) {
    var row = S.people.filter(function (r) { return (r.id || r.email) === key; })[0];
    if (!row) return;
    var rotate = !!row.has_code;
    if (rotate && !window.confirm('“' + (row.name || row.email) + '” 님의 개인 접속코드를 새로 발급할까요? 이전 코드는 즉시 쓸 수 없게 됩니다.')) return;
    apiPost({ action: 'acl_person_code', id: row.id || '', email: row.email || '', rotate: rotate }).then(function (j) {
      if (!j || !j.ok) { toast('코드를 발급하지 못했습니다: ' + ((j && j.error) || '응답 없음'), true); return; }
      row.has_code = true; row.code_hint = j.hint;
      S.lastCode = { name: j.name || row.name, email: j.email, code: j.code };
      render();
      showCodeBox();
    }).catch(function () { toast('코드를 발급하지 못했습니다(네트워크).', true); });
  }

  function showCodeBox() {
    var c = S.lastCode;
    if (!c) return;
    var host = $('#aclBody');
    if (!host) return;
    var box = document.createElement('div');
    box.style.cssText = 'margin:10px 0;padding:12px;border:1px solid rgba(11,43,74,.18);border-radius:10px;background:#f6f9fc';
    box.innerHTML = '<b>🔑 개인 접속코드 — 지금 한 번만 보입니다</b>' +
      '<p class="hq-meta" style="margin:6px 0">' + esc(c.name || '') + ' · ' + esc(c.email || '') +
      ' — 코드를 본인에게 직접 전달하세요. 서버에는 해시만 남습니다.</p>' +
      '<div style="font-family:monospace;font-size:16px;letter-spacing:1px;margin:8px 0">' + esc(c.code) + '</div>' +
      '<button type="button" class="mini-btn" id="aclCopyCode">📋 코드 복사</button> ' +
      '<button type="button" class="mini-btn" id="aclCopyHow">📋 전달 문구 복사</button> ' +
      '<p class="hq-meta" style="margin:8px 0 0">사용법: ' + esc(APP_URL) + ' → [🔑 내부 접속] → 코드 입력</p>';
    host.insertBefore(box, host.children[1] || null);
    $('#aclCopyCode').onclick = function () { copyText(c.code, '접속코드를 복사했습니다.'); };
    $('#aclCopyHow').onclick = function () {
      copyText('Open AI Asset Bridge 접속코드입니다.\n' + APP_URL + '\n접속코드: ' + c.code + '\n(본인만 사용해 주세요. 문의: Open AI Asset Bridge)', '전달 문구를 복사했습니다.');
    };
  }

  function revoke(key) {
    var row = S.people.filter(function (r) { return (r.id || r.email) === key; })[0];
    if (!row) return;
    if (!window.confirm('“' + (row.name || row.email) + '” 님의 접근 권한을 해제할까요? 개인 코드도 즉시 쓸 수 없게 됩니다.')) return;
    apiPost({ action: 'acl_person_revoke', id: row.id || '', email: row.email || '' }).then(function (j) {
      if (j && j.ok) { row.status = '해제'; row.has_code = false; S.audit = null; render(); toast('해제했습니다.'); }
      else toast('해제하지 못했습니다: ' + ((j && j.error) || '응답 없음'), true);
    }).catch(function () { toast('해제하지 못했습니다(네트워크).', true); });
  }

  /* ───────────────── 게스트 초대 ───────────────── */

  function guestLink(token) { return APP_URL + '?guest=' + encodeURIComponent(token); }

  function guestsHTML() {
    var list = S.guests || [];
    var form = '<div class="read-meta" style="margin-top:4px">새 초대 링크</div>' +
      '<div class="hq-acl-form">' +
      '<label><span>받는 사람 *</span><input id="gName" type="text" placeholder="예) ○○자산운용 김부장"></label>' +
      '<label><span>소속</span><input id="gOrg" type="text" placeholder="예) ○○자산운용"></label>' +
      '<label><span>이메일</span><input id="gEmail" type="email" placeholder="선택"></label>' +
      '<label><span>만료일</span><input id="gExpires" type="date" value="' + ymd(addDays((S.flags && S.flags.guest_days_default) || 30)) + '"></label>' +
      '</div>' +
      '<div style="margin-top:8px"><span style="font-size:12px;opacity:.75">볼 수 있는 범위 *</span>' +
      scopeChips(['map', 'nai_sale', 'nai_lease'], 'data-guest-scope') + '</div>' +
      '<label class="fm-row wide" style="margin-top:8px"><span>사유·메모</span><input id="gNote" type="text" placeholder="예) 아티클 배포 — 플랫폼·물건 홍보"></label>' +
      '<div class="fm-actions" style="margin-top:10px"><button type="button" class="btn btn-solid" id="gSave">초대 링크 만들기</button></div>' +
      '<p class="hq-meta">링크는 만료일까지만 유효하고, 횟수 제한 없이 볼 수 있습니다. 범위 밖 화면은 서버가 내려주지 않습니다. 열람은 접속 로그에 남습니다.</p>' +
      '<div class="fm-err hidden" id="gErr"></div>';
    var live = list.filter(function (g) { return String(g.status || '허용') !== '해제'; });
    var rows = '<div class="read-meta" style="margin-top:14px">보낸 초대 ' + live.length + '건</div>';
    if (!live.length) rows += '<p class="hs-empty">아직 보낸 초대가 없습니다.</p>';
    else rows += '<div class="ad-tablewrap"><table class="ad-table"><thead><tr><th>받는 사람</th><th>범위</th><th>만료</th><th>열람</th><th>링크</th><th></th></tr></thead><tbody>' +
      live.map(function (g) {
        var sc = String(g.scopes || '').split(',').filter(Boolean).map(function (k) { return esc(labelOf(k)); }).join(' · ');
        var exp = String(g.expires_at || '').slice(0, 10);
        var out = exp && new Date(exp).getTime() < Date.now();
        return '<tr><td><b>' + esc(g.name || '') + '</b>' + (g.org ? '<br><span style="opacity:.7;font-size:11.5px">' + esc(g.org) + '</span>' : '') + '</td>' +
          '<td style="max-width:240px">' + sc + '</td>' +
          '<td class="nowrap">' + esc(exp || '—') + (out ? ' <span class="nt-tag">만료</span>' : '') + '</td>' +
          '<td class="nowrap">' + esc(String(g.view_count || '0')) + '회 · ' + esc(String(g.last_view_at || '').replace('T', ' ').slice(0, 16) || '—') + '</td>' +
          '<td class="nowrap"><button type="button" class="mini-btn" data-guest-copy="' + esc(g.token || g.id) + '">📋 링크 복사</button></td>' +
          '<td class="nowrap"><button type="button" class="mini-btn danger" data-guest-revoke="' + esc(g.id || g.token) + '">해제</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    return form + rows;
  }

  function bindGuests() {
    var save = $('#gSave');
    if (save) save.addEventListener('click', function () {
      var name = String(($('#gName') || {}).value || '').trim();
      var err = $('#gErr');
      var fail = function (m) { if (err) { err.textContent = m; err.classList.remove('hidden'); } };
      if (!name) return fail('받는 사람을 입력하세요.');
      var scopes = chosenScopes('data-guest-scope');
      if (!scopes.length) return fail('범위를 하나 이상 고르세요.');
      var exp = String(($('#gExpires') || {}).value || '');
      save.disabled = true; save.textContent = '만드는 중…';
      apiPost({
        action: 'guest_invite_save',
        item: {
          name: name, org: String(($('#gOrg') || {}).value || '').trim(),
          email: String(($('#gEmail') || {}).value || '').trim(),
          scopes: scopes, expires_at: exp ? (exp + 'T23:59:59+09:00') : '',
          note: String(($('#gNote') || {}).value || '').trim()
        }
      }).then(function (j) {
        save.disabled = false; save.textContent = '초대 링크 만들기';
        if (!j || !j.ok) { fail('만들지 못했습니다: ' + ((j && j.error) || '응답 없음')); return; }
        S.guests = null; S.audit = null;
        var link = guestLink(j.token);
        modalOpen('🔗 게스트 초대 링크', '<div style="padding:8px 0"><b>' + esc(j.name) + '</b> 님 초대 링크' +
          '<div style="margin:10px 0;padding:10px;background:#f6f9fc;border:1px solid rgba(11,43,74,.16);border-radius:8px;word-break:break-all;font-size:12.5px">' + esc(link) + '</div>' +
          '<button type="button" class="btn btn-solid" id="gCopy">📋 링크 복사</button> ' +
          '<button type="button" class="btn btn-outline" id="gBack">목록으로</button>' +
          '<p class="hq-meta">만료 ' + esc(String(j.expires_at || '').slice(0, 10)) + ' · 범위 ' + esc(j.scopes.join(', ')) + '</p></div>');
        $('#gCopy').onclick = function () { copyText(link, '초대 링크를 복사했습니다.'); };
        $('#gBack').onclick = function () { S.guests = null; loadAll(true).then(render); };
      }).catch(function () { save.disabled = false; save.textContent = '초대 링크 만들기'; fail('만들지 못했습니다(네트워크).'); });
    });
    $$('[data-guest-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-guest-copy');
        var g = (S.guests || []).filter(function (x) { return (x.token || x.id) === key || x.id === key; })[0];
        if (g) copyText(guestLink(g.token), '초대 링크를 복사했습니다.');
      });
    });
    $$('[data-guest-revoke]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-guest-revoke');
        if (!window.confirm('이 초대 링크를 해제할까요? 링크를 받은 사람은 더 이상 들어올 수 없습니다.')) return;
        apiPost({ action: 'guest_invite_revoke', id: key }).then(function (j) {
          if (j && j.ok) { S.guests = null; S.audit = null; loadAll(true).then(render); toast('초대를 해제했습니다.'); }
          else toast('해제하지 못했습니다: ' + ((j && j.error) || '응답 없음'), true);
        }).catch(function () { toast('해제하지 못했습니다(네트워크).', true); });
      });
    });
  }

  /* ───────────────── 이력 · 공용 계정 ───────────────── */

  function auditHTML() {
    var rows = S.audit || [];
    if (!rows.length) return '<p class="hs-empty">아직 기록이 없습니다.</p>';
    var label = function (a) {
      return ({
        admin_access_grant: '권한 부여·수정', admin_access_revoke: '권한 해제',
        admin_access_code: '개인 코드 발급', guest_invite: '게스트 초대', guest_invite_revoke: '초대 해제',
        admin_edit: '회의록 수정', acl_flag: '공용 계정 설정', admin_dir_save: '주소록 저장',
        acl_denied: '범위 밖 요청 차단'
      })[a] || a;
    };
    return '<div class="ad-tablewrap"><table class="ad-table"><thead><tr><th>시각</th><th>동작</th><th>대상·내용</th><th>한 사람</th></tr></thead><tbody>' +
      rows.map(function (l) {
        return '<tr><td class="nowrap">' + esc(String(l.timestamp || '').replace('T', ' ').slice(0, 16)) + '</td>' +
          '<td class="nowrap">' + esc(label(l.action)) + '</td>' +
          '<td class="ad-det">' + esc(l.detail || '') + '</td>' +
          '<td class="nowrap">' + esc(l.name || l.role || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function legacyHTML() {
    var f = S.flags || {};
    var on = String(f.legacy_logi || 'on') !== 'off';
    return '<div class="read-meta">공용 물류TF 접속코드</div>' +
      '<p class="hq-meta">물류센터 TFT가 함께 쓰던 공용 아이디입니다. 개인 계정(사람별 권한 + 개인 코드)으로 옮긴 뒤 여기서 닫으면, 그 코드로는 더 이상 들어올 수 없습니다. <b>언제든 다시 켤 수 있습니다.</b></p>' +
      '<p style="font-size:13px;margin:10px 0"><b>현재 상태: ' + (on ? '🟢 열려 있음 (기존 TFT 사용 중)' : '🔴 닫힘') + '</b></p>' +
      '<button type="button" class="btn ' + (on ? 'btn-outline' : 'btn-solid') + '" id="legacyToggle">' + (on ? '공용 접속 닫기' : '공용 접속 다시 열기') + '</button>' +
      '<p class="hq-meta" style="margin-top:10px">닫아도 관리자·내부(CM) 접근과 이미 발급한 개인 코드는 그대로입니다.</p>' +
      '<p class="hq-meta">게스트 초대 기본 만료일: ' + esc(String(f.guest_days_default || '30')) + '일</p>';
  }

  function bindLegacy() {
    var b = $('#legacyToggle');
    if (!b) return;
    b.addEventListener('click', function () {
      var f = S.flags || {};
      var on = String(f.legacy_logi || 'on') !== 'off';
      if (on && !window.confirm('공용 물류TF 접속을 닫을까요? 지금 그 코드로 접속한 화면은 다음 요청부터 차단됩니다.')) return;
      apiPost({ action: 'acl_flag_save', key: 'legacy_logi', value: on ? 'off' : 'on', note: 'acl.js' }).then(function (j) {
        if (j && j.ok) {
          S.flags = S.flags || {}; S.flags.legacy_logi = j.value; S.audit = null;
          render(); toast('공용 접속을 ' + (j.value === 'off' ? '닫았습니다.' : '다시 열었습니다.'));
        } else toast('바꾸지 못했습니다: ' + ((j && j.error) || '응답 없음'), true);
      }).catch(function () { toast('바꾸지 못했습니다(네트워크).', true); });
    });
  }

  /* ───────────────── 렌더 ───────────────── */

  function render() {
    var host = $('#aclBody');
    if (!host) return;
    var body = tabBar();
    if (!S.scopes || !S.scopes.length) {
      body += '<div class="hq-empty" style="margin:8px 0"><b>서버 패치 전입니다.</b>' +
        '<p>권한 저장·코드 발급은 서버 <code>Acl.gs</code> 배포(v15) 후에 동작합니다. 그때까지는 시트 <code>admin_access</code>를 직접 고쳐 주세요.</p></div>';
    }
    if (S.tab === 'people') body += peopleHTML();
    else if (S.tab === 'guests') body += guestsHTML();
    else if (S.tab === 'audit') body += auditHTML();
    else body += legacyHTML();
    host.innerHTML = body;
    bindCommon();
    if (S.tab === 'people') bindPeople();
    if (S.tab === 'guests') bindGuests();
    if (S.tab === 'legacy') bindLegacy();
    if (S.lastCode) showCodeBox();
  }

  function bindCommon() {
    $$('[data-acl-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.tab = b.getAttribute('data-acl-tab'); S.lastCode = null;
        render();                       /* 탭은 즉시 — 데이터는 뒤에서 채웁니다 */
        if (S.tab === 'guests' && !S.guests) {
          apiGet('type=acl_guests').then(function (j) {
            S.guests = (j && j.ok && j.items) ? j.items : [];
            if (S.tab === 'guests') render();
          }).catch(function () { S.guests = []; if (S.tab === 'guests') render(); });
        }
        if (S.tab === 'audit' && !S.audit) {
          apiGet('type=acl_audit').then(function (j) {
            S.audit = (j && j.ok && j.items) ? j.items : [];
            if (S.tab === 'audit') render();
          }).catch(function () { S.audit = []; if (S.tab === 'audit') render(); });
        }
      });
    });
  }

  function bindPeople() {
    var q = $('#aclQ');
    if (q) {
      var t = null;
      q.addEventListener('input', function () {
        S.q = q.value;
        clearTimeout(t);
        t = setTimeout(function () {
          var caret = S.q.length;
          render();
          var q2 = $('#aclQ');
          if (q2) { q2.focus(); try { q2.setSelectionRange(caret, caret); } catch (e) { /* noop */ } }
        }, 160);
      });
    }
    var nw = $('#aclNew');
    if (nw) nw.addEventListener('click', function () { openPersonForm(null); });
    var rf = $('#aclRefresh');
    if (rf) rf.addEventListener('click', function () { S.people = null; S.audit = null; loadAll(true).then(render); });
    $$('[data-acl-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-acl-edit');
        var row = (S.people || []).filter(function (r) { return (r.id || r.email) === key; })[0];
        if (row) openPersonForm(row);
      });
    });
    $$('[data-acl-code]').forEach(function (b) {
      b.addEventListener('click', function () { issueCode(b.getAttribute('data-acl-code')); });
    });
    $$('[data-acl-revoke]').forEach(function (b) {
      b.addEventListener('click', function () { revoke(b.getAttribute('data-acl-revoke')); });
    });
  }

  function open() {
    if (!isAdmin()) { toast('관리자 전용 화면입니다.', true); return; }
    S.tab = 'people'; S.lastCode = null;
    modalOpen('🔐 사람별 권한 · 주소록', '<p class="hs-empty">불러오는 중…</p>');
    loadAll(true).then(function () { render(); });
  }

  window.NAI_ACL = { open: open, state: S, render: render };
})();
