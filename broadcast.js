/* =========================================================================
   Open AI Asset Bridge — broadcast.js  (📰 아티클 배포 대상 선택, 2026-11-27)
   -------------------------------------------------------------------------
   목적: 아티클 하나를 골라 "누구에게 보낼지"를 정하고, 수신자 명단을 확인·
   내보내는 화면입니다. **실제 메일 발송은 하지 않습니다** — 발송은 별도 승인
   단계로 남겨 두고, 이 화면은 대상 확정과 이력 기록까지만 합니다.

   데이터
     GET  ?type=articles         — 아티클 목록(관리자 응답)
     GET  ?type=admin_directory  — 서버가 직원 목록을 내려주는 경우(패치 후)
     POST {action:'log_event'}   — 배포 이력 '요약'만(이름·이메일 없이 건수만).
                                   서버가 아직 없어도 화면 동작에는 영향 없음.
   저장 (브라우저 localStorage 전용 — 공개 GitHub Pages 저장소에 명단을 넣지 않습니다)
     nai-map:admin-dir:v1     직원 목록 — 🔐 접근 명단 화면과 같은 저장본을 씁니다
     nai-map:art-groups:v1    수신자 그룹(관리자가 편집·저장)
     nai-map:art-broadcast:v1 배포 이력

   권한
     관리자(role==='admin')만 열 수 있습니다. 이 파일에는 직원 이름·이메일이
     한 줄도 들어 있지 않습니다(전부 브라우저 저장본/서버 응답에서 옵니다).
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var SYNC_URL = CFG.SYNC_URL || '';
  var PREFIX = CFG.STORAGE_PREFIX || 'nai-map';
  var TOKEN_KEY = PREFIX + ':token:v1';
  var DIR_KEY = PREFIX + ':admin-dir:v1';
  var GRP_KEY = PREFIX + ':art-groups:v1';
  var HIS_KEY = PREFIX + ':art-broadcast:v1';
  var APP_URL = 'https://rnjswnsdh-lab.github.io/Jk-asset--map/';
  var ART_MAX = 120;       /* 선택 목록에 올리는 최근 아티클 수 */
  var HIST_MAX = 100;      /* 보관하는 배포 이력 수 */

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = {
    view: 'main',                 /* main | hist */
    articles: [], artLoaded: false, artLoading: false, artErr: '', artId: '',
    mode: 'group', groupId: '', pick: {}, pickQ: '', extra: {}, includeRetired: false,
    dir: null, dirTried: false,
    edit: null,                   /* 그룹 편집 상태 {id,name,members:{},q,isNew} */
    histOpen: '', open: false
  };

  /* ───────────────── 공통 ───────────────── */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function lower(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function plain(s) {
    return String(s == null ? '' : s)
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/\s*p\s*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }
  function me() {
    var m = window.naiMap && window.naiMap.state && window.naiMap.state.me;
    return (m && (m.name || m.email)) || '관리자';
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
  function apiGet(type) {
    if (!SYNC_URL) return Promise.reject(new Error('no_sync'));
    var u = SYNC_URL + (SYNC_URL.indexOf('?') < 0 ? '?' : '&') + 'type=' + encodeURIComponent(type) + '&token=' + encodeURIComponent(token());
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
  function lsRead(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var j = JSON.parse(raw);
      return (j == null) ? fallback : j;
    } catch (e) { return fallback; }
  }
  function lsWrite(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
  }
  function whenText(iso) {
    var d = new Date(String(iso || ''));
    if (isNaN(d.getTime())) return String(iso || '').replace('T', ' ').slice(0, 16);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function download(text, name, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  }

  /* ───────────────── 직원 목록 (🔐 접근 명단과 같은 저장본) ───────────────── */

  function dirData() {
    if (S.dir) return S.dir;
    var j = lsRead(DIR_KEY, null);
    if (j && Array.isArray(j.people) && j.people.length) S.dir = j;
    return S.dir;
  }
  function people() {
    var d = dirData();
    if (!d || !Array.isArray(d.people)) return [];
    return d.people.map(function (p) {
      return {
        name: String(p.name || '').trim(), org: String(p.org || '').trim(),
        dept: String(p.dept || '').trim(), title: String(p.title || '').trim(),
        email: lower(p.email)
      };
    }).filter(function (p) { return p.name && p.email; });
  }
  function byEmail() {
    var m = {};
    people().forEach(function (p) { m[p.email] = p; });
    return m;
  }
  function isRetired(p) { return String((p && p.dept) || '').indexOf('퇴직') >= 0; }
  function dirWhen() {
    var d = dirData();
    return (d && String(d.collected_at || d.saved_at || '').slice(0, 10)) || '';
  }
  function dirSave(obj) {
    S.dir = obj;
    return lsWrite(DIR_KEY, obj);
  }
  function dirFetch() {
    return apiGet('type=admin_directory').then(function (j) {
      if (j && j.ok && Array.isArray(j.people) && j.people.length) {
        dirSave({
          version: j.version || 'server', source: j.source || 'naverworks_orgchart', org: j.org || '',
          count: j.people.length, collected_at: j.collected_at || '', saved_at: new Date().toISOString(),
          people: j.people
        });
        return true;
      }
      return false;
    }).catch(function () { return false; });
  }

  /* CSV/JSON 텍스트 → 직원 목록 (🔐 접근 명단의 불러오기와 같은 규칙) */
  function importDirText(text) {
    var list = [];
    var t = String(text || '').replace(/^\ufeff/, '').trim();
    if (!t) return 0;
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      var j = JSON.parse(t);
      list = (j && Array.isArray(j.people)) ? j.people : (Array.isArray(j) ? j : []);
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
        list.push({ name: o.name, org: o.org, dept: o.dept, title: o.title, email: o.email });
      });
    }
    list = list.filter(function (p) { return p && p.name && p.email; }).map(function (p) {
      return { name: String(p.name || '').trim(), org: String(p.org || '').trim(), dept: String(p.dept || '').trim(), title: String(p.title || '').trim(), email: lower(p.email) };
    });
    if (!list.length) return 0;
    dirSave({ version: 'file', source: 'manual-import', org: '', count: list.length, saved_at: new Date().toISOString(), people: list });
    return list.length;
  }

  /* ───────────────── 수신자 그룹 ───────────────── */

  function cleanDeptLabel(dept) {
    var s = String(dept || '').replace(/\s+/g, ' ').trim();
    if (!s) return '소속 미지정';
    s = s.replace(/^&\s*/, '');
    var parts = s.split(/\s*_\s*/);
    var head = (parts[0] || s).trim();
    var tail = parts.slice(1).join(' ').replace(/\(.*?\)/g, '').trim();
    if (!head) head = s;
    return tail ? head + ' (' + tail + ')' : head;
  }
  function toMember(p) { return { email: p.email, name: p.name, dept: p.dept, title: p.title }; }

  /** 기본 그룹 — 네이버웍스 조직도의 부서를 그대로 팀원 그룹으로 (경영진 + 부서별) */
  function seedGroups() {
    var list = people();
    var exec = { id: 'seed:경영진', name: '경영진', members: [], seeded: true };
    var map = {}, order = [];
    list.forEach(function (p) {
      if (isRetired(p)) return;
      if (/회장|사장|전무|부사장|본부장/.test(p.title)) exec.members.push(toMember(p));
      var label = cleanDeptLabel(p.dept);
      if (!map[label]) { map[label] = { id: 'seed:' + label, name: label, members: [], seeded: true }; order.push(label); }
      map[label].members.push(toMember(p));
    });
    var out = [];
    if (exec.members.length) out.push(exec);
    order.forEach(function (k) { out.push(map[k]); });
    return out;
  }
  function groups() {
    var j = lsRead(GRP_KEY, null);
    if (j && Array.isArray(j.groups) && j.groups.length) return j.groups;
    return seedGroups();
  }
  function groupsSaved() {
    var j = lsRead(GRP_KEY, null);
    return !!(j && Array.isArray(j.groups) && j.groups.length);
  }
  function groupsSave(list) {
    return lsWrite(GRP_KEY, { version: 1, updated_at: new Date().toISOString(), updated_by: me(), groups: list });
  }
  function currentGroup() {
    var gs = groups();
    return gs.filter(function (g) { return g.id === S.groupId; })[0] || gs[0] || null;
  }
  function resolveMember(m) {
    var p = byEmail()[lower(m && m.email)];
    if (p) return { email: p.email, name: p.name, dept: p.dept, title: p.title };
    return { email: lower(m && m.email), name: String((m && m.name) || ''), dept: String((m && m.dept) || ''), title: String((m && m.title) || ''), missing: true };
  }

  /* ───────────────── 대상 계산 ───────────────── */

  function targets() {
    var list = [], label = '', groupName = '';
    if (S.mode === 'all') {
      list = people().filter(function (p) { return S.includeRetired ? true : !isRetired(p); }).map(toMember);
      label = '전 직원';
    } else if (S.mode === 'pick') {
      list = Object.keys(S.pick).map(function (k) { return S.pick[k]; })
        .concat(Object.keys(S.extra).map(function (k) { return S.extra[k]; }));
      label = '직접 선택';
    } else {
      var g = currentGroup();
      groupName = g ? g.name : '';
      list = g ? g.members.map(resolveMember) : [];
      label = '팀원 그룹' + (g ? ' · ' + g.name : '');
    }
    var seen = {}, out = [], dup = 0, noMail = 0;
    list.forEach(function (m) {
      var k = lower(m && m.email);
      if (!k || k.indexOf('@') < 0) { noMail++; return; }
      if (seen[k]) { dup++; return; }
      seen[k] = 1;
      var r = resolveMember(m);
      out.push(r);
    });
    out.sort(function (a, b) {
      return String(a.dept || '').localeCompare(String(b.dept || '')) ||
        String(a.name || '').localeCompare(String(b.name || ''));
    });
    return { list: out, dup: dup, noMail: noMail, label: label, groupName: groupName };
  }

  /* ───────────────── 아티클 ───────────────── */

  var artPromise = null;
  function loadArticles(force) {
    if (S.artLoaded && !force) return Promise.resolve();
    if (artPromise) return artPromise;
    S.artLoading = true; S.artErr = '';
    renderArtSelect(); renderArtInfo();
    artPromise = apiGet('articles').then(function (j) {
      S.artLoading = false;
      S.artLoaded = true;
      if (!j || !j.ok || !Array.isArray(j.items)) {
        S.articles = []; S.artErr = '아티클 목록을 불러오지 못했습니다(권한 또는 네트워크).';
      } else {
        var list = j.items.filter(function (a) {
          var t = String((a && a.tags) || '');
          if (t.indexOf('팀장회의') >= 0 || t.indexOf('월요회의') >= 0 || t.indexOf('월간회의') >= 0) return false;
          if (String((a && a.status) || '') === '비공개') return false;
          return true;
        });
        list.sort(function (a, b) {
          var d = String(b.date || '').localeCompare(String(a.date || ''));
          if (d) return d;
          return String(b.id || '').localeCompare(String(a.id || ''));
        });
        S.articles = list.slice(0, ART_MAX);
        if (!S.articles.filter(function (a) { return (a.id || '') === S.artId; }).length) {
          S.artId = S.articles.length ? (S.articles[0].id || '') : '';
        }
      }
      renderArtSelect(); renderArtInfo(); renderPreview();
    }).catch(function () {
      S.artLoading = false; S.artLoaded = true; S.articles = [];
      S.artErr = '아티클 목록을 불러오지 못했습니다(네트워크).';
      renderArtSelect(); renderArtInfo(); renderPreview();
    }).then(function () { artPromise = null; });
    return artPromise;
  }
  function currentArticle() {
    if (!S.artId) return null;
    return S.articles.filter(function (a) { return (a.id || '') === S.artId; })[0] || null;
  }
  function artLabel(a) {
    var d = String(a.date || '').slice(5).replace('-', '/');
    var t = String(a.title || '').replace(/^\[[^\]]*\]\s*/, '');
    if (d) t = t.replace(new RegExp('^' + d.replace('/', '\\/') + '\\s*[·\-]?\\s*'), '');
    return (d ? d + ' · ' : '') + (t.length > 70 ? t.slice(0, 70) + '…' : t);
  }

  /* ───────────────── 이력 ───────────────── */

  function historyGet() {
    var j = lsRead(HIS_KEY, null);
    return (j && Array.isArray(j.items)) ? j : { version: 1, items: [] };
  }
  function historySave(h) { return lsWrite(HIS_KEY, h); }

  /* ───────────────── 렌더 ───────────────── */

  var modalEl = null;

  function shellHTML() {
    return '<div class="modal-card wide bc-card">' +
      '<div class="modal-head"><h3>📰 아티클 배포 — 대상 선택</h3>' +
      '<button type="button" class="icon-btn" data-close-modal="1" aria-label="닫기">×</button></div>' +
      '<div class="modal-body bc-body" id="bcBody"></div></div>';
  }

  function bodyHTML() {
    if (S.view === 'hist') return histHTML();
    return '<div class="read-meta">관리자 전용 · 실제 메일 발송은 하지 않습니다(발송은 별도 승인)</div>' +
      '<div class="bc-sec"><div class="bc-h"><b>1</b> 아티클</div>' +
      '<div class="bc-row"><select id="bcArt" class="bc-select" aria-label="배포할 아티클"></select>' +
      '<button type="button" class="mini-btn" id="bcArtReload" title="아티클 목록 새로고침">↻</button></div>' +
      '<div id="bcArtInfo" class="hq-meta"></div></div>' +
      '<div class="bc-sec"><div class="bc-h"><b>2</b> 배포 대상</div>' +
      '<div class="bc-modes" role="group" aria-label="배포 대상 방식">' +
      '<button type="button" class="bc-mode" data-bc-mode="group">👥 팀원 그룹</button>' +
      '<button type="button" class="bc-mode" data-bc-mode="all">🏢 전 직원</button>' +
      '<button type="button" class="bc-mode" data-bc-mode="pick">☑️ 직접 선택</button>' +
      '</div><div id="bcModeBody"></div></div>' +
      '<div class="bc-sec"><div class="bc-h"><b>3</b> 수신자 미리보기 <span id="bcCount" class="bc-count"></span></div>' +
      '<div id="bcPreview"></div></div>' +
      '<div class="bc-acts">' +
      '<button type="button" class="mini-btn" id="bcCsv">⬇️ 수신자 CSV</button>' +
      '<button type="button" class="mini-btn" id="bcDraft">📋 메일 초안 복사</button>' +
      '<button type="button" class="mini-btn" id="bcHist">🕘 배포 이력</button>' +
      '<button type="button" class="btn btn-solid" id="bcConfirm">대상 확정 (발송은 별도 승인)</button>' +
      '</div>' +
      '<p class="bc-note">※ 발송 버튼은 없습니다. 대상 확정 → 이력 기록까지만 하고, 실제 발송은 별도 승인 후 진행합니다. ' +
      '직원 명단·그룹·이력은 <b>이 브라우저(localStorage)</b>에만 저장되며 공개 저장소에 올라가지 않습니다.</p>';
  }

  function renderBody() {
    var host = $('#bcBody');
    if (!host) return;
    host.innerHTML = bodyHTML();
    if (S.view === 'hist') { renderHist(); return; }
    renderArtSelect(); renderArtInfo(); renderModes(); renderModeBody(); renderPreview();
  }

  function renderArtSelect() {
    var sel = $('#bcArt');
    if (!sel) return;
    if (!S.articles.length) {
      sel.innerHTML = '<option value="">' + (S.artLoading ? '아티클을 불러오는 중…' : '아티클 없음') + '</option>';
      return;
    }
    sel.innerHTML = S.articles.map(function (a) {
      var id = a.id || '';
      return '<option value="' + esc(id) + '"' + (id === S.artId ? ' selected' : '') + '>' + esc(artLabel(a)) + '</option>';
    }).join('');
  }

  function renderArtInfo() {
    var host = $('#bcArtInfo');
    if (!host) return;
    var a = currentArticle();
    if (S.artErr) { host.innerHTML = esc(S.artErr); return; }
    if (!a) { host.innerHTML = S.artLoading ? '아티클을 불러오는 중…' : '배포할 아티클을 고르세요.'; return; }
    host.innerHTML = '<b>' + esc(String(a.title || '')) + '</b>' +
      ' · ' + esc(String(a.date || '')) +
      (a.source ? ' · ' + esc(String(a.source)) : '') +
      (a.summary ? '<br><span style="opacity:.8">' + esc(String(a.summary).slice(0, 140)) + (String(a.summary).length > 140 ? '…' : '') + '</span>' : '') +
      '<br><span style="opacity:.7">최근 ' + S.articles.length + '건 중 선택 · 팀장회의·비공개 글은 목록에서 제외</span>';
  }

  function renderModes() {
    $$('#bcBody [data-bc-mode]').forEach(function (b) {
      var on = b.getAttribute('data-bc-mode') === S.mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function renderModeBody() {
    var host = $('#bcModeBody');
    if (!host) return;
    host.innerHTML = S.edit ? editHTML() : (S.mode === 'group' ? groupHTML() : (S.mode === 'all' ? allHTML() : pickHTML()));
    if (S.edit) { renderEditHits(); }
    if (S.mode === 'pick' && !S.edit) { renderPickList(); renderPickChips(); }
  }

  /* 고르는 사람이 없는 경우(직원 목록 미import) 공통 안내 */
  function noDirHTML() {
    return '<div class="bc-emptydir"><b>직원 목록이 아직 없습니다.</b>' +
      '<p>네이버웍스 조직도에서 수집한 <b>admin_directory.json</b>(또는 CSV)을 한 번 불러오면 이 브라우저에만 저장되고, ' +
      '이후로는 그룹·전 직원·직접 선택이 모두 동작합니다. 🔐 접근 명단에서 이미 불러왔다면 그대로 쓰입니다.</p>' +
      '<div class="bc-row"><label class="mini-btn" style="cursor:pointer;display:inline-block">직원 목록 파일<input id="bcDirFile" type="file" accept=".json,.csv,text/csv,application/json" style="display:none"></label>' +
      '<button type="button" class="mini-btn" id="bcDirFetch">서버에서 새로고침</button></div></div>';
  }

  function groupHTML() {
    var gs = groups();
    if (!people().length) return noDirHTML();
    if (!gs.length) return '<p class="hq-meta">그룹이 없습니다. [새 그룹]으로 만들 수 있습니다.</p>';
    var g = currentGroup();
    if (g && !S.groupId) S.groupId = g.id;
    return '<div class="bc-row">' +
      '<select id="bcGroup" class="bc-select" aria-label="팀원 그룹">' +
      gs.map(function (x) {
        return '<option value="' + esc(x.id) + '"' + (g && x.id === g.id ? ' selected' : '') + '>' +
          esc(x.name) + ' · ' + (x.members || []).length + '명</option>';
      }).join('') + '</select>' +
      '<button type="button" class="mini-btn" id="bcGroupEdit">✏️ 그룹 편집</button>' +
      '<button type="button" class="mini-btn" id="bcGroupNew">＋ 새 그룹</button>' +
      '</div>' +
      '<p class="hq-meta">' + (groupsSaved() ? '저장된 그룹' : '기본 그룹(조직도 부서) — 편집해 저장하면 이 브라우저에 남습니다') +
      ' · 그룹 ' + gs.length + '개</p>';
  }

  function allHTML() {
    if (!people().length) return noDirHTML();
    var all = people(), live = all.filter(function (p) { return !isRetired(p); });
    return '<label class="bc-check"><input type="checkbox" id="bcRetired"' + (S.includeRetired ? ' checked' : '') + '> ' +
      '퇴직·무소속 포함 (기본: 제외)</label>' +
      '<p class="hq-meta">조직도 ' + all.length + '명 중 <b>' + (S.includeRetired ? all.length : live.length) + '명</b>에게 보냅니다' +
      (dirWhen() ? ' · ' + esc(dirWhen()) + ' 수집본' : '') + '</p>';
  }

  function pickHTML() {
    if (!people().length) return noDirHTML();
    return '<div class="bc-row"><input id="bcPickQ" type="search" class="bc-search" placeholder="이름 · 부서 · 이메일로 찾기" autocomplete="off" value="' + esc(S.pickQ) + '">' +
      '<button type="button" class="mini-btn" id="bcPickClear">선택 비우기</button></div>' +
      '<div id="bcPickList" class="bc-hits"></div>' +
      '<div id="bcPickChips" class="bc-chips"></div>' +
      '<div class="bc-row" style="margin-top:6px"><input id="bcExtraMail" type="email" class="bc-search" placeholder="명단에 없는 주소 직접 추가 (name@naikorea.com)" autocomplete="off">' +
      '<button type="button" class="mini-btn" id="bcExtraAdd">추가</button></div>';
  }

  function personSub(p) { return [p.dept, p.title].filter(Boolean).join(' · '); }

  function renderPickList() {
    var host = $('#bcPickList');
    if (!host) return;
    var q = lower(S.pickQ);
    var list = people().filter(function (p) {
      if (!q) return true;
      return lower(p.name).indexOf(q) >= 0 || lower(p.email).indexOf(q) >= 0 || lower(p.dept).indexOf(q) >= 0;
    });
    if (!q) list = list.slice(0, 40);
    if (!list.length) { host.innerHTML = '<p class="hq-meta">일치하는 직원이 없습니다.</p>'; return; }
    host.innerHTML = list.map(function (p) {
      var on = !!S.pick[p.email];
      return '<button type="button" class="bc-hit' + (on ? ' is-on' : '') + '" data-bc-pick="' + esc(p.email) + '">' +
        '<span class="bc-hit-name">' + esc(p.name) + '</span>' +
        '<span class="bc-hit-sub">' + esc(personSub(p)) + '</span>' +
        '<span class="bc-hit-mail">' + esc(p.email) + '</span>' +
        '<span class="bc-hit-tick">' + (on ? '✓' : '+') + '</span></button>';
    }).join('') + (!q && people().length > 40 ? '<p class="hq-meta">40명까지만 표시 — 검색으로 좁히세요.</p>' : '');
  }

  function renderPickChips() {
    var host = $('#bcPickChips');
    if (!host) return;
    var seen = {}, keys = [];
    Object.keys(S.pick).concat(Object.keys(S.extra)).forEach(function (k) {
      if (seen[k]) return;
      seen[k] = 1; keys.push(k);
    });
    if (!keys.length) { host.innerHTML = '<p class="hq-meta">선택한 사람이 없습니다.</p>'; return; }
    host.innerHTML = keys.map(function (k) {
      var m = S.pick[k] || S.extra[k] || {};
      return '<span class="bc-chip">' + esc(m.name || k) + '<button type="button" class="bc-chip-x" data-bc-unpick="' + esc(k) + '" aria-label="빼기">×</button></span>';
    }).join('');
  }

  /* 그룹 편집 */
  function editHTML() {
    var e = S.edit;
    return '<div class="bc-gedit">' +
      '<div class="bc-row"><input id="bcGName" class="bc-search" placeholder="그룹 이름 (예: 팀장, CM팀, 전국 지사)" value="' + esc(e.name) + '">' +
      '<span class="hq-meta" id="bcGCount"></span></div>' +
      '<div class="bc-row"><input id="bcGQ" type="search" class="bc-search" placeholder="이름 · 부서 · 이메일로 찾기" autocomplete="off" value="' + esc(e.q || '') + '"></div>' +
      '<div id="bcGHits" class="bc-hits"></div>' +
      '<div class="bc-row" style="margin-top:8px">' +
      '<button type="button" class="btn btn-solid" id="bcGSave">저장</button>' +
      '<button type="button" class="mini-btn" id="bcGCancel">취소</button>' +
      (e.isNew ? '' : '<button type="button" class="mini-btn danger" id="bcGDel">그룹 삭제</button>') +
      '<span style="flex:1"></span>' +
      '<button type="button" class="mini-btn" id="bcGExport">그룹 JSON 내보내기</button>' +
      '<label class="mini-btn" style="cursor:pointer;display:inline-block">그룹 JSON 불러오기<input id="bcGImport" type="file" accept=".json,application/json" style="display:none"></label>' +
      '</div>' +
      '<p class="bc-note">그룹 구성원은 이 브라우저에만 저장됩니다. 다른 기기로 옮길 때는 [그룹 JSON 내보내기]로 파일을 받아 그 기기에서 불러오세요.</p>' +
      '</div>';
  }

  function renderEditHits() {
    var host = $('#bcGHits');
    if (!host || !S.edit) return;
    var q = lower(S.edit.q);
    var list = people().filter(function (p) {
      if (!q) return true;
      return lower(p.name).indexOf(q) >= 0 || lower(p.email).indexOf(q) >= 0 || lower(p.dept).indexOf(q) >= 0;
    });
    if (!q) list = list.slice(0, 45);
    host.innerHTML = (list.length ? list.map(function (p) {
      var on = !!S.edit.members[p.email];
      return '<button type="button" class="bc-hit' + (on ? ' is-on' : '') + '" data-bc-gmem="' + esc(p.email) + '">' +
        '<span class="bc-hit-name">' + esc(p.name) + '</span>' +
        '<span class="bc-hit-sub">' + esc(personSub(p)) + '</span>' +
        '<span class="bc-hit-mail">' + esc(p.email) + '</span>' +
        '<span class="bc-hit-tick">' + (on ? '✓' : '+') + '</span></button>';
    }).join('') : '<p class="hq-meta">일치하는 직원이 없습니다.</p>') +
      (!q && people().length > 45 ? '<p class="hq-meta">45명까지만 표시 — 검색으로 좁히세요.</p>' : '');
    var c = $('#bcGCount');
    if (c) c.textContent = '선택 ' + Object.keys(S.edit.members).length + '명';
  }

  function renderPreview() {
    var host = $('#bcPreview');
    var cnt = $('#bcCount');
    if (!host) return;
    var t = targets();
    if (cnt) cnt.textContent = t.list.length ? t.list.length + '명' + (t.dup ? ' (중복 ' + t.dup + '건 제거)' : '') : '';
    if (!t.list.length) {
      host.innerHTML = '<p class="bc-empty">' +
        (S.mode === 'group' && !people().length ? '직원 목록을 먼저 불러와 주세요.' :
          S.mode === 'group' ? '이 그룹에 구성원이 없습니다. [그룹 편집]에서 사람을 넣어 주세요.' :
            S.mode === 'all' ? '직원 목록이 비어 있습니다.' : '아래에서 보낼 사람을 선택하세요.') + '</p>';
      return;
    }
    var missing = t.list.filter(function (m) { return m.missing; }).length;
    host.innerHTML = (t.dup || missing) ?
      '<p class="hq-meta">' + (t.dup ? '중복 주소 ' + t.dup + '건은 한 번만 넣었습니다. ' : '') +
      (missing ? '조직도에 없는 주소 ' + missing + '건은 저장된 값으로 표시합니다.' : '') + '</p>' : '';
    host.innerHTML += '<div class="ad-tablewrap bc-tablewrap"><table class="ad-table"><thead><tr>' +
      '<th>이름</th><th>부서</th><th>직함</th><th>이메일</th></tr></thead><tbody>' +
      t.list.map(function (m) {
        return '<tr><td><b>' + esc(m.name || '—') + '</b>' + (m.missing ? ' <span class="bc-miss">조직도 외</span>' : '') + '</td>' +
          '<td>' + esc(m.dept || '') + '</td><td>' + esc(m.title || '') + '</td><td>' + esc(m.email) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* 이력 화면 */
  function histHTML() {
    return '<div class="bc-hist-head"><button type="button" class="mini-btn" id="bcBack">← 대상 선택으로</button>' +
      '<span class="read-meta" style="margin-left:8px">배포 이력 — 누가 · 언제 · 누구에게 · 어느 아티클</span></div>' +
      '<div id="bcHistBody"></div>';
  }

  function renderHist() {
    var host = $('#bcHistBody');
    if (!host) return;
    var h = historyGet();
    if (!h.items.length) {
      host.innerHTML = '<p class="bc-empty">아직 기록이 없습니다. 대상을 정하고 [대상 확정]을 누르면 여기에 남습니다.</p>';
      return;
    }
    host.innerHTML = '<div class="ad-tablewrap"><table class="ad-table"><thead><tr>' +
      '<th>일시</th><th>아티클</th><th>대상</th><th>인원</th><th>실행자</th><th></th></tr></thead><tbody>' +
      h.items.map(function (r) {
        var open = S.histOpen === r.id;
        var row = '<tr><td class="nowrap">' + esc(whenText(r.at)) + '</td>' +
          '<td><b>' + esc((r.article || {}).title || '—') + '</b>' +
          ((r.article || {}).date ? '<br><span style="opacity:.7;font-size:10.4px">' + esc(r.article.date) + '</span>' : '') + '</td>' +
          '<td class="nowrap">' + esc(r.target || '') + '</td><td class="nowrap">' + esc(String(r.count || 0)) + '명</td>' +
          '<td class="nowrap">' + esc(r.by || '') + '</td>' +
          '<td class="nowrap"><button type="button" class="mini-btn" data-bc-hview="' + esc(r.id) + '">' + (open ? '접기' : '명단') + '</button> ' +
          '<button type="button" class="mini-btn" data-bc-hcsv="' + esc(r.id) + '">CSV</button> ' +
          '<button type="button" class="mini-btn danger" data-bc-hdel="' + esc(r.id) + '">삭제</button></td></tr>';
        if (open) {
          row += '<tr><td colspan="6" class="bc-hdet">' + (r.recipients || []).map(function (m) {
            return esc(m.name) + ' <span style="opacity:.7">(' + esc(m.email) + ')</span>';
          }).join(' · ') + '</td></tr>';
        }
        return row;
      }).join('') + '</tbody></table></div>' +
      '<p class="bc-note">이력은 이 브라우저에 최근 ' + HIST_MAX + '건까지 저장됩니다. 서버에는 제목·인원 같은 요약만 남기고 이름·이메일은 보내지 않습니다.</p>';
  }

  /* ───────────────── 동작 ───────────────── */

  function open(articleId) {
    if (!isAdmin()) { toast('아티클 배포는 관리자만 쓸 수 있습니다.', true); return; }
    modalEl = $('#poolModal');
    if (!modalEl) { toast('화면을 열 수 없습니다.', true); return; }
    S.open = true; S.view = 'main'; S.edit = null;
    if (articleId) S.artId = articleId;
    if (!S.artLoaded) S.artLoading = true;
    modalEl.innerHTML = shellHTML();
    modalEl.classList.remove('hidden');
    bind();
    renderBody();
    if (!S.artLoaded) loadArticles(false);
    if (!S.dirTried) {
      S.dirTried = true;
      if (!people().length) {
        dirFetch().then(function (ok) {
          if (ok && S.open) { renderModeBody(); renderPreview(); }
        });
      }
    }
  }

  function close() {
    S.open = false;
    if (modalEl) modalEl.classList.add('hidden');
  }

  function bind() {
    var m = $('#poolModal');
    if (!m || m._bcBound) return;
    m._bcBound = true;
    m.addEventListener('click', function (e) {
      if (e.target === m && m.id === 'poolModal') { close(); return; }
      if (e.target.closest('[data-close-modal]')) { close(); return; }
      if (!S.open) return;
      var el;
      if ((el = e.target.closest('[data-bc-mode]'))) {
        S.mode = el.getAttribute('data-bc-mode'); S.edit = null;
        renderModes(); renderModeBody(); renderPreview(); return;
      }
      if ((el = e.target.closest('[data-bc-pick]'))) {
        var k = el.getAttribute('data-bc-pick');
        if (S.pick[k]) delete S.pick[k];
        else { var p = byEmail()[k]; if (p) S.pick[k] = toMember(p); }
        renderPickList(); renderPickChips(); renderPreview(); return;
      }
      if ((el = e.target.closest('[data-bc-unpick]'))) {
        var u = el.getAttribute('data-bc-unpick');
        delete S.pick[u]; delete S.extra[u];
        renderPickList(); renderPickChips(); renderPreview(); return;
      }
      if ((el = e.target.closest('[data-bc-gmem]'))) {
        var gk = el.getAttribute('data-bc-gmem');
        if (!S.edit) return;
        if (S.edit.members[gk]) delete S.edit.members[gk];
        else { var gp = byEmail()[gk]; if (gp) S.edit.members[gk] = toMember(gp); }
        renderEditHits(); return;
      }
      if (e.target.closest('#bcGroupEdit')) {
        var g = currentGroup();
        if (!g) return;
        S.edit = { id: g.id, name: g.name, members: {}, q: '', isNew: false };
        (g.members || []).forEach(function (x) { if (x && x.email) S.edit.members[lower(x.email)] = x; });
        renderModeBody(); return;
      }
      if (e.target.closest('#bcGroupNew')) {
        S.edit = { id: 'grp-' + Date.now().toString(36), name: '', members: {}, q: '', isNew: true };
        renderModeBody();
        var nm = $('#bcGName'); if (nm) nm.focus();
        return;
      }
      if (e.target.closest('#bcGSave')) { saveGroup(); return; }
      if (e.target.closest('#bcGCancel')) { S.edit = null; renderModeBody(); return; }
      if (e.target.closest('#bcGDel')) { delGroup(); return; }
      if (e.target.closest('#bcGExport')) { exportGroups(); return; }
      if (e.target.closest('#bcPickClear')) { S.pick = {}; S.extra = {}; renderPickList(); renderPickChips(); renderPreview(); return; }
      if (e.target.closest('#bcExtraAdd')) { addExtra(); return; }
      if (e.target.closest('#bcArtReload')) { loadArticles(true); return; }
      if (e.target.closest('#bcCsv')) { exportCsv(); return; }
      if (e.target.closest('#bcDraft')) { copyDraft(); return; }
      if (e.target.closest('#bcHist')) { S.view = 'hist'; renderBody(); return; }
      if (e.target.closest('#bcBack')) { S.view = 'main'; renderBody(); return; }
      if (e.target.closest('#bcConfirm')) { confirmTargets(); return; }
      if (e.target.closest('#bcDirFetch')) {
        var b = e.target.closest('#bcDirFetch');
        b.disabled = true; b.textContent = '확인 중…';
        dirFetch().then(function (ok) {
          b.disabled = false; b.textContent = '서버에서 새로고침';
          if (ok) { toast('직원 목록을 서버에서 받았습니다.'); renderModeBody(); renderPreview(); }
          else toast('서버에 직원 목록이 아직 없습니다. 파일로 불러와 주세요.', true);
        });
        return;
      }
      if ((el = e.target.closest('[data-bc-hview]'))) {
        var hid = el.getAttribute('data-bc-hview');
        S.histOpen = (S.histOpen === hid) ? '' : hid;
        renderHist(); return;
      }
      if ((el = e.target.closest('[data-bc-hcsv]'))) { exportHistCsv(el.getAttribute('data-bc-hcsv')); return; }
      if ((el = e.target.closest('[data-bc-hdel]'))) { delHist(el.getAttribute('data-bc-hdel')); return; }
    });

    m.addEventListener('change', function (e) {
      if (!S.open) return;
      var t = e.target;
      if (t.id === 'bcArt') { S.artId = t.value; renderArtInfo(); renderPreview(); return; }
      if (t.id === 'bcGroup') { S.groupId = t.value; renderPreview(); return; }
      if (t.id === 'bcRetired') { S.includeRetired = !!t.checked; renderModeBody(); renderPreview(); return; }
      if (t.id === 'bcDirFile') {
        var f = t.files && t.files[0];
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          var n = 0;
          try { n = importDirText(String(rd.result || '')); } catch (err) { n = 0; }
          if (!n) { toast('직원 목록을 읽지 못했습니다. admin_directory.json 또는 CSV인지 확인해 주세요.', true); return; }
          toast('직원 ' + n + '명 목록을 불러왔습니다. 이 브라우저에만 저장됩니다.');
          renderModeBody(); renderPreview();
        };
        rd.readAsText(f, 'utf-8');
        return;
      }
      if (t.id === 'bcGImport') {
        var gf = t.files && t.files[0];
        if (!gf) return;
        var rd2 = new FileReader();
        rd2.onload = function () {
          var n = 0;
          try {
            var j = JSON.parse(String(rd2.result || '{}'));
            var gs = (j && Array.isArray(j.groups)) ? j.groups : (Array.isArray(j) ? j : []);
            gs = gs.filter(function (x) { return x && x.name && Array.isArray(x.members); });
            if (gs.length) { groupsSave(gs); n = gs.length; }
          } catch (err) { n = 0; }
          if (!n) { toast('그룹 JSON을 읽지 못했습니다.', true); return; }
          toast('그룹 ' + n + '개를 불러왔습니다.');
          S.edit = null; S.groupId = ''; renderModeBody(); renderPreview();
        };
        rd2.readAsText(gf, 'utf-8');
        return;
      }
    });

    m.addEventListener('input', function (e) {
      if (!S.open) return;
      var t = e.target;
      if (t.id === 'bcPickQ') { S.pickQ = t.value; renderPickList(); return; }
      if (t.id === 'bcGQ' && S.edit) { S.edit.q = t.value; renderEditHits(); return; }
      if (t.id === 'bcGName' && S.edit) { S.edit.name = t.value; return; }
    });

    m.addEventListener('keydown', function (e) {
      if (!S.open) return;
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      var t = e.target;
      if (t.id === 'bcExtraMail') { e.preventDefault(); addExtra(); }
      if (t.id === 'bcPickQ') { e.preventDefault(); var first = $('#bcPickList [data-bc-pick]'); if (first) first.click(); }
      if (t.id === 'bcGQ') { e.preventDefault(); var g1 = $('#bcGHits [data-bc-gmem]'); if (g1) g1.click(); }
    });
  }

  function addExtra() {
    var inp = $('#bcExtraMail');
    if (!inp) return;
    var v = lower(inp.value);
    if (!v || v.indexOf('@') < 0) { toast('이메일 주소를 정확히 입력하세요.', true); return; }
    var p = byEmail()[v];
    S.extra[v] = p ? toMember(p) : { email: v, name: '', dept: '', title: '', missing: true };
    inp.value = '';
    renderPickChips(); renderPreview();
  }

  function saveGroup() {
    var nameEl = $('#bcGName');
    var name = String((nameEl && nameEl.value) || '').trim();
    if (!name) { toast('그룹 이름을 입력하세요.', true); return; }
    var members = Object.keys(S.edit.members).map(function (k) { return S.edit.members[k]; });
    if (!members.length) { toast('구성원을 한 명 이상 넣어 주세요.', true); return; }
    var list = groups().filter(function (g) { return g.id !== S.edit.id; });
    list.push({ id: S.edit.id, name: name, members: members, updated_at: new Date().toISOString(), updated_by: me() });
    if (!groupsSave(list)) { toast('저장하지 못했습니다(브라우저 저장 공간).', true); return; }
    S.groupId = S.edit.id;
    S.edit = null;
    toast('그룹 “' + name + '”(' + members.length + '명)을 저장했습니다.');
    renderModeBody(); renderPreview();
  }

  function delGroup() {
    if (!S.edit) return;
    var g = groups().filter(function (x) { return x.id === S.edit.id; })[0];
    if (!g) return;
    if (!window.confirm('그룹 “' + g.name + '”을(를) 삭제할까요? (직원 목록은 그대로입니다)')) return;
    var list = groups().filter(function (x) { return x.id !== S.edit.id; });
    groupsSave(list);
    S.groupId = '';
    S.edit = null;
    toast('그룹을 삭제했습니다.');
    renderModeBody(); renderPreview();
  }

  function exportGroups() {
    var gs = groups();
    if (!gs.length) return toast('내보낼 그룹이 없습니다.', true);
    download(JSON.stringify({ version: 1, exported_at: new Date().toISOString(), groups: gs }, null, 1),
      'NAI_수신자그룹_' + stamp() + '.json', 'application/json;charset=utf-8');
    toast('그룹 ' + gs.length + '개를 JSON 파일로 내보냈습니다.');
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var t = targets();
    if (!t.list.length) { toast('내보낼 수신자가 없습니다.', true); return; }
    var a = currentArticle();
    var rows = [['이름', '부서', '직함', '이메일']].concat(t.list.map(function (m) { return [m.name, m.dept, m.title, m.email]; }));
    var csv = '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    download(csv, '아티클배포_수신자_' + ((a && String(a.date || '').replace(/-/g, '')) || stamp()) + '.csv', 'text/csv;charset=utf-8');
    toast('수신자 ' + t.list.length + '명을 CSV로 내보냈습니다.');
  }

  function draftText() {
    var a = currentArticle();
    var lines = ['안녕하세요, NAI Korea 권준오입니다.', '', '오늘의 딜 아티클을 공유드립니다.', ''];
    if (a) {
      lines.push('■ ' + String(a.title || '').replace(/^\[[^\]]*\]\s*/, ''));
      var meta = [String(a.date || ''), String(a.source || '')].filter(Boolean).join(' · ');
      if (meta) lines.push('· ' + meta);
      if (a.summary) lines.push('', plain(a.summary));
      if (a.body) {
        var body = plain(a.body);
        if (body && body !== plain(a.summary)) lines.push('', body.length > 2600 ? body.slice(0, 2600) + '…' : body);
      }
    } else {
      lines.push('■ (아티클을 고르지 않았습니다)');
    }
    lines.push('', '전체 내용과 물건 DB는 아래에서 보실 수 있습니다.', APP_URL, '', '감사합니다.');
    return lines.join('\n');
  }

  function copyDraft() {
    var text = draftText();
    var done = function () { toast('메일 초안을 복사했습니다. 메일 앱에 붙여 넣어 확인하세요. (발송은 직접)'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) done();
    else toast('복사하지 못했습니다. 브라우저 권한을 확인해 주세요.', true);
  }

  function confirmTargets() {
    var a = currentArticle();
    if (!a) { toast('아티클을 먼저 고르세요.', true); return; }
    var t = targets();
    if (!t.list.length) { toast('수신자가 없습니다.', true); return; }
    var msg = '「' + String(a.title || '').replace(/^\[[^\]]*\]\s*/, '') + '」\n' +
      '대상: ' + t.label + '\n수신자: ' + t.list.length + '명\n\n' +
      '※ 실제 발송은 별도 승인 단계입니다. 지금은 대상만 확정하고 배포 이력에 기록합니다.';
    if (!window.confirm(msg)) return;
    var rec = {
      id: 'bc-' + Date.now().toString(36),
      at: new Date().toISOString(),
      by: me(),
      article: { id: a.id || '', title: a.title || '', date: a.date || '' },
      mode: S.mode,
      target: t.label,
      group: t.groupName || '',
      count: t.list.length,
      recipients: t.list.map(function (m) { return { name: m.name, dept: m.dept, title: m.title, email: m.email }; })
    };
    var h = historyGet();
    h.items.unshift(rec);
    if (h.items.length > HIST_MAX) h.items = h.items.slice(0, HIST_MAX);
    var saved = historySave(h);
    apiPost({
      action: 'log_event', kind: 'article_broadcast',
      detail: 'article=' + (a.id || '') + '|mode=' + S.mode + '|' + (t.groupName || '') + '|n=' + t.list.length
    }).catch(function () { /* 서버 로그는 없어도 화면 동작에 영향 없음 */ });
    if (!saved) toast('브라우저 저장 공간이 부족해 이력을 저장하지 못했습니다.', true);
    else toast('배포 대상을 확정했습니다 — 수신자 ' + t.list.length + '명. 발송은 별도 승인 후 진행합니다.');
    S.view = 'hist';
    renderBody();
  }

  function exportHistCsv(id) {
    var rec = historyGet().items.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    var rows = [['이름', '부서', '직함', '이메일']].concat((rec.recipients || []).map(function (m) { return [m.name, m.dept, m.title, m.email]; }));
    var csv = '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    download(csv, '아티클배포이력_' + String(rec.at || '').slice(0, 10).replace(/-/g, '') + '.csv', 'text/csv;charset=utf-8');
  }

  function delHist(id) {
    var h = historyGet();
    var rec = h.items.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    if (!window.confirm('이 배포 이력을 삭제할까요? (기록만 지우고 발송은 없습니다)\n' + whenText(rec.at) + ' · ' + ((rec.article || {}).title || ''))) return;
    h.items = h.items.filter(function (r) { return r.id !== id; });
    historySave(h);
    renderHist();
  }

  /* ───────────────── 공개 인터페이스 ───────────────── */

  window.NAI_BROADCAST = {
    open: open,
    close: close,
    groups: groups,
    history: historyGet,
    targets: targets,
    state: S
  };
})();
