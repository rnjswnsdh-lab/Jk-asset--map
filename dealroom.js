/* =========================================================================
   Open AI Asset Bridge — dealroom.js  (🏢 딜 룸 · VDR 참여자/운영자 화면 · 2026-11-28)
   -------------------------------------------------------------------------
   딜 1건 = RFP + VDR(딜 룸) + 제출 폴더.
   같은 딜·자료·CA 데이터를 두 모드로 보여줍니다.

     ① 참여자 모드 — 자문사·투자자·금융기관이 승인 코드로 들어와 보는 화면
        물건 위치·개요 / IM·티저·렌트롤·OPEX(CA 게이트) / 기타 자료(요청 시 개방)
        / RFP 원문 / 내 제출물(CA·LOI·LOC·자금계획·산출물) / 일정·문의·담당자
     ② 운영자 모드 — NAI·자산운용사 담당자
        위 전부 + 자료 등급·업로드, 참여자 CA 대장, 열람 요청 승인,
        LOI/LOC/자금계획 접수, 롱 → 굿 → 숏리스트 평가, 이력 전체

   자료 열람 판정은 rfpcore.js materialAccess() 한 곳에서만 하고,
   이 파일은 그 결과를 그리기만 합니다(중복 로직 금지).
   ========================================================================= */
(function () {
  'use strict';

  var C = window.NAI_RFPC;
  if (!C) return;
  var esc = C.esc, n0 = C.n0, num = C.num;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function badge(t, c) { return '<span class="rfp-tag ' + (c || '') + '">' + esc(t) + '</span>'; }
  function kpi(v, l) { return '<span class="rfp-kpi"><b>' + esc(v) + '</b><em>' + esc(l) + '</em></span>'; }

  function rfpOf(room) {
    if (!room) return null;
    if (room.rfp_id) return C.rfpOf(room.rfp_id);
    return null;
  }
  function modeOf(opts) {
    var ss = C.session();
    if (opts && opts.mode) return opts.mode;
    return (ss && ss.holder_type) ? 'party' : 'staff';
  }
  function partyOf(opts) {
    var ss = C.session();
    if (!ss) return null;
    return C.partyOfSession(ss);
  }

  /* ─────────────────────────── 본문 ─────────────────────────── */
  function render(room, opts) {
    opts = opts || {};
    var mode = modeOf(opts);
    var ss = C.session();
    var rfp = rfpOf(room);
    var party = mode === 'party' ? (opts.party || partyOf(opts)) : null;
    if (!rfp) {
      return '<div class="dr-empty"><b>이 딜 룸에 연결된 RFP가 없습니다.</b>' +
        (mode === 'staff' ? '<p>📑 RFP의 제출 폴더에서 <b>🏢 딜 룸 연결</b>을 하면 RFP 정보가 이 룸에 표시됩니다.</p>' : '') + '</div>';
    }
    var loc = C.locOf(rfp.asset_id);
    var s = C.dealStats(rfp);
    var h = '';

    h += '<div class="dr-head"><div class="dr-head-main">' +
      '<span class="dr-kicker">' + (mode === 'party' ? '참여자 모드 · 딜 룸' : '운영자 모드 · 딜 룸') + '</span>' +
      '<h2>' + esc(rfp.title) + '</h2>' +
      '<p>' + esc([rfp.asset_name, rfp.region, rfp.client, '단계 ' + C.flowOf(rfp)].filter(Boolean).join(' · ')) + '</p>' +
      '<p class="dr-sub">' + (mode === 'party' ? '로그인: ' + esc([ss && ss.holder, ss && ss.holder_type].filter(Boolean).join(' · ')) : '담당 ' + esc(rfp.owner || '미지정')) + '</p>' +
      '</div><div class="dr-head-act">' +
      '<button type="button" class="mini-btn" data-dr="rfp-print">🖨 RFP 원문</button>' +
      (mode === 'staff' ? '<button type="button" class="mini-btn" data-dr="folder">📁 제출 폴더</button>' +
        '<button type="button" class="mini-btn" data-dr="perf">📈 자문 수행</button>' : '') +
      '</div></div>';

    /* 위치 */
    h += '<section class="dr-card"><div class="dr-card-head"><b>📍 물건 위치</b>' +
      (loc.verified ? badge('위치 확인 완료', 'ok') : badge('확인 기록 없음', 'wait')) + '</div>' +
      '<div class="dr-loc"><div><b>' + esc(loc.address || '주소 미확인') + '</b>' +
      '<span>' + esc([loc.region, loc.precision].filter(Boolean).join(' · ') || '좌표·정밀도 정보 없음') + '</span>' +
      '<em>' + (loc.lat ? '좌표 ' + loc.lat.toFixed(6) + ', ' + loc.lng.toFixed(6) : '좌표 미확인 — 주소로만 확인 가능') + '</em></div>' +
      '<div class="dr-loc-act">' +
      (loc.map_url ? '<a class="mini-btn" href="' + esc(loc.map_url) + '" target="_blank" rel="noopener">🗺 카카오맵</a>' : '') +
      (loc.road_url ? '<a class="mini-btn" href="' + esc(loc.road_url) + '" target="_blank" rel="noopener">🛣 로드뷰</a>' : '') +
      (loc.lat ? '<button type="button" class="mini-btn" data-dr="loc-map">📍 앱 지도</button>' : '') +
      '<button type="button" class="mini-btn" data-dr="loc-copy">📋 주소 복사</button>' +
      (mode === 'staff' ? '<button type="button" class="mini-btn" data-dr="loc-verify">✔ 위치 확인 기록</button>' : '') +
      '</div></div></section>';

    /* 자료 */
    h += materialsSection(rfp, mode, party, opts);

    /* RFP 원문 */
    h += '<section class="dr-card"><div class="dr-card-head"><b>📑 RFP 원문</b>' +
      '<span class="dr-tools"><button type="button" class="mini-btn" data-dr="rfp-open">펼치기</button></span></div>' +
      '<div class="dr-rfp" data-dr-rfp hidden>' + C.rfpHTML(rfp, { invites: mode === 'staff' }) + '</div></section>';

    /* 제출물 */
    h += mode === 'party' ? mySubmissions(rfp, party, opts) : partiesSection(rfp, opts);

    /* 금융 연결 요약 — 상세는 💰 마켓 탭(자문사 포털과 분리) */
    h += financeCard(rfp, mode);
    /* 일정 */
    h += scheduleSection(rfp, s);

    /* 문의·접촉 */
    h += contactSection(rfp, mode, party, opts);
    return h;
  }

  /* ── 자료 목록 ── */
  function materialsSection(rfp, mode, party, opts) {
    var groups = C.materialGroups(rfp, mode === 'party' ? party : null);
    var h = '<section class="dr-card"><div class="dr-card-head"><b>📂 자료실 (VDR)</b>' +
      '<span>' + (mode === 'party'
        ? (C.caOpenFor(rfp.id, party) ? badge('CA 접수 — 기본 자료 열람 가능', 'ok') : badge('CA 미제출 — 목록만 표시', 'wait'))
        : '자료 등급·업로드 관리') + '</span></div>';
    if (mode === 'party' && !C.caOpenFor(rfp.id, party)) {
      h += '<div class="dr-lockbanner"><b>CA 서명본을 제출해야 자료를 열람·다운로드할 수 있습니다.</b>' +
        '<span>양식을 내려받아 회사 내부 결재·날인 후 서명본을 업로드하세요.</span>' +
        '<span class="dr-tools"><button type="button" class="mini-btn" data-dr="tpl" data-kind="CA">⬇ CA 양식 다운로드</button>' +
        '<button type="button" class="mini-btn primary" data-dr="ca-upload">⬆ CA 서명본 제출</button></span></div>';
    }
    groups.forEach(function (g) {
      h += '<div class="dr-matgroup"><div class="dr-matg-head"><b>' + g.icon + ' ' + esc(g.label) + '</b>' +
        '<span>' + (g.items.length ? g.items.length + '건' : (g.asset_im ? '자산 링크 보유' : '미보유')) + '</span>' +
        (mode === 'staff' ? '<span class="dr-tools"><button type="button" class="mini-btn" data-dr="mat-upload" data-kind="' + g.kind + '">＋ 자료</button></span>' : '') + '</div>';
      if (!g.items.length && g.asset_im) {
        h += '<div class="dr-matif link"><b>' + esc(g.asset_im.label || 'IM 보유(자산 링크)') + '</b><em>물건 DB 연결 · 열람 권한은 동일하게 CA 게이트 적용</em>' +
          (g.asset_im.url && (C.caOpenFor(rfp.id, party) || mode === 'staff') ? '<a class="mini-btn" href="' + esc(g.asset_im.url) + '" target="_blank" rel="noopener">열기</a>' : '') + '</div>';
      }
      if (!g.items.length && !g.asset_im) h += '<p class="dr-hint">' + (g.kind === 'im' ? 'IM·티저 미보유 — 자산에 IM 링크가 없고 업로드도 없습니다.' : '등록된 자료가 없습니다.') + '</p>';
      g.items.forEach(function (it) {
        var lock = !it.can_view;
        h += '<div class="dr-matif' + (lock ? ' locked' : '') + '">' +
          '<b>' + (lock ? '🔒 ' : '') + esc(it.name) + '</b>' +
          '<em>v' + it.version + (it.latest ? ' · 최신' : '') + ' · 배포 ' + esc(C.when(it.at).slice(0, 10)) +
          ' · ' + esc(it.access) + (it.uploaded_by ? ' · ' + esc(it.uploaded_by) : '') +
          (it.viewers ? ' · 열람 ' + it.viewers + '회' : '') + '</em>' +
          (it.tags && it.tags.length ? '<span class="dr-tags">' + it.tags.map(function (t) { return badge(t, 'tag'); }).join('') + '</span>' : '') +
          '<span class="dr-tools">' +
          (it.can_view ? (it.download ? '<button type="button" class="mini-btn" data-dr="mat-dl" data-id="' + esc(it.doc_id) + '">⬇ 다운로드</button>' : badge('다운로드 차단', 'wait')) : '<span class="dr-reason">' + esc(it.reason) + '</span>') +
          (it.can_request ? '<button type="button" class="mini-btn" data-dr="mat-req" data-id="' + esc(it.doc_id) + '" data-name="' + esc(it.name) + '">열람 요청</button>' : '') +
          (mode === 'staff' ? '<button type="button" class="mini-btn" data-dr="mat-acl" data-id="' + esc(it.doc_id) + '">등급</button>' : '') +
          '</span></div>';
      });
      h += '</div>';
    });
    if (mode === 'staff') {
      h += '<div class="dr-tools dr-matfoot"><button type="button" class="mini-btn" data-dr="mat-upload" data-kind="etc">＋ 기타 자료 업로드</button>' +
        '<span class="dr-hint">기타 자료는 기본이 「요청 시 개방」입니다. 참여자 요청 → 담당자 승인 시 그 참여자에게만 열립니다.</span></div>';
    }
    return h + '</section>';
  }

  /* ── 참여자: 내 제출물 ── */
  function mySubmissions(rfp, party, opts) {
    var st = C.submitState(rfp, party || { id: '' });
    var ca = C.caReceiptOf(rfp.id, party);
    var perf = C.perfOf(rfp.id);
    var caOk = C.caOpenFor(rfp.id, party);
    var isFin = !!(party && party.party_type === '금융기관');
    var isSelected = rfp.selected_advisor_id && party && String(party.ref_id) === String(rfp.selected_advisor_id);
    var h = '<section class="dr-card"><div class="dr-card-head"><b>📝 내 제출물</b>' +
      '<span>' + (party ? esc(party.company) + ' · ' + esc(party.party_type) : '') + '</span></div>';

    /* 진행 순서 — CA → LOI → (금융기관) LOC → 제출 완료 */
    var caDone = !!(ca && ca.status === 'CA 접수');
    var steps = [
      { n: '1', label: 'CA 접수', done: caDone },
      { n: '2', label: isFin ? 'LOI (해당 시)' : 'LOI', done: !!st.kinds['LOI'] },
      { n: '3', label: 'LOC', done: !!st.kinds['LOC'] },
      { n: '4', label: '제출 완료', done: caDone && !!(st.kinds['LOI'] || st.kinds['LOC']) }
    ];
    h += '<div class="dr-steps">' + steps.map(function (x, i) {
      return (i ? '<span class="dr-farrow">›</span>' : '') +
        '<span class="dr-step' + (x.done ? ' done' : '') + '"><i>' + x.n + '</i>' + esc(x.label) + '</span>';
    }).join('') + '</div>';

    /* 무슨 일을 할 수 있는지 — 실제 동작과 같은 말로 */
    h += '<p class="dr-subguide">CA 접수 후 자료 열람과 제출이 가능합니다. ' +
      'LOI(매수의향서)만 제출하거나, LOI와 LOC(자금확보 확인서)를 함께 제출할 수 있습니다. ' +
      (isFin ? '금융기관은 LOC만 제출합니다.' : '금융기관은 LOC만 제출할 수 있습니다.') + '</p>';

    h += '<div class="dr-subgrid">';
    /* CA */
    h += '<div class="dr-sub"><b>CA (비밀유지계약)</b>' +
      '<span>' + (caDone ? badge('CA 접수 · v' + (ca.version || 1), 'ok') : badge((ca && ca.status) || 'CA 미제출', 'wait')) + '</span>' +
      '<em>' + (ca && ca.signed_date ? '서명일 ' + esc(ca.signed_date) + ' · 담당 ' + esc(ca.manager || '') : '서명본을 제출하면 이 딜의 IM·렌트롤·OPEX가 열립니다.') + '</em>' +
      '<span class="dr-tools"><button type="button" class="mini-btn" data-dr="tpl" data-kind="CA">⬇ CA 양식</button>' +
      '<button type="button" class="mini-btn" data-dr="ca-upload">⬆ CA 서명본 제출</button></span></div>';
    /* LOI/LOC/자금계획 */
    var HINTS = {
      'LOI': '가격·조건·실사기간을 적어 제출합니다.',
      'LOC': '금융기관 인증이 완료된 기관만 「수용」으로 넘어갑니다.',
      '자금조달 계획서': '자금원천과 사용처(Source & Use)를 적어 제출합니다.'
    };
    C.SUBMIT_KINDS.forEach(function (k) {
      var rec = st.kinds[k.k];
      var req = (rfp.require || []).indexOf(k.k) >= 0;
      h += '<div class="dr-sub"><b>' + k.icon + ' ' + esc(k.label) + (req ? ' <em class="dr-req">필수</em>' : '') + '</b>' +
        '<span>' + (rec ? badge('제출 v' + (rec.version || 1) + ' · ' + (rec.status || '접수'), 'ok') : badge('미제출', 'wait')) + '</span>' +
        (rec ? '<em>' + esc(C.when(rec.at)) + (rec.amount_eok ? ' · ' + n0(rec.amount_eok) + '억' : '') + '</em>' : '<em>' + esc(HINTS[k.k] || k.hint) + '</em>') +
        (rec ? '<em class="dr-sub2">' + esc(HINTS[k.k] || '') + '</em>' : '') +
        '<span class="dr-tools"><button type="button" class="mini-btn" data-dr="tpl" data-kind="' + esc(k.k) + '">⬇ 양식</button>' +
        '<button type="button" class="mini-btn" data-dr="submit" data-kind="' + esc(k.k) + '"' + (caOk ? '' : ' disabled title="CA 접수 후 제출할 수 있습니다"') + '>' +
        esc(k.k) + ' 제출</button></span></div>';
    });
    /* 산출물(선정 자문사) */
    if (isSelected && perf) {
      var dls = perf.deliverables || [];
      h += '<div class="dr-sub wide"><b>📦 수행 산출물</b><span>' + badge(dls.length + '건', 'ok') + '</span>' +
        '<em>단계 ' + esc(perf.stage) + ' · 마감 ' + esc(((perf.milestones || []).filter(function (m) { return !m.done_at; })[0] || {}).due || '-') + '</em>' +
        '<span class="dr-tools"><button type="button" class="mini-btn" data-dr="deliver">⬆ 산출물 제출</button></span></div>';
    }
    h += '</div>';

    /* 묶음 제출 동선 : LOI만 / LOI+LOC / LOC만 */
    var bd = caOk ? '' : ' disabled title="CA 접수 후 제출할 수 있습니다"';
    h += '<div class="dr-submitbar"><b>제출하기</b>' +
      (isFin ? '' : '<button type="button" class="btn btn-primary" data-dr="submit" data-kind="LOI"' + bd + '>LOI 제출</button>' +
        '<button type="button" class="btn btn-primary" data-dr="submit" data-kind="LOI+LOC"' + bd + '>LOI 및 LOC 함께 제출</button>') +
      '<button type="button" class="btn ' + (isFin ? 'btn-primary' : 'btn-ghost') + '" data-dr="submit" data-kind="LOC"' + bd + '>LOC 제출</button>' +
      '<span class="dr-hint">' + (isFin ? 'LOC는 기관 인증(인증완료) 상태에서 「수용」으로 넘어갑니다.' : 'LOI+LOC를 고르면 한 화면에서 두 서류를 받아 같은 제출 회차로 묶습니다.') + '</span></div>';

    if (st.requiredMissing.length) h += '<p class="dr-warn">필수 제출물 미충족: ' + esc(st.requiredMissing.join(', ')) + ' — 보완 요청 상태입니다.</p>';
    h += '<p class="dr-hint">제출물은 버전으로 남습니다. 다른 자문사·투자자의 제출물과 평가표는 보이지 않습니다.</p>';
    return h + '</section>';
  }

  /* ── 운영자: 참여자·제출물·리스트 ── */
  function partiesSection(rfp, opts) {
    var ps = C.participantsOf(rfp.id);
    var h = '<section class="dr-card"><div class="dr-card-head"><b>👥 참여자 · 제출물</b>' +
      '<span class="dr-tools"><button type="button" class="mini-btn" data-dr="party-add">＋ 참여자</button>' +
      '<button type="button" class="mini-btn" data-dr="require">필수 제출물</button></span></div>';
    if (!ps.length) return h + '<p class="dr-hint">참여자가 없습니다. RFP 배포 또는 참여자 추가로 등록하세요.</p>';
    h += '<div class="dr-tablewrap"><table class="rfp-table small"><thead><tr><th>구분</th><th>회사·담당</th><th>CA</th>' +
      C.SUBMIT_KINDS.map(function (k) { return '<th>' + esc(k.k) + '</th>'; }).join('') +
      '<th title="제출물 조합(LOI, LOI+LOC, LOC 등)">조합</th><th>열람</th><th>단계</th><th></th></tr></thead><tbody>';
    ps.forEach(function (p) {
      var ca = C.caReceiptOf(rfp.id, p.id);
      var st = C.submitState(rfp, p);
      var row = C.listRowOf(rfp.id, p.id);
      var acc = C.accessLogOf(rfp.id).filter(function (a) { return String(a.holder) === String(p.company); }).length;
      h += '<tr><td>' + badge(p.party_type, p.party_type === '자문사' ? 'adv' : (p.party_type === '금융기관' ? 'fi' : 'inv')) + '</td>' +
        '<td><b>' + esc(p.company) + '</b><span class="rfp-sub">' + esc([p.name, p.title, p.email].filter(Boolean).join(' · ')) + '</span></td>' +
        '<td>' + (ca && ca.status === 'CA 접수' ? badge('접수', 'ok') : badge((ca && ca.status) || '미제출', 'wait')) +
        (ca ? ' <button type="button" class="mini-btn" data-dr="ca-reg" data-pid="' + esc(p.id) + '">기록</button>' : ' <button type="button" class="mini-btn" data-dr="ca-reg" data-pid="' + esc(p.id) + '">CA 등록</button>') + '</td>' +
        C.SUBMIT_KINDS.map(function (k) { return '<td>' + (st.kinds[k.k] ? '<span class="dr-yes">✔</span> v' + (st.kinds[k.k].version || 1) : '<span class="dr-no">—</span>') + '</td>'; }).join('') +
        '<td>' + esc(st.combo) + '</td><td class="num">' + acc + '</td>' +
        '<td>' + (row && row.stage ? badge(row.stage + (row.status === '보류' ? '·보류' : (row.status === '제외' ? '·제외' : '')), row.status === '제외' ? 'over' : (row.status === '보류' ? 'soon' : 'ok')) : '<span class="rfp-muted">롱리스트 전</span>') + '</td>' +
        '<td class="dr-rowact"><button type="button" class="mini-btn" data-dr="submit" data-pid="' + esc(p.id) + '" data-kind="LOI">LOI</button>' +
        '<button type="button" class="mini-btn" data-dr="submit" data-pid="' + esc(p.id) + '" data-kind="LOC">LOC</button>' +
        '<button type="button" class="mini-btn" data-dr="submit" data-pid="' + esc(p.id) + '" data-kind="자금조달 계획서">S&amp;U</button></td></tr>';
    });
    h += '</tbody></table></div>';
    h += listBoard(rfp);
    h += reviewQueue(rfp);
    return h + '</section>';
  }

  /* 롱 → 굿 → 숏리스트 */
  function listBoard(rfp) {
    var rows = C.listOverview(rfp);
    var crit = C.listCriteria(rfp);
    var h = '<div class="dr-listhead"><b>📊 롱리스트 → 굿리스트 → 숏리스트</b>' +
      '<span class="dr-tools"><button type="button" class="mini-btn" data-dr="long-auto">롱리스트 자동 생성</button>' +
      '<button type="button" class="mini-btn" data-dr="crit">평가 항목·가중치</button></span></div>';
    h += '<p class="dr-hint">제출물을 낸 투자자를 롱리스트로 모으고, <b>플랫폼 초안 점수 + 담당자 판단</b>으로 굿리스트 → 숏리스트로 추립니다. ' +
      '평가 항목 가중치: ' + crit.map(function (c) { return esc(c.label) + ' ' + n0(c.weight, 0); }).join(' · ') + '</p>';
    if (!rows.length) return h + '<p class="dr-hint">투자자·금융기관 참여자가 없습니다. 참여자를 추가하면 롱리스트를 만들 수 있습니다.</p>';
    h += '<div class="dr-tablewrap"><table class="rfp-table tiny"><thead><tr><th>투자자</th><th>제출물</th><th>금액(억)</th><th>조건 요약</th><th>기한</th><th>자금증빙</th>' +
      '<th>초안점수</th><th>단계</th><th>판정</th><th>근거</th><th>이동</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var st = r.submit, p = r.p;
      var rec = st.kinds['LOI'] || st.kinds['LOC'] || {};
      var sny = st.kinds['자금조달 계획서'];
      var loc = st.kinds['LOC'];
      var verified = lenderVerified(loc && loc.company || p.company);
      h += '<tr><td><b>' + esc(p.company) + '</b><span class="rfp-sub">' + esc([p.name, p.party_type].filter(Boolean).join(' · ')) + '</span></td>' +
        '<td class="dr-submits">' + C.SUBMIT_KINDS.map(function (k) {
          var x = st.kinds[k.k];
          return '<span class="' + (x ? 'dr-yes' : 'dr-no') + '" title="' + esc(k.k) + '">' + (x ? '✔' : '—') + '</span>';
        }).join('') + '<em>' + esc(st.combo) + '</em></td>' +
        '<td class="num">' + (rec.amount_eok ? n0(rec.amount_eok) : '-') + '</td>' +
        '<td class="dr-terms">' + esc(String(rec.terms || '').slice(0, 60) || '-') + (loc && !verified ? ' <span class="dr-reason">기관 인증 필요</span>' : '') + '</td>' +
        '<td>' + esc(rec.due || rfp.loi_due || '-') + '</td>' +
        '<td>' + (sny ? badge('있음', 'ok') : badge('없음', 'wait')) + '</td>' +
        '<td class="num"><b>' + r.draft.total + '</b></td>' +
        '<td>' + (r.stage ? badge(r.stage, 'flow') : '<span class="rfp-muted">-</span>') + '</td>' +
        '<td>' + (r.row ? badge(r.row.status || '', r.row.status === '제외' ? 'over' : (r.row.status === '보류' ? 'soon' : 'ok')) : '-') + '</td>' +
        '<td class="rfp-sub">' + esc((r.row && (r.row.reason_code ? r.row.reason_code + ' ' : '') + (r.row.memo || '')) || '') + '</td>' +
        '<td class="dr-rowact">' +
        '<button type="button" class="mini-btn" data-dr="move" data-pid="' + esc(p.id) + '" data-to="롱리스트">롱</button>' +
        '<button type="button" class="mini-btn" data-dr="move" data-pid="' + esc(p.id) + '" data-to="굿리스트">굿</button>' +
        '<button type="button" class="mini-btn" data-dr="move" data-pid="' + esc(p.id) + '" data-to="숏리스트">숏</button>' +
        '<button type="button" class="mini-btn" data-dr="move" data-pid="' + esc(p.id) + '" data-to="제외">제외</button></td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="dr-hint">제출 유형·금액·조건·기한·자금확보 증빙을 함께 비교합니다. LOC는 🏦 기관 인증(인증완료)만 「수용」으로 넘길 수 있습니다.</p>';
    return h;
  }

  function lenderVerified(name) {
    var a = C.list('lenders');
    for (var i = 0; i < a.length; i++) if (String(a[i].name) === String(name)) return a[i].status === '인증';
    return false;
  }

  function reviewQueue(rfp) {
    var pend = C.pendingRequests(rfp.id);
    return '<div class="dr-review"><b>📥 열람 요청·접촉 ({' + pend.length + '}건 대기)</b>' +
      (pend.length ? '<div class="dr-tablewrap"><table class="rfp-table tiny"><thead><tr><th>일시</th><th>참여자</th><th>요청</th><th>대상</th><th>메모</th><th></th></tr></thead><tbody>' +
        pend.map(function (r) {
          return '<tr><td>' + esc(C.when(r.at)) + '</td><td>' + esc(r.company || '') + '</td><td>' + esc(r.kind) + '</td>' +
            '<td>' + esc(r.doc_label || r.topic || '') + '</td><td>' + esc(r.message || '') + '</td>' +
            '<td class="dr-rowact"><button type="button" class="mini-btn" data-dr="req" data-id="' + esc(r.id) + '" data-res="승인">승인</button>' +
            '<button type="button" class="mini-btn" data-dr="req" data-id="' + esc(r.id) + '" data-res="반려">반려</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="dr-hint">대기 중인 요청이 없습니다.</p>') + '</div>';
  }

  function financeCard(rfp, mode) {
    var off = C.list('fin_offers').filter(function (o) { return o.rfp_id === rfp.id; });
    var req = C.list('fin_requests').filter(function (o) { return o.rfp_id === rfp.id; });
    var h = '<section class="dr-card"><div class="dr-card-head"><b>💰 금융 연결 (대출·금융)</b>' +
      '<span>' + (mode === 'party' ? '요약만 표시' : '등록·매칭은 💰 마켓 탭') + '</span></div>' +
      '<div class="rfp-kpis"><span class="rfp-kpi"><b>' + off.length + '</b><em>대주 조건 제시</em></span>' +
      '<span class="rfp-kpi"><b>' + req.length + '</b><em>자금조달 요청</em></span></div>';
    h += '<p class="dr-hint">' + (off.length ? '최근: ' + esc(off.slice(0, 2).map(function (o) { return o.lender_name + ' ' + (o.amount_eok ? n0(o.amount_eok) + '억' : '') + ' ' + (o.rate || ''); }).join(' / ')) : '등록된 대출 조건이 없습니다.') + '</p>';
    h += '<div class="dr-tools"><button type="button" class="mini-btn" data-dr="fin">💰 금융 연결 열기</button>' +
      '<span class="dr-hint">중개 수수료: 수수료 협의 · 실체 진위확인은 운영자 전용</span></div></section>';
    return h;
  }

  /* ── 일정 ── */
  function scheduleSection(rfp, s) {
    var perf = s.perf;
    var h = '<section class="dr-card"><div class="dr-card-head"><b>🗓 일정</b>' +
      (s.dleft !== null ? '<span>' + (s.dleft < 0 ? '제안 마감 지남' : '제안 마감 D-' + s.dleft) + '</span>' : '') + '</div>';
    h += '<div class="dr-sched"><span><b>RFP 발주</b><em>' + esc(rfp.issue_date || '-') + '</em></span>' +
      '<span><b>제안 마감</b><em>' + esc(rfp.due_date || '-') + '</em></span>' +
      '<span><b>LOI·LOC 마감</b><em>' + esc(rfp.loi_due || '-') + '</em></span>' +
      (perf ? '<span><b>자문 수행</b><em>' + esc(perf.stage) + '</em></span>' : '') + '</div>';
    if (perf && (perf.milestones || []).length) {
      h += '<div class="dr-miles">' + perf.milestones.map(function (m) {
        return '<span class="dr-mile' + (m.done_at ? ' done' : '') + '"><b>' + esc(m.name) + '</b><em>' + esc(m.due || '') + (m.done_at ? ' ✓' : '') + '</em></span>';
      }).join('') + '</div>';
    }
    return h + '</section>';
  }

  /* ── 문의·접촉 ── */
  function contactSection(rfp, mode, party, opts) {
    var reqs = C.requestsOf(rfp.id);
    var h = '<section class="dr-card"><div class="dr-card-head"><b>💬 문의 · 접촉 기록</b>' +
      '<span class="dr-tools">' + (mode === 'staff' ? '<button type="button" class="mini-btn" data-dr="req-memo">응대 메모</button>' : '') +
      '<button type="button" class="mini-btn" data-dr="contact">＋ 문의·접촉 요청</button></span></div>';
    if (!reqs.length) return h + '<p class="dr-hint">기록이 없습니다.</p>';
    var mine = reqs.filter(function (r) {
      if (mode === 'staff') return true;
      return party && String(r.company) === String(party.company);
    });
    if (!mine.length) return h + '<p class="dr-hint">내 문의 기록이 없습니다.</p>';
    h += '<div class="dr-tablewrap"><table class="rfp-table tiny"><thead><tr><th>일시</th><th>구분</th><th>참여자</th><th>내용</th><th>상태</th><th>응대</th></tr></thead><tbody>' +
      mine.slice(0, 12).map(function (r) {
        return '<tr><td>' + esc(C.when(r.at)) + '</td><td>' + esc(r.kind) + '</td><td>' + esc(r.company || '') + '</td>' +
          '<td>' + esc([r.doc_label || r.topic, r.message].filter(Boolean).join(' — ')) + '</td>' +
          '<td>' + badge(r.status, r.status === '승인' ? 'ok' : (r.status === '반려' ? 'over' : (r.status === '완료' ? 'flow' : 'wait'))) + '</td>' +
          '<td class="rfp-sub">' + esc((r.memo || '') + (r.decided_at ? ' · ' + C.when(r.decided_at) : '')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (mode === 'staff') {
      var acc = C.accessLogOf(rfp.id);
      h += '<details class="rfp-det"><summary>열람·다운로드 이력 (' + acc.length + '건)</summary>' +
        (acc.length ? '<div class="dr-tablewrap"><table class="rfp-table tiny"><thead><tr><th>일시</th><th>참여자</th><th>구분</th><th>자료</th><th>행위</th></tr></thead><tbody>' +
          acc.slice(0, 60).map(function (a) {
            return '<tr><td>' + esc(C.when(a.at)) + '</td><td>' + esc(a.holder || '') + '</td><td>' + esc(a.holder_type || '') + '</td>' +
              '<td>' + esc(a.doc_label || '') + '</td><td>' + esc(a.action || '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="dr-hint">이력 없음</p>') + '</details>';
    }
    return h + '</section>';
  }

  /* ─────────────────────────── 모달 ─────────────────────────── */
  function uploadModal(rfp, opts) {
    var kind = opts.kind;
    var party = opts.party || null;
    if (opts.participantId) party = C.participantOf(rfp.id, opts.participantId);
    var kdef = C.SUBMIT_KINDS.filter(function (k) { return k.k === kind; })[0] || C.SUBMIT_KINDS[0];
    var exist = party ? C.submitOf(rfp.id, party.id, kind) : null;
    var body = '<p class="rfp-note">' + esc(kdef.label) + ' — 수기 양식으로 내려받아 작성·서명한 뒤 업로드합니다. ' +
      (kind === 'LOC' ? '<b>금융기관 실체 인증(인증완료) 기관만 「수용」으로 넘어갑니다.</b>' : '') + '</p>' +
      (party ? '' : '<p class="rfp-hint">대리 접수: 참여자를 선택하세요.</p>') +
      '<div class="rfp-formgrid">' +
      C.field('amount_eok', '금액(억원, LOI가/확인금액)', exist ? exist.amount_eok : '', 'number', { step: '1' }) +
      C.field('ltv', 'LTV·금리', exist ? exist.ltv : '', 'text') +
      C.field('due', '제출 기한·실사 기간', exist ? exist.due : '', 'text') +
      C.field('terms', '조건 요약', exist ? exist.terms : '', 'textarea', { wide: true, rows: 3, ph: '가격·결제조건·선행조건·실사계획 등' }) +
      C.field('note', '비고', exist ? exist.note : '', 'text', { wide: true }) + '</div>' +
      '<div class="dr-uploader"><b>파일 (서명본·증빙)</b><button type="button" class="mini-btn" data-dr-pick="1">＋ 파일</button>' +
      '<ul class="rfp-attach-list" data-dr-files><li class="empty">' + (exist && exist.files && exist.files.length ? esc(exist.files.map(function (f) { return f.name; }).join(', ')) : '파일 없음') + '</li></ul></div>';
    var m = C.modal(kind + ' 제출 — ' + rfp.asset_name, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-dr-save="1">' + (exist ? '수정 제출' : '제출') + '</button>'
    });
    var files = (exist && exist.files) || [];
    m.querySelector('[data-dr-pick]').addEventListener('click', function () {
      C.pickFiles(true).then(function (list) {
        if (!list || !list.length) return;
        Promise.all(list.map(function (f) {
          return C.readFile(f).then(function (r) { return { name: r.name, size: r.size, mime: r.mime, dataUrl: r.dataUrl || '', text: r.text || '' }; })
            .catch(function () { return { name: f.name, size: f.size, mime: f.type, note: '용량 초과 — 원본 미보관' }; });
        })).then(function (items) {
          files = files.concat(items);
          m.querySelector('[data-dr-files]').innerHTML = '<li>' + esc(files.map(function (f) { return f.name; }).join(', ')) + '</li>';
        });
      });
    });
    m.querySelector('[data-dr-save]').addEventListener('click', function () {
      var p = party || C.participantOf(rfp.id, C.fval(m, 'participant_id'));
      if (!p) { C.toast('참여자를 찾을 수 없습니다.', true); return; }
      C.commit('submits', {
        id: exist ? exist.id : C.uid('sub'), rfp_id: rfp.id, participant_id: p.id, company: p.company,
        party_type: p.party_type, kind: kind, version: exist ? (exist.version || 1) + 1 : 1,
        amount_eok: C.fval(m, 'amount_eok'), ltv: C.fval(m, 'ltv'), due: C.fval(m, 'due'),
        terms: C.fval(m, 'terms'), note: C.fval(m, 'note'), files: files,
        status: '접수', at: exist ? exist.at : new Date().toISOString(),
        revised_at: new Date().toISOString(), by: (C.me() && C.me().name) || (C.session() ? C.session().holder : '')
      });
      var row = C.listRowOf(rfp.id, p.id);
      if (!row) C.listMove(rfp.id, p.id, '롱리스트', { memo: '제출물 접수로 자동 편입' });
      C.closeModal(); if (opts.repaint) opts.repaint(); C.toast(kind + '를 접수했습니다.');
    });
  }

  /* LOI + LOC 묶음 제출 — 한 화면에서 두 서류를 받아 같은 회차(batch)·시각으로 접수 (2026-11-28) */
  function submitBundleModal(rfp, opts) {
    var kinds = (opts.kinds || ['LOI', 'LOC']).filter(function (k) { return k === 'LOI' || k === 'LOC'; });
    if (!kinds.length) kinds = ['LOI'];
    var party = opts.party || null;
    if (opts.participantId) party = C.participantOf(rfp.id, opts.participantId) || party;
    if (!party) { C.toast('참여자 정보를 찾을 수 없습니다.', true); return; }
    if (!C.caOpenFor(rfp.id, party)) { C.toast('CA 접수 후 제출할 수 있습니다.', true); return; }
    var wantLOI = kinds.indexOf('LOI') >= 0;
    var wantLOC = kinds.indexOf('LOC') >= 0;
    var loi = C.submitOf(rfp.id, party.id, 'LOI');
    var loc = C.submitOf(rfp.id, party.id, 'LOC');
    var guide = wantLOI && wantLOC
      ? 'LOI 서식(가격·조건·실사기간)과 LOC 서식(금융기관·한도·금리·만기)을 한 화면에서 받아, 같은 제출 회차로 묶어 접수합니다.'
      : (wantLOI ? 'LOI(매수의향서)만 제출합니다. 가격·조건·실사기간을 적어 주세요.' : 'LOC(자금확보 확인서)만 제출합니다. 금융기관·한도·금리·만기를 적어 주세요.');
    var body = '<p class="rfp-note">' + esc(guide) + '</p>' +
      '<div class="rfp-formgrid">' +
      (wantLOI
        ? C.field('loi_amount', 'LOI 금액(억원)', loi ? loi.amount_eok : '', 'number', { step: '1' }) +
          C.field('loi_due', '실사 기간', loi ? loi.due : '', 'text', { ph: '예) 30일' }) +
          C.field('loi_terms', 'LOI 조건', loi ? loi.terms : '', 'textarea', { wide: true, rows: 2, ph: '결제조건·선행조건·인수 범위' })
        : '') +
      (wantLOC
        ? C.field('loc_lender', '금융기관', loc ? loc.lender_name : (party.party_type === '금융기관' ? party.company : ''), 'text') +
          C.field('loc_amount', '한도(억원)', loc ? loc.amount_eok : '', 'number', { step: '1' }) +
          C.field('loc_rate', '금리', loc ? loc.rate : '', 'text', { ph: '예) 4.8% (3년 고정)' }) +
          C.field('loc_tenor', '만기', loc ? loc.tenor : '', 'text', { ph: '예) 3년 + 1년 연장' }) +
          C.field('loc_terms', 'LOC 조건', loc ? loc.terms : '', 'textarea', { wide: true, rows: 2, ph: '트랑슈·선행요건·인출 조건' })
        : '') +
      C.field('note', '비고', '', 'text', { wide: true }) + '</div>' +
      '<div class="dr-uploader"><b>파일 (서명본·증빙)</b><button type="button" class="mini-btn" data-dr-pick="1">＋ 파일</button>' +
      '<ul class="rfp-attach-list" data-dr-files><li class="empty">파일 없음</li></ul>' +
      '<span class="dr-hint">한 제출 건의 파일은 ' + esc(kinds.join('·')) + ' 레코드에 함께 붙습니다.</span></div>';
    var m = C.modal((wantLOI && wantLOC ? 'LOI 및 LOC 함께 제출' : (wantLOI ? 'LOI 제출' : 'LOC 제출')) + ' — ' + rfp.asset_name, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-dr-save="bundle">' + (wantLOI && wantLOC ? 'LOI 및 LOC 함께 제출' : (wantLOI ? 'LOI 제출' : 'LOC 제출')) + '</button>'
    });
    var files = [];
    m.querySelector('[data-dr-pick]').addEventListener('click', function () {
      C.pickFiles(true).then(function (list) {
        if (!list || !list.length) return;
        Promise.all(list.map(function (f) {
          return C.readFile(f).then(function (r) { return { name: r.name, size: r.size, mime: r.mime, dataUrl: r.dataUrl || '', text: r.text || '' }; })
            .catch(function () { return { name: f.name, size: f.size, mime: f.type, note: '용량 초과 — 원본 미보관' }; });
        })).then(function (items) {
          files = files.concat(items);
          m.querySelector('[data-dr-files]').innerHTML = '<li>' + esc(files.map(function (f) { return f.name; }).join(', ')) + '</li>';
        });
      });
    });
    m.querySelector('[data-dr-save="bundle"]').addEventListener('click', function () {
      var at = new Date().toISOString();
      var batch = C.uid('bat');
      kinds.forEach(function (kind) {
        var exist = C.submitOf(rfp.id, party.id, kind);
        var rec = {
          id: exist ? exist.id : C.uid('sub'), rfp_id: rfp.id, participant_id: party.id,
          company: party.company, party_type: party.party_type, kind: kind,
          version: exist ? (exist.version || 1) + 1 : 1,
          batch: batch, batch_kinds: kinds.join('+'),
          amount_eok: kind === 'LOI' ? C.fval(m, 'loi_amount') : C.fval(m, 'loc_amount'),
          due: C.fval(m, 'loi_due'),
          terms: kind === 'LOI' ? C.fval(m, 'loi_terms') : C.fval(m, 'loc_terms'),
          lender_name: C.fval(m, 'loc_lender'), rate: C.fval(m, 'loc_rate'), tenor: C.fval(m, 'loc_tenor'),
          note: C.fval(m, 'note'), files: files, status: '접수',
          at: exist ? exist.at : at, revised_at: at,
          by: (C.me() && C.me().name) || (C.session() ? C.session().holder : '')
        };
        C.commit('submits', rec);
      });
      var row = C.listRowOf(rfp.id, party.id);
      if (!row) C.listMove(rfp.id, party.id, '롱리스트', { memo: 'LOI/LOC 제출로 자동 편입' });
      C.closeModal(); if (opts.repaint) opts.repaint();
      C.toast((wantLOI && wantLOC ? 'LOI 및 LOC를 한 회차로 접수했습니다.' : (wantLOI ? 'LOI를 접수했습니다.' : 'LOC를 접수했습니다.')));
    });
  }

  function caUploadModal(rfp, opts) {
    var party = opts.party || null;
    var exist = party ? C.caReceiptOf(rfp.id, party) : null;
    var body = '<p class="rfp-note">CA 양식을 내려받아 <b>회사 내부 결재 → 날인</b>한 뒤 서명본을 업로드합니다. 접수되면 이 딜의 기본 자료(IM·티저/렌트롤/OPEX)가 열립니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('manager', '담당자', (exist && exist.manager) || (party && party.name) || '', 'text') +
      C.field('signed_date', '서명일', (exist && exist.signed_date) || C.today(), 'date') +
      C.field('deal_scope', '적용 딜', (exist && exist.deal_scope) || rfp.title, 'text', { wide: true }) +
      C.field('note', '비고', (exist && exist.note) || '', 'text', { wide: true }) + '</div>' +
      '<div class="dr-uploader"><b>서명본 파일</b><button type="button" class="mini-btn" data-dr-pick="1">＋ 파일</button>' +
      '<ul class="rfp-attach-list" data-dr-files><li class="empty">' + (exist && exist.files && exist.files.length ? esc(exist.files.map(function (f) { return f.name; }).join(', ')) : '파일 없음') + '</li></ul></div>' +
      '<p class="rfp-hint">전자서명·외부 서명 연동은 이번 범위에 없습니다(추후 시스템 연동 검토 — Phase 2).</p>';
    var m = C.modal('CA 서명본 제출', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-ghost" data-dr-tpl="1">⬇ CA 양식</button>' +
        '<button type="button" class="btn btn-primary" data-dr-save="1">서명본 제출</button>'
    });
    var files = (exist && exist.files) || [];
    m.querySelector('[data-dr-tpl]').addEventListener('click', function () { C.templateDoc('CA', rfp, party); });
    m.querySelector('[data-dr-pick]').addEventListener('click', function () {
      C.pickFiles(true).then(function (list) {
        if (!list || !list.length) return;
        Promise.all(list.map(function (f) {
          return C.readFile(f).then(function (r) { return { name: r.name, size: r.size, mime: r.mime, dataUrl: r.dataUrl || '', text: r.text || '' }; })
            .catch(function () { return { name: f.name, size: f.size, mime: f.type, note: '용량 초과 — 원본 미보관' }; });
        })).then(function (items) {
          files = files.concat(items);
          m.querySelector('[data-dr-files]').innerHTML = '<li>' + esc(files.map(function (f) { return f.name; }).join(', ')) + '</li>';
        });
      });
    });
    m.querySelector('[data-dr-save]').addEventListener('click', function () {
      if (!party) { C.toast('참여자 정보를 찾을 수 없습니다.', true); return; }
      if (!files.length) { C.toast('서명본 파일을 선택하세요.', true); return; }
      C.caReceiptCommit(rfp.id, party, {
        manager: C.fval(m, 'manager'), signed_date: C.fval(m, 'signed_date'),
        deal_scope: C.fval(m, 'deal_scope'), note: C.fval(m, 'note'), status: 'CA 접수', files: files
      });
      C.closeModal(); if (opts.repaint) opts.repaint(); C.toast('CA 접수 — 이제 자료를 열람할 수 있습니다.');
    });
  }

  function moveModal(rfp, participantId, to, opts) {
    var p = C.participantOf(rfp.id, participantId);
    if (!p) return;
    var row = C.listRowOf(rfp.id, participantId);
    var codes = ['요건 미충족', '가격 미달', '자금확보 불충분', '조건 부적합', '실사 의사 없음', '중복·이해충돌', '담당자 판단', '기타'];
    var body = '<p class="rfp-note"><b>' + esc(p.company) + '</b>을(를) <b>' + esc(to) + '</b>' +
      (to === '제외' ? '으로 이동(제외)' : '로 이동') + '합니다. 판정·근거가 이력으로 남습니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('status', '판정', to === '제외' ? '제외' : (to === '굿리스트' ? '통과' : '통과'), 'select', { options: ['통과', '보류', '제외'] }) +
      C.field('reason_code', '사유 코드', (row && row.reason_code) || (to === '제외' ? '요건 미충족' : '담당자 판단'), 'select', { options: codes }) +
      C.field('memo', '근거·의견', (row && row.memo) || '', 'textarea', { wide: true, rows: 3, ph: '예) LOI 3,100억(가이드 +3%), 자금확보 확약서 제출, 실사 30일' }) + '</div>';
    var m = C.modal('리스트 이동 — ' + p.company, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-dr-save="1">이동</button>'
    });
    m.querySelector('[data-dr-save]').addEventListener('click', function () {
      C.listMove(rfp.id, participantId, to, { status: C.fval(m, 'status'), reason_code: C.fval(m, 'reason_code'), memo: C.fval(m, 'memo') });
      C.closeModal(); if (opts.repaint) opts.repaint(); C.toast(p.company + ' → ' + to);
    });
  }

  function criteriaModal(rfp, opts) {
    var crit = C.listCriteria(rfp);
    var body = '<p class="rfp-note">투자자 리스트 평가 항목·가중치입니다(합 100 권장). 플랫폼 초안 점수는 이 가중치로 계산되며, 확정은 담당자 판단입니다.</p>' +
      '<table class="rfp-table small" id="drCrit"><thead><tr><th>항목</th><th class="num">가중치</th></tr></thead><tbody>' +
      crit.map(function (c) {
        return '<tr><td><input class="rfp-in" data-cl value="' + esc(c.label) + '"></td><td class="num"><input class="rfp-in num" type="number" min="0" max="100" data-cw value="' + n0(c.weight, 0) + '"></td></tr>';
      }).join('') + '</tbody></table>';
    var m = C.modal('리스트 평가 항목', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-dr-save="1">저장</button>'
    });
    m.querySelector('[data-dr-save]').addEventListener('click', function () {
      var out = [];
      Array.prototype.slice.call(m.querySelectorAll('#drCrit tbody tr')).forEach(function (tr) {
        var l = (tr.querySelector('[data-cl]') || {}).value || '';
        var w = num((tr.querySelector('[data-cw]') || {}).value);
        if (l.trim()) out.push({ key: (C.LIST_CRITERIA.filter(function (x) { return x.label === l; })[0] || {}).key || ('c' + out.length), label: l.trim(), weight: w });
      });
      rfp.list_criteria = out; C.commit('rfps', rfp);
      C.closeModal(); if (opts.repaint) opts.repaint(); C.toast('평가 항목을 저장했습니다.');
    });
  }

  function requireModal(rfp, opts) {
    var body = '<p class="rfp-note">이 딜에서 <b>필수</b>로 받을 제출물을 지정합니다. 필수인데 없으면 보완요청 상태로 표시됩니다.</p>' +
      C.SUBMIT_KINDS.map(function (k) {
        return '<label class="dr-check"><input type="checkbox" name="rq" value="' + esc(k.k) + '"' + ((rfp.require || []).indexOf(k.k) >= 0 ? ' checked' : '') + '> ' + esc(k.label) + '</label>';
      }).join('');
    var m = C.modal('필수 제출물 지정', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-dr-save="1">저장</button>'
    });
    m.querySelector('[data-dr-save]').addEventListener('click', function () {
      rfp.require = Array.prototype.slice.call(m.querySelectorAll('[name="rq"]:checked')).map(function (el) { return el.value; });
      C.commit('rfps', rfp);
      C.closeModal(); if (opts.repaint) opts.repaint(); C.toast('필수 제출물을 저장했습니다.');
    });
  }

  function matAclModal(rfp, docId, opts) {
    var d = C.byId('docs', docId);
    if (!d) return;
    var body = '<p class="rfp-note"><b>' + esc(d.name) + '</b> — 공개 등급과 다운로드 허용을 정합니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('acl', '공개 등급', C.materialAcl(d), 'select', { options: ['기본 개방', '요청 시 개방', '비공개'] }) +
      C.field('download', '다운로드', d.download === false ? '차단' : '허용', 'select', { options: ['허용', '차단'] }) +
      C.field('tags', '태그 (쉼표)', (d.tags || []).join(', '), 'text', { wide: true, ph: '감정평가서, 도면, 인허가, 계약·등기, 실사' }) + '</div>';
    var m = C.modal('자료 등급', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-dr-save="1">저장</button>'
    });
    m.querySelector('[data-dr-save]').addEventListener('click', function () {
      d.access = C.fval(m, 'acl');
      d.download = C.fval(m, 'download') !== '차단';
      d.tags = C.fval(m, 'tags').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      C.commit('docs', d);
      C.closeModal(); if (opts.repaint) opts.repaint(); C.toast('자료 등급을 저장했습니다.');
    });
  }

  /* ─────────────────────────── 이벤트 ─────────────────────────── */
  function bind(host, room, repaint) {
    if (!host) return;
    var rfp = rfpOf(room);
    var mode = modeOf({});
    var ss = C.session();
    var party = mode === 'party' ? partyOf({}) : null;
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-dr]');
      if (!b) return;
      var act = b.getAttribute('data-dr');
      rfp = rfpOf(room);
      if (!rfp) return;
      if (act === 'rfp-print' || act === 'rfp-open') { C.printDoc(rfp.title, C.rfpHTML(rfp, { invites: mode === 'staff' })); return; }
      if (act === 'folder') { if (window.NAI_RFP_OPEN) window.NAI_RFP_OPEN(rfp.asset_id, 'folder', rfp.id); return; }
      if (act === 'perf') { if (window.NAI_DEALS && window.NAI_DEALS.openPerf) window.NAI_DEALS.openPerf(rfp.id); return; }
      if (act === 'loc-map') { if (window.naiMap && window.naiMap.select && window.naiShowView) { window.naiShowView('map'); window.naiMap.select(rfp.asset_id, { pan: true }); } return; }
      if (act === 'loc-copy') { try { navigator.clipboard.writeText(C.locOf(rfp.asset_id).address || ''); C.toast('주소를 복사했습니다.'); } catch (er) { C.toast('복사하지 못했습니다.', true); } return; }
      if (act === 'loc-verify') {
        C.setLocVerify(rfp.asset_id, '딜 룸에서 확인', true); repaint(); C.toast('위치 확인 완료로 기록했습니다.'); return;
      }
      if (act === 'tpl') { C.templateDoc(b.getAttribute('data-kind') || 'LOI', rfp, party); return; }
      if (act === 'ca-upload') { caUploadModal(rfp, { party: party, repaint: repaint }); return; }
      if (act === 'ca-reg') { caRegModal(rfp, b.getAttribute('data-pid'), repaint); return; }
      if (act === 'submit') {
        var pid = b.getAttribute('data-pid');
        var kk = b.getAttribute('data-kind') || 'LOI';
        if (kk.indexOf('+') >= 0) {
          submitBundleModal(rfp, { kinds: kk.split('+'), participantId: pid || (party && party.id), party: party, repaint: repaint });
          return;
        }
        uploadModal(rfp, { kind: kk, participantId: pid || (party && party.id), party: party, repaint: repaint });
        return;
      }
      if (act === 'deliver') { deliverModal(rfp, party, repaint); return; }
      if (act === 'mat-dl') {
        var d = C.byId('docs', b.getAttribute('data-id'));
        if (!d) return;
        var chk = C.materialAccess(rfp, d, mode === 'party' ? party : null);
        if (!chk.ok) { C.toast('열람 권한이 없습니다 — ' + chk.reason, true); return; }
        if (d.download === false) { C.toast('다운로드가 차단된 자료입니다. 화면 열람만 가능합니다.', true); return; }
        C.downloadFile(d);
        C.logAccess(ss && ss.rec, d, '다운로드');
        return;
      }
      if (act === 'mat-req') {
        C.requestAdd(rfp.id, party || {}, { kind: '자료 열람 요청', doc_id: b.getAttribute('data-id'), doc_label: b.getAttribute('data-name') || '', message: '열람 요청' });
        repaint(); C.toast('열람 요청을 보냈습니다. 담당자 승인 후 열립니다.'); return;
      }
      if (act === 'mat-acl') { matAclModal(rfp, b.getAttribute('data-id'), { repaint: repaint }); return; }
      if (act === 'mat-upload') { matUploadModal(rfp, b.getAttribute('data-kind') || 'etc', repaint); return; }
      if (act === 'party-add') { if (window.NAI_RFPFLOW) { C.toast('📁 제출 폴더 → 참여자 추가에서 등록하세요.'); window.NAI_RFP_OPEN(rfp.asset_id, 'folder', rfp.id); } return; }
      if (act === 'require') { requireModal(rfp, { repaint: repaint }); return; }
      if (act === 'crit') { criteriaModal(rfp, { repaint: repaint }); return; }
      if (act === 'long-auto') {
        var made = 0;
        C.participantsOf(rfp.id).forEach(function (p) {
          if (p.party_type === '자문사') return;
          var st = C.submitState(rfp, p);
          if (!st.count) return;
          if (!C.listRowOf(rfp.id, p.id)) { C.listMove(rfp.id, p.id, '롱리스트', { memo: 'LOI/LOC 제출로 자동 편입' }); made++; }
        });
        repaint(); C.toast('롱리스트에 ' + made + '건을 편입했습니다.'); return;
      }
      if (act === 'move') { moveModal(rfp, b.getAttribute('data-pid'), b.getAttribute('data-to'), { repaint: repaint }); return; }
      if (act === 'req') {
        C.requestDecide(b.getAttribute('data-id'), b.getAttribute('data-res'));
        repaint(); C.toast('요청을 ' + b.getAttribute('data-res') + ' 처리했습니다.'); return;
      }
      if (act === 'fin') {
        if (window.naiShowView) window.naiShowView('finance');
        setTimeout(function () { if (window.NAI_FIN) window.NAI_FIN.show(); }, 60);
        return;
      }
      if (act === 'contact') { contactModal(rfp, party, repaint); return; }
      if (act === 'req-memo') { memoModal(rfp, repaint); return; }
    }, { once: false });
  }

  function caRegModal(rfp, participantId, repaint) {
    var p = C.participantOf(rfp.id, participantId);
    if (!p) return;
    var ex = C.caReceiptOf(rfp.id, p.id) || {};
    var body = '<p class="rfp-note"><b>' + esc(p.company) + '</b>(' + esc(p.party_type) + ')의 CA 서명본을 등록합니다. 접수되면 이 참여자만 자료를 열람할 수 있게 됩니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('manager', '담당자', ex.manager || p.name || '', 'text') +
      C.field('signed_date', '서명일', ex.signed_date || C.today(), 'date') +
      C.field('status', '상태', ex.status || 'CA 접수', 'select', { options: ['CA 미제출', 'CA 접수', '반려'] }) +
      C.field('note', '비고', ex.note || '', 'text', { wide: true }) + '</div>' +
      '<div class="dr-uploader"><b>서명본</b><button type="button" class="mini-btn" data-dr-pick="1">＋ 파일</button>' +
      '<ul class="rfp-attach-list" data-dr-files><li class="empty">파일 없음</li></ul></div>';
    var m = C.modal('CA 접수 등록 — ' + p.company, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-dr-save="1">저장</button>'
    });
    var files = [];
    m.querySelector('[data-dr-pick]').addEventListener('click', function () {
      C.pickFiles(true).then(function (list) {
        if (!list || !list.length) return;
        C.readFile(list[0]).then(function (r) {
          files = [{ name: r.name, size: r.size, mime: r.mime, dataUrl: r.dataUrl || '', text: r.text || '' }];
          m.querySelector('[data-dr-files]').innerHTML = '<li>' + esc(files[0].name) + '</li>';
        });
      });
    });
    m.querySelector('[data-dr-save]').addEventListener('click', function () {
      C.caReceiptCommit(rfp.id, p, {
        manager: C.fval(m, 'manager'), signed_date: C.fval(m, 'signed_date'),
        status: C.fval(m, 'status'), note: C.fval(m, 'note'), files: files
      });
      C.closeModal(); repaint(); C.toast('CA 상태를 기록했습니다.');
    });
  }

  function matUploadModal(rfp, kind, repaint) {
    var label = kind === 'im' ? 'IM·티저' : kind === 'rentroll' ? '렌트롤' : kind === 'opex' ? 'OPEX' : '기타 자료';
    var body = '<p class="rfp-note">' + esc(label) + ' 파일을 등록합니다. 새로 올리면 <b>이전 버전은 그대로 보관</b>되고 최신본이 표시됩니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('name', '표시 이름', '', 'text', { wide: true, ph: '예) 2026-10 렌트롤' }) +
      C.field('month', '기준 월', C.today().slice(0, 7), 'month') +
      C.field('acl', '공개 등급', (kind === 'im' || kind === 'rentroll' || kind === 'opex') ? '기본 개방' : '요청 시 개방', 'select', { options: ['기본 개방', '요청 시 개방', '비공개'] }) +
      C.field('tags', '태그', kind === 'etc' ? '기타' : '', 'text', { wide: true, ph: '감정평가서, 도면·건축물대장, 인허가, 계약·등기, 기술·환경, 시장 리포트' }) +
      '</div><div class="dr-uploader"><b>파일</b><button type="button" class="mini-btn" data-dr-pick="1">＋ 파일</button>' +
      '<ul class="rfp-attach-list" data-dr-files><li class="empty">파일 없음</li></ul></div>';
    var m = C.modal(label + ' 업로드', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-dr-save="1">저장</button>'
    });
    var picked = null;
    m.querySelector('[data-dr-pick]').addEventListener('click', function () {
      C.pickFiles(true).then(function (list) {
        if (!list || !list.length) return;
        C.readFile(list[0]).then(function (r) {
          picked = r;
          m.querySelector('[data-dr-files]').innerHTML = '<li>' + esc(r.name) + ' · ' + C.bytes(r.size) + '</li>';
          var nm = m.querySelector('[name="name"]'); if (nm && !nm.value) nm.value = r.name;
        }).catch(function () { C.toast('파일을 읽지 못했습니다.', true); });
      });
    });
    m.querySelector('[data-dr-save]').addEventListener('click', function () {
      if (!picked) { C.toast('파일을 선택하세요.', true); return; }
      var rows = C.cleanRows(picked.rows || []);
      var sum = kind === 'rentroll' ? C.rentRollSummary(rows) : (kind === 'opex' ? C.opexSummary(rows, (C.latestDoc(rfp.asset_id, 'rentroll') || {}).summary ? C.latestDoc(rfp.asset_id, 'rentroll').summary.leasedArea : 0) : null);
      var d = C.commit('docs', {
        id: C.uid('doc'), asset_id: rfp.asset_id, asset_name: rfp.asset_name,
        kind: kind, label: label, name: C.fval(m, 'name') || picked.name, size: picked.size, mime: picked.mime,
        dataUrl: picked.dataUrl || '', text: picked.text || '', rows: rows, summary: sum,
        month: C.fval(m, 'month'), access: C.fval(m, 'acl'), download: true,
        tags: C.fval(m, 'tags').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        uploaded_by: (C.me() && C.me().name) || C.role(), at: new Date().toISOString()
      });
      rfp.material_ids = (rfp.material_ids || []).concat([d.id]);
      C.commit('rfps', rfp);
      C.closeModal(); repaint(); C.toast(label + '을 등록했습니다.');
    });
  }

  function deliverModal(rfp, party, repaint) {
    var perf = C.perfOf(rfp.id) || C.ensurePerf(rfp);
    var body = '<p class="rfp-note">수행 산출물을 제출합니다. 버전·제출시각·제출자가 기록됩니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('name', '산출물 이름', '', 'text', { wide: true, ph: '예) 마케팅 리스트 v1 / TM 초안' }) +
      C.field('milestone', '관련 일정', '', 'select', { options: (perf.milestones || []).map(function (m) { return m.name; }) }) +
      C.field('note', '비고', '', 'text', { wide: true }) + '</div>' +
      '<div class="dr-uploader"><b>파일</b><button type="button" class="mini-btn" data-dr-pick="1">＋ 파일</button>' +
      '<ul class="rfp-attach-list" data-dr-files><li class="empty">파일 없음</li></ul></div>';
    var m = C.modal('수행 산출물 제출', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-dr-save="1">제출</button>'
    });
    var files = [];
    m.querySelector('[data-dr-pick]').addEventListener('click', function () {
      C.pickFiles(true).then(function (list) {
        if (!list || !list.length) return;
        Promise.all(list.map(function (f) {
          return C.readFile(f).then(function (r) { return { name: r.name, size: r.size, mime: r.mime, dataUrl: r.dataUrl || '', text: r.text || '' }; })
            .catch(function () { return { name: f.name, size: f.size }; });
        })).then(function (items) {
          files = files.concat(items);
          m.querySelector('[data-dr-files]').innerHTML = '<li>' + esc(files.map(function (f) { return f.name; }).join(', ')) + '</li>';
        });
      });
    });
    m.querySelector('[data-dr-save]').addEventListener('click', function () {
      var name = C.fval(m, 'name');
      if (!name) { C.toast('산출물 이름을 입력하세요.', true); return; }
      var dls = perf.deliverables || [];
      var same = dls.filter(function (d) { return d.name === name; })[0];
      if (same) { same.version = (same.version || 1) + 1; same.files = files; same.at = new Date().toISOString(); same.note = C.fval(m, 'note'); }
      else dls.push({ id: C.uid('del'), name: name, version: 1, milestone: C.fval(m, 'milestone'), files: files, note: C.fval(m, 'note'), at: new Date().toISOString(), by: (C.me() && C.me().name) || (party && party.company) || '' });
      perf.deliverables = dls;
      perf.updated_at = new Date().toISOString();
      C.commit('performance', perf);
      C.closeModal(); repaint(); C.toast('산출물을 제출했습니다.');
    });
  }

  function contactModal(rfp, party, repaint) {
    var body = '<p class="rfp-note">담당자에게 문의·접촉 요청을 남깁니다. 요청·응대 이력이 딜 룸에 기록됩니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('kind', '구분', '문의', 'select', { options: ['문의', '접촉 요청', '자료 열람 요청'] }) +
      C.field('topic', '제목', '', 'text', { wide: true }) +
      C.field('message', '내용', '', 'textarea', { wide: true, rows: 3 }) + '</div>';
    var m = C.modal('문의·접촉 요청', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-dr-save="1">보내기</button>'
    });
    m.querySelector('[data-dr-save]').addEventListener('click', function () {
      C.requestAdd(rfp.id, party || {}, { kind: C.fval(m, 'kind'), topic: C.fval(m, 'topic'), message: C.fval(m, 'message') });
      C.closeModal(); repaint(); C.toast('접수했습니다.');
    });
  }

  function memoModal(rfp, repaint) {
    var pend = C.pendingRequests(rfp.id);
    var body = '<p class="rfp-note">요청에 대한 응대 메모를 남깁니다.</p>' +
      (pend.length ? pend.map(function (r) {
        return '<div class="dr-memo"><b>' + esc(r.company) + ' — ' + esc(r.kind) + '</b><span>' + esc(r.message || '') + '</span>' +
          '<input class="rfp-in" data-memo-for="' + esc(r.id) + '" placeholder="응대 메모">' +
          '<button type="button" class="mini-btn" data-dr-close-req="' + esc(r.id) + '">완료 처리</button></div>';
      }).join('') : '<p class="rfp-hint">대기 요청이 없습니다.</p>') +
      '<button type="button" class="btn btn-primary" data-dr-save="1">메모 저장</button>';
    var m = C.modal('응대 메모', body, { wide: true, footer: '<button type="button" class="btn btn-ghost" data-rfp="close">닫기</button>' });
    m.addEventListener('click', function (e) {
      var c = e.target.closest('[data-dr-close-req]');
      if (c) {
        var id = c.getAttribute('data-dr-close-req');
        var inp = m.querySelector('[data-memo-for="' + id + '"]');
        C.requestMemo(id, inp ? inp.value : '');
        C.requestDecide(id, '완료', inp ? inp.value : '');
        repaint(); C.toast('완료 처리했습니다.');
      }
      if (e.target.closest('[data-dr-save]')) {
        $$('[data-memo-for]', m).forEach(function (inp) { C.requestMemo(inp.getAttribute('data-memo-for'), inp.value); });
        C.closeModal(); repaint(); C.toast('메모를 저장했습니다.');
      }
    });
  }

  window.NAI_DEALROOM = { render: render, bind: bind, lenderVerified: lenderVerified };
})();
