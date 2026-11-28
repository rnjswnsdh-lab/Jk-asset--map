/* =========================================================================
   Open AI Asset Bridge — rfp.js  (📑 RFP 발주 — 의뢰인 화면, 2026-11-27)
   -------------------------------------------------------------------------
   자산운용사·리츠·매도인(의뢰인)이 물건을 맡길 때 쓰는 화면입니다.

     A. 물건 자료 업로드·정규화  — 렌트롤 / 오펙스 / PM 월간 리포트 / 기타
     B. RFP 작성·배포            — 표준 양식 + 물건별 조정, 인쇄·PDF·Word, 자문사 배부
     C. 제출 현황                — 초청 대비 제출/미제출
     D. 비교·평가·선정           — 항목 비교표 + 가중치 점수 + 순위 + 선정

   자문사의 응답·자료실·CA·입찰은 🤝 자문사 포털(portal.js)에서 처리합니다.
   저장·권한 규칙은 rfpcore.js 를 따릅니다.
   ========================================================================= */
(function () {
  'use strict';

  var C = window.NAI_RFPC;
  if (!C) return;
  var esc = C.esc, n0 = C.n0, num = C.num;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = { assetId: '', tab: 'docs', rfpId: '', evalRfpId: '', q: '', ready: false };

  function host() { return document.getElementById('rfpView'); }
  function modeBadge() {
    return C.SYNC.mode === 'server'
      ? '<span class="rfp-mode on">☁ 서버 동기화</span>'
      : '<span class="rfp-mode" title="Apps Script 에 type=rfp API 가 아직 없어 이 브라우저에만 저장됩니다.">💾 로컬 저장</span>';
  }
  function current() { return C.workOf(S.assetId) || { id: S.assetId, name: (C.assetOf(S.assetId) || {}).name || '물건' }; }

  /* ─────────────────────────── 껍데기 ─────────────────────────── */
  function shell() {
    return '<div class="rfp-shell">' +
      '<div class="rfp-top"><div class="rfp-title">' +
        '<h2>📑 RFP 발주 <span class="rfp-beta">의뢰인</span></h2>' +
        '<p>물건 자료(렌트롤·오펙스·PM 리포트)를 올려 정리하고, 그 데이터로 <b>매각 자문 RFP</b>를 만들어 자문사에 배부한 뒤, ' +
        '받은 제안서를 <b>항목별 비교표와 가중치 점수</b>로 평가해 선정합니다.</p>' +
        '<p class="rfp-meta">' + modeBadge() + '<span>자문사 응답·자료 인계·입찰은 <b>🤝 자문사 포털</b> 탭에서 이어집니다.</span></p>' +
      '</div><div class="rfp-top-actions">' +
        '<button type="button" class="btn btn-primary" data-rfp="asset-add">＋ 물건 불러오기</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp="import" title="이 브라우저에 저장된 RFP 데이터(JSON)를 불러옵니다">불러오기</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp="export">내보내기</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp="reload">↻</button>' +
      '</div></div>' +
      '<div class="rfp-steps">' +
        step('docs', '1', '물건 자료', '업로드 · 정규화') +
        step('rfps', '2', 'RFP 작성·배포', '양식 · 자문사 배부') +
        step('folder', '3', '📁 제출 폴더', '접수 · CA · 평가 · 선정') +
      '</div>' +
      '<div class="rfp-grid"><aside class="rfp-aside" id="rfpAside"></aside><main class="rfp-main" id="rfpMain"></main></div>' +
      '</div>';
  }
  function step(k, no, label, sub) {
    return '<button type="button" class="rfp-step' + (S.tab === k ? ' on' : '') + '" data-rfp-tab="' + k + '">' +
      '<b><i>' + no + '</i>' + esc(label) + '</b><span>' + esc(sub) + '</span></button>';
  }

  function paint() {
    var h = host();
    if (!h) return;
    if (!h.dataset.ready) {
      h.innerHTML = shell();
      h.dataset.ready = '1';
      bind();
    }
    $$('.rfp-step', h).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-rfp-tab') === S.tab); });
    paintAside();
    paintMain();
  }

  function paintAside() {
    var el = $('#rfpAside');
    if (!el) return;
    var ws = C.works();
    var h = '<div class="rfp-aside-head"><b>관리 중인 물건</b><span>' + ws.length + '</span></div>';
    if (!ws.length) {
      h += '<p class="rfp-aside-empty">아직 물건이 없습니다.<br><b>＋ 물건 불러오기</b>로 물건 DB에서 선택하세요.</p>';
    } else {
      h += '<div class="rfp-worklist">' + ws.map(function (w) {
        var docs = C.docsOf(w.id);
        var rfpN = C.rfpsOf(w.id).length;
        return '<button type="button" class="rfp-work' + (w.id === S.assetId ? ' on' : '') + '" data-rfp-work="' + esc(w.id) + '">' +
          '<strong>' + esc(w.name || w.asset_id) + '</strong>' +
          '<span class="rfp-work-sub">' + esc([w.sector, w.address].filter(Boolean).join(' · ')) + '</span>' +
          '<span class="rfp-work-meta">자료 ' + docs.length + ' · RFP ' + rfpN + ' · 제안 ' +
          C.list('submissions').filter(function (s) { return C.rfpsOf(w.id).some(function (r) { return r.id === s.rfp_id; }); }).length + '</span></button>';
      }).join('') + '</div>';
    }
    h += '<p class="rfp-aside-foot">물건 자료는 이 브라우저에 보관됩니다. JSON 내보내기로 백업할 수 있습니다.</p>';
    el.innerHTML = h;
  }

  function paintMain() {
    var el = $('#rfpMain');
    if (!el) return;
    if (!S.assetId) {
      el.innerHTML = '<div class="rfp-empty big"><b>평가할 물건을 선택하세요.</b>' +
        '<p>물건 DB에서 매각 자문을 맡길 물건을 불러오면 렌트롤·오펙스·PM 리포트 정리부터 RFP 발주까지 한 흐름으로 진행됩니다.</p>' +
        '<button type="button" class="btn btn-primary" data-rfp="asset-add">＋ 물건 불러오기</button></div>';
      return;
    }
    if (S.tab === 'rfps') el.innerHTML = rfpTab();
    else if (S.tab === 'folder') { paintFolder(el); return; }
    else el.innerHTML = docsTab();
  }

  function paintFolder(el) {
    if (!S.folderRfpId) {
      var rfps = C.rfpsOf(S.assetId);
      S.folderRfpId = rfps.length ? rfps[0].id : '';
    }
    var rfp = S.folderRfpId ? C.rfpOf(S.folderRfpId) : null;
    if (!rfp) {
      el.innerHTML = '<div class="rfp-empty"><b>제출 폴더를 열 RFP가 없습니다.</b>' +
        '<p><b>RFP 작성·배포</b>에서 RFP를 만든 뒤 제출 폴더로 넘어가세요.</p>' +
        '<button type="button" class="btn btn-ghost" data-rfp-tab="rfps">RFP 단계로</button></div>';
      return;
    }
    el.innerHTML = '<div class="rfp-folderbar">' + C.rfpsOf(S.assetId).map(function (r) {
      return '<button type="button" class="rfp-chip' + (r.id === S.folderRfpId ? ' on' : '') + '" data-rfp-folder="' + esc(r.id) + '">' + esc(r.title) + '</button>';
    }).join('') + '</div>' + (window.NAI_RFPFLOW ? window.NAI_RFPFLOW.html(rfp.id) : '<p class="rfp-hint">제출 폴더 모듈을 불러오지 못했습니다.</p>');
    if (window.NAI_RFPFLOW) window.NAI_RFPFLOW.bind(el, rfp.id, function () { paint(); });
  }

  /* ─────────────────────────── A. 자료 ─────────────────────────── */
  function docsTab() {
    var w = current(), b = C.assetBrief(S.assetId);
    var h = '<div class="rfp-sec-head"><div><h3>' + esc(w.name || '물건') + '</h3>' +
      '<p>' + esc([w.sector, w.address].filter(Boolean).join(' · ')) + '</p></div>' +
      '<div class="rfp-sec-tools"><button type="button" class="btn btn-primary" data-rfp="rfp-new">📑 이 물건으로 RFP 초안</button></div></div>';
    if (b.missing.length) {
      h += '<p class="rfp-hint">아직 없는 자료: <b>' + esc(b.missing.join(' · ')) + '</b> — RFP 초안의 개요는 있는 자료만으로 채워집니다.</p>';
    }
    h += '<div class="rfp-docgrid">';
    C.DOC_KINDS.forEach(function (k) { h += docCard(k, b); });
    h += '</div>';
    return h;
  }

  function docCard(kind, brief) {
    var docs = C.docsOf(S.assetId).filter(function (d) { return d.kind === kind.k; });
    var h = '<section class="rfp-doccard k-' + kind.k + '">' +
      '<div class="rfp-doccard-head"><div><b>' + kind.icon + ' ' + esc(kind.label) + '</b><span>' + esc(kind.note) + '</span></div>' +
      '<span class="rfp-doccard-tools">' +
        '<button type="button" class="mini-btn" data-rfp-upload="' + kind.k + '">⬆ 업로드</button>' +
        (kind.k === 'etc' ? '' : '<button type="button" class="mini-btn" data-rfp-paste="' + kind.k + '">⌨ 표 붙여넣기</button>') +
      '</span></div>';
    if (!docs.length) {
      h += '<p class="rfp-doccard-empty">등록된 파일이 없습니다. CSV·XLSX 파일을 올리면 표로 자동 정리됩니다.</p>';
    } else {
      h += '<ul class="rfp-filelist">' + docs.map(function (d) {
        return '<li><span class="rfp-file-ico">' + (/\.xlsx?$/i.test(d.name) ? '📊' : (/\.pdf$/i.test(d.name) ? '📄' : '📃')) + '</span>' +
          '<span class="rfp-file-main"><b>' + esc(d.name) + '</b>' +
          '<em>' + esc([d.month || '', C.bytes(d.size), (d.rows || []).length ? (d.rows.length - 1) + '행' : '', C.when(d.at)].filter(Boolean).join(' · ')) + '</em></span>' +
          '<span class="rfp-file-act">' +
            ((d.rows || []).length ? '<button type="button" class="mini-btn" data-rfp-view="' + d.id + '">표</button>' : '') +
            (d.dataUrl || d.text ? '<button type="button" class="mini-btn" data-rfp-dl="' + d.id + '">저장</button>' : '') +
            '<button type="button" class="mini-btn" data-rfp-del="' + d.id + '">삭제</button>' +
          '</span></li>';
      }).join('') + '</ul>';
    }
    if (kind.k === 'rentroll') h += rentRollBlock(brief.rental);
    else if (kind.k === 'opex') h += opexBlock(brief.opex, brief.rental);
    else if (kind.k === 'pm') h += pmBlock(brief.pm);
    h += '</section>';
    return h;
  }

  function rentRollBlock(rs) {
    if (!rs) return '';
    var h = '<div class="rfp-summary">' +
      '<div class="rfp-kpis">' +
        kpi(n0(rs.tenantCount, 0) + '명', '임차인') +
        kpi(n0(rs.leasedArea, 0) + '평', '임대면적') +
        kpi(n0(rs.vacancyRate) + '%', '공실률') +
        kpi(n0(rs.monthlyRent, 0) + '원', '월 임대료') +
        kpi(n0(rs.avgRentPerPy, 0) + '원', '평균 임대료/평') +
        kpi(rs.wale == null ? '-' : rs.wale.toFixed(1) + '년', 'WALE') +
      '</div>' +
      '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr>' +
        '<th>층·구역</th><th>임차인</th><th class="num">면적(평)</th><th class="num">월 임대료(원)</th><th>만기</th><th>비고</th>' +
      '</tr></thead><tbody>' + rs.items.slice(0, 8).map(function (it) {
        return '<tr' + (it.vacant ? ' class="vac"' : '') + '><td>' + esc(it.floor || '-') + '</td><td>' + esc(it.tenant) + '</td>' +
          '<td class="num">' + n0(it.area_py) + '</td><td class="num">' + n0(it.rent_month, 0) + '</td>' +
          '<td>' + esc(it.exp || '-') + '</td><td>' + esc(it.note || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (rs.items.length > 8 ? '<p class="rfp-hint">외 ' + (rs.items.length - 8) + '행 — <b>표</b> 버튼에서 전체 확인·수정</p>' : '');
    h += '</div>';
    return h;
  }
  function opexBlock(os, rs) {
    if (!os) return '';
    return '<div class="rfp-summary"><div class="rfp-kpis">' +
      kpi(n0(os.total, 0) + '원', '연간 오펙스') +
      kpi(os.perPy ? n0(os.perPy, 0) + '원' : '-', '평당 오펙스') +
      kpi(n0(os.count, 0) + '개', '항목 수') +
      '</div><div class="rfp-table-wrap"><table class="rfp-table"><thead><tr><th>항목</th><th class="num">연간(원)</th><th>비고</th></tr></thead><tbody>' +
      os.items.slice(0, 6).map(function (it) {
        return '<tr><td>' + esc(it.label) + '</td><td class="num">' + n0(it.amount_won, 0) + '</td><td>' + esc(it.note || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (os.items.length > 6 ? '<p class="rfp-hint">외 ' + (os.items.length - 6) + '개 항목</p>' : '') +
      (rs && rs.leasedArea ? '<p class="rfp-hint">평당 오펙스는 렌트롤 임대면적 ' + n0(rs.leasedArea) + '평 기준입니다.</p>' : '') +
      '</div>';
  }
  function pmBlock(pms) {
    if (!pms || !pms.length) return '';
    var months = pms.map(function (d) { return d.month || C.when(d.at).slice(0, 7); });
    return '<div class="rfp-summary"><div class="rfp-pmline">' + pms.slice(0, 12).map(function (d, i) {
      return '<span class="rfp-pm' + (i === 0 ? ' latest' : '') + '"><b>' + esc(d.month || C.when(d.at).slice(0, 7)) + '</b>' +
        (i === 0 ? '<em>최신</em>' : '') + '<span>' + esc(d.name.length > 18 ? d.name.slice(0, 17) + '…' : d.name) + '</span></span>';
    }).join('') + '</div>' +
      '<p class="rfp-hint">최근 ' + esc(months[0]) + ' 기준 · 총 ' + pms.length + '건 보관' +
      (pms[1] ? ' · 이전 ' + esc(months[1]) : '') + '</p></div>';
  }
  function kpi(v, l) { return '<span class="rfp-kpi"><b>' + esc(v) + '</b><em>' + esc(l) + '</em></span>'; }

  /* ─────────────────────────── B. RFP ─────────────────────────── */
  function rfpTab() {
    var list = C.rfpsOf(S.assetId);
    var sel = S.rfpId ? C.rfpOf(S.rfpId) : null;
    if (sel && sel.asset_id !== S.assetId) sel = null;
    var h = '<div class="rfp-sec-head"><div><h3>RFP 발주서</h3><p>표준 양식에 물건 개요를 자동으로 채웁니다. 자문사별 승인 코드와 함께 배부됩니다.</p></div>' +
      '<div class="rfp-sec-tools"><button type="button" class="btn btn-primary" data-rfp="rfp-new">＋ 새 RFP</button></div></div>';
    if (!list.length) {
      return h + '<div class="rfp-empty"><b>아직 RFP가 없습니다.</b><p>렌트롤·오펙스를 올린 뒤 <b>새 RFP</b>를 누르면 개요·일정·평가 항목이 자동으로 채워집니다.</p></div>';
    }
    h += '<div class="rfp-rfplist">' + list.map(function (r) {
      var sub = C.submissionsOf(r.id).length;
      var inv = (r.invites || []).length;
      return '<button type="button" class="rfp-rfpc' + (r.id === S.rfpId ? ' on' : '') + '" data-rfp-open="' + esc(r.id) + '">' +
        '<span class="rfp-rfpc-st s-' + esc(r.status || '작성') + '">' + esc(r.status || '작성') + '</span>' +
        '<strong>' + esc(r.title) + '</strong>' +
        '<span class="rfp-rfpc-meta">마감 ' + esc(r.due_date || '-') + ' · 초청 ' + inv + ' · 제출 ' + sub + '</span>' +
        '</button>';
    }).join('') + '</div>';
    if (!sel) {
      h += '<p class="rfp-hint">RFP를 선택하면 발주서 전문과 배부·내보내기 버튼이 열립니다.</p>';
      return h;
    }
    var dleft = C.daysLeft(sel.due_date);
    h += '<div class="rfp-rfpview">' +
      '<div class="rfp-sec-tools rfp-rfpview-tools">' +
        '<span class="rfp-due' + (dleft !== null && dleft < 0 ? ' over' : (dleft !== null && dleft <= 3 ? ' soon' : '')) + '">' +
          (dleft === null ? '마감 미정' : (dleft < 0 ? '마감 지남(D' + dleft + ')' : 'D-' + dleft)) + '</span>' +
        '<button type="button" class="btn btn-ghost" data-rfp-edit="' + esc(sel.id) + '">✏️ 수정</button>' +
        '<button type="button" class="btn btn-primary" data-rfp-folder="' + esc(sel.id) + '">📁 제출 폴더</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp-dist="' + esc(sel.id) + '">📤 자문사 배부</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp-print="' + esc(sel.id) + '">🖨 인쇄/PDF</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp-word="' + esc(sel.id) + '">⬇ Word</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp-copy="' + esc(sel.id) + '">🔗 배포 문구</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp-delrfp="' + esc(sel.id) + '">🗑</button>' +
      '</div>' +
      C.rfpHTML(sel, { invites: true, weights: true }) + '</div>';
    return h;
  }

  /* ─────────────────────────── D. 평가 ─────────────────────────── */
  function evalTab() {
    var rfps = C.rfpsOf(S.assetId);
    if (!rfps.length) return '<div class="rfp-empty"><b>평가할 RFP가 없습니다.</b><p>먼저 RFP를 만들어 자문사에 배부하세요.</p></div>';
    if (!S.evalRfpId || !rfps.some(function (r) { return r.id === S.evalRfpId; })) S.evalRfpId = rfps[0].id;
    var rfp = C.rfpOf(S.evalRfpId);
    var h = '';
    if (rfps.length > 1) {
      h += '<div class="rfp-rfpchips">' + rfps.map(function (r) {
        return '<button type="button" class="rfp-chip' + (r.id === S.evalRfpId ? ' on' : '') + '" data-rfp-eval="' + esc(r.id) + '">' + esc(r.title) + '</button>';
      }).join('') + '</div>';
    }
    h += '<div class="rfp-sec-head"><div><h3>제안 접수·평가 — ' + esc(rfp.title) + '</h3>' +
      '<p>초청 대비 제출 현황과 제안서를 비교하고, 항목별 가중치 점수로 순위를 냅니다. 자문사끼리는 서로의 제안서를 볼 수 없습니다.</p></div>' +
      '<div class="rfp-sec-tools">' +
        '<button type="button" class="btn btn-ghost" data-rfp-criteria="' + esc(rfp.id) + '">⚖ 평가 항목</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp-expcmp="' + esc(rfp.id) + '">📥 비교표 CSV</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp-printcmp="' + esc(rfp.id) + '">🖨 비교표 인쇄</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp-seed="' + esc(rfp.id) + '">＋ 예시 제안(검증)</button>' +
      '</div></div>';

    /* ① 제출 현황 */
    var invites = rfp.invites || [];
    var subs = C.submissionsOf(rfp.id);
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>① 제출 현황</b><span>초청 ' + invites.length + ' · 제출 ' + subs.length + '</span></div>';
    if (!invites.length) {
      h += '<p class="rfp-hint">아직 배부한 자문사가 없습니다. <b>RFP</b> 단계에서 <b>자문사 배부</b>를 먼저 하세요.</p>';
    } else {
      h += '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr>' +
        '<th>자문사</th><th>승인 코드</th><th>발송</th><th>만료</th><th>열람</th><th>제출</th><th>버전</th><th>상태</th>' +
        '</tr></thead><tbody>' + invites.map(function (inv) {
          var s = subs.filter(function (x) { return String(x.advisor_id) === String(inv.advisor_id); })[0];
          return '<tr><td><b>' + esc(inv.company || '-') + '</b></td><td class="mono">' + esc(inv.code || '-') + '</td>' +
            '<td>' + esc(C.when(inv.at)) + '</td><td>' + esc(inv.expires_at || '-') + '</td>' +
            '<td>' + (inv.viewed_at ? esc(C.when(inv.viewed_at)) : '<span class="rfp-muted">미열람</span>') + '</td>' +
            '<td>' + (s ? esc(C.when(s.at)) : '<span class="rfp-muted">미제출</span>') + '</td>' +
            '<td>' + (s ? 'v' + (s.version || 1) : '-') + '</td>' +
            '<td>' + (s ? '<span class="rfp-tag ok">' + esc(s.status || '제출') + '</span>' : '<span class="rfp-tag wait">대기</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    /* 초청 없이 제출된 경우(직접 등록 등) */
    var orphan = subs.filter(function (s) { return !invites.some(function (i) { return String(i.advisor_id) === String(s.advisor_id); }); });
    if (orphan.length) h += '<p class="rfp-hint">초청 목록에 없는 제출 ' + orphan.length + '건: ' + esc(orphan.map(function (s) { return s.advisor_company || s.advisor_id; }).join(', ')) + '</p>';
    h += '</section>';

    if (!subs.length) {
      h += '<div class="rfp-empty"><b>접수된 제안서가 없습니다.</b><p>자문사가 <b>🤝 자문사 포털</b>에서 승인 코드로 접속해 제출하면 여기에 표시됩니다. 화면 검증용으로 <b>예시 제안</b>을 넣어 평가표를 확인할 수 있습니다.</p></div>';
      return h;
    }

    /* ② 비교표 */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>② 항목별 비교표</b><span>' + subs.length + '개 제안</span></div>' +
      '<div class="rfp-table-wrap"><table class="rfp-table rfp-cmp"><thead><tr><th class="sticky-col">항목</th>' +
      subs.map(function (s) {
        return '<th><b>' + esc(s.advisor_company || '-') + '</b><span class="rfp-th-sub">v' + (s.version || 1) + ' · ' + esc(C.when(s.at).slice(5, 16)) + '</span></th>';
      }).join('') + '</tr></thead><tbody>' +
      cmpRows(rfp, subs) + '</tbody></table></div></section>';

    /* ③ 가중치 점수표 */
    var rows = C.rankedScores(rfp.id);
    var rankBy = {};
    rows.forEach(function (r) { rankBy[r.sub.advisor_id] = r; });
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>③ 가중치 점수표</b><span>항목 0~100점 × 가중치 → 총점·순위 자동</span>' +
      '<span class="rfp-panel-tools"><button type="button" class="mini-btn" data-rfp-autoscore="' + esc(rfp.id) + '">자동 채점(수수료·가격·기간)</button></span></div>' +
      '<div class="rfp-table-wrap"><table class="rfp-table rfp-score"><thead><tr><th class="sticky-col">평가 항목</th><th class="num">가중치</th>' +
      subs.map(function (s) { return '<th>' + esc(s.advisor_company || '-') + '</th>'; }).join('') + '</tr></thead><tbody>';

    (rfp.criteria || []).forEach(function (c) {
      h += '<tr><td class="sticky-col"><b>' + esc(c.label) + '</b><em class="rfp-crit-hint">' + esc(critHint(c.key)) + '</em></td>' +
        '<td class="num"><input class="rfp-in num" type="number" min="0" max="100" step="1" data-wt="' + esc(c.key) + '" value="' + n0(c.weight, 0) + '"></td>' +
        subs.map(function (s) {
          var sc = C.scoreOf(rfp.id, s.advisor_id) || {};
          var v = (sc.values || {})[c.key];
          return '<td class="num"><input class="rfp-in num" type="number" min="0" max="100" step="1" data-sc="' + esc(s.advisor_id) + '|' + esc(c.key) + '" value="' + (v == null ? '' : n0(v, 0)) + '" placeholder="—"></td>';
        }).join('') + '</tr>';
    });
    h += '<tr class="rfp-total"><td class="sticky-col"><b>총점(100점 환산)</b></td><td></td>' +
      subs.map(function (s) { return '<td class="num" data-total="' + esc(s.advisor_id) + '"><b>' + (rankBy[s.advisor_id] ? rankBy[s.advisor_id].total : 0) + '</b></td>'; }).join('') + '</tr>' +
      '<tr class="rfp-rank"><td class="sticky-col"><b>순위</b></td><td></td>' +
      subs.map(function (s) { return '<td class="num" data-rank="' + esc(s.advisor_id) + '">' + (rankBy[s.advisor_id] ? rankBy[s.advisor_id].rank + '위' : '-') + '</td>'; }).join('') + '</tr>' +
      '<tr><td class="sticky-col"><b>평가 메모</b></td><td></td>' +
      subs.map(function (s) {
        var sc = C.scoreOf(rfp.id, s.advisor_id) || {};
        return '<td><textarea class="rfp-in memo" rows="3" data-memo="' + esc(s.advisor_id) + '" placeholder="의견·확인사항">' + esc(sc.memo || '') + '</textarea></td>';
      }).join('') + '</tr>' +
      '</tbody></table></div>' +
      '<p class="rfp-hint">자동 채점은 수수료(낮을수록)·예상 매각가(높을수록)·기간(짧을수록)을 상대 평가하고, 나머지 항목은 70점으로 시작합니다. 검토 후 직접 조정하세요.</p>' +
      '</section>';

    /* ④ 선정 */
    var selId = rfp.selected_advisor_id || '';
    var selSub = selId ? subs.filter(function (s) { return String(s.advisor_id) === String(selId); })[0] : null;
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>④ 자문사 선정</b><span>' +
      (selSub ? '선정: ' + esc(selSub.advisor_company) : '미선정') + '</span></div>' +
      '<div class="rfp-select-row">' + subs.map(function (s) {
        var on = String(selId) === String(s.advisor_id);
        var r = rankBy[s.advisor_id];
        return '<button type="button" class="rfp-selectbtn' + (on ? ' on' : '') + '" data-rfp-select="' + esc(rfp.id) + '|' + esc(s.advisor_id) + '">' +
          (on ? '✅ 선정됨 · ' : '') + esc(s.advisor_company) + '<em>' + (r ? r.total + '점 · ' + r.rank + '위' : '') + '</em></button>';
      }).join('') + (selId ? '<button type="button" class="mini-btn" data-rfp-unselect="' + esc(rfp.id) + '">선정 취소</button>' : '') + '</div>' +
      '<p class="rfp-hint">선정하면 자문사 포털에서 해당 자문사가 자료 인계(승인 코드)·CA·TM/IM·입찰 단계로 진행할 수 있습니다.</p></section>';
    return h;
  }

  function critHint(k) {
    return ({
      fee: '성공보수율·고정수수료', price: '제시 매각가', period: '예상 매각 기간',
      track: '유사 자산·규모 실적', access: 'FI·SI·화주 접근력', team: '투입 인력', sched: '일정 준수', extra: '추가 서비스'
    })[k] || '';
  }
  function cmpRows(rfp, subs) {
    var defs = [
      ['성공보수(%)', function (s) { return s.fee_success ? n0(s.fee_success, 2) + '%' : '-'; }],
      ['고정 수수료(억원)', function (s) { return s.fee_fixed ? n0(s.fee_fixed, 2) : '-'; }],
      ['예상 매각가(억원)', function (s) { return s.price_expect ? n0(s.price_expect, 0) : '-'; }],
      ['가이드 대비', function (s) {
        var g = num(rfp.guide_eok), p = num(s.price_expect);
        return g > 0 && p > 0 ? (p / g * 100).toFixed(1) + '%' : '-';
      }],
      ['예상 기간(개월)', function (s) { return s.period_months ? n0(s.period_months, 0) : '-'; }],
      ['유사 실적', function (s) { return s.track_record || '-'; }],
      ['투자자 접근력', function (s) { return s.access_reach || '-'; }],
      ['인력 구성', function (s) { return s.team || '-'; }],
      ['일정', function (s) { return s.schedule || '-'; }],
      ['추가 서비스', function (s) { return s.extra || '-'; }],
      ['첨부', function (s) { return (s.files || []).length ? (s.files.length + '건 · ' + s.files.map(function (f) { return f.name; }).join(', ')) : '-'; }]
    ];
    return defs.map(function (d) {
      return '<tr><td class="sticky-col"><b>' + esc(d[0]) + '</b></td>' +
        subs.map(function (s) { return '<td>' + esc(d[1](s)) + '</td>'; }).join('') + '</tr>';
    }).join('');
  }

  /* 현장 점수 계산 — 입력 즉시 총점·순위만 갱신 */
  function recalcEval(rfpId) {
    var rfp = C.rfpOf(rfpId);
    if (!rfp) return;
    var subs = C.submissionsOf(rfpId);
    var vals = {}, weights = {};
    $$('[data-sc]', host()).forEach(function (inp) {
      var p = inp.getAttribute('data-sc').split('|');
      vals[p[0]] = vals[p[0]] || {};
      vals[p[0]][p[1]] = num(inp.value);
    });
    $$('[data-wt]', host()).forEach(function (inp) { weights[inp.getAttribute('data-wt')] = num(inp.value); });
    var rows = subs.map(function (s) {
      var rfpW = { criteria: (rfp.criteria || []).map(function (c) { return { key: c.key, weight: weights[c.key] != null ? weights[c.key] : c.weight }; }) };
      return { s: s, total: C.totalScore(rfpW, vals[s.advisor_id] || {}) };
    }).sort(function (a, b) { return b.total - a.total; });
    var rank = {};
    rows.forEach(function (r, i) { rank[r.s.advisor_id] = i + 1; });
    subs.forEach(function (s) {
      var t = document.querySelector('[data-total="' + s.advisor_id + '"] b');
      if (t) t.textContent = String((rows.filter(function (r) { return r.s.advisor_id === s.advisor_id; })[0] || {}).total || 0);
      var rk = document.querySelector('[data-rank="' + s.advisor_id + '"]');
      if (rk) rk.textContent = (rank[s.advisor_id] || '-') + '위';
    });
  }
  function saveScores(rfpId) {
    var rfp = C.rfpOf(rfpId);
    if (!rfp) return;
    /* 가중치 */
    $$('[data-wt]', host()).forEach(function (inp) {
      var k = inp.getAttribute('data-wt');
      (rfp.criteria || []).forEach(function (c) { if (c.key === k) c.weight = num(inp.value); });
    });
    C.commit('rfps', rfp);
    /* 항목 점수 */
    var byAdv = {};
    $$('[data-sc]', host()).forEach(function (inp) {
      var p = inp.getAttribute('data-sc').split('|');
      byAdv[p[0]] = byAdv[p[0]] || {};
      byAdv[p[0]][p[1]] = num(inp.value);
    });
    Object.keys(byAdv).forEach(function (aid) {
      var rec = C.scoreOf(rfpId, aid) || { id: C.uid('sc'), rfp_id: rfpId, advisor_id: aid, values: {} };
      rec.values = byAdv[aid];
      rec.by = (C.me() && C.me().name) || C.role();
      C.commit('scores', rec);
    });
    /* 메모 */
    $$('[data-memo]', host()).forEach(function (ta) {
      var aid = ta.getAttribute('data-memo');
      var rec = C.scoreOf(rfpId, aid) || { id: C.uid('sc'), rfp_id: rfpId, advisor_id: aid, values: {} };
      if (rec.memo !== ta.value) { rec.memo = ta.value; C.commit('scores', rec); }
    });
  }

  /* ─────────────────────────── 모달: 물건 선택 ─────────────────────────── */
  function openAssetPicker() {
    var all = C.assets();
    var body = '<p class="rfp-note">물건 DB에서 매각 자문을 맡길 물건을 고르세요. 이미 관리 중인 물건도 다시 열 수 있습니다.</p>' +
      '<div class="rfp-search"><input id="rfpAssetQ" type="search" placeholder="건물명 · 주소 · 운용사 검색" autocomplete="off"></div>' +
      '<div id="rfpAssetList" class="rfp-picklist"></div>';
    var m = C.modal('물건 불러오기', body, { wide: true, footer: '<button type="button" class="btn btn-ghost" data-rfp="close">닫기</button>' });
    var box = $('#rfpAssetList', m);
    function render(q) {
      q = String(q || '').toLowerCase();
      var hits = all.filter(function (a) {
        if (!q) return true;
        return (a.name + ' ' + a.address + ' ' + a.sector).toLowerCase().indexOf(q) >= 0;
      }).slice(0, 60);
      box.innerHTML = hits.length ? hits.map(function (a) {
        return '<button type="button" class="rfp-pick" data-pick="' + esc(a.id) + '">' +
          '<b>' + esc(a.name) + '</b><span>' + esc([a.sector, a.address].filter(Boolean).join(' · ')) + '</span>' +
          (C.workOf(a.id) ? '<em>관리 중</em>' : '') + '</button>';
      }).join('') : '<p class="rfp-hint">검색 결과가 없습니다. 물건 지도에 등록된 물건만 선택할 수 있습니다.</p>';
    }
    render('');
    var qi = $('#rfpAssetQ', m);
    if (qi) qi.addEventListener('input', function () { render(qi.value); });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]');
      if (!b) return;
      var id = b.getAttribute('data-pick');
      C.pinAsset(id);
      S.assetId = id; S.rfpId = ''; S.evalRfpId = ''; S.tab = 'docs';
      C.closeModal(); paint();
      C.toast('물건을 불러왔습니다. 자료를 업로드하세요.');
    });
  }

  /* ─────────────────────────── 모달: 업로드 ─────────────────────────── */
  function uploadDoc(kindKey) {
    C.pickFiles(true).then(function (files) {
      if (!files.length) return;
      var kind = C.DOC_KINDS.filter(function (k) { return k.k === kindKey; })[0];
      var jobs = files.map(function (f) { return C.readFile(f).catch(function (e) { return { error: e, name: f.name }; }); });
      Promise.all(jobs).then(function (results) {
        var ok = [], bad = [];
        results.forEach(function (r) { if (r && !r.error) ok.push(r); else bad.push(r); });
        if (bad.length) C.toast(bad.length + '건을 읽지 못했습니다(' + ((bad[0].error && bad[0].error.message) || '형식') + ')', true);
        if (!ok.length) return;
        openDocPreview(kind, ok);
      });
    });
  }
  function openDocPreview(kind, files) {
    var first = files[0];
    var rows = C.cleanRows(first.rows || []);
    var summary = buildSummary(kind, rows);
    var months = files.map(function (f) { return C.parseMonth(f.name); }).filter(Boolean);
    var body = '<p class="rfp-note"><b>' + esc(kind.label) + '</b> — ' + files.length + '개 파일. 업로드 원본은 그대로 보관하고, 아래 정규화 결과를 확인·수정할 수 있습니다.</p>' +
      '<div class="rfp-uploadgrid"><div>' +
      '<table class="rfp-table small"><thead><tr><th>파일</th><th class="num">크기</th><th class="num">행</th></tr></thead><tbody>' +
      files.map(function (f) { return '<tr><td>' + esc(f.name) + '</td><td class="num">' + C.bytes(f.size) + '</td><td class="num">' + Math.max(0, (f.rows || []).length - 1) + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      (rows.length ? '<p class="rfp-hint">' + (files.length > 1 ? '정규화·요약은 첫 번째 파일 기준입니다. ' : '') + '인식된 열: ' + esc((rows[0] || []).join(' · ')) + '</p>' : '') +
      summaryHTML(kind.k, summary) +

      '<details class="rfp-det"><summary>원본 표 미리보기(첫 12행)</summary>' +
      '<div class="rfp-table-wrap"><table class="rfp-table small"><tbody>' +
      rows.slice(0, 12).map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div></details>' +
      '</div><div>' +
      C.field('name', '파일명(표시)', first.name, 'text', { wide: true }) +
      (kind.k === 'pm' ? C.field('month', '기준 월 (PM 리포트)', months[0] || C.parseMonth(first.name) || '', 'month', { hint: '파일명에서 자동 인식. 필요하면 수정하세요.' }) : '') +
      C.field('note', '메모', '', 'text', { wide: true, ph: '예) 2026-11 임대차 현황, PM사 발송본' }) +
      '</div></div>';
    var m = C.modal('자료 등록 — ' + kind.label, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-rfp="doc-save">저장</button>'
    });
    m.querySelector('[data-rfp="doc-save"]').addEventListener('click', function () {
      files.forEach(function (f, i) {
        var rr = C.cleanRows(f.rows || []);
        var sum = i === 0 ? buildSummary(kind, rr) : buildSummary(kind, rr);
        C.commit('docs', {
          id: C.uid('doc'), asset_id: S.assetId, asset_name: current().name || '',
          kind: kind.k, label: kind.label, name: i === 0 ? (C.fval(m, 'name') || f.name) : f.name,
          size: f.size, mime: f.mime, dataUrl: f.dataUrl || '', text: f.text || (rr.length ? rr.map(function (r) { return r.join('\t'); }).join('\n') : ''),
          rows: rr, summary: sum, month: i === 0 ? (C.fval(m, 'month') || C.parseMonth(f.name)) : C.parseMonth(f.name),
          note: C.fval(m, 'note'), at: new Date().toISOString()
        });
      });
      C.closeModal(); paint(); C.toast(kind.label + ' ' + files.length + '건을 저장했습니다.');
    });
  }
  function buildSummary(kind, rows) {
    var k = (kind && kind.k) ? kind.k : kind;
    if (k === 'rentroll') return C.rentRollSummary(rows);
    if (k === 'opex') {
      var rr = C.latestDoc(S.assetId, 'rentroll');
      return C.opexSummary(rows, rr && rr.summary ? rr.summary.leasedArea : 0);
    }
    return null;
  }
  function summaryHTML(kindKey, sum) {
    if (!sum || !sum.items) return '';
    if (kindKey === 'rentroll') {
      return '<div class="rfp-kpis">' + kpi(n0(sum.tenantCount, 0) + '명', '임차인') + kpi(n0(sum.leasedArea, 0) + '평', '임대면적') +
        kpi(n0(sum.vacancyRate) + '%', '공실률') + kpi(n0(sum.monthlyRent, 0) + '원', '월 임대료') +
        kpi(n0(sum.avgRentPerPy, 0) + '원', '평균/평') + kpi(sum.wale == null ? '-' : sum.wale.toFixed(1) + '년', 'WALE') + '</div>';
    }
    if (kindKey === 'opex') return '<div class="rfp-kpis">' + kpi(n0(sum.total, 0) + '원', '연간 합계') + kpi(n0(sum.count, 0) + '개', '항목') + '</div>';
    return '';
  }

  /* 표 붙여넣기 — PDF/엑셀에서 복사한 표를 바로 정규화 */
  function pasteDoc(kindKey) {
    var kind = C.DOC_KINDS.filter(function (k) { return k.k === kindKey; })[0];
    var head = kindKey === 'rentroll' ? '층\t임차인\t면적(평)\t월 임대료(원)\t만기\t비고' :
      (kindKey === 'opex' ? '항목\t금액(원/년)\t비고' : '구분\t내용');
    var body = '<p class="rfp-note">엑셀·PDF에서 복사한 표를 그대로 붙여넣으세요. 탭 또는 쉼표로 구분됩니다.<br>' +
      '<b>' + esc(kind.label) + '</b> 첫 줄은 열 이름(머리글)으로 인식합니다.</p>' +
      '<textarea id="rfpPaste" class="rfp-paste" rows="10" placeholder="' + esc(head) + '">' + esc(head) + '\n</textarea>' +
      '<p class="rfp-hint" id="rfpPasteHint">붙여넣은 뒤 <b>미리보기</b>를 누르면 정규화 결과를 확인할 수 있습니다.</p>' +
      '<div id="rfpPastePrev"></div>';
    var m = C.modal('표 붙여넣기 — ' + kind.label, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp="paste-prev">미리보기</button>' +
        '<button type="button" class="btn btn-primary" data-rfp="paste-save">저장</button>'
    });
    var ta = $('#rfpPaste', m);
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    m.querySelector('[data-rfp="paste-prev"]').addEventListener('click', function () {
      var rows = C.parseDelimited(ta.value);
      var sum = buildSummary(kind, rows);
      $('#rfpPastePrev', m).innerHTML = '<p class="rfp-hint">' + Math.max(0, rows.length - 1) + '행 인식</p>' +
        (sum && sum.items ? '<div class="rfp-kpis">' + (kindKey === 'rentroll'
          ? kpi(n0(sum.tenantCount, 0) + '명', '임차인') + kpi(n0(sum.vacancyRate) + '%', '공실률') + kpi(n0(sum.monthlyRent, 0) + '원', '월 임대료')
          : kpi(n0(sum.total, 0) + '원', '연간 합계') + kpi(n0(sum.count, 0) + '개', '항목')) + '</div>' : '') +
        '<div class="rfp-table-wrap"><table class="rfp-table small"><tbody>' +
        rows.slice(0, 8).map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></div>';
    });
    m.querySelector('[data-rfp="paste-save"]').addEventListener('click', function () {
      var rows = C.parseDelimited(ta.value);
      if (rows.length < 2) { C.toast('표를 붙여넣으세요(머리글 + 1행 이상).', true); return; }
      C.commit('docs', {
        id: C.uid('doc'), asset_id: S.assetId, asset_name: current().name || '',
        kind: kind.k, label: kind.label, name: kind.label + ' (붙여넣기 ' + C.today() + ')',
        size: ta.value.length, mime: 'text/tab-separated-values', dataUrl: '', text: ta.value,
        rows: rows, summary: buildSummary(kind, rows), month: C.today().slice(0, 7),
        note: '표 붙여넣기로 등록', at: new Date().toISOString()
      });
      C.closeModal(); paint(); C.toast(kind.label + '을 저장했습니다.');
    });
  }

  function viewDoc(id) {
    var d = C.byId('docs', id);
    if (!d) return;
    var rows = d.rows || [];
    var body = '<p class="rfp-note">표를 직접 고칠 수 있습니다. 탭 또는 <b>|</b> 로 구분하며, 첫 줄은 머리글입니다. 저장하면 정규화 수치가 다시 계산됩니다.</p>' +
      C.field('name', '파일명', d.name, 'text', { wide: true }) +
      C.field('month', '기준 월', d.month || '', 'month') +
      C.field('note', '메모', d.note || '', 'text', { wide: true }) +
      '<label class="rfp-f wide"><span>표 내용</span><textarea name="rows" rows="12" class="rfp-paste">' +
      esc(rows.map(function (r) { return r.join('\t'); }).join('\n')) + '</textarea></label>';
    var m = C.modal('표 확인·수정 — ' + d.name, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">닫기</button>' +
        (d.dataUrl || d.text ? '<button type="button" class="btn btn-ghost" data-rfp="dl">원본 내려받기</button>' : '') +
        '<button type="button" class="btn btn-primary" data-rfp="doc-update">저장</button>'
    });
    m.querySelector('[data-rfp="doc-update"]').addEventListener('click', function () {
      var text = (m.querySelector('[name="rows"]') || {}).value || '';
      var rr = C.parseDelimited(text);
      d.name = C.fval(m, 'name') || d.name;
      d.month = C.fval(m, 'month');
      d.note = C.fval(m, 'note');
      d.rows = rr;
      d.text = rr.map(function (r) { return r.join('\t'); }).join('\n');
      d.summary = buildSummary(d.kind, rr);
      C.commit('docs', d); C.closeModal(); paint(); C.toast('표를 저장했습니다.');
    });
    var dl = m.querySelector('[data-rfp="dl"]');
    if (dl) dl.addEventListener('click', function () { C.downloadFile(d); });
  }

  /* ─────────────────────────── 모달: RFP 작성 ─────────────────────────── */
  function openRfpEditor(rfp) {
    var isNew = !rfp;
    var r = rfp || C.newRfp(S.assetId);
    var criteriaText = (r.criteria || []).map(function (c) { return c.label + ' | ' + n0(c.weight, 0); }).join('\n');
    var body = '<div class="rfp-formgrid">' +
      C.field('title', 'RFP 제목', r.title, 'text', { wide: true, req: true }) +
      C.field('client', '의뢰인', r.client || '', 'text') +
      C.field('status', '상태', C.flowOf(r), 'select', { options: C.FLOW }) +
      C.field('issue_date', '발주일', r.issue_date || C.today(), 'date') +
      C.field('due_date', '제안서 마감', r.due_date || C.addDays(C.today(), 14), 'date') +
      C.field('loi_due', 'LOI·LOC 마감', r.loi_due || C.addDays(C.today(), 49), 'date') +
      C.field('guide_eok', '가격 가이던스(억원)', r.guide_eok || '', 'number', { step: '0.1' }) +
      C.field('owner', '담당(운영자)', r.owner || '', 'text') +
      C.field('asset_name', '대상 물건', r.asset_name || '', 'text') +
      C.field('submit_mode', '제출 방식', r.submit_mode || 'Soft copy(PDF)', 'select', { options: (window.NAI_RFP_TEMPLATE && window.NAI_RFP_TEMPLATE.options.submit_mode) || ['Hard copy', 'Soft copy(PDF)', 'Hard + Soft'] }) +
      C.field('language', '언어', r.language || '국·영문 택1', 'select', { options: (window.NAI_RFP_TEMPLATE && window.NAI_RFP_TEMPLATE.options.language) || ['국문', '영문', '국·영문 택1'] }) +
      C.field('fee_sealed', '보수 제출', r.fee_sealed || '제안서에 포함', 'select', { options: (window.NAI_RFP_TEMPLATE && window.NAI_RFP_TEMPLATE.options.fee_sealed) || ['제안서에 포함', '보수 별도 봉인 제출'] }) +
      C.field('consortium', '컨소시엄', r.consortium || '불가', 'select', { options: (window.NAI_RFP_TEMPLATE && window.NAI_RFP_TEMPLATE.options.consortium) || ['불가', '허용(사전 협의)'] }) +
      C.field('signature_doc', '비밀유지 서류', r.signature_doc || 'CA(비밀유지약정서)', 'select', { options: (window.NAI_RFP_TEMPLATE && window.NAI_RFP_TEMPLATE.options.signature_doc) || ['CA(비밀유지약정서)', '서약서', 'CA + 서약서(통합 가능)'] }) +
      C.field('ca_form_name', 'CA 양식 파일', r.ca_form_name || '미연결', 'text', { disabled: true, hint: '📁 제출 폴더 → CA 양식 연결에서 발주처 원 양식을 올립니다.' }) +
      '<div class="rfp-f wide"><span>물건 개요 <em>렌트롤·오펙스·PM 리포트에서 자동 채움</em></span>' +
        '<textarea name="overview" rows="6">' + esc(r.overview || '') + '</textarea>' +
        '<button type="button" class="mini-btn" data-rfp="refill">↻ 자료에서 다시 채우기</button></div>' +
      C.field('scope', '업무 범위', r.scope || '', 'textarea', { wide: true, rows: 5 }) +
      C.field('schedule', '일정', r.schedule || '', 'textarea', { wide: true, rows: 3 }) +
      C.field('proposal', '제안서 목차·작성 방법', r.proposal || '', 'textarea', { wide: true, rows: 4 }) +
      C.field('docs', '제출 요구 서류 (한 줄에 하나)', (r.docs || []).join('\n'), 'textarea', { wide: true, rows: 6 }) +
      C.field('criteria', '평가 항목 | 가중치 (한 줄에 하나)', criteriaText, 'textarea', { wide: true, rows: 8 }) +
      C.field('nda', 'NDA·CA 조건', r.nda || '', 'textarea', { wide: true, rows: 3 }) +
      C.field('note', '기타', r.note || '', 'textarea', { wide: true, rows: 2 }) +
      '</div>';
    var m = C.modal(isNew ? '📑 RFP 초안 만들기' : '✏️ RFP 수정', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-rfp="rfp-save">저장</button>'
    });
    m.querySelector('[data-rfp="refill"]').addEventListener('click', function () {
      var fresh = C.newRfp(S.assetId);
      m.querySelector('[name="overview"]').value = fresh.overview;
      C.toast('현재 자료 기준으로 개요를 다시 채웠습니다.');
    });
    m.querySelector('[data-rfp="rfp-save"]').addEventListener('click', function () {
      var title = C.fval(m, 'title');
      if (!title) { C.toast('제목을 입력하세요.', true); return; }
      var crit = C.fval(m, 'criteria').split('\n').map(function (line) {
        var parts = line.split('|');
        var label = (parts[0] || '').trim();
        var w = num((parts[1] || '').replace(/[^0-9.]/g, ''));
        return label ? { key: slugKey(label, r.criteria), label: label, weight: w || 0 } : null;
      }).filter(Boolean);
      if (!crit.length) { C.toast('평가 항목을 한 개 이상 입력하세요.', true); return; }
      var obj = {
        id: r.id || C.uid('rfp'), asset_id: S.assetId, asset_name: C.fval(m, 'asset_name') || current().name,
        client: C.fval(m, 'client'), title: title, issue_date: C.fval(m, 'issue_date'),
        due_date: C.fval(m, 'due_date'), status: C.normStatus(C.fval(m, 'status')),
        guide_eok: C.fval(m, 'guide_eok'), overview: C.fval(m, 'overview'), scope: C.fval(m, 'scope'),
        schedule: C.fval(m, 'schedule'), proposal: C.fval(m, 'proposal'),
        loi_due: C.fval(m, 'loi_due'), owner: C.fval(m, 'owner'),
        submit_mode: C.fval(m, 'submit_mode'), language: C.fval(m, 'language'),
        fee_sealed: C.fval(m, 'fee_sealed'), consortium: C.fval(m, 'consortium'),
        signature_doc: C.fval(m, 'signature_doc'),
        docs: C.fval(m, 'docs').split('\n').map(function (x) { return x.trim(); }).filter(Boolean),
        criteria: crit, nda: C.fval(m, 'nda'), note: C.fval(m, 'note'),
        invites: r.invites || [], selected_advisor_id: r.selected_advisor_id || '',
        created_at: r.created_at || new Date().toISOString()
      };
      C.commit('rfps', obj);
      S.rfpId = obj.id; S.evalRfpId = obj.id; S.tab = 'rfps';
      C.closeModal(); paint();
      C.toast(isNew ? 'RFP 초안을 저장했습니다. 자문사 배부로 넘어가세요.' : 'RFP를 수정했습니다.');
    });
  }
  function slugKey(label, prev) {
    var hit = (prev || []).filter(function (c) { return c.label === label; })[0];
    if (hit) return hit.key;
    var known = { '수수료': 'fee', '예상 매각가': 'price', '예상 매각 기간': 'period', '유사 실적': 'track', '투자자 접근력': 'access', '인력': 'team', '일정': 'sched', '추가': 'extra' };
    var k = Object.keys(known).filter(function (x) { return label.indexOf(x) >= 0; })[0];
    return known[k] || ('c' + Math.random().toString(36).slice(2, 6));
  }

  /* ─────────────────────────── 모달: 배부 ─────────────────────────── */
  function openDistribute(rfp) {
    var cs = C.contacts();
    var sel = {};
    (rfp.invites || []).forEach(function (i) { if (i.advisor_id) sel[i.advisor_id] = true; });
    var filt = { q: '', spec: 'ALL' };
    var body = '<p class="rfp-note">자문사 <b>컨택포인트</b>를 선택해 배포 대상을 확정합니다. 선택하면 자문사별 <b>승인 코드</b>가 발급되고 배포 기록이 남습니다. ' +
      '메일 자동 발송은 하지 않습니다(수신자 CSV·메일 초안 복사까지만).</p>' +
      '<div class="rfp-distbar"><input id="rfpDistQ" type="search" placeholder="회사 · 담당자 · 전문분야 검색" autocomplete="off">' +
      '<span id="rfpDistSpec" class="rfp-specchips"></span>' +
      '<span id="rfpDistCount" class="rfp-selcount">선택 0명</span>' +
      '<button type="button" class="mini-btn" data-dist="all">전체</button>' +
      '<button type="button" class="mini-btn" data-dist="none">해제</button>' +
      '<button type="button" class="mini-btn" data-dist="csv">수신자 CSV</button>' +
      '<button type="button" class="mini-btn" data-dist="mail">메일 초안 복사</button>' +
      '<button type="button" class="mini-btn" data-dist="add">＋ 컨택 등록</button>' +
      (C.list('advisor_contacts').length ? '' : '<button type="button" class="mini-btn" data-dist="seed">＋ 샘플 8명(검증)</button>') +
      '</div>' +
      '<div id="rfpDistList" class="rfp-advpick"></div>' +
      '<div class="rfp-formgrid"><label class="rfp-f"><span>코드 만료일</span><input name="expires_at" type="date" value="' +
      esc(rfp.due_date ? C.addDays(rfp.due_date, 14) : C.addDays(C.today(), 30)) + '"><em>기본: 제출 마감 + 14일</em></label>' +
      '<label class="rfp-f"><span>자료 공개 범위</span><input name="scope" value="rentroll, opex, im, etc"><em>rentroll · opex · im · etc</em></label></div>';
    var m = C.modal('📤 자문사 배포 — ' + rfp.title, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-rfp="dist-go">선택한 자문사에 배부 · 코드 발급</button>'
    });

    function specs() {
      var set = {};
      cs.forEach(function (c) { (c.specialty || []).forEach(function (x) { set[x] = 1; }); });
      return Object.keys(set);
    }
    function renderSpec() {
      var el = m.querySelector('#rfpDistSpec');
      el.innerHTML = ['ALL'].concat(specs()).map(function (sp) {
        return '<button type="button" class="rfp-chip' + (filt.spec === sp ? ' on' : '') + '" data-dist-spec="' + esc(sp) + '">' + (sp === 'ALL' ? '전체 분야' : esc(sp)) + '</button>';
      }).join('');
    }
    function visible() {
      var q = filt.q.toLowerCase();
      return cs.filter(function (c) {
        if (filt.spec !== 'ALL' && (c.specialty || []).indexOf(filt.spec) < 0) return false;
        if (!q) return true;
        return [c.company, c.name, c.title, c.email, (c.specialty || []).join(' '), c.deals].join(' ').toLowerCase().indexOf(q) >= 0;
      });
    }
    function countSel() {
      var n = 0, seen = {};
      Object.keys(sel).forEach(function (id) {
        if (!sel[id]) return;
        var c = C.contactOf(id);
        if (!c) return;
        var key = (c.email || (c.company + '|' + c.name)).toLowerCase();
        if (seen[key]) return;
        seen[key] = 1; n++;
      });
      var el = m.querySelector('#rfpDistCount');
      if (el) el.textContent = '선택 ' + n + '명';
      return n;
    }
    function renderList() {
      var box = m.querySelector('#rfpDistList');
      var rows = visible();
      box.innerHTML = rows.length ? rows.map(function (c) {
        return '<label class="rfp-advrow"><input type="checkbox" name="adv" value="' + esc(c.id) + '"' + (sel[c.id] ? ' checked' : '') + '>' +
          '<span><b>' + esc(c.company) + '</b><em>' + esc([c.name, c.title, c.email, (c.specialty || []).join('·')].filter(Boolean).join(' · ')) + '</em>' +
          (c.deals ? '<em class="rfp-sub">최근: ' + esc(c.deals) + '</em>' : '') + '</span></label>';
      }).join('') : '<p class="rfp-hint">조건에 맞는 컨택이 없습니다. 「＋ 컨택 등록」으로 추가하세요.</p>';
      countSel();
    }
    m.addEventListener('click', function (e) {
      var sp = e.target.closest('[data-dist-spec]');
      if (sp) { filt.spec = sp.getAttribute('data-dist-spec'); renderSpec(); renderList(); return; }
      var b = e.target.closest('[data-dist]');
      if (!b) return;
      var act = b.getAttribute('data-dist');
      if (act === 'all') { visible().forEach(function (c) { sel[c.id] = true; }); renderList(); return; }
      if (act === 'none') { sel = {}; renderList(); return; }
      if (act === 'seed') { var n = C.seedContacts(); cs = C.contacts(); renderSpec(); renderList(); C.toast(n + '명 샘플 컨택을 넣었습니다(가상 데이터).'); return; }
      if (act === 'add') { addContactModal(function () { cs = C.contacts(); renderSpec(); renderList(); }); return; }
      if (act === 'csv') {
        var picked = pickedContacts();
        if (!picked.length) { C.toast('선택한 자문사가 없습니다.', true); return; }
        C.csv('RFP_배포대상_' + C.safeName(rfp.asset_name) + '_' + C.today().replace(/-/g, '') + '.csv',
          ['회사', '담당자', '직함', '이메일', '전화', '전문분야', '최근 협업 딜', '비고'],
          picked.map(function (c) { return [c.company, c.name, c.title, c.email, c.phone, (c.specialty || []).join('·'), c.deals, c.note]; }));
        return;
      }
      if (act === 'mail') {
        var picked2 = pickedContacts();
        if (!picked2.length) { C.toast('선택한 자문사가 없습니다.', true); return; }
        var text = '[매각 자문 RFP] ' + rfp.title + '\n' +
          '대상: ' + (rfp.asset_name || '-') + '\n' +
          '제출 마감: ' + (rfp.due_date || '-') + '\n\n' +
          '아래 승인 코드로 Open AI Asset Bridge → 🤝 자문사 포털에 접속해 RFP를 열람하고 제안서를 제출해 주세요.\n' +
          '제안서 작성에 필요한 자료는 ' + (rfp.signature_doc || 'CA(비밀유지약정서)') + ' 날인·회신 후 VDR에서 제공됩니다.\n\n' +
          '수신: ' + picked2.map(function (c) { return c.company + ' ' + (c.name || ''); }).join(', ') + '\n' +
          '(코드는 배부 후 별도 안내)\n\n문의: ' + (rfp.client || 'NAI Korea');
        try { navigator.clipboard.writeText(text); C.toast('메일 초안을 복사했습니다(발송은 직접).'); } catch (er) { C.toast('복사하지 못했습니다.', true); }
        return;
      }
    });
    m.addEventListener('change', function (e) {
      if (e.target.matches('[name="adv"]')) { sel[e.target.value] = e.target.checked; countSel(); }
    });
    m.addEventListener('input', function (e) {
      if (e.target.id === 'rfpDistQ') { filt.q = e.target.value; renderList(); }
    });
    function pickedContacts() {
      var out = [], seen = {};
      Object.keys(sel).forEach(function (id) {
        if (!sel[id]) return;
        var c = C.contactOf(id);
        if (!c) return;
        var key = (c.email || (c.company + '|' + c.name)).toLowerCase();
        if (seen[key]) return;
        seen[key] = 1; out.push(c);
      });
      return out;
    }
    renderSpec(); renderList();

    m.querySelector('[data-rfp="dist-go"]').addEventListener('click', function () {
      var picked = pickedContacts();
      if (!picked.length) { C.toast('초청할 자문사를 선택하세요.', true); return; }
      var scope = C.normScope(C.fval(m, 'scope'));
      var exp = C.fval(m, 'expires_at');
      var issued = [];
      picked.forEach(function (c) {
        var adv = C.list('advisors').filter(function (a) { return a.company === c.company && (a.name || '') === (c.name || ''); })[0];
        if (!adv) adv = C.commit('advisors', { id: C.uid('adv'), company: c.company, name: c.name, title: c.title, email: c.email, phone: c.phone, contact_id: c.id, at: new Date().toISOString() });
        var rec = C.issueCode({ rfp_id: rfp.id, holder_type: '자문사', holder: adv.company, holder_id: adv.id, scope: scope, expires_at: exp });
        var inv = { advisor_id: adv.id, contact_id: c.id, company: adv.company, name: adv.name || '', email: adv.email || '', code: rec.code, at: new Date().toISOString(), expires_at: exp, viewed_at: '' };
        rfp.invites = (rfp.invites || []).filter(function (i) { return i.advisor_id !== adv.id; });
        rfp.invites.push(inv);
        C.ensureParticipant(rfp.id, '자문사', { ref_id: adv.id, company: adv.company, name: adv.name, email: adv.email });
        issued.push(inv);
      });
      if (C.flowIndex(C.flowOf(rfp)) < C.flowIndex('배포')) C.setStatus(rfp, '배포', '자문사 ' + issued.length + '명 배포');
      C.commit('rfps', rfp);
      C.closeModal(); paint();
      showIssued(rfp, issued);
    });
  }

  function addContactModal(done) {
    var body = '<div class="rfp-formgrid">' +
      C.field('company', '회사', '', 'text', { req: true }) +
      C.field('name', '담당자', '', 'text') +
      C.field('title', '직함', '', 'text') +
      C.field('email', '이메일', '', 'email') +
      C.field('phone', '연락처', '', 'tel') +
      C.field('specialty', '전문분야 (쉼표)', '', 'text', { wide: true, hint: '감정평가 · 회계·세무 · 법률 · 기술사 · 건축·CM · PM · 부동산 자문 · 금융 자문' }) +
      C.field('deals', '최근 협업 딜', '', 'text', { wide: true }) +
      C.field('note', '비고', '', 'text', { wide: true }) + '</div>';
    var m = C.modal('＋ 자문사 컨택 등록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-rfp="ctc-save">저장</button>'
    });
    m.querySelector('[data-rfp="ctc-save"]').addEventListener('click', function () {
      var co = C.fval(m, 'company');
      if (!co) { C.toast('회사를 입력하세요.', true); return; }
      C.commit('advisor_contacts', {
        id: C.uid('ctc'), company: co, name: C.fval(m, 'name'), title: C.fval(m, 'title'),
        email: C.fval(m, 'email'), phone: C.fval(m, 'phone'),
        specialty: C.fval(m, 'specialty').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        deals: C.fval(m, 'deals'), note: C.fval(m, 'note'), active: true, at: new Date().toISOString()
      });
      C.closeModal(); if (done) done(); C.toast('컨택을 등록했습니다.');
    });
  }

  function showIssued(rfp, issued) {
    if (!issued.length) return;
    var body = '<p class="rfp-note">아래 코드를 자문사에 전달하세요. 코드를 입력하면 그 자문사만 해당 RFP와 자기 제안서를 볼 수 있습니다.</p>' +
      '<table class="rfp-table"><thead><tr><th>자문사</th><th>승인 코드</th><th>만료</th><th></th></tr></thead><tbody>' +
      issued.map(function (i) {
        return '<tr><td><b>' + esc(i.company) + '</b></td><td class="mono big">' + esc(i.code) + '</td><td>' + esc(i.expires_at) + '</td>' +
          '<td><button type="button" class="mini-btn" data-copy="' + esc(i.code) + '">복사</button></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="rfp-mailbox"><b>전달 문구</b><pre>' +
      esc('[매각 자문 RFP] ' + rfp.title + '\n' +
        '제출 마감: ' + (rfp.due_date || '-') + '\n' +
        '접속: Open AI Asset Bridge → 🤝 자문사 포털 → 승인 코드 입력\n' +
        issued.map(function (i) { return '· ' + i.company + ': ' + i.code; }).join('\n')) +
      '</pre><button type="button" class="mini-btn" data-copy-text="1">문구 복사</button></div>';
    var m = C.modal('승인 코드가 발급되었습니다', body, { wide: true, footer: '<button type="button" class="btn btn-primary" data-rfp="close">확인</button>' });
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-copy]');
      if (b) { copyText(b.getAttribute('data-copy')); return; }
      var t = e.target.closest('[data-copy-text]');
      if (t) { copyText((m.querySelector('pre') || {}).textContent || ''); }
    });
  }
  function copyText(t) {
    try {
      navigator.clipboard.writeText(t).then(function () { C.toast('복사했습니다.'); }, function () { C.toast('복사하지 못했습니다.', true); });
    } catch (e) {
      var ta = document.createElement('textarea');
      ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); C.toast('복사했습니다.'); } catch (e2) { C.toast('복사하지 못했습니다.', true); }
      ta.remove();
    }
  }

  /* ─────────────────────────── 모달: 평가 항목 ─────────────────────────── */
  function openCriteria(rfp) {
    var rows = (rfp.criteria || []).map(function (c) {
      return '<tr><td><input class="rfp-in" data-clabel value="' + esc(c.label) + '"></td>' +
        '<td class="num"><input class="rfp-in num" type="number" min="0" max="100" data-cweight value="' + n0(c.weight, 0) + '"></td>' +
        '<td><button type="button" class="mini-btn" data-cdel>×</button></td></tr>';
    }).join('');
    var body = '<p class="rfp-note">평가 항목과 가중치를 정합니다. 항목별 점수는 0~100점으로 매기고, 가중 평균이 총점이 됩니다.</p>' +
      '<table class="rfp-table" id="rfpCritTable"><thead><tr><th>평가 항목</th><th class="num">가중치</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<button type="button" class="mini-btn" data-rfp="crit-add">＋ 항목 추가</button>';
    var m = C.modal('⚖ 평가 항목·가중치', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-ghost" data-rfp="crit-default">기본값</button>' +
        '<button type="button" class="btn btn-primary" data-rfp="crit-save">저장</button>'
    });
    m.querySelector('[data-rfp="crit-add"]').addEventListener('click', function () {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><input class="rfp-in" data-clabel placeholder="예) 현장 답사 계획"></td>' +
        '<td class="num"><input class="rfp-in num" type="number" min="0" max="100" data-cweight value="5"></td>' +
        '<td><button type="button" class="mini-btn" data-cdel>×</button></td>';
      m.querySelector('#rfpCritTable tbody').appendChild(tr);
    });
    m.addEventListener('click', function (e) {
      if (e.target.closest('[data-cdel]')) { var tr = e.target.closest('tr'); if (tr) tr.remove(); }
    });
    m.querySelector('[data-rfp="crit-default"]').addEventListener('click', function () {
      m.querySelector('#rfpCritTable tbody').innerHTML = C.defaultCriteria().map(function (c) {
        return '<tr><td><input class="rfp-in" data-clabel value="' + esc(c.label) + '"></td>' +
          '<td class="num"><input class="rfp-in num" type="number" min="0" max="100" data-cweight value="' + c.weight + '"></td>' +
          '<td><button type="button" class="mini-btn" data-cdel>×</button></td></tr>';
      }).join('');
    });
    m.querySelector('[data-rfp="crit-save"]').addEventListener('click', function () {
      var out = [];
      Array.prototype.slice.call(m.querySelectorAll('#rfpCritTable tbody tr')).forEach(function (tr) {
        var label = (tr.querySelector('[data-clabel]') || {}).value || '';
        var w = num((tr.querySelector('[data-cweight]') || {}).value);
        if (label.trim()) out.push({ key: slugKey(label.trim(), rfp.criteria), label: label.trim(), weight: w });
      });
      if (!out.length) { C.toast('항목을 한 개 이상 남기세요.', true); return; }
      rfp.criteria = out;
      C.commit('rfps', rfp);
      C.closeModal(); paint(); C.toast('평가 항목을 저장했습니다.');
    });
  }

  /* ─────────────────────────── 검증용 예시 제안 ─────────────────────────── */
  function seedSubmissions(rfp) {
    var g = num(rfp.guide_eok) || 3000;
    var advs = C.list('advisors');
    if (advs.length < 3) {
      ['[샘플] 한빛부동산자문', '[샘플] 서강자산자문', '[샘플] 대성인베스트먼트'].forEach(function (co, i) {
        C.commit('advisors', { id: 'adv-smp-' + i, company: co, name: ['김한빛', '이서강', '박대성'][i], email: 'sample' + i + '@example.com', phone: '010-0000-000' + i, at: new Date().toISOString() });
      });
      advs = C.list('advisors');
    }
    var picks = advs.filter(function (a) { return /샘플/.test(a.company); }).slice(0, 3);
    if (picks.length < 3) picks = advs.slice(0, 3);
    var proto = [
      { fee: 1.1, fixed: 0.5, price: g * 1.04, months: 5, track: '오피스 매각 3건(3,000억)', access: 'FI 40 · SI 25 · 화주 10', team: '전담 5명(리드 1)', sched: 'TM D+20 · LOI D+45', extra: 'PF 주선·금융기관 검증 지원' },
      { fee: 0.8, fixed: 0.8, price: g * 0.99, months: 6, track: '오피스·물류 7건', access: 'FI 60 · SI 15', team: '전담 4명', sched: 'TM D+25 · LOI D+50', extra: '임차인 리텐션 자문' },
      { fee: 1.4, fixed: 0.3, price: g * 1.08, months: 4, track: '대형 오피스 2건(6,000억)', access: 'FI 25 · SI 40 · 해외 5', team: '전담 7명', sched: 'TM D+15 · LOI D+40', extra: '해외 투자자 로드쇼' }
    ];
    picks.forEach(function (a, i) {
      var p = proto[i] || proto[0];
      var exist = C.submissionOf(rfp.id, a.id);
      var inv = (rfp.invites || []).filter(function (x) { return x.advisor_id === a.id; })[0];
      if (!inv) {
        var rec = C.issueCode({ rfp_id: rfp.id, holder_type: '자문사', holder: a.company, holder_id: a.id, expires_at: C.addDays(C.today(), 30) });
        rfp.invites = rfp.invites || [];
        rfp.invites.push({ advisor_id: a.id, company: a.company, code: rec.code, at: new Date().toISOString(), expires_at: C.addDays(C.today(), 30), viewed_at: new Date().toISOString() });
      }
      C.commit('submissions', {
        id: exist ? exist.id : C.uid('sub'), rfp_id: rfp.id, advisor_id: a.id, advisor_company: a.company,
        version: exist ? (exist.version || 1) + 1 : 1, status: '제출(샘플)',
        fee_success: p.fee, fee_fixed: p.fixed, price_expect: Math.round(p.price), period_months: p.months,
        track_record: p.track, access_reach: p.access, team: p.team, schedule: p.sched, extra: p.extra,
        files: [], memo: '검증용 예시 제안 — 실제 접수 아님', sample: true, at: new Date().toISOString()
      });
    });
    rfp.status = '제안 접수';
    C.commit('rfps', rfp);
    paint();
    C.toast('예시 제안 3건을 넣었습니다. 평가표 동작 확인용입니다.');
  }

  /* ─────────────────────────── 내보내기 ─────────────────────────── */
  function printRfp(id) {
    var r = C.rfpOf(id);
    if (!r) return;
    C.printDoc(r.title, C.rfpHTML(r, { invites: true, weights: true }));
  }
  function wordRfp(id) {
    var r = C.rfpOf(id);
    if (!r) return;
    C.exportWord(r.title, C.rfpHTML(r, { invites: true, weights: true }));
  }
  function distributionText(rfp) {
    var inv = rfp.invites || [];
    return '[매각 자문 RFP] ' + rfp.title + '\n' +
      '대상: ' + (rfp.asset_name || '-') + '\n' +
      '발주일: ' + (rfp.issue_date || '-') + ' / 제출 마감: ' + (rfp.due_date || '-') + '\n' +
      '제출: Open AI Asset Bridge → 🤝 자문사 포털 → 승인 코드 입력\n' +
      (inv.length ? inv.map(function (i) { return '· ' + i.company + ': ' + i.code; }).join('\n') : '· (배부 전)') + '\n' +
      '문의: ' + (rfp.client || '') ;
  }
  function cmpCSV(rfp) {
    var subs = C.submissionsOf(rfp.id);
    if (!subs.length) { C.toast('내보낼 제안이 없습니다.', true); return; }
    var head = ['항목'].concat(subs.map(function (s) { return s.advisor_company; }));
    var rows = [];
    var defs = [
      ['성공보수(%)', function (s) { return s.fee_success || ''; }],
      ['고정수수료(억)', function (s) { return s.fee_fixed || ''; }],
      ['예상매각가(억)', function (s) { return s.price_expect || ''; }],
      ['예상기간(개월)', function (s) { return s.period_months || ''; }],
      ['유사실적', function (s) { return s.track_record || ''; }],
      ['투자자접근력', function (s) { return s.access_reach || ''; }],
      ['인력구성', function (s) { return s.team || ''; }],
      ['일정', function (s) { return s.schedule || ''; }],
      ['추가서비스', function (s) { return s.extra || ''; }]
    ];
    defs.forEach(function (d) { rows.push([d[0]].concat(subs.map(d[1]))); });
    rows.push(['총점'].concat(subs.map(function (s) { return C.totalScore(rfp, (C.scoreOf(rfp.id, s.advisor_id) || {}).values || {}); })));
    (rfp.criteria || []).forEach(function (c) {
      rows.push(['점수·' + c.label].concat(subs.map(function (s) { return ((C.scoreOf(rfp.id, s.advisor_id) || {}).values || {})[c.key] || ''; })));
    });
    C.csv('RFP_비교평가_' + C.safeName(rfp.title) + '_' + C.today().replace(/-/g, '') + '.csv', head, rows);
  }
  function printCmp(rfp) {
    var subs = C.submissionsOf(rfp.id);
    if (!subs.length) { C.toast('내보낼 제안이 없습니다.', true); return; }
    var rows = C.rankedScores(rfp.id);
    var rankBy = {}; rows.forEach(function (r) { rankBy[r.sub.advisor_id] = r; });
    var h = '<div class="rfp-doc"><h1>제안 비교·평가표</h1>' +
      '<p>' + esc(rfp.title) + ' · ' + esc(rfp.asset_name) + ' · ' + esc(C.today()) + '</p>' +
      '<table class="rfp-doc-table"><thead><tr><th>항목</th>' + subs.map(function (s) { return '<th>' + esc(s.advisor_company) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      '<tr><td>성공보수</td>' + subs.map(function (s) { return '<td>' + (s.fee_success ? n0(s.fee_success, 2) + '%' : '-') + '</td>'; }).join('') + '</tr>' +
      '<tr><td>고정수수료</td>' + subs.map(function (s) { return '<td>' + (s.fee_fixed ? n0(s.fee_fixed, 2) + '억' : '-') + '</td>'; }).join('') + '</tr>' +
      '<tr><td>예상 매각가</td>' + subs.map(function (s) { return '<td>' + (s.price_expect ? n0(s.price_expect, 0) + '억' : '-') + '</td>'; }).join('') + '</tr>' +
      '<tr><td>예상 기간</td>' + subs.map(function (s) { return '<td>' + (s.period_months ? s.period_months + '개월' : '-') + '</td>'; }).join('') + '</tr>' +
      '<tr><td>유사 실적</td>' + subs.map(function (s) { return '<td>' + esc(s.track_record || '-') + '</td>'; }).join('') + '</tr>' +
      '<tr><td>투자자 접근력</td>' + subs.map(function (s) { return '<td>' + esc(s.access_reach || '-') + '</td>'; }).join('') + '</tr>' +
      '<tr><td>인력</td>' + subs.map(function (s) { return '<td>' + esc(s.team || '-') + '</td>'; }).join('') + '</tr>' +
      '<tr><td>일정</td>' + subs.map(function (s) { return '<td>' + esc(s.schedule || '-') + '</td>'; }).join('') + '</tr>' +
      '<tr><td>추가 서비스</td>' + subs.map(function (s) { return '<td>' + esc(s.extra || '-') + '</td>'; }).join('') + '</tr>' +
      '<tr><td><b>총점</b></td>' + subs.map(function (s) { return '<td><b>' + (rankBy[s.advisor_id] ? rankBy[s.advisor_id].total : 0) + '</b></td>'; }).join('') + '</tr>' +
      '<tr><td><b>순위</b></td>' + subs.map(function (s) { return '<td>' + (rankBy[s.advisor_id] ? rankBy[s.advisor_id].rank + '위' : '-') + '</td>'; }).join('') + '</tr>' +
      '</tbody></table>';
    h += '<h3>평가 항목 점수</h3><table class="rfp-doc-table"><thead><tr><th>항목(가중치)</th>' +
      subs.map(function (s) { return '<th>' + esc(s.advisor_company) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rfp.criteria || []).map(function (c) {
        return '<tr><td>' + esc(c.label) + ' (' + n0(c.weight, 0) + ')</td>' + subs.map(function (s) {
          var v = ((C.scoreOf(rfp.id, s.advisor_id) || {}).values || {})[c.key];
          return '<td>' + (v == null ? '-' : n0(v, 0)) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>' +
      '<h3>평가 메모</h3>' + subs.map(function (s) {
        return '<p><b>' + esc(s.advisor_company) + '</b> — ' + esc(((C.scoreOf(rfp.id, s.advisor_id) || {}).memo) || '') + '</p>';
      }).join('') +
      '<p class="rfp-doc-foot">선정: ' + esc((subs.filter(function (s) { return s.advisor_id === rfp.selected_advisor_id; })[0] || {}).advisor_company || '미선정') + '</p></div>';
    C.printDoc('제안 비교·평가표', h);
  }

  /* ─────────────────────────── 이벤트 ─────────────────────────── */
  function bind() {
    var h = host();
    h.addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-rfp-tab]'))) { S.tab = b.getAttribute('data-rfp-tab'); paint(); return; }
      if ((b = e.target.closest('[data-rfp-work]'))) { S.assetId = b.getAttribute('data-rfp-work'); S.rfpId = ''; S.evalRfpId = ''; paint(); return; }
      if ((b = e.target.closest('[data-rfp-open]'))) { S.rfpId = b.getAttribute('data-rfp-open'); S.tab = 'rfps'; paint(); return; }
      if ((b = e.target.closest('[data-rfp-folder]'))) { S.rfpId = b.getAttribute('data-rfp-folder'); S.folderRfpId = b.getAttribute('data-rfp-folder'); S.tab = 'folder'; paint(); return; }
      if ((b = e.target.closest('[data-rfp-eval]'))) { S.evalRfpId = b.getAttribute('data-rfp-eval'); paint(); return; }
      if ((b = e.target.closest('[data-rfp-upload]'))) { uploadDoc(b.getAttribute('data-rfp-upload')); return; }
      if ((b = e.target.closest('[data-rfp-paste]'))) { pasteDoc(b.getAttribute('data-rfp-paste')); return; }
      if ((b = e.target.closest('[data-rfp-view]'))) { viewDoc(b.getAttribute('data-rfp-view')); return; }
      if ((b = e.target.closest('[data-rfp-dl]'))) {
        var d = C.byId('docs', b.getAttribute('data-rfp-dl')); if (d && !C.downloadFile(d)) C.toast('내려받을 원본이 없습니다.', true); return;
      }
      if ((b = e.target.closest('[data-rfp-del]'))) {
        var dd = C.byId('docs', b.getAttribute('data-rfp-del'));
        if (dd && window.confirm('“' + dd.name + '” 자료를 삭제할까요?')) { C.drop('docs', dd.id); paint(); C.toast('삭제했습니다.'); }
        return;
      }
      if ((b = e.target.closest('[data-rfp-edit]'))) { openRfpEditor(C.rfpOf(b.getAttribute('data-rfp-edit'))); return; }
      if ((b = e.target.closest('[data-rfp-dist]'))) { openDistribute(C.rfpOf(b.getAttribute('data-rfp-dist'))); return; }
      if ((b = e.target.closest('[data-rfp-print]'))) { printRfp(b.getAttribute('data-rfp-print')); return; }
      if ((b = e.target.closest('[data-rfp-word]'))) { wordRfp(b.getAttribute('data-rfp-word')); return; }
      if ((b = e.target.closest('[data-rfp-copy]'))) { copyText(distributionText(C.rfpOf(b.getAttribute('data-rfp-copy')))); return; }
      if ((b = e.target.closest('[data-rfp-delrfp]'))) {
        var rr = C.rfpOf(b.getAttribute('data-rfp-delrfp'));
        if (rr && window.confirm('“' + rr.title + '” RFP를 삭제할까요? (제안서·점수는 남습니다)')) {
          C.drop('rfps', rr.id); S.rfpId = ''; paint(); C.toast('삭제했습니다.');
        }
        return;
      }
      if ((b = e.target.closest('[data-rfp-criteria]'))) { openCriteria(C.rfpOf(b.getAttribute('data-rfp-criteria'))); return; }
      if ((b = e.target.closest('[data-rfp-expcmp]'))) { cmpCSV(C.rfpOf(b.getAttribute('data-rfp-expcmp'))); return; }
      if ((b = e.target.closest('[data-rfp-printcmp]'))) { printCmp(C.rfpOf(b.getAttribute('data-rfp-printcmp'))); return; }
      if ((b = e.target.closest('[data-rfp-seed]'))) { seedSubmissions(C.rfpOf(b.getAttribute('data-rfp-seed'))); return; }
      if ((b = e.target.closest('[data-rfp-autoscore]'))) {
        var rf = C.rfpOf(b.getAttribute('data-rfp-autoscore'));
        var subs = C.submissionsOf(rf.id);
        var auto = C.autoScores(rf, subs);
        subs.forEach(function (s) {
          var rec = C.scoreOf(rf.id, s.advisor_id) || { id: C.uid('sc'), rfp_id: rf.id, advisor_id: s.advisor_id, values: {} };
          rec.values = Object.assign({}, rec.values || {}, auto[s.advisor_id]);
          C.commit('scores', rec);
        });
        paint(); C.toast('수수료·매각가·기간을 상대 평가해 채웠습니다. 나머지 항목을 조정하세요.');
        return;
      }
      if ((b = e.target.closest('[data-rfp-select]'))) {
        var pair = b.getAttribute('data-rfp-select').split('|');
        var rfp = C.rfpOf(pair[0]);
        var sub = C.submissionOf(pair[0], pair[1]);
        if (!rfp || !sub) return;
        if (!window.confirm(sub.advisor_company + '을(를) 최종 자문사로 선정할까요?')) return;
        rfp.selected_advisor_id = pair[1];
        rfp.status = '선정';
        C.commit('rfps', rfp);
        C.list('submissions').forEach(function (s) {
          if (s.rfp_id === rfp.id) { s.status = s.advisor_id === pair[1] ? '선정' : '미선정'; C.commit('submissions', s); }
        });
        paint(); C.toast(sub.advisor_company + '을(를) 선정했습니다. 🤝 자문사 포털에서 자료 인계로 이어가세요.');
        return;
      }
      if ((b = e.target.closest('[data-rfp-unselect]'))) {
        var r2 = C.rfpOf(b.getAttribute('data-rfp-unselect'));
        r2.selected_advisor_id = ''; r2.status = '평가'; C.commit('rfps', r2); paint(); C.toast('선정을 취소했습니다.'); return;
      }
      var act = (e.target.closest('[data-rfp]') || {}).getAttribute && (e.target.closest('[data-rfp]') || {}).getAttribute('data-rfp');
      if (!act) return;
      if (act === 'asset-add') openAssetPicker();
      else if (act === 'rfp-new') openRfpEditor(null);
      else if (act === 'reload') { C.SYNC.checked = false; C.pullServer().then(paint); }
      else if (act === 'export') { C.download('AssetBridge_RFP_' + C.today().replace(/-/g, '') + '.json', C.exportAll(), 'application/json'); C.toast('RFP 데이터를 JSON으로 저장했습니다.'); }
      else if (act === 'import') importJson();
    });
    h.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-sc]') || t.matches('[data-wt]')) {
        var rfpId = S.evalRfpId;
        recalcEval(rfpId);
        saveScores(rfpId);
      }
      if (t.matches('[data-memo]')) saveScores(S.evalRfpId);
    });
  }
  function importJson() {
    C.pickFiles(false).then(function (files) {
      if (!files || !files.length) return;
      var r = new FileReader();
      r.onload = function () {
        if (C.importAll(String(r.result || ''))) { paint(); C.toast('데이터를 불러왔습니다.'); }
        else C.toast('불러오지 못했습니다. RFP JSON 파일인지 확인하세요.', true);
      };
      r.readAsText(files[0], 'utf-8');
    });
  }

  /* ─────────────────────────── 진입 ─────────────────────────── */
  function show() {
    var h = host();
    if (!h) return;
    if (!C.canClient()) {
      h.innerHTML = '<div class="rfp-shell"><div class="rfp-empty big"><b>RFP 발주는 의뢰인(관리자·내부 CM) 화면입니다.</b>' +
        '<p>자문사·매수자·금융기관은 <b>🤝 자문사 포털</b>에서 승인 코드로 접속해 주세요.</p></div></div>';
      h.dataset.ready = '';
      return;
    }
    if (!S.assetId) {
      var ws = C.works();
      if (ws.length) S.assetId = ws[0].id;
    }
    paint();
    C.pullServer().then(function () { paint(); });
  }

  window.NAI_RFP = { show: show, state: S, openAssetPicker: openAssetPicker };

  /* 탭 전환 시 다른 화면에서 RFP로 바로 보내기 */
  window.NAI_RFP_OPEN = function (assetId, tab, rfpId) {
    var rfp = rfpId ? C.rfpOf(rfpId) : null;
    if (!assetId && rfp) assetId = rfp.asset_id;
    if (rfpId) { S.rfpId = rfpId; S.folderRfpId = rfpId; }
    if (assetId) { C.pinAsset(assetId); S.assetId = assetId; }
    if (tab) S.tab = tab;
    if (window.naiShowView) window.naiShowView('rfp');
    else paint();
  };
})();
