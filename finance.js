/* =========================================================================
   Open AI Asset Bridge — finance.js  (💰 대출·금융 연결, 2026-11-28)
   -------------------------------------------------------------------------
   자문사 포털과 분리된 금융 층입니다. 딜 룸에는 링크·요약만 노출합니다.

     A. 대주 조건 제시(공급) — 증권사·금융기관이 그 물건에 대해
        대출 가능 / 상신 가능 금액 / 금리·LTV·트랑슈·만기 조건을 올림
     B. 자금조달 요청(수요) — 투자자가 에쿼티·금액·금리 범위로 LOC 가능 기관을 요청,
        NAI가 금융기관 풀에서 매칭해 전달

   실체 진위확인은 운영자 전용입니다(참여자 화면에는 자기 인증 상태만).
   기존 lenders(금융기관 등록·인증), hub.js 대출신청·금융주선, investors 대출형 펀드를 재사용합니다.
   중개 수수료는 조건·수취 주체가 미정이라 금액을 확정하지 않고 "수수료 협의"로 표기합니다.
   ========================================================================= */
(function () {
  'use strict';

  var C = window.NAI_RFPC;
  if (!C) return;
  var esc = C.esc, n0 = C.n0, num = C.num;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = { rfpId: '', tab: 'offer', mode: 'all' };
  function ss() { return C.session(); }
  function isParty() { var s = ss(); return !!(s && s.holder_type); }
  function isStaff() { var r = C.role(); return r === 'admin' || r === 'internal'; }
  function badge(t, c) { return '<span class="rfp-tag ' + (c || '') + '">' + esc(t) + '</span>'; }

  function offers(rfpId) {
    return C.list('fin_offers').filter(function (o) { return !rfpId || o.rfp_id === rfpId; })
      .sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }
  function requests(rfpId) {
    return C.list('fin_requests').filter(function (o) { return !rfpId || o.rfp_id === rfpId; })
      .sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }
  function lenderStatus(name) {
    var a = C.list('lenders');
    for (var i = 0; i < a.length; i++) if (String(a[i].name) === String(name)) return a[i].status || '등록';
    return '';
  }
  function rfps() {
    var all = C.visibleRfps(ss());
    return all;
  }

  function shell() {
    var list = rfps();
    if (!S.rfpId && list.length) S.rfpId = list[0].id;
    var rfp = S.rfpId ? C.rfpOf(S.rfpId) : null;
    var h = '<div class="rfp-shell dr-shell"><div class="rfp-top"><div class="rfp-title">' +
      '<h2>💰 대출·금융 연결</h2>' +
      '<p>딜(물건)에 붙는 <b>대주 조건 제시</b>와 <b>자금조달 요청</b>을 한곳에서 관리합니다. ' +
      '자문사 포털과 분리된 금융 층이며, 딜 룸에는 요약·링크만 표시됩니다.</p>' +
      '<p class="rfp-meta">' + (isParty() ? '참여자 보기 · ' + esc(ss().holder || '') : '운영자 보기 · NAI') +
      ' <span class="rfp-hint">실체 진위확인은 운영자 전용입니다.</span></p></div>' +
      '<div class="rfp-top-actions"><select id="finRfp">' + list.map(function (r) {
        return '<option value="' + esc(r.id) + '"' + (r.id === S.rfpId ? ' selected' : '') + '>' + esc(r.title) + '</option>';
      }).join('') + '</select>' +
      '<button type="button" class="btn btn-ghost' + ((S.mode || 'market') === 'market' ? ' primary' : '') + '" data-fin-mode="market">🧩 매칭 마켓</button>' +
      '<button type="button" class="btn btn-ghost' + (S.mode === 'svc' ? ' primary' : '') + '" data-fin-mode="svc">📋 용역 진행</button>' +
      '<button type="button" class="btn btn-ghost" data-fin="reload">↻</button></div></div>';
    if (S.mode === 'svc') {
      h += '<div id="svcHost" class="svc-host"></div>';
      return h + '</div>';
    }
    if (!rfp) return h + '<div class="rfp-empty">딜이 없습니다. RFP를 먼저 만드세요.</div>';
    var loc = C.locOf(rfp.asset_id);
    h += '<div class="fin-headcard"><div><b>' + esc(rfp.title) + '</b>' +
      '<span>' + esc([rfp.asset_name, loc.region, '단계 ' + C.flowOf(rfp)].filter(Boolean).join(' · ')) + '</span></div>' +
      '<div class="dr-tools"><button type="button" class="mini-btn" data-fin="open-room">🏢 딜 룸</button></div></div>';

    /* 카테고리 — 4대 카테고리·19개 품목(기획초안). 금융은 아래 전용 패널, 나머지는 일반 게시·매칭. */
    var CATS = [
      { key: 'fund', label: '① 자금조달', items: ['선순위 대출', '중순위·메자닌', '브릿지', 'PF·금융주선', '에쿼티(공동투자)'] },
      { key: 'advisory', label: '② 실사·자문', items: ['감정평가', '회계·세무 실사', '법률', '기술·환경', '시장조사'] },
      { key: 'ops', label: '③ 운영·법정관리', items: ['PM', 'FM(미화·경비·주차)', '기계설비 성능점검', '에너지진단', '소방·전기·승강기 점검', '조경·주차', '법정관리·컨설팅'] },
      { key: 'ins', label: '④ 보험·인력', items: ['재산종합보험', '영업배상·CAR', 'PM·FM 인력'] }
    ];
    h += '<div class="mk-cats">' + CATS.map(function (c) {
      return '<button type="button" class="mk-cat' + ((S.cat || 'fund') === c.key ? ' on' : '') + '" data-mk-cat="' + c.key + '">' + esc(c.label) + '<em>' + c.items.length + '품목</em></button>';
    }).join('') + '</div>';
    if ((S.cat || 'fund') !== 'fund') {
      return h + '<div class="rfp-top-actions" style="margin:6px 0"><button type="button" class="btn btn-ghost" data-fin="reload">↻</button></div>' + genericPanel(rfp, CATS);
    }
    if (isStaff()) {
      h += '<div class="rfp-steps fin-tabs">' +
        '<button type="button" class="rfp-step' + (S.tab === 'offer' ? ' on' : '') + '" data-fin-tab="offer"><b>🏦 대주 조건 제시 (공급)</b><span>금융기관이 올린 대출 조건</span></button>' +
        '<button type="button" class="rfp-step' + (S.tab === 'req' ? ' on' : '') + '" data-fin-tab="req"><b>🙋 자금조달 요청 (수요)</b><span>투자자 요청 → 기관 매칭</span></button>' +
        '<button type="button" class="rfp-step' + (S.tab === 'ledger' ? ' on' : '') + '" data-fin-tab="ledger"><b>📒 이력·대장</b><span>누가·언제·어떤 조건</span></button></div>';
      h += S.tab === 'req' ? reqPanel(rfp) : (S.tab === 'ledger' ? ledgerPanel(rfp) : offerPanel(rfp));
    } else {
      h += partyPanel(rfp);
    }
    h += '</div>';
    return h;
  }

  function offerPanel(rfp) {
    var rows = offers(rfp.id);
    var h = '<section class="rfp-panel"><div class="rfp-panel-head"><b>대주 조건 제시</b>' +
      '<span class="rfp-panel-tools"><button type="button" class="mini-btn" data-fin="offer-add">＋ 조건 등록</button></span></div>';
    if (!rows.length) return h + '<p class="rfp-hint">등록된 대출 조건이 없습니다. 금융기관이 제시한 조건을 등록하면 투자자 검토로 이어집니다.</p>';
    h += '<div class="rfp-table-wrap"><table class="rfp-table small"><thead><tr><th>기관</th><th>인증</th><th>금액(억)</th><th>금리</th><th>LTV</th><th>트랑슈·만기</th><th>조건</th><th>상태</th><th>기록</th></tr></thead><tbody>';
    rows.forEach(function (o) {
      var st = lenderStatus(o.lender_name);
      h += '<tr><td><b>' + esc(o.lender_name) + '</b><span class="rfp-sub">' + esc(o.manager || '') + '</span></td>' +
        '<td>' + (st === '인증' ? badge('인증완료', 'ok') : badge(st || '미인증', 'wait')) + '</td>' +
        '<td class="num">' + (o.amount_eok ? n0(o.amount_eok) : '-') + '</td>' +
        '<td>' + esc(o.rate || '-') + '</td><td>' + esc(o.ltv || '-') + '</td>' +
        '<td>' + esc([o.tranche, o.tenor].filter(Boolean).join(' · ') || '-') + '</td>' +
        '<td class="rfp-sub">' + esc(o.terms || '') + '</td>' +
        '<td>' + badge(o.status || '제시', o.status === '성사' ? 'ok' : 'flow') + '</td>' +
        '<td class="rfp-sub">' + esc(C.when(o.at)) + '</td></tr>';
    });
    h += '</tbody></table></div>' +
      '<p class="rfp-hint">중개 수수료: <b>수수료 협의</b> (조건·수취 주체 미정 — 금액을 임의로 확정하지 않습니다).</p></section>';
    return h;
  }

  function reqPanel(rfp) {
    var rows = requests(rfp.id);
    var h = '<section class="rfp-panel"><div class="rfp-panel-head"><b>자금조달 요청</b>' +
      '<span class="rfp-panel-tools"><button type="button" class="mini-btn" data-fin="req-add">＋ 요청 등록</button></span></div>';
    if (!rows.length) return h + '<p class="rfp-hint">요청이 없습니다. 투자자가 "에쿼티·금액·금리 범위"로 요청하면 금융기관 풀에서 매칭합니다.</p>';
    h += '<div class="rfp-table-wrap"><table class="rfp-table small"><thead><tr><th>요청자</th><th>에쿼티(억)</th><th>필요 금액(억)</th><th>금리 범위</th><th>용도·조건</th><th>상태</th><th>매칭</th><th></th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td><b>' + esc(r.company || '') + '</b><span class="rfp-sub">' + esc(C.when(r.at)) + '</span></td>' +
        '<td class="num">' + (r.equity_eok ? n0(r.equity_eok) : '-') + '</td>' +
        '<td class="num">' + (r.amount_eok ? n0(r.amount_eok) : '-') + '</td>' +
        '<td>' + esc(r.rate_range || '-') + '</td><td class="rfp-sub">' + esc(r.purpose || '') + '</td>' +
        '<td>' + badge(r.status || '요청', r.status === '전달' ? 'ok' : 'flow') + '</td>' +
        '<td class="rfp-sub">' + esc((r.matches || []).map(function (m) { return m.lender; }).join(', ') || '—') + '</td>' +
        '<td><button type="button" class="mini-btn" data-fin="match" data-id="' + esc(r.id) + '">매칭</button></td></tr>';
    });
    h += '</tbody></table></div></section>';
    return h;
  }

  function ledgerPanel(rfp) {
    var rows = offers(rfp.id).concat(requests(rfp.id)).sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
    var h = '<section class="rfp-panel"><div class="rfp-panel-head"><b>금융 연결 이력</b><span>' + rows.length + '건</span></div>';
    if (!rows.length) return h + '<p class="rfp-hint">이력이 없습니다.</p>';
    h += '<div class="rfp-table-wrap"><table class="rfp-table tiny"><thead><tr><th>일시</th><th>구분</th><th>기관·요청자</th><th>조건</th><th>상태</th><th>기록</th></tr></thead><tbody>' +
      rows.map(function (o) {
        var isOffer = !!o.lender_name;
        return '<tr><td>' + esc(C.when(o.at)) + '</td><td>' + (isOffer ? '대주 조건' : '자금 요청') + '</td>' +
          '<td>' + esc(isOffer ? o.lender_name : o.company) + '</td>' +
          '<td>' + esc(isOffer ? [o.amount_eok ? n0(o.amount_eok) + '억' : '', o.rate, o.ltv, o.tranche, o.tenor].filter(Boolean).join(' · ') : [o.amount_eok ? n0(o.amount_eok) + '억' : '', o.rate_range].filter(Boolean).join(' · ')) + '</td>' +
          '<td>' + esc(o.status || '') + '</td><td class="rfp-sub">' + esc([o.by, o.note].filter(Boolean).join(' · ')) + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
    return h;
  }

  /* ── 일반 카테고리(자금조달 외) — 공급 제안 / 수요 요청 / 매칭 ── */
  function posts(rfpId, cat) {
    return C.list('market_posts').filter(function (p) {
      return (!rfpId || p.rfp_id === rfpId || !p.rfp_id) && (!cat || p.cat === cat);
    }).sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }
  function genericPanel(rfp, CATS) {
    var cat = CATS.filter(function (c) { return c.key === S.cat; })[0] || CATS[0];
    var rows = posts(rfp.id, cat.key);
    var offersN = rows.filter(function (x) { return x.side === '공급'; });
    var reqsN = rows.filter(function (x) { return x.side === '수요'; });
    var h = '<section class="rfp-panel"><div class="rfp-panel-head"><b>' + esc(cat.label) + ' — 공급 제안 / 수요 요청</b>' +
      '<span class="rfp-panel-tools"><button type="button" class="mini-btn" data-mk="add" data-side="공급">＋ 공급 제안</button>' +
      '<button type="button" class="mini-btn" data-mk="add" data-side="수요">＋ 수요 요청</button>' +
      '<button type="button" class="mini-btn" data-mk="hub">기존 업무신청으로</button></span></div>' +
      '<p class="rfp-hint">품목: ' + esc(cat.items.join(' · ')) + ' — 같은 카테고리에서 공급 제안과 수요 요청을 조건으로 대조해 매칭합니다. ' +
      '수수료는 「협의」로 기록하며 금액을 임의로 정하지 않습니다.</p>';
    if (!rows.length) return h + '<p class="rfp-hint">게시된 제안·요청이 없습니다.</p>';
    h += '<div class="mk-grid">' +
      '<div class="mk-col"><b>🏷 공급 제안 (' + offersN.length + ')</b>' + (offersN.length ? offersN.map(postCard).join('') : '<p class="rfp-hint">없음</p>') + '</div>' +
      '<div class="mk-col"><b>🙋 수요 요청 (' + reqsN.length + ')</b>' + (reqsN.length ? reqsN.map(postCard).join('') : '<p class="rfp-hint">없음</p>') + '</div>' +
      '</div>';
    return h + '</section>';
  }
  function postCard(p) {
    return '<div class="mk-post"><div class="mk-post-top"><span class="mk-side ' + (p.side === '공급' ? 'sup' : 'dem') + '">' + esc(p.side) + '</span>' +
      '<b>' + esc(p.item || p.title) + '</b>' + badge(p.status || '게시', p.status === '진행' || p.status === '매칭' ? 'ok' : 'flow') + '</div>' +
      '<em>' + esc([p.company, p.region, p.deadline ? '마감 ' + p.deadline : ''].filter(Boolean).join(' · ')) + '</em>' +
      '<p>' + esc(p.terms || '') + '</p>' +
      (p.matches && p.matches.length ? '<p class="rfp-sub">매칭: ' + esc(p.matches.map(function (m) { return m.company; }).join(', ')) + ' · 수수료 협의</p>' : '') +
      '<div class="dr-tools">' + (isStaff() ? '<button type="button" class="mini-btn" data-mk="match" data-id="' + esc(p.id) + '">매칭</button>' : '') +
      '<span class="rfp-sub">' + esc(C.when(p.at)) + '</span></div></div>';
  }

  /* 참여자 보기 — 자기 요청·자기 기관 조건만 */
  function partyPanel(rfp) {
    var s = ss() || {};
    var mineR = requests(rfp.id).filter(function (r) { return String(r.company) === String(s.holder); });
    var mineO = offers(rfp.id).filter(function (o) { return String(o.lender_name) === String(s.holder); });
    var h = '<section class="rfp-panel"><div class="rfp-panel-head"><b>이 딜의 금융 연결</b>' +
      '<span>' + (s.holder_type === '금융기관' ? '기관 조건 제시' : '내 자금조달 요청') + '</span></div>';
    h += '<div class="rfp-kpis"><span class="rfp-kpi"><b>' + offers(rfp.id).length + '</b><em>대출 조건 제시</em></span>' +
      '<span class="rfp-kpi"><b>' + requests(rfp.id).length + '</b><em>자금조달 요청</em></span></div>';
    if (mineO.length) h += '<p class="rfp-hint">내 기관 조건 ' + mineO.length + '건 · ' + mineO.map(function (o) { return (o.status || '제시') + ' ' + n0(o.amount_eok) + '억'; }).join(', ') + '</p>';
    if (mineR.length) h += '<p class="rfp-hint">내 요청 ' + mineR.length + '건 · ' + mineR.map(function (r) { return (r.status || '요청'); }).join(', ') + '</p>';
    h += '<p class="rfp-hint">조건 제시·요청·매칭은 담당자(NAI)가 등록·중개합니다. 실체 진위확인은 운영자 전용이며, 이 화면에는 인증 상태만 표시됩니다.</p></section>';
    return h;
  }

  /* ── 모달 ── */
  function offerModal(rfp, done) {
    var lenders = C.list('lenders');
    var opts = lenders.map(function (l) { return { v: l.name, l: l.name + (l.status === '인증' ? ' (인증)' : '') }; });
    var body = '<p class="rfp-note">금융기관이 제시한 대출 조건을 등록합니다. 기관 인증 상태는 운영자 대장(lenders)에서 가져옵니다.</p>' +
      '<div class="rfp-formgrid">' +
      (opts.length ? C.field('lender_name', '금융기관', '', 'select', { options: opts }) : C.field('lender_name', '금융기관', '', 'text', { req: true })) +
      C.field('manager', '담당자', '', 'text') +
      C.field('amount_eok', '상신 가능 금액(억)', '', 'number', { step: '1' }) +
      C.field('rate', '금리', '', 'text', { ph: '예) 4.8% (3년 고정)' }) +
      C.field('ltv', 'LTV', '', 'text', { ph: '예) 60%' }) +
      C.field('tranche', '트랑슈', '', 'text', { ph: '예) 선순위/중순위' }) +
      C.field('tenor', '만기', '', 'text', { ph: '예) 3년 + 1년 연장' }) +
      C.field('terms', '조건·선행요건', '', 'textarea', { wide: true, rows: 3 }) +
      '</div>';
    var m = C.modal('대주 조건 제시', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fin-save="offer">등록</button>'
    });
    m.querySelector('[data-fin-save="offer"]').addEventListener('click', function () {
      var name = C.fval(m, 'lender_name');
      if (!name) { C.toast('금융기관을 입력하세요.', true); return; }
      C.commit('fin_offers', {
        id: C.uid('fof'), rfp_id: rfp.id, lender_name: name, manager: C.fval(m, 'manager'),
        amount_eok: C.fval(m, 'amount_eok'), rate: C.fval(m, 'rate'), ltv: C.fval(m, 'ltv'),
        tranche: C.fval(m, 'tranche'), tenor: C.fval(m, 'tenor'), terms: C.fval(m, 'terms'),
        status: '제시', fee: '수수료 협의', at: new Date().toISOString(), by: (C.me() && C.me().name) || C.role()
      });
      C.closeModal(); if (done) done(); C.toast('대출 조건을 등록했습니다.');
    });
  }

  function reqModal(rfp, done) {
    var ps = C.participantsOf(rfp.id).filter(function (p) { return p.party_type !== '자문사'; });
    var opts = ps.map(function (p) { return { v: p.company, l: p.company + ' (' + p.party_type + ')' }; });
    var body = '<p class="rfp-note">투자자의 자금조달 요청을 등록합니다. 금융기관 풀에서 매칭해 전달합니다.</p>' +
      '<div class="rfp-formgrid">' +
      (opts.length ? C.field('company', '요청자', '', 'select', { options: opts }) : C.field('company', '요청자(회사)', '', 'text', { req: true })) +
      C.field('equity_eok', '에쿼티(억)', '', 'number', { step: '1' }) +
      C.field('amount_eok', '필요 금액(억)', '', 'number', { step: '1' }) +
      C.field('rate_range', '금리 범위', '', 'text', { ph: '예) 4.5~5.0%' }) +
      C.field('purpose', '용도·조건', '', 'textarea', { wide: true, rows: 3 }) +
      '</div>';
    var m = C.modal('자금조달 요청', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fin-save="req">등록</button>'
    });
    m.querySelector('[data-fin-save="req"]').addEventListener('click', function () {
      C.commit('fin_requests', {
        id: C.uid('frq'), rfp_id: rfp.id, company: C.fval(m, 'company'),
        equity_eok: C.fval(m, 'equity_eok'), amount_eok: C.fval(m, 'amount_eok'),
        rate_range: C.fval(m, 'rate_range'), purpose: C.fval(m, 'purpose'),
        status: '요청', matches: [], at: new Date().toISOString(), by: (C.me() && C.me().name) || C.role()
      });
      C.closeModal(); if (done) done(); C.toast('자금조달 요청을 등록했습니다.');
    });
  }

  function matchModal(rfp, reqId, done) {
    var req = C.list('fin_requests').filter(function (r) { return r.id === reqId; })[0];
    if (!req) return;
    var os = offers(rfp.id).filter(function (o) { return lenderStatus(o.lender_name) === '인증' || true; });
    var body = '<p class="rfp-note"><b>' + esc(req.company) + '</b> 요청 — ' + esc([req.amount_eok ? n0(req.amount_eok) + '억' : '', req.rate_range].filter(Boolean).join(' · ')) + '</p>' +
      '<div class="rfp-advpick">' + (os.length ? os.map(function (o) {
        return '<label class="rfp-advrow"><input type="checkbox" name="moff" value="' + esc(o.id) + '">' +
          '<span><b>' + esc(o.lender_name) + '</b><em>' + esc([o.amount_eok ? n0(o.amount_eok) + '억' : '', o.rate, o.ltv, o.tranche].filter(Boolean).join(' · ')) +
          (lenderStatus(o.lender_name) === '인증' ? ' · 인증완료' : ' · 미인증') + '</em></span></label>';
      }).join('') : '<p class="rfp-hint">등록된 조건이 없습니다. 대주 조건을 먼저 등록하세요.</p>') + '</div>' +
      '<p class="rfp-hint">중개 수수료는 「수수료 협의」로 기록합니다(금액 미정).</p>';
    var m = C.modal('자금조달 매칭', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fin-save="match">전달</button>'
    });
    m.querySelector('[data-fin-save="match"]').addEventListener('click', function () {
      var ids = Array.prototype.slice.call(m.querySelectorAll('[name="moff"]:checked')).map(function (el) { return el.value; });
      if (!ids.length) { C.toast('매칭할 조건을 선택하세요.', true); return; }
      req.matches = (req.matches || []).concat(ids.map(function (id) {
        var o = C.list('fin_offers').filter(function (x) { return x.id === id; })[0] || {};
        return { lender: o.lender_name || '', offer_id: id, at: new Date().toISOString(), note: '수수료 협의' };
      }));
      req.status = '전달';
      C.commit('fin_requests', req);
      C.closeModal(); if (done) done(); C.toast('금융기관 조건을 매칭해 전달했습니다.');
    });
  }

  function postModal(rfp, side, done) {
    var CATS = { advisory: ['감정평가', '회계·세무 실사', '법률', '기술·환경', '시장조사'],
      ops: ['PM', 'FM(미화·경비·주차)', '기계설비 성능점검', '에너지진단', '소방·전기·승강기 점검', '조경·주차', '법정관리·컨설팅'],
      ins: ['재산종합보험', '영업배상·CAR', 'PM·FM 인력'] }[S.cat] || ['기타'];
    var body = '<p class="rfp-note">' + esc(side === '공급' ? '공급 측 — "할 수 있다 / 조건은 이렇다"' : '수요 측 — "이 조건으로 해 달라 / 제안 받겠다"') + ' 게시입니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('item', '품목', CATS[0], 'select', { options: CATS }) +
      C.field('company', '회사', '', 'text', { req: true }) +
      C.field('region', '권역·대상', '', 'text') +
      C.field('deadline', '마감', '', 'date') +
      C.field('terms', '조건 요약', '', 'textarea', { wide: true, rows: 3, ph: '범위·규모·주기·금리·보수 등' }) +
      C.field('contact', '담당·연락', '', 'text', { wide: true }) + '</div>';
    var m = C.modal((side === '공급' ? '＋ 공급 제안' : '＋ 수요 요청'), body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-mk-save="1">게시</button>'
    });
    m.querySelector('[data-mk-save]').addEventListener('click', function () {
      var co = C.fval(m, 'company');
      if (!co) { C.toast('회사를 입력하세요.', true); return; }
      C.commit('market_posts', {
        id: C.uid('mkp'), rfp_id: rfp ? rfp.id : '', rfp_title: rfp ? rfp.title : '',
        cat: S.cat, item: C.fval(m, 'item'), side: side, company: co,
        region: C.fval(m, 'region'), deadline: C.fval(m, 'deadline'), terms: C.fval(m, 'terms'),
        contact: C.fval(m, 'contact'), status: '게시', fee: '수수료 협의', matches: [],
        at: new Date().toISOString(), by: (C.me() && C.me().name) || C.role()
      });
      C.closeModal(); if (done) done(); C.toast('게시했습니다.');
    });
  }

  function matchPostModal(postId, done) {
    var post = C.list('market_posts').filter(function (x) { return x.id === postId; })[0];
    if (!post) return;
    var others = posts(post.rfp_id, post.cat).filter(function (x) { return x.side !== post.side && x.item === post.item && x.id !== post.id; });
    var body = '<p class="rfp-note"><b>' + esc(post.company) + '</b> · ' + esc(post.item) + ' (' + esc(post.side) + ') — 반대편 게시와 연결합니다. ' +
      '담당자가 승인하면 양측 상태가 「매칭」으로 바뀌고 이력이 남습니다(수수료 협의).</p>' +
      '<div class="rfp-advpick">' + (others.length ? others.map(function (o) {
        return '<label class="rfp-advrow"><input type="checkbox" name="mk" value="' + esc(o.id) + '">' +
          '<span><b>' + esc(o.company) + '</b><em>' + esc([o.side, o.region, o.terms].filter(Boolean).join(' · ')) + '</em></span></label>';
      }).join('') : '<p class="rfp-hint">같은 품목의 반대편 게시가 없습니다. 먼저 공급/수요를 등록하세요.</p>') + '</div>';
    var m = C.modal('매칭 — ' + post.item, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-mk-save="1">매칭 승인</button>'
    });
    m.querySelector('[data-mk-save]').addEventListener('click', function () {
      var ids = Array.prototype.slice.call(m.querySelectorAll('[name="mk"]:checked')).map(function (el) { return el.value; });
      if (!ids.length) { C.toast('연결할 게시를 선택하세요.', true); return; }
      ids.forEach(function (id) {
        var o = C.list('market_posts').filter(function (x) { return x.id === id; })[0];
        if (o) {
          o.status = '매칭';
          o.matches = (o.matches || []).concat([{ id: post.id, company: post.company, at: new Date().toISOString() }]);
          C.commit('market_posts', o);
        }
        post.matches = (post.matches || []).concat([{ id: id, company: o ? o.company : '', at: new Date().toISOString() }]);
      });
      post.status = '매칭';
      C.commit('market_posts', post);
      C.closeModal(); if (done) done(); C.toast('매칭했습니다. 이후 진행·산출물은 딜 룸/접수 목록에서 이어집니다.');
    });
  }

  function bind() {
    var host = document.getElementById('finView');
    if (!host || host.dataset.bound) return;
    host.dataset.bound = '1';
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fin]');
      if (!b) return;
      var act = b.getAttribute('data-fin');
      var rfp = S.rfpId ? C.rfpOf(S.rfpId) : null;
      var md = e.target.closest('[data-fin-mode]');
      if (md) { S.mode = md.getAttribute('data-fin-mode'); paint(); return; }
      if (act === 'reload') { paint(); return; }
      if (act === 'open-room') {
        if (window.naiShowView) window.naiShowView('vdr');
        setTimeout(function () { if (window.NAI_VDR && window.NAI_VDR.openForRfp) window.NAI_VDR.openForRfp(rfp.id); }, 80);
        return;
      }
      if (!rfp) return;
      if (act === 'offer-add') { offerModal(rfp, paint); return; }
      if (act === 'req-add') { reqModal(rfp, paint); return; }
      if (act === 'match') { matchModal(rfp, b.getAttribute('data-id'), paint); return; }
      if (act === 'open-room') {
        if (window.naiShowView) window.naiShowView('vdr');
        setTimeout(function () { if (window.NAI_VDR && window.NAI_VDR.openForRfp) window.NAI_VDR.openForRfp(rfp.id); }, 80);
        return;
      }
    });
    host.addEventListener('click', function (e) {
      var t = e.target.closest('[data-fin-tab]');
      if (t) { S.tab = t.getAttribute('data-fin-tab'); paint(); return; }
    });
    host.addEventListener('change', function (e) {
      if (e.target.id === 'finRfp') { S.rfpId = e.target.value; paint(); }
    });
    host.addEventListener('click', function (e) {
      var c = e.target.closest('[data-mk-cat]');
      if (c) { S.cat = c.getAttribute('data-mk-cat'); paint(); return; }
      var b = e.target.closest('[data-mk]');
      if (!b) return;
      var act = b.getAttribute('data-mk');
      var rfp2 = S.rfpId ? C.rfpOf(S.rfpId) : null;
      if (act === 'add') { postModal(rfp2, b.getAttribute('data-side'), paint); return; }
      if (act === 'match') { matchPostModal(b.getAttribute('data-id'), paint); return; }
      if (act === 'hub') { if (window.NAI_HUB) window.NAI_HUB.open('finance'); return; }
    });
  }

  function paint() {
    var host = document.getElementById('finView');
    if (!host) return;
    host.innerHTML = shell();
    if (S.mode === 'svc' && window.NAI_SVC) {
      var sh = document.getElementById('svcHost');
      if (sh) { sh.innerHTML = window.NAI_SVC.render(S.rfpId); window.NAI_SVC.bind(host, paint); }
    }
  }
  function show() { bind(); paint(); }

  window.NAI_FIN = { show: show, paint: paint, offers: offers, requests: requests, posts: posts };
})();
