/* =========================================================================
   Open AI Asset Bridge — services.js  (📋 PM·FM·보험 용역 진행 현황, 2026-11-28)
   -------------------------------------------------------------------------
   PM·FM·보험·법정점검 용역의 '진행'을 보는 화면입니다. 파일 보관함(pm 자료)과 다릅니다.

     · 물건별·용역사별 계약 상태(제안/선정/계약/수행중/종료)·계약기간·담당
     · 월간 리포트 수신 여부(최근 수신월) — 2개월 이상 미수신은 목록에서 바로 필터
     · 요구 산출물 제출 현황 · 이슈·클레임 · 다음 할 일·마감
     · 매칭 마켓(수요 요청 ↔ 공급 제안) → 매칭·선정 → 이 진행 현황으로 이어짐

   데이터: services(새 컬렉션) + 기존 pm 자료(docs kind='pm', 파일 연결)
   관리자(NAI)는 전체, 용역사는 자기 계약 건만 봅니다.
   ========================================================================= */
(function () {
  'use strict';

  var C = window.NAI_RFPC;
  if (!C) return;
  var esc = C.esc, n0 = C.n0;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var CATS = ['PM', 'FM', '보험', '법정점검'];
  var ST = ['제안', '선정', '계약', '수행중', '종료'];
  var S = { cat: 'ALL', status: 'ALL', overdue: false, q: '' };

  function ss() { return C.session(); }
  function isStaff() { var r = C.role(); return r === 'admin' || r === 'internal'; }
  function badge(t, c) { return '<span class="rfp-tag ' + (c || '') + '">' + esc(t) + '</span>'; }

  function all() { return C.list('services').slice(); }
  function mine() {
    var s = ss();
    var rows = all();
    if (s && s.holder && !isStaff()) rows = rows.filter(function (x) { return String(x.vendor) === String(s.holder); });
    return rows;
  }
  function monthsSince(iso) {
    if (!iso) return null;
    var d = new Date(iso); if (isNaN(d)) return null;
    var now = new Date();
    return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  }
  function lastReport(svc) {
    var rs = svc.reports || [];
    if (!rs.length) return '';
    return rs.map(function (r) { return r.month || ''; }).sort().slice(-1)[0] || '';
  }
  function overdue(svc) {
    if (svc.status === '종료') return false;
    var m = lastReport(svc);
    if (!m) return true;
    var mm = monthsSince(m + '-01');
    return (mm === null ? false : mm >= 2);
  }
  function pmDocs(svc) {
    return C.docsOf(svc.asset_id).filter(function (d) { return d.kind === 'pm'; });
  }

  function rows() {
    var q = S.q.toLowerCase();
    return mine().filter(function (x) {
      if (S.cat !== 'ALL' && String(x.category) !== S.cat) return false;
      if (S.status !== 'ALL' && String(x.status) !== S.status) return false;
      if (S.overdue && !overdue(x)) return false;
      if (!q) return true;
      return [x.asset_name, x.vendor, x.category, x.contract_no, x.note].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var oa = overdue(a) ? 0 : 1, ob = overdue(b) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return String(a.contract_end || '').localeCompare(String(b.contract_end || ''));
    });
  }

  function render(rfpId) {
    var data = rows();
    var od = mine().filter(overdue).length;
    var h = '<section class="rfp-panel"><div class="rfp-panel-head"><b>📋 PM·FM·보험 용역 진행</b>' +
      '<span class="rfp-panel-tools">' + (isStaff() ? '<button type="button" class="mini-btn" data-svc="add">＋ 용역 등록</button>' : '') +
      '<span class="rfp-tag' + (od ? ' over' : '') + '">리포트 미수신 ' + od + '건</span></span></div>';
    h += '<div class="svc-filters"><input id="svcQ" type="search" placeholder="물건 · 용역사 검색" autocomplete="off">' +
      ['ALL'].concat(CATS).map(function (c) { return '<button type="button" class="rfp-chip' + (S.cat === c ? ' on' : '') + '" data-svc-cat="' + esc(c) + '">' + (c === 'ALL' ? '전체' : esc(c)) + '</button>'; }).join('') +
      ['ALL'].concat(ST).map(function (c) { return '<button type="button" class="rfp-chip' + (S.status === c ? ' on' : '') + '" data-svc-st="' + esc(c) + '">' + (c === 'ALL' ? '상태 전체' : esc(c)) + '</button>'; }).join('') +
      '<label class="deal-check"><input type="checkbox" id="svcOverdue"' + (S.overdue ? ' checked' : '') + '> 리포트 미수신만</label></div>';
    if (!data.length) return h + '<p class="rfp-hint">등록된 용역이 없습니다. 매칭 마켓에서 수요 요청·공급 제안을 매칭하면 여기서 진행을 관리합니다.</p>';
    h += '<div class="rfp-table-wrap"><table class="rfp-table small"><thead><tr><th>물건</th><th>구분</th><th>용역사·담당</th><th>상태</th><th>계약기간</th><th>최근 리포트</th><th>산출물</th><th>이슈</th><th>다음 할 일</th><th></th></tr></thead><tbody>';
    data.forEach(function (x) {
      var lr = lastReport(x);
      var late = overdue(x);
      var dls = x.deliverables || [], doneN = dls.filter(function (d) { return d.done_at; }).length;
      var openIss = (x.issues || []).filter(function (i) { return i.status !== '완료'; }).length;
      h += '<tr><td><b>' + esc(x.asset_name || '-') + '</b><span class="rfp-sub">' + esc([x.rfp_title, x.contract_no].filter(Boolean).join(' · ')) + '</span></td>' +
        '<td>' + badge(x.category, 'flow') + '</td>' +
        '<td><b>' + esc(x.vendor || '-') + '</b><span class="rfp-sub">' + esc(x.vendor_contact || '') + '</span></td>' +
        '<td>' + badge(x.status || '수행중', x.status === '종료' ? 'wait' : 'ok') + '</td>' +
        '<td class="rfp-sub">' + esc([x.contract_start, x.contract_end].filter(Boolean).join(' ~ ') || '-') + '</td>' +
        '<td>' + (lr ? '<span class="' + (late ? 'dr-no' : 'dr-yes') + '">' + esc(lr) + '</span>' : '<span class="dr-no">없음</span>') +
        (late ? ' <span class="dr-reason">미수신</span>' : '') + '</td>' +
        '<td class="num">' + doneN + '/' + dls.length + '</td>' +
        '<td class="num">' + (openIss ? '<span class="dr-no">' + openIss + '</span>' : '0') + '</td>' +
        '<td class="rfp-sub">' + esc([x.next_action, x.next_due].filter(Boolean).join(' · ') || '-') + '</td>' +
        '<td><button type="button" class="mini-btn" data-svc="open" data-id="' + esc(x.id) + '">상세</button></td></tr>';
    });
    h += '</tbody></table></div>' +
      '<p class="rfp-hint">월간 리포트가 <b>2개월 이상</b> 없는 건은 빨간색으로 표시되고 「미수신만」으로 걸러집니다. ' +
      'PM 리포트 파일은 물건 자료(pm)에서 이 용역 건에 연결합니다.</p></section>';
    return h;
  }

  function bind(host, repaint) {
    if (!host || host.dataset.svcBound) return;
    host.dataset.svcBound = '1';
    host.addEventListener('click', function (e) {
      var cat = e.target.closest('[data-svc-cat]');
      if (cat) { S.cat = cat.getAttribute('data-svc-cat'); repaint(); return; }
      var st = e.target.closest('[data-svc-st]');
      if (st) { S.status = st.getAttribute('data-svc-st'); repaint(); return; }
      var b = e.target.closest('[data-svc]');
      if (!b) return;
      var act = b.getAttribute('data-svc');
      if (act === 'add') { editModal(null, repaint); return; }
      if (act === 'open') { editModal(b.getAttribute('data-id'), repaint); return; }
    });
    host.addEventListener('input', function (e) {
      if (e.target.id === 'svcQ') { S.q = e.target.value; repaint(); }
    });
    host.addEventListener('change', function (e) {
      if (e.target.id === 'svcOverdue') { S.overdue = e.target.checked; repaint(); }
    });
  }

  function editModal(id, done) {
    var x = id ? C.list('services').filter(function (s) { return s.id === id; })[0] : null;
    if (id && !x) return;
    var rfps = C.list('rfps');
    var docs = x ? pmDocs(x) : [];
    var body = '<div class="rfp-formgrid">' +
      C.field('category', '구분', x ? x.category : 'PM', 'select', { options: CATS }) +
      C.field('rfp_id', '딜 연결(RFP)', x ? x.rfp_id : '', 'select', { options: [{ v: '', l: '(연결 안 함)' }].concat(rfps.map(function (r) { return { v: r.id, l: r.title }; })) }) +
      C.field('asset_name', '물건명', x ? x.asset_name : '', 'text', { wide: true }) +
      C.field('vendor', '용역사', x ? x.vendor : '', 'text') +
      C.field('vendor_contact', '담당·연락', x ? x.vendor_contact : '', 'text') +
      C.field('status', '상태', x ? x.status : '수행중', 'select', { options: ST }) +
      C.field('contract_start', '계약 시작', x ? x.contract_start : '', 'date') +
      C.field('contract_end', '계약 종료', x ? x.contract_end : '', 'date') +
      C.field('next_action', '다음 할 일', x ? x.next_action : '', 'text', { wide: true }) +
      C.field('next_due', '다음 마감', x ? x.next_due : '', 'date') +
      '</div>' +
      '<p class="rfp-hint">요구 산출물·이슈·월간 리포트 수신은 상세에서 추가합니다.</p>';
    var m = C.modal(x ? '용역 상세 — ' + esc(x.asset_name || '') : '＋ 용역 등록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">닫기</button>' +
        '<button type="button" class="btn btn-primary" data-svc-save="1">저장</button>'
    });
    if (x) {
      body = '';
      /* 상세 패널: 산출물·이슈·리포트 */
      var hh = '<div class="rfp-kpis">' +
        '<span class="rfp-kpi"><b>' + esc(x.status) + '</b><em>상태</em></span>' +
        '<span class="rfp-kpi"><b>' + esc([x.contract_start, x.contract_end].filter(Boolean).join('~') || '-') + '</b><em>계약기간</em></span>' +
        '<span class="rfp-kpi"><b>' + (lastReport(x) || '없음') + '</b><em>최근 리포트</em></span></div>';
      hh += '<div class="dr-sub wide"><b>📦 요구 산출물</b><button type="button" class="mini-btn" data-svc-del="1">＋ 산출물</button><ul class="dr-deliv">' +
        ((x.deliverables || []).map(function (d, i) {
          return '<li><b>' + esc(d.name) + '</b><em>' + esc(d.due || '') + (d.done_at ? ' · 제출 ' + esc(C.when(d.done_at)) : ' · 미제출') + '</em>' +
            (!d.done_at ? '<button type="button" class="mini-btn" data-svc-done="' + i + '">제출 완료</button>' : '') + '</li>';
        }).join('') || '<li class="empty">없음</li>') + '</ul></div>';
      hh += '<div class="dr-sub wide"><b>📅 월간 리포트 수신</b>' +
        '<select id="svcPmPick">' + pmDocs(x).map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + (d.month ? ' (' + esc(d.month) + ')' : '') + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="mini-btn" data-svc-link="1">이 파일 연결</button>' +
        '<ul class="dr-deliv">' + ((x.reports || []).map(function (r) { return '<li><b>' + esc(r.month) + '</b><em>' + esc(r.doc_name || '') + ' · ' + esc(C.when(r.at)) + '</em></li>'; }).join('') || '<li class="empty">수신 기록 없음</li>') + '</ul></div>';
      hh += '<div class="dr-sub wide"><b>⚠ 이슈·클레임</b><button type="button" class="mini-btn" data-svc-issue="1">＋ 이슈</button><ul class="dr-deliv">' +
        ((x.issues || []).map(function (i, k) {
          return '<li><b>' + esc(i.title) + '</b><em>' + esc([i.note, C.when(i.at)].filter(Boolean).join(' · ')) + '</em>' +
            (i.status !== '완료' ? '<button type="button" class="mini-btn" data-svc-idone="' + k + '">완료</button>' : '') + '</li>';
        }).join('') || '<li class="empty">없음</li>') + '</ul></div>';
      m.querySelector('.rfp-card-body').insertAdjacentHTML('beforeend', hh);
    }
    m.addEventListener('click', function (e) {
      if (e.target.closest('[data-svc-save]')) {
        var rid = C.fval(m, 'rfp_id');
        var rfp = rid ? C.rfpOf(rid) : null;
        var rec = x || { id: C.uid('svc'), deliverables: [], reports: [], issues: [], at: new Date().toISOString() };
        Object.assign(rec, {
          category: C.fval(m, 'category'), rfp_id: rid, rfp_title: rfp ? rfp.title : '',
          asset_id: rfp ? rfp.asset_id : (rec.asset_id || ''), asset_name: C.fval(m, 'asset_name') || (rfp ? rfp.asset_name : ''),
          vendor: C.fval(m, 'vendor'), vendor_contact: C.fval(m, 'vendor_contact'), status: C.fval(m, 'status'),
          contract_start: C.fval(m, 'contract_start'), contract_end: C.fval(m, 'contract_end'),
          next_action: C.fval(m, 'next_action'), next_due: C.fval(m, 'next_due'), updated_at: new Date().toISOString()
        });
        C.commit('services', rec);
        C.closeModal(); if (done) done(); C.toast('용역을 저장했습니다.');
        return;
      }
      if (e.target.closest('[data-svc-issue]')) {
        x.issues = (x.issues || []).concat([{ at: new Date().toISOString(), title: prompt('이슈 제목') || '이슈', note: '', status: '진행' }]);
        C.commit('services', x); C.closeModal(); if (done) done(); return;
      }
      var dd = e.target.closest('[data-svc-del]');
      if (dd) {
        x.deliverables = (x.deliverables || []).concat([{ name: prompt('산출물 이름') || '산출물', due: prompt('마감(YYYY-MM-DD)') || '', done_at: '' }]);
        C.commit('services', x); C.closeModal(); if (done) done(); return;
      }
      var dn = e.target.closest('[data-svc-done]');
      if (dn) { x.deliverables[Number(dn.getAttribute('data-svc-done'))].done_at = new Date().toISOString(); C.commit('services', x); C.closeModal(); if (done) done(); return; }
      var di = e.target.closest('[data-svc-idone]');
      if (di) { x.issues[Number(di.getAttribute('data-svc-idone'))].status = '완료'; C.commit('services', x); C.closeModal(); if (done) done(); return; }
      var lk = e.target.closest('[data-svc-link]');
      if (lk) {
        var sel = m.querySelector('#svcPmPick');
        var d = sel && sel.value ? C.byId('docs', sel.value) : null;
        if (!d) { C.toast('연결할 PM 파일이 없습니다.', true); return; }
        var mon = d.month || C.parseMonth(d.name) || C.today().slice(0, 7);
        x.reports = (x.reports || []).concat([{ month: mon, doc_id: d.id, doc_name: d.name, at: new Date().toISOString() }]);
        C.commit('services', x); C.closeModal(); if (done) done(); C.toast('PM 리포트를 연결했습니다.'); return;
      }
    });
  }

  window.NAI_SVC = { render: render, bind: bind, rows: rows, overdue: overdue };
})();
