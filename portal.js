/* =========================================================================
   Open AI Asset Bridge — portal.js  (🤝 자문사 포털 · 입찰·금융기관, 2026-11-27)
   -------------------------------------------------------------------------
   선정된 자문사가 매도측 자료를 인계받아 실무를 진행하는 공간입니다.

     E. 승인 코드로 자료 열람·다운로드(이력 기록) · CA 관리 · TM/IM 연결
        · 마케팅 리스트(FI/SI/화주 풀 연계)
     F. 입찰 공고 → 매수자 등록·서류/LOI/LOC 제출 → 금융기관 등록·인증·검증
     C. (자문사 시점) 초청받은 RFP 열람 · 제안서 작성·제출·수정(마감 전)

   권한
     - 승인 코드로 들어온 자문사: 자기 RFP·자기 제안서만. 다른 자문사 제안서는
       데이터 조회 단계(C.visibleSubmissions)에서 제외됩니다.
     - 매수자 코드: CA에 적힌 공개 범위의 자료만. 제안서는 받지 않습니다.
     - 금융기관 코드: 자기에게 온 LOI/LOC 검증 건만.
     - 관리자: 전체 + 코드 발급·종료.
   ========================================================================= */
(function () {
  'use strict';

  var C = window.NAI_RFPC;
  if (!C) return;
  var esc = C.esc, n0 = C.n0, num = C.num;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = { tab: 'rfp', rfpId: '', ready: false, codeInput: '', err: '', busy: false };

  function host() { return document.getElementById('portalView'); }
  function ss() { return C.session(); }
  function isAdv() { var s = ss(); return !!(s && s.holder_type === '자문사'); }
  function isBuyer() { var s = ss(); return !!(s && s.holder_type === '매수자'); }
  function isLender() { var s = ss(); return !!(s && s.holder_type === '금융기관'); }
  function admin() { return C.isAdmin(); }

  function visibleRfps() { return C.visibleRfps(ss()); }
  function chosenRfp() {
    var list = visibleRfps();
    if (!list.length) return null;
    for (var i = 0; i < list.length; i++) if (list[i].id === S.rfpId) return list[i];
    return list[0];
  }
  function chosenAsset() {
    var r = chosenRfp();
    return r ? r.asset_id : '';
  }
  function modeText() {
    if (ss()) return ss().holder + ' · ' + ss().holder_type;
    if (admin()) return '관리자 전체 보기';
    return '승인 코드 미입력';
  }

  /* ─────────────────────────── 껍데기 ─────────────────────────── */
  function tabsFor() {
    if (ss() && isBuyer()) return [['rfp', '📑 내 RFP·CA'], ['docs', '📁 공개 자료'], ['bid', '📝 내 제출']];
    if (ss() && isLender()) return [['bid', '🏦 LOI/LOC 검증'], ['info', 'ℹ️ 기관 정보']];
    if (admin()) return [['rfp', '📑 RFP·제안'], ['docs', '🔑 자료·승인코드'], ['ca', '🤝 CA·마케팅'], ['bid', '🏷️ 입찰·금융기관']];
    return [['rfp', '📑 내 RFP·제안'], ['docs', '📁 자료실'], ['ca', '🤝 CA·마케팅'], ['bid', '🏷️ 입찰·금융기관']];
  }
  function shell() {
    var tabs = tabsFor();
    if (!tabs.some(function (t) { return t[0] === S.tab; })) S.tab = tabs[0][0];
    return '<div class="rfp-shell portal-shell">' +
      '<div class="rfp-top portal-top"><div class="rfp-title">' +
        '<h2>🤝 자문사 포털 <span class="rfp-beta">선정 이후</span></h2>' +
        '<p>선정된 자문사가 <b>승인 코드</b>로 매도측 자료(렌트롤·오펙스·PM 리포트)를 인계받아, ' +
        'CA 관리 · TM/IM · 마케팅 리스트 · 입찰·매수자·금융기관 검증까지 진행합니다.</p>' +
        '<p class="rfp-meta"><span class="rfp-portal-who">' + esc(modeText()) + '</span>' +
          (ss() ? '<span>만료 ' + esc((ss().rec || {}).expires_at || '-') + '</span><button type="button" class="mini-btn" data-pt="logout">나가기</button>' : '') +
        '</p>' +
      '</div><div class="rfp-top-actions">' +
        (admin() && !ss() ? '<button type="button" class="btn btn-ghost" data-pt="code-new">🔑 승인 코드 발급</button>' : '') +
        '<button type="button" class="btn btn-ghost" data-pt="reload">↻</button>' +
      '</div></div>' +
      '<div class="rfp-steps portal-tabs">' + tabs.map(function (t) {
        return '<button type="button" class="rfp-step' + (S.tab === t[0] ? ' on' : '') + '" data-pt-tab="' + t[0] + '"><b>' + t[1] + '</b></button>';
      }).join('') + '</div>' +
      '<div id="ptBody" class="portal-body"></div></div>';
  }

  function paint() {
    var h = host();
    if (!h) return;
    if (!h.dataset.bound) { bind(); h.dataset.bound = '1'; }
    if (!ss() && !admin()) {
      h.dataset.shellKey = '';
      h.innerHTML = gateHTML();
      return;
    }
    var key = modeText() + '|' + tabsFor().map(function (t) { return t[0]; }).join(',');
    if (h.dataset.shellKey !== key) {
      h.innerHTML = shell();
      h.dataset.shellKey = key;
    } else {
      $$('[data-pt-tab]', h).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-pt-tab') === S.tab); });
    }
    var tabs = tabsFor();
    if (!tabs.some(function (t) { return t[0] === S.tab; })) S.tab = tabs[0][0];
    var body = $('#ptBody', h);
    if (!body) return;
    if (S.tab === 'docs') body.innerHTML = docsTab();
    else if (S.tab === 'ca') body.innerHTML = caTab();
    else if (S.tab === 'bid') body.innerHTML = bidTab();
    else if (S.tab === 'info') body.innerHTML = infoTab();
    else body.innerHTML = rfpTab();
  }

  /* ─────────────────────────── 코드 게이트 ─────────────────────────── */
  function gateHTML() {
    var adv = C.list('codes').filter(function (c) { return C.validCode(c); });
    var h = '<div class="rfp-shell"><div class="portal-gate">' +
      '<div class="portal-gate-card">' +
        '<span class="rfp-beta">승인 코드</span>' +
        '<h2>🤝 자문사 포털</h2>' +
        '<p>매도측(의뢰인)이 발급한 <b>승인 코드</b>를 입력하세요. 코드마다 열람할 수 있는 RFP·자료 범위가 다릅니다.</p>' +
        '<form id="ptGateForm" autocomplete="off">' +
          '<input id="ptCode" type="text" placeholder="예) ADV-7K2M9Q" autocomplete="off" spellcheck="false" aria-label="승인 코드">' +
          '<button class="btn btn-primary" type="submit">입장</button>' +
        '</form>' +
        (S.err ? '<p class="rfp-err">' + esc(S.err) + '</p>' : '') +
        '<p class="rfp-hint">자문사 코드는 초청받은 RFP만, 매수자 코드는 CA 체결된 자료만 열립니다. ' +
        '코드가 없으면 의뢰인(담당자)에게 요청하세요.</p>' +
        (admin() && adv.length ? '<div class="portal-gate-admin"><b>관리자 — 코드로 미리보기</b><div class="rfp-rfpchips">' +
          adv.map(function (c) {
            return '<button type="button" class="rfp-chip" data-pt-use="' + esc(c.code) + '">' + esc(c.holder || c.code) + ' <em>' + esc(c.holder_type) + '</em></button>';
          }).join('') + '</div></div>' : '') +
      '</div></div></div>';
    return h;
  }
  function enterCode(code) {
    var rec = C.findCode(code);
    if (!rec) { S.err = '코드를 찾을 수 없습니다. 철자를 확인하세요.'; paint(); return; }
    if (!C.validCode(rec)) { S.err = '만료되었거나 종료된 코드입니다(' + (rec.expires_at || '') + '). 담당자에게 새 코드를 요청하세요.'; paint(); return; }
    S.err = '';
    C.setSession(rec);
    C.codeLogin(rec.code).then(function (jsel) { if (jsel) { C.SYNC.checked = false; C.pullServer().then(paint); } });
    S.tab = rec.holder_type === '금융기관' ? 'bid' : (rec.holder_type === '매수자' ? 'rfp' : 'rfp');
    S.rfpId = rec.rfp_id || '';
    paint();
    C.toast(rec.holder + ' 코드로 입장했습니다.');
  }

  /* ─────────────────────────── C. 내 RFP · 제안 ─────────────────────────── */
  function rfpTab() {
    var list = visibleRfps();
    if (!list.length) {
      return '<div class="rfp-empty big"><b>열람할 RFP가 없습니다.</b>' +
        (admin() ? '<p>📑 RFP 발주 탭에서 RFP를 만들고 자문사에 배부하면 여기에 표시됩니다.</p>' : '<p>승인 코드에 연결된 RFP가 아직 없습니다. 담당자에게 확인하세요.</p>') +
        (admin() ? '<button type="button" class="btn btn-primary" data-pt="go-rfp">📑 RFP 발주로 이동</button>' : '') + '</div>';
    }
    if (!S.rfpId || !list.some(function (r) { return r.id === S.rfpId; })) S.rfpId = list[0].id;
    var rfp = chosenRfp();
    var h = '';
    if (list.length > 1) {
      h += '<div class="rfp-rfpchips">' + list.map(function (r) {
        return '<button type="button" class="rfp-chip' + (r.id === S.rfpId ? ' on' : '') + '" data-pt-rfp="' + esc(r.id) + '">' + esc(r.title) + '</button>';
      }).join('') + '</div>';
    }
    if (isAdv()) markViewed(rfp);

    var mySub = null, invite = null, codeRec = ss() ? ss().rec : null;
    if (isAdv() && ss()) {
      mySub = C.submissionOf(rfp.id, ss().holder_id);
      invite = (rfp.invites || []).filter(function (i) { return String(i.advisor_id) === String(ss().holder_id); })[0];
    }
    var dleft = C.daysLeft(rfp.due_date);
    h += '<div class="rfp-sec-head"><div><h3>' + esc(rfp.title) + '</h3>' +
      '<p>' + esc([rfp.asset_name, rfp.client, '발주 ' + (rfp.issue_date || '-')].filter(Boolean).join(' · ')) + '</p></div>' +
      '<div class="rfp-sec-tools">' +
        '<span class="rfp-due' + (dleft !== null && dleft < 0 ? ' over' : (dleft !== null && dleft <= 3 ? ' soon' : '')) + '">' +
          (dleft === null ? '마감 미정' : (dleft < 0 ? '마감 지남' : 'D-' + dleft)) + '</span>' +
        '<button type="button" class="btn btn-ghost" data-pt-print="' + esc(rfp.id) + '">🖨 RFP 인쇄</button>' +
        (isAdv() || (admin() && !ss()) ? '<button type="button" class="btn btn-primary" data-pt-sub="' + esc(rfp.id) + '">' +
          (mySub ? '✏️ 제안서 수정' : '📝 제안서 작성·제출') + '</button>' : '') +
      '</div></div>';

    /* 자문사 — 내 제출 상태 */
    if (isAdv() && ss()) {
      h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>내 제출</b><span>' +
        (mySub ? 'v' + (mySub.version || 1) + ' · ' + esc(mySub.status || '제출') + ' · ' + esc(C.when(mySub.at)) : '미제출') + '</span></div>';
      if (!mySub) {
        h += '<p class="rfp-hint">마감(' + esc(rfp.due_date || '-') + ') 전까지 작성·제출할 수 있고, 제출 후에도 마감 전이면 수정되어 <b>버전이 올라갑니다</b>. ' +
          '제출한 제안서는 다른 자문사에 공개되지 않습니다.</p>';
      } else {
        h += '<div class="rfp-table-wrap"><table class="rfp-table small"><tbody>' +
          '<tr><th>성공보수</th><td>' + (mySub.fee_success ? n0(mySub.fee_success, 2) + '%' : '-') + '</td><th>고정 수수료</th><td>' + (mySub.fee_fixed ? n0(mySub.fee_fixed, 2) + '억' : '-') + '</td></tr>' +
          '<tr><th>예상 매각가</th><td>' + (mySub.price_expect ? n0(mySub.price_expect, 0) + '억' : '-') + '</td><th>예상 기간</th><td>' + (mySub.period_months ? mySub.period_months + '개월' : '-') + '</td></tr>' +
          '<tr><th>첨부</th><td colspan="3">' + ((mySub.files || []).length ? esc(mySub.files.map(function (f) { return f.name; }).join(', ')) : '-') + '</td></tr>' +
          '</tbody></table></div>' +
          (mySub.revisions && mySub.revisions.length ? '<p class="rfp-hint">수정 이력: ' + mySub.revisions.map(function (r) { return 'v' + r.version + '(' + esc(C.when(r.at).slice(5, 16)) + ')'; }).join(' → ') + '</p>' : '');
      }
      h += '</section>';
    }

    /* 관리자 — 제출 현황 요약 */
    if (admin() && !ss()) {
      var invites = rfp.invites || [];
      var subs = C.submissionsOf(rfp.id);
      h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>제출 현황</b><span>초청 ' + invites.length + ' · 제출 ' + subs.length + '</span></div>' +
        '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr><th>자문사</th><th>코드</th><th>열람</th><th>제출</th><th>총점</th></tr></thead><tbody>' +
        invites.map(function (inv) {
          var s = subs.filter(function (x) { return x.advisor_id === inv.advisor_id; })[0];
          var sc = s ? C.scoreOf(rfp.id, s.advisor_id) : null;
          var tot = s ? C.totalScore(rfp, (sc || {}).values || {}) : null;
          return '<tr><td><b>' + esc(inv.company) + '</b></td><td class="mono">' + esc(inv.code) + '</td>' +
            '<td>' + (inv.viewed_at ? esc(C.when(inv.viewed_at)) : '미열람') + '</td>' +
            '<td>' + (s ? 'v' + (s.version || 1) + ' · ' + esc(s.status) : '미제출') + '</td>' +
            '<td class="num">' + (tot == null ? '-' : tot) + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }

    h += '<div class="rfp-rfpview">' + C.rfpHTML(rfp, { invites: false }) + '</div>';
    return h;
  }
  function markViewed(rfp) {
    if (!rfp || !ss() || !isAdv()) return;
    var inv = (rfp.invites || []).filter(function (i) { return String(i.advisor_id) === String(ss().holder_id); })[0];
    if (!inv || inv.viewed_at) return;
    inv.viewed_at = new Date().toISOString();
    C.commit('rfps', rfp);
  }

  function openSubmission(rfpId) {
    var rfp = C.rfpOf(rfpId);
    if (!rfp) return;
    var advId = (ss() && isAdv()) ? ss().holder_id : '';
    var advRec = advId ? C.byId('advisors', advId) : null;
    var exist = advId ? C.submissionOf(rfpId, advId) : null;
    var overdue = C.daysLeft(rfp.due_date) !== null && C.daysLeft(rfp.due_date) < 0;
    var advOpts = C.list('advisors').map(function (a) { return { v: a.id, l: a.company + (a.name ? ' (' + a.name + ')' : '') }; });
    if (!advId && !advOpts.length) {
      C.toast('먼저 자문사를 등록하세요(📑 RFP 발주 → 배부).', true);
      return;
    }
    var s = exist || { fee_success: '', fee_fixed: '', price_expect: '', period_months: '', track_record: '', access_reach: '', team: '', schedule: '', extra: '', files: [] };
    var body = (overdue ? '<p class="rfp-err">제출 마감(' + esc(rfp.due_date) + ')이 지났습니다. 마감 후 수정은 관리자만 할 수 있습니다.</p>' : '') +
      '<p class="rfp-note">' + esc(rfp.title) + ' — 요구 서류(' + (rfp.docs || []).length + '종)를 참고해 작성하고, 파일은 이 화면에서 업로드합니다. ' +
      '제출하면 <b>본인과 의뢰인</b>만 볼 수 있고 다른 자문사에는 공개되지 않습니다.</p>' +
      '<div class="rfp-formgrid">' +
      (advId ? '' : C.field('advisor_id', '자문사', '', 'select', { options: advOpts, req: true, hint: '관리자 대리 입력' })) +
      C.field('fee_success', '성공보수(%)', s.fee_success, 'number', { step: '0.01', ph: '예) 1.10' }) +
      C.field('fee_fixed', '고정 수수료(억원)', s.fee_fixed, 'number', { step: '0.01', ph: '예) 0.5' }) +
      C.field('price_expect', '예상 매각가(억원)', s.price_expect, 'number', { step: '1', ph: '예) 3,600' }) +
      C.field('period_months', '예상 매각 기간(개월)', s.period_months, 'number', { step: '1', ph: '예) 6' }) +
      C.field('track_record', '유사 실적', s.track_record, 'textarea', { wide: true, rows: 3, ph: '예) 2024 ○○타워 매각(3,200억) 자문 …' }) +
      C.field('access_reach', '투자자 접근력 (FI/SI/화주)', s.access_reach, 'textarea', { wide: true, rows: 3, ph: '예) FI 45곳 · SI 20곳 · 화주 10곳 접촉 가능' }) +
      C.field('team', '인력 구성', s.team, 'textarea', { wide: true, rows: 2, ph: '예) 전담 5명(리드 1, 애널리스트 2, 마케팅 2)' }) +
      C.field('schedule', '일정', s.schedule, 'textarea', { wide: true, rows: 2, ph: '예) TM D+20, LOI D+45, 입찰 D+60' }) +
      C.field('extra', '추가 서비스', s.extra, 'textarea', { wide: true, rows: 2, ph: '예) PF 주선, 금융기관 검증 지원' }) +
      C.field('memo', '메모', s.memo || '', 'textarea', { wide: true, rows: 2 }) +
      '</div>' +
      '<div class="rfp-attach"><div class="rfp-attach-head"><b>첨부 파일</b><button type="button" class="mini-btn" data-pt="sub-file">＋ 파일 추가</button></div>' +
      '<ul class="rfp-attach-list" id="ptFiles"></ul>' +
      '<p class="rfp-hint">파일 1건 900KB까지 이 브라우저에 보관됩니다. 큰 파일은 이름·메모만 기록되며, 실제 제출은 VDR 링크로 안내하세요.</p></div>';
    var m = C.modal((exist ? '✏️ 제안서 수정' : '📝 제안서 작성·제출') + ' — ' + rfp.title, body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-pt="sub-save">' + (exist ? '수정 제출' : '제출') + '</button>'
    });
    var files = (s.files || []).slice();
    function paintFiles() {
      var ul = $('#ptFiles', m);
      ul.innerHTML = files.length ? files.map(function (f, i) {
        return '<li><span>📎 ' + esc(f.name) + '</span><em>' + C.bytes(f.size) + (f.note ? ' · ' + esc(f.note) : '') + '</em>' +
          '<button type="button" class="mini-btn" data-file-del="' + i + '">×</button></li>';
      }).join('') : '<li class="empty">첨부 없음</li>';
    }
    paintFiles();
    m.addEventListener('click', function (e) {
      var del = e.target.closest('[data-file-del]');
      if (del) { files.splice(Number(del.getAttribute('data-file-del')), 1); paintFiles(); return; }
      if (e.target.closest('[data-pt="sub-file"]')) {
        C.pickFiles(true).then(function (list) {
          if (!list.length) return;
          Promise.all(list.map(function (f) {
            return C.readFile(f).then(function (r) { return { name: r.name, size: r.size, mime: r.mime, dataUrl: r.dataUrl || '', text: r.text || '' }; })
              .catch(function () { return { name: f.name, size: f.size, mime: f.type, dataUrl: '', text: '', note: '용량 초과 — 원본 미보관' }; });
          })).then(function (items) { files = files.concat(items); paintFiles(); });
        });
      }
    });
    m.querySelector('[data-pt="sub-save"]').addEventListener('click', function () {
      var aid = advId || C.fval(m, 'advisor_id');
      if (!aid) { C.toast('자문사를 선택하세요.', true); return; }
      if (overdue && !isAdmin()) { C.toast('마감이 지나 제출할 수 없습니다. 담당자에게 문의하세요.', true); return; }
      var price = num(C.fval(m, 'price_expect'));
      if (!(price > 0)) { C.toast('예상 매각가를 입력하세요.', true); return; }
      var adv = C.byId('advisors', aid) || {};
      var revs = (exist && exist.revisions ? exist.revisions : []).slice();
      if (exist) revs.push({ version: exist.version || 1, at: exist.at, fee_success: exist.fee_success, price_expect: exist.price_expect, period_months: exist.period_months });
      var rec = {
        id: exist ? exist.id : C.uid('sub'), rfp_id: rfpId, advisor_id: aid,
        advisor_company: adv.company || (ss() ? ss().holder : ''),
        version: exist ? (exist.version || 1) + 1 : 1,
        status: exist ? '수정 제출' : '제출',
        fee_success: C.fval(m, 'fee_success'), fee_fixed: C.fval(m, 'fee_fixed'),
        price_expect: price, period_months: C.fval(m, 'period_months'),
        track_record: C.fval(m, 'track_record'), access_reach: C.fval(m, 'access_reach'),
        team: C.fval(m, 'team'), schedule: C.fval(m, 'schedule'), extra: C.fval(m, 'extra'),
        memo: C.fval(m, 'memo'), files: files, revisions: revs,
        at: exist ? exist.at : new Date().toISOString(), revised_at: new Date().toISOString()
      };
      C.commit('submissions', rec);
      var r2 = C.rfpOf(rfpId);
      if (r2 && ['작성', '배포'].indexOf(r2.status) >= 0) r2.status = '제안 접수';
      if (r2) C.commit('rfps', r2);
      C.closeModal(); paint();
      C.toast(exist ? '제안서를 수정 제출했습니다(v' + rec.version + ').' : '제안서를 제출했습니다. 의뢰인에게 전달됩니다.');
    });
  }

  /* ─────────────────────────── E. 자료실 · 승인 코드 ─────────────────────────── */
  function docsTab() {
    var rfp = chosenRfp();
    if (!rfp) return '<div class="rfp-empty"><b>자료를 인계받을 RFP가 없습니다.</b><p>의뢰인이 자문사를 선정하면 이 화면에 자료가 열립니다.</p></div>';
    var code = ss() ? ss().rec : null;
    var docs = C.visibleDocs(rfp.asset_id, ss());
    var h = '<div class="rfp-sec-head"><div><h3>자료실 — ' + esc(rfp.asset_name || rfp.title) + '</h3>' +
      '<p>' + (code ? '이 코드의 공개 범위: <b>' + esc((code.scope || []).map(kindLabel).join(' · ')) + '</b>' : '관리자 전체 보기') + '</p></div>' +
      '<div class="rfp-sec-tools">' +
        '<select id="ptRfpSel" class="rfp-sel">' + visibleRfps().map(function (r) {
          return '<option value="' + esc(r.id) + '"' + (r.id === rfp.id ? ' selected' : '') + '>' + esc(r.asset_name || r.title) + '</option>';
        }).join('') + '</select>' +
        (admin() && !ss() ? '<button type="button" class="btn btn-primary" data-pt="code-new">🔑 승인 코드 발급</button>' : '') +
      '</div></div>';

    h += '<div class="rfp-panel"><div class="rfp-panel-head"><b>인계 자료</b><span>' + docs.length + '건</span></div>';
    if (!docs.length) {
      h += '<p class="rfp-hint">공개 범위에 해당하는 자료가 없습니다. 의뢰인(📑 RFP 발주 → 물건 자료)에서 렌트롤·오펙스를 올리면 자동으로 표시됩니다.</p>';
    } else {
      h += '<ul class="rfp-filelist big">' + docs.map(function (d) {
        return '<li><span class="rfp-file-ico">' + (/\.xlsx?$/i.test(d.name) ? '📊' : (/\.pdf$/i.test(d.name) ? '📄' : '📃')) + '</span>' +
          '<span class="rfp-file-main"><b>' + esc(d.name) + '</b><em>' + esc([d.label, d.month || '', C.bytes(d.size), (d.rows || []).length ? (d.rows.length - 1) + '행' : ''].filter(Boolean).join(' · ')) + '</em></span>' +
          '<span class="rfp-file-act">' +
            '<button type="button" class="mini-btn" data-pt-doc="' + esc(d.id) + '">열람</button>' +
            '<button type="button" class="mini-btn" data-pt-dl="' + esc(d.id) + '">다운로드</button>' +
          '</span></li>';
      }).join('') + '</ul>';
    }
    h += '</div>';

    /* 자료 요약 (자문사가 인계 직후 확인) */
    var b = C.assetBrief(rfp.asset_id);
    if (b.rental) {
      h += '<div class="rfp-panel"><div class="rfp-panel-head"><b>렌트롤 요약</b><span>인계 데이터</span></div>' +
        '<div class="rfp-kpis">' + kpi(n0(b.rental.tenantCount, 0) + '명', '임차인') + kpi(n0(b.rental.leasedArea, 0) + '평', '임대면적') +
        kpi(n0(b.rental.vacancyRate) + '%', '공실률') + kpi(n0(b.rental.monthlyRent, 0) + '원', '월 임대료') +
        kpi(b.rental.wale == null ? '-' : b.rental.wale.toFixed(1) + '년', 'WALE') + '</div></div>';
    }

    if (admin() && !ss()) h += codesPanel();
    if (code) h += '<p class="rfp-hint">모든 열람·다운로드는 이력으로 기록됩니다(누가·언제·어떤 자료). 관리자는 아래 승인 코드 표에서 확인합니다.</p>';
    return h;
  }
  function kindLabel(k) {
    var hit = C.DOC_KINDS.filter(function (x) { return x.k === k; })[0];
    return hit ? hit.label.replace(/\s*\(.*\)/, '') : k;
  }
  function kpi(v, l) { return '<span class="rfp-kpi"><b>' + esc(v) + '</b><em>' + esc(l) + '</em></span>'; }

  function codesPanel() {
    var codes = C.list('codes').slice().sort(function (a, b) { return String(b.issued_at || '').localeCompare(String(a.issued_at || '')); });
    var h = '<div class="rfp-panel"><div class="rfp-panel-head"><b>승인 코드 · 접근 이력</b><span>' + codes.length + '건</span>' +
      '<span class="rfp-panel-tools"><button type="button" class="mini-btn" data-pt="access-log">📜 열람 이력</button></span></div>';
    if (!codes.length) {
      h += '<p class="rfp-hint">발급된 코드가 없습니다. <b>승인 코드 발급</b>으로 자문사·매수자·금융기관 코드를 만드세요.</p>';
    } else {
      h += '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr><th>코드</th><th>대상</th><th>구분</th><th>RFP</th><th>공개 범위</th><th>발급</th><th>만료</th><th>상태</th><th></th></tr></thead><tbody>' +
        codes.map(function (c) {
          var rfp = C.rfpOf(c.rfp_id);
          var ok = C.validCode(c);
          return '<tr><td class="mono"><b>' + esc(c.code) + '</b></td><td>' + esc(c.holder || '-') + '</td>' +
            '<td>' + esc(c.holder_type) + '</td><td>' + esc(rfp ? (rfp.asset_name || rfp.title) : '-') + '</td>' +
            '<td>' + esc((c.scope || []).map(kindLabel).join(', ')) + '</td>' +
            '<td>' + esc(C.when(c.issued_at).slice(5)) + '</td><td>' + esc(c.expires_at || '-') + '</td>' +
            '<td>' + (ok ? '<span class="rfp-tag ok">유효</span>' : '<span class="rfp-tag off">만료</span>') + '</td>' +
            '<td>' + (ok ? '<button type="button" class="mini-btn" data-pt-code-off="' + esc(c.id) + '">종료</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '</div>';
    return h;
  }

  function openCodeEditor() {
    var rfps = C.list('rfps');
    if (!rfps.length) { C.toast('먼저 RFP를 만드세요.', true); return; }
    var advisors = C.list('advisors');
    var buyers = C.list('buyers');
    var lenders = C.list('lenders');
    var body = '<p class="rfp-note">코드 하나가 <b>열람 범위</b>를 정합니다. 자문사 코드는 제안서를 제출할 수 있고, 매수자·금융기관 코드는 자료 열람·제출만 됩니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('rfp_id', 'RFP', S.rfpId || (rfps[0] || {}).id, 'select', { options: rfps.map(function (r) { return { v: r.id, l: r.title }; }), req: true }) +
      C.field('holder_type', '대상 구분', '자문사', 'select', { options: ['자문사', '매수자', '금융기관'] }) +
      C.field('holder', '대상 이름', '', 'text', { req: true, ph: '예) ○○부동산자문 / △△리츠 / ○○은행' }) +
      C.field('expires_at', '만료일', C.addDays(C.today(), 30), 'date') +
      '</div>' +
      '<div class="rfp-checkrow"><b>공개 자료 범위</b>' + C.DOC_KINDS.map(function (k) {
        return '<label><input type="checkbox" name="scope" value="' + k.k + '" checked> ' + k.icon + ' ' + esc(k.label) + '</label>';
      }).join('') + '</div>' +
      '<div class="rfp-pickone"><b>등록된 대상에서 선택</b><div class="rfp-rfpchips">' +
        advisors.map(function (a) { return '<button type="button" class="rfp-chip" data-pick-holder="' + esc(a.company) + '" data-pick-type="자문사">' + esc(a.company) + '<em>자문사</em></button>'; }).join('') +
        buyers.map(function (b) { return '<button type="button" class="rfp-chip" data-pick-holder="' + esc(b.name) + '" data-pick-type="매수자">' + esc(b.name) + '<em>매수자</em></button>'; }).join('') +
        lenders.map(function (l) { return '<button type="button" class="rfp-chip" data-pick-holder="' + esc(l.name) + '" data-pick-type="금융기관">' + esc(l.name) + '<em>금융기관</em></button>'; }).join('') +
      '</div></div>';
    var m = C.modal('🔑 승인 코드 발급', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-pt="code-save">발급</button>'
    });
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick-holder]');
      if (!b) return;
      m.querySelector('[name="holder"]').value = b.getAttribute('data-pick-holder');
      m.querySelector('[name="holder_type"]').value = b.getAttribute('data-pick-type');
    });
    m.querySelector('[data-pt="code-save"]').addEventListener('click', function () {
      var holder = C.fval(m, 'holder');
      if (!holder) { C.toast('대상 이름을 입력하세요.', true); return; }
      var scope = Array.prototype.slice.call(m.querySelectorAll('[name="scope"]:checked')).map(function (x) { return x.value; });
      var rec = C.issueCode({
        rfp_id: C.fval(m, 'rfp_id'), holder_type: C.fval(m, 'holder_type'), holder: holder,
        expires_at: C.fval(m, 'expires_at'), scope: scope
      });
      C.closeModal(); paint();
      var body2 = '<p class="rfp-note">아래 코드를 대상자에게 전달하세요.</p>' +
        '<div class="rfp-codebig">' + esc(rec.code) + '</div>' +
        '<p class="rfp-hint">' + esc(rec.holder) + ' · ' + esc(rec.holder_type) + ' · 만료 ' + esc(rec.expires_at) +
        ' · 공개 ' + esc((rec.scope || []).map(kindLabel).join(', ')) + '</p>' +
        '<p class="rfp-hint">접속: Open AI Asset Bridge → 🤝 자문사 포털 → 코드 입력</p>';
      var m2 = C.modal('승인 코드 발급 완료', body2, { footer: '<button type="button" class="btn btn-primary" data-rfp="close">확인</button>' });
      m2.querySelector('.rfp-codebig').onclick = function () { copyText(rec.code); };
    });
  }
  function copyText(t) {
    try { navigator.clipboard.writeText(t).then(function () { C.toast('복사했습니다.'); }, function () { C.toast('복사 실패', true); }); }
    catch (e) { C.toast('복사 실패', true); }
  }

  function openAccessLog(rfpId) {
    var log = C.accessLogOf(rfpId);
    var body = '<p class="rfp-note">승인 코드별 자료 열람·다운로드 기록입니다.</p>' +
      (log.length ? '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr><th>일시</th><th>대상</th><th>구분</th><th>코드</th><th>자료</th><th>행위</th></tr></thead><tbody>' +
        log.slice(0, 200).map(function (a) {
          return '<tr><td>' + esc(C.when(a.at)) + '</td><td>' + esc(a.holder) + '</td><td>' + esc(a.holder_type) + '</td>' +
            '<td class="mono">' + esc(a.code) + '</td><td>' + esc(a.doc_label || '-') + '</td><td>' + esc(a.action) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="rfp-hint">아직 열람 이력이 없습니다.</p>');
    C.modal('📜 자료 열람 이력', body, { wide: true, footer: '<button type="button" class="btn btn-primary" data-rfp="close">닫기</button>' });
  }

  function viewDocAs(docId) {
    var d = C.byId('docs', docId);
    if (!d) return;
    if (ss()) C.logAccess(ss().rec, d, '열람');
    var rows = d.rows || [];
    var body = '<p class="rfp-note">' + esc(d.name) + ' · ' + esc([d.label, d.month || '', C.when(d.at)].filter(Boolean).join(' · ')) + '</p>' +
      (rows.length ? '<div class="rfp-table-wrap"><table class="rfp-table small"><tbody>' +
        rows.slice(0, 40).map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></div>' : '<p class="rfp-hint">표로 정리되지 않은 파일입니다. 다운로드해서 확인하세요.</p>') +
      '<div class="rfp-sec-tools"><button type="button" class="btn btn-primary" data-pt-dl2="' + esc(d.id) + '">⬇ 다운로드</button></div>';
    var m = C.modal('자료 열람', body, { wide: true, footer: '<button type="button" class="btn btn-ghost" data-rfp="close">닫기</button>' });
    m.querySelector('[data-pt-dl2]').addEventListener('click', function () { dlDoc(d); });
  }
  function dlDoc(d) {
    if (!d) return;
    if (ss()) C.logAccess(ss().rec, d, '다운로드');
    if (!C.downloadFile(d)) C.toast('원본 파일이 보관되어 있지 않습니다(표만 보관).', true);
    else C.toast('다운로드했습니다. 열람 이력에 기록됩니다.');
  }

  /* ─────────────────────────── CA · 마케팅 ─────────────────────────── */
  function caTab() {
    var rfp = chosenRfp();
    if (!rfp) return '<div class="rfp-empty"><b>RFP를 선택하세요.</b></div>';
    var cas = C.list('ca').filter(function (c) { return c.rfp_id === rfp.id; });
    var mk = C.list('marketing').filter(function (m) { return m.rfp_id === rfp.id; });
    var h = '<div class="rfp-sec-head"><div><h3>CA · 마케팅 리스트</h3>' +
      '<p>매수자별 CA 체결과 공개 범위를 관리하고, TM/IM을 만든 뒤 FI·SI·화주 풀에서 대상을 뽑아 발송 이력을 남깁니다.</p></div>' +
      '<div class="rfp-sec-tools">' +
        '<select id="ptRfpSel2" class="rfp-sel">' + visibleRfps().map(function (r) {
          return '<option value="' + esc(r.id) + '"' + (r.id === rfp.id ? ' selected' : '') + '>' + esc(r.asset_name || r.title) + '</option>';
        }).join('') + '</select>' +
        '<button type="button" class="btn btn-ghost" data-pt-tmim="TM">📄 TM</button>' +
        '<button type="button" class="btn btn-ghost" data-pt-tmim="IM">📘 IM</button>' +
        '<button type="button" class="btn btn-primary" data-pt="ca-new">＋ CA 등록</button>' +
      '</div></div>';

    /* CA */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>CA 관리</b><span>체결 ' + cas.filter(function (c) { return c.status === '체결'; }).length + ' / ' + cas.length + '</span></div>';
    if (!cas.length) {
      h += '<p class="rfp-hint">등록된 CA가 없습니다. 잠재 매수자에게 자료를 공개하려면 CA 체결이 필요합니다.</p>';
    } else {
      h += '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr><th>매수자</th><th>요청일</th><th>체결일</th><th>상태</th><th>공개 자료</th><th>메모</th><th></th></tr></thead><tbody>' +
        cas.map(function (c) {
          return '<tr><td><b>' + esc(c.buyer) + '</b></td><td>' + esc(c.request_at || '-') + '</td><td>' + esc(c.signed_at || '-') + '</td>' +
            '<td>' + (c.status === '체결' ? '<span class="rfp-tag ok">체결</span>' : '<span class="rfp-tag wait">요청</span>') + '</td>' +
            '<td>' + esc((c.scope || []).map(kindLabel).join(', ') || '-') + '</td><td>' + esc(c.note || '') + '</td>' +
            '<td class="nowrap">' + (c.status !== '체결' ? '<button type="button" class="mini-btn" data-pt-ca-sign="' + esc(c.id) + '">체결 처리</button>' : '') +
            '<button type="button" class="mini-btn" data-pt-ca-code="' + esc(c.id) + '">매수자 코드</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '</section>';

    /* 마케팅 리스트 */
    var pools = { FI: 0, SI: 0, '화주': 0 };
    mk.forEach(function (m) { if (pools[m.pool] != null) pools[m.pool]++; });
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>마케팅 리스트</b><span>FI ' + pools.FI + ' · SI ' + pools.SI + ' · 화주 ' + pools['화주'] + '</span>' +
      '<span class="rfp-panel-tools">' +
      '<button type="button" class="mini-btn" data-pt="mk-pool">＋ 투자자 풀에서 추가</button>' +
      '<button type="button" class="mini-btn" data-pt="mk-add">＋ 직접 추가</button>' +
      '<button type="button" class="mini-btn" data-pt-mk-csv="' + esc(rfp.id) + '">📥 CSV</button></span></div>';
    if (!mk.length) {
      h += '<p class="rfp-hint">아직 대상이 없습니다. <b>투자자 풀에서 추가</b>로 FI·SI·화주 풀에서 대상을 고르면, 누구에게 어떤 물건을 언제 보냈는지 이 표에 계속 쌓입니다.</p>';
    } else {
      h += '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr><th>구분</th><th>회사</th><th>담당·연락</th><th>TM/IM</th><th>발송</th><th>반응</th><th></th></tr></thead><tbody>' +
        mk.map(function (m) {
          return '<tr><td><span class="rfp-tag pool-' + esc(m.pool) + '">' + esc(m.pool) + '</span></td><td><b>' + esc(m.company) + '</b></td>' +
            '<td>' + esc([m.contact, m.email].filter(Boolean).join(' · ') || '-') + '</td><td>' + esc(m.tm_ver || '-') + '</td>' +
            '<td>' + (m.sent_at ? esc(C.when(m.sent_at).slice(0, 10)) : '<span class="rfp-muted">미발송</span>') + '</td>' +
            '<td>' + esc(m.response || '-') + '</td>' +
            '<td class="nowrap">' + (!m.sent_at ? '<button type="button" class="mini-btn" data-pt-mk-sent="' + esc(m.id) + '">발송</button>' : '') +
            '<button type="button" class="mini-btn" data-pt-mk-resp="' + esc(m.id) + '">반응</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '</section>';
    return h;
  }

  function openCA() {
    var rfp = chosenRfp();
    var buyers = C.list('buyers');
    var body = '<p class="rfp-note">CA(기밀유지계약)를 요청·체결한 매수자만 자료를 볼 수 있습니다. 체결 시 공개할 자료 범위를 정하세요.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('buyer', '매수자', '', 'text', { req: true, ph: '예) △△리츠' }) +
      C.field('status', '상태', '요청', 'select', { options: ['요청', '체결'] }) +
      C.field('request_at', '요청일', C.today(), 'date') +
      C.field('signed_at', '체결일', '', 'date') +
      C.field('note', '메모', '', 'text', { wide: true }) +
      '</div>' +
      '<div class="rfp-checkrow"><b>공개 자료 범위</b>' + C.DOC_KINDS.map(function (k) {
        return '<label><input type="checkbox" name="scope" value="' + k.k + '"' + (k.k === 'etc' ? '' : ' checked') + '> ' + k.icon + ' ' + esc(k.label) + '</label>';
      }).join('') + '</div>' +
      (buyers.length ? '<div class="rfp-pickone"><b>등록 매수자</b><div class="rfp-rfpchips">' +
        buyers.map(function (b) { return '<button type="button" class="rfp-chip" data-pick-buyer="' + esc(b.name) + '">' + esc(b.name) + '</button>'; }).join('') + '</div></div>' : '');
    var m = C.modal('＋ CA 등록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-pt="ca-save">저장</button>'
    });
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick-buyer]');
      if (b) m.querySelector('[name="buyer"]').value = b.getAttribute('data-pick-buyer');
    });
    m.querySelector('[data-pt="ca-save"]').addEventListener('click', function () {
      var buyer = C.fval(m, 'buyer');
      if (!buyer) { C.toast('매수자를 입력하세요.', true); return; }
      var scope = Array.prototype.slice.call(m.querySelectorAll('[name="scope"]:checked')).map(function (x) { return x.value; });
      C.commit('ca', {
        id: C.uid('ca'), rfp_id: rfp.id, buyer: buyer, status: C.fval(m, 'status'),
        request_at: C.fval(m, 'request_at'), signed_at: C.fval(m, 'signed_at'),
        scope: scope, note: C.fval(m, 'note')
      });
      C.closeModal(); paint(); C.toast('CA를 저장했습니다.');
    });
  }

  function openMarketingPool() {
    var rfp = chosenRfp();
    if (!rfp) return;
    var body = '<p class="rfp-note">투자자 풀(investors)에서 대상을 골라 마케팅 리스트에 넣습니다. 풀 구분은 FI · SI · 화주로 자동 매핑됩니다.</p>' +
      '<div class="rfp-search"><input id="ptMkQ" type="search" placeholder="회사 · 담당 · 이메일 검색" autocomplete="off"></div>' +
      '<div id="ptMkList" class="rfp-picklist"></div>';
    var m = C.modal('투자자 풀에서 추가', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">닫기</button>' +
        '<button type="button" class="btn btn-primary" data-pt="mk-pool-save">선택 추가</button>'
    });
    var picked = {};
    var rows = [];
    var box = $('#ptMkList', m);
    box.innerHTML = '<p class="rfp-hint">투자자 풀을 불러오는 중…</p>';
    C.loadInvestors().then(function (list) {
      rows = list || [];
      render('');
    });
    function render(q) {
      q = String(q || '').toLowerCase();
      var hits = rows.filter(function (r) {
        if (!q) return true;
        return [r.company, r.contact, r.name, r.email, r.title].join(' ').toLowerCase().indexOf(q) >= 0;
      }).slice(0, 80);
      if (!hits.length) { box.innerHTML = '<p class="rfp-hint">대상이 없습니다. 투자자 풀(FI·SI·화주) 연결을 확인하세요.</p>'; return; }
      box.innerHTML = hits.map(function (r, i) {
        var pool = C.poolOf(r.kind);
        var idx = rows.indexOf(r);
        return '<label class="rfp-pick"><input type="checkbox" data-mkpick="' + idx + '">' +
          '<b>' + esc(r.company || r.name || '-') + '</b><span>' + esc([r.contact || r.name, r.title, r.email].filter(Boolean).join(' · ')) + '</span>' +
          '<em class="pool-' + pool + '">' + pool + '</em></label>';
      }).join('');
    }
    var qi = $('#ptMkQ', m);
    if (qi) qi.addEventListener('input', function () { render(qi.value); });
    m.querySelector('[data-pt="mk-pool-save"]').addEventListener('click', function () {
      var idxs = Array.prototype.slice.call(m.querySelectorAll('[data-mkpick]:checked')).map(function (x) { return Number(x.getAttribute('data-mkpick')); });
      if (!idxs.length) { C.toast('추가할 대상을 선택하세요.', true); return; }
      idxs.forEach(function (i) {
        var r = rows[i];
        if (!r) return;
        if (C.list('marketing').some(function (x) { return x.rfp_id === rfp.id && x.investor_id === (r.id || r.company); })) return;
        C.commit('marketing', {
          id: C.uid('mk'), rfp_id: rfp.id, investor_id: r.id || r.company,
          company: r.company || r.name || '', pool: C.poolOf(r.kind),
          contact: r.contact || r.name || '', email: r.email || '', phone: r.phone || '',
          tm_ver: '', sent_at: '', response: '', note: '', at: new Date().toISOString()
        });
      });
      C.closeModal(); paint(); C.toast(idxs.length + '건을 마케팅 리스트에 추가했습니다.');
    });
  }

  function openMarketingAdd() {
    var rfp = chosenRfp();
    var body = '<div class="rfp-formgrid">' +
      C.field('company', '회사·기관', '', 'text', { req: true }) +
      C.field('pool', '구분', 'FI', 'select', { options: ['FI', 'SI', '화주'] }) +
      C.field('contact', '담당자', '', 'text') +
      C.field('email', '이메일', '', 'email') +
      C.field('tm_ver', 'TM/IM 버전', '', 'text', { ph: '예) IM v1.2' }) +
      C.field('note', '메모', '', 'text') +
      '</div>';
    var m = C.modal('＋ 마케팅 대상 직접 추가', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-pt="mk-save">저장</button>'
    });
    m.querySelector('[data-pt="mk-save"]').addEventListener('click', function () {
      var co = C.fval(m, 'company');
      if (!co) { C.toast('회사명을 입력하세요.', true); return; }
      C.commit('marketing', {
        id: C.uid('mk'), rfp_id: rfp.id, investor_id: '', company: co, pool: C.fval(m, 'pool'),
        contact: C.fval(m, 'contact'), email: C.fval(m, 'email'), phone: '', tm_ver: C.fval(m, 'tm_ver'),
        sent_at: '', response: '', note: C.fval(m, 'note'), at: new Date().toISOString()
      });
      C.closeModal(); paint(); C.toast('마케팅 리스트에 추가했습니다.');
    });
  }

  /* ─────────────────────────── F. 입찰 · 금융기관 ─────────────────────────── */
  function bidTab() {
    var rfp = chosenRfp();
    var ssx = ss();
    var restricted = !!(ssx && (isBuyer() || isLender()));
    if (restricted && !ssx.rfp_id) {
      return '<div class="rfp-empty big"><b>이 코드에는 입찰 건이 연결되지 않았습니다.</b><p>담당자에게 RFP가 연결된 새 코드를 요청하세요.</p></div>';
    }
    function inScope(x) { return !restricted || String(x.rfp_id || '') === String(ssx.rfp_id); }
    var notices = C.list('notices').filter(function (n) { return inScope(n) && (!rfp || n.rfp_id === rfp.id || !n.rfp_id); });
    var buyers = C.list('buyers');
    var subs = C.list('bidSubs').filter(function (s) { return inScope(s) && (!rfp || s.rfp_id === rfp.id || !s.rfp_id); });
    var lenders = C.list('lenders');
    /* 매수자·금융기관 코드는 자기 건만 봅니다(다른 매수자·기관 정보 비공개) */
    if (restricted && isBuyer()) {
      var myB = buyers.filter(function (b) { return String(b.name) === String(ssx.holder); })[0];
      buyers = myB ? [myB] : [];
      if (myB) subs = subs.filter(function (s) { return String(s.buyer_id) === String(myB.id); });
      else subs = [];
    }
    if (restricted && isLender()) {
      var myL = lenders.filter(function (l) { return String(l.name) === String(ssx.holder); })[0];
      lenders = myL ? [myL] : [];
    }
    var confs = C.list('loiconf').filter(function (c) { return !restricted || String(c.rfp_id || '') === String(ssx.rfp_id); });
    var h = '<div class="rfp-sec-head"><div><h3>입찰 · 매수자 제출 · 금융기관 인증</h3>' +
      '<p>입찰 공고를 올리고 매수자를 등록·인증한 뒤, 입찰서·증빙·LOI/LOC를 시스템으로 접수합니다. ' +
      '금융기관은 등록·인증 후 LOI/LOC 진위를 확인합니다.</p></div>' +
      '<div class="rfp-sec-tools">' +
        (isLender() ? '' : '<button type="button" class="btn btn-primary" data-pt="bid-new">＋ 입찰 공고</button>') +
        (isLender() ? '' : '<button type="button" class="btn btn-ghost" data-pt="buyer-new">＋ 매수자 등록</button>') +
        (isLender() ? '' : '<button type="button" class="btn btn-ghost" data-pt="lender-new">＋ 금융기관 등록</button>') +
      '</div></div>';

    /* 공고 */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>① 입찰 공고·참여 양식</b><span>' + notices.length + '건</span></div>';
    if (!notices.length) h += '<p class="rfp-hint">공고가 없습니다. 입찰 공고를 만들면 참여 양식(요구 서류)이 정해집니다.</p>';
    else {
      h += '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr><th>공고</th><th>개시</th><th>마감</th><th>참여 양식</th><th>상태</th><th></th></tr></thead><tbody>' +
        notices.map(function (n) {
          var left = C.daysLeft(n.close_at);
          var st = left === null ? '-' : (left < 0 ? '마감' : (n.open_at && C.daysLeft(n.open_at) > 0 ? '개시 전' : '진행'));
          return '<tr><td><b>' + esc(n.title) + '</b></td><td>' + esc(n.open_at || '-') + '</td><td>' + esc(n.close_at || '-') + '</td>' +
            '<td>' + esc((n.docs || []).join(', ') || '-') + '</td><td>' + esc(st) + '</td>' +
            '<td class="nowrap"><button type="button" class="mini-btn" data-pt-bidsub="' + esc(n.id) + '">제출 접수</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '</section>';

    /* 매수자 + 접수 현황 */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>② 매수자 등록·인증·제출 현황</b><span>' + buyers.length + '개사</span></div>';
    if (!buyers.length) h += '<p class="rfp-hint">등록된 매수자가 없습니다. 법인정보를 등록하면 서류·LOI/LOC 제출을 이어갈 수 있습니다.</p>';
    else {
      h += '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr>' +
        '<th>매수자</th><th>사업자번호</th><th>담당</th><th>인증</th><th>입찰서</th><th>증빙</th><th>LOI</th><th>LOC</th><th>검증</th><th></th>' +
        '</tr></thead><tbody>' + buyers.map(function (b) {
          var mine = subs.filter(function (s) { return s.buyer_id === b.id; });
          var has = function (k) { return mine.some(function (s) { return s.kind === k; }); };
          var loi = mine.filter(function (s) { return s.kind === 'LOI'; });
          var verified = loi.filter(function (s) { return (s.verify || '') === '검증'; }).length;
          return '<tr><td><b>' + esc(b.name) + '</b><span class="rfp-muted">' + esc(b.ceo || '') + '</span></td>' +
            '<td class="mono">' + esc(b.corp_no || '-') + '</td><td>' + esc([b.contact, b.phone].filter(Boolean).join(' · ') || '-') + '</td>' +
            '<td>' + (b.status === '인증' ? '<span class="rfp-tag ok">인증</span>' : '<span class="rfp-tag wait">' + esc(b.status || '등록') + '</span>') + '</td>' +
            '<td class="ctr">' + (has('입찰서') ? '✓' : '·') + '</td><td class="ctr">' + (has('증빙') ? '✓' : '·') + '</td>' +
            '<td class="ctr">' + (has('LOI') ? '✓' : '·') + '</td><td class="ctr">' + (has('LOC') ? '✓' : '·') + '</td>' +
            '<td>' + (loi.length ? '<span class="rfp-tag ' + (verified ? 'ok' : 'wait') + '">' + verified + '/' + loi.length + '</span>' : '-') + '</td>' +
            '<td class="nowrap">' + (b.status !== '인증' ? '<button type="button" class="mini-btn" data-pt-buyer-ok="' + esc(b.id) + '">인증</button>' : '') +
            '<button type="button" class="mini-btn" data-pt-bidsub2="' + esc(b.id) + '">제출</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '</section>';

    /* 제출물 */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>③ 접수 제출물</b><span>' + subs.length + '건</span></div>';
    if (!subs.length) h += '<p class="rfp-hint">접수된 제출물이 없습니다.</p>';
    else {
      h += '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr><th>접수</th><th>매수자</th><th>구분</th><th>금액</th><th>첨부</th><th>버전</th><th>상태</th><th>검증</th><th></th></tr></thead><tbody>' +
        subs.slice().sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); }).map(function (s) {
          var b = C.byId('buyers', s.buyer_id) || {};
          return '<tr><td>' + esc(C.when(s.at).slice(5)) + '</td><td><b>' + esc(b.name || s.buyer_name || '-') + '</b></td>' +
            '<td>' + esc(s.kind) + '</td><td class="num">' + (s.amount_eok ? n0(s.amount_eok, 0) + '억' : '-') + '</td>' +
            '<td>' + ((s.files || []).length ? esc(s.files.map(function (f) { return f.name; }).join(', ')) : '-') + '</td>' +
            '<td>v' + (s.version || 1) + '</td>' +
            '<td><span class="rfp-tag ' + (s.status === '확인' ? 'ok' : (s.status === '보완요청' ? 'off' : 'wait')) + '">' + esc(s.status || '제출') + '</span></td>' +
            '<td>' + esc(s.verify || '-') + (s.verify_by ? '<span class="rfp-muted">' + esc(s.verify_by) + '</span>' : '') + '</td>' +
            '<td class="nowrap">' + (s.kind === 'LOI' || s.kind === 'LOC' ? '<button type="button" class="mini-btn" data-pt-verify="' + esc(s.id) + '">검증</button>' : '') +
            '<button type="button" class="mini-btn" data-pt-sub-status="' + esc(s.id) + '">검토</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '</section>';

    /* 금융기관 */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>④ 금융기관 등록·인증</b><span>인증 ' + lenders.filter(function (l) { return l.status === '인증'; }).length + ' / ' + lenders.length + '</span></div>';
    if (!lenders.length) h += '<p class="rfp-hint">등록된 금융기관이 없습니다. 금융기관이 등록하면 담당자가 인증하고, 이후 LOI·LOC 검증을 맡습니다.</p>';
    else {
      h += '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr><th>금융기관</th><th>부서·담당</th><th>연락</th><th>상태</th><th>인증일</th><th>검증 건</th><th></th></tr></thead><tbody>' +
        lenders.map(function (l) {
          var cnt = confs.filter(function (c) { return c.lender_id === l.id && c.result === '검증'; }).length;
          return '<tr><td><b>' + esc(l.name) + '</b></td><td>' + esc([l.dept, l.manager].filter(Boolean).join(' · ') || '-') + '</td>' +
            '<td>' + esc([l.email, l.phone].filter(Boolean).join(' · ') || '-') + '</td>' +
            '<td>' + (l.status === '인증' ? '<span class="rfp-tag ok">인증</span>' : '<span class="rfp-tag wait">' + esc(l.status || '등록') + '</span>') + '</td>' +
            '<td>' + esc(l.verified_at || '-') + '</td><td class="ctr">' + cnt + '</td>' +
            '<td class="nowrap">' + (l.status !== '인증' ? '<button type="button" class="mini-btn" data-pt-lender-ok="' + esc(l.id) + '">인증</button>' : '') +
            '<button type="button" class="mini-btn" data-pt-lender-code="' + esc(l.id) + '">코드</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '</section>';

    /* LOI/LOC 검증 이력 */
    h += '<section class="rfp-panel"><div class="rfp-panel-head"><b>⑤ LOI/LOC 검증 이력</b><span>' + confs.length + '건</span></div>';
    if (!confs.length) h += '<p class="rfp-hint">금융기관이 LOI·LOC를 검증하면 누가·언제·어느 기관이 확인했는지 여기에 남습니다.</p>';
    else {
      h += '<div class="rfp-table-wrap"><table class="rfp-table"><thead><tr><th>일시</th><th>금융기관</th><th>매수자</th><th>구분</th><th>금액</th><th>LTV</th><th>결과</th><th>메모</th></tr></thead><tbody>' +
        confs.slice().sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); }).map(function (c) {
          var s = C.byId('bidSubs', c.sub_id) || {};
          var b = C.byId('buyers', s.buyer_id) || {};
          var l = C.byId('lenders', c.lender_id) || {};
          return '<tr><td>' + esc(C.when(c.at)) + '</td><td>' + esc(l.name || '-') + '</td><td>' + esc(b.name || '-') + '</td>' +
            '<td>' + esc(s.kind || '-') + '</td><td class="num">' + (c.amount_eok ? n0(c.amount_eok, 0) + '억' : '-') + '</td>' +
            '<td class="num">' + (c.ltv ? n0(c.ltv, 0) + '%' : '-') + '</td>' +
            '<td>' + (c.result === '검증' ? '<span class="rfp-tag ok">검증</span>' : '<span class="rfp-tag off">' + esc(c.result) + '</span>') + '</td>' +
            '<td>' + esc(c.memo || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '</section>';
    return h;
  }

  function openNotice() {
    var rfp = chosenRfp();
    var body = '<div class="rfp-formgrid">' +
      C.field('title', '공고명', rfp ? (rfp.asset_name || rfp.title) + ' 매각 입찰 공고' : '', 'text', { wide: true, req: true }) +
      C.field('open_at', '개시일', C.today(), 'date') +
      C.field('close_at', '마감일', C.addDays(C.today(), 21), 'date') +
      C.field('place', '접수처', '본 시스템(온라인)', 'text', { wide: true }) +
      C.field('docs', '참여 양식·요구 서류 (한 줄에 하나)', '입찰서(소정 양식)\n법인등기부등본\n인감증명서\n사업자등록증\nLOI(투자의향서)\nLOC(자금조달확인서)', 'textarea', { wide: true, rows: 7 }) +
      C.field('note', '안내', '', 'textarea', { wide: true, rows: 2 }) +
      '</div>';
    var m = C.modal('＋ 입찰 공고', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-pt="notice-save">공고 등록</button>'
    });
    m.querySelector('[data-pt="notice-save"]').addEventListener('click', function () {
      var title = C.fval(m, 'title');
      if (!title) { C.toast('공고명을 입력하세요.', true); return; }
      C.commit('notices', {
        id: C.uid('bid'), rfp_id: rfp ? rfp.id : '', title: title,
        open_at: C.fval(m, 'open_at'), close_at: C.fval(m, 'close_at'), place: C.fval(m, 'place'),
        docs: C.fval(m, 'docs').split('\n').map(function (x) { return x.trim(); }).filter(Boolean),
        note: C.fval(m, 'note'), status: '공고', at: new Date().toISOString()
      });
      C.closeModal(); paint(); C.toast('입찰 공고를 등록했습니다.');
    });
  }

  function openBuyer() {
    var body = '<p class="rfp-note">매수자 법인정보를 등록합니다. 서류 확인 후 <b>인증</b>으로 바꾸면 제출·검증이 이어집니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('name', '법인명', '', 'text', { req: true, wide: true }) +
      C.field('corp_no', '사업자등록번호', '', 'text') +
      C.field('ceo', '대표자', '', 'text') +
      C.field('addr', '본점 주소', '', 'text', { wide: true }) +
      C.field('contact', '담당자', '', 'text') +
      C.field('title', '직책', '', 'text') +
      C.field('email', '이메일', '', 'email') +
      C.field('phone', '연락처', '', 'tel') +
      C.field('note', '메모', '', 'text', { wide: true }) +
      '</div>';
    var m = C.modal('＋ 매수자 등록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-pt="buyer-save">등록</button>'
    });
    m.querySelector('[data-pt="buyer-save"]').addEventListener('click', function () {
      var name = C.fval(m, 'name');
      if (!name) { C.toast('법인명을 입력하세요.', true); return; }
      C.commit('buyers', {
        id: C.uid('buy'), name: name, corp_no: C.fval(m, 'corp_no'), ceo: C.fval(m, 'ceo'),
        addr: C.fval(m, 'addr'), contact: C.fval(m, 'contact'), title: C.fval(m, 'title'),
        email: C.fval(m, 'email'), phone: C.fval(m, 'phone'), note: C.fval(m, 'note'),
        status: '등록', at: new Date().toISOString()
      });
      C.closeModal(); paint(); C.toast('매수자를 등록했습니다. 서류 확인 후 인증하세요.');
    });
  }

  function openLender() {
    var body = '<p class="rfp-note">금융기관(대출기관)을 등록합니다. 담당자가 인증하면 LOI·LOC 검증 권한이 생깁니다.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('name', '금융기관', '', 'text', { req: true, wide: true, ph: '예) ○○은행 부동산금융부' }) +
      C.field('dept', '부서', '', 'text') +
      C.field('manager', '담당자', '', 'text') +
      C.field('email', '이메일', '', 'email') +
      C.field('phone', '연락처', '', 'tel') +
      C.field('note', '메모', '', 'text', { wide: true }) +
      '</div>';
    var m = C.modal('＋ 금융기관 등록', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-pt="lender-save">등록</button>'
    });
    m.querySelector('[data-pt="lender-save"]').addEventListener('click', function () {
      var name = C.fval(m, 'name');
      if (!name) { C.toast('금융기관명을 입력하세요.', true); return; }
      C.commit('lenders', {
        id: C.uid('lnd'), name: name, dept: C.fval(m, 'dept'), manager: C.fval(m, 'manager'),
        email: C.fval(m, 'email'), phone: C.fval(m, 'phone'), note: C.fval(m, 'note'),
        status: '등록', verified_at: '', at: new Date().toISOString()
      });
      C.closeModal(); paint(); C.toast('금융기관을 등록했습니다. 인증 절차를 진행하세요.');
    });
  }

  function openBidSubmission(noticeId, buyerId) {
    var rfp = chosenRfp();
    var notices = C.list('notices');
    var buyers = C.list('buyers');
    if (!notices.length) { C.toast('먼저 입찰 공고를 등록하세요.', true); return; }
    if (!buyers.length) { C.toast('먼저 매수자를 등록하세요.', true); return; }
    var notice = C.byId('notices', noticeId) || notices[0];
    var myBuyer = ss() && isBuyer() ? C.list('buyers').filter(function (b) { return b.name === ss().holder; })[0] : null;
    var body = '<p class="rfp-note">제출 구분을 고르고 파일을 첨부합니다. 같은 구분을 다시 제출하면 <b>버전이 올라갑니다</b>.</p>' +
      '<div class="rfp-formgrid">' +
      C.field('notice_id', '입찰 공고', notice.id, 'select', { options: notices.map(function (n) { return { v: n.id, l: n.title }; }), req: true }) +
      C.field('kind', '제출 구분', '입찰서', 'select', { options: ['입찰서', '증빙(법인등기·인감증명 등)', 'LOI', 'LOC'], req: true }) +
      (myBuyer ? '' : C.field('buyer_id', '매수자', buyerId || buyers[0].id, 'select', { options: buyers.map(function (b) { return { v: b.id, l: b.name }; }), req: true })) +
      C.field('amount_eok', '금액(억원)', '', 'number', { step: '1', ph: 'LOI/LOC·입찰가' }) +
      C.field('ltv', 'LTV(%)', '', 'number', { step: '1' }) +
      C.field('note', '메모', '', 'text', { wide: true }) +
      '</div>' +
      '<div class="rfp-attach"><div class="rfp-attach-head"><b>첨부 파일</b><button type="button" class="mini-btn" data-pt="bid-file">＋ 파일 추가</button></div>' +
      '<ul class="rfp-attach-list" id="ptBidFiles"></ul>' +
      '<p class="rfp-hint">법인등기부등본·인감증명 등 증빙과 LOI/LOC 원본을 첨부하세요(1건 900KB까지 보관).</p></div>';
    var m = C.modal('📝 입찰·매수자 제출', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-pt="bid-save">제출</button>'
    });
    var files = [];
    function paintF() {
      $('#ptBidFiles', m).innerHTML = files.length ? files.map(function (f, i) {
        return '<li><span>📎 ' + esc(f.name) + '</span><em>' + C.bytes(f.size) + '</em><button type="button" class="mini-btn" data-bfdel="' + i + '">×</button></li>';
      }).join('') : '<li class="empty">첨부 없음</li>';
    }
    paintF();
    m.addEventListener('click', function (e) {
      var d = e.target.closest('[data-bfdel]');
      if (d) { files.splice(Number(d.getAttribute('data-bfdel')), 1); paintF(); return; }
      if (e.target.closest('[data-pt="bid-file"]')) {
        C.pickFiles(true).then(function (list) {
          if (!list.length) return;
          Promise.all(list.map(function (f) {
            return C.readFile(f).then(function (r) { return { name: r.name, size: r.size, mime: r.mime, dataUrl: r.dataUrl || '', text: r.text || '' }; })
              .catch(function () { return { name: f.name, size: f.size, mime: f.type, dataUrl: '', text: '', note: '용량 초과 — 원본 미보관' }; });
          })).then(function (items) { files = files.concat(items); paintF(); });
        });
      }
    });
    m.querySelector('[data-pt="bid-save"]').addEventListener('click', function () {
      var nid = C.fval(m, 'notice_id');
      var bid = myBuyer ? myBuyer.id : C.fval(m, 'buyer_id');
      if (!bid) { C.toast('매수자를 선택하세요.', true); return; }
      var kind = C.fval(m, 'kind');
      var prev = C.list('bidSubs').filter(function (s) { return s.notice_id === nid && s.buyer_id === bid && s.kind === kind; });
      var ver = prev.length ? Math.max.apply(null, prev.map(function (s) { return s.version || 1; })) + 1 : 1;
      C.commit('bidSubs', {
        id: C.uid('bsub'), notice_id: nid, rfp_id: (C.byId('notices', nid) || {}).rfp_id || (rfp ? rfp.id : ''),
        buyer_id: bid, buyer_name: (C.byId('buyers', bid) || {}).name || '',
        kind: kind, amount_eok: C.fval(m, 'amount_eok'), ltv: C.fval(m, 'ltv'),
        files: files, version: ver, status: '제출', reviewer: '', note: C.fval(m, 'note'),
        at: new Date().toISOString()
      });
      C.closeModal(); paint(); C.toast(kind + ' 제출을 접수했습니다(v' + ver + ').');
    });
  }

  function openSubStatus(id) {
    var s = C.byId('bidSubs', id);
    if (!s) return;
    var body = '<div class="rfp-formgrid">' +
      C.field('status', '검토 상태', s.status || '제출', 'select', { options: ['제출', '검토중', '보완요청', '확인'] }) +
      C.field('reviewer', '검토자', s.reviewer || '', 'text') +
      C.field('note', '메모', s.note || '', 'textarea', { wide: true, rows: 3 }) +
      '</div>';
    var m = C.modal('검토 상태 변경', body, {
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-pt="subst-save">저장</button>'
    });
    m.querySelector('[data-pt="subst-save"]').addEventListener('click', function () {
      s.status = C.fval(m, 'status'); s.reviewer = C.fval(m, 'reviewer'); s.note = C.fval(m, 'note');
      s.reviewed_at = new Date().toISOString();
      C.commit('bidSubs', s); C.closeModal(); paint(); C.toast('검토 상태를 저장했습니다.');
    });
  }

  function openVerify(subId) {
    var s = C.byId('bidSubs', subId);
    if (!s) return;
    var lenders = C.list('lenders');
    var myLender = ss() && isLender() ? C.list('lenders').filter(function (l) { return l.name === ss().holder; })[0] : null;
    if (!lenders.length && !myLender) { C.toast('먼저 금융기관을 등록·인증하세요.', true); return; }
    var buyer = C.byId('buyers', s.buyer_id) || {};
    var body = '<p class="rfp-note"><b>' + esc(buyer.name || s.buyer_name || '-') + '</b> · ' + esc(s.kind) + ' · ' +
      (s.amount_eok ? n0(s.amount_eok, 0) + '억' : '금액 미기재') + ' · v' + (s.version || 1) +
      '<br>금융기관이 원본을 확인한 결과를 기록합니다(누가·언제·어느 기관).</p>' +
      '<div class="rfp-formgrid">' +
      (myLender ? '' : C.field('lender_id', '검증 금융기관', (lenders[0] || {}).id || '', 'select', { options: lenders.map(function (l) { return { v: l.id, l: l.name + (l.status === '인증' ? ' (인증)' : ' (미인증)') }; }), req: true })) +
      C.field('result', '결과', '검증', 'select', { options: ['검증', '부적합', '보류'] }) +
      C.field('amount_eok', '확인 금액(억원)', s.amount_eok || '', 'number', { step: '1' }) +
      C.field('ltv', 'LTV(%)', s.ltv || '', 'number', { step: '1' }) +
      C.field('memo', '확인 내용·메모', '', 'textarea', { wide: true, rows: 3, ph: '예) ○○은행 본점 발행 확인서 접수, 한도 1,200억' }) +
      '</div>';
    var m = C.modal('LOI/LOC 검증', body, {
      wide: true,
      footer: '<button type="button" class="btn btn-ghost" data-rfp="close">취소</button>' +
        '<button type="button" class="btn btn-primary" data-pt="verify-save">기록</button>'
    });
    m.querySelector('[data-pt="verify-save"]').addEventListener('click', function () {
      var lid = myLender ? myLender.id : C.fval(m, 'lender_id');
      var l = C.byId('lenders', lid) || {};
      if (l.status !== '인증') { C.toast('인증되지 않은 금융기관입니다. 먼저 인증하세요.', true); return; }
      var result = C.fval(m, 'result');
      C.commit('loiconf', {
        id: C.uid('conf'), sub_id: s.id, lender_id: lid, rfp_id: s.rfp_id || '',
        amount_eok: C.fval(m, 'amount_eok'), ltv: C.fval(m, 'ltv'), result: result,
        memo: C.fval(m, 'memo'), at: new Date().toISOString()
      });
      s.verify = result; s.verify_by = l.name + (l.manager ? ' ' + l.manager : ''); s.verify_at = new Date().toISOString();
      C.commit('bidSubs', s);
      C.closeModal(); paint(); C.toast('검증 결과를 기록했습니다.');
    });
  }

  function infoTab() {
    var l = ss() && isLender() ? C.list('lenders').filter(function (x) { return x.name === ss().holder; })[0] : null;
    if (!l) return '<div class="rfp-empty">기관 정보를 찾을 수 없습니다.</div>';
    var confs = C.list('loiconf').filter(function (c) { return c.lender_id === l.id; });
    return '<section class="rfp-panel"><div class="rfp-panel-head"><b>' + esc(l.name) + '</b><span>' + esc(l.status) + '</span></div>' +
      '<div class="rfp-formgrid">' +
      C.field('dept', '부서', l.dept || '', 'text', { disabled: true }) +
      C.field('manager', '담당자', l.manager || '', 'text', { disabled: true }) +
      C.field('email', '이메일', l.email || '', 'text', { disabled: true }) +
      C.field('phone', '연락처', l.phone || '', 'text', { disabled: true }) +
      '</div>' +
      '<p class="rfp-hint">인증일 ' + esc(l.verified_at || '-') + ' · 검증 ' + confs.length + '건</p></section>';
  }

  /* ─────────────────────────── 이벤트 ─────────────────────────── */
  function bind() {
    var h = host();
    h.addEventListener('submit', function (e) {
      if (e.target && e.target.id === 'ptGateForm') {
        e.preventDefault();
        var inp = document.getElementById('ptCode');
        enterCode(inp ? inp.value : '');
      }
    });
    h.addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-pt-tab]'))) { S.tab = b.getAttribute('data-pt-tab'); paint(); return; }
      if ((b = e.target.closest('[data-pt-use]'))) { enterCode(b.getAttribute('data-pt-use')); return; }
      if ((b = e.target.closest('[data-pt-rfp]'))) { S.rfpId = b.getAttribute('data-pt-rfp'); paint(); return; }
      if ((b = e.target.closest('[data-pt-sub]'))) { openSubmission(b.getAttribute('data-pt-sub')); return; }
      if ((b = e.target.closest('[data-pt-print]'))) {
        var r = C.rfpOf(b.getAttribute('data-pt-print'));
        if (r) C.printDoc(r.title, C.rfpHTML(r, { invites: false }));
        return;
      }
      if ((b = e.target.closest('[data-pt-doc]'))) { viewDocAs(b.getAttribute('data-pt-doc')); return; }
      if ((b = e.target.closest('[data-pt-dl]'))) { dlDoc(C.byId('docs', b.getAttribute('data-pt-dl'))); return; }
      if ((b = e.target.closest('[data-pt-code-off]'))) {
        var c = C.byId('codes', b.getAttribute('data-pt-code-off'));
        if (c && window.confirm(c.code + ' 코드를 종료할까요? 더 이상 접속할 수 없습니다.')) {
          c.status = '종료'; C.commit('codes', c); paint(); C.toast('코드를 종료했습니다.');
        }
        return;
      }
      if ((b = e.target.closest('[data-pt-ca-sign]'))) {
        var ca = C.byId('ca', b.getAttribute('data-pt-ca-sign'));
        if (ca) { ca.status = '체결'; ca.signed_at = C.today(); C.commit('ca', ca); paint(); C.toast('CA 체결로 표시했습니다.'); }
        return;
      }
      if ((b = e.target.closest('[data-pt-ca-code]'))) {
        var ca2 = C.byId('ca', b.getAttribute('data-pt-ca-code'));
        if (!ca2) return;
        if (ca2.status !== '체결') { C.toast('CA 체결 후 매수자 코드를 발급할 수 있습니다.', true); return; }
        var rec = C.issueCode({ rfp_id: ca2.rfp_id, holder_type: '매수자', holder: ca2.buyer, scope: ca2.scope, expires_at: C.addDays(C.today(), 45), note: 'CA 체결 매수자' });
        C.modal('매수자 승인 코드', '<div class="rfp-codebig">' + esc(rec.code) + '</div>' +
          '<p class="rfp-hint">' + esc(ca2.buyer) + ' · 만료 ' + esc(rec.expires_at) + ' · 공개 ' + esc((rec.scope || []).map(kindLabel).join(', ')) + '</p>',
          { footer: '<button type="button" class="btn btn-primary" data-rfp="close">확인</button>' });
        return;
      }
      if ((b = e.target.closest('[data-pt-buyer-ok]'))) {
        var by = C.byId('buyers', b.getAttribute('data-pt-buyer-ok'));
        if (by) { by.status = '인증'; by.verified_at = C.today(); C.commit('buyers', by); paint(); C.toast(by.name + '을(를) 인증했습니다.'); }
        return;
      }
      if ((b = e.target.closest('[data-pt-lender-ok]'))) {
        var ln = C.byId('lenders', b.getAttribute('data-pt-lender-ok'));
        if (ln) { ln.status = '인증'; ln.verified_at = C.today(); C.commit('lenders', ln); paint(); C.toast(ln.name + '을(를) 인증했습니다. LOI/LOC 검증이 가능합니다.'); }
        return;
      }
      if ((b = e.target.closest('[data-pt-lender-code]'))) {
        var ln2 = C.byId('lenders', b.getAttribute('data-pt-lender-code'));
        if (!ln2) return;
        if (ln2.status !== '인증') { C.toast('인증된 금융기관만 코드를 받을 수 있습니다.', true); return; }
        var rec2 = C.issueCode({ rfp_id: S.rfpId, holder_type: '금융기관', holder: ln2.name, scope: ['etc'], expires_at: C.addDays(C.today(), 60) });
        C.modal('금융기관 승인 코드', '<div class="rfp-codebig">' + esc(rec2.code) + '</div><p class="rfp-hint">' + esc(ln2.name) + ' · 만료 ' + esc(rec2.expires_at) + '</p>',
          { footer: '<button type="button" class="btn btn-primary" data-rfp="close">확인</button>' });
        return;
      }
      if ((b = e.target.closest('[data-pt-bidsub]'))) { openBidSubmission(b.getAttribute('data-pt-bidsub'), ''); return; }
      if ((b = e.target.closest('[data-pt-bidsub2]'))) { openBidSubmission('', b.getAttribute('data-pt-bidsub2')); return; }
      if ((b = e.target.closest('[data-pt-sub-status]'))) { openSubStatus(b.getAttribute('data-pt-sub-status')); return; }
      if ((b = e.target.closest('[data-pt-verify]'))) { openVerify(b.getAttribute('data-pt-verify')); return; }
      if ((b = e.target.closest('[data-pt-mk-sent]'))) {
        var mk = C.byId('marketing', b.getAttribute('data-pt-mk-sent'));
        if (mk) { mk.sent_at = new Date().toISOString(); C.commit('marketing', mk); paint(); C.toast('발송으로 기록했습니다.'); }
        return;
      }
      if ((b = e.target.closest('[data-pt-mk-resp]'))) {
        var mk2 = C.byId('marketing', b.getAttribute('data-pt-mk-resp'));
        if (!mk2) return;
        var resp = window.prompt('반응을 기록하세요 (예: 관심·자료요청·거절·무응답)', mk2.response || '');
        if (resp == null) return;
        mk2.response = resp; C.commit('marketing', mk2); paint();
        return;
      }
      if ((b = e.target.closest('[data-pt-mk-csv]'))) {
        var rid = b.getAttribute('data-pt-mk-csv');
        var rows = C.list('marketing').filter(function (m) { return m.rfp_id === rid; });
        C.csv('마케팅리스트_' + C.today().replace(/-/g, '') + '.csv',
          ['구분', '회사', '담당', '이메일', 'TM/IM', '발송', '반응', '메모'],
          rows.map(function (m) { return [m.pool, m.company, m.contact, m.email, m.tm_ver, m.sent_at || '', m.response, m.note]; }));
        return;
      }
      if ((b = e.target.closest('[data-pt-tmim]'))) {
        var r3 = chosenRfp();
        if (!r3) { C.toast('RFP를 선택하세요.', true); return; }
        if (window.NAI_HOME && window.NAI_HOME.brief) { window.NAI_HOME.brief(r3.asset_id, b.getAttribute('data-pt-tmim')); }
        else C.toast('TM/IM 기능을 불러오지 못했습니다.', true);
        return;
      }
      var act = (e.target.closest('[data-pt]') || {}).getAttribute && (e.target.closest('[data-pt]') || {}).getAttribute('data-pt');
      if (!act) return;
      if (act === 'logout') { C.setSession(null); C.clearApiToken(); S.err = ''; paint(); C.toast('승인 코드 세션을 종료했습니다.'); }
      else if (act === 'reload') { C.SYNC.checked = false; C.pullServer().then(paint); }
      else if (act === 'code-new') openCodeEditor();
      else if (act === 'access-log') openAccessLog(S.rfpId);
      else if (act === 'ca-new') openCA();
      else if (act === 'mk-pool') openMarketingPool();
      else if (act === 'mk-add') openMarketingAdd();
      else if (act === 'bid-new') openNotice();
      else if (act === 'buyer-new') openBuyer();
      else if (act === 'lender-new') openLender();
      else if (act === 'go-rfp') { if (window.naiShowView) window.naiShowView('rfp'); }
    });
    h.addEventListener('change', function (e) {
      if (!e.target) return;
      if (e.target.id === 'ptRfpSel' || e.target.id === 'ptRfpSel2') {
        if (e.target.value) { S.rfpId = e.target.value; paint(); }
      }
    });
  }

  /* ─────────────────────────── 진입 ─────────────────────────── */
  function show() {
    var h = host();
    if (!h) return;
    if (!ss() && !admin()) { paint(); return; }
    var list = visibleRfps();
    if (!S.rfpId && list.length) S.rfpId = list[0].id;
    paint();
    C.pullServer().then(function () { paint(); });
  }

  window.NAI_PORTAL = { show: show, state: S, enterCode: enterCode };
})();
