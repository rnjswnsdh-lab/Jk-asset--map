/* =========================================================================
   Open AI Asset Bridge — finance.js  (🧩 매칭 마켓, 2026-11-28)
   -------------------------------------------------------------------------
   화면: 「🧩 매칭 마켓」 — 자금·실사·운영·보험을 올리고 찾는 곳.
     · 카테고리 4종 × 품목을 첫 화면에 그대로 펼쳐 보여 줍니다.
     · 공급(할 수 있다)과 수요(필요하다) 양쪽에서 등록·탐색·문의합니다.
     · 딜(RFP)은 "이 건에 붙이기"를 고를 때만 필요합니다 — 없으면 전체 시장.
     · 문의는 대상 레코드의 inquiries[] 에 쌓이고, 받은 쪽이 수락/거절/진행을 표시합니다.
   데이터: fin_offers(대주 조건) · fin_requests(자금 요청) · market_posts(그 외 품목 게시)
   ========================================================================= */
(function () {
  'use strict';

  var C = window.NAI_RFPC;
  if (!C) return;
  var CFG = window.NAI_MAP_CONFIG || {};
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  var esc = C.esc, n0 = C.n0;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var S = { rfpId: '', mode: 'all', cat: 'fund', item: '', q: '' };

  var CATS = [
    { key: 'fund', label: '① 자금·금융', icon: '💰', items: ['개발 PF', '담보대출(선순위)', '담보대출(중순위)', '브릿지', '리파이낸싱', '메자닌', '에쿼티·공동투자', '금융주선'] },
    { key: 'advisory', label: '② 실사·자문·컨설팅', icon: '📑', cols: 2,
      items: ['감정평가', '회계·세무 실사', '법률', '기술·환경', '시장조사',
        '입지·상권 조사', '시장·권역 분석', '개발 타당성 검토(사업성·RLV)', '용도변경·인허가 검토', '법정관리·자산관리 자문'] },
    { key: 'ops', label: '③ 운영·관리', icon: '🛠', items: ['PM', 'FM(미화·경비·주차)', '기계설비 성능점검', '에너지진단', '소방·전기·승강기 점검', '조경·주차'] },
    { key: 'ins', label: '④ 보험·인력', icon: '🛡', cols: 2,
      items: ['재산종합보험(화재 포함)', '화재보험', '손해보험(배상책임·시설물)', '기계보험·기계손해',
        '휴업손해보험', 'CAR·EAR(공사·조립)', '영업배상·CAR', 'PM·FM 인력'] }
  ];

  function ss() { return C.session(); }
  /* 품목 한 줄 설명 — 카드에서 이름 아래 작게 표시합니다(자문·보험처럼 품목이 많은 카테고리) */
  var ITEM_DESC = {
    '감정평가': '시가·담보·보상 평가, 감정평가사 연결',
    '회계·세무 실사': '재무·세무 실사와 거래 구조 검토',
    '법률': '계약·권리분석·분쟁 자문',
    '기술·환경': '구조·설비·환경 실사, 보수비 산정',
    '시장조사': '임대료·공실·거래사례 조사',
    '입지·상권 조사': '배후수요·유동인구·접근성 분석',
    '시장·권역 분석': '권역별 수급·임대료·Cap Rate 분석',
    '개발 타당성 검토(사업성·RLV)': '용적·사업성·RLV로 개발 방향 검토',
    '용도변경·인허가 검토': '용도지역·인허가 가능성 사전 검토',
    '법정관리·자산관리 자문': '법정관리·자산관리 절차와 회수 전략',
    '재산종합보험(화재 포함)': '건물·시설 재산손해 담보(화재 포함)',
    '화재보험': '화재·폭발로 인한 건물 손해 담보',
    '손해보험(배상책임·시설물)': '시설물·배상책임 사고 대비',
    '기계보험·기계손해': '기계·설비 고장 손해 담보',
    '휴업손해보험': '사고로 인한 임대수입·영업 손실 보전',
    'CAR·EAR(공사·조립)': '공사·조립 기간 중 손해 담보',
    '영업배상·CAR': '영업배상책임과 공사 보험',
    'PM·FM 인력': '운영·시설 인력 공급'
  };
  function itemDesc(it) { return ITEM_DESC[it] || ''; }

  function isParty() { var s = ss(); return !!(s && s.holder_type); }
  function isStaff() { var r = C.role(); return r === 'admin' || r === 'internal'; }
  function meName() { var s = ss(); return s ? String(s.holder || '') : ''; }
  function badge(t, c) { return '<span class="rfp-tag ' + (c || '') + '">' + esc(t) + '</span>'; }
  function catOf(k) { return CATS.filter(function (c) { return c.key === k; })[0] || CATS[0]; }

  function offers(rfpId) {
    return C.list('fin_offers').filter(function (o) { return !rfpId || o.rfp_id === rfpId; })
      .sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }
  function requests(rfpId) {
    return C.list('fin_requests').filter(function (o) { return !rfpId || o.rfp_id === rfpId; })
      .sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }
  function posts(rfpId, cat) {
    return C.list('market_posts').filter(function (p) {
      return (!rfpId || p.rfp_id === rfpId || !p.rfp_id) && (!cat || p.cat === cat);
    }).sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }
  function prodOf(o) { return o.product || o.item || '기타'; }
  function lenderStatus(name) {
    var a = C.list('lenders');
    for (var i = 0; i < a.length; i++) if (String(a[i].name) === String(name)) return a[i].status || '등록';
    return '';
  }
  function inqs(rec) { return (rec && rec.inquiries) || []; }
  function openInq(rec) { return inqs(rec).filter(function (x) { return x.status === '문의' || x.status === '검토'; }); }

  function recCol(kind) { return kind === 'offer' ? 'fin_offers' : (kind === 'req' ? 'fin_requests' : 'market_posts'); }
  function recGet(kind, id) { return C.list(recCol(kind)).filter(function (x) { return x.id === id; })[0] || null; }
  function recOwner(kind, rec) { return kind === 'offer' ? (rec.lender_name || '') : (rec.company || ''); }
  function recLabel(kind, rec) {
    if (kind === 'offer') return (rec.lender_name || '') + ' · ' + prodOf(rec);
    if (kind === 'req') return (rec.company || '') + ' · ' + prodOf(rec);
    return (rec.company || '') + ' · ' + (rec.item || '');
  }

  function itemCount(catKey, item) {
    if (catKey === 'fund') {
      return offers('').filter(function (o) { return prodOf(o) === item; }).length +
        requests('').filter(function (r) { return prodOf(r) === item; }).length;
    }
    return posts('', catKey).filter(function (p) { return p.item === item; }).length;
  }

  /* ───────────────────────── 화면 ───────────────────────── */
  function shell() {
    var rfp = S.rfpId ? C.rfpOf(S.rfpId) : null;
    var h = '<div class="rfp-shell dr-shell"><div class="rfp-top"><div class="rfp-title">' +
      '<h2>🧩 매칭 마켓</h2>' +
      '<p>자금·실사·운영·보험까지, 딜에 필요한 서비스를 <b>올리고 찾는</b> 곳입니다.</p></div>' +
      '<div class="rfp-top-actions">' +
      '<select id="finRfp" title="특정 딜에 붙일 때만 고릅니다"><option value="">전체 (딜 미지정)</option>' +
      (C.visibleRfps(ss()) || []).map(function (r) {
        return '<option value="' + esc(r.id) + '"' + (r.id === S.rfpId ? ' selected' : '') + '>' + esc(r.title) + '</option>';
      }).join('') + '</select>' +
      '<button type="button" class="btn btn-ghost' + (S.mode !== 'svc' ? ' primary' : '') + '" data-fin-mode="market">🧩 매칭 마켓</button>' +
      '<button type="button" class="btn btn-ghost' + (S.mode === 'svc' ? ' primary' : '') + '" data-fin-mode="svc">📋 용역 진행</button>' +
      '<button type="button" class="btn btn-ghost" data-fin="reload">↻</button></div></div>';

    if (S.mode === 'svc') {
      h += '<div id="svcHost" class="svc-host"></div>';
      return h + '</div>';
    }

    h += roleHintHTML();
    if (rfp) {
      var loc = C.locOf(rfp.asset_id);
      h += '<div class="fin-headcard"><div><b>' + esc(rfp.title) + '</b>' +
        '<span>' + esc([rfp.asset_name, loc.region].filter(Boolean).join(' · ')) + ' — 이 딜에 붙이는 항목입니다.</span></div>' +
        '<div class="dr-tools"><button type="button" class="mini-btn" data-fin="open-room">🏢 딜 룸</button></div></div>';
    }

    /* 카테고리 × 품목 전부 펼치기 */
    h += '<div class="mk-catwrap">' + CATS.map(catCardHTML).join('') + '</div>';

    /* 품목 상세 */
    h += itemPanelHTML();
    h += myDeskHTML();
    h += '</div>';
    return h;
  }

  function roleHintHTML() {
    if (isParty()) {
      return '<div class="fin-guide"><b>내 활동</b>' + esc(meName()) + ' — 올린 항목과 받은 문의를 아래에서 보고, 상대 항목에 문의할 수 있습니다.</div>';
    }
    if (isStaff()) {
      return '<div class="fin-guide"><b>등록·중개</b> — 조건과 요청을 올리고, 게시별 문의를 받아 연결합니다.</div>';
    }
    return '<div class="fin-guide"><b>열람 전용</b> — 접속하면 등록·문의를 할 수 있습니다. ' +
      '<button type="button" class="mini-btn" data-fin="login">🔑 접속코드 입력</button></div>';
  }

  function catCardHTML(cat) {
    var totals = cat.items.reduce(function (a, it) { return a + itemCount(cat.key, it); }, 0);
    var items = cat.items.map(function (it) {
      var n = itemCount(cat.key, it);
      var on = (S.cat === cat.key && S.item === it);
      var d = itemDesc(it);
      return '<div class="mk-item' + (on ? ' on' : '') + '">' +
        '<button type="button" class="mk-item-name" data-fin-item="' + esc(cat.key) + '|' + esc(it) + '">' + esc(it) +
        '<em>' + n + '건</em>' + (d ? '<span class="mk-item-desc">' + esc(d) + '</span>' : '') + '</button>' +
        '<span class="mk-item-act">' +
        '<button type="button" class="mini-btn" data-fin-add="' + esc(cat.key) + '|' + esc(it) + '|공급">＋ 공급</button>' +
        '<button type="button" class="mini-btn" data-fin-add="' + esc(cat.key) + '|' + esc(it) + '|수요">＋ 수요</button>' +
        '</span></div>';
    }).join('');
    return '<section class="mk-catcard"><div class="mk-catcard-head"><b>' + cat.icon + ' ' + esc(cat.label) + '</b>' +
      '<span>' + cat.items.length + '품목 · 게시 ' + totals + '건</span></div>' +
      '<div class="mk-items' + (cat.cols === 2 ? ' cols2' : '') + '">' + items + '</div></section>';
  }

  function itemPanelHTML() {
    var cat = catOf(S.cat), item = S.item;
    if (!item) {
      return '<section class="rfp-panel"><div class="rfp-panel-head"><b>품목을 고르세요</b><span>위에서 품목을 누르면 게시·조건이 보입니다</span></div>' +
        '<p class="rfp-hint">공급(할 수 있다)과 수요(필요하다)가 양쪽으로 쌓입니다. 어느 쪽이든 올리고, 상대 항목에 문의할 수 있습니다.</p></section>';
    }
    var h = '<section class="rfp-panel"><div class="rfp-panel-head"><b>' + cat.icon + ' ' + esc(item) + '</b>' +
      '<span class="rfp-panel-tools">' +
      '<button type="button" class="mini-btn primary" data-fin-add="' + esc(cat.key) + '|' + esc(item) + '|공급">＋ 공급 제안</button>' +
      '<button type="button" class="mini-btn" data-fin-add="' + esc(cat.key) + '|' + esc(item) + '|수요">＋ 수요 요청</button>' +
      '</span></div>';

    if (cat.key === 'fund') {
      h += '<div class="mk-cols"><div class="mk-col"><b>🏦 대주 조건 (' + offers('').filter(function (o) { return prodOf(o) === item; }).length + ')</b>' +
        offerListHTML(offers('').filter(function (o) { return prodOf(o) === item; })) + '</div>' +
        '<div class="mk-col"><b>🙋 자금 요청 (' + requests('').filter(function (r) { return prodOf(r) === item; }).length + ')</b>' +
        reqListHTML(requests('').filter(function (r) { return prodOf(r) === item; })) + '</div></div>';
      return h + '</section>';
    }
    var rows = posts('', cat.key).filter(function (p) { return p.item === item; });
    var sup = rows.filter(function (p) { return p.side === '공급'; });
    var dem = rows.filter(function (p) { return p.side === '수요'; });
    h += '<div class="mk-cols"><div class="mk-col"><b>🏷 공급 제안 (' + sup.length + ')</b>' +
      (sup.length ? sup.map(postCard).join('') : '<p class="rfp-hint">아직 없습니다 — 위 「＋ 공급 제안」으로 첫 건을 올려 주세요.</p>') + '</div>' +
      '<div class="mk-col"><b>🙋 수요 요청 (' + dem.length + ')</b>' +
      (dem.length ? dem.map(postCard).join('') : '<p class="rfp-hint">아직 없습니다 — 위 「＋ 수요 요청」으로 올릴 수 있습니다.</p>') + '</div></div>';
    return h + '</section>';
  }

  function inqCell(kind, rec) {
    var n = inqs(rec).length, pend = openInq(rec).length;
    return '<div class="dr-tools"><button type="button" class="mini-btn" data-fin-inq="' + kind + '|' + esc(rec.id) + '">문의</button>' +
      (n ? '<button type="button" class="mini-btn" data-fin-inql="' + kind + '|' + esc(rec.id) + '">받은 문의 ' + n + (pend ? ' · 대기 ' + pend : '') + '</button>' : '') + '</div>';
  }

  function offerListHTML(rows) {
    if (!rows.length) return '<p class="rfp-hint">등록된 조건이 없습니다.</p>';
    return rows.map(function (o) {
      var st = lenderStatus(o.lender_name);
      return '<div class="mk-post"><div class="mk-post-top"><span class="mk-side sup">공급</span>' +
        '<b>' + esc(o.lender_name) + '</b>' + (st === '인증' ? badge('인증완료', 'ok') : badge(st || '미인증', 'wait')) + '</div>' +
        '<em>' + esc([o.amount_eok ? n0(o.amount_eok) + '억' : '', o.rate, o.ltv ? 'LTV ' + o.ltv : '', o.tenor].filter(Boolean).join(' · ') || '조건 미입력') + '</em>' +
        (o.terms ? '<p>' + esc(o.terms) + '</p>' : '') +
        '<div class="mk-post-foot">' + inqCell('offer', o) + '<span class="rfp-sub">' + esc(C.when(o.at)) + '</span></div></div>';
    }).join('');
  }

  function reqListHTML(rows) {
    if (!rows.length) return '<p class="rfp-hint">등록된 요청이 없습니다.</p>';
    return rows.map(function (r) {
      return '<div class="mk-post"><div class="mk-post-top"><span class="mk-side dem">수요</span>' +
        '<b>' + esc(r.company || '') + '</b>' + badge(r.status || '요청', r.status === '매칭' ? 'ok' : 'flow') + '</div>' +
        '<em>' + esc([r.amount_eok ? n0(r.amount_eok) + '억' : '', r.equity_eok ? '에쿼티 ' + n0(r.equity_eok) + '억' : '', r.rate_range, r.term].filter(Boolean).join(' · ') || '조건 미입력') + '</em>' +
        (r.purpose || r.terms ? '<p>' + esc(r.purpose || r.terms) + '</p>' : '') +
        '<div class="mk-post-foot">' + inqCell('req', r) + '<span class="rfp-sub">' + esc(C.when(r.at)) + '</span></div></div>';
    }).join('');
  }

  function postCard(p) {
    return '<div class="mk-post"><div class="mk-post-top"><span class="mk-side ' + (p.side === '공급' ? 'sup' : 'dem') + '">' + esc(p.side) + '</span>' +
      '<b>' + esc(p.company) + '</b>' + badge(p.status || '게시', p.status === '매칭' || p.status === '진행' ? 'ok' : 'flow') + '</div>' +
      '<em>' + esc([p.region, p.deadline ? '마감 ' + p.deadline : ''].filter(Boolean).join(' · ')) + '</em>' +
      (p.terms ? '<p>' + esc(p.terms) + '</p>' : '') +
      '<div class="mk-post-foot">' + inqCell('post', p) + '<span class="rfp-sub">' + esc(C.when(p.at)) + '</span></div></div>';
  }

  /* 내 활동 — 올린 것 · 받은 문의 · 보낸 문의 */
  function myDeskHTML() {
    var me = meName();
    var staff = isStaff();
    if (!me && !staff) return '';
    var myOffers = offers('').filter(function (o) { return !me || String(o.lender_name) === me; });
    var myReqs = requests('').filter(function (r) { return !me || String(r.company) === me; });
    var myPosts = posts('').filter(function (p) { return !me || String(p.company) === me; });
    var received = [], sent = [];
    [['offer', offers('')], ['req', requests('')], ['post', posts('')]].forEach(function (pair) {
      var kind = pair[0];
      pair[1].forEach(function (rec) {
        inqs(rec).forEach(function (q) {
          var item = { kind: kind, rec: rec, q: q };
          var owner = (me && String(recOwner(kind, rec)) === me) || (!me && staff);
          if (owner) received.push(item);
          if (me && String(q.from_company) === me) sent.push(item);
        });
      });
    });
    var pend = received.filter(function (x) { return x.q.status === '문의' || x.q.status === '검토'; });
    var h = '<section class="rfp-panel"><div class="rfp-panel-head"><b>👤 내 활동</b>' +
      '<span>' + (me ? '내가 올린 ' : '전체 ') + '조건 ' + myOffers.length + ' · 요청 ' + myReqs.length + ' · 게시 ' + myPosts.length + '</span></div>';
    h += '<div class="rfp-kpis"><span class="rfp-kpi"><b>' + (myOffers.length + myReqs.length + myPosts.length) + '</b><em>' + (me ? '내가 올린 것' : '전체 올라온 것') + '</em></span>' +
      '<span class="rfp-kpi"><b>' + received.length + '</b><em>받은 문의</em></span>' +
      '<span class="rfp-kpi"><b>' + pend.length + '</b><em>응답 대기</em></span>' +
      '<span class="rfp-kpi"><b>' + sent.length + '</b><em>내가 보낸 문의</em></span></div>';
    if (received.length) {
      h += '<div class="rfp-table-wrap"><table class="rfp-table tiny"><thead><tr><th>받은 문의</th><th>대상</th><th>보낸 곳</th><th>메모</th><th>상태</th><th></th></tr></thead><tbody>';
      received.forEach(function (x) {
        h += '<tr><td>' + esc(C.when(x.q.at)) + '</td><td>' + esc(recLabel(x.kind, x.rec)) + '</td>' +
          '<td>' + esc(x.q.from_company || '-') + '<span class="rfp-sub">' + esc(x.q.from_contact || '') + '</span></td>' +
          '<td class="rfp-sub">' + esc(x.q.message || '') + '</td>' +
          '<td>' + badge(x.q.status || '문의', x.q.status === '수락' ? 'ok' : 'wait') + '</td>' +
          '<td class="dr-rowact">' + (x.q.status === '수락' || x.q.status === '거절' ? '-' :
            '<button type="button" class="mini-btn" data-fin-iqset="' + x.kind + '|' + esc(x.rec.id) + '|' + esc(x.q.id) + '|수락">수락</button>' +
            '<button type="button" class="mini-btn" data-fin-iqset="' + x.kind + '|' + esc(x.rec.id) + '|' + esc(x.q.id) + '|거절">거절</button>') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    } else {
      h += '<p class="rfp-hint">받은 문의가 없습니다. 올린 항목에 상대가 문의하면 여기에 표시됩니다.</p>';
    }
    h += '</section>';
    return h;
  }

  /* ───────────────────────── 모달 ───────────────────────── */
  function ownerDefault(cat) {
    var s = ss();
    if (s && s.holder) return s.holder;
    return '';
  }

  function offerModal(rfp, done, presetItem) {
    var lenders = C.list('lenders');
    var opts = lenders.map(function (l) { return { v: l.name, l: l.name + (l.status === '인증' ? ' (인증)' : '') }; });
    var body = '<div class="rfp-formgrid">' +
      C.field('product', '상품', presetItem || catOf(S.cat).items[0], 'select', { options: CATS[0].items }) +
      (opts.length ? C.field('lender_name', '금융기관', ownerDefault(), 'select', { options: opts }) : C.field('lender_name', '금융기관', ownerDefault(), 'text', { req: true })) +
      C.field('manager', '담당자', '', 'text') +
      C.field('amount_eok', '한도(억)', '', 'number', { step: '1' }) +
      C.field('rate', '금리', '', 'text', { ph: '예) 4.8% (3년 고정)' }) +
      C.field('ltv', 'LTV', '', 'text', { ph: '예) 60%' }) +
      C.field('tranche', '트랑슈', '', 'text', { ph: '예) 선순위/중순위' }) +
      C.field('tenor', '만기', '', 'text', { ph: '예) 3년 + 1년 연장' }) +
      C.field('region', '권역', '', 'text', { ph: '예) 수도권 / 서울 CBD' }) +
      C.field('contact', '연락 창구', '', 'text', { wide: true }) +
      C.field('terms', '선행요건·조건', '', 'textarea', { wide: true, rows: 3 }) +
      '</div>';
    var m = C.modal('대주 조건 등록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fin-save="offer">등록</button>'
    });
    m.querySelector('[data-fin-save="offer"]').addEventListener('click', function () {
      var name = C.fval(m, 'lender_name');
      if (!name) { C.toast('금융기관을 입력하세요.', true); return; }
      C.commit('fin_offers', {
        id: C.uid('fof'), rfp_id: rfp ? rfp.id : (S.rfpId || ''),
        product: C.fval(m, 'product'), lender_name: name, manager: C.fval(m, 'manager'),
        amount_eok: C.fval(m, 'amount_eok'), rate: C.fval(m, 'rate'), ltv: C.fval(m, 'ltv'),
        tranche: C.fval(m, 'tranche'), tenor: C.fval(m, 'tenor'), region: C.fval(m, 'region'),
        contact: C.fval(m, 'contact'), terms: C.fval(m, 'terms'),
        status: '제시', inquiries: [], at: new Date().toISOString(),
        by: (C.me() && C.me().name) || meName() || C.role()
      });
      C.closeModal(); if (done) done(); C.toast('대주 조건을 등록했습니다.');
    });
  }

  function reqModal(rfp, done, presetItem) {
    var ps = rfp ? C.participantsOf(rfp.id).filter(function (p) { return p.party_type !== '자문사'; }) : [];
    var opts = ps.map(function (p) { return { v: p.company, l: p.company + ' (' + p.party_type + ')' }; });
    var body = '<div class="rfp-formgrid">' +
      C.field('product', '상품', presetItem || catOf(S.cat).items[0], 'select', { options: CATS[0].items }) +
      (opts.length ? C.field('company', '요청자', ownerDefault(), 'select', { options: opts }) : C.field('company', '요청자(회사)', ownerDefault(), 'text', { req: true })) +
      C.field('amount_eok', '필요 금액(억)', '', 'number', { step: '1' }) +
      C.field('equity_eok', '에쿼티(억)', '', 'number', { step: '1' }) +
      C.field('rate_range', '희망 금리', '', 'text', { ph: '예) 4.5~5.0%' }) +
      C.field('term', '기간', '', 'text', { ph: '예) 3년' }) +
      C.field('collateral', '담보·대상', '', 'text', { ph: '예) 오피스 담보 / 개발부지' }) +
      C.field('region', '권역·섹터', '', 'text', { ph: '예) 서울 CBD 오피스' }) +
      C.field('contact', '연락 창구', '', 'text', { ph: '담당·전화·이메일' }) +
      C.field('purpose', '용도·조건', '', 'textarea', { wide: true, rows: 3 }) +
      '</div>';
    var m = C.modal('자금 요청 등록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fin-save="req">등록</button>'
    });
    m.querySelector('[data-fin-save="req"]').addEventListener('click', function () {
      C.commit('fin_requests', {
        id: C.uid('frq'), rfp_id: rfp ? rfp.id : (S.rfpId || ''),
        product: C.fval(m, 'product'), company: C.fval(m, 'company'),
        amount_eok: C.fval(m, 'amount_eok'), equity_eok: C.fval(m, 'equity_eok'),
        rate_range: C.fval(m, 'rate_range'), term: C.fval(m, 'term'), collateral: C.fval(m, 'collateral'),
        region: C.fval(m, 'region'), contact: C.fval(m, 'contact'), purpose: C.fval(m, 'purpose'),
        status: '요청', matches: [], inquiries: [], at: new Date().toISOString(),
        by: (C.me() && C.me().name) || meName() || C.role()
      });
      C.closeModal(); if (done) done(); C.toast('자금 요청을 등록했습니다.');
    });
  }

  function postModal(rfp, side, done, presetCat, presetItem) {
    var cat = catOf(presetCat || S.cat);
    var body = '<div class="rfp-formgrid">' +
      C.field('item', '품목', presetItem || cat.items[0], 'select', { options: cat.items }) +
      C.field('company', '회사', ownerDefault(), 'text', { req: true }) +
      C.field('region', '권역·대상', '', 'text') +
      C.field('deadline', '마감', '', 'date') +
      C.field('terms', '조건 요약', '', 'textarea', { wide: true, rows: 3, ph: '범위·규모·주기·보수 등' }) +
      C.field('contact', '담당·연락', '', 'text', { wide: true }) +
      (side === '수요'
        ? '<label class="mk-inboxopt"><input type="checkbox" data-mk-inbox checked> 접수 인박스에도 등록 — 관리자 검토·AI 매칭을 거쳐 회신</label>'
        : '') + '</div>';
    var m = C.modal(side === '공급' ? '＋ 공급 제안' : '＋ 수요 요청', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-mk-save="1">게시</button>'
    });
    m.querySelector('[data-mk-save]').addEventListener('click', function () {
      var co = C.fval(m, 'company');
      if (!co) { C.toast('회사를 입력하세요.', true); return; }
      var itemV = C.fval(m, 'item');
      var post = {
        id: C.uid('mkp'), rfp_id: rfp ? rfp.id : (S.rfpId || ''), rfp_title: rfp ? rfp.title : '',
        cat: cat.key, item: itemV, side: side, company: co,
        region: C.fval(m, 'region'), deadline: C.fval(m, 'deadline'), terms: C.fval(m, 'terms'),
        contact: C.fval(m, 'contact'), status: '게시', matches: [], inquiries: [],
        at: new Date().toISOString(), by: (C.me() && C.me().name) || meName() || C.role()
      };
      C.commit('market_posts', post);
      /* 수요 요청은 접수 인박스(lois)로도 보냅니다 — 같은 관리자 검토·AI 매칭 흐름을 타게 하기 위해서입니다.
         (별도 처리 없음 · 체크를 끄면 게시만 됩니다) */
      var inbox = m.querySelector('[data-mk-inbox]');
      var toInbox = !!(inbox && inbox.checked);
      C.closeModal(); if (done) done();
      if (toInbox && side === '수요') pushServiceRequest(post, cat);
      else C.toast('게시했습니다.');
    });
  }

  /** 매칭 마켓의 서비스 수요 → 접수 인박스(lois) 등록.
      별도 테이블을 만들지 않고 허브 접수(submit_request)와 같은 API·같은 검토 흐름을 씁니다. */
  function pushServiceRequest(post, cat) {
    var base = CFG.SYNC_URL;
    if (!base || !token()) { C.toast('게시했습니다. (접속 후에는 접수 인박스로도 등록됩니다)', true); return; }
    var tag = cat.key === 'fund' ? '금융' : '자문사딜';
    var title = '[' + tag + '] ' + cat.label.replace(/^[①-⑳]\s*/, '') + ' · ' + post.item;
    var memo = '[' + tag + '] 매칭 마켓 수요 — ' + cat.label + ' · ' + post.item +
      ' | 조건=' + (post.terms || '미정') + ' | 권역·대상=' + (post.region || '미지정') +
      (post.deadline ? ' | 희망시점=' + post.deadline : '') +
      ' | 접수경로=매칭 마켓(' + post.id + ')';
    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        token: token(), action: 'submit_request',
        request: {
          asset_id: 'MK-' + Date.now().toString(36),
          asset_name: title, request_type: tag, request_code: 'market',
          deal_type: '매입', price: '', area_py: '', rent: '', timeline: post.deadline || '',
          company: post.company, name: post.contact || '', title: '', phone: '', email: '',
          blind_name: '비공개 고객사', region: post.region || '', lat: '', lng: '',
          memo: memo
        }
      })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) C.toast('게시하고 접수 인박스에도 등록했습니다 — 관리자 검토 후 회신됩니다.');
      else C.toast('게시했습니다. (접수 인박스 등록은 실패: ' + ((j && j.error) || '오류') + ')', true);
    }).catch(function () { C.toast('게시했습니다. (접수 인박스 등록은 네트워크 오류)', true); });
  }

  /* 문의 보내기 */
  function inquireModal(kind, id, done) {
    var rec = recGet(kind, id);
    if (!rec) return;
    var s = ss() || {};
    var body = '<p class="rfp-note">' + esc(recLabel(kind, rec)) + '</p>' +
      '<div class="rfp-formgrid">' +
      C.field('from_company', '보내는 곳', s.holder || (isStaff() ? ((window.NAI_PLATFORM && window.NAI_PLATFORM.name) ? window.NAI_PLATFORM.name() : 'Open AI Asset Bridge') : ''), 'text', { req: true }) +
      C.field('from_contact', '담당·연락', (C.me() && C.me().name) || s.name || '', 'text') +
      C.field('message', '문의 내용', '', 'textarea', { wide: true, rows: 3, ph: '조건 확인·추가 요청·미팅 제안' }) +
      '</div>';
    var m = C.modal('문의 보내기', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-fin-save="inq">보내기</button>'
    });
    m.querySelector('[data-fin-save="inq"]').addEventListener('click', function () {
      var co = C.fval(m, 'from_company');
      if (!co) { C.toast('보내는 곳을 입력하세요.', true); return; }
      rec.inquiries = inqs(rec).concat([{
        id: C.uid('inq'), from_company: co, from_contact: C.fval(m, 'from_contact'),
        message: C.fval(m, 'message'), status: '문의', at: new Date().toISOString()
      }]);
      C.commit(recCol(kind), rec);
      C.closeModal(); if (done) done(); C.toast('문의를 보냈습니다. 상대 화면에 표시됩니다.');
    });
  }

  /* 받은 문의 — 수락/거절/진행 */
  function inquiryListModal(kind, id, done) {
    var rec = recGet(kind, id);
    if (!rec) return;
    var list = inqs(rec);
    var body = '<p class="rfp-note">' + esc(recLabel(kind, rec)) + ' — 문의 ' + list.length + '건</p>' +
      (list.length ? '<div class="rfp-table-wrap"><table class="rfp-table tiny"><thead><tr><th>일시</th><th>보낸 곳</th><th>문의</th><th>상태</th><th></th></tr></thead><tbody>' +
        list.map(function (q) {
          return '<tr><td>' + esc(C.when(q.at)) + '</td><td><b>' + esc(q.from_company || '') + '</b><span class="rfp-sub">' + esc(q.from_contact || '') + '</span></td>' +
            '<td class="rfp-sub">' + esc(q.message || '') + '</td>' +
            '<td>' + badge(q.status || '문의', q.status === '수락' ? 'ok' : (q.status === '거절' ? 'over' : 'wait')) + '</td>' +
            '<td class="dr-rowact"><button type="button" class="mini-btn" data-fin-iqset="' + kind + '|' + esc(rec.id) + '|' + esc(q.id) + '|수락">수락</button>' +
            '<button type="button" class="mini-btn" data-fin-iqset="' + kind + '|' + esc(rec.id) + '|' + esc(q.id) + '|거절">거절</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="rfp-hint">아직 문의가 없습니다.</p>');
    C.modal('받은 문의', body, { wide: true, footer: '<button type="button" class="btn btn-ghost" data-rfp="close">닫기</button>' });
  }

  function setInquiry(kind, id, iid, status) {
    var rec = recGet(kind, id);
    if (!rec) return;
    (rec.inquiries || []).forEach(function (q) { if (q.id === iid) { q.status = status; q.decided_at = new Date().toISOString(); } });
    if (status === '수락') rec.status = '매칭';
    C.commit(recCol(kind), rec);
    C.toast('문의를 ' + status + ' 처리했습니다.');
  }

  /* 기존 매칭 모달 (운영자) */
  function matchPostModal(postId, done) {
    var post = C.list('market_posts').filter(function (x) { return x.id === postId; })[0];
    if (!post) return;
    var others = posts(post.rfp_id, post.cat).filter(function (x) { return x.side !== post.side && x.item === post.item && x.id !== post.id; });
    var body = '<p class="rfp-note"><b>' + esc(post.company) + '</b> · ' + esc(post.item) + ' (' + esc(post.side) + ')</p>' +
      '<div class="rfp-advpick">' + (others.length ? others.map(function (o) {
        return '<label class="rfp-advrow"><input type="checkbox" name="mk" value="' + esc(o.id) + '">' +
          '<span><b>' + esc(o.company) + '</b><em>' + esc([o.side, o.region, o.terms].filter(Boolean).join(' · ')) + '</em></span></label>';
      }).join('') : '<p class="rfp-hint">같은 품목의 반대편 게시가 없습니다.</p>') + '</div>';
    var m = C.modal('매칭 — ' + post.item, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-mk-save="1">매칭</button>'
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
      C.closeModal(); if (done) done(); C.toast('매칭했습니다.');
    });
  }

  /* ───────────────────────── 이벤트 ───────────────────────── */
  function bind() {
    var host = document.getElementById('finView');
    if (!host || host.dataset.bound) return;
    host.dataset.bound = '1';
    host.addEventListener('click', function (e) {
      var md = e.target.closest('[data-fin-mode]');
      if (md) { S.mode = md.getAttribute('data-fin-mode'); paint(); return; }
      var lg = e.target.closest('[data-fin="login"]');
      if (lg) {
        var cb = document.getElementById('btnCodeChange');
        if (cb) cb.click(); else C.toast('상단 🔑 버튼으로 접속하세요.', true);
        return;
      }
      /* 품목 선택 */
      var it = e.target.closest('[data-fin-item]');
      if (it) {
        var pk = it.getAttribute('data-fin-item').split('|');
        S.cat = pk[0]; S.item = pk[1]; paint(); return;
      }
      /* 공급/수요 등록 */
      var ad = e.target.closest('[data-fin-add]');
      if (ad) {
        var parts = ad.getAttribute('data-fin-add').split('|');
        var rfp0 = S.rfpId ? C.rfpOf(S.rfpId) : null;
        S.cat = parts[0]; S.item = parts[1];
        if (parts[0] === 'fund') {
          if (parts[2] === '공급') offerModal(rfp0, paint, parts[1]); else reqModal(rfp0, paint, parts[1]);
        } else {
          postModal(rfp0, parts[2], paint, parts[0], parts[1]);
        }
        return;
      }
      /* 문의 */
      var iq = e.target.closest('[data-fin-inq]');
      if (iq) { var k1 = iq.getAttribute('data-fin-inq').split('|'); inquireModal(k1[0], k1[1], paint); return; }
      var il = e.target.closest('[data-fin-inql]');
      if (il) { var k2 = il.getAttribute('data-fin-inql').split('|'); inquiryListModal(k2[0], k2[1], paint); return; }
      var is1 = e.target.closest('[data-fin-iqset]');
      if (is1) { var k3 = is1.getAttribute('data-fin-iqset').split('|'); setInquiry(k3[0], k3[1], k3[2], k3[3]); paint(); return; }

      var b = e.target.closest('[data-fin]');
      if (!b) return;
      var act = b.getAttribute('data-fin');
      var rfp = S.rfpId ? C.rfpOf(S.rfpId) : null;
      if (act === 'reload') { paint(); return; }
      if (act === 'open-room') {
        if (!rfp) { C.toast('딜을 먼저 선택하세요.', true); return; }
        if (window.naiShowView) window.naiShowView('vdr');
        setTimeout(function () { if (window.NAI_VDR && window.NAI_VDR.openForRfp) window.NAI_VDR.openForRfp(rfp.id); }, 80);
        return;
      }
      if (act === 'offer-add') { offerModal(rfp, paint); return; }
      if (act === 'req-add') { reqModal(rfp, paint); return; }
      if (act === 'match') { matchPostModal(b.getAttribute('data-id'), paint); return; }
      if (act === 'hub') { if (window.NAI_HUB) window.NAI_HUB.open('finance'); return; }
    });
    host.addEventListener('change', function (e) {
      if (e.target.id === 'finRfp') { S.rfpId = e.target.value; paint(); }
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
