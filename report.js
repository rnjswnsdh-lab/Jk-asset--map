/* =========================================================================
   Open AI Asset Bridge — report.js  (📊 2026 3Q 통합 마켓 리포트 뷰어, 2026-11-28)
   - market_report_2026q3.js (window.OAAB_MARKET_REPORT_2026Q3)를 읽어 모달로 렌더
   - 원칙: 모든 지표에 basis(전용·임대)·sample(프라임·전체·자체표본)·source 병기
   - 홈 배너·헤더 버튼에서 바로 열립니다. 외부 API·키 없이 정적 데이터만 사용
   ========================================================================= */
(function () {
  'use strict';

  var BOOT = { data: null, el: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function n(v) {
    if (v === null || v === undefined || v === '' || !isFinite(v)) return '-';
    return Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }
  function eok(v) {
    if (!isFinite(v) || v === null) return '-';
    if (Math.abs(v) >= 10000) {
      var jo = Math.floor(v / 10000), rest = Math.round(v % 10000);
      return jo.toLocaleString('ko-KR') + '조' + (rest ? ' ' + rest.toLocaleString('ko-KR') + '억' : '');
    }
    return Number(v).toLocaleString('ko-KR') + '억';
  }
  function toast(msg, err) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3000);
  }

  function load() {
    if (BOOT.data) return Promise.resolve(BOOT.data);
    var inline = window.OAAB_MARKET_REPORT_2026Q3 || null;
    if (inline && inline.lease) { BOOT.data = inline; return Promise.resolve(inline); }
    return Promise.reject(new Error('데이터 없음'));
  }

  function kpi(label, value, sub, cls2) {
    return '<div class="rp-k' + (cls2 ? ' ' + cls2 : '') + '"><span>' + esc(label) + '</span>' +
      '<b>' + value + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>';
  }

  /* ① 거시·금리 */
  function macroHTML(m) {
    if (!m) return '';
    return '<section class="rp-sec"><h3>① 거시·금리 <span>기준금리 · 국고채 · Cap 스프레드</span></h3>' +
      '<div class="rp-table-wrap"><table class="rp-table"><thead><tr>' +
      '<th>지표</th><th>2026 1Q</th><th>2Q</th><th>3Q</th><th>4Q(입력)</th><th>단위</th></tr></thead><tbody>' +
      (m.rows || []).map(function (r) {
        return '<tr><th>' + esc(r.label) + '</th>' +
          '<td class="num">' + esc(r.q1) + '</td>' +
          '<td class="num">' + esc(r.q2) + '</td>' +
          '<td class="num b">' + esc(r.q3) + '</td>' +
          '<td class="num">' + esc(r.q4) + '</td>' +
          '<td>' + esc(r.unit) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<ul class="rp-li rp-li-sm">' + (m.comments || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      '<p class="rp-hint">*Source : ★CM DA1 Market Data(전체시장)_261029 시트 1.거시경제(갱신 2026-10-29) · 4Q는 입력값(전망 성격)</p></section>';
  }

  /* ② 오피스 임대 — 공실률 2계열 + NOC 2계열 */
  function leaseHTML(l) {
    if (!l) return '';
    var b = l.bands || {};
    var vacancy = '<div class="rp-table-wrap"><table class="rp-table"><thead><tr>' +
      '<th>계열</th><th>기관(표본)</th><th>서울</th><th>CBD</th><th>GBD</th><th>YBD</th><th>기타</th><th>QoQ</th></tr></thead><tbody>' +
      (l.vacancy || []).map(function (r) {
        var c = r.cluster === '자체표본' ? ' style="opacity:.72"' : '';
        return '<tr' + c + '><th>' + esc(r.cluster) + '</th>' +
          '<td>' + esc(r.org) + '<br><span class="rp-note">' + esc(r.sample) + '</span></td>' +
          '<td class="num b">' + esc(r.seoul) + '</td>' +
          '<td class="num">' + esc(r.cbd) + '</td>' +
          '<td class="num">' + esc(r.gbd) + '</td>' +
          '<td class="num">' + esc(r.ybd) + '</td>' +
          '<td class="num">' + esc(r.etc) + '</td>' +
          '<td class="num">' + esc(r.qoq) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    var noc = '<div class="rp-table-wrap"><table class="rp-table"><thead><tr>' +
      '<th>구분</th><th>서울</th><th>CBD</th><th>GBD</th><th>YBD</th><th>면적 기준</th></tr></thead><tbody>' +
      (l.noc || []).map(function (r) {
        return '<tr><th>' + esc(r.label) + '</th>' +
          '<td class="num b">' + r.seoul + '</td>' +
          '<td class="num">' + r.cbd + '</td>' +
          '<td class="num">' + r.gbd + '</td>' +
          '<td class="num">' + r.ybd + '</td>' +
          '<td>' + esc(r.basis) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    return '<section class="rp-sec"><h3>② 오피스 임대시장 <span>공실률 2계열 · NOC 2계열 (2026 3Q)</span></h3>' +
      '<div class="rp-kpis">' +
      kpi('프라임 공실률', (b.prime || '-') + '<small>%</small>', 'CBRE~JLL 5개사 밴드', 'good') +
      kpi('전체 공실률', (b.all || '-') + '<small>%</small>', '알스퀘어·젠스타·CM', '') +
      kpi('NOC(전용)', '290,534<small>원/평</small>', 'CBD · 임대면적 환산 164,808', '') +
      kpi('자체표본', (b.own || '-') + '<small>%</small>', '각주 전용 · 외부 인용 금지', 'bad') +
      '</div>' + vacancy +
      '<p class="rp-hint">단위: % · 2026-09-30 기준. 프라임·A급과 전체 오피스는 표본이 달라 직접 비교하지 않습니다.</p>' +
      '<h4 style="margin:14px 0 8px;font-size:12.5px;color:#33475b">NOC · 임대료 — 단위 원/3.3㎡·월</h4>' + noc +
      '<p class="rp-hint">*Source : NAI Korea Research 3Q 발표본(NOC 전용) / ★CM DA1 Market Data 261029(명목임대·관리비, 2Q) / 젠스타메이트 3Q. 배율 1.76 = 1÷전용률 56.7%.</p>' +
      '<ul class="rp-li rp-li-sm">' + (l.comments || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></section>';
  }

  /* ③ 오피스 투자·거래 */
  function dealsHTML(d) {
    if (!d) return '';
    var t = d.total || {};
    var cap = '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>기관</th><th>Cap Rate</th><th>전분기</th><th>비고</th></tr></thead><tbody>' +
      (d.cap || []).map(function (r) {
        return '<tr><th>' + esc(r.org) + '</th><td class="num b">' + esc(r.value) + '%</td><td class="num">' + esc(r.prev) + '</td><td>' + esc(r.note) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    var q = '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>분기</th><th>건수</th><th>금액</th></tr></thead><tbody>' +
      (d.quarterly || []).map(function (r) {
        return '<tr><th>' + esc(r.q) + '</th><td class="num">' + n(r.count) + '</td><td class="num b">' + eok(r.eok) + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><th>2026 합계</th><td class="num">' + n(t.count) + '</td><td class="num">' + eok(t.eok) + '</td></tr></tfoot></table></div>';

    var reg = '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>권역</th><th>건수</th><th>금액</th><th>평균(만원/평)</th><th>중위</th><th>범위</th></tr></thead><tbody>' +
      (d.regions || []).map(function (r) {
        return '<tr><th>' + esc(r.region) + '</th><td class="num">' + n(r.count) + '</td><td class="num">' + eok(r.eok) + '</td>' +
          '<td class="num b">' + n(r.avg) + '</td><td class="num">' + n(r.median) + '</td>' +
          '<td class="num">' + n(r.min) + ' ~ ' + n(r.max) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    var buy = (d.buyers || []).map(function (r) {
      return '<li><b>' + esc(r.type) + '</b> ' + n(r.count) + '건 · ' + eok(r.eok) + ' (' + n(r.share) + '%)</li>';
    }).join('');

    var top = '<div class="rp-table-wrap"><table class="rp-table rp-deals"><thead><tr><th>#</th><th>자산</th><th>권역</th><th>연면적(평)</th><th>금액</th><th>평당(만원)</th><th>매수자</th></tr></thead><tbody>' +
      (d.top || []).map(function (r) {
        return '<tr><td class="num">' + n(r.rank) + '</td><th class="rp-deal-name">' + esc(r.name) + '</th>' +
          '<td>' + esc(r.region) + '</td><td class="num">' + esc(r.py) + '</td>' +
          '<td class="num b">' + esc(r.eok) + '</td><td class="num">' + esc(r.ppy) + '</td>' +
          '<td>' + esc(r.buyer) + '<br><span class="rp-note">' + esc(r.btype) + '</span></td></tr>';
      }).join('') + '</tbody></table></div>';

    return '<section class="rp-sec"><h3>③ 오피스 투자·거래 <span>2026년 35건 · 12.59조</span></h3>' +
      '<div class="rp-kpis">' +
      kpi('2026 거래', n(t.count) + '<small>건</small>', '1~3Q ' + n(t.q13_count) + '건 · ' + eok(t.q13_eok), 'good') +
      kpi('거래금액', eok(t.eok), '분기 3Q ' + eok(47996), '') +
      kpi('Cap Rate', '4.2~4.5<small>%</small>', '5개사 수렴 · 스프레드 0.10%p', '') +
      kpi('사옥 SI', '20.4<small>%</small>', '12건 2.56조', '') +
      '</div>' + cap +
      '<h4 style="margin:14px 0 8px;font-size:12.5px;color:#33475b">분기 거래 (CM Deal Status)</h4>' + q +
      '<h4 style="margin:14px 0 8px;font-size:12.5px;color:#33475b">권역별 평당가</h4>' + reg +
      '<h4 style="margin:14px 0 8px;font-size:12.5px;color:#33475b">매수자 구성</h4>' +
      '<ul class="rp-li rp-li-sm">' + buy + '</ul>' +
      '<h4 style="margin:14px 0 8px;font-size:12.5px;color:#33475b">2026년 상위 10건</h4>' + top +
      '<p class="rp-hint">*Source : ★CM DA1 Market Deal Status(거래사례)_261030 시트 Comparables(2026-10-30 갱신) · 각 사 3Q 리포트(Cap Rate)</p>' +
      '<ul class="rp-li rp-li-sm">' + (d.comments || []).map(function (t2) { return '<li>' + esc(t2) + '</li>'; }).join('') + '</ul></section>';
  }

  /* ④ 섹터 */
  function sectorHTML(list) {
    if (!list || !list.length) return '';
    return '<section class="rp-sec"><h3>④ 섹터 <span>물류 · 호텔 · DC · 리테일</span></h3>' +
      '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>섹터</th><th>2026 1~3Q 확인 내용</th><th>수치</th><th>근거</th><th>등급</th></tr></thead><tbody>' +
      list.map(function (r) {
        return '<tr><th>' + esc(r.sector) + '</th><td>' + esc(r.detail) + '</td>' +
          '<td class="num b">' + esc(r.numbers) + '</td><td class="rp-remark">' + esc(r.source) + '</td>' +
          '<td>' + esc(r.grade) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="rp-hint">CM Deal Status Comparables는 「Office Transaction Comparables」 단일 구성 — 물류·DC 거래는 0건입니다. 섹터 확장에는 별도 DB가 필요합니다.</p></section>';
  }

  /* ⑤ 전망·시사점 */
  function outlookHTML(o, imp) {
    var rows = (o || []).map(function (r) {
      return '<tr><th>' + esc(r.label) + '</th><td>' + esc(r.text) + '</td><td class="rp-remark">' + esc(r.tag) + '</td></tr>';
    }).join('');
    var im = (imp || []).map(function (r) {
      return '<li><b>' + esc(r.label) + '</b> — ' + esc(r.text) + '</li>';
    }).join('');
    return '<section class="rp-sec"><h3>⑤ 4Q 전망 및 시사점</h3>' +
      '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>항목</th><th>전망</th><th>근거</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' +
      '<h4 style="margin:14px 0 8px;font-size:12.5px;color:#33475b">시사점</h4>' +
      '<ul class="rp-li rp-li-sm">' + im + '</ul>' +
      '<p class="rp-hint">*Source : 세빌스 2026 Q3 / CM 1.거시경제·2.투자시장 / NAI Korea Research 3Q. [추정] 표기는 원문에 수치가 없어 자체 산출한 값입니다.</p></section>';
  }

  /* ⑥ 출처·한계 */
  function sourcesHTML(src, lim) {
    var s = (src || []).map(function (r) {
      return '<li>' + esc(r.org) + ' — ' + esc(r.doc) + ' <span class="rp-note">' + esc(r.date) + '</span>' +
        (r.url ? ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener">원문</a>' : '') + '</li>';
    }).join('');
    var l = (lim || []).map(function (r) {
      return '<li><b>' + esc(r.item) + '</b> — ' + esc(r.text) + '</li>';
    }).join('');
    return '<section class="rp-sec"><h3>⑥ 출처·한계</h3>' +
      '<h4 style="margin:0 0 8px;font-size:12.5px;color:#33475b">출처 일람 (' + (src || []).length + ')</h4>' +
      '<ul class="rp-li rp-li-sm">' + s + '</ul>' +
      '<h4 style="margin:14px 0 8px;font-size:12.5px;color:#33475b">한계와 후속 확인</h4>' +
      '<ul class="rp-li rp-li-sm">' + l + '</ul>' +
      '<p class="rp-hint">외부 리포트의 문장·도표·표 배열은 옮기지 않고, 수치·사실만 자체 표·자체 문장으로 재구성했습니다.</p></section>';
  }

  function bodyHTML(d) {
    var m = d.meta || {};
    var h = '';
    h += '<section class="rp-cover">' +
      '<p class="rp-kicker">' + esc(m.kicker || 'OAAB') + '</p>' +
      '<h2>2026 3Q <em>통합 마켓 리포트</em></h2>' +
      '<p class="rp-msg">' + esc(m.subtitle || '') + '</p>' +
      '<div class="rp-meta">' +
      '<span>기준일 ' + esc(m.as_of || '') + '</span>' +
      '<span>발간 ' + esc(m.published || '') + '</span>' +
      '<span>출처 ' + (m.sources || 12) + '종</span>' +
      '<span>' + esc(m.scope || '') + '</span>' +
      '</div></section>';

    h += '<section class="rp-sec"><h3>핵심 3문장</h3><ul class="rp-li">' +
      (d.headline || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      '<div class="rp-cols" style="margin-top:12px">' +
      (d.readme || []).slice(0, 2).map(function (r) {
        return '<div class="rp-col"><h4>' + esc(r.label) + '</h4><p style="margin:0;font-size:11.6px;color:#4a5b6b;line-height:1.6">' + esc(r.text) + '</p></div>';
      }).join('') + '</div>' +
      '<div class="rp-cols" style="margin-top:8px">' +
      (d.readme || []).slice(2, 4).map(function (r) {
        return '<div class="rp-col"><h4>' + esc(r.label) + '</h4><p style="margin:0;font-size:11.6px;color:#4a5b6b;line-height:1.6">' + esc(r.text) + '</p></div>';
      }).join('') + '</div></section>';

    h += macroHTML(d.macro);
    h += leaseHTML(d.lease);
    h += dealsHTML(d.deals);
    h += sectorHTML(d.sectors);
    h += outlookHTML(d.outlook, d.implications);
    h += sourcesHTML(d.sources, d.limits);

    h += '<p class="rp-foot">OAAB 통합 마켓 리포트 · ' + esc(m.as_of || '') + ' 기준 · ' + esc(m.published || '') + ' 발간<br>' +
      esc(m.note || '') + '<br>본 리포트는 NAI Korea 내부·고객 검토용이며, 수치의 기준(표본·면적)을 확인한 뒤 인용해야 합니다.</p>';
    return h;
  }

  /* 모달 */
  function close() {
    if (BOOT.el && BOOT.el.parentNode) BOOT.el.parentNode.removeChild(BOOT.el);
    BOOT.el = null;
    document.body.classList.remove('rp-open');
  }

  function openModal(title, body, sub) {
    close();
    var el = document.createElement('div');
    el.className = 'rp-modal';
    el.innerHTML = '<div class="rp-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="rp-head"><div><strong>' + esc(title) + '</strong>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>' +
      '<button type="button" class="rp-close" aria-label="닫기">×</button></div>' +
      '<div class="rp-body">' + body + '</div></div>';
    document.body.appendChild(el);
    document.body.classList.add('rp-open');
    BOOT.el = el;
    el.addEventListener('click', function (e) {
      if (e.target === el || e.target.closest('.rp-close')) close();
    });
    document.addEventListener('keydown', function esc2(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
    });
    return el;
  }

  function open() {
    if (BOOT.data) {
      openModal('📊 2026 3Q 통합 마켓 리포트', bodyHTML(BOOT.data), 'OAAB · 2026-09-30 기준 · 2026-11-28 발간');
      return;
    }
    openModal('📊 2026 3Q 통합 마켓 리포트', '<p class="rp-loading">리포트 데이터를 불러오는 중…</p>', '');
    load().then(function (d) {
      if (BOOT.el) BOOT.el.querySelector('.rp-body').innerHTML = bodyHTML(d);
    }).catch(function () {
      if (BOOT.el) BOOT.el.querySelector('.rp-body').innerHTML =
        '<p class="rp-loading">리포트 데이터를 열지 못했습니다. 잠시 후 다시 시도해 주세요.<br><code>market_report_2026q3.js</code></p>';
      toast('마켓 리포트를 불러오지 못했습니다.', true);
    });
  }

  function bindHeader() {
    var b = document.getElementById('btnReport');
    if (b && !b._bound) { b._bound = 1; b.addEventListener('click', open); }
  }

  window.NAI_REPORT = { open: open, close: close, load: load };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindHeader);
  else bindHeader();
  setTimeout(bindHeader, 1200);
})();
