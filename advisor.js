/* =========================================================================
   Open AI Asset Bridge — advisor.js  (🧾 자문사 딜, 2026-11-28 개편)
   -------------------------------------------------------------------------
   [개편 내용]
   기존 '자문사 딜 참여 접수(lois) 처리 시트' → '자문사별 매각 자문 진행현황판'
   - 상단: 자문사 그룹(Big4·글로벌PM·국내) · 자문사 · 진행단계 필터, 요약 타일
   - 본문: 자산 카드(자산·섹터·권역·규모·자문사·단계·매도자·포인트·출처)
   - 하단: 자문사별 요약 매트릭스 + 자문사 동향 + (접이식) 참여 접수 처리 시트
   데이터는 advisordata.js(공개 보도·딜북·SPI·OAAB 자산 DB 확인분)에서 읽습니다.
   접수(lois) 시트는 읽기 전용으로 그대로 유지합니다.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var DATA = window.NAI_ADVISOR_DATA || { advisors: [], deals: [], stageDefs: [] };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var ADV = {};
  DATA.advisors.forEach(function (a) { ADV[a.id] = a; });
  var STAGE = {};
  DATA.stageDefs.forEach(function (s) { STAGE[s.id] = s; });
  var STAGE_ORDER = DATA.stageDefs.map(function (s) { return s.id; });

  var SECTOR = {
    office: { label: '오피스', icon: '🏢' },
    logistics: { label: '물류', icon: '📦' },
    hotel: { label: '호텔', icon: '🏨' },
    golf: { label: '골프', icon: '⛳' },
    retail: { label: '리테일', icon: '🛍️' },
    land: { label: '개발부지', icon: '🗺️' },
    corporate: { label: '기업 M&A', icon: '🏭' }
  };

  var S = { group: 'all', adv: '', stage: 'all', q: '', view: 'card', intakeOpen: false };

  /* ───────────── 공통 유틸 ───────────── */
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
  function fmtNum(n) { return (n === null || n === undefined || isNaN(n)) ? '' : Number(n).toLocaleString('ko-KR'); }
  function todayStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function advOf(id) { return ADV[id] || { id: id, name: id, short: id, group: 'etc', color: '#64748b' }; }
  function advNames(d) {
    if (!d.advisors || !d.advisors.length) return '';
    return d.advisors.map(function (id) { return advOf(id).short; }).join(' · ');
  }
  function stageIdx(id) { var i = STAGE_ORDER.indexOf(id); return i < 0 ? 0 : i; }

  /* ───────────── 필터 ───────────── */
  function inGroup(d) {
    if (S.group === 'all') return true;
    if (!d.advisors || !d.advisors.length) return false;
    return d.advisors.some(function (id) { return advOf(id).group === S.group; });
  }
  function matches(d) {
    if (S.adv && (d.advisors || []).indexOf(S.adv) < 0) return false;
    if (!S.adv && !inGroup(d)) return false;
    if (S.stage !== 'all' && d.stage !== S.stage) return false;
    var q = S.q.trim().toLowerCase();
    if (!q) return true;
    var blob = [d.name, d.where, d.seller, d.point, advNames(d), (d.co || []).join(' '),
      SECTOR[d.sector] && SECTOR[d.sector].label, d.region, d.price].join(' ').toLowerCase();
    return blob.indexOf(q) >= 0;
  }
  function rows() {
    return DATA.deals.filter(matches).slice().sort(function (a, b) {
      var sa = stageIdx(a.stage), sb = stageIdx(b.stage);
      if (sa !== sb) return sa - sb;
      return String(b.asOf).localeCompare(String(a.asOf));
    });
  }
  function stageCount(id) {
    return DATA.deals.filter(function (d) { return d.stage === id; }).length;
  }
  function advCount(id) {
    return DATA.deals.filter(function (d) { return (d.advisors || []).indexOf(id) >= 0; }).length;
  }
  function sumVal(list) {
    var sum = 0, n = 0;
    list.forEach(function (d) { if (typeof d.val === 'number') { sum += d.val; n++; } });
    return { sum: sum, n: n };
  }

  /* ───────────── 화면: 헤더 ───────────── */
  function shell() {
    var live = DATA.deals.filter(function (d) { return d.stage !== 'done'; });
    var ex = DATA.deals.filter(function (d) { return d.stage === 'ex' || d.stage === 'spa'; });
    var undecided = DATA.deals.filter(function (d) { return !d.advisors.length; });
    var v = sumVal(DATA.deals);
    var h = '';
    h += '<div class="adx-head">';
    h += '<div class="adx-head-main">' +
      '<h2>🧾 자문사 딜 — 자문사별 매각 자문 진행현황판</h2>' +
      '<p>Big 4 회계법인 · 글로벌 PM · 국내 자문사가 <b>지금 어느 자산을 어느 단계에서</b> 맡고 있는지 한 화면에 정리했습니다. ' +
      '투자자·자문사 모두 타사 진행 딜까지 비교할 수 있습니다.</p>' +
      '<p class="adx-meta">기준 <b>' + esc(DATA.asOf) + '</b> · 자문사 <b>' + (DATA.advisors.length - 1) + '곳</b>+기타 · ' +
      '수록 <b>' + DATA.deals.length + '건</b> · 규모 확인분 합계 <b>' + fmtNum(v.sum) + '억원</b>(' + v.n + '건, 거론가·추산 포함) ' +
      '· 출처: 보도·딜북·SPI·각사 발표 + OAAB 자산 DB</p>' +
      '</div>';
    h += '<div class="adx-tools">' +
      '<button type="button" class="btn btn-primary" data-adx="intake">＋ 자문사 딜 참여 접수</button>' +
      '<button type="button" class="btn btn-ghost" data-adx="csv">📥 목록 CSV</button>' +
      '</div></div>';

    h += '<div class="adx-stats">' +
      statTile('진행 중 딜', live.length, '건', '완료·종결 제외') +
      statTile('우협·계약 단계', ex.length, '건', '가격 협상·계약 구간') +
      statTile('자문사 미정', undecided.length, '건', 'RFP 진행 중') +
      statTile('Big 4 비중', big4Share(), '%', '진행 딜 기준') +
      '</div>';

    /* 그룹 */
    h += '<div class="adx-groups">';
    DATA.groups && DATA.groups.forEach(function (g) {
      h += '<button type="button" class="adx-group' + (S.group === g.id ? ' is-on' : '') + '" data-adx-group="' + esc(g.id) + '">' + esc(g.label) + '</button>';
    });
    h += '</div>';

    /* 자문사 칩 */
    h += '<div class="adx-advs">';
    h += '<button type="button" class="adx-adv all' + (!S.adv ? ' is-on' : '') + '" data-adx-adv="">전체 자문사 <b>' + DATA.deals.length + '</b></button>';
    DATA.advisors.forEach(function (a) {
      var n = advCount(a.id);
      var show = S.group === 'all' || a.group === S.group;
      if (!show) return;
      h += '<button type="button" class="adx-adv' + (S.adv === a.id ? ' is-on' : '') + (n ? '' : ' is-zero') + '" data-adx-adv="' + esc(a.id) + '" ' +
        'style="--adx-c:' + esc(a.color) + '" title="' + esc(a.memo) + '">' +
        '<span class="dot"></span>' + esc(a.short) + ' <b>' + n + '</b></button>';
    });
    h += '</div>';

    /* 단계 */
    h += '<div class="adx-stages">';
    h += '<button type="button" class="adx-stage all' + (S.stage === 'all' ? ' is-on' : '') + '" data-adx-stage="all">전체 <b>' + DATA.deals.length + '</b></button>';
    DATA.stageDefs.forEach(function (st) {
      h += '<button type="button" class="adx-stage' + (S.stage === st.id ? ' is-on' : '') + '" data-adx-stage="' + esc(st.id) + '" style="--adx-c:' + esc(st.color) + '">' +
        '<i></i>' + esc(st.label) + ' <b>' + stageCount(st.id) + '</b></button>';
    });
    h += '</div>';

    /* 툴바 */
    h += '<div class="adx-toolbar">' +
      '<input id="adxQ" type="search" placeholder="자산 · 자문사 · 매도자 · 권역 검색" autocomplete="off" value="' + esc(S.q) + '">' +
      '<div class="adx-views">' +
      '<button type="button" class="adx-view' + (S.view === 'card' ? ' is-on' : '') + '" data-adx-view="card">카드</button>' +
      '<button type="button" class="adx-view' + (S.view === 'table' ? ' is-on' : '') + '" data-adx-view="table">표</button>' +
      '</div>' +
      '<span id="adxCount" class="adx-count"></span></div>';

    h += '<div id="adxBody" class="adx-body"></div>';
    h += '<div id="adxMatrix" class="adx-matrix"></div>';
    h += '<div class="adx-notes-wrap"><h3 class="adx-h3">📌 자문사 동향 메모</h3><div id="adxNotes" class="adx-notes"></div></div>';
    h += intakeShell();
    return h;
  }

  function statTile(label, value, unit, sub) {
    return '<div class="adx-tile"><span>' + esc(label) + '</span>' +
      '<b>' + esc(value) + '<em>' + esc(unit) + '</em></b>' +
      '<i>' + esc(sub) + '</i></div>';
  }
  function big4Share() {
    var live = DATA.deals.filter(function (d) { return d.stage !== 'done' && d.advisors && d.advisors.length; });
    var b4 = live.filter(function (d) { return d.advisors.some(function (id) { return advOf(id).group === 'big4'; }); });
    return live.length ? Math.round(b4.length / live.length * 100) : 0;
  }

  /* ───────────── 카드/표 ───────────── */
  function stagePill(id) {
    var st = STAGE[id] || { label: id, color: '#64748b' };
    return '<span class="adx-pill" style="--adx-c:' + esc(st.color) + '">' + esc(st.label) + '</span>';
  }
  function advChips(d) {
    if (!d.advisors || !d.advisors.length) {
      return '<span class="adx-advchip none">자문사 선정 중</span>' +
        (d.co && d.co.length ? '<span class="adx-advchip co">공동·중개 ' + esc(d.co.join('·')) + '</span>' : '');
    }
    var out = d.advisors.map(function (id) {
      var a = advOf(id);
      return '<span class="adx-advchip" style="--adx-c:' + esc(a.color) + '">' + esc(a.name) + '</span>';
    }).join('');
    if (d.co && d.co.length) out += '<span class="adx-advchip co">＋' + esc(d.co.join('·')) + '</span>';
    return out;
  }
  function srcLinks(d) {
    return (d.src || []).filter(function (s) { return s && s.label; }).map(function (s) {
      if (!s.url) return '<span class="adx-src">' + esc(s.label) + '</span>';
      return '<a class="adx-src" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + '</a>';
    }).join(' · ');
  }
  function cardHTML(d) {
    var st = STAGE[d.stage] || {};
    var sec = SECTOR[d.sector] || { label: d.sector, icon: '' };
    var priceLine = d.price ? '<div class="adx-price">' + esc(d.price) + (d.est ? '<em>추산·거론</em>' : '') + '</div>' : '';
    return '<article class="adx-card" style="--adx-c:' + esc(st.color || '#64748b') + '">' +
      '<div class="adx-card-top">' +
        '<div class="adx-sec">' + (sec.icon ? sec.icon + ' ' : '') + esc(sec.label) + '</div>' +
        '<div class="adx-region">' + esc(d.region || '') + '</div>' +
        stagePill(d.stage) +
      '</div>' +
      '<h3>' + esc(d.name) + '</h3>' +
      '<p class="adx-where">' + esc(d.where || '') + (d.size ? ' · ' + esc(d.size) : '') + '</p>' +
      priceLine +
      '<div class="adx-advisors">' + advChips(d) + '</div>' +
      '<dl class="adx-kv">' +
        '<dt>매도자</dt><dd>' + esc(d.seller || '—') + '</dd>' +
        '<dt>포인트</dt><dd>' + esc(d.point || '') + '</dd>' +
      '</dl>' +
      '<div class="adx-foot"><span class="adx-date">' + esc(d.asOf || '') + ' 기준</span>' +
        '<span class="adx-srcs">' + srcLinks(d) + '</span></div>' +
      '</article>';
  }
  function tableHTML(list) {
    return '<div class="adx-table-wrap"><table class="adx-table"><thead><tr>' +
      '<th>단계</th><th>자산</th><th>섹터·권역</th><th>규모 / 금액</th><th>자문사</th><th>매도자</th><th>기준일·출처</th>' +
      '</tr></thead><tbody>' + list.map(function (d) {
        var sec = SECTOR[d.sector] || { label: d.sector, icon: '' };
        return '<tr>' +
          '<td class="nowrap">' + stagePill(d.stage) + '</td>' +
          '<td class="adx-t-name"><b>' + esc(d.name) + '</b><span>' + esc(d.where || '') + '</span></td>' +
          '<td class="nowrap">' + (sec.icon ? sec.icon + ' ' : '') + esc(sec.label) + ' · ' + esc(d.region || '') + '</td>' +
          '<td>' + (d.size ? esc(d.size) + '<br>' : '') + '<b>' + esc(d.price || '미공개') + '</b></td>' +
          '<td>' + (advNames(d) || '<span class="muted">자문사 선정 중</span>') + ((d.co && d.co.length) ? '<span class="adx-co">+' + esc(d.co.join('·')) + '</span>' : '') + '</td>' +
          '<td>' + esc(d.seller || '—') + '</td>' +
          '<td class="adx-src-cell">' + esc(d.asOf || '') + '<br>' + srcLinks(d) + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function paintBody() {
    var body = $('#adxBody');
    if (!body) return;
    var list = rows();
    var cnt = $('#adxCount');
    if (cnt) cnt.textContent = list.length + '건 / 전체 ' + DATA.deals.length + '건';
    if (!list.length) {
      body.innerHTML = '<p class="adx-empty">조건에 맞는 자문 딜이 없습니다. 필터를 초기화하거나 검색어를 지워 보세요.</p>';
      return;
    }
    body.innerHTML = (S.view === 'table')
      ? tableHTML(list)
      : '<div class="adx-grid">' + list.map(cardHTML).join('') + '</div>';
  }

  /* ───────────── 자문사 요약 매트릭스 ───────────── */
  function paintMatrix() {
    var host = $('#adxMatrix');
    if (!host) return;
    var h = '<h3 class="adx-h3">📊 자문사별 요약 <span>진행 단계 분포 · 확인 규모</span></h3>';
    h += '<div class="adx-mtable-wrap"><table class="adx-mtable"><thead><tr>' +
      '<th>자문사</th><th>그룹</th><th class="num">진행</th>' +
      DATA.stageDefs.map(function (s) { return '<th class="num" title="' + esc(s.label) + '">' + esc(s.short) + '</th>'; }).join('') +
      '<th class="num">확인 규모(억)</th><th>최근 진행 딜</th></tr></thead><tbody>';
    DATA.advisors.forEach(function (a) {
      var mine = DATA.deals.filter(function (d) { return (d.advisors || []).indexOf(a.id) >= 0; });
      var live = mine.filter(function (d) { return d.stage !== 'done'; });
      var v = sumVal(mine);
      var recent = mine.slice().sort(function (x, y) { return String(y.asOf).localeCompare(String(x.asOf)); })[0];
      h += '<tr>' +
        '<td class="adx-m-name" style="--adx-c:' + esc(a.color) + '"><span class="dot"></span><b>' + esc(a.name) + '</b></td>' +
        '<td class="nowrap">' + esc(groupLabel(a.group)) + '</td>' +
        '<td class="num"><b>' + live.length + '</b></td>' +
        DATA.stageDefs.map(function (s) {
          var n = mine.filter(function (d) { return d.stage === s.id; }).length;
          return '<td class="num' + (n ? '' : ' zero') + '">' + (n || '·') + '</td>';
        }).join('') +
        '<td class="num">' + (v.n ? fmtNum(v.sum) : '—') + '</td>' +
        '<td class="adx-m-recent">' + (recent ? esc(recent.name) + ' <em>' + esc(STAGE[recent.stage] ? STAGE[recent.stage].short : '') + '</em>' : '—') + '</td>' +
        '</tr>';
      h += '<tr class="adx-m-memo"><td colspan="' + (4 + DATA.stageDefs.length + 1) + '">' + esc(a.memo) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    host.innerHTML = h;
  }
  function groupLabel(g) {
    return ({ big4: 'Big 4', global: '글로벌 PM', domestic: '국내·기타' })[g] || g;
  }

  function paintNotes() {
    var host = $('#adxNotes');
    if (!host) return;
    host.innerHTML = DATA.notes.map(function (n) {
      return '<div class="adx-note"><b>' + esc(n.title) + '</b><p>' + esc(n.body) + '</p>' +
        (n.src && n.src.label ? '<p class="adx-note-src">출처: ' +
          (n.src.url ? '<a href="' + esc(n.src.url) + '" target="_blank" rel="noopener">' + esc(n.src.label) + '</a>' : esc(n.src.label)) + '</p>' : '') +
        '</div>';
    }).join('');
  }

  /* ───────────── CSV ───────────── */
  function csvOut() {
    var list = rows();
    if (!list.length) { toast('내보낼 자문 딜이 없습니다.', true); return; }
    var head = ['단계', '자산', '섹터', '권역', '위치', '규모', '금액', '자문사', '공동·중개', '매도자', '포인트', '기준일', '출처'];
    var q = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var csv = '\ufeff' + head.join(',') + '\n' + list.map(function (d) {
      return [STAGE[d.stage] ? STAGE[d.stage].label : d.stage, d.name, SECTOR[d.sector] ? SECTOR[d.sector].label : d.sector, d.region,
        d.where, d.size, d.price, advNames(d) || '자문사 선정 중', (d.co || []).join('·'), d.seller, d.point, d.asOf,
        (d.src || []).map(function (s) { return s.label; }).join(' / ')].map(q).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'OAAB_자문사딜_' + todayStr().replace(/-/g, '') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
    toast(list.length + '건을 CSV로 저장했습니다.');
  }

  /* ═════════════ 접수 시트(기존 기능 유지) ═════════════ */
  var IN = { items: [], loaded: false, loading: false, stage: 'ALL', q: '' };
  var IN_STAGES = ['접수', '자격·실적 확인', 'NDA·자료', '자문계약', '진행', '완료'];

  function apiGet(type) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var url = base + (base.indexOf('?') < 0 ? '?' : '&') + 'type=' + encodeURIComponent(type) +
      '&token=' + encodeURIComponent(token());
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function isAdvisorRow(row) {
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
      var k = seg.slice(0, i).trim(), v = seg.slice(i + 1).trim();
      if (k) out[k] = v;
    });
    return out;
  }
  function kv(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var hit = Object.keys(obj).filter(function (k) { return k.indexOf(keys[i]) >= 0; })[0];
      if (hit && obj[hit]) return obj[hit];
    }
    return '';
  }
  function stageOf(row) {
    var st = String(row.stage || row.status || '').trim();
    if (!st || st === '접수' || st === '신규' || st === 'new') return '접수';
    for (var i = 0; i < IN_STAGES.length; i++) if (st.indexOf(IN_STAGES[i]) === 0) return IN_STAGES[i];
    if (/완료|종결|계약\s*체결/.test(st)) return '완료';
    if (/진행|착수/.test(st)) return '진행';
    if (/계약|선정/.test(st)) return '자문계약';
    if (/NDA|자료|실사/.test(st)) return 'NDA·자료';
    if (/자격|검토|확인/.test(st)) return '자격·실적 확인';
    return '접수';
  }
  function inRecords() {
    return IN.items.map(function (r) {
      var m = memoKV(r.memo);
      return {
        raw: r,
        when: String(r.timestamp || r.at || r.created_at || '').replace('T', ' ').slice(0, 16),
        stage: stageOf(r),
        advType: kv(m, ['자문 유형', '자문유형']) || '',
        deal: String(r.asset_name || '').replace(/^\[자문사딜\]\s*/, ''),
        company: isAdmin() ? (r.company || r.blind_name || '') : (r.blind_name || '비공개 자문사'),
        person: isAdmin() ? [r.name, r.title].filter(Boolean).join(' ') : (r.name ? String(r.name).slice(0, 1) + '○○' : ''),
        phone: isAdmin() ? (r.phone || '') : '',
        email: isAdmin() ? (r.email || '') : '',
        cred: kv(m, ['자격']) || '',
        fee: kv(m, ['수수료', '보수']) || '',
        region: r.region || kv(m, ['권역']) || '',
        memo: kv(m, ['메모', '비고']) || ''
      };
    });
  }
  function inFiltered() {
    var q = IN.q.toLowerCase();
    return inRecords().filter(function (r) {
      if (IN.stage !== 'ALL' && r.stage !== IN.stage) return false;
      if (!q) return true;
      return [r.deal, r.company, r.person, r.advType, r.cred, r.fee, r.region, r.memo].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function intakeShell() {
    return '<details class="adx-intake" id="adxIntake">' +
      '<summary><b>📥 자문사 딜 참여 접수 · 처리 시트</b>' +
      '<span>업무신청으로 접수된 자문사 참여 의향을 접수 → 자격·실적 확인 → NDA·자료 → 자문계약 → 진행 → 완료 순으로 관리합니다. (별도 시트 lois · 읽기 전용)</span></summary>' +
      '<div class="adx-intake-body">' +
      '<div class="adx-intake-bar">' +
      '<button type="button" class="btn btn-primary" data-adx="intake-new">＋ 자문사 딜 참여 접수</button>' +
      '<button type="button" class="btn btn-ghost" data-adx="intake-reload">↻ 새로고침</button>' +
      '<button type="button" class="btn btn-ghost" data-adx="intake-csv">📥 접수 CSV</button>' +
      '<input id="adxInQ" type="search" placeholder="대상 딜 · 자문사 · 자격 검색" autocomplete="off">' +
      '<span id="adxInCount" class="adx-count"></span></div>' +
      '<div id="adxInStages" class="adx-in-stages"></div>' +
      '<div id="adxInBody" class="adx-in-body"><p class="adx-empty">접이식 목록을 열면 접수 내역을 불러옵니다.</p></div>' +
      '</div></details>';
  }
  function paintIntakeStages() {
    var host = $('#adxInStages');
    if (!host) return;
    var counts = {};
    inRecords().forEach(function (r) { counts[r.stage] = (counts[r.stage] || 0) + 1; });
    var total = inRecords().length;
    var h = '<button type="button" class="adx-in-chip' + (IN.stage === 'ALL' ? ' is-on' : '') + '" data-adx-instage="ALL">전체 <b>' + total + '</b></button>';
    IN_STAGES.forEach(function (st, i) {
      h += '<button type="button" class="adx-in-chip' + (IN.stage === st ? ' is-on' : '') + '" data-adx-instage="' + esc(st) + '">' +
        (i + 1) + '. ' + esc(st) + ' <b>' + (counts[st] || 0) + '</b></button>';
    });
    host.innerHTML = h;
  }
  function paintIntake() {
    var body = $('#adxInBody');
    if (!body) return;
    if (!IN.loaded) { body.innerHTML = '<p class="adx-empty">불러오는 중…</p>'; return; }
    var list = inFiltered();
    var cnt = $('#adxInCount');
    if (cnt) cnt.textContent = list.length + '건 / 전체 ' + inRecords().length + '건';
    paintIntakeStages();
    if (!inRecords().length) {
      body.innerHTML = '<div class="adx-empty"><p><b>접수된 자문사 딜이 없습니다.</b></p>' +
        '<p>업무신청 → <b>🧾 자문사 딜 참여</b>에서 자문사 참여 의향을 접수하면 이 시트에 단계별로 쌓입니다.</p></div>';
      return;
    }
    if (!list.length) { body.innerHTML = '<p class="adx-empty">조건에 맞는 접수 건이 없습니다.</p>'; return; }
    body.innerHTML = '<div class="adx-table-wrap"><table class="adx-table"><thead><tr>' +
      '<th>접수</th><th>단계</th><th>자문 유형</th><th>대상 딜 · 자격</th><th>자문사</th><th>담당</th><th>연락처</th><th>수수료</th>' +
      '</tr></thead><tbody>' + list.map(function (r) {
        var idx = IN_STAGES.indexOf(r.stage);
        return '<tr>' +
          '<td class="nowrap">' + esc(r.when) + '</td>' +
          '<td class="nowrap"><span class="adv-pill s' + (idx < 0 ? 0 : idx) + '">' + esc(r.stage) + '</span></td>' +
          '<td class="nowrap">' + esc(r.advType || '—') + '</td>' +
          '<td class="adx-t-name"><b>' + esc(r.deal || '(대상 미정)') + '</b>' +
            (r.region ? '<span>' + esc(r.region) + '</span>' : '') +
            (r.cred ? '<span>자격 · ' + esc(r.cred) + '</span>' : '') +
            (r.memo ? '<span>' + esc(String(r.memo).slice(0, 120)) + '</span>' : '') + '</td>' +
          '<td>' + esc(r.company) + '</td>' +
          '<td class="nowrap">' + esc(r.person) + '</td>' +
          '<td class="nowrap">' + esc(r.phone || '—') + '</td>' +
          '<td class="nowrap">' + esc(r.fee || '—') + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="adx-in-foot">단계는 접수 행의 <b>status</b> 값을 따릅니다. 자문사명·연락처는 관리자만 볼 수 있습니다.</p>';
  }
  function loadIntake(force) {
    if (IN.loading) return Promise.resolve();
    if (IN.loaded && !force) { paintIntake(); return Promise.resolve(); }
    IN.loading = true;
    paintIntake();
    function done(items) { IN.items = (items || []).filter(isAdvisorRow); IN.loaded = true; IN.loading = false; paintIntake(); }
    return apiGet('requests').then(function (j) {
      if (j && j.ok && j.items) return done(j.items);
      return apiGet('lois').then(function (j2) { return done((j2 && j2.ok && j2.items) ? j2.items : []); });
    }).catch(function () { done([]); });
  }
  function intakeCsv() {
    var list = inFiltered();
    if (!list.length) { toast('내보낼 접수 건이 없습니다.', true); return; }
    var head = ['접수일시', '단계', '자문 유형', '대상 딜', '권역', '자문사', '담당', '연락처', '이메일', '자격·실적', '수수료', '비고'];
    var q = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var csv = '\ufeff' + head.join(',') + '\n' + list.map(function (r) {
      return [r.when, r.stage, r.advType, r.deal, r.region, r.company, r.person, r.phone, r.email, r.cred, r.fee, r.memo].map(q).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'AssetBridge_자문사딜접수_' + todayStr().replace(/-/g, '') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
    toast(list.length + '건을 CSV로 저장했습니다.');
  }

  /* ───────────── 이벤트 ───────────── */
  function bind() {
    var host = $('#adviseView');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var g = e.target.closest('[data-adx-group]');
      if (g) { S.group = g.getAttribute('data-adx-group'); S.adv = ''; renderChips(); paintBody(); return; }
      var a = e.target.closest('[data-adx-adv]');
      if (a) {
        var id = a.getAttribute('data-adx-adv') || '';
        S.adv = (id && S.adv !== id) ? id : '';
        if (S.adv) { var ad = ADV[S.adv]; if (ad && S.group !== 'all' && ad.group !== S.group) S.group = 'all'; }
        renderChips(); paintBody(); return;
      }
      var st = e.target.closest('[data-adx-stage]');
      if (st) {
        var v = st.getAttribute('data-adx-stage');
        S.stage = (v === 'all' || S.stage === v) ? 'all' : v;
        renderChips(); paintBody(); return;
      }
      var vw = e.target.closest('[data-adx-view]');
      if (vw) {
        S.view = vw.getAttribute('data-adx-view') || 'card';
        $$('.adx-view', host).forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-adx-view') === S.view); });
        paintBody(); return;
      }
      var b = e.target.closest('[data-adx]');
      if (b) {
        var act = b.getAttribute('data-adx');
        if (act === 'csv') { csvOut(); return; }
        if (act === 'intake') {
          if (window.NAI_HUB) window.NAI_HUB.open('advisor');
          return;
        }
        if (act === 'intake-new') { if (window.NAI_HUB) window.NAI_HUB.open('advisor'); return; }
        if (act === 'intake-reload') { loadIntake(true); return; }
        if (act === 'intake-csv') { intakeCsv(); return; }
      }
      var ins = e.target.closest('[data-adx-instage]');
      if (ins) { IN.stage = ins.getAttribute('data-adx-instage'); paintIntake(); return; }
    });
    host.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'adxQ') { S.q = e.target.value; paintBody(); }
      if (e.target && e.target.id === 'adxInQ') { IN.q = e.target.value; paintIntake(); }
    });
    host.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      if (e.target && e.target.id === 'adxQ') { e.preventDefault(); S.q = e.target.value; paintBody(); }
    });
    host.addEventListener('toggle', function (e) {
      if (e.target && e.target.id === 'adxIntake' && e.target.open && !IN.loaded) loadIntake(false);
    }, true);
  }

  /* 필터 영역만 다시 그립니다(입력 포커스 유지) */
  function renderChips() {
    var host = $('#adviseView');
    if (!host) return;
    var gWrap = $('.adx-groups', host);
    if (gWrap) {
      $$('.adx-group', gWrap).forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-adx-group') === S.group); });
    }
    var aWrap = $('.adx-advs', host);
    if (aWrap) {
      var h = '<button type="button" class="adx-adv all' + (!S.adv ? ' is-on' : '') + '" data-adx-adv="">전체 자문사 <b>' + DATA.deals.length + '</b></button>';
      DATA.advisors.forEach(function (a) {
        var n = advCount(a.id);
        if (S.group !== 'all' && a.group !== S.group) return;
        h += '<button type="button" class="adx-adv' + (S.adv === a.id ? ' is-on' : '') + (n ? '' : ' is-zero') + '" data-adx-adv="' + esc(a.id) + '" ' +
          'style="--adx-c:' + esc(a.color) + '" title="' + esc(a.memo) + '">' +
          '<span class="dot"></span>' + esc(a.short) + ' <b>' + n + '</b></button>';
      });
      aWrap.innerHTML = h;
    }
    var sWrap = $('.adx-stages', host);
    if (sWrap) {
      $$('.adx-stage', sWrap).forEach(function (b) {
        var v = b.getAttribute('data-adx-stage');
        b.classList.toggle('is-on', v === S.stage || (v === 'all' && S.stage === 'all'));
      });
    }
  }

  /* ───────────── 공개 API ───────────── */
  function show() {
    var host = $('#adviseView');
    if (!host) return;
    if (!host.dataset.ready) {
      host.innerHTML = shell();
      host.dataset.ready = '1';
      bind();
      paintNotes();
      paintMatrix();
      if (S.intakeOpen) loadIntake(false);
    }
    paintBody();
<<<<<<< HEAD
    if (window.NAI_DEALS && window.NAI_DEALS.mount) { try { window.NAI_DEALS.mount(document.getElementById('adviseView')); } catch (e) { /* noop */ } }
=======
>>>>>>> origin/main
  }

  window.NAI_ADVISE = {
    show: show,
    reload: function () { paintBody(); paintMatrix(); paintNotes(); if (IN.loaded) loadIntake(true); }
  };
})();
