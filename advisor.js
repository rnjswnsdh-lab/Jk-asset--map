/* =========================================================================
   Open AI Asset Bridge — advisor.js  (🧾 자문사 딜 프로세싱 시트, 2026-11-27)
   -------------------------------------------------------------------------
   - 업무신청의 '자문사 딜 참여' 접수(request_type = 자문사딜)를 모아
     진행 단계별로 처리하는 별도 시트(탭)입니다.
   - 단계: 접수 → 자격·실적 확인 → NDA·자료 → 자문계약 → 진행 → 완료
     (접수 행의 status 값이 있으면 그 값을 단계로 사용하고, 없으면 '접수')
   - 데이터: 비공개 시트 lois (type=requests). 이 화면은 읽기·정리용이며
     시트 원본을 직접 고치지 않습니다.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var STAGES = ['접수', '자격·실적 확인', 'NDA·자료', '자문계약', '진행', '완료'];
  var S = { items: [], loaded: false, loading: false, stage: 'ALL', q: '' };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }
  function toast(m, err) {
    if (window.naiToast) { window.naiToast(m, err); return; }
    var el = $('#toast');
    if (!el) return;
    el.textContent = m; el.className = 'toast' + (err ? ' err' : '');
    setTimeout(function () { el.classList.add('hidden'); }, 3000);
  }

  function apiGet(type) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var url = base + (base.indexOf('?') < 0 ? '?' : '&') + 'type=' + encodeURIComponent(type) +
      '&token=' + encodeURIComponent(token());
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }

  /* ── 접수 행 → 자문사 딜 레코드 ── */
  function isAdvisor(row) {
    var t = String(row.request_type || '');
    if (t) return /자문사딜|자문사\s*딜|advisor/i.test(t);
    var memo = String(row.memo || '');
    return /자문사딜/.test(memo) || /^\[자문사딜\]/.test(String(row.asset_name || ''));
  }
  function memoKV(memo) {
    var out = {};
    String(memo || '').split('|').forEach(function (seg) {
      var i = seg.indexOf('=');
      if (i < 0) return;
      var k = seg.slice(0, i).trim();
      var v = seg.slice(i + 1).trim();
      if (k) out[k] = v;
    });
    return out;
  }
  function kv(kvObj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var hit = Object.keys(kvObj).filter(function (k) { return k.indexOf(keys[i]) >= 0; })[0];
      if (hit && kvObj[hit]) return kvObj[hit];
    }
    return '';
  }
  function stageOf(row) {
    var st = String(row.stage || row.status || '').trim();
    if (!st || st === '접수' || st === '신규' || st === 'new') return '접수';
    for (var i = 0; i < STAGES.length; i++) if (st.indexOf(STAGES[i]) === 0) return STAGES[i];
    if (/완료|종결|계약\s*체결/.test(st)) return '완료';
    if (/진행|착수/.test(st)) return '진행';
    if (/계약|선정/.test(st)) return '자문계약';
    if (/NDA|자료|실사/.test(st)) return 'NDA·자료';
    if (/자격|검토|확인/.test(st)) return '자격·실적 확인';
    return '접수';
  }
  function whenOf(row) {
    return String(row.timestamp || row.at || row.created_at || '').replace('T', ' ').slice(0, 16);
  }
  function daysOf(row) {
    var t = Date.parse(String(row.timestamp || row.at || row.created_at || '').replace(' ', 'T'));
    if (isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }
  function companyOf(row) {
    if (isAdmin()) return row.company || row.blind_name || '';
    return row.blind_name || '비공개 자문사';
  }
  function personOf(row) {
    if (isAdmin()) return [row.name, row.title].filter(Boolean).join(' ');
    return row.name ? String(row.name).slice(0, 1) + '○○' : '';
  }

  function records() {
    return S.items.map(function (r) {
      var m = memoKV(r.memo);
      return {
        raw: r,
        id: r.id || '',
        when: whenOf(r),
        days: daysOf(r),
        stage: stageOf(r),
        advType: kv(m, ['자문 유형', '자문유형']) || '',
        deal: String(r.asset_name || '').replace(/^\[자문사딜\]\s*/, ''),
        company: companyOf(r),
        person: personOf(r),
        phone: isAdmin() ? (r.phone || '') : '',
        email: isAdmin() ? (r.email || '') : '',
        cred: kv(m, ['자격']) || '',
        fee: kv(m, ['수수료', '보수']) || '',
        region: r.region || kv(m, ['권역']) || '',
        memo: kv(m, ['메모', '비고']) || ''
      };
    });
  }

  function filtered() {
    var q = S.q.toLowerCase();
    return records().filter(function (r) {
      if (S.stage !== 'ALL' && r.stage !== S.stage) return false;
      if (!q) return true;
      return [r.deal, r.company, r.person, r.advType, r.cred, r.fee, r.region, r.memo]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function stageCounts() {
    var c = {};
    records().forEach(function (r) { c[r.stage] = (c[r.stage] || 0) + 1; });
    return c;
  }

  /* ── 화면 ── */
  function shell() {
    var c = stageCounts();
    var total = records().length;
    var h = '';
    h += '<div class="adv-head">';
    h += '<div><h2>🧾 자문사 딜 프로세싱</h2>' +
      '<p>업무신청에서 접수된 <b>자문사 딜 참여</b>를 단계별로 처리하는 시트입니다. ' +
      '접수 → 자격·실적 확인 → NDA·자료 → 자문계약 → 진행 → 완료 순으로 관리합니다.' +
      (isAdmin() ? '' : ' 자문사명은 <b>🔒 블라인드</b>로 표시됩니다.') + '</p>' +
      '<p class="adv-meta">총 <b>' + total + '</b>건 · 기준 ' + esc(todayStr()) + ' · 데이터: 비공개 시트 <b>lois</b>(request_type = 자문사딜)</p></div>';
    h += '<div class="adv-tools">' +
      '<button type="button" class="btn btn-primary" data-adv="new">＋ 자문사 딜 참여 접수</button>' +
      '<button type="button" class="btn btn-ghost" data-adv="reload">↻ 새로고침</button>' +
      '<button type="button" class="btn btn-ghost" data-adv="csv">📥 목록 CSV</button></div>';
    h += '</div>';

    h += '<div class="adv-stages">';
    h += '<button type="button" class="adv-stage' + (S.stage === 'ALL' ? ' is-on' : '') + '" data-adv-stage="ALL">' +
      '<b>전체</b><span>' + total + '</span></button>';
    STAGES.forEach(function (st, i) {
      h += '<button type="button" class="adv-stage' + (S.stage === st ? ' is-on' : '') + ' s' + i + '" data-adv-stage="' + esc(st) + '">' +
        '<b>' + (i + 1) + '. ' + esc(st) + '</b><span>' + (c[st] || 0) + '</span></button>';
    });
    h += '</div>';

    h += '<div class="adv-toolbar">' +
      '<input id="advQ" type="search" data-enter="search" placeholder="대상 딜 · 자문사 · 자격 · 메모 검색" autocomplete="off">' +
      '<span id="advCount" class="adv-count"></span></div>';

    h += '<div id="advBody" class="adv-body"><p class="adv-empty">불러오는 중…</p></div>';
    return h;
  }

  function rowHTML(r) {
    var idx = STAGES.indexOf(r.stage);
    var pct = idx < 0 ? 0 : Math.round(((idx + 1) / STAGES.length) * 100);
    var d = (r.days === null ? '' : 'D+' + r.days);
    return '<tr>' +
      '<td class="nowrap adv-when">' + esc(r.when) + (d ? '<em>' + d + '</em>' : '') + '</td>' +
      '<td><span class="adv-pill s' + idx + '">' + esc(r.stage) + '</span>' +
        '<span class="adv-bar"><i style="width:' + pct + '%"></i></span></td>' +
      '<td class="nowrap">' + esc(r.advType || '—') + '</td>' +
      '<td class="wide-cell"><b>' + esc(r.deal || '(대상 미정)') + '</b>' +
        (r.region ? '<span class="adv-sub">' + esc(r.region) + '</span>' : '') +
        (r.cred ? '<span class="adv-sub">자격 · ' + esc(r.cred) + '</span>' : '') +
        (r.memo ? '<span class="adv-sub">' + esc(r.memo.slice(0, 120)) + '</span>' : '') + '</td>' +
      '<td>' + esc(r.company) + '</td>' +
      '<td class="nowrap">' + esc(r.person) + '</td>' +
      '<td class="nowrap">' + esc(r.phone || '—') + '</td>' +
      '<td class="nowrap">' + esc(r.fee || '—') + '</td>' +
      '</tr>';
  }

  function paint() {
    var body = $('#advBody');
    if (!body) return;
    var rows = filtered();
    var cnt = $('#advCount');
    if (cnt) cnt.textContent = rows.length + '건 / 전체 ' + records().length + '건';
    if (!S.loaded) { body.innerHTML = '<p class="adv-empty">불러오는 중…</p>'; return; }
    if (!rows.length) {
      body.innerHTML = '<div class="adv-empty adv-guide">' +
        '<p><b>접수된 자문사 딜이 없습니다.</b></p>' +
        '<p>업무신청 → <b>🧾 자문사 딜 참여</b>에서 자문사(회계·감정·기술·법률·AMC) 참여 의향을 접수하면, ' +
        '이 시트에 단계별로 쌓입니다.</p>' +
        '<p class="adv-guide-btns"><button type="button" class="btn btn-primary" data-adv="new">＋ 자문사 딜 참여 접수</button>' +
        '<button type="button" class="btn btn-ghost" data-adv="open-hub">딜·참여 등록 허브 열기</button></p></div>';
      return;
    }
    body.innerHTML = '<div class="adv-table-wrap"><table class="adv-table"><thead><tr>' +
      '<th>접수</th><th>단계</th><th>자문 유형</th><th>대상 딜 · 자격</th>' +
      '<th>자문사</th><th>담당</th><th>연락처</th><th>수수료</th>' +
      '</tr></thead><tbody>' + rows.map(rowHTML).join('') + '</tbody></table></div>' +
      '<p class="adv-foot">단계는 접수 행의 <b>status</b> 값을 따릅니다. 단계 변경·메모는 접수 목록(📥)에서 확인하세요.' +
      (isAdmin() ? '' : ' 자문사명·연락처는 관리자만 볼 수 있어 블라인드로 표시됩니다.') + '</p>';
  }

  function todayStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function load(force) {
    if (S.loading) return Promise.resolve();
    if (S.loaded && !force) { paint(); return Promise.resolve(); }
    S.loading = true;
    paint();
    function done(items) {
      S.items = (items || []).filter(isAdvisor);
      S.loaded = true;
      S.loading = false;
      paint();
    }
    return apiGet('requests').then(function (j) {
      if (j && j.ok && j.items) return done(j.items);
      return apiGet('lois').then(function (j2) {
        return done((j2 && j2.ok && j2.items) ? j2.items : []);
      });
    }).catch(function () { done([]); });
  }

  function csvOut() {
    var rows = filtered();
    if (!rows.length) { toast('내보낼 자문사 딜이 없습니다.', true); return; }
    var head = ['접수일시', '단계', '경과일', '자문 유형', '대상 딜', '권역', '자문사', '담당', '연락처', '이메일', '자격·실적', '수수료', '비고'];
    var esc2 = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var csv = '\ufeff' + head.join(',') + '\n' + rows.map(function (r) {
      return [r.when, r.stage, r.days === null ? '' : r.days, r.advType, r.deal, r.region, r.company, r.person, r.phone, r.email, r.cred, r.fee, r.memo].map(esc2).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'AssetBridge_자문사딜_' + (S.stage === 'ALL' ? '전체' : S.stage) + '_' + todayStr().replace(/-/g, '') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
    toast(rows.length + '건을 CSV로 저장했습니다.');
  }

  function bind() {
    var host = $('#adviseView');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var st = e.target.closest('[data-adv-stage]');
      if (st) { S.stage = st.getAttribute('data-adv-stage'); renderStageChips(); paint(); return; }
      var b = e.target.closest('[data-adv]');
      if (!b) return;
      var act = b.getAttribute('data-adv');
      if (act === 'new') { if (window.NAI_HUB) window.NAI_HUB.open('advisor'); return; }
      if (act === 'open-hub') { if (window.NAI_HUB) window.NAI_HUB.open('sale'); return; }
      if (act === 'reload') { load(true); return; }
      if (act === 'csv') { csvOut(); return; }
    });
    host.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'advQ') { S.q = e.target.value; paint(); }
    });
    host.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      if (e.target && e.target.id === 'advQ') { e.preventDefault(); S.q = e.target.value; paint(); }
    });
  }

  function renderStageChips() {
    var host = $('#adviseView .adv-stages');
    if (!host) return;
    var c = stageCounts();
    var total = records().length;
    var h = '<button type="button" class="adv-stage' + (S.stage === 'ALL' ? ' is-on' : '') + '" data-adv-stage="ALL"><b>전체</b><span>' + total + '</span></button>';
    STAGES.forEach(function (st, i) {
      h += '<button type="button" class="adv-stage' + (S.stage === st ? ' is-on' : '') + ' s' + i + '" data-adv-stage="' + esc(st) + '">' +
        '<b>' + (i + 1) + '. ' + esc(st) + '</b><span>' + (c[st] || 0) + '</span></button>';
    });
    host.innerHTML = h;
  }

  function show() {
    var host = $('#adviseView');
    if (!host) return;
    if (!host.dataset.ready) {
      host.innerHTML = shell();
      host.dataset.ready = '1';
      bind();
    } else {
      renderStageChips();
    }
    load(false);
  }

  window.NAI_ADVISE = { show: show, reload: function () { load(true); } };
})();
