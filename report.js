/* =========================================================================
   Open AI Asset Bridge — report.js  (📊 2026 3Q 통합 마켓 리포트 뷰어, 2026-11-28)
   - market_report_2026q3.js (window.OAAB_MARKET_REPORT_2026Q3)를 읽어 모달로 렌더
   - 2026-11-28 개편: 섹터 탭(요약·오피스·리테일·물류·호텔·DC·전망·출처) + 창 확대
   - 원칙: 모든 지표에 basis(면적·객실 기준)·sample(표본)·source·as_of 병기
   - 홈 배너·헤더 버튼·홈 섹터 타일에서 바로 엽니다. 외부 API·키 없이 정적 데이터만 사용
   ========================================================================= */
(function () {
  'use strict';

  var BOOT = { data: null, el: null, panel: 'summary' };

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
  function h4(t) { return '<h4 style="margin:14px 0 8px;font-size:12.5px;color:#33475b">' + esc(t) + '</h4>'; }

  /* 범용 표 — 섹터별 권역 지표 (2026-11-28 섹터 심화) */
  function tableHTML(tb) {
    if (!tb || !(tb.rows || []).length) return '';
    var cols = tb.cols || [];
    var head = '<thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead>';
    var body = (tb.rows || []).map(function (r) {
      return '<tr>' + r.map(function (c, i) {
        var v = String(c == null ? '' : c);
        var num = i > 0 && /^[\u2212+\-]?[\d,.]+\s*%p?$/.test(v);
        var tag = i === 0 ? 'th' : 'td';
        return '<' + tag + (num ? ' class="num"' : '') + '>' + esc(v) + '</' + tag + '>';
      }).join('') + '</tr>';
    }).join('');
    var foot = (tb.foot || []).length ? '<tfoot>' + tb.foot.map(function (r) {
      return '<tr>' + r.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr>';
    }).join('') + '</tfoot>' : '';
    return h4(tb.title) +
      '<div class="rp-table-wrap"><table class="rp-table">' + head + '<tbody>' + body + '</tbody>' + foot + '</table></div>' +
      (tb.note ? '<p class="rp-hint">' + esc(tb.note) + '</p>' : '') +
      '<p class="rp-hint">*Source : ' + esc(tb.source || '') + (tb.as_of ? ' · 기준 ' + esc(tb.as_of) : '') + '</p>';
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
      '<p class="rp-hint">*Source : NAI 내부 자료(2026-10-29 갱신) · 4Q는 입력값(전망 성격)</p></section>';
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
      kpi('전체 공실률', (b.all || '-') + '<small>%</small>', '알스퀘어·젠스타·NAI 내부 자료', '') +
      kpi('NOC(전용)', '290,534<small>원/평</small>', 'CBD · 임대면적 환산 164,808', '') +
      kpi('자체표본', (b.own || '-') + '<small>%</small>', '각주 전용 · 외부 인용 금지', 'bad') +
      '</div>' + vacancy +
      '<p class="rp-hint">단위: % · 2026-09-30 기준. 프라임·A급과 전체 오피스는 표본이 달라 직접 비교하지 않습니다.</p>' +
      h4('NOC · 임대료 — 단위 원/3.3㎡·월') + noc +
      '<p class="rp-hint">*Source : NAI 내부 자료(NOC 전용) / NAI 내부 자료(명목임대·관리비, 2Q) / 젠스타메이트 3Q. 배율 1.76 = 1÷전용률 56.7%.</p>' +
      '<ul class="rp-li rp-li-sm">' + (l.comments || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></section>';
  }

  /* ③ 오피스 투자·거래 */
  function dealsHTML(d) {
    if (!d) return '';
    var t = d.total || {};
    var cap = '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>기관</th><th>Cap Rate</th><th>전분기</th><th>비고</th></tr></thead><tbody>' +
      (d.cap || []).map(function (r) {
        return '<tr><th>' + esc(r.org) + '</th><td class="num b">' + esc(r.value) + (/^[\d.]+$/.test(String(r.value)) ? '%' : '') + '</td><td class="num">' + esc(r.prev) + '</td><td>' + esc(r.note) + '</td></tr>';
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
      var amt = (r.eok === null || r.eok === undefined || r.eok === 0) ? '금액 미확인' : eok(r.eok) + ' (' + n(r.share) + '%)';
      return '<li><b>' + esc(r.type) + '</b> ' + n(r.count) + '건 · ' + amt + '</li>';
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
      h4('분기 거래 (CM Deal Status)') + q +
      h4('권역별 평당가') + reg +
      h4('매수자 구성') + '<ul class="rp-li rp-li-sm">' + buy + '</ul>' +
      h4('2026년 상위 10건') + top +
      '<p class="rp-hint">*Source : NAI 내부 자료(거래사례) · 각 사 3Q 리포트(Cap Rate)</p>' +
      '<ul class="rp-li rp-li-sm">' + (d.comments || []).map(function (t2) { return '<li>' + esc(t2) + '</li>'; }).join('') + '</ul></section>';
  }

  /* ④ 섹터 — 요약 카드 (2026-11-28) */
  function sectorPanelHTML(sp) {
    if (!sp) return '';
    var kpis = (sp.kpis || []).map(function (k) {
      return '<div class="rp-k"><span>' + esc(k.label) + '</span><b>' + esc(k.value) +
        (k.unit ? '<small> ' + esc(k.unit) + '</small>' : '') + '</b><i>' + esc(k.basis || '') + '</i></div>';
    }).join('');

    var tables = (sp.tables || []).map(tableHTML).join('');

    var deals = '';
    if ((sp.deals || []).length) {
      deals = h4('대표 거래·사건') + '<div class="rp-table-wrap"><table class="rp-table"><thead><tr>' +
        '<th>자산 · 사건</th><th>시기</th><th>규모</th><th>기준</th><th>매수자</th></tr></thead><tbody>' +
        sp.deals.map(function (d) {
          return '<tr><th>' + esc(d.name) + '</th><td class="nowrap">' + esc(d.when || '-') + '</td>' +
            '<td class="num b">' + esc(d.size || '-') + '</td><td>' + esc(d.basis || '-') + '</td>' +
            '<td>' + esc(d.buyer || '-') + (d.source && d.source !== '-' ? '<br><span class="rp-note">' + esc(d.source) + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    var basis = (sp.kpis || []).map(function (k) {
      return '<li>' + esc(k.label) + ' <b>' + esc(k.value) + esc(k.unit || '') + '</b> — 기준 ' + esc(k.basis || '—') +
        ' · 표본 ' + esc(k.sample || '—') + ' · ' + esc(k.source || '—') + ' (' + esc(k.as_of || '—') + ')</li>';
    }).join('');

    return '<section class="rp-sec">' +
      '<div class="rp-sechead"><h3>' + esc(sp.icon || '') + ' ' + esc(sp.name) + ' <span>' + esc((sp.kpis || []).length + '개 지표 · ' + (sp.tables || []).length + '개 표 · ' + (sp.deals || []).length + '건 거래') + '</span></h3>' +
      '<span class="rp-grade">' + esc(sp.grade || '') + '</span></div>' +
      '<p class="rp-lead">' + esc(sp.lead || '') + '</p>' +
      '<div class="rp-kpis">' + kpis + '</div>' + tables + deals +
      '<div class="rp-cols" style="margin-top:12px">' +
      '<div class="rp-col"><h4>수요</h4><p style="margin:0;font-size:11.6px;color:#4a5b6b;line-height:1.65">' + esc(sp.demand || '—') + '</p></div>' +
      '<div class="rp-col"><h4>공급·가격</h4><p style="margin:0;font-size:11.6px;color:#4a5b6b;line-height:1.65">' + esc(sp.supply || '—') + '</p></div>' +
      '</div>' +
      '<p class="rp-impl"><b>시사점</b>' + esc(sp.implication || '') + '</p>' +
      '<ul class="rp-li rp-basis">' + basis + '</ul>' +
      '<p class="rp-hint">*Source : ' + esc(sp.source || '') + (sp.note ? ' · ' + esc(sp.note) : '') + '</p></section>';
  }

  /* ⑤ 전망·시사점 */
  function outlookHTML(o, imp) {
    var rows = (o || []).map(function (r) {
      return '<tr><th>' + esc(r.label) + '</th><td>' + esc(r.text) + '</td><td class="rp-remark">' + esc(r.tag) + '</td></tr>';
    }).join('');
    var im = (imp || []).map(function (r) {
      return '<li><b>' + esc(r.label) + '</b> — ' + esc(r.text) + '</li>';
    }).join('');
    return '<section class="rp-sec"><h3>4Q 전망 및 시사점 <span>오피스 · 물류 · DC</span></h3>' +
      '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>항목</th><th>전망</th><th>근거</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' +
      h4('시사점') + '<ul class="rp-li rp-li-sm">' + im + '</ul>' +
      '<p class="rp-hint">*Source : 세빌스 2026 Q3 / NAI 내부 자료(거시·투자) / JLL 3Q. [추정] 표기는 원문에 수치가 없어 자체 산출한 값입니다.</p></section>';
  }

  /* ⑥ 출처·한계 */
  function sourcesHTML(src, lim, next) {
    var s = (src || []).map(function (r) {
      return '<li>' + esc(r.org) + ' — ' + esc(r.doc) + ' <span style="color:#7b8a99;font-size:10.4px;white-space:nowrap">' + esc(r.date) + '</span>' +
        (r.url ? ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener" style="white-space:nowrap">원문</a>' : '') + '</li>';
    }).join('');
    var l = (lim || []).map(function (r) {
      return '<li><b>' + esc(r.item) + '</b> — ' + esc(r.text) + '</li>';
    }).join('');
    var nx = (next || []).map(function (r) {
      return '<li><b>' + esc(r.name) + '</b> (' + esc(r.status) + ') — ' + esc(r.note) + '</li>';
    }).join('');
    return '<section class="rp-sec"><h3>출처·한계</h3>' +
      h4('출처 일람 (' + (src || []).length + ')') +
      '<ul class="rp-li rp-li-sm">' + s + '</ul>' +
      h4('한계와 후속 확인') +
      '<ul class="rp-li rp-li-sm">' + l + '</ul>' +
      (nx ? h4('다음 섹터 (준비 중)') + '<div class="rp-next"><ul class="rp-li rp-li-sm" style="margin:0">' + nx + '</ul></div>' : '') +
      '<p class="rp-hint">외부 리포트의 문장·도표·표 배열은 옮기지 않고, 수치·사실만 자체 표·자체 문장으로 재구성했습니다. NAI 자료는 “NAI 내부 자료”로만 표기합니다.</p></section>';
  }

  /* 요약 — 섹터 한눈에 */
  function sectorGridHTML(d) {
    var home = d.sectors_home || [];
    if (!home.length) return '';
    var cards = home.map(function (s) {
      return '<button type="button" class="rp-homecard" data-rp-go="' + esc(s.key) + '">' +
        '<span>' + esc(s.icon || '') + ' ' + esc(s.name) + '</span>' +
        '<b>' + esc(s.value) + (s.unit ? '<small>' + esc(s.unit) + '</small>' : '') + '</b>' +
        '<em>' + esc(s.label) + '</em><em>' + esc(s.delta || '') + '</em></button>';
    }).join('');
    return '<section class="rp-sec"><h3>섹터 한눈에 <span>2026 3Q · 카드를 누르면 해당 섹터로</span></h3>' +
      '<div class="rp-homegrid">' + cards + '</div>' +
      '<p class="rp-hint">새로 추가된 섹터: 리테일 · 물류센터 · 호텔 · 데이터센터 (2026-11-28 갱신)</p></section>';
  }

  function coverHTML(d) {
    var m = d.meta || {};
    return '<section class="rp-cover">' +
      '<p class="rp-kicker">' + esc(m.kicker || 'OAAB') + '</p>' +
      '<h2>2026 3Q <em>통합 마켓 리포트</em></h2>' +
      '<p class="rp-msg">' + esc(m.subtitle || '') + '</p>' +
      '<div class="rp-meta">' +
      '<span>기준일 ' + esc(m.as_of || '') + '</span>' +
      '<span>발간 ' + esc(m.published || '') + '</span>' +
      '<span>섹터 갱신 ' + esc(m.sectors_updated || m.published || '') + '</span>' +
      '<span>출처 ' + (m.sources || (d.sources || []).length) + '종</span>' +
      '<span>' + esc(m.scope || '') + '</span>' +
      '</div></section>';
  }

  function summaryPanel(d) {
    var h = coverHTML(d);
    h += '<section class="rp-sec"><h3>핵심 4문장</h3><ul class="rp-li">' +
      (d.headline || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      '<div class="rp-cols" style="margin-top:12px">' +
      (d.readme || []).slice(0, 2).map(function (r) {
        return '<div class="rp-col"><h4>' + esc(r.label) + '</h4><p style="margin:0;font-size:11.6px;color:#4a5b6b;line-height:1.6">' + esc(r.text) + '</p></div>';
      }).join('') + '</div>' +
      '<div class="rp-cols" style="margin-top:8px">' +
      (d.readme || []).slice(2, 4).map(function (r) {
        return '<div class="rp-col"><h4>' + esc(r.label) + '</h4><p style="margin:0;font-size:11.6px;color:#4a5b6b;line-height:1.6">' + esc(r.text) + '</p></div>';
      }).join('') + '</div></section>';
    h += sectorGridHTML(d);
    return h;
  }

  function officePanel(d) {
    return '<section class="rp-sec"><h3>🏢 오피스 <span>임대 2계열 · 거래 35건 · Cap 4.2~4.5%</span></h3>' +
      '<p class="rp-lead">임대는 견조(프라임 공실 3.1~5.8%), 투자는 선별적(35건 12.59조), 가격은 금리 대비 조정 대기.</p></section>' +
      macroHTML(d.macro) + leaseHTML(d.lease) + tableHTML(d.office_rent) + dealsHTML(d.deals);
  }

  function tabsOf(d) {
    var tabs = [{ key: 'summary', label: '요약' }, { key: 'office', label: '🏢 오피스' }];
    (d.sectors_detail || []).forEach(function (sp) {
      tabs.push({ key: sp.key, label: (sp.icon || '') + ' ' + sp.name });
    });
    tabs.push({ key: 'outlook', label: '전망' });
    tabs.push({ key: 'sources', label: '출처·한계' });
    return tabs;
  }

  function bodyHTML(d) {
    var fresh = (d.meta && d.meta.new_sectors) || [];
    var tabs = tabsOf(d).map(function (t) {
      var isNew = fresh.indexOf(t.key) >= 0;
      return '<button type="button" class="' + (t.key === BOOT.panel ? 'on' : '') + '" data-rp-tab="' + esc(t.key) + '">' +
        esc(t.label) + (isNew ? '<i>NEW</i>' : '') + '</button>';
    }).join('');

    var panels = '';
    panels += '<div class="rp-panel' + (BOOT.panel === 'summary' ? ' on' : '') + '" data-rp-panel="summary">' + summaryPanel(d) + '</div>';
    panels += '<div class="rp-panel' + (BOOT.panel === 'office' ? ' on' : '') + '" data-rp-panel="office">' + officePanel(d) + '</div>';
    (d.sectors_detail || []).forEach(function (sp) {
      panels += '<div class="rp-panel' + (BOOT.panel === sp.key ? ' on' : '') + '" data-rp-panel="' + esc(sp.key) + '">' + sectorPanelHTML(sp) + '</div>';
    });
    panels += '<div class="rp-panel' + (BOOT.panel === 'outlook' ? ' on' : '') + '" data-rp-panel="outlook">' + outlookHTML(d.outlook, d.implications) + '</div>';
    panels += '<div class="rp-panel' + (BOOT.panel === 'sources' ? ' on' : '') + '" data-rp-panel="sources">' +
      sourcesHTML(d.sources, d.limits, d.sectors_next) + '</div>';

    return '<div class="rp-tabs" role="tablist">' + tabs + '</div>' + panels +
      '<p class="rp-foot">OAAB 통합 마켓 리포트 · ' + esc((d.meta || {}).as_of || '') + ' 기준 · ' + esc((d.meta || {}).published || '') + ' 발간<br>' +
      esc((d.meta || {}).note || '') + '<br>본 리포트는 NAI Korea 내부·고객 검토용이며, 수치의 기준(표본·면적)을 확인한 뒤 인용해야 합니다.</p>';
  }

  /* 탭 전환 */
  function showPanel(key) {
    if (!BOOT.el) return;
    BOOT.panel = key;
    var body = BOOT.el.querySelector('.rp-body');
    if (!body) return;
    Array.prototype.forEach.call(body.querySelectorAll('.rp-tabs button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-rp-tab') === key);
    });
    Array.prototype.forEach.call(body.querySelectorAll('.rp-panel'), function (p) {
      p.classList.toggle('on', p.getAttribute('data-rp-panel') === key);
    });
    var tabs = body.querySelector('.rp-tabs');
    if (tabs) {
      var top = tabs.offsetTop - 4;
      try { body.scrollTop = top > 0 ? top : 0; } catch (e) { /* noop */ }
    }
  }

  function bindBody(el) {
    if (!el || el._rpBodyBound) return;
    el._rpBodyBound = 1;
    el.addEventListener('click', function (e) {
      var t = e.target.closest('[data-rp-tab]');
      if (t) { showPanel(t.getAttribute('data-rp-tab')); return; }
      var g = e.target.closest('[data-rp-go]');
      if (g) { showPanel(g.getAttribute('data-rp-go')); }
    });
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
      if (e.key === 'Escape' && !document.documentElement.classList.contains('mg-panel-lock')) {
        close(); document.removeEventListener('keydown', esc2);
      }
    });
    /* 창 확대 — 더블클릭 또는 우측 상단 ⤢ (2026-11-28) */
    if (window.OAAB_GROW) window.OAAB_GROW.attach(el.querySelector('.rp-card'), { head: '.rp-head' });
    bindBody(el);
    return el;
  }

  function open(sectorKey) {
    BOOT.panel = sectorKey || 'summary';
    if (BOOT.data) {
      openModal('📊 2026 3Q 통합 마켓 리포트', bodyHTML(BOOT.data), 'OAAB · 2026-09-30 기준 · 2026-11-28 발간');
      return;
    }
    openModal('📊 2026 3Q 통합 마켓 리포트', '<p class="rp-loading">리포트 데이터를 불러오는 중…</p>', '');
    load().then(function (d) {
      if (BOOT.el) {
        var body = BOOT.el.querySelector('.rp-body');
        body.innerHTML = bodyHTML(d);
        bindBody(BOOT.el);
      }
    }).catch(function () {
      if (BOOT.el) BOOT.el.querySelector('.rp-body').innerHTML =
        '<p class="rp-loading">리포트 데이터를 열지 못했습니다. 잠시 후 다시 시도해 주세요.<br><code>market_report_2026q3.js</code></p>';
      toast('마켓 리포트를 불러오지 못했습니다.', true);
    });
  }

  function bindHeader() {
    var b = document.getElementById('btnReport');
    if (b && !b._bound) { b._bound = 1; b.addEventListener('click', function () { open(); }); }
  }

  window.NAI_REPORT = { open: open, close: close, load: load, showPanel: showPanel };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindHeader);
  else bindHeader();
  setTimeout(bindHeader, 1200);
})();
