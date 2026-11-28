/* =========================================================================
   Open AI Asset Bridge — rfpflow.js  (📁 RFP 제출 폴더 · 2026-11-28)
   -------------------------------------------------------------------------
   RFP 한 건(= 자문사 딜 1건)의 제출 폴더입니다. 한 화면에 모읍니다.

     ① RFP 원문·첨부(자료 세트) · 물건 위치
     ② 참여자(자문사·투자자·금융기관)와 CA 수기 절차
        양식 다운로드 → 내부 결재 요청 → 결재 완료 → 날인본 등록 → 발송 → 서명본 회수(CA 접수)
     ③ 접수 현황판(제출/미제출/마감 임박/지연) · 미제출 안내문
     ④ 비교평가·의견 초안(플랫폼 초안 · 사람 검토) · 엑셀 리포트
     ⑤ 담당자(운용사) 확인 → 외부 보고 → 선정

   화면은 rfp.js 가 그리는 영역 안에 들어가고, 액션은 위임 이벤트로 처리합니다.
   자료 열람 권한(CA 게이트)은 rfpcore.js 의 materialAccess() 한 곳에서 판정합니다.
   ========================================================================= */
(function () {
  'use strict';

  var C = window.NAI_RFPC;
  if (!C) return;
  var esc = C.esc, n0 = C.n0, num = C.num;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function badge(txt, cls) { return '<span class="rfp-tag ' + (cls || '') + '">' + esc(txt) + '</span>'; }
  function kpi(v, l) { return '<span class="rfp-kpi"><b>' + esc(v) + '</b><em>' + esc(l) + '</em></span>'; }
  function stageIdx(s) { return C.flowIndex(s); }
  function dayTag(dleft) {
    if (dleft === null) return '<span class="rfp-due">마감 미정</span>';
    var cls = dleft < 0 ? ' over' : (dleft <= 3 ? ' soon' : '');
    return '<span class="rfp-due' + cls + '">' + (dleft < 0 ? '마감 지남(D' + dleft + ')' : 'D-' + dleft) + '</span>';
  }
  function partyTypeCls(t) { return t === '자문사' ? 'adv' : (t === '금융기관' ? 'fi' : 'inv'); }

  /* ─────────────────────────── 화면 ─────────────────────────── */
  function html(rfpId) {
    var rfp = C.rfpOf(rfpId);
    if (!rfp) return '<div class="rfp-empty"><b>RFP를 찾을 수 없습니다.</b></div>';
    var st = C.flowOf(rfp), sti = stageIdx(st);
    var s = C.dealStats(rfp);
    var loc = C.locOf(rfp.asset_id);
    var h = '';

    /* 헤더 · 단계 · 전이 */
    h += '<div class="rfp-sec-head"><div><h3>📁 제출 폴더 — ' + esc(rfp.title) + '</h3>' +
      '<p>' + esc([rfp.asset_name, rfp.client, '담당 ' + (rfp.owner || '미지정'), '발주 ' + (rfp.issue_date || '-')].filter(Boolean).join(' · ')) + '</p></div>' +
      '<div class="rfp-sec-tools">' + dayTag(s.dleft) +
      '<button type="button" class="btn btn-ghost" data-fl="rfp-print">🖨 RFP 원문</button>' +
      '<button type="button" class="btn btn-ghost" data-fl="rfp-word">⬇ Word</button>' +
      '<button type="button" class="btn btn-ghost" data-fl="history">🕘 이력</button>' +
      '</div></div>';

    h += '<div class="rfp-fsteps">' + C.FLOW.map(function (f, i) {
      var cls = i < sti ? ' done' : (i === sti ? ' on' : '');
      return '<span class="rfp-fstep' + cls + '"><i>' + (i + 1) + '</i>' + esc(f) + '</span>';
    }).join('<span class="rfp-farrow">›</span>') +
      (s.perf ? '<span class="rfp-farrow">→</span><span class="rfp-fstep on perf"><i>＋</i>자문 수행 · ' + esc(s.perf.stage) + '</span>' : '') + '</div>';

    var guard = C.flowGuard(rfp, C.FLOW[sti + 1] || '');
    h += '<div class="rfp-flowbar"><div class="rfp-flowbar-main"><b>현재 단계</b> ' + badge(st, 'flow') +
      '<em>다음 할 일: ' + esc(C.nextActionOf(rfp)) + '</em></div><div class="rfp-flowbar-act">';
    if (sti >= 0 && sti < C.FLOW.length - 1) {
      h += '<button type="button" class="btn btn-primary" data-fl="stage" data-to="' + esc(C.FLOW[sti + 1]) + '"' +
        (guard ? ' data-guard="' + esc(guard) + '"' : '') + '>다음 단계: ' + esc(C.FLOW[sti + 1]) + ' →</button>';
    } else if (st === '선정' && s.perf && s.perf.stage !== '종결') {
      h += '<button type="button" class="btn btn-ghost" data-fl="perf-next">자문 수행 다음 단계 →</button>';
    }
    if (sti > 0) h += '<button type="button" class="btn btn-ghost" data-fl="stage-back">← 이전 단계</button>';
    h += '</div></div>';

    h += '<div class="rfp-kpis">' +
      kpi(s.invited + '명', '초청 자문사') + kpi(s.ca + '/' + s.parties, 'CA 접수') +
      kpi(s.submitted + '/' + s.invited, '제안서 제출') +
      kpi(s.evalsDone + '/' + s.evals, '평가 검토') +
      kpi(s.pendingReq + '건', '자료 요청 대기') +
      '</div>';

    /* ① */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>① RFP 원문 · 첨부 자료 · 위치</b>' +
      '<span>' + C.materialsOf(rfp).length + '건 자료 · ' + (loc.lat ? '좌표 확인' : '좌표 미확인') + '</span></div>';
    h += locCard(rfp, loc);
    h += materialSummary(rfp);
    h += '<details class="rfp-det"><summary>RFP 원문 보기</summary>' + C.rfpHTML(rfp, { invites: true }) + '</details>';
    h += '</section>';

    /* ② */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>② 참여자 · CA 수기 절차</b>' +
      '<span>자문사 ' + C.participantsOf(rfp.id).filter(function (p) { return p.party_type === '자문사'; }).length +
      ' · 투자자 ' + C.participantsOf(rfp.id).filter(function (p) { return p.party_type === '투자자'; }).length +
      ' · 금융기관 ' + C.participantsOf(rfp.id).filter(function (p) { return p.party_type === '금융기관'; }).length + '</span></div>';
    h += caFlow(rfp);
    h += partyTable(rfp);
    h += '</section>';

    /* ③ */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>③ 접수 현황판</b>' +
      '<span class="rfp-panel-tools"><button type="button" class="mini-btn" data-fl="notice">✉️ 미제출 안내문</button>' +
      '<button type="button" class="mini-btn" data-fl="sub-upload">＋ 제출본 업로드(대리)</button>' +
      '<button type="button" class="mini-btn" data-fl="draft-eval">🧠 제안서 분석 → 평가 초안</button></span></div>';
    h += intakeBoard(rfp, s);
    h += '</section>';

    /* ④ */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>④ 비교평가 · 의견</b>' +
      '<span class="rfp-panel-tools"><button type="button" class="mini-btn" data-fl="xlsx">📥 엑셀 리포트</button>' +
      '<button type="button" class="mini-btn" data-fl="print-eval">🖨 인쇄</button></span></div>';
    h += evalBoard(rfp);
    h += '</section>';

    /* ⑤ */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>⑤ 담당자(운용사) 확인 → 외부 보고 → 선정</b></div>';
    h += reviewBoard(rfp, s);
    h += '</section>';
    return h;
  }

  /* ① 위치 */
  function locCard(rfp, loc) {
    var v = loc.verify || {};
    var h = '<div class="rfp-loc' + (loc.verified ? ' ok' : '') + '">' +
      '<div class="rfp-loc-main"><b>' + esc(loc.address || '주소 미확인') + '</b>' +
      '<span>' + esc([loc.jibun && loc.jibun !== loc.address ? '지번 ' + loc.jibun : '', loc.region, loc.precision].filter(Boolean).join(' · ') || '좌표·정밀도 정보 없음') + '</span>' +
      '<em>' + (loc.lat ? '좌표 ' + loc.lat.toFixed(6) + ', ' + loc.lng.toFixed(6) : '좌표 미확인 — 위치는 주소로만 확인 가능') + '</em></div>' +
      '<div class="rfp-loc-act">' +
      (loc.map_url ? '<a class="mini-btn" href="' + esc(loc.map_url) + '" target="_blank" rel="noopener">🗺 카카오맵</a>' : '') +
      (loc.road_url ? '<a class="mini-btn" href="' + esc(loc.road_url) + '" target="_blank" rel="noopener">🛣 로드뷰</a>' : '') +
      (loc.lat ? '<button type="button" class="mini-btn" data-fl="loc-map">📍 앱 지도에서 보기</button>' : '') +
      '<button type="button" class="mini-btn" data-fl="loc-copy">📋 주소 복사</button>' +
      '<button type="button" class="mini-btn" data-fl="loc-verify">' + (loc.verified ? '✔ 확인 완료 · 수정' : '✔ 위치 확인 완료 기록') + '</button>' +
      '</div></div>' +
      '<p class="rfp-hint">' + (loc.verified
        ? '위치 확인 완료 — ' + esc(v.by || '') + ' · ' + esc(C.when(v.at)) + (v.memo ? ' · ' + esc(v.memo) : '')
        : '위치 확인 기록이 없습니다. 좌표가 없으면 임의로 만들지 않고 「좌표 미확인」으로 표시합니다.') + '</p>';
    return h;
  }

  /* ① 자료 세트 */
  function materialSummary(rfp) {
    var groups = C.materialGroups(rfp, null);
    var h = '<div class="rfp-mats">';
    groups.forEach(function (g) {
      var n = g.items.length;
      var label = n ? (n + '건') : (g.asset_im ? '보유(자산 링크)' : '미보유');
      h += '<span class="rfp-mat"><i>' + g.icon + '</i><b>' + esc(g.label) + '</b><em>' + esc(label) + '</em></span>';
    });
    h += '</div><div class="rfp-matactions">' +
      '<button type="button" class="mini-btn" data-fl="mat-edit">✏️ 자료 세트 편집</button>' +
      '<button type="button" class="mini-btn" data-fl="ca-template">⬇ CA 양식 다운로드(임시)</button>' +
      '<span class="rfp-hint">기본 개방: IM·티저 / 렌트롤 / OPEX (CA 접수 후) · 기타 자료: 요청 시 개방</span></div>';
    groups.forEach(function (g) {
      if (!g.items.length) return;
      h += '<div class="rfp-matgroup"><b>' + g.icon + ' ' + esc(g.label) + '</b><div class="rfp-matlist">' +
        g.items.map(function (it) {
          return '<span class="rfp-matif' + (it.latest ? ' latest' : '') + '">' +
            '<b>' + esc(it.name) + '</b>' +
            '<em>v' + it.version + (it.latest ? ' · 최신' : '') + ' · ' + esc(C.when(it.at).slice(0, 10)) + ' · ' + esc(it.access) +
            (it.viewers ? ' · 열람 ' + it.viewers + '회' : '') + '</em></span>';
        }).join('') + '</div></div>';
    });
    return h;
  }

  /* ② CA 수기 절차 */
  function caFlow(rfp) {
    var deal = C.caDealOf(rfp.id) || { status: '미착수' };
    var idx = C.CA_STAGES.indexOf(deal.status || '미착수');
    var ap = deal.approval || {}, sealed = deal.sealed || {};
    var h = '<div class="rfp-caflow"><div class="rfp-caflow-head"><b>CA 진행 (수기 절차 기록)</b>' +
      '<span class="rfp-hint">전자서명·외부 연동 없음 · 추후 시스템 연동 검토(Phase 2)</span></div>' +
      '<div class="rfp-casteps">' + C.CA_STAGES.map(function (s, i) {
        return '<span class="rfp-castep' + (i < idx ? ' done' : (i === idx ? ' on' : '')) + '"><i>' + (i + 1) + '</i>' + esc(s) + '</span>';
      }).join('') + '</div>';
    h += '<div class="rfp-cainfo">' +
      '<span>결재: ' + (ap.result ? badge(ap.result, ap.result === '승인' ? 'ok' : 'wait') + ' ' + esc([ap.requester, '→', ap.approver].join(' ')) + ' · ' + esc(C.when(ap.decided_at || ap.requested_at)) : '<em class="rfp-muted">미기록</em>') + '</span>' +
      '<span>날인본: ' + (sealed.name ? esc(sealed.name) + ' · v' + (sealed.version || 1) + ' · ' + esc(C.when(sealed.uploaded_at)) : '<em class="rfp-muted">미등록</em>') + '</span>' +
      '<span>발송: ' + ((deal.sends || []).length ? (deal.sends.length + '명 · ' + esc(C.when(deal.sends[0].at))) : '<em class="rfp-muted">미발송</em>') + '</span></div>';
    h += '<div class="rfp-caacts">' +
      '<button type="button" class="mini-btn" data-fl="ca-template">1) 양식 다운로드</button>' +
      '<button type="button" class="mini-btn" data-fl="ca-approval">2) 내부 결재</button>' +
      '<button type="button" class="mini-btn" data-fl="ca-seal"' + (ap.result === '승인' ? '' : ' disabled title="내부 결재 승인 후 등록할 수 있습니다"') + '>3) 날인본 등록</button>' +
      '<button type="button" class="mini-btn" data-fl="ca-send"' + (ap.result === '승인' && sealed.name ? '' : ' disabled title="결재 승인 + 날인본 등록 후 발송 단계로 넘어갈 수 있습니다"') + '>4) 자문사 발송 기록</button>' +
      '</div></div>';
    return h;
  }

  /* ② 참여자 표 */
  function partyTable(rfp) {
    var ps = C.participantsOf(rfp.id);
    if (!ps.length) return '<p class="rfp-hint">아직 참여자가 없습니다. <b>RFP 배포</b>에서 자문사를 선택하면 참여자로 등록됩니다.</p>';
    var deal = C.caDealOf(rfp.id) || {};
    var sends = deal.sends || [];
    var h = '<div class="rfp-table-wrap"><table class="rfp-table small"><thead><tr>' +
      '<th>구분</th><th>회사 · 담당자</th><th>CA 상태</th><th>서명일</th><th>발송</th><th>열람</th><th>제안서</th><th></th></tr></thead><tbody>';
    ps.forEach(function (p) {
      var ca = C.caReceiptOf(rfp.id, p.id);
      var sub = p.party_type === '자문사' ? C.submissionOf(rfp.id, p.ref_id) : null;
      var loi = (p.party_type !== '자문사') ? C.loiOf(rfp.id, p.id) : null;
      var acc = C.accessLogOf(rfp.id).filter(function (a) { return String(a.holder) === String(p.company) || String(a.holder_id) === String(p.id); }).length;
      var send = sends.filter(function (x) { return x.participant_id === p.id; })[0];
      h += '<tr><td>' + badge(p.party_type, partyTypeCls(p.party_type)) + '</td>' +
        '<td><b>' + esc(p.company || '-') + '</b><span class="rfp-sub">' + esc([p.name, p.title, p.email].filter(Boolean).join(' · ')) + '</span></td>' +
        '<td>' + (ca && ca.status === 'CA 접수' ? badge('CA 접수', 'ok') : (ca ? badge(ca.status || 'CA 미제출', 'wait') : badge('CA 미제출', 'wait'))) +
        (ca ? '<span class="rfp-sub">' + esc(ca.signed_date || '') + ' · v' + (ca.version || 1) + '</span>' : '') + '</td>' +
        '<td>' + esc((ca && ca.signed_date) || '-') + '</td>' +
        '<td>' + (send ? esc(C.when(send.at).slice(0, 10)) : '-') + '</td>' +
        '<td class="num">' + acc + '회</td>' +
        '<td>' + (sub ? badge('v' + (sub.version || 1) + ' ' + (sub.status || ''), 'ok') : (loi ? badge('LOI ' + (loi.status || ''), 'ok') : '<span class="rfp-muted">-</span>')) + '</td>' +
        '<td><button type="button" class="mini-btn" data-fl="party-ca" data-pid="' + esc(p.id) + '">CA 서명본 등록</button></td></tr>';
    });
    h += '</tbody></table></div>' +
      '<div class="rfp-matactions"><button type="button" class="mini-btn" data-fl="party-add">＋ 투자자·금융기관 참여자 추가</button>' +
      '<span class="rfp-hint">CA 서명본이 접수된 참여자만 그 딜의 자료를 열람·다운로드할 수 있습니다(권한은 한 곳에서 판정).</span></div>';
    return h;
  }

  /* ③ 접수 현황판 */
  function intakeBoard(rfp, s) {
    var invites = rfp.invites || [], subs = C.submissionsOf(rfp.id);
    var rows = invites.map(function (inv) {
      var sub = subs.filter(function (x) { return String(x.advisor_id) === String(inv.advisor_id); })[0];
      var p = C.findParticipant(rfp.id, { ref_id: inv.advisor_id, company: inv.company });
      var ca = C.caReceiptOf(rfp.id, p ? p.id : inv.advisor_id);
      var chk = sub ? C.checklistFor(rfp, sub) : [];
      var done = chk.filter(function (c) { return c.ok; }).length;
      var dleft = C.daysLeft(rfp.due_date);
      var flag = sub ? '제출' : (dleft === null ? '미제출' : (dleft < 0 ? '지연' : (dleft <= 3 ? '임박' : '미제출')));
      return { inv: inv, sub: sub, ca: ca, chk: chk, done: done, flag: flag };
    });
    var cnt = { 제출: 0, 미제출: 0, 임박: 0, 지연: 0 };
    rows.forEach(function (r) { cnt[r.flag] = (cnt[r.flag] || 0) + 1; });
    var h = '<div class="rfp-kpis">' + kpi(cnt['제출'] || 0, '제출') + kpi(cnt['미제출'] || 0, '미제출') +
      kpi(cnt['임박'] || 0, '마감 임박(D-3)') + kpi(cnt['지연'] || 0, '마감 지남') +
      kpi((s.ca || 0) + '명', 'CA 접수') + '</div>';
    if (!rows.length) return h + '<p class="rfp-hint">아직 배포한 자문사가 없습니다. RFP 단계에서 <b>자문사 배포</b>를 먼저 하세요.</p>';
    h += '<div class="rfp-table-wrap"><table class="rfp-table small"><thead><tr><th>자문사</th><th>CA</th><th>상태</th><th>제출시각</th><th>버전</th><th>파일</th><th>요구서류</th><th>총점</th><th>열람</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var p = C.findParticipant(rfp.id, { ref_id: r.inv.advisor_id, company: r.inv.company });
      var acc = p ? C.accessLogOf(rfp.id).filter(function (a) { return String(a.holder) === String(p.company); }).length : 0;
      var sc = C.evaluationOf(rfp.id, r.inv.advisor_id);
      var tot = sc ? sc.total : (r.sub ? C.totalScore(rfp, (C.scoreOf(rfp.id, r.inv.advisor_id) || {}).values || {}) : null);
      h += '<tr><td><b>' + esc(r.inv.company) + '</b><span class="rfp-sub">코드 ' + esc(r.inv.code || '-') + (r.inv.viewed_at ? ' · 열람 ' + esc(C.when(r.inv.viewed_at).slice(5, 16)) : ' · 미열람') + '</span></td>' +
        '<td>' + (r.ca && r.ca.status === 'CA 접수' ? badge('접수', 'ok') : badge('미제출', 'wait')) + '</td>' +
        '<td>' + badge(r.flag, r.flag === '제출' ? 'ok' : (r.flag === '지연' ? 'over' : (r.flag === '임박' ? 'soon' : 'wait'))) + '</td>' +
        '<td>' + (r.sub ? esc(C.when(r.sub.at)) : '-') + '</td>' +
        '<td>' + (r.sub ? 'v' + (r.sub.version || 1) : '-') + '</td>' +
        '<td>' + (r.sub ? ((r.sub.files || []).length + '건') : '-') + '</td>' +
        '<td>' + (r.sub ? r.done + '/' + r.chk.length : '-') + '</td>' +
        '<td class="num"><b>' + (tot == null ? '-' : tot) + '</b></td>' +
        '<td class="num">' + acc + '</td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  /* ④ 평가 */
  function evalBoard(rfp) {
    var subs = C.submissionsOf(rfp.id);
    var evals = C.evaluationsOf(rfp.id);
    var h = '<div class="rfp-draftbanner"><b>플랫폼이 만든 초안</b> — 제출 제안서를 평가항목과 대조해 근거·미흡·의견 초안을 만든 것입니다. ' +
      '확정 판단이 아니며 담당자 검토·수정 후 확정됩니다. 기준일 ' + esc(C.today()) + '.</div>';
    if (!subs.length) return h + '<p class="rfp-hint">접수된 제안서가 없습니다. 자문사가 포털에서 제출하거나 <b>제출본 업로드(대리)</b>로 등록하세요.</p>';
    if (!evals.length) return h + '<p class="rfp-hint">평가 초안이 아직 없습니다. <b>제안서 분석 → 평가 초안</b>을 누르면 항목별 점수·근거·의견 초안이 만들어집니다.</p>';

    /* 총점·순위는 평가 초안(evaluations)의 가중 평균을 사용합니다. */
    var rows = C.submissionsOf(rfp.id).map(function (sub) {
      var e = C.evaluationOf(rfp.id, sub.advisor_id) || {};
      return { sub: sub, total: e.total || 0 };
    }).sort(function (a, b) { return b.total - a.total; });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    var rankBy = {}; rows.forEach(function (r) { rankBy[r.sub.advisor_id] = r; });
    h += '<div class="rfp-table-wrap"><table class="rfp-table rfp-score"><thead><tr><th class="sticky-col">평가 항목</th><th class="num">가중치</th>' +
      subs.map(function (s) { return '<th>' + esc(s.advisor_company) + '</th>'; }).join('') + '</tr></thead><tbody>';
    (rfp.criteria || []).forEach(function (c) {
      h += '<tr><td class="sticky-col"><b>' + esc(c.label) + '</b></td><td class="num">' + n0(c.weight, 0) + '</td>' +
        subs.map(function (s) {
          var e = C.evaluationOf(rfp.id, s.advisor_id) || {};
          var v = (e.items || {})[c.key] || {};
          return '<td class="num"><input class="rfp-in num" type="number" min="0" max="100" step="1" data-fl-score="' + esc(s.advisor_id) + '|' + esc(c.key) + '" value="' + (v.score == null ? '' : n0(v.score, 0)) + '"></td>';
        }).join('') + '</tr>';
    });
    h += '<tr class="rfp-total"><td class="sticky-col"><b>총점(가중 평균)</b></td><td></td>' +
      subs.map(function (s) { return '<td class="num"><b data-fl-total="' + esc(s.advisor_id) + '">' + (rankBy[s.advisor_id] ? rankBy[s.advisor_id].total : 0) + '</b></td>'; }).join('') + '</tr>' +
      '<tr class="rfp-rank"><td class="sticky-col"><b>순위</b></td><td></td>' +
      subs.map(function (s) { return '<td class="num" data-fl-rank="' + esc(s.advisor_id) + '">' + (rankBy[s.advisor_id] ? rankBy[s.advisor_id].rank + '위' : '-') + '</td>'; }).join('') + '</tr>' +
      '</tbody></table></div>';

    subs.forEach(function (s) {
      var e = C.evaluationOf(rfp.id, s.advisor_id) || { items: {}, checklist: [], risks: [] };
      h += '<details class="rfp-evalcard" open><summary><b>' + esc(s.advisor_company) + '</b> ' +
        badge(e.status || '초안', e.status === '검토 완료' ? 'ok' : 'wait') +
        (rankBy[s.advisor_id] ? ' <em>' + rankBy[s.advisor_id].total + '점 · ' + rankBy[s.advisor_id].rank + '위</em>' : '') +
        '<span class="rfp-sub">제안 v' + (s.version || 1) + ' · ' + esc(C.when(s.at)) + '</span></summary>';
      h += '<p class="rfp-evalsum"><textarea class="rfp-in" rows="2" data-fl-sum="' + esc(s.advisor_id) + '" placeholder="평가 요약">' + esc(e.summary || '') + '</textarea></p>';
      h += '<div class="rfp-evalchips">' +
        ((e.checklist || []).length ? (e.checklist || []).map(function (c) { return badge((c.ok ? '✓ ' : '✗ ') + c.label, c.ok ? 'ok' : 'over'); }).join('') : '') +
        ((e.risks || []).length ? (e.risks || []).map(function (r) { return badge('⚠ ' + r.label, 'soon'); }).join('') : '') + '</div>';
      h += '<table class="rfp-table tiny"><thead><tr><th>항목</th><th>근거(제안서에서 추출)</th><th>미흡·확인</th><th>의견(수정 가능)</th></tr></thead><tbody>';
      (rfp.criteria || []).forEach(function (c) {
        var it = (e.items || {})[c.key] || {};
        h += '<tr><td><b>' + esc(c.label) + '</b></td><td class="rfp-sub">' + esc(it.evidence || '-') + '</td><td class="rfp-sub">' + esc(it.gap || '') + '</td>' +
          '<td><textarea class="rfp-in memo" rows="2" data-fl-comment="' + esc(s.advisor_id) + '|' + esc(c.key) + '" placeholder="의견">' + esc(it.comment || '') + '</textarea></td></tr>';
      });
      h += '</tbody></table>';
      h += '<div class="rfp-evalfoot"><span class="rfp-hint">' + esc(e.basis || '') + '</span>' +
        '<button type="button" class="mini-btn' + (e.status === '검토 완료' ? '' : ' primary') + '" data-fl="eval-confirm" data-aid="' + esc(s.advisor_id) + '">' +
        (e.status === '검토 완료' ? '✔ 검토 완료(해제)' : '✔ 검토 완료 처리') + '</button></div>';
      h += '</details>';
    });
    return h;
  }

  /* ⑤ 담당자 확인·외부 보고·선정 */
  function reviewBoard(rfp, s) {
    var sel = s.selected || C.selectionOf(rfp.id);
    var rv = (sel && sel.review) || {};
    var h = '<div class="rfp-reviewgrid"><div class="rfp-reviewcard">' +
      '<b>운용사 담당자 확인</b>' +
      '<p class="rfp-hint">보고서를 담당자에게 보내고, 받은 확인(승인/조건부/보류)을 기록합니다. NAI 관리자만 기록할 수 있습니다.</p>' +
      '<div class="rfp-cainfo"><span>' + (rv.at ? badge(rv.result, rv.result === '승인' ? 'ok' : (rv.result === '보류' ? 'over' : 'soon')) + ' ' + esc([rv.client_name, rv.client_title, rv.method].filter(Boolean).join(' · ')) + ' · ' + esc(C.when(rv.at)) : '<em class="rfp-muted">확인 기록 없음</em>') + '</span></div>' +
      (rv.memo ? '<p class="rfp-hint">의견: ' + esc(rv.memo) + '</p>' : '') +
      '<div class="rfp-matactions"><button type="button" class="mini-btn" data-fl="review">✍️ 확인 결과 기록</button>' +
      '<button type="button" class="mini-btn" data-fl="report">📄 외부 보고서</button>' +
      '<button type="button" class="mini-btn" data-fl="report-text">✉️ 검토 요청 문안</button></div></div>';

    h += '<div class="rfp-reviewcard"><b>선정</b>';
    var subs = C.submissionsOf(rfp.id);
    if (!subs.length) h += '<p class="rfp-hint">제안서가 없습니다.</p>';
    else {
      var rows = subs.map(function (sub) { var e = C.evaluationOf(rfp.id, sub.advisor_id) || {}; return { sub: sub, total: e.total || 0 }; })
        .sort(function (a, b) { return b.total - a.total; });
      rows.forEach(function (r, i) { r.rank = i + 1; });
      h += '<div class="rfp-selectrow">' + rows.map(function (r) {
        var on = String(rfp.selected_advisor_id) === String(r.sub.advisor_id);
        return '<button type="button" class="rfp-selectbtn' + (on ? ' on' : '') + '" data-fl="pick" data-aid="' + esc(r.sub.advisor_id) + '">' +
          (on ? '✅ ' : '') + esc(r.sub.advisor_company) + '<em>' + r.total + '점 · ' + r.rank + '위</em></button>';
      }).join('') + '</div>';
    }
    if (sel && sel.advisor_id) {
      h += '<p class="rfp-hint">선정: <b>' + esc(sel.company) + '</b> · ' + esc(sel.total || '') + '점 · ' + esc(C.when(sel.decided_at)) + ' · ' + esc(sel.decided_by || '') + '</p>' +
        '<div class="rfp-matactions"><button type="button" class="mini-btn" data-fl="perf-open">📈 자문 수행 현황</button>' +
        '<button type="button" class="mini-btn" data-fl="unpick">선정 취소</button></div>';
    }
    h += '</div></div>';
    return h;
  }

  /* ─────────────────────────── 모달들 ─────────────────────────── */
  function caApprovalModal(rfp, repaint) {
    var deal = C.caDeal(rfp.id), ap = deal.approval || {};
    var body = '<p class="rfp-note">CA 서명본을 받기 전 <b>내부 결재</b> 기록입니다. 결재 완료 전에는 날인·발송 단계로 넘어갈 수 없습니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('requester', '결재 요청자', ap.requester || (C.me() && C.me().name) || '', 'text') +
      C.field('approver', '결재자', ap.approver || '', 'text') +
      C.field('requested_at', '요청일시', (ap.requested_at || '').slice(0, 16) || C.when(new Date().toISOString()), 'text') +
      C.field('decided_at', '결재일시', (ap.decided_at || '').slice(0, 16), 'text') +
      C.field('result', '결과', ap.result || '승인', 'select', { options: ['승인', '반려', '요청'] }) +
      C.field('memo', '의견', ap.memo || '', 'textarea', { wide: true, rows: 2 }) +
      '</div>';
    var m = C.modal('CA 내부 결재 기록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fl-save="approval">저장</button>'
    });
    m.querySelector('[data-fl-save="approval"]').addEventListener('click', function () {
      var result = C.fval(m, 'result');
      deal.approval = {
        requester: C.fval(m, 'requester'), approver: C.fval(m, 'approver'),
        requested_at: C.fval(m, 'requested_at'), decided_at: result === '요청' ? '' : (C.fval(m, 'decided_at') || new Date().toISOString()),
        result: result, memo: C.fval(m, 'memo')
      };
      deal.status = result === '승인' ? '결재 완료' : (result === '반려' ? '결재 요청' : '결재 요청');
      C.commit('ca_deal', deal);
      C.closeModal(); repaint();
      C.toast(result === '승인' ? 'CA 내부 결재 완료로 기록했습니다.' : '결재 상태를 기록했습니다.', result !== '승인');
    });
  }

  function caSealModal(rfp, repaint) {
    var deal = C.caDeal(rfp.id);
    var body = '<p class="rfp-note">날인된 CA 원본(스캔본)을 등록합니다. 딜별 CA 원본 보관함에 남고, 누가 언제 올렸는지 기록됩니다.</p>' +
      '<div class="rfp-uploadbox" data-fl-drop="sealed"><b>파일 선택</b><span>PDF·이미지·문서 (1건 900KB까지 보관)</span>' +
      '<button type="button" class="mini-btn" data-fl-pick="sealed">＋ 파일</button><ul class="rfp-attach-list" data-fl-files="sealed"><li class="empty">등록된 파일 없음</li></ul></div>' +
      C.field('seal_note', '메모', (deal.sealed && deal.sealed.note) || '', 'text', { wide: true });
    var m = C.modal('날인본 등록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fl-save="sealed">등록</button>'
    });
    var picked = [];
    function paintFiles() {
      var ul = m.querySelector('[data-fl-files="sealed"]');
      ul.innerHTML = picked.length ? picked.map(function (f) { return '<li><span>📎 ' + esc(f.name) + '</span><em>' + C.bytes(f.size) + '</em></li>'; }).join('') : '<li class="empty">등록된 파일 없음</li>';
    }
    m.querySelector('[data-fl-pick="sealed"]').addEventListener('click', function () {
      C.pickFiles(false).then(function (list) {
        if (!list || !list.length) return;
        C.readFile(list[0]).then(function (r) {
          picked = [{ name: r.name, size: r.size, mime: r.mime, dataUrl: r.dataUrl || '', text: r.text || '' }];
          paintFiles();
        }).catch(function () { C.toast('파일을 읽지 못했습니다.', true); });
      });
    });
    m.querySelector('[data-fl-save="sealed"]').addEventListener('click', function () {
      if (!picked.length) { C.toast('날인본 파일을 선택하세요.', true); return; }
      var prev = deal.sealed || {};
      deal.sealed = {
        name: picked[0].name, size: picked[0].size, mime: picked[0].mime, dataUrl: picked[0].dataUrl, text: picked[0].text,
        note: C.fval(m, 'seal_note'), version: (prev.version || 0) + 1,
        uploaded_by: (C.me() && C.me().name) || C.role(), uploaded_at: new Date().toISOString(),
        history: (prev.history || []).concat([{ name: prev.name, at: prev.uploaded_at, version: prev.version || 0 }]).filter(function (x) { return x.name; })
      };
      deal.status = '날인본 등록';
      C.commit('ca_deal', deal);
      C.closeModal(); repaint(); C.toast('날인본을 등록했습니다. 이제 자문사 발송을 기록할 수 있습니다.');
    });
    paintFiles();
  }

  function caSendModal(rfp, repaint) {
    var deal = C.caDeal(rfp.id);
    var ps = C.participantsOf(rfp.id).filter(function (p) { return p.party_type === '자문사'; });
    var body = '<p class="rfp-note">날인본을 자문사에 <b>발송한 사실</b>을 기록합니다. 실제 메일 자동 발송은 하지 않습니다(발송은 담당자가 직접, 기록만 남김).</p>' +
      '<div class="rfp-advpick">' + (ps.length ? ps.map(function (p) {
        return '<label class="rfp-advrow"><input type="checkbox" name="sendp" value="' + esc(p.id) + '"' +
          ((deal.sends || []).some(function (x) { return x.participant_id === p.id; }) ? ' checked' : '') + '>' +
          '<span><b>' + esc(p.company) + '</b><em>' + esc([p.name, p.email].filter(Boolean).join(' · ')) + '</em></span></label>';
      }).join('') : '<p class="rfp-hint">자문사 참여자가 없습니다.</p>') + '</div>' +
      '<div class="rfp-formgrid">' + C.field('method', '발송 방법', '메일', 'select', { options: ['메일', '직접 전달', '팩스', '기타'] }) +
      C.field('at', '발송일시', C.when(new Date().toISOString()), 'text') +
      C.field('note', '비고', '', 'text', { wide: true }) + '</div>';
    var m = C.modal('자문사 발송 기록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fl-save="send">기록</button>'
    });
    m.querySelector('[data-fl-save="send"]').addEventListener('click', function () {
      var ids = Array.prototype.slice.call(m.querySelectorAll('[name="sendp"]:checked')).map(function (el) { return el.value; });
      if (!ids.length) { C.toast('발송한 자문사를 선택하세요.', true); return; }
      var method = C.fval(m, 'method'), at = C.fval(m, 'at') || new Date().toISOString();
      deal.sends = (deal.sends || []).filter(function (x) { return ids.indexOf(x.participant_id) < 0; });
      ids.forEach(function (id) {
        var p = C.participantOf(rfp.id, id) || {};
        deal.sends.push({ participant_id: id, company: p.company || '', at: at, method: method, by: (C.me() && C.me().name) || C.role(), note: C.fval(m, 'note') });
      });
      deal.status = '발송 완료';
      C.commit('ca_deal', deal);
      C.closeModal(); repaint(); C.toast('발송 기록을 남겼습니다. 서명본이 오면 참여자별로 CA 접수를 등록하세요.');
    });
  }

  function caReceiptModal(rfp, participantId, repaint) {
    var p = C.participantOf(rfp.id, participantId);
    if (!p) return;
    var ex = C.caReceiptOf(rfp.id, p.id) || {};
    var body = '<p class="rfp-note"><b>' + esc(p.company) + '</b>(' + esc(p.party_type) + ')의 서명본을 등록하면 그 참여자만 이 딜의 자료(기본 세트)를 열람할 수 있게 됩니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('manager', '담당자', ex.manager || p.name || '', 'text') +
      C.field('signed_date', '서명일', ex.signed_date || C.today(), 'date') +
      C.field('deal_scope', '적용 딜', ex.deal_scope || rfp.title, 'text', { wide: true }) +
      C.field('status', '상태', ex.status || 'CA 접수', 'select', { options: ['CA 접수', 'CA 미제출', '반려'] }) +
      C.field('note', '비고', ex.note || '', 'text', { wide: true }) +
      '</div>' +
      '<div class="rfp-uploadbox"><b>서명본 파일</b><button type="button" class="mini-btn" data-fl-pick="cap">＋ 파일</button>' +
      '<ul class="rfp-attach-list" data-fl-files="cap"><li class="empty">' + ((ex.files || []).length ? ex.files.map(function (f) { return esc(f.name); }).join(', ') : '등록된 파일 없음') + '</li></ul></div>';
    var m = C.modal('CA 서명본 등록 — ' + p.company, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fl-save="cap">저장</button>'
    });
    var picked = (ex.files || []).slice();
    m.querySelector('[data-fl-pick="cap"]').addEventListener('click', function () {
      C.pickFiles(true).then(function (list) {
        if (!list || !list.length) return;
        Promise.all(list.map(function (f) {
          return C.readFile(f).then(function (r) { return { name: r.name, size: r.size, mime: r.mime, dataUrl: r.dataUrl || '', text: r.text || '' }; })
            .catch(function () { return { name: f.name, size: f.size, mime: f.type, note: '용량 초과 — 원본 미보관' }; });
        })).then(function (items) {
          picked = picked.concat(items);
          m.querySelector('[data-fl-files="cap"]').innerHTML = '<li>' + esc(picked.map(function (f) { return f.name; }).join(', ')) + '</li>';
        });
      });
    });
    m.querySelector('[data-fl-save="cap"]').addEventListener('click', function () {
      C.caReceiptCommit(rfp.id, p, {
        manager: C.fval(m, 'manager'), signed_date: C.fval(m, 'signed_date'),
        deal_scope: C.fval(m, 'deal_scope'), status: C.fval(m, 'status'), note: C.fval(m, 'note'), files: picked
      });
      C.closeModal(); repaint();
      C.toast(p.company + ' CA 상태를 「' + C.fval(m, 'status') + '」로 기록했습니다.');
    });
  }

  function partyAddModal(rfp, repaint) {
    var body = '<p class="rfp-note">투자자(매수후보)·금융기관 참여자를 이 딜에 등록합니다. 담당자별로 CA 제출·열람 권한이 따로 기록됩니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('party_type', '구분', '투자자', 'select', { options: ['투자자', '금융기관', '자문사'] }) +
      C.field('company', '회사', '', 'text', { req: true }) +
      C.field('name', '담당자', '', 'text') +
      C.field('title', '직함', '', 'text') +
      C.field('email', '이메일', '', 'email') +
      C.field('phone', '연락처', '', 'tel') +
      '</div>';
    var m = C.modal('참여자 추가', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fl-save="party">추가</button>'
    });
    m.querySelector('[data-fl-save="party"]').addEventListener('click', function () {
      var co = C.fval(m, 'company');
      if (!co) { C.toast('회사를 입력하세요.', true); return; }
      var p = C.ensureParticipant(rfp.id, C.fval(m, 'party_type') || '투자자', {
        company: co, name: C.fval(m, 'name'), title: C.fval(m, 'title'),
        email: C.fval(m, 'email'), phone: C.fval(m, 'phone')
      });
      C.closeModal(); repaint(); C.toast(p.company + ' 참여자를 추가했습니다.');
    });
  }

  function materialEditModal(rfp, repaint) {
    var all = C.docsOf(rfp.asset_id);
    var ids = C.materialIds(rfp);
    var body = '<p class="rfp-note">이 딜의 VDR에 올릴 자료를 고릅니다. 기본 세트(IM·티저 / 렌트롤 / OPEX)는 CA 접수 후 바로 열리고, 기타 자료는 요청 시 개방이 기본입니다.</p>' +
      (all.length ? '<div class="rfp-advpick">' + all.map(function (d) {
        var on = ids.indexOf(d.id) >= 0;
        return '<label class="rfp-advrow"><input type="checkbox" name="mat" value="' + esc(d.id) + '"' + (on ? ' checked' : '') + '>' +
          '<span><b>' + esc(d.name) + '</b><em>' + esc([d.label, C.bytes(d.size || 0), C.when(d.at).slice(0, 10)].filter(Boolean).join(' · ')) + '</em></span>' +
          '<select class="rfp-sel" name="acl_' + esc(d.id) + '">' + ['기본 개방', '요청 시 개방', '비공개'].map(function (a) {
            return '<option' + (C.materialAcl(d) === a ? ' selected' : '') + '>' + a + '</option>';
          }).join('') + '</select></label>';
      }).join('') + '</div>' : '<p class="rfp-hint">물건 자료가 없습니다. RFP 1단계에서 렌트롤·OPEX·IM을 먼저 올리세요.</p>');
    var m = C.modal('자료 세트 편집', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fl-save="mat">저장</button>'
    });
    m.querySelector('[data-fl-save="mat"]').addEventListener('click', function () {
      var picked = Array.prototype.slice.call(m.querySelectorAll('[name="mat"]:checked')).map(function (el) { return el.value; });
      rfp.material_ids = picked;
      rfp.materials_meta = {};
      picked.forEach(function (id) {
        var d = C.byId('docs', id);
        if (!d) return;
        var acl = (m.querySelector('[name="acl_' + id + '"]') || {}).value;
        if (acl && acl !== C.materialAcl(d)) { d.access = acl; C.commit('docs', d); }
      });
      C.commit('rfps', rfp);
      C.closeModal(); repaint(); C.toast('자료 세트를 저장했습니다.');
    });
  }

  function submissionModal(rfp, repaint) {
    var advs = C.list('advisors');
    if (!advs.length) advs = C.contacts().map(function (c) {
      return C.commit('advisors', { id: C.uid('adv'), company: c.company, name: c.name, email: c.email, phone: c.phone, at: new Date().toISOString() });
    });
    if (!advs.length) { C.toast('먼저 자문사를 등록하세요(배포 단계).', true); return; }
    var opts = advs.map(function (a) { return { v: a.id, l: a.company + (a.name ? ' (' + a.name + ')' : '') }; });
    var body = '<p class="rfp-note">자문사가 보낸 제안서를 대신 등록합니다(수령 시각·파일·버전 기록). 실제 접수는 자문사 포털 제출과 같습니다.</p>' +
      '<div class="rfp-formgrid">' + C.field('advisor_id', '자문사', '', 'select', { options: opts, req: true }) +
      C.field('fee_success', '성공보수(%)', '', 'number', { step: '0.01' }) +
      C.field('fee_fixed', '고정수수료(억)', '', 'number', { step: '0.01' }) +
      C.field('price_expect', '예상 매각가(억)', '', 'number', { step: '1' }) +
      C.field('period_months', '예상 기간(개월)', '', 'number', { step: '1' }) +
      C.field('track_record', '유사 실적', '', 'textarea', { wide: true, rows: 2 }) +
      C.field('access_reach', '투자자 접근력', '', 'textarea', { wide: true, rows: 2 }) +
      C.field('team', '인력 구성', '', 'text') +
      C.field('schedule', '일정', '', 'text') +
      C.field('extra', '추가 서비스', '', 'text', { wide: true }) + '</div>' +
      '<div class="rfp-uploadbox"><b>제안서 파일</b><button type="button" class="mini-btn" data-fl-pick="sub">＋ 파일</button>' +
      '<ul class="rfp-attach-list" data-fl-files="sub"><li class="empty">파일 없음</li></ul></div>';
    var m = C.modal('제출본 업로드(대리 접수)', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fl-save="sub">등록</button>'
    });
    var files = [];
    m.querySelector('[data-fl-pick="sub"]').addEventListener('click', function () {
      C.pickFiles(true).then(function (list) {
        if (!list || !list.length) return;
        Promise.all(list.map(function (f) {
          return C.readFile(f).then(function (r) { return { name: r.name, size: r.size, mime: r.mime, dataUrl: r.dataUrl || '', text: r.text || '' }; })
            .catch(function () { return { name: f.name, size: f.size, mime: f.type, note: '용량 초과 — 원본 미보관' }; });
        })).then(function (items) {
          files = files.concat(items);
          m.querySelector('[data-fl-files="sub"]').innerHTML = '<li>' + esc(files.map(function (f) { return f.name; }).join(', ')) + '</li>';
        });
      });
    });
    m.querySelector('[data-fl-save="sub"]').addEventListener('click', function () {
      var aid = C.fval(m, 'advisor_id');
      var price = num(C.fval(m, 'price_expect'));
      if (!aid) { C.toast('자문사를 선택하세요.', true); return; }
      var adv = C.byId('advisors', aid) || {};
      var exist = C.submissionOf(rfp.id, aid);
      C.commit('submissions', {
        id: exist ? exist.id : C.uid('sub'), rfp_id: rfp.id, advisor_id: aid, advisor_company: adv.company || '',
        version: exist ? (exist.version || 1) + 1 : 1, status: exist ? '수정 제출' : '제출',
        fee_success: C.fval(m, 'fee_success'), fee_fixed: C.fval(m, 'fee_fixed'), price_expect: price,
        period_months: C.fval(m, 'period_months'), track_record: C.fval(m, 'track_record'),
        access_reach: C.fval(m, 'access_reach'), team: C.fval(m, 'team'), schedule: C.fval(m, 'schedule'),
        extra: C.fval(m, 'extra'), files: files, received_by: (C.me() && C.me().name) || '',
        at: exist ? exist.at : new Date().toISOString(), revised_at: new Date().toISOString()
      });
      if (C.flowIndex(C.flowOf(rfp)) < C.flowIndex('접수')) C.setStatus(rfp, '접수', '제출본 대리 등록');
      C.closeModal(); repaint(); C.toast('제출본을 등록했습니다.');
    });
  }

  function noticeModal(rfp) {
    var invites = rfp.invites || [], subs = C.submissionsOf(rfp.id);
    var missing = invites.filter(function (inv) { return !subs.some(function (s) { return String(s.advisor_id) === String(inv.advisor_id); }); });
    var text = '[제안서 제출 안내] ' + rfp.title + '\n' +
      '대상: ' + (rfp.asset_name || '-') + '\n' +
      '제출 마감: ' + (rfp.due_date || '-') + (C.daysLeft(rfp.due_date) !== null ? ' (D-' + C.daysLeft(rfp.due_date) + ')' : '') + '\n\n' +
      (missing.length
        ? '아직 제안서가 접수되지 않았습니다. 마감 전까지 🤝 자문사 포털에서 승인 코드로 접속해 제출해 주세요.\n· ' +
          missing.map(function (m) { return m.company + ' (' + m.code + ')'; }).join('\n· ')
        : '모든 초청 자문사가 제안서를 제출했습니다.') +
      '\n\n문의: ' + (rfp.client || 'NAI Korea');
    var body = '<p class="rfp-note">미제출 자문사에게 보낼 안내 문안입니다. 복사해서 메일로 보내세요(자동 발송 없음).</p>' +
      '<div class="rfp-mailbox"><pre>' + esc(text) + '</pre><button type="button" class="mini-btn" data-fl-copy="1">문구 복사</button></div>';
    var m = C.modal('미제출 안내문 (' + missing.length + '명)', body, { wide: true, footer: '<button type="button" class="btn btn-primary" data-rfp="close">확인</button>' });
    m.addEventListener('click', function (e) {
      if (e.target.closest('[data-fl-copy]')) { try { navigator.clipboard.writeText(text); C.toast('복사했습니다.'); } catch (er) { C.toast('복사하지 못했습니다.', true); } }
    });
  }

  function reviewModal(rfp, repaint) {
    var sel = C.selectionOf(rfp.id) || {};
    var rv = sel.review || {};
    var body = '<p class="rfp-note">운용사 담당자에게 보고서를 보낸 뒤 받은 확인을 기록합니다. 승인/조건부 승인만 다음 단계(외부 보고 완료 → 선정)로 넘어갈 수 있습니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('client_name', '담당자 이름', rv.client_name || '', 'text') +
      C.field('client_title', '직함·소속', rv.client_title || '', 'text') +
      C.field('method', '확인 방법', rv.method || '메일', 'select', { options: ['메일', '전화', '대면', '서면'] }) +
      C.field('at', '확인 일시', rv.at ? C.when(rv.at) : C.when(new Date().toISOString()), 'text') +
      C.field('result', '결과', rv.result || '승인', 'select', { options: ['승인', '조건부 승인', '보류'] }) +
      C.field('memo', '의견·조건', rv.memo || '', 'textarea', { wide: true, rows: 3 }) + '</div>';
    var m = C.modal('운용사 담당자 확인 기록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fl-save="review">저장</button>'
    });
    m.querySelector('[data-fl-save="review"]').addEventListener('click', function () {
      var patch = {
        review: {
          client_name: C.fval(m, 'client_name'), client_title: C.fval(m, 'client_title'),
          method: C.fval(m, 'method'), at: C.fval(m, 'at') || new Date().toISOString(),
          result: C.fval(m, 'result'), memo: C.fval(m, 'memo'), by: (C.me() && C.me().name) || ''
        }
      };
      var rec = C.saveSelection(rfp.id, patch);
      if (C.flowIndex(C.flowOf(rfp)) < C.flowIndex('담당자 검토') && !C.flowGuard(rfp, '담당자 검토')) C.setStatus(rfp, '담당자 검토', '평가 검토 완료');
      if (C.fval(m, 'result') !== '보류') {
        if (C.flowIndex(C.flowOf(rfp)) < C.flowIndex('외부 보고')) C.setStatus(rfp, '외부 보고', '운용사 담당자 확인 기록');
      }
      C.closeModal(); repaint(); C.toast('담당자 확인을 기록했습니다.');
    });
  }

  function pickModal(rfp, advId, repaint) {
    var s = C.submissionsOf(rfp.id).filter(function (x) { return String(x.advisor_id) === String(advId); })[0];
    if (!s) return;
    var e = C.evaluationOf(rfp.id, advId) || {};
    var rows = C.rankedScores(rfp.id);
    var r = rows.filter(function (x) { return String(x.sub.advisor_id) === String(advId); })[0] || {};
    var body = '<p class="rfp-note"><b>' + esc(s.advisor_company) + '</b>을(를) 최종 자문사로 선정합니다. ' +
      '선정 사유를 남기고, 선정되면 그 딜은 <b>자문 수행</b> 트랙으로 넘어갑니다.</p>' +
      '<div class="rfp-kpis">' + kpi(r.total + '점', '총점') + kpi((r.rank || '-') + '위', '순위') +
      kpi((C.caOpenFor(rfp.id, (C.findParticipant(rfp.id, { ref_id: advId }) || {}).id) ? '접수' : '미제출'), 'CA') + '</div>' +
      C.field('basis', '선정 사유', e.summary || '', 'textarea', { wide: true, rows: 3 });
    var m = C.modal('자문사 선정 확정', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fl-save="pick">선정 확정</button>'
    });
    m.querySelector('[data-fl-save="pick"]').addEventListener('click', function () {
      C.pickAdvisor(rfp, advId, C.fval(m, 'basis'));
      var r2 = C.rfpOf(rfp.id);
      if (C.flowIndex(C.flowOf(r2)) < C.flowIndex('선정')) {
        if (!C.flowGuard(r2, '선정')) C.setStatus(r2, '선정', s.advisor_company + ' 선정');
        else { r2.status = '선정'; C.commit('rfps', r2); C.logHistory(r2.id, r2.status, '선정', s.advisor_company + ' 선정'); }
      }
      C.ensurePerf(r2);
      C.closeModal(); repaint(); C.toast(s.advisor_company + '을(를) 선정했습니다. 자문 수행 트랙으로 넘어갑니다.');
    });
  }

  function reportHTML(rfp) {
    var subs = C.submissionsOf(rfp.id);
    var rows = C.rankedScores(rfp.id);
    var rankBy = {}; rows.forEach(function (r) { rankBy[r.sub.advisor_id] = r; });
    var sel = C.selectionOf(rfp.id) || {};
    var loc = C.locOf(rfp.asset_id);
    var h = '<div class="rfp-doc"><div class="rfp-doc-head"><span class="rfp-doc-kicker">RFP EVALUATION REPORT · 외부 보고용</span>' +
      '<h1>' + esc(rfp.title) + ' — 제안 비교·평가 결과</h1>' +
      '<p>' + esc([rfp.client, rfp.asset_name, '기준일 ' + C.today()].filter(Boolean).join(' · ')) + '</p></div>' +
      '<p class="rfp-doc-note">이 보고서의 점수·의견 초안은 플랫폼이 제출 제안서를 평가항목과 대조해 만든 것이며, NAI 담당자 검토를 거쳐 확정된 내용입니다. ' +
      '출처: Open AI Asset Bridge · 제출 제안서(버전 표기) · 기준일 ' + esc(C.today()) + '.</p>' +
      '<table class="rfp-doc-meta"><tbody><tr><th>대상 물건</th><td>' + esc(rfp.asset_name) + '</td><th>소재지</th><td>' + esc(C.locLine(loc)) + '</td></tr>' +
      '<tr><th>제출 마감</th><td>' + esc(rfp.due_date || '-') + '</td><th>제출</th><td>' + subs.length + '건 / 초청 ' + (rfp.invites || []).length + '명</td></tr></tbody></table>';
    h += '<table class="rfp-doc-table"><thead><tr><th>자문사</th><th>제출</th><th>성공보수</th><th>매각가</th><th>기간</th><th>총점</th><th>순위</th></tr></thead><tbody>' +
      subs.map(function (s) {
        var r = rankBy[s.advisor_id] || {};
        return '<tr><td>' + esc(s.advisor_company) + '</td><td>v' + (s.version || 1) + '</td>' +
          '<td>' + (s.fee_success ? esc(s.fee_success) + '%' : '-') + '</td>' +
          '<td>' + (s.price_expect ? n0(s.price_expect, 0) + '억' : '-') + '</td>' +
          '<td>' + (s.period_months ? s.period_months + '개월' : '-') + '</td>' +
          '<td><b>' + (r.total || 0) + '</b></td><td>' + (r.rank || '-') + '위</td></tr>';
      }).join('') + '</tbody></table>';
    h += '<h3>항목별 점수·의견</h3><table class="rfp-doc-table"><thead><tr><th>자문사</th><th>항목</th><th>점수</th><th>근거</th><th>의견</th></tr></thead><tbody>';
    subs.forEach(function (s) {
      var e = C.evaluationOf(rfp.id, s.advisor_id) || { items: {} };
      (rfp.criteria || []).forEach(function (c) {
        var it = (e.items || {})[c.key] || {};
        h += '<tr><td>' + esc(s.advisor_company) + '</td><td>' + esc(c.label) + '</td><td>' + (it.score == null ? '-' : it.score) + '</td>' +
          '<td>' + esc(it.evidence || '') + '</td><td>' + esc(it.comment || '') + '</td></tr>';
      });
    });
    h += '</tbody></table>';
    h += '<h3>요청서류 충족</h3><table class="rfp-doc-table"><thead><tr><th>자문사</th><th>충족</th><th>미충족</th></tr></thead><tbody>' +
      subs.map(function (s) {
        var chk = C.checklistFor(rfp, s);
        var ok = chk.filter(function (c) { return c.ok; }).map(function (c) { return c.label; });
        var no = chk.filter(function (c) { return !c.ok; }).map(function (c) { return c.label; });
        return '<tr><td>' + esc(s.advisor_company) + '</td><td>' + esc(ok.join(', ') || '-') + '</td><td>' + esc(no.join(', ') || '-') + '</td></tr>';
      }).join('') + '</tbody></table>';
    h += '<h3>선정</h3><p><b>' + esc(sel.company || '미선정') + '</b>' + (sel.total ? ' · ' + sel.total + '점 · ' + (sel.rank || '') + '위' : '') +
      (sel.basis ? '<br>사유: ' + esc(sel.basis) : '') + '</p>' +
      '<p>' + (sel.review ? '운용사 담당자 확인: <b>' + esc(sel.review.result) + '</b> (' + esc([sel.review.client_name, sel.review.client_title, C.when(sel.review.at)].filter(Boolean).join(' · ')) + ')' : '운용사 담당자 확인 미기록') + '</p>' +
      '<p class="rfp-doc-foot">Open AI Asset Bridge · RFP 제출 폴더 · ' + esc(C.today()) + '</p></div>';
    return h;
  }

  function xlsxReport(rfp) {
    if (!window.XLSX) { C.toast('엑셀 라이브러리를 불러오지 못했습니다. 잠시 후 다시 시도하세요.', true); return; }
    var subs = C.submissionsOf(rfp.id);
    if (!subs.length) { C.toast('내보낼 제안이 없습니다.', true); return; }
    var rows = C.rankedScores(rfp.id);
    var rankBy = {}; rows.forEach(function (r) { rankBy[r.sub.advisor_id] = r; });
    var sel = C.selectionOf(rfp.id) || {};
    var loc = C.locOf(rfp.asset_id);
    var X = window.XLSX, wb = X.utils.book_new();
    function sheet(name, aoa, widths) {
      var ws = X.utils.aoa_to_sheet(aoa);
      if (widths) ws['!cols'] = widths.map(function (w) { return { wch: w }; });
      X.utils.book_append_sheet(wb, ws, name);
    }
    sheet('요약', [
      ['RFP 제안 비교·평가 리포트'],
      ['출처', 'Open AI Asset Bridge · 플랫폼 초안(자동 분석) + 담당자 검토'],
      ['기준일', C.today()],
      ['주의', '점수·의견은 플랫폼이 만든 초안을 담당자가 검토한 결과입니다. 확정 판단은 담당자·운용사 확인을 따릅니다.'],
      [],
      ['RFP', rfp.title], ['대상 물건', rfp.asset_name], ['소재지', C.locLine(loc)],
      ['좌표', loc.lat ? (loc.lat + ', ' + loc.lng + ' (' + (loc.precision || '') + ')') : '좌표 미확인'],
      ['의뢰인', rfp.client || ''], ['상태', C.flowOf(rfp)],
      ['발주일', rfp.issue_date || ''], ['제출 마감', rfp.due_date || ''],
      ['초청', (rfp.invites || []).length + '명'], ['제출', subs.length + '건'],
      ['선정', sel.company || '미선정'], ['선정 점수', sel.total || ''],
      ['운용사 담당자 확인', sel.review ? (sel.review.result + ' · ' + (sel.review.client_name || '') + ' · ' + (sel.review.at || '')) : '미기록']
    ], [22, 80]);
    var head = ['평가 항목', '가중치'].concat(subs.map(function (s) { return s.advisor_company; }));
    var body = (rfp.criteria || []).map(function (c) {
      return [c.label, num(c.weight)].concat(subs.map(function (s) {
        var e = C.evaluationOf(rfp.id, s.advisor_id) || {};
        var v = (e.items || {})[c.key] || {};
        return v.score == null ? '' : v.score;
      }));
    });
    body.push(['총점(가중 평균)', ''].concat(subs.map(function (s) { return rankBy[s.advisor_id] ? rankBy[s.advisor_id].total : 0; })));
    body.push(['순위', ''].concat(subs.map(function (s) { return rankBy[s.advisor_id] ? rankBy[s.advisor_id].rank : ''; })));
    sheet('평가표', [head].concat(body), [24, 8].concat(subs.map(function () { return 18; })));
    var ops = [['자문사', '평가 항목', '점수', '근거', '미흡·확인', '의견']];
    subs.forEach(function (s) {
      var e = C.evaluationOf(rfp.id, s.advisor_id) || { items: {} };
      (rfp.criteria || []).forEach(function (c) {
        var it = (e.items || {})[c.key] || {};
        ops.push([s.advisor_company, c.label, it.score == null ? '' : it.score, it.evidence || '', it.gap || '', it.comment || '']);
      });
      ops.push([s.advisor_company, '요약', '', e.summary || '', '', '']);
      (e.risks || []).forEach(function (r) { ops.push([s.advisor_company, '리스크', '', r.label, r.note || '', '']); });
    });
    sheet('항목별 의견', ops, [16, 18, 8, 46, 26, 40]);
    var st = [['자문사', 'CA', '제출시각', '버전', '파일', '요구서류 충족', '성공보수(%)', '고정(억)', '매각가(억)', '기간(개월)', '상태']];
    subs.forEach(function (s) {
      var p = C.findParticipant(rfp.id, { ref_id: s.advisor_id });
      var chk = C.checklistFor(rfp, s);
      st.push([s.advisor_company, (C.caOpenFor(rfp.id, p ? p.id : s.advisor_id) ? 'CA 접수' : 'CA 미제출'), C.when(s.at), 'v' + (s.version || 1),
        (s.files || []).map(function (f) { return f.name; }).join(', '),
        chk.filter(function (c) { return c.ok; }).length + '/' + chk.length,
        s.fee_success || '', s.fee_fixed || '', s.price_expect || '', s.period_months || '', s.status || '']);
    });
    sheet('제출 현황', st, [18, 12, 18, 8, 34, 12, 12, 10, 12, 10, 12]);
    var sels = [['선정 자문사', '총점', '순위', '결정일', '결정자', '선정 사유', '운용사 확인', '확인 의견']];
    sels.push([sel.company || '', sel.total || '', sel.rank || '', sel.decided_at || '', sel.decided_by || '', sel.basis || '',
      (sel.review && sel.review.result) || '', (sel.review && sel.review.memo) || '']);
    sheet('선정', sels, [18, 8, 6, 18, 12, 50, 12, 40]);
    X.writeFile(wb, 'RFP_평가리포트_' + C.safeName(rfp.asset_name || rfp.title) + '_' + C.today().replace(/-/g, '') + '.xlsx');
    C.logHistory(rfp.id, C.flowOf(rfp), C.flowOf(rfp), '엑셀 리포트 내려받기');
    C.toast('엑셀 리포트를 내려받았습니다.');
  }

  function reportText(rfp) {
    var sel = C.selectionOf(rfp.id) || {};
    var rows = C.rankedScores(rfp.id);
    return '[RFP 제안 평가 결과 보고] ' + rfp.title + '\n' +
      '대상: ' + (rfp.asset_name || '') + '\n' +
      '기준일: ' + C.today() + '\n\n' +
      '제출 ' + C.submissionsOf(rfp.id).length + '건 / 초청 ' + (rfp.invites || []).length + '명\n' +
      rows.map(function (r, i) { return (i + 1) + '. ' + r.sub.advisor_company + ' — ' + r.total + '점 (제안 v' + (r.sub.version || 1) + ')'; }).join('\n') +
      '\n\n선정(안): ' + (sel.company || '미정') + (sel.total ? ' (' + sel.total + '점)' : '') +
      '\n\n첨부: RFP_평가리포트 엑셀\n\n확인 부탁드립니다. 회신 주시면 선정 확정하겠습니다.\n' + (rfp.client || 'NAI Korea');
  }

  /* ─────────────────────────── 이벤트 ─────────────────────────── */
  function bind(host, rfpId, repaint) {
    if (!host) return;
    host.addEventListener('click', function (e) {
      var rfp = C.rfpOf(rfpId);
      if (!rfp) return;
      var b = e.target.closest('[data-fl]');
      if (!b) return;
      var act = b.getAttribute('data-fl');
      if (act === 'stage') {
        var guard = b.getAttribute('data-guard');
        if (guard) { C.toast(guard, true); return; }
        var to = b.getAttribute('data-to');
        C.setStatus(rfp, to, '단계 전환');
        repaint(); C.toast('단계를 「' + to + '」로 넘겼습니다.'); return;
      }
      if (act === 'stage-back') {
        var i = C.flowIndex(C.flowOf(rfp));
        if (i > 0) { C.setStatus(rfp, C.FLOW[i - 1], '이전 단계로 되돌림'); repaint(); }
        return;
      }
      if (act === 'rfp-print') { C.printDoc(rfp.title, C.rfpHTML(rfp, { invites: true })); return; }
      if (act === 'rfp-word') { C.exportWord(rfp.title, C.rfpHTML(rfp, { invites: true })); return; }
      if (act === 'history') { historyModal(rfp); return; }
      if (act === 'ca-template') {
        var mode = C.caTemplateDownload(rfp);
        var deal = C.caDeal(rfp.id);
        deal.downloads = (deal.downloads || []).concat([{ at: new Date().toISOString(), by: (C.me() && C.me().name) || C.role() }]);
        if (C.CA_STAGES.indexOf(deal.status) < 1) deal.status = '양식 다운로드';
        C.commit('ca_deal', deal);
        repaint(); C.toast(mode === 'link' ? 'CA 양식 파일을 열었습니다.' : 'CA 양식(임시)을 내려받았습니다. 표준 양식으로 교체 예정입니다.'); return;
      }
      if (act === 'ca-approval') { caApprovalModal(rfp, repaint); return; }
      if (act === 'ca-seal') { caSealModal(rfp, repaint); return; }
      if (act === 'ca-send') { caSendModal(rfp, repaint); return; }
      if (act === 'party-ca') { caReceiptModal(rfp, b.getAttribute('data-pid'), repaint); return; }
      if (act === 'party-add') { partyAddModal(rfp, repaint); return; }
      if (act === 'mat-edit') { materialEditModal(rfp, repaint); return; }
      if (act === 'sub-upload') { submissionModal(rfp, repaint); return; }
      if (act === 'notice') { noticeModal(rfp); return; }
      if (act === 'draft-eval') {
        var out = C.draftAllEvaluations(rfp);
        if (C.flowIndex(C.flowOf(rfp)) < C.flowIndex('분석')) C.setStatus(rfp, '분석', '평가 초안 생성');
        repaint(); C.toast(out.length + '건 평가 초안을 만들었습니다. 수정 후 검토 완료 처리하세요.');
        return;
      }
      if (act === 'eval-confirm') {
        var aid = b.getAttribute('data-aid');
        var ev = C.evaluationOf(rfp.id, aid);
        if (!ev) { C.toast('먼저 평가 초안을 만드세요.', true); return; }
        ev.status = ev.status === '검토 완료' ? '초안' : '검토 완료';
        ev.confirmed_by = ev.status === '검토 완료' ? ((C.me() && C.me().name) || C.role()) : '';
        ev.confirmed_at = ev.status === '검토 완료' ? new Date().toISOString() : '';
        C.commit('evaluations', ev); repaint(); C.toast('평가를 ' + ev.status + ' 처리했습니다.'); return;
      }
      if (act === 'xlsx') { xlsxReport(rfp); return; }
      if (act === 'print-eval') { C.printDoc('제안 비교·평가', reportHTML(rfp)); return; }
      if (act === 'report') {
        var m = C.modal('외부 보고용 — 제안 비교·평가', '<div class="rfp-paper">' + reportHTML(rfp) + '</div>', {
          wide: true,
          footer: '<button type="button" class="btn btn-ghost" data-rfp="close">닫기</button>' +
            '<button type="button" class="btn btn-ghost" data-fl="xlsx">📥 엑셀</button>' +
            '<button type="button" class="btn btn-primary" data-fl="report-print">🖨 인쇄/PDF</button>'
        });
        m.addEventListener('click', function (e2) {
          if (e2.target.closest('[data-fl="report-print"]')) { C.printDoc('제안 비교·평가', reportHTML(rfp)); return; }
          if (e2.target.closest('[data-fl="xlsx"]')) { xlsxReport(rfp); }
        });
        return;
      }
      if (act === 'report-text') {
        var txt = reportText(rfp);
        var mm = C.modal('검토 요청 문안', '<div class="rfp-mailbox"><pre>' + esc(txt) + '</pre>' +
          '<button type="button" class="mini-btn" data-fl-copy="1">문구 복사</button></div>', { wide: true, footer: '<button type="button" class="btn btn-primary" data-rfp="close">확인</button>' });
        mm.addEventListener('click', function (e2) {
          if (e2.target.closest('[data-fl-copy]')) { try { navigator.clipboard.writeText(txt); C.toast('복사했습니다.'); } catch (er) { C.toast('복사하지 못했습니다.', true); } }
        });
        return;
      }
      if (act === 'review') { reviewModal(rfp, repaint); return; }
      if (act === 'pick') { pickModal(rfp, b.getAttribute('data-aid'), repaint); return; }
      if (act === 'unpick') {
        if (!window.confirm('선정을 취소할까요? (평가·제출은 남습니다)')) return;
        var sel = C.selectionOf(rfp.id);
        rfp.selected_advisor_id = '';
        if (C.flowIndex(C.flowOf(rfp)) > C.flowIndex('외부 보고')) C.setStatus(rfp, '외부 보고', '선정 취소');
        if (sel) { sel.advisor_id = ''; sel.company = ''; sel.status = '후보'; C.commit('selection', sel); }
        C.commit('rfps', rfp); repaint(); C.toast('선정을 취소했습니다.'); return;
      }
      if (act === 'perf-open') {
        if (window.NAI_DEALS && window.NAI_DEALS.openPerf) window.NAI_DEALS.openPerf(rfp.id);
        else C.toast('수행 현황 화면을 불러오지 못했습니다.', true);
        return;
      }
      if (act === 'perf-next') {
        var pf = C.ensurePerf(rfp);
        var i2 = C.PERF_STAGES.indexOf(pf.stage);
        if (i2 < C.PERF_STAGES.length - 1) { C.setPerfStage(rfp, C.PERF_STAGES[i2 + 1]); repaint(); C.toast('수행 단계를 「' + C.PERF_STAGES[i2 + 1] + '」로 넘겼습니다.'); }
        return;
      }
      if (act === 'loc-map') {
        if (window.naiMap && window.naiMap.select && window.naiShowView) { window.naiShowView('map'); window.naiMap.select(rfp.asset_id, { pan: true }); }
        else C.toast('물건 지도에서 이 물건을 찾을 수 없습니다.', true);
        return;
      }
      if (act === 'loc-copy') {
        var loc = C.locOf(rfp.asset_id);
        try { navigator.clipboard.writeText(loc.address || ''); C.toast('주소를 복사했습니다.'); } catch (er) { C.toast('복사하지 못했습니다.', true); }
        return;
      }
      if (act === 'loc-verify') {
        var mm2 = C.modal('위치 확인 완료 기록', '<p class="rfp-note">' + esc(C.locOf(rfp.asset_id).address || '주소 미확인') + '</p>' +
          C.field('memo', '확인 메모', (C.locOf(rfp.asset_id).verify || {}).memo || '', 'text', { wide: true, ph: '예) 현장 답사로 지번 일치 확인' }), {
          wide: true,
          footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
            '<button type="button" class="btn btn-primary" data-fl-save="loc">확인 완료</button>'
        });
        mm2.querySelector('[data-fl-save="loc"]').addEventListener('click', function () {
          C.setLocVerify(rfp.asset_id, C.fval(mm2, 'memo'), true);
          C.closeModal(); repaint(); C.toast('위치 확인 완료로 기록했습니다.');
        });
        return;
      }
    });
    host.addEventListener('change', function (e) {
      var rfp = C.rfpOf(rfpId);
      var t = e.target;
      if (!rfp || !t.getAttribute) return;
      if (t.getAttribute('data-fl-score')) {
        var p = t.getAttribute('data-fl-score').split('|');
        var ev = C.evaluationOf(rfp.id, p[0]);
        if (!ev) return;
        ev.items = ev.items || {};
        ev.items[p[1]] = ev.items[p[1]] || {};
        ev.items[p[1]].score = num(t.value);
        ev.total = C.totalScore(rfp, Object.keys(ev.items).reduce(function (o, k) { o[k] = ev.items[k].score; return o; }, {}));
        C.commit('evaluations', ev);
        var rows = C.rankedScores(rfp.id), rank = {};
        rows.forEach(function (r, i) { rank[r.sub.advisor_id] = r; });
        C.submissionsOf(rfp.id).forEach(function (s) {
          var el = host.querySelector('[data-fl-total="' + s.advisor_id + '"]');
          var rk = host.querySelector('[data-fl-rank="' + s.advisor_id + '"]');
          if (el && rank[s.advisor_id]) el.textContent = String(rank[s.advisor_id].total);
          if (rk && rank[s.advisor_id]) rk.textContent = rank[s.advisor_id].rank + '위';
        });
        return;
      }
      if (t.getAttribute('data-fl-comment')) {
        var q = t.getAttribute('data-fl-comment').split('|');
        var ev2 = C.evaluationOf(rfp.id, q[0]);
        if (!ev2) return;
        ev2.items = ev2.items || {};
        ev2.items[q[1]] = ev2.items[q[1]] || {};
        ev2.items[q[1]].comment = t.value;
        C.commit('evaluations', ev2);
        return;
      }
      if (t.getAttribute('data-fl-sum')) {
        var ev3 = C.evaluationOf(rfp.id, t.getAttribute('data-fl-sum'));
        if (!ev3) return;
        ev3.summary = t.value; ev3.summary_confirmed = true;
        C.commit('evaluations', ev3);
        return;
      }
    });
  }

  function historyModal(rfp) {
    var hs = C.historyOf(rfp.id);
    var body = !hs.length ? '<p class="rfp-hint">이력이 없습니다.</p>' :
      '<div class="rfp-table-wrap"><table class="rfp-table small"><thead><tr><th>일시</th><th>단계</th><th>기록</th><th>비고</th></tr></thead><tbody>' +
      hs.map(function (x) {
        return '<tr><td>' + esc(C.when(x.at)) + '</td><td>' + esc((x.from || '') + (x.to && x.to !== x.from ? ' → ' + x.to : '')) + '</td>' +
          '<td>' + esc(x.by || '') + ' · ' + esc(x.role || '') + '</td><td>' + esc(x.note || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    C.modal('단계·처리 이력 — ' + rfp.title, body, { wide: true, footer: '<button type="button" class="btn btn-primary" data-rfp="close">확인</button>' });
  }

  window.NAI_RFPFLOW = { html: html, bind: bind, reportHTML: reportHTML, xlsxReport: xlsxReport };
})();
