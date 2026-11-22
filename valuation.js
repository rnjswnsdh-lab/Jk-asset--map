/* =========================================================================
   NAI Korea 상업용 부동산 통합 지도 — valuation.js
   📊 밸류에이션 · 수익성 시뮬레이터 (2026-11-22 신설)

   - 물건별 렌트롤·OPEX·CAPEX 자료를 바탕으로 매입~매각 현금흐름을 재계산
   - 이니셜 캡 ↔ 매입가 연동, 구간별 조달금리, 엑시트 캡
   - 2D 민감도: ① 이니셜 캡 × 엑시트 캡  ② 조달금리 × 엑시트 캡
   - 프리셋 3종: 종로플레이스(오피스), 종로플레이스(9·10F 엣지DC), 김포고촌 KMTC
   - 관리자(jk2026)는 시나리오를 비공개 시트(valuations)에 저장·불러오기
     읽기 전용(nai2026)은 저장 불가, 슬라이더·민감도 테스트는 자유
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var SYNC_URL = CFG.SYNC_URL || '';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ────────────────────────────── 표시 유틸 ────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function n0(v) { return (v === null || v === undefined || !isFinite(v)) ? '-' : Math.round(v).toLocaleString('ko-KR'); }
  function n1(v) { return (v === null || v === undefined || !isFinite(v)) ? '-' : (Math.round(v * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function pct1(v) { return (v === null || v === undefined || !isFinite(v)) ? '-' : (Math.round(v * 10) / 10).toFixed(1) + '%'; }
  function pct2(v) { return (v === null || v === undefined || !isFinite(v)) ? '-' : (Math.round(v * 100) / 100).toFixed(2) + '%'; }
  function num(v, d) { var n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : (d === undefined ? 0 : d); }
  function irrPct(v) { return (v === null || !isFinite(v)) ? '-' : pct2(v * 100); }

  function toast(msg, isErr) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.background = isErr ? '#b3262c' : '';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.add('hidden'); el.style.background = ''; }, 2800);
  }

  /* ═════════════════════════════ 프리셋 ═════════════════════════════════ */
  /* tags: 'doc' = 원문·공식자료에서 확인, 'assume' = 시장 가정치 */
  var PRESETS = [
    {
      id: 'jp-office',
      name: '종로플레이스 (오피스 기본)',
      short: '종플 오피스',
      asset_ids: ['off-008'],
      sector: 'office',
      src: '실제 체결 렌트롤(2026.10.31)·OPEX/CAPEX 원문(첨부 3·4·6) 기준 · 6대 시나리오 ② 에셋딜 단일 3,500억·10년 구조',
      memo: '내부 검토안(2026-11-20) ② 에셋딜 단일: 매입 3,500억·Going-in 4.58%·CoC 3.14%·IRR 10.13%',
      verify: '같은 입력에서 검토안 IRR 10.13%는 엑시트 캡 4.25%에서 재현됩니다(계산 10.16%). 검토안 표의 4.50%를 그대로 넣으면 9.07%로 내려갑니다.',
      notes: [
        '명목 임대료 99,788원/평·월 × 13,835평 × 12개월 = 연 165.7억 [원문: 첨부3 Rent roll 합계행]',
        '렌트프리 연 2.76개월(대상 3개월/년·기타 2.0~2.9개월 가중) → 실효 연 127.6억 [원문]',
        '관리비(CAM) 42,448원/평·월 연 70.5억 + 추가관리비·주차 6.0억 = 기타수입 76.5억 [원문: 첨부6 2025 실적]',
        'OPEX 38.7억(2025 영업비용 합계, 감가상각 제외) [원문: 첨부4]',
        '공실률 2.5%·임대료 상승 2.5%/년은 시장 가정 [가정]',
        '조달: 선순위 61% 5.2→4.6→4.0%, 중순위 6% 6.7→6.1→5.5% [원문: 6대 시나리오 조달구조]',
        '엑시트 캡 기본 4.25%는 검토안 IRR 재현용 — 검토안 표기 4.50% [가정·재현용]',
        'CoC 차이 [가정·해석]: 검토안 3.14%는 AMC·자산관리 등 연간 기타비용을 반영한 값으로 보이며, 렌트롤·OPEX 원문에는 없는 항목이라 기타비용 0으로 두었습니다(필요 시 입력).',
        '취득 부대비용 6.4%(에셋딜 취득세·법무·중개) [원문: 시나리오 후속과제 #4]'
      ],
      inp: {
        name: '종로플레이스', sector: 'office', area_py: 13835, hold_years: 10,
        anchor: 'price', price_eok: 3500, entry_cap: 0, acq_cost_pct: 6.4, exit_cost_pct: 0.5, exit_cap_pct: 4.25,
        rent_mode: 'annual', rent_annual: 165.7, rent_per_py_month: 99788, rf_months: 2.76,
        other_income: 76.5, vacancy_pct: 2.5, rent_growth_pct: 2.5,
        opex: 38.7, opex_growth_pct: 2.5, other_cost: 0,
        capex_initial: 0, capex_annual: 2.0, exit_capex: 0,
        add_noi: 0, add_noi_start: 2,
        ltv_senior: 61.1, ltv_mezz: 6.0, deposit_eok: 0,
        s_rate1: 5.2, s_rate2: 4.6, s_rate3: 4.0,
        m_rate1: 6.7, m_rate2: 6.1, m_rate3: 5.5,
        target_irr: 10
      }
    },
    {
      id: 'jp-dc',
      name: '종로플레이스 (9·10F 엣지DC 3,800억)',
      short: '종플 엣지DC',
      asset_ids: ['dc-151'],
      sector: 'datacenter',
      src: '6대 시나리오 ⑥ 9·10층 부분 엣지DC(매입 3,800억·총투자 4,600억·순증 NOI 57.5억) · 렌트롤·OPEX는 오피스와 동일',
      memo: '내부 검토안(2026-11-20) ⑥: CapEx 800억(60% PF 480억 @5.5%)·부채 3,103억·에쿼티 1,497억·CoC 1.63%·IRR 14.40%',
      verify: '같은 입력에서 검토안 IRR 14.40%는 엑시트 캡 4.10%에서 재현됩니다. 검토안 표의 4.50%를 그대로 넣으면 9.78%로 내려갑니다(표기와 수치가 맞지 않는 지점).',
      notes: [
        '매입 3,800억(평당 2,747만) + CapEx 800억 = 총투자 4,600억. 쉐어딜로 기존 대출 2,623억 승계 [원문: 6대 시나리오 ⑥]',
        '부채 3,103억 = 승계 2,623억(4.4%) + CapEx PF 480억(5.5%) → LTV 67.5% [원문]',
        '순증 NOI +57.5억: IT 3.2MW × 도심 엣지 상면료 28만원/kW·월 × 가동률 87% − 기존 9·10F 오피스 임대수입·DC 운영비, 2028년(2년차)부터 [원문]',
        '엑시트 캡 기본 4.10%는 검토안 IRR 14.40% 재현용 — 표기 4.50%를 넣으면 9.78% [가정·재현용]',
        '5년 보유·갱신비용 120억 매각가 차감 [원문: 6대 시나리오]',
        '선결 조건: 방송통신시설 용도변경 심의, 한전 예비전력 인입(2N 불가) [원문: Q&A 2026-11-20]'
      ],
      inp: {
        name: '종로플레이스 (9·10F 엣지DC)', sector: 'datacenter', area_py: 13835, hold_years: 5,
        anchor: 'price', price_eok: 3800, entry_cap: 0, acq_cost_pct: 0, exit_cost_pct: 0.5, exit_cap_pct: 4.10,
        rent_mode: 'annual', rent_annual: 165.7, rent_per_py_month: 99788, rf_months: 2.76,
        other_income: 76.5, vacancy_pct: 2.5, rent_growth_pct: 2.5,
        opex: 38.7, opex_growth_pct: 2.5, other_cost: 0,
        capex_initial: 800, capex_annual: 1.0, exit_capex: 120,
        add_noi: 57.5, add_noi_start: 2,
        ltv_senior: 57.02, ltv_mezz: 10.43, deposit_eok: 0,
        s_rate1: 4.4, s_rate2: 4.4, s_rate3: 4.4,
        m_rate1: 5.5, m_rate2: 5.5, m_rate3: 5.5,
        target_irr: 14
      }
    },
    {
      id: 'gimpo-kmtc',
      name: '김포고촌 KMTC 물류센터',
      short: '김포고촌',
      asset_ids: ['log-049'],
      sector: 'logistics',
      src: '하나대체86호 2026년 9월 월간보고서(렌트롤 시트 3.2·P/L 시트 4) + NAI 매각주관사 제안서(2026-10-30) 정량 가정',
      memo: '제안서 FI 기준: 매입 365억(평당 862만)·LTV 60%·All-in 5.6~5.7%·Exit 5.5%·IRR 10.09%·배당 4.35%. 목표 매각가 400억(평당 945만)',
      verify: '검토안 IRR 10.09%는 엑시트 캡 4.50%에서 재현됩니다(계산 10.26%). 제안서에 적힌 Exit 5.50%를 넣으면 IRR이 2.24%로 떨어집니다 — 365억 매입·5.5% 엑시트 조합은 성립하지 않습니다.',
      notes: [
        '연면적 13,998.35㎡ = 4,234.5평, 지하1~지상6층, 2016-07 준공, 임대율 100% [원문: 월간보고서 1.0·3.2]',
        'KMTC로지스틱스(구 고려해운항공) 전층 통임차, 2016-08~2031-07, 매년 8월 1.58% 인상, 연 RF 2개월(0.5개월×4회) [원문: 3.2 Rent roll]',
        '명목 임대료 47,000원/평·월 × 4,234.5평 = 월 1.99억 / 연 23.9억, 보증금 35.97억 [원문: 3.2]',
        '관리비는 실비 정산(통임차) → 기타수입 3.18억·OPEX 4.25억은 2026년 P/L 연환산 [원문: 4.2 P/L 16기 누적 9개월]',
        '매입 365억은 제안서 FI 기준 매각가 상한(목표 매각가 400억·SI 사용가치 391~413억) [원문: 제안서 31~32p]',
        '취득 부대비용 7.7%(28억)·승계 보증금 36억 = 제안서 조달표 [원문]',
        '엑시트 캡 기본 4.50%(인근 3Q25 4%대 거래·김포고촌 4.54% 사례) — 제안서 표기 5.50%와 다름 [가정]',
        'Going-in Cap 5.16%: 제안서 5.5%는 관리비 정산 마진을 0으로 보고 잔여비용만 차감한 NOI 20.1억 기준. 원문 P/L 기준 NOI는 18.8억 [원문·P/L]'
      ],
      inp: {
        name: '김포고촌 KMTC 물류센터', sector: 'logistics', area_py: 4234.5, hold_years: 5,
        anchor: 'price', price_eok: 365, entry_cap: 0, acq_cost_pct: 7.7, exit_cost_pct: 0.5, exit_cap_pct: 4.5,
        rent_mode: 'pyeong', rent_annual: 23.9, rent_per_py_month: 47000, rf_months: 2.0,
        other_income: 3.18, vacancy_pct: 0, rent_growth_pct: 1.58,
        opex: 4.25, opex_growth_pct: 2.0, other_cost: 0,
        capex_initial: 0, capex_annual: 0.5, exit_capex: 0,
        add_noi: 0, add_noi_start: 2,
        ltv_senior: 46.6, ltv_mezz: 0, deposit_eok: 36,
        s_rate1: 5.7, s_rate2: 5.3, s_rate3: 5.3,
        m_rate1: 0, m_rate2: 0, m_rate3: 0,
        target_irr: 10
      }
    }
  ];

  function presetById(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  /* ═════════════════════════════ 엔진 ═══════════════════════════════════ */
  function rateAt(inp, kind, y) {
    var k1 = kind === 's' ? 's_rate1' : 'm_rate1';
    var k2 = kind === 's' ? 's_rate2' : 'm_rate2';
    var k3 = kind === 's' ? 's_rate3' : 'm_rate3';
    var r = (y <= 2) ? num(inp[k1]) : (y <= 5 ? num(inp[k2]) : num(inp[k3]));
    return r / 100;
  }

  function derive(inp) {
    var area = num(inp.area_py);
    var rentAnnual = (inp.rent_mode === 'pyeong')
      ? area * num(inp.rent_per_py_month) * 12 / 1e8
      : num(inp.rent_annual);
    var rf = num(inp.rf_months) / 12;
    if (rf > 1) rf = 1;
    var eff = rentAnnual * (1 - rf);
    var other = num(inp.other_income);
    var vac = num(inp.vacancy_pct) / 100;
    var income1 = (eff + other) * (1 - vac);
    var opex1 = num(inp.opex);
    return { area: area, rentAnnual: rentAnnual, eff: eff, other: other, income1: income1, opex1: opex1, noi1: income1 - opex1 };
  }

  function irr(cfs) {
    var hasPos = false, hasNeg = false;
    for (var i = 0; i < cfs.length; i++) { if (cfs[i] > 0) hasPos = true; if (cfs[i] < 0) hasNeg = true; }
    if (!hasPos || !hasNeg) return NaN;
    var lo = -0.9999, hi = 5;
    var npv = function (r) {
      var s = 0;
      for (var t = 0; t < cfs.length; t++) s += cfs[t] / Math.pow(1 + r, t);
      return s;
    };
    if (npv(lo) * npv(hi) > 0) return NaN;
    for (var k = 0; k < 300; k++) {
      var mid = (lo + hi) / 2;
      if (npv(mid) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** 핵심 계산: inp → 연도별 현금흐름 + KPI */
  function calc(inp) {
    var d = derive(inp);
    var noi1 = d.noi1;

    var price = num(inp.price_eok);
    var capIn = num(inp.entry_cap) / 100;
    if (inp.anchor === 'cap' && capIn > 0) price = noi1 / capIn;
    if (!(price > 0)) price = 0;
    var entryCap = price > 0 ? noi1 / price : NaN;

    var acq = price * num(inp.acq_cost_pct) / 100;
    var capex0 = num(inp.capex_initial);
    var total = price + acq + capex0;

    var senior = total * num(inp.ltv_senior) / 100;
    var mezz = total * num(inp.ltv_mezz) / 100;
    var deposit = num(inp.deposit_eok);
    var equity = total - senior - mezz - deposit;

    var N = Math.max(1, Math.min(20, Math.round(num(inp.hold_years, 5))));
    var g = num(inp.rent_growth_pct) / 100;
    var go = num(inp.opex_growth_pct) / 100;
    var vac = num(inp.vacancy_pct) / 100;
    var addNoi = num(inp.add_noi);
    var addStart = Math.max(1, Math.round(num(inp.add_noi_start, 2)));
    var capexY = num(inp.capex_annual);
    var exitCapex = num(inp.exit_capex);
    var otherCost = num(inp.other_cost);
    var exitCap = num(inp.exit_cap_pct) / 100;
    var exitCost = num(inp.exit_cost_pct) / 100;

    var rows = [];
    var unlev = [-total], lev = [-equity];
    var cum = 0, cocSum = 0, dscrMin = Infinity, lastNoi = noi1;

    for (var y = 1; y <= N; y++) {
      var rentY = d.eff * Math.pow(1 + g, y - 1);
      var otherY = d.other * Math.pow(1 + g, y - 1);
      var incomeY = (rentY + otherY) * (1 - vac);
      var opexY = d.opex1 * Math.pow(1 + go, y - 1);
      var addY = (y >= addStart) ? addNoi : 0;
      var noiY = incomeY - opexY + addY;

      var iS = rateAt(inp, 's', y), iM = rateAt(inp, 'm', y);
      var interest = senior * iS + mezz * iM;
      var capex = capexY + (y === N ? exitCapex : 0);
      var ncf = noiY - interest - capex - otherCost;

      cum += ncf;
      cocSum += equity > 0 ? ncf / equity : 0;
      var dscr = interest > 0 ? (noiY - capex - otherCost) / interest : NaN;
      if (isFinite(dscr)) dscrMin = Math.min(dscrMin, dscr);
      lastNoi = noiY;

      rows.push({
        y: y, rent: rentY, other: otherY, income: incomeY, opex: opexY, add: addY, noi: noiY,
        rateS: iS * 100, rateM: iM * 100, interest: interest, capex: capex, other_cost: otherCost,
        ncf: ncf, cum: cum, dscr: dscr, coc: equity > 0 ? ncf / equity : NaN
      });

      unlev.push(noiY - capex - otherCost);
      lev.push(ncf);
    }

    var exitNoi = lastNoi * (1 + g);
    var exitValue = exitCap > 0 ? exitNoi / exitCap : NaN;
    var netSale = exitValue * (1 - exitCost) - exitCapex;
    var debtEnd = senior + mezz;

    unlev[N] += netSale;
    lev[N] += netSale - debtEnd - deposit;

    var uIrr = irr(unlev), lIrr = irr(lev);
    var sumLev = 0;
    for (var i = 1; i < lev.length; i++) sumLev += lev[i];
    var em = equity > 0 ? sumLev / equity : NaN;
    var avgCoc = equity > 0 ? cocSum / N : NaN;

    return {
      d: d, price: price, entryCap: entryCap, acq: acq, capex0: capex0, total: total,
      senior: senior, mezz: mezz, deposit: deposit, equity: equity,
      ltv: total > 0 ? (senior + mezz) / total * 100 : 0,
      noi1: noi1, rows: rows, N: N,
      exitNoi: exitNoi, exitValue: exitValue, netSale: netSale, debtEnd: debtEnd,
      unlevIrr: uIrr, levIrr: lIrr, em: em, avgCoc: avgCoc, dscrMin: dscrMin,
      pricePerPy: price > 0 && d.area > 0 ? price * 1e8 / d.area : 0,
      exitPerPy: isFinite(netSale) && d.area > 0 ? netSale * 1e8 / d.area : 0
    };
  }

  /* ═════════════════════════════ 상태 ══════════════════════════════════ */
  var S = {
    inp: null,
    presetId: 'jp-office',
    metric1: 'irr',       // irr | em | exit | coc
    metric2: 'irr',       // irr | coc | em
    step: 0.25,           // %p
    cells: 2,             // ±n
    saved: [],            // 시트 저장 시나리오
    savedLoaded: false,
    role: 'readonly',
    booted: false
  };

  function clone(o) {
    var out = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    return out;
  }

  /* ═════════════════════════════ 렌더 ══════════════════════════════════ */
  var FIELDS = [
    { g: '기초 자산', items: [
      { k: 'name', l: '물건명', t: 'text', w: 2 },
      { k: 'sector', l: '섹터', t: 'select', w: 1, opts: [['office', '오피스'], ['logistics', '물류센터'], ['datacenter', '데이터센터'], ['hotel', '호텔']] },
      { k: 'area_py', l: '연면적(평)', t: 'num', step: 1, w: 1 },
      { k: 'hold_years', l: '보유기간(년)', t: 'num', step: 1, min: 3, max: 10, w: 1 }
    ] },
    { g: '매입·매각', items: [
      { k: 'price_eok', l: '매입가(억원)', t: 'num', step: 1, link: 'price', w: 1 },
      { k: 'entry_cap', l: '이니셜 캡레이트(%)', t: 'num', step: 0.01, link: 'cap', w: 1 },
      { k: 'acq_cost_pct', l: '매입 부대비용(%)', t: 'num', step: 0.1, w: 1 },
      { k: 'exit_cost_pct', l: '매각 부대비용(%)', t: 'num', step: 0.1, w: 1 },
      { k: 'exit_cap_pct', l: '엑시트 캡레이트(%)', t: 'num', step: 0.05, w: 1 }
    ] },
    { g: '임대수입', items: [
      { k: 'rent_mode', l: '임대료 입력 방식', t: 'select', w: 2, opts: [['annual', '연 임대수입(억원) 직접'], ['pyeong', '평당 월 임대료(원)']] },
      { k: 'rent_annual', l: '연 임대수입(억원)', t: 'num', step: 0.1, w: 1, when: 'annual' },
      { k: 'rent_per_py_month', l: '평당 월 임대료(원)', t: 'num', step: 100, w: 1, when: 'pyeong' },
      { k: 'rf_months', l: '렌트프리(연 개월)', t: 'num', step: 0.1, w: 1 },
      { k: 'other_income', l: '관리비·주차·기타(억/년)', t: 'num', step: 0.1, w: 1 },
      { k: 'vacancy_pct', l: '공실률(%)', t: 'num', step: 0.1, w: 1 },
      { k: 'rent_growth_pct', l: '임대료 상승률(%/년)', t: 'num', step: 0.1, w: 1 }
    ] },
    { g: 'OPEX·CAPEX', items: [
      { k: 'opex', l: 'OPEX(억원/년)', t: 'num', step: 0.1, w: 1 },
      { k: 'opex_growth_pct', l: 'OPEX 상승률(%/년)', t: 'num', step: 0.1, w: 1 },
      { k: 'other_cost', l: '기타비용(AMC·자산관리 등, 억/년)', t: 'num', step: 0.1, w: 1 },
      { k: 'capex_initial', l: '초기 CAPEX(억원)', t: 'num', step: 1, w: 1 },
      { k: 'capex_annual', l: '연간 CAPEX(억원)', t: 'num', step: 0.1, w: 1 },
      { k: 'exit_capex', l: '엑시트 갱신비용(억원)', t: 'num', step: 1, w: 1 },
      { k: 'add_noi', l: '밸류애드 추가 NOI(억/년)', t: 'num', step: 0.5, w: 1 },
      { k: 'add_noi_start', l: '추가 NOI 시작 연차', t: 'num', step: 1, min: 1, max: 10, w: 1 }
    ] },
    { g: '자본구조 · 구간별 금리', items: [
      { k: 'ltv_senior', l: '선순위 LTV(%)', t: 'num', step: 0.1, w: 1 },
      { k: 'ltv_mezz', l: '중순위·메자닌 LTV(%)', t: 'num', step: 0.1, w: 1 },
      { k: 'deposit_eok', l: '승계 임차보증금(억원)', t: 'num', step: 1, w: 1 },
      { k: 's_rate1', l: '선순위 1~2년차(%)', t: 'num', step: 0.05, w: 1 },
      { k: 's_rate2', l: '선순위 3~5년차(%)', t: 'num', step: 0.05, w: 1 },
      { k: 's_rate3', l: '선순위 6년차 이후(%)', t: 'num', step: 0.05, w: 1 },
      { k: 'm_rate1', l: '중순위 1~2년차(%)', t: 'num', step: 0.05, w: 1 },
      { k: 'm_rate2', l: '중순위 3~5년차(%)', t: 'num', step: 0.05, w: 1 },
      { k: 'm_rate3', l: '중순위 6년차 이후(%)', t: 'num', step: 0.05, w: 1 }
    ] },
    { g: '목표', items: [
      { k: 'target_irr', l: '목표 IRR(%) — 민감도 색상 기준', t: 'num', step: 0.5, w: 2 }
    ] }
  ];

  function fieldHTML(f, v) {
    if (f.when && S.inp.rent_mode !== f.when) return '';
    var id = 'v-' + f.k;
    var label = '<label for="' + id + '">' + esc(f.l) + '</label>';
    var inp;
    if (f.t === 'select') {
      inp = '<select id="' + id + '" data-k="' + f.k + '">' + f.opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(S.inp[f.k]) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    } else if (f.t === 'text') {
      inp = '<input id="' + id + '" data-k="' + f.k + '" type="text" value="' + esc(v) + '">';
    } else {
      inp = '<input id="' + id + '" data-k="' + f.k + '" type="number" inputmode="decimal" value="' + esc(v) + '"' +
        (f.step ? ' step="' + f.step + '"' : '') + (f.min !== undefined ? ' min="' + f.min + '"' : '') + (f.max !== undefined ? ' max="' + f.max + '"' : '') + '>';
    }
    return '<div class="vf' + (f.w === 2 ? ' wide' : '') + '">' + label + inp + '</div>';
  }

  function inputsHTML(r) {
    var out = '';
    FIELDS.forEach(function (grp) {
      out += '<section class="vg"><h4>' + esc(grp.g) + '</h4><div class="vg-grid">';
      grp.items.forEach(function (f) {
        var v = S.inp[f.k];
        if (f.k === 'entry_cap') v = (Math.round(num(r.entryCap) * 10000) / 100).toFixed(2);
        if (f.k === 'price_eok' && S.inp.anchor === 'cap') v = Math.round(num(r.price) * 10) / 10;
        out += fieldHTML(f, v);
      });
      out += '</div></section>';
    });
    return out;
  }

  function presetHTML() {
    return PRESETS.map(function (p) {
      return '<button type="button" class="vp-btn' + (S.presetId === p.id ? ' is-on' : '') + '" data-preset="' + p.id + '">' + esc(p.short || p.name) + '</button>';
    }).join('');
  }

  function kpiHTML(r) {
    var cur = presetById(S.presetId);
    var target = num(S.inp.target_irr);
    var irrOk = isFinite(r.levIrr) && r.levIrr * 100 >= target;
    function card(label, value, sub, cls) {
      return '<div class="vk' + (cls ? ' ' + cls : '') + '"><span class="vk-l">' + esc(label) + '</span>' +
        '<span class="vk-v">' + value + '</span>' + (sub ? '<span class="vk-s">' + sub + '</span>' : '') + '</div>';
    }
    return [
      card('매입가', n0(r.price) + '억', '평당 ' + n0(r.pricePerPy / 1e4) + '만원'),
      card('총투자비', n0(r.total) + '억', '부대비용 ' + n0(r.acq) + '억 · CAPEX ' + n0(r.capex0) + '억'),
      card('에쿼티', n0(r.equity) + '억', '부채 ' + n0(r.senior + r.mezz) + '억 · LTV ' + pct1(r.ltv)),
      card('Y1 NOI', n1(r.noi1) + '억', 'Going-in Cap ' + pct2(r.entryCap * 100)),
      card('Levered IRR', irrPct(r.levIrr), '목표 ' + n1(target) + '% ' + (irrOk ? '▲ 초과' : '▽ 미달'), irrOk ? 'good' : 'bad'),
      card('Unlevered IRR', irrPct(r.unlevIrr), '자산 단독'),
      card('Equity Multiple', isFinite(r.em) ? r.em.toFixed(2) + 'x' : '-', '총회수/에쿼티'),
      card('평균 CoC', pct2(r.avgCoc * 100), '연 NCF/에쿼티 평균'),
      card('Exit 매각가', n0(r.exitValue) + '억', 'Exit Cap ' + pct2(num(S.inp.exit_cap_pct))),
      card('최저 DSCR', isFinite(r.dscrMin) ? r.dscrMin.toFixed(2) + 'x' : '-', '이자 대비 NOI')
    ].join('');
  }

  function cashflowHTML(r) {
    var h = '<table class="vt"><thead><tr>' +
      '<th>연차</th><th>임대수입</th><th>관리·기타</th><th>OPEX</th><th>NOI</th>' +
      '<th>이자</th><th>CAPEX·기타</th><th>NCF</th><th>누적</th><th>CoC</th><th>DSCR</th></tr></thead><tbody>';
    r.rows.forEach(function (x) {
      var last = x.y === r.N;
      h += '<tr' + (last ? ' class="last"' : '') + '>' +
        '<td>' + x.y + '년차' + (last ? ' · 매각' : '') + '</td>' +
        '<td>' + n1(x.rent) + '</td>' +
        '<td>' + n1(x.other) + '</td>' +
        '<td>' + n1(x.opex) + '</td>' +
        '<td class="b">' + n1(x.noi) + '</td>' +
        '<td>' + n1(x.interest) + '</td>' +
        '<td>' + n1(x.capex + x.other_cost) + '</td>' +
        '<td class="' + (x.ncf < 0 ? 'neg' : '') + '">' + n1(x.ncf) + '</td>' +
        '<td>' + n1(x.cum) + '</td>' +
        '<td>' + pct1(x.coc * 100) + '</td>' +
        '<td>' + (isFinite(x.dscr) ? x.dscr.toFixed(2) : '-') + '</td>' +
        '</tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="4">Exit — 매각가(Net) ' + n0(r.netSale) + '억 · 부채상환 ' + n0(r.debtEnd) + '억' +
      (r.deposit ? ' · 보증금 ' + n0(r.deposit) + '억' : '') + '</td>' +
      '<td colspan="7">에쿼티 회수 ' + n0(r.netSale - r.debtEnd - r.deposit) + '억</td></tr></tfoot></table>';
    return h;
  }

  /* 민감도 매트릭스 ------------------------------------------------------ */
  function cellValue(inp, metric) {
    var r = calc(inp);
    if (metric === 'irr') return { v: r.levIrr, txt: irrPct(r.levIrr) };
    if (metric === 'coc') return { v: r.avgCoc, txt: pct2(r.avgCoc * 100) };
    if (metric === 'em') return { v: r.em, txt: isFinite(r.em) ? r.em.toFixed(2) + 'x' : '-' };
    if (metric === 'exit') return { v: r.netSale, txt: n0(r.netSale) + '억' };
    return { v: NaN, txt: '-' };
  }

  function matrix1(r) {
    var base = r.entryCap * 100;
    var baseExit = num(S.inp.exit_cap_pct);
    var step = num(S.step), n = S.cells;
    var rows = [], cols = [];
    for (var i = -n; i <= n; i++) { rows.push(base + i * step); cols.push(baseExit + i * step); }
    return renderMatrix(rows, cols, '이니셜 캡', '엑시트 캡', function (rc, cc) {
      var t = clone(S.inp);
      t.anchor = 'cap'; t.entry_cap = rc; t.exit_cap_pct = cc;
      return cellValue(t, S.metric1);
    }, base, baseExit, S.metric1);
  }

  function matrix2(r) {
    var baseRate = num(S.inp.s_rate1);
    var baseExit = num(S.inp.exit_cap_pct);
    var step = num(S.step), n = S.cells;
    var rows = [], cols = [];
    for (var i = -n; i <= n; i++) { rows.push(i * step); cols.push(baseExit + i * step); }
    return renderMatrix(rows, cols, '조달금리', '엑시트 캡', function (dR, cc) {
      var t = clone(S.inp);
      t.exit_cap_pct = cc;
      ['s_rate1', 's_rate2', 's_rate3', 'm_rate1', 'm_rate2', 'm_rate3'].forEach(function (k) {
        t[k] = num(S.inp[k]) + dR;
      });
      return cellValue(t, S.metric2);
    }, 0, baseExit, S.metric2, baseRate);
  }

  function renderMatrix(rowVals, colVals, rowLabel, colLabel, cellFn, baseRow, baseCol, metric, baseRate) {
    var target = num(S.inp.target_irr) / 100;
    var head = '<tr><th class="mt-corner">' + esc(rowLabel) + ' ↓ / ' + esc(colLabel) + ' →</th>';
    colVals.forEach(function (c) { head += '<th class="' + (Math.abs(c - baseCol) < 1e-9 ? 'is-base' : '') + '">' + c.toFixed(2) + '%</th>'; });
    head += '</tr>';
    var body = '';
    rowVals.forEach(function (rv) {
      var label = (rowLabel === '조달금리') ? (rv >= 0 ? '+' : '') + rv.toFixed(2) + '%p' : rv.toFixed(2) + '%';
      body += '<tr><th class="mt-row' + (Math.abs(rv - baseRow) < 1e-9 ? ' is-base' : '') + '">' + label + '</th>';
      colVals.forEach(function (cv) {
        var o = cellFn(rv, cv);
        var cls = [];
        if (Math.abs(rv - baseRow) < 1e-9 && Math.abs(cv - baseCol) < 1e-9) cls.push('is-base');
        if (isFinite(o.v)) {
          if (metric === 'irr' && o.v >= target) cls.push(o.v >= target + 0.03 ? 'good-2' : 'good');
          if (metric === 'coc' && o.v * 100 >= target) cls.push('good');
        }
        body += '<td class="' + esc(cls.join(' ')) + '">' + o.txt + '</td>';
      });
      body += '</tr>';
    });
    return '<table class="mt"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  function notesHTML() {
    var p = presetById(S.presetId);
    if (!p) return '<div class="val-note-empty">프리셋을 선택하면 데이터 출처가 표시됩니다.</div>';
    var h = '<div class="vs-src"><strong>데이터 출처</strong><p>' + esc(p.src) + '</p></div>';
    if (p.memo) h += '<div class="vs-memo"><strong>내부 검토안 참고치</strong><p>' + esc(p.memo) + '</p></div>';
    if (p.verify) h += '<div class="vs-verify"><strong>검증 노트</strong><p>' + esc(p.verify) + '</p></div>';
    h += '<ul class="vs-list">';
    p.notes.forEach(function (n) {
      var cls = /\[가정/.test(n) ? 'assume' : 'doc';
      h += '<li class="' + cls + '"><span class="vs-badge">' + (cls === 'doc' ? '원문' : '가정') + '</span>' + esc(n) + '</li>';
    });
    h += '</ul>';
    h += '<p class="vs-foot">※ 본 시뮬레이터는 연 단위·단일 트랜치로 단순화한 자체 계산입니다. 내부 검토안(6대 시나리오·김포 제안서)은 분기 단위·멀티트랜치·워터폴을 반영해 수치가 다를 수 있습니다(±1%p 내외). 실제 의사결정 전 원문 대조 필요.</p>';
    return h;
  }

  function savedHTML() {
    if (!S.saved.length) {
      return '<span class="sv-empty">저장된 시나리오 없음</span>';
    }
    var h = '<select id="valSavedSel"><option value="">저장 시나리오 선택…</option>';
    S.saved.forEach(function (s) {
      h += '<option value="' + esc(s.id) + '">' + esc(s.name || s.id) + '</option>';
    });
    h += '</select>';
    return h;
  }

  function renderAll() {
    var host = $('#valView');
    if (!host) return;
    var r = calc(S.inp);
    var admin = S.role !== 'readonly';
    var html = '';
    html += '<div class="val-shell">';
    html += '<div class="val-top">';
    html += '<div class="val-title"><h2>📊 물건별 밸류에이션 · 민감도</h2>';
    html += '<p>렌트롤·OPEX·CAPEX → 연도별 현금흐름 → IRR·EM·CoC. 이니셜 캡·엑시트 캡·구간별 금리를 바꿔 즉시 재계산합니다.</p></div>';
    html += '<div class="val-presets">' + presetHTML() + '</div>';
    html += '</div>';

    html += '<div class="val-main">';
    /* 좌: 입력 */
    html += '<aside class="val-inputs" id="valInputs">' + inputsHTML(r) + '</aside>';
    /* 우: 결과 */
    html += '<main class="val-out">';
    html += '<div class="val-bar">';
    html += '<span class="val-badge" id="valCalcTag">기준: ' + esc(presetById(S.presetId) ? presetById(S.presetId).name : '사용자 입력') + '</span>';
    html += '<span class="val-save">' +
      (admin ? '<input id="valSaveName" type="text" placeholder="시나리오 이름 (예: 종플 3,600억·Exit 5.0%)">' +
        '<button type="button" class="btn-s" id="valSaveBtn">💾 시트에 저장</button>' : '<span class="ro-note">읽기 전용 — 저장 불가(계산·민감도는 자유)</span>') +
      '<span class="sv-load">' + savedHTML() + '</span>' +
      '<button type="button" class="btn-s ghost" id="valLoadBtn">불러오기</button>' +
      (admin ? '<button type="button" class="btn-s ghost" id="valDelBtn">삭제</button>' : '') +
      '</span>';
    html += '</div>';
    html += '<div class="val-kpis" id="valKpis">' + kpiHTML(r) + '</div>';
    html += '<section class="val-block"><h3>연도별 현금흐름 <span>(단위: 억원)</span></h3><div class="val-table-wrap" id="valCF">' + cashflowHTML(r) + '</div></section>';

    html += '<section class="val-block"><div class="val-block-head"><h3>① 이니셜 캡 × 엑시트 캡</h3>' +
      '<span class="seg-mini" data-metric1>' +
      ['irr', 'em', 'exit'].map(function (m) {
        var lb = m === 'irr' ? 'Levered IRR' : m === 'em' ? 'EM' : '매각가';
        return '<button type="button" data-m="' + m + '" class="' + (S.metric1 === m ? 'on' : '') + '">' + lb + '</button>';
      }).join('') + '</span></div><div id="valM1">' + matrix1(r) + '</div></section>';

    html += '<section class="val-block"><div class="val-block-head"><h3>② 조달금리 × 엑시트 캡</h3>' +
      '<span class="seg-mini" data-metric2>' +
      ['irr', 'coc', 'em'].map(function (m) {
        var lb = m === 'irr' ? 'Levered IRR' : m === 'coc' ? '평균 CoC' : 'EM';
        return '<button type="button" data-m="' + m + '" class="' + (S.metric2 === m ? 'on' : '') + '">' + lb + '</button>';
      }).join('') + '</span></div><div id="valM2">' + matrix2(r) + '</div>' +
      '<p class="mt-hint">조달금리는 선·중순위 전 구간에 동일 %p를 적용합니다. 초록 셀 = 목표 IRR 이상.</p></section>';

    html += '<section class="val-block"><div class="val-block-head"><h3>민감도 설정</h3>' +
      '<span class="seg-mini" data-step>' + [0.25, 0.5].map(function (s) {
        return '<button type="button" data-s="' + s + '" class="' + (num(S.step) === s ? 'on' : '') + '">±' + s.toFixed(2) + '%p</button>';
      }).join('') + '</span>' +
      '<span class="seg-mini" data-cells>' + [1, 2, 3].map(function (c) {
        return '<button type="button" data-c="' + c + '" class="' + (S.cells === c ? 'on' : '') + '">±' + c + '칸</button>';
      }).join('') + '</span></div></section>';

    html += '<section class="val-block"><h3>가정·출처</h3><div id="valNotes">' + notesHTML() + '</div></section>';
    html += '</main></div></div>';

    host.innerHTML = html;
    bindAll();
  }

  /** 값 변경 시 결과부만 다시 그림 (입력 포커스 유지) */
  function recalcOnly() {
    var r = calc(S.inp);
    var k = $('#valKpis'); if (k) k.innerHTML = kpiHTML(r);
    var cf = $('#valCF'); if (cf) cf.innerHTML = cashflowHTML(r);
    var m1 = $('#valM1'); if (m1) m1.innerHTML = matrix1(r);
    var m2 = $('#valM2'); if (m2) m2.innerHTML = matrix2(r);
    var tag = $('#valCalcTag');
    if (tag) {
      var p = presetById(S.presetId);
      tag.textContent = '기준: ' + (p ? p.name : '사용자 입력');
      tag.classList.toggle('modified', !!p && !sameInp(p.inp, S.inp));
    }
    syncLinkedFields();
  }

  function sameInp(a, b) {
    for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k) && k !== 'target_irr' && String(a[k]) !== String(b[k])) return false;
    return true;
  }

  /** 매입가 ↔ 이니셜 캡 연동 필드 표시 갱신 */
  function syncLinkedFields() {
    var r = calc(S.inp);
    var pc = $('#v-price_eok'), cc = $('#v-entry_cap');
    if (S.inp.anchor === 'cap') {
      S.inp.price_eok = Math.round(r.price * 10) / 10;
      if (pc && document.activeElement !== pc) pc.value = S.inp.price_eok;
    } else {
      S.inp.entry_cap = Math.round(r.entryCap * 10000) / 100;
      if (cc && document.activeElement !== cc) cc.value = S.inp.entry_cap.toFixed(2);
    }
  }

  /* ═════════════════════════════ 이벤트 ════════════════════════════════ */
  function bindAll() {
    var host = $('#valView');
    if (!host) return;

    $$('.vp-btn', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-preset');
        var p = presetById(id);
        if (!p) return;
        S.presetId = id;
        S.inp = clone(p.inp);
        S.inp.anchor = 'price';
        renderAll();
        toast(p.name + ' 프리셋을 불러왔습니다.');
      });
    });

    var inputs = $('#valInputs');
    if (inputs) {
      inputs.addEventListener('input', function (e) {
        var el = e.target;
        var k = el.getAttribute('data-k');
        if (!k) return;
        if (k === 'rent_mode') {
          S.inp.rent_mode = el.value;
          renderAll();
          return;
        }
        if (k === 'sector') S.inp.sector = el.value;
        else if (el.type === 'text') S.inp[k] = el.value;
        else S.inp[k] = el.value === '' ? '' : num(el.value);
        if (k === 'price_eok') S.inp.anchor = 'price';
        if (k === 'entry_cap') S.inp.anchor = 'cap';
        recalcOnly();
      });
      inputs.addEventListener('change', function (e) {
        var k = e.target.getAttribute('data-k');
        if (k === 'rent_mode') { S.inp.rent_mode = e.target.value; renderAll(); }
        if (k === 'hold_years') { recalcOnly(); }
      });
    }

    $$('[data-metric1] button', host).forEach(function (b) {
      b.addEventListener('click', function () {
        S.metric1 = b.getAttribute('data-m');
        $$('[data-metric1] button', host).forEach(function (x) { x.classList.toggle('on', x === b); });
        var r = calc(S.inp); $('#valM1').innerHTML = matrix1(r);
      });
    });
    $$('[data-metric2] button', host).forEach(function (b) {
      b.addEventListener('click', function () {
        S.metric2 = b.getAttribute('data-m');
        $$('[data-metric2] button', host).forEach(function (x) { x.classList.toggle('on', x === b); });
        var r = calc(S.inp); $('#valM2').innerHTML = matrix2(r);
      });
    });
    $$('[data-step] button', host).forEach(function (b) {
      b.addEventListener('click', function () {
        S.step = num(b.getAttribute('data-s'), 0.25);
        $$('[data-step] button', host).forEach(function (x) { x.classList.toggle('on', x === b); });
        var r = calc(S.inp); $('#valM1').innerHTML = matrix1(r); $('#valM2').innerHTML = matrix2(r);
      });
    });
    $$('[data-cells] button', host).forEach(function (b) {
      b.addEventListener('click', function () {
        S.cells = Math.round(num(b.getAttribute('data-c'), 2));
        $$('[data-cells] button', host).forEach(function (x) { x.classList.toggle('on', x === b); });
        var r = calc(S.inp); $('#valM1').innerHTML = matrix1(r); $('#valM2').innerHTML = matrix2(r);
      });
    });

    var saveBtn = $('#valSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveScenario);
    var loadBtn = $('#valLoadBtn');
    if (loadBtn) loadBtn.addEventListener('click', loadScenario);
    var delBtn = $('#valDelBtn');
    if (delBtn) delBtn.addEventListener('click', deleteScenario);
  }

  /* ═════════════════════════ 구글 시트 저장/불러오기 ═══════════════════ */
  function token() {
    try { return localStorage.getItem((CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1') || ''; } catch (e) { return ''; }
  }
  function apiGet(qs) {
    if (!SYNC_URL) return Promise.reject(new Error('no_sync'));
    return fetch(SYNC_URL + (SYNC_URL.indexOf('?') < 0 ? '?' : '&') + qs + '&token=' + encodeURIComponent(token()), { cache: 'no-store' })
      .then(function (r) { return r.json(); });
  }
  function apiPost(body) {
    if (!SYNC_URL) return Promise.reject(new Error('no_sync'));
    body.token = token();
    return fetch(SYNC_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function loadSaved(force) {
    if (S.savedLoaded && !force) return Promise.resolve();
    return apiGet('type=valuations').then(function (j) {
      if (j && j.ok && Array.isArray(j.valuations)) {
        S.saved = j.valuations.map(function (v) {
          var payload = {};
          try { payload = JSON.parse(v.payload || '{}'); } catch (e) { payload = {}; }
          return { id: v.id, name: v.name || v.id, payload: payload, updated_at: v.updated_at, note: v.note };
        });
        S.savedLoaded = true;
      }
    }).catch(function () { /* 조용히 무시 — 시트 미배포 상태에서도 계산은 동작 */ });
  }

  function saveScenario() {
    if (S.role === 'readonly') { toast('읽기 전용 모드입니다. 저장할 수 없습니다.', true); return; }
    var host = $('#valView');
    var nameEl = $('#valSaveName');
    var name = (nameEl && nameEl.value.trim()) || (S.inp.name + ' ' + new Date().toISOString().slice(5, 10));
    var r = calc(S.inp);
    var payload = clone(S.inp);
    payload._metric = {
      irr: Math.round(r.levIrr * 10000) / 100, coc: Math.round(r.avgCoc * 10000) / 100,
      em: Math.round(r.em * 100) / 100, price: Math.round(r.price * 10) / 10,
      entryCap: Math.round(r.entryCap * 10000) / 100, exitValue: Math.round(r.exitValue)
    };
    var rec = {
      id: 'val-' + Date.now().toString(36),
      name: name,
      asset_id: S.inp.asset_id || '',
      sector: S.inp.sector || '',
      area_py: String(num(S.inp.area_py)),
      payload: JSON.stringify(payload),
      updated_at: new Date().toISOString().slice(0, 10),
      note: name
    };
    apiPost({ action: 'upsert', type: 'valuations', valuations: [rec] }).then(function (j) {
      if (j && j.ok) {
        S.saved.push({ id: rec.id, name: rec.name, payload: payload, updated_at: rec.updated_at });
        var wrap = host.querySelector ? host.querySelector('.sv-load') : null;
        if (wrap) wrap.innerHTML = savedHTML();
        toast(name + ' — 시트에 저장했습니다.');
      } else {
        toast('저장 실패: ' + (j && j.error ? j.error : '알 수 없는 오류'), true);
      }
    }).catch(function () { toast('저장 실패(네트워크)', true); });
  }

  function loadScenario() {
    var sel = $('#valSavedSel');
    var id = sel && sel.value;
    if (!id) { toast('불러올 시나리오를 선택하세요.', true); return; }
    var hit = null;
    for (var i = 0; i < S.saved.length; i++) if (S.saved[i].id === id) hit = S.saved[i];
    if (!hit) return;
    S.inp = clone(hit.payload);
    S.inp.anchor = 'price';
    S.presetId = '';
    renderAll();
    toast(hit.name + ' — 불러왔습니다.');
  }

  function deleteScenario() {
    if (S.role === 'readonly') { toast('읽기 전용 모드입니다.', true); return; }
    var sel = $('#valSavedSel');
    var id = sel && sel.value;
    if (!id) { toast('삭제할 시나리오를 선택하세요.', true); return; }
    if (!window.confirm('선택한 시나리오를 비공개 시트(valuations)에서 삭제할까요?')) return;
    apiPost({ action: 'delete', type: 'valuations', id: id }).then(function (j) {
      if (j && j.ok) {
        S.saved = S.saved.filter(function (s) { return s.id !== id; });
        var wrap = sel.closest('.sv-load');
        if (wrap) wrap.innerHTML = savedHTML();
        toast('삭제했습니다.');
      } else toast('삭제 실패: ' + (j && j.error ? j.error : '알 수 없는 오류'), true);
    }).catch(function () { toast('삭제 실패(네트워크)', true); });
  }

  /* ═════════════════════════════ 외부 인터페이스 ═══════════════════════ */
  function readRole() {
    var st = window.naiMap && window.naiMap.state;
    S.role = (st && st.role) ? st.role : 'readonly';
  }

  function showView() {
    if (window.naiShowView) window.naiShowView('valuation');
  }

  /** 지도 상세 패널의 [📊 수익성 시뮬레이션] → 해당 물건 프리셋으로 이동 */
  function openForAsset(a) {
    if (!a) return;
    var p = null;
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].asset_ids && PRESETS[i].asset_ids.indexOf(a.id) >= 0) { p = PRESETS[i]; break; }
    }
    if (p) {
      S.presetId = p.id;
      S.inp = clone(p.inp);
      S.inp.asset_id = a.id;
      S.inp.name = a.name || S.inp.name;
    } else {
      var area = 0;
      var m = String(a.scale_info || '').match(/([\d,\.]+)\s*평/);
      if (m) area = num(String(m[1]).replace(/,/g, ''));
      var price = 0;
      var pm = String(a.price_info || '').match(/([\d,]{3,})\s*억/);
      if (pm) price = num(String(pm[1]).replace(/,/g, ''));
      var sec = (a.sector === 'office' || a.sector === 'logistics' || a.sector === 'datacenter' || a.sector === 'hotel') ? a.sector : 'office';
      S.presetId = '';
      S.inp = {
        name: a.name || '물건', sector: sec, area_py: area || 10000, hold_years: 5,
        anchor: 'price', price_eok: price || 1000, entry_cap: 0, acq_cost_pct: sec === 'logistics' ? 4.6 : 6.4,
        exit_cost_pct: 0.5, exit_cap_pct: sec === 'office' ? 4.5 : 5.5,
        rent_mode: 'pyeong', rent_annual: 0, rent_per_py_month: sec === 'office' ? 95000 : 45000,
        rf_months: 2.0, other_income: 0, vacancy_pct: 3, rent_growth_pct: 2.0,
        opex: 0, opex_growth_pct: 2.0, other_cost: 0,
        capex_initial: 0, capex_annual: 0, exit_capex: 0,
        add_noi: 0, add_noi_start: 2,
        ltv_senior: 60, ltv_mezz: 0, deposit_eok: 0,
        s_rate1: 5.2, s_rate2: 4.8, s_rate3: 4.5,
        m_rate1: 6.7, m_rate2: 6.2, m_rate3: 5.8,
        target_irr: 10, asset_id: a.id
      };
      toast('이 물건은 아직 원문 수지 프리셋이 없습니다. 임대료·OPEX를 평당 시장 가정치로 채웠으니 실제 자료로 보정하세요.');
    }
    S.inp.asset_id = a.id;
    showView();
    renderAll();
  }

  function show() {
    readRole();
    if (!S.inp) {
      var p = presetById(S.presetId) || PRESETS[0];
      S.presetId = p.id;
      S.inp = clone(p.inp);
      S.inp.anchor = 'price';
    }
    renderAll();
    loadSaved().then(function () {
      var wrap = $('#valSavedSel');
      if (!wrap && S.saved.length) {
        var host = $('.val-save');
        var sv = host && host.querySelector('.sv-load');
        if (sv) sv.innerHTML = savedHTML();
      }
    });
  }

  function boot() {
    if (!$('#valView')) return;
    S.booted = true;
    var p = presetById(S.presetId) || PRESETS[0];
    S.inp = clone(p.inp);
    S.inp.anchor = 'price';
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('[data-act="simulate"]')) { /* app.js가 처리 */ }
    });
  }

  /* 노드 테스트용 코어 노출 */
  window.NAI_VAL_CORE = { calc: calc, derive: derive, irr: irr, PRESETS: PRESETS };
  window.NAI_VAL = {
    show: show,
    openForAsset: openForAsset,
    loadSaved: function () { return loadSaved(true); },
    state: S
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
