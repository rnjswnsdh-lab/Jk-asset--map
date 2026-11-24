/* =========================================================================
   Open AI Asset Bridge — report.js  (📊 2026 3Q 마켓 리포트 뷰어, 2026-11-24)
   - data/market_review_2026q3.json (NAI Korea Research 3분기 시장 보고서 구조화 데이터)
   - 홈 배너·헤더 버튼·바로가기 타일에서 팝업 모달로 바로 열립니다.
   - 외부 API·키 없이 정적 JSON 만 읽습니다(오프라인 캐시 후 재사용).
   ========================================================================= */
(function () {
  'use strict';

  var SRC = 'data/market_review_2026q3.json';
  var CACHE_KEY = 'nai-map:market-review:2026q3';
  var BOOT = { data: null, loading: null, el: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function n(v) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    return Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }
  function pct(v, plus) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    var s = (Math.round(v * 100) / 100).toLocaleString('ko-KR');
    return (plus && v > 0 ? '+' : '') + s + '%';
  }
  function pp(v) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    var s = (Math.round(v * 100) / 100).toLocaleString('ko-KR');
    return (v > 0 ? '+' : '') + s + '%p';
  }
  function eok(v) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    if (Math.abs(v) >= 10000) {
      var jo = Math.floor(v / 10000), rest = Math.round(v % 10000);
      return jo.toLocaleString('ko-KR') + '조' + (rest ? ' ' + rest.toLocaleString('ko-KR') + '억' : '');
    }
    return Number(v).toLocaleString('ko-KR') + '억';
  }
  function cls(v) { return v > 0 ? 'up' : (v < 0 ? 'down' : ''); }
  function arrow(v) { return v > 0 ? '▲' : (v < 0 ? '▼' : '–'); }

  function toast(msg, err) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3000);
  }

  /* ───────────── 데이터 로드 (정적 JSON → localStorage 캐시) ───────────── */
  function load() {
    if (BOOT.data) return Promise.resolve(BOOT.data);
    if (BOOT.loading) return BOOT.loading;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { cached = null; }
    if (cached && cached.office) { BOOT.data = cached; return Promise.resolve(cached); }
    BOOT.loading = fetch(SRC + '?v=20261124a', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        BOOT.data = j;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(j)); } catch (e2) { /* noop */ }
        BOOT.loading = null;
        return j;
      })
      .catch(function (err) {
        BOOT.loading = null;
        if (cached) return cached;
        throw err;
      });
    return BOOT.loading;
  }

  /* ─────────────────────────── 렌더 ─────────────────────────── */
  function kpi(label, value, sub, cls2) {
    return '<div class="rp-k' + (cls2 ? ' ' + cls2 : '') + '"><span>' + esc(label) + '</span>' +
      '<b>' + value + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>';
  }

  function districtTable(o) {
    var maxNoc = Math.max.apply(null, o.by_district.map(function (d) { return d.noc_won; }));
    return '<div class="rp-table-wrap"><table class="rp-table"><thead><tr>' +
      '<th>권역</th><th>명목임대료 NOC<br><span>(원/㎡·월)</span></th><th>전분기 대비</th>' +
      '<th>공실률</th><th>전분기 대비</th><th class="rp-bar-col">공실률 비교</th></tr></thead><tbody>' +
      o.by_district.map(function (d) {
        return '<tr><th>' + esc(d.district) + '</th>' +
          '<td class="num">' + n(d.noc_won) + '</td>' +
          '<td class="num ' + cls(d.noc_qoq_pct) + '">' + arrow(d.noc_qoq_pct) + ' ' + pct(d.noc_qoq_pct) + '</td>' +
          '<td class="num b">' + pct(d.vacancy_pct) + '</td>' +
          '<td class="num ' + cls(d.vacancy_qoq_pp) + '">' + arrow(d.vacancy_qoq_pp) + ' ' + pp(d.vacancy_qoq_pp) + '</td>' +
          '<td class="rp-bar-col"><span class="rp-bar"><i style="width:' +
          Math.max(6, Math.round(d.vacancy_pct / 6 * 100)) + '%"></i></span>' +
          '<em>' + pct(d.vacancy_pct) + '</em></td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><th>서울 전체</th><td class="num">' + n(o.noc_won) + '</td>' +
      '<td class="num ' + cls(o.noc_qoq_pct) + '">' + arrow(o.noc_qoq_pct) + ' ' + pct(o.noc_qoq_pct) + '</td>' +
      '<td class="num b">' + pct(o.vacancy_pct) + '</td>' +
      '<td class="num ' + cls(o.vacancy_qoq_pp) + '">' + arrow(o.vacancy_qoq_pp) + ' ' + pp(o.vacancy_qoq_pp) + '</td>' +
      '<td class="rp-bar-col"><span class="rp-bar"><i style="width:' +
      Math.max(6, Math.round(o.vacancy_pct / 6 * 100)) + '%"></i></span><em>' + pct(o.vacancy_pct) + '</em></td></tr></tfoot></table></div>' +
      '<p class="rp-hint">막대는 공실률 크기 비교용(최대 6% 기준)입니다. NOC = 명목임대료(Net Operating Cost 제외).</p>';
  }

  function dealTable(deals) {
    return '<div class="rp-table-wrap"><table class="rp-table rp-deals"><thead><tr>' +
      '<th>#</th><th>자산</th><th>소재지</th><th>연면적(평)</th><th>대지(평)</th><th>거래금액</th>' +
      '<th>평당(만원)</th><th>매수자</th><th>매도자</th><th>비고</th></tr></thead><tbody>' +
      deals.map(function (d) {
        return '<tr><td class="num">' + (d.rank || '') + '</td>' +
          '<th class="rp-deal-name">' + esc(d.name) + (d.note ? '<span class="rp-note">' + esc(d.note) + '</span>' : '') + '</th>' +
          '<td>' + esc(d.address || '') + '</td>' +
          '<td class="num">' + (d.gfa_py ? n(d.gfa_py) : '-') + '</td>' +
          '<td class="num">' + (d.land_py ? n(d.land_py) : '-') + '</td>' +
          '<td class="num b">' + eok(d.price_eok) + '</td>' +
          '<td class="num">' + (d.price_per_py_man ? n(d.price_per_py_man) : '-') + '</td>' +
          '<td>' + esc(d.buyer || '') + '</td><td>' + esc(d.seller || '') + '</td>' +
          '<td class="rp-remark">' + esc(d.remark || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function bodyHTML(d) {
    var o = d.office || {}, os = d.office_sales || {}, rt = d.retail || {}, rs = d.retail_sales || {};
    var H = d.headline || {};
    var h = '';

    /* 1. 표지 */
    h += '<section class="rp-cover">' +
      '<p class="rp-kicker">NAI KOREA RESEARCH · QUARTERLY</p>' +
      '<h2>2026 3Q <em>마켓 리포트</em></h2>' +
      '<p class="rp-msg">' + esc(d.message || '') + '</p>' +
      '<div class="rp-meta">' +
      '<span>기준일 ' + esc((d.meta && d.meta.as_of) || '') + '</span>' +
      '<span>발간 ' + esc((d.meta && d.meta.publisher) || 'NAI Korea Research') + '</span>' +
      '<span>' + esc((d.meta && d.meta.presented) || '') + '</span>' +
      '</div></section>';

    /* 2. 헤드라인 */
    h += '<section class="rp-sec"><h3>① 핵심 요약</h3><div class="rp-cols">' +
      '<div class="rp-col"><h4>🏢 오피스</h4><ul class="rp-li">' +
      (H.office || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="rp-col"><h4>🛍 리테일</h4><ul class="rp-li">' +
      (H.retail || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' +
      '</div></section>';

    /* 3. 오피스 임대 */
    h += '<section class="rp-sec"><h3>② 오피스 임대시장 <span>서울 · 2026 3Q</span></h3>' +
      '<div class="rp-kpis">' +
      kpi('서울 평균 NOC', n(o.noc_won) + '<small>원/㎡·월</small>', '전분기 ' + pct(o.noc_qoq_pct, true), 'good') +
      kpi('평균 공실률', pct(o.vacancy_pct), '전분기 ' + pp(o.vacancy_qoq_pp), cls(o.vacancy_qoq_pp) === 'down' ? 'good' : '') +
      kpi('신규 공급', n(o.new_supply_count) + '<small>건</small>', n(o.new_supply_py) + '평', '') +
      kpi('임대시장 방향', o.noc_qoq_pct > 0 ? '개선' : '약세', '임대료↑ · 공실↓', '') +
      '</div>' + districtTable(o) +
      '<ul class="rp-li rp-li-sm">' + (o.comments || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      '</section>';

    /* 4. 오피스 매매 */
    h += '<section class="rp-sec"><h3>③ 오피스 매매시장</h3><div class="rp-kpis rp-k4">' +
      kpi('분기 거래금액', eok(os.volume_eok), '전분기 ' + pct(os.qoq_pct, true), cls(os.qoq_pct)) +
      kpi('1,000억↑ 대형거래', n(os.big_deal_count) + '<small>건</small>', eok(os.big_deal_volume_eok), '') +
      kpi('대형거래 비중', pct(os.big_deal_share_pct), '전체 거래금액 대비', 'good') +
      kpi('시장 성격', '선별적 투자', '자기자본·사옥 확보 목적', '') +
      '</div><ul class="rp-li rp-li-sm">' +
      (os.comments || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></section>';

    /* 5. 리테일 */
    h += '<section class="rp-sec"><h3>④ 리테일 시장</h3>' +
      '<div class="rp-kpis rp-k4">' +
      kpi('신규 공급', n(rt.new_supply_count) + '<small>건</small>', '약 ' + n(Math.round((rt.new_supply_py || 0) / 10000 * 10) / 10) + '만 평 · 3년 최저', '') +
      kpi('중대형 공실률', pct(((rt.rent_table || [])[0] || {}).vacancy_2026Q3), '전분기 ' + pp(((rt.rent_table || [])[0] || {}).vacancy_qoq_pp), 'bad') +
      kpi('리테일 거래금액', eok(rs.volume_eok), '전분기 ' + pct(rs.qoq_pct, true), cls(rs.qoq_pct)) +
      kpi('CBD 거래금액', eok(rs.cbd_volume_eok), '권역 중 최대', 'good') +
      '</div>' +
      '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>구분</th>' +
      '<th>임대료 2026 2Q</th><th>임대료 2026 3Q</th><th>전분기 대비</th>' +
      '<th>공실률 2Q</th><th>공실률 3Q</th><th>전분기 대비</th></tr></thead><tbody>' +
      (rt.rent_table || []).map(function (r) {
        return '<tr><th>' + esc(r.type) + '</th><td class="num">' + n(r.rent_2026Q2) + '</td>' +
          '<td class="num b">' + n(r.rent_2026Q3) + '</td>' +
          '<td class="num ' + cls(r.rent_qoq_pct) + '">' + arrow(r.rent_qoq_pct) + ' ' + pct(r.rent_qoq_pct) + '</td>' +
          '<td class="num">' + pct(r.vacancy_2026Q2) + '</td><td class="num b">' + pct(r.vacancy_2026Q3) + '</td>' +
          '<td class="num ' + (r.vacancy_qoq_pp > 0 ? 'down' : 'up') + '">' + arrow(r.vacancy_qoq_pp) + ' ' + pp(r.vacancy_qoq_pp) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="rp-hint">임대료 단위: 원/㎡·월. ' +
      Object.keys(rt.definitions || {}).map(function (k) { return esc(k) + ' = ' + esc(rt.definitions[k]); }).join(' / ') + '</p>' +
      ((rs.top_deals || []).length ? '<div class="rp-topdeals">' + rs.top_deals.map(function (t) {
        return '<div class="rp-td"><span>개발형 대형 거래</span><b>' + esc(t.name) + '</b>' +
          '<em>' + eok(t.price_eok) + '</em><p>' + esc(t.buyer || '') + ' · ' + esc(t.remark || '') + '</p></div>';
      }).join('') + '</div>' : '') +
      '<ul class="rp-li rp-li-sm">' + (rs.comments || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></section>';

    /* 6. 주요 거래 20건 */
    h += '<section class="rp-sec"><h3>⑤ 주요 거래 <span>' + (d.deals || []).length + '건 · 2026 3Q</span></h3>' +
      dealTable(d.deals || []) +
      '<p class="rp-hint">연면적·대지는 평 환산값(㎡÷3.3058)입니다. “비신고거래”는 NAI Research 조사분입니다.</p></section>';

    /* 7. 인사이트 */
    var iv = (d.interview && d.interview.items) || [];
    h += '<section class="rp-sec"><h3>⑥ 인사이트 · 인터뷰</h3><div class="rp-ivs">' +
      iv.map(function (it) {
        return '<article class="rp-iv"><h4>' + esc(it.title) + '</h4>' +
          '<p class="rp-iv-sub">' + esc([it.author, it.subtitle, it.format].filter(Boolean).join(' · ')) + '</p>' +
          (it.themes ? '<ul class="rp-li rp-li-sm">' + it.themes.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '') +
          (it.key_facts ? '<ul class="rp-li rp-li-sm">' + it.key_facts.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '') +
          '</article>';
      }).join('') + '</div></section>';

    h += '<p class="rp-foot">출처: ' + esc((d.meta && d.meta.publisher) || 'NAI Korea Research') + ' 「' +
      esc((d.meta && d.meta.source_file) || '2026 Q3 Market Review') + '」 · ' +
      esc((d.meta && d.meta.note) || '') + '<br>본 리포트는 NAI Korea 내부·고객 검토용이며, 무단 복제·배포할 수 없습니다.</p>';
    return h;
  }

  /* ─────────────────────────── 모달 ─────────────────────────── */
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
    if (BOOT.data) { openModal('📊 2026 3Q 마켓 리포트', bodyHTML(BOOT.data), 'NAI Korea Research · 2026-09-30 기준'); return; }
    openModal('📊 2026 3Q 마켓 리포트', '<p class="rp-loading">리포트 데이터를 불러오는 중…</p>', '');
    load().then(function (d) {
      if (BOOT.el) BOOT.el.querySelector('.rp-body').innerHTML = bodyHTML(d);
    }).catch(function () {
      if (BOOT.el) BOOT.el.querySelector('.rp-body').innerHTML =
        '<p class="rp-loading">리포트 데이터를 열지 못했습니다. 잠시 후 다시 시도해 주세요.<br><code>' + esc(SRC) + '</code></p>';
      toast('마켓 리포트를 불러오지 못했습니다.', true);
    });
  }

  /* ───────────── 헤더 버튼 · 홈 배너 연결 ───────────── */
  function bindHeader() {
    var b = document.getElementById('btnReport');
    if (b && !b._bound) { b._bound = 1; b.addEventListener('click', open); }
  }

  window.NAI_REPORT = { open: open, close: close, load: load };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindHeader);
  else bindHeader();
  /* 로그인으로 헤더가 다시 그려지는 경우를 대비해 한 번 더 시도 */
  setTimeout(bindHeader, 1200);
})();
