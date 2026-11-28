/* =========================================================================
   Open AI Asset Bridge — deals.js  (🧾 자문사 딜 보드 · 2026-11-28)
   -------------------------------------------------------------------------
   '🧾 자문사 딜' 탭의 첫 화면입니다. 딜 1건 = RFP 1건(+ VDR + 제출 폴더).

     · 카드: 단계(RFP 작성 → 배포 → 제안서 접수 → 비교평가 → 담당자 검토 → 선정
       → 자문 수행), 담당·마감·다음 할 일, 자문사/투자자 진행 요약
     · 카드를 누르면 그 물건의 VDR(딜 룸)이 열립니다.
     · 선정 이후에는 '자문 수행' 트랙(수행 단계·일정·산출물·보고·이슈)을 같은 카드에서 관리
     · 자문사 계정(승인 코드)은 자기가 선정된 딜만 봅니다. 평가·굿/숏리스트는 운영자 전용.
   ========================================================================= */
(function () {
  'use strict';

  var C = window.NAI_RFPC;
  if (!C) return;
  var esc = C.esc, n0 = C.n0;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = { stage: 'ALL', q: '', unverified: false, view: 'board' };

  function me() { return (window.naiMap && window.naiMap.me) ? window.naiMap.me() : null; }
  function isStaff() {
    var r = C.role();
    return r === 'admin' || r === 'internal';
  }
  function ss() { return C.session(); }
  function isAdvisor() { var s = ss(); return !!(s && s.holder_type === '자문사'); }
  function isInvestor() { var s = ss(); return !!(s && (s.holder_type === '투자자' || s.holder_type === '매수자' || s.holder_type === '금융기관')); }

  /* 볼 수 있는 딜 — 권한은 이 함수 한 곳에서만 판단 */
  function deals() {
    var all = C.list('rfps').slice();
    var s = ss();
    if (s && s.holder_type === '자문사') {
      all = all.filter(function (r) {
        if (String(r.selected_advisor_id || '') === String(s.holder_id || '')) return true;
        return (r.invites || []).some(function (i) { return String(i.advisor_id) === String(s.holder_id || ''); });
      });
    } else if (s && s.holder_type) {
      all = all.filter(function (r) { return String(r.id) === String(s.rfp_id || ''); });
    } else if (!isStaff()) {
      return [];
    }
    return all.sort(function (a, b) { return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')); });
  }

  function boardStage(rfp) {
    var st = C.flowOf(rfp);
    if (st === '초안') return 'RFP 작성';
    if (st === '배포') return '배포';
    if (st === '접수') return '제안서 접수';
    if (st === '분석') return '비교평가';
    if (st === '담당자 검토') return '담당자 검토';
    if (st === '외부 보고') return '외부 보고';
    var perf = C.perfOf(rfp.id);
    return perf && perf.stage === '종결' ? '수행 완료' : '자문 수행';
  }
  var STAGE_ORDER = ['RFP 작성', '배포', '제안서 접수', '비교평가', '담당자 검토', '외부 보고', '자문 수행', '수행 완료'];

  function cardData(rfp) {
    var s = C.dealStats(rfp);
    var loc = C.locOf(rfp.asset_id);
    var perf = s.perf || C.perfOf(rfp.id);
    var loiN = s.loi.filter(function (x) { return !!x.bid; }).length;
    var locN = s.loi.filter(function (x) { return x.submit ? false : true; }).length;
    var investorN = C.participantsOf(rfp.id).filter(function (p) { return p.party_type !== '자문사'; }).length;
    return {
      rfp: rfp, stage: boardStage(rfp), s: s, loc: loc, perf: perf,
      invited: s.invited, submitted: s.submitted, ca: s.ca, parties: s.parties,
      loiN: s.loi.filter(function (x) { return x.submit && x.submit.kinds['LOI']; }).length,
      locN: s.loi.filter(function (x) { return x.submit && x.submit.kinds['LOC']; }).length,
      investorN: investorN, next: C.nextActionOf(rfp),
      dleft: s.dleft, selected: s.selected
    };
  }

  function filtered() {
    var q = S.q.toLowerCase();
    return deals().map(cardData).filter(function (d) {
      if (S.stage !== 'ALL' && d.stage !== S.stage) return false;
      if (S.unverified && d.loc.verified) return false;
      if (!q) return true;
      return [d.rfp.title, d.rfp.asset_name, d.rfp.client, d.loc.address, d.rfp.owner].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function stageCounts() {
    var c = {};
    deals().forEach(function (r) { var st = boardStage(r); c[st] = (c[st] || 0) + 1; });
    return c;
  }

  function cardHTML(d) {
    var rfp = d.rfp, loc = d.loc;
    var perf = d.perf;
    var day = d.dleft === null ? '마감 미정' : (d.dleft < 0 ? '마감 지남' : 'D-' + d.dleft);
    var h = '<div class="deal-card" data-deal-open="' + esc(rfp.id) + '">' +
      '<div class="deal-card-top"><span class="deal-stage s-' + esc(d.stage.replace(/\s/g, '')) + '">' + esc(d.stage) + '</span>' +
      (loc.verified ? '<span class="deal-locchk ok">위치 확인</span>' : '<span class="deal-locchk">좌표 ' + (loc.lat ? '확인' : '미확인') + ' · 위치 미확인</span>') +
      '<span class="deal-due' + (d.dleft !== null && d.dleft < 0 ? ' over' : (d.dleft !== null && d.dleft <= 3 ? ' soon' : '')) + '">' + esc(day) + '</span></div>' +
      '<strong class="deal-title">' + esc(rfp.title) + '</strong>' +
      '<p class="deal-meta">' + esc([rfp.asset_name, rfp.scale_info, loc.region, loc.address].filter(Boolean).join(' · ')) + '</p>' +
      '<div class="deal-tracks">' +
      '<span class="deal-track"><b>자문사</b> 초청 ' + d.invited + ' · CA ' + d.ca + ' · 제출 ' + d.submitted + (d.selected ? ' · <em>선정 ' + esc(d.selected.company) + '</em>' : '') + '</span>' +
      '<span class="deal-track"><b>투자자</b> 참여 ' + d.investorN + ' · LOI ' + d.loiN + ' · LOC ' + d.locN + '</span>' +
      (perf ? '<span class="deal-track"><b>수행</b> ' + esc(perf.stage) + ' · 산출물 ' + ((perf.deliverables || []).length) + '건</span>' : '') +
      '</div>' +
      '<p class="deal-next"><b>다음 할 일</b> ' + esc(d.next) + ' · 담당 ' + esc(rfp.owner || '미지정') + '</p>' +
      '<div class="deal-acts">' +
      '<button type="button" class="mini-btn" data-deal="vdr" data-id="' + esc(rfp.id) + '">🏢 딜 룸(VDR)</button>' +
      '<button type="button" class="mini-btn" data-deal="folder" data-id="' + esc(rfp.id) + '">📁 제출 폴더</button>' +
      (isStaff() ? '<button type="button" class="mini-btn" data-deal="perf" data-id="' + esc(rfp.id) + '">📈 수행 현황</button>' : '') +
      '</div></div>';
    return h;
  }

  function paint(host) {
    if (!host) return;
    if (S.view === 'checks') { host.innerHTML = checksPanel(); if (!host.dataset.bound) { host.dataset.bound = '1'; bind(host); } return; }
    var rows = filtered();
    var c = stageCounts();
    var total = deals().length;
    var h = '<div class="deal-board"><div class="deal-board-head"><div><h3>🧾 자문사 딜 현황</h3>' +
      '<p>딜 1건 = RFP + VDR(딜 룸) + 제출 폴더. 카드를 누르면 그 물건의 딜 룸이 열립니다.' +
      (isAdvisor() ? ' <b>내가 선정·초청된 딜만</b> 표시됩니다.' : (isInvestor() ? ' <b>내가 참여한 딜만</b> 표시됩니다.' : '')) + '</p></div>' +
      '<div class="deal-board-tools">' +
      '<span class="rfp-rfpchips"><button type="button" class="rfp-chip' + (S.view === 'board' ? ' on' : '') + '" data-deal-view="board">🧾 딜 보드</button>' +
      '<button type="button" class="rfp-chip' + (S.view === 'checks' ? ' on' : '') + '" data-deal-view="checks">✅ 자문사 진위 현황</button></span>' +
      '<input id="dealQ" type="search" placeholder="딜 · 물건 · 주소 · 담당 검색" autocomplete="off">' +
      '<label class="deal-check"><input type="checkbox" id="dealUnverified"' + (S.unverified ? ' checked' : '') + '> 위치 미확인만</label>' +
      (isStaff() ? '<button type="button" class="mini-btn" data-deal="new-rfp">＋ 새 딜(RFP)</button>' : '') +
      '</div></div>' +
      '<div class="deal-stages"><button type="button" class="deal-schip' + (S.stage === 'ALL' ? ' on' : '') + '" data-deal-stage="ALL">전체 ' + total + '</button>' +
      STAGE_ORDER.map(function (st) {
        return '<button type="button" class="deal-schip' + (S.stage === st ? ' on' : '') + '" data-deal-stage="' + esc(st) + '">' + esc(st) + ' ' + (c[st] || 0) + '</button>';
      }).join('') + '</div>';
    h += rows.length ? '<div class="deal-grid">' + rows.map(cardHTML).join('') + '</div>'
      : '<div class="dr-empty"><b>' + (isStaff() ? '아직 딜이 없습니다.' : '참여 중인 딜이 없습니다.') + '</b>' +
      (isStaff() ? '<p>📑 RFP에서 물건을 불러와 RFP를 만들면 이 보드에 딜 카드가 생깁니다.</p><button type="button" class="btn btn-primary" data-deal="new-rfp">＋ 새 딜(RFP)</button>' : '<p>담당자에게 초청·선정 여부를 문의하세요.</p>') + '</div>';
    h += '</div>';
    host.innerHTML = h;
    if (!host.dataset.bound) { host.dataset.bound = '1'; bind(host); }
  }

  function bind(host) {
    host.addEventListener('click', function (e) {
      var vw = e.target.closest('[data-deal-view]');
      if (vw) { S.view = vw.getAttribute('data-deal-view'); paint(host); return; }
      var st = e.target.closest('[data-deal-stage]');
      if (st) { S.stage = st.getAttribute('data-deal-stage'); paint(host); return; }
      var ck = e.target.closest('[data-ck]');
      if (ck) {
        var a = ck.getAttribute('data-ck');
        if (a === 'add') { checkModal(null, host); return; }
        if (a === 'open') { checkModal(ck.getAttribute('data-id'), host); return; }
        if (a === 'bulk') { bulkModal(host); return; }
        if (a === 'seed') { seedFive(); paint(host); return; }
        if (a === 'scan') { C.toast('명단 원천(컨택·배포 자문사·파트너) 대조: ' + missingFromSources().length + '곳이 대장에 없습니다.'); paint(host); return; }
        if (a === 'pick') { var nm = ck.getAttribute('data-name'); checkModal(null, host, { company: nm }); return; }
        return;
      }
      var b = e.target.closest('[data-deal]');
      if (b) {
        var act = b.getAttribute('data-deal'), id = b.getAttribute('data-id');
        if (act === 'vdr') { openVdr(id); return; }
        if (act === 'folder') { if (window.NAI_RFP_OPEN) { window.NAI_RFP_OPEN(null, 'folder', id); } return; }
        if (act === 'perf') { openPerf(id); return; }
        if (act === 'new-rfp') { if (window.naiShowView) { window.naiShowView('rfp'); } setTimeout(function () { if (window.NAI_RFP && window.NAI_RFP.openAssetPicker) window.NAI_RFP.openAssetPicker(); }, 60); return; }
        return;
      }
      var card = e.target.closest('[data-deal-open]');
      if (card && !e.target.closest('.deal-acts')) { openVdr(card.getAttribute('data-deal-open')); return; }
    }, false);
    host.addEventListener('input', function (e) {
      if (e.target.id === 'dealQ') { S.q = e.target.value; paint(host); }
      if (e.target.id === 'dealUnverified') { S.unverified = e.target.checked; paint(host); }
    });
    host.addEventListener('change', function (e) {
      if (e.target.id === 'dealUnverified') { S.unverified = e.target.checked; paint(host); }
    });
  }

  function openVdr(rfpId) {
    if (window.NAI_VDR && window.NAI_VDR.openForRfp) { window.naiShowView('vdr'); window.NAI_VDR.openForRfp(rfpId); }
    else C.toast('VDR 화면을 불러오지 못했습니다.', true);
  }

  /* ── 자문 수행 현황 ── */
  function openPerf(rfpId) {
    var rfp = C.rfpOf(rfpId);
    if (!rfp) return;
    var perf = C.perfOf(rfpId);
    if (!perf && !isStaff()) { C.toast('수행 현황은 선정 이후 열립니다.', true); return; }
    perf = perf || C.ensurePerf(rfp);
    renderPerf(rfp, perf);
  }

  function renderPerf(rfp, perf) {
    var i = C.PERF_STAGES.indexOf(perf.stage);
    var body = '<div class="rfp-flowbar"><div class="rfp-flowbar-main"><b>' + esc(rfp.title) + '</b> · ' + esc(perf.company || '') +
      ' · <b>' + esc(perf.stage) + '</b></div><div class="rfp-flowbar-act">' +
      '<button type="button" class="mini-btn" data-pf="next">다음 단계 →</button>' +
      '<button type="button" class="mini-btn" data-pf="close">수행 종료</button></div></div>' +
      '<div class="rfp-fsteps">' + C.PERF_STAGES.map(function (st, k) {
        return '<span class="rfp-fstep' + (k < i ? ' done' : (k === i ? ' on' : '')) + '"><i>' + (k + 1) + '</i>' + esc(st) + '</span>';
      }).join('<span class="rfp-farrow">›</span>') + '</div>';

    body += '<div class="dr-subgrid">';
    body += '<div class="dr-sub wide"><b>🗓 일정·마일스톤</b><div class="dr-miles">' +
      (perf.milestones || []).map(function (m, k) {
        return '<span class="dr-mile' + (m.done_at ? ' done' : '') + '"><b>' + esc(m.name) + '</b><em>' + esc(m.due || '') + '</em>' +
          '<button type="button" class="mini-btn" data-pf-mile="' + k + '">' + (m.done_at ? '완료 취소' : '완료') + '</button></span>';
      }).join('') + '</div></div>';
    body += '<div class="dr-sub wide"><b>📦 산출물 (' + (perf.deliverables || []).length + ')</b>' +
      '<button type="button" class="mini-btn" data-pf="deliver">＋ 산출물 제출</button>' +
      '<ul class="dr-deliv">' + (((perf.deliverables || []).map(function (d) {
        return '<li><b>' + esc(d.name) + '</b><em>v' + (d.version || 1) + ' · ' + esc(C.when(d.at)) + ' · ' + esc(d.by || '') + '</em>' +
          ((d.files || []).length ? '<span class="dr-tools">' + d.files.map(function (f, fi) {
            return '<button type="button" class="mini-btn" data-pf-dl="' + esc(d.id) + '|' + fi + '">⬇ ' + esc(f.name) + '</button>';
          }).join('') + '</span>' : '') + '</li>';
      }).join('')) || '<li class="empty">제출된 산출물이 없습니다.</li>') + '</ul></div>';
    body += '<div class="dr-sub wide"><b>🗒 진행 보고·이슈</b><button type="button" class="mini-btn" data-pf="report">＋ 보고</button> ' +
      '<button type="button" class="mini-btn" data-pf="issue">＋ 이슈</button>' +
      '<ul class="dr-deliv">' + (perf.reports || []).slice(-5).map(function (r) {
        return '<li><b>보고</b><em>' + esc(C.when(r.at)) + ' · ' + esc(r.note || '') + '</em></li>';
      }).join('') +
      (perf.issues || []).map(function (x, k) {
        return '<li><b>이슈 — ' + esc(x.title) + '</b><em>' + esc(C.when(x.at)) + ' · ' + esc(x.status || '진행') + ' · ' + esc(x.note || '') + '</em>' +
          (x.status !== '완료' ? '<button type="button" class="mini-btn" data-pf-issue-done="' + k + '">완료</button>' : '') + '</li>';
      }).join('') + '</ul></div>';
    body += '</div>';
    var m = C.modal('📈 자문 수행 현황 — ' + rfp.title, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">닫기</button>' +
        '<button type="button" class="btn btn-primary" data-pf="save">저장</button>'
    });
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pf]');
      if (b) {
        var act = b.getAttribute('data-pf');
        if (act === 'next') {
          var k = C.PERF_STAGES.indexOf(perf.stage);
          if (k < C.PERF_STAGES.length - 1) { C.setPerfStage(rfp, C.PERF_STAGES[k + 1]); C.closeModal(); openPerf(rfp.id); }
          return;
        }
        if (act === 'close') { C.setPerfStage(rfp, '종결'); C.closeModal(); openPerf(rfp.id); return; }
        if (act === 'deliver') { perfDeliver(rfp, perf, m); return; }
        if (act === 'report') {
          perf.reports = (perf.reports || []).concat([{ at: new Date().toISOString(), note: '진행 보고', by: (me() && me().name) || '' }]);
          C.commit('performance', perf); C.closeModal(); openPerf(rfp.id); return;
        }
        if (act === 'issue') {
          perf.issues = (perf.issues || []).concat([{ at: new Date().toISOString(), title: '이슈', note: '', status: '진행' }]);
          C.commit('performance', perf); C.closeModal(); openPerf(rfp.id); return;
        }
        if (act === 'save') { C.commit('performance', perf); C.closeModal(); C.toast('수행 현황을 저장했습니다.'); return; }
      }
      var mi = e.target.closest('[data-pf-mile]');
      if (mi) {
        var idx = Number(mi.getAttribute('data-pf-mile'));
        var ml = perf.milestones[idx];
        ml.done_at = ml.done_at ? '' : new Date().toISOString();
        C.commit('performance', perf); C.closeModal(); openPerf(rfp.id); return;
      }
      var iss = e.target.closest('[data-pf-issue-done]');
      if (iss) {
        perf.issues[Number(iss.getAttribute('data-pf-issue-done'))].status = '완료';
        C.commit('performance', perf); C.closeModal(); openPerf(rfp.id); return;
      }
      var dl = e.target.closest('[data-pf-dl]');
      if (dl) {
        var q = dl.getAttribute('data-pf-dl').split('|');
        var dd = (perf.deliverables || []).filter(function (x) { return x.id === q[0]; })[0];
        if (dd && dd.files && dd.files[Number(q[1])]) C.downloadFile(dd.files[Number(q[1])]);
        return;
      }
    });
  }

  function perfDeliver(rfp, perf, parent) {
    var body = C.field('name', '산출물 이름', '', 'text', { wide: true, ph: '예) 마케팅 리스트 v1' }) +
      C.field('note', '비고', '', 'text', { wide: true });
    var m = C.modal('산출물 제출', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-pf-save="1">파일 선택 후 등록</button>'
    });
    m.querySelector('[data-pf-save]').addEventListener('click', function () {
      var nm = C.fval(m, 'name');
      if (!nm) { C.toast('이름을 입력하세요.', true); return; }
      C.pickFiles(true).then(function (list) {
        if (!list || !list.length) { C.toast('파일을 선택하세요.', true); return; }
        Promise.all(list.map(function (f) {
          return C.readFile(f).then(function (r) { return { name: r.name, size: r.size, mime: r.mime, dataUrl: r.dataUrl || '', text: r.text || '' }; })
            .catch(function () { return { name: f.name, size: f.size }; });
        })).then(function (items) {
          var dls = perf.deliverables || [];
          var same = dls.filter(function (d) { return d.name === nm; })[0];
          if (same) { same.version = (same.version || 1) + 1; same.files = items; same.at = new Date().toISOString(); }
          else dls.push({ id: C.uid('del'), name: nm, version: 1, files: items, note: C.fval(m, 'note'), at: new Date().toISOString(), by: (me() && me().name) || '' });
          perf.deliverables = dls;
          C.commit('performance', perf);
          C.closeModal(); if (parent) C.closeModal();
          openPerf(rfp.id); C.toast('산출물을 등록했습니다.');
        });
      });
    });
  }

  /* ═══════════ 자문사 진위 현황 (금융기관 대장과 같은 구조·운영자 판정) ═══════════ */
  var CK_STATUS = ['미등록', '진행', '인증완료', '반려', '재확인 필요'];
  var CK_TYPES = ['회계', '감정', '기술', '법률', 'AMC', '중개·자문', '기타'];
  var ADD_LIST = [
    { company: '부동산플래닛', aliases: ['부동산플랜', 'realtyplanet', '부동산플래닛'], type: '중개·자문',
      ceo: '정수민·엄현포(각자대표)', biz_no: '', address: '', note: '㈜부동산플래닛 · 영문 RealtyPlanet · 종합 부동산 데이터 플랫폼 + 상업용 자문(주유소·개발부지·물류·DC·리테일·메디컬). 사업자번호·주소 미확인', source: '준오님 확인(2026-11-28)' },
    { company: '에이커트리', aliases: ['에이커트리', 'acretree'], type: '중개·자문',
      ceo: '조상민·고형준', biz_no: '218-88-00818', address: '서울 영등포구 국제금융로 10, 14층(여의도동, 투아이에프씨)',
      note: '주식회사 에이커트리(ACRETree Co., Ltd.) · 법인번호 110111-6460747 · 부동산 투자자문업(68222) · 설립 2017-07-13 · PM·LM·리테일·매입매각 컨설팅', source: '준오님 제공(2026-11-28)' },
    { company: '뉴마크', aliases: ['뉴마크', 'newmark'], type: '중개·자문',
      ceo: '', biz_no: '', address: '', note: '뉴마크(Newmark) — 글로벌 자문사 국내 법인. 국내 법인명·사업자번호 미확인(추측 입력 금지)', source: '준오님 지시(2026-11-28)' }
  ];
  var ALIAS = { 'newmark': '뉴마크', '뉴마크코리아': '뉴마크', '부동산플랜': '부동산플래닛', '부동산플래닛': '부동산플래닛', 'realtyplanet': '부동산플래닛', '에이커트리': '에이커트리', 'acretree': '에이커트리' };
  function normCo(n) {
    var t = String(n || '').toLowerCase().replace(/\s+/g, '').replace(/㈜|\(주\)|주식회사|유한회사/g, '');
    return ALIAS[t] || t;
  }
  function inLedger(name) {
    var k = normCo(name);
    return checks().some(function (x) { return normCo(x.company) === k; });
  }

  function checks() { return C.list('advisor_checks').slice(); }
  function checkOf(id) { return checks().filter(function (x) { return x.id === id; })[0] || null; }
  function seedFive() {
    var n = 0, skipped = [];
    ADD_LIST.forEach(function (co) {
      if (inLedger(co.company) || (co.aliases || []).some(function (a) { return inLedger(a); })) { skipped.push(co.company); return; }
      C.commit('advisor_checks', {
        id: C.uid('ck'), company: co.company, type: co.type || '', ceo: co.ceo || '', biz_no: co.biz_no || '',
        address: co.address || '', manager: '', email: '', status: '미등록',
        step1: '', step2: '', step3: '', note: co.note || '', source: co.source || '', at: new Date().toISOString()
      });
      n++;
    });
    C.toast(n + '곳을 미등록으로 추가했습니다(값은 비움).' + (skipped.length ? ' 이미 있어 건너뜀: ' + skipped.join(', ') : ''));
  }
  /* 명단 원천 — 컨택 대장 · 배포된 자문사 · config 파트너 */
  function sourceNames() {
    var out = {};
    C.list('advisor_contacts').forEach(function (c) { if (c.company) out[c.company] = '자문사 컨택'; });
    C.list('advisors').forEach(function (a) { if (a.company) out[a.company] = '배포 자문사'; });
    var p = (window.NAI_MAP_CONFIG && window.NAI_MAP_CONFIG.PARTNERS) || [];
    p.forEach(function (x) { if (x.org) out[x.org] = 'config 파트너'; });
    return out;
  }
  function missingFromSources() {
    var src = sourceNames(), out = [];
    Object.keys(src).forEach(function (n) { if (!inLedger(n)) out.push({ company: n, source: src[n] }); });
    return out;
  }
  function recheckDays(x) {
    if (!x.verified_at) return null;
    var d = new Date(x.verified_at); if (isNaN(d)) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  function checksPanel() {
    var rows = checks();
    var missing = missingFromSources();
    var by = { '인증완료': 0, '진행': 0, '미등록': 0, '반려': 0, '재확인 필요': 0 };
    rows.forEach(function (x) { by[x.status] = (by[x.status] || 0) + 1; });
    var h = '<div class="deal-board"><div class="deal-board-head"><div><h3>✅ 자문사 진위 현황</h3>' +
      '<p>금융기관 실체 진위확인과 같은 대장 구조입니다. 판정은 운영자(NAI)만 하며, 참여자는 자기 상태만 봅니다. ' +
      '확인일이 12개월을 넘으면 재확인 대상입니다.</p></div>' +
      '<div class="deal-board-tools">' +
      '<button type="button" class="mini-btn" data-ck="seed">＋ 누락 자문사 추가(부동산플랜·에이커트리·뉴마크)</button>' +
      '<button type="button" class="mini-btn" data-ck="bulk">📋 일괄 붙여넣기</button>' +
      '<button type="button" class="mini-btn" data-ck="add">＋ 자문사 등록</button>' +
      '<button type="button" class="mini-btn" data-ck="scan">🔍 명단 원천 대조</button>' +
      '<button type="button" class="mini-btn" data-deal-view="board">← 딜 보드</button></div></div>';
    h += '<div class="rfp-kpis"><span class="rfp-kpi"><b>' + rows.length + '</b><em>대장</em></span>' +
      Object.keys(by).map(function (k) { return '<span class="rfp-kpi"><b>' + by[k] + '</b><em>' + k + '</em></span>'; }).join('') +
      '<span class="rfp-kpi"><b>' + missing.length + '</b><em>원천에만 있음</em></span></div>';
    if (missing.length) {
      h += '<div class="rfp-draftbanner"><b>명단 원천에 있지만 대장에 없는 곳 ' + missing.length + '곳</b> — ' +
        missing.slice(0, 12).map(function (m) {
          return '<button type="button" class="mini-btn" data-ck="pick" data-name="' + esc(m.company) + '">＋ ' + esc(m.company) + ' <em>(' + esc(m.source) + ')</em></button>';
        }).join(' ') + '</div>';
    }
    h += '<div class="rfp-table-wrap"><table class="rfp-table small"><thead><tr><th>회사</th><th>유형</th><th>사업자번호</th><th>대표자</th><th>담당·이메일</th><th>상태</th><th>확인일</th><th>근거</th><th></th></tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="9" class="rfp-hint">대장이 비어 있습니다. 「미등록 5곳 추가」로 시작하세요.</td></tr>';
    rows.sort(function (a, b) {
      var oa = a.status === '인증완료' ? (recheckDays(a) || 0) : 9999;
      var ob = b.status === '인증완료' ? (recheckDays(b) || 0) : 9999;
      return ob - oa;
    }).forEach(function (x) {
      var d = recheckDays(x);
      var old = x.status === '인증완료' && d !== null && d > 365;
      h += '<tr><td><b>' + esc(x.company) + '</b><span class="rfp-sub">' + esc(x.source || '') + '</span></td>' +
        '<td>' + esc(x.type || '미확인') + '</td>' +
        '<td>' + esc(x.biz_no || '미확인') + '</td><td>' + esc(x.ceo || '미확인') + '</td>' +
        '<td class="rfp-sub">' + esc([x.manager, x.email].filter(Boolean).join(' · ') || '미확인') + '</td>' +
        '<td>' + '<span class="rfp-tag ' + (x.status === '인증완료' ? 'ok' : (x.status === '반려' ? 'over' : 'wait')) + '">' + esc(x.status || '미등록') + '</span>' +
        (old ? ' <span class="rfp-tag over">재확인</span>' : '') + '</td>' +
        '<td>' + esc((x.verified_at || '').slice(0, 10) || '-') + '</td>' +
        '<td class="rfp-sub">' + esc([x.step1, x.step2, x.step3].filter(Boolean).join(' / ') || '-') + '</td>' +
        '<td><button type="button" class="mini-btn" data-ck="open" data-id="' + esc(x.id) + '">확인</button></td></tr>';
    });
    h += '</tbody></table></div>' +
      '<p class="rfp-hint">검증 3단계: ① 제도권 조회(협회·등록부) ② 사업자등록·법인등기 대조 ③ 업무 도메인·대표번호 콜백. ' +
      '판정·근거는 운영자만 기록합니다.</p></div>';
    return h;
  }
  function checkModal(id, host, prefill) {
    var x = id ? checkOf(id) : null;
    var v = x || prefill || {};
    var body = '<p class="rfp-note">자문사 등록 정보와 진위확인 기록입니다. 모르는 값은 비워 두고 「미확인」으로 표시합니다(추측 입력 금지).</p>' +
      '<div class="rfp-formgrid">' +
      C.field('company', '회사명', v.company || '', 'text', { req: true }) +
      C.field('type', '유형', v.type || '', 'select', { options: [''].concat(CK_TYPES) }) +
      C.field('ceo', '대표자', v.ceo || '', 'text') +
      C.field('biz_no', '사업자등록번호', v.biz_no || '', 'text') +
      C.field('address', '사업장 주소', v.address || '', 'text', { wide: true }) +
      C.field('manager', '담당자', v.manager || '', 'text') +
      C.field('email', '업무 이메일', v.email || '', 'email') +
      C.field('status', '상태', v.status || '미등록', 'select', { options: CK_STATUS }) +
      C.field('verified_at', '확인일', (v.verified_at || '').slice(0, 10), 'date') +
      C.field('step1', '① 제도권 조회', v.step1 || '', 'text', { wide: true, ph: '예) 한국감정평가사협회 회원 조회 — 확인' }) +
      C.field('step2', '② 사업자·등기 대조', v.step2 || '', 'text', { wide: true }) +
      C.field('step3', '③ 도메인·콜백', v.step3 || '', 'text', { wide: true }) +
      C.field('note', '비고', v.note || '', 'text', { wide: true }) +
      '</div>';
    var m = C.modal(id ? '자문사 진위 확인 — ' + esc(x.company) : '＋ 자문사 등록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">닫기</button>' +
        '<button type="button" class="btn btn-primary" data-ck-save="1">저장</button>'
    });
    m.querySelector('[data-ck-save]').addEventListener('click', function () {
      var co = C.fval(m, 'company');
      if (!co) { C.toast('회사명을 입력하세요.', true); return; }
      var rec = x || { id: C.uid('ck'), at: new Date().toISOString(), source: '수기 등록' };
      Object.assign(rec, {
        company: co, type: C.fval(m, 'type'), ceo: C.fval(m, 'ceo'), biz_no: C.fval(m, 'biz_no'),
        address: C.fval(m, 'address'), manager: C.fval(m, 'manager'), email: C.fval(m, 'email'),
        status: C.fval(m, 'status') || '미등록', verified_at: C.fval(m, 'verified_at'),
        step1: C.fval(m, 'step1'), step2: C.fval(m, 'step2'), step3: C.fval(m, 'step3'),
        note: C.fval(m, 'note'), by: (me() && me().name) || C.role(), updated_at: new Date().toISOString()
      });
      C.commit('advisor_checks', rec);
      C.closeModal(); paint(host); C.toast('자문사 대장을 저장했습니다.');
    });
  }
  function bulkModal(host) {
    var body = '<p class="rfp-note">자문사 목록을 한 번에 붙여넣습니다. 한 줄에 하나, <b>회사명,유형,담당자,이메일</b> 순(뒤 항목은 생략 가능).</p>' +
      '<textarea class="rfp-paste" rows="8" placeholder="회사명,유형,담당자,이메일"></textarea>';
    var m = C.modal('자문사 명단 일괄 붙여넣기', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-ck-save="1">등록</button>'
    });
    m.querySelector('[data-ck-save]').addEventListener('click', function () {
      var ta = m.querySelector('textarea');
      var rows = String(ta && ta.value || '').split(/\n+/).map(function (l) { return l.split(',').map(function (x) { return x.trim(); }); }).filter(function (r) { return r[0]; });
      var n = 0;
      rows.forEach(function (r) {
        if (inLedger(r[0])) return;
        C.commit('advisor_checks', { id: C.uid('ck'), company: r[0], type: r[1] || '', manager: r[2] || '', email: r[3] || '', status: '미등록', source: '일괄 붙여넣기', at: new Date().toISOString() });
        n++;
      });
      C.closeModal(); paint(host); C.toast(n + '곳을 등록했습니다.');
    });
  }

  /* 🧾 자문사 딜 화면 상단에 딜 보드를 붙입니다(기존 자문사 동향 보드는 그대로). */
  function mount(host) {
    if (!host) return;
    var box = host.querySelector('#advDeals');
    if (!box) {
      box = document.createElement('div');
      box.id = 'advDeals';
      box.className = 'adv-deals';
      host.insertBefore(box, host.firstChild);
    }
    paint(box);
  }

  window.NAI_DEALS = {
    mount: mount,
    paint: paint,
    openPerf: openPerf,
    deals: deals,
    stageOf: boardStage
  };
})();
