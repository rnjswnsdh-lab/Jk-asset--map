/* =========================================================================
   Open AI Asset Bridge — 섹터별 밸류에이션 엔진 (2026-11-24 추가)
   -------------------------------------------------------------------------
   호텔 · 골프장 · 리조트 · 데이터센터 4개 엔진.
   오피스·물류·리테일(수익형)은 valuation.js 의 기존 엔진, 공동주택 개발은
   같은 파일의 RLV(dev_res) 엔진을 그대로 씁니다.

   항목 구조는 NAI Korea 과거 사업성 모델 28종에서 가져왔습니다:
     · 호텔   : br_YZ파크 호텔 컨버젼 Valuation(2026-03, 씨앤설계 반영)
                — 객실·식음·근생·주차 수익 / 호텔위탁비용 / 건물 제세·관리비 / NOI
     · 골프장 : 청라골프장사업성(27홀, 2017) · 블루레이크CC 원리금상환가능성(2017)
                — 그린피·카트·식음·그늘집·기타 / 코스관리·카트관리·매출원가 / 판관비 / 조성비
     · 리조트 : 콘도_리조트_수지분석(2013) · 알펜시아 사업성분석 · IBC 사업타당성
                — 콘도 분양수입 + 운영수입 / 토지비·건축비·판매비·금융비
     · 데이터센터 : IBC · 한진CY · 김포TJ 재무모델의 수익·비용·조달 구조
                — IT 부하(MW)×임대단가, PUE 전력비, 개발비/MW, Exit Cap
   옛 모델의 공사비·임대료·금리 가정은 2026년 시장 수치로 갱신해 기본값으로
   두었고, 값마다 '원문'과 '가정'을 계산기 주석에 구분해 표시합니다.
   ========================================================================= */
(function () {
  'use strict';

  var n0 = function (v) { return (v === null || v === undefined || !isFinite(v)) ? '-' : Math.round(v).toLocaleString('ko-KR'); };
  var n1 = function (v) { return (v === null || v === undefined || !isFinite(v)) ? '-' : (Math.round(v * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
  var n2 = function (v) { return (v === null || v === undefined || !isFinite(v)) ? '-' : (Math.round(v * 100) / 100).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var pct1 = function (v) { return (v === null || !isFinite(v)) ? '-' : (Math.round(v * 10) / 10).toFixed(1) + '%'; };
  var pct2 = function (v) { return (v === null || !isFinite(v)) ? '-' : (Math.round(v * 100) / 100).toFixed(2) + '%'; };
  function num(v, d) { var n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : (d === undefined ? 0 : d); }

  function irr(cfs) {
    var hasPos = false, hasNeg = false;
    for (var i = 0; i < cfs.length; i++) { if (cfs[i] > 0) hasPos = true; if (cfs[i] < 0) hasNeg = true; }
    if (!hasPos || !hasNeg) return NaN;
    var lo = -0.9999, hi = 5;
    var npv = function (r) { var s = 0; for (var t = 0; t < cfs.length; t++) s += cfs[t] / Math.pow(1 + r, t); return s; };
    if (npv(lo) * npv(hi) > 0) return NaN;
    for (var k = 0; k < 300; k++) { var mid = (lo + hi) / 2; if (npv(mid) > 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  /** 개발형(골프·DC)은 조성비를 CAPEX 로 옮긴 사본으로 현금흐름을 계산한다 */
  function finOf(inp, capexEok, dev) {
    var o = {};
    for (var k in inp) if (Object.prototype.hasOwnProperty.call(inp, k)) o[k] = inp[k];
    o.capex_eok = capexEok;
    o._dev = dev ? 1 : 0;
    return o;
  }

  /** NOI 시계열 → 자본구조·매각을 반영한 현금흐름 (금액 단위: 억원) */
  function cf(inp, noi1, growthPct) {
    var price = num(inp.price_eok) + num(inp.capex_eok);
    var acq = num(inp.price_eok) * num(inp.acq_cost_pct, 4.6) / 100;
    var total = price + acq;
    var senior = total * num(inp.ltv_senior, 60) / 100;
    var mezz = total * num(inp.ltv_mezz, 0) / 100;
    var equity = total - senior - mezz;
    var N = Math.max(1, Math.min(20, Math.round(num(inp.hold_years, 5))));
    var g = num(growthPct, 2) / 100;
    var exitCap = num(inp.exit_cap_pct, 5.5) / 100;
    var exitCost = num(inp.exit_cost_pct, 0.5) / 100;
    var s1 = num(inp.s_rate1, 5.2) / 100, s2 = num(inp.s_rate2, 4.8) / 100, s3 = num(inp.s_rate3, 4.5) / 100;
    var m1 = num(inp.m_rate1, 6.7) / 100, m2 = num(inp.m_rate2, 6.2) / 100, m3 = num(inp.m_rate3, 5.8) / 100;
    var rows = [], unlev = [-total], lev = [-equity], noiY = noi1, cum = 0, dscrMin = Infinity, lastNoi = noi1;
    for (var y = 1; y <= N; y++) {
      noiY = noi1 * Math.pow(1 + g, y - 1);
      var iS = (y <= 2) ? s1 : (y <= 5 ? s2 : s3);
      var iM = (y <= 2) ? m1 : (y <= 5 ? m2 : m3);
      var interest = senior * iS + mezz * iM;
      var ncf = noiY - interest;
      cum += ncf;
      var dscr = interest > 0 ? noiY / interest : NaN;
      if (isFinite(dscr)) dscrMin = Math.min(dscrMin, dscr);
      lastNoi = noiY;
      rows.push({ y: y, noi: noiY, interest: interest, ncf: ncf, cum: cum, dscr: dscr, coc: equity > 0 ? ncf / equity : NaN });
      unlev.push(noiY); lev.push(ncf);
    }
    var exitNoi = lastNoi * (1 + g);
    var exitValue = exitCap > 0 ? exitNoi / exitCap : NaN;
    var netSale = exitValue * (1 - exitCost);
    var debtEnd = senior + mezz;
    unlev[N] += netSale; lev[N] += netSale - debtEnd;
    var sumLev = 0; for (var i = 1; i < lev.length; i++) sumLev += lev[i];
    var res = {
      price: num(inp.price_eok), capex: num(inp.capex_eok), total: total, acq: acq,
      senior: senior, mezz: mezz, equity: equity, ltv: total > 0 ? (senior + mezz) / total * 100 : 0,
      noi1: noi1, N: N, rows: rows, exitNoi: exitNoi, exitValue: exitValue, netSale: netSale,
      unlevIrr: irr(unlev), levIrr: irr(lev), em: equity > 0 ? sumLev / equity : NaN,
      avgCoc: equity > 0 ? sumLev / N / equity : NaN,
      dscrMin: dscrMin, entryCap: total > 0 ? noi1 / total * 100 : NaN
    };
    /* 매입가 미입력(0) 이면 IRR·수익률은 의미가 없으므로 '-' 처리 (공사비만 투자한 것으로 읽히는 것을 막는다) */
    if (!(num(inp.price_eok) > 0) && !inp._dev) {
      res.levIrr = NaN; res.unlevIrr = NaN; res.em = NaN; res.avgCoc = NaN; res.entryCap = NaN;
      res.needPrice = true;
    }
    return res;
  }

  /* ══════════════════════════════════ 호텔 ══════════════════════════════════ */
  var HOTEL = {
    key: 'hotel', label: '🏨 호텔', name: '호텔 운영 · 컨버전 수익',
    desc: '객실(OCC·ADR)·식음·근생·주차 수익 − 호텔 위탁운영비·건물 제세·관리비 → NOI → IRR',
    groups: [
      { g: '객실 · 부대수익', items: [
        { k: 'rooms', l: '객실 수(실)', t: 'num', step: 1 },
        { k: 'occ', l: '객실가동률 OCC(%)', t: 'num', step: 0.1 },
        { k: 'adr', l: '평균객실단가 ADR(원)', t: 'num', step: 1000 },
        { k: 'fb_pct', l: '식음 수익(객실매출 대비 %)', t: 'num', step: 0.1 },
        { k: 'other_rev', l: '근생·주차·기타(억/년)', t: 'num', step: 0.1 }
      ] },
      { g: '호텔 운영비 (실당 연간)', items: [
        { k: 'c_staff', l: '인건비(만원/실)', t: 'num', step: 1 },
        { k: 'c_house', l: '룸메이드 도급(만원/실)', t: 'num', step: 1 },
        { k: 'c_util', l: '수광비(만원/실)', t: 'num', step: 1 },
        { k: 'c_cons', l: '소모품·인쇄(만원/실)', t: 'num', step: 1 },
        { k: 'c_comm', l: '통신비(만원/실)', t: 'num', step: 0.1 },
        { k: 'c_repair', l: '수선비(만원/실)', t: 'num', step: 1 },
        { k: 'c_etc', l: '접대·임차료 등(만원/실)', t: 'num', step: 1 },
        { k: 'c_ota', l: 'OTA·지급수수료(객실매출 %)', t: 'num', step: 0.1 },
        { k: 'c_mgmt', l: '위탁운영 수수료(객실매출 %)', t: 'num', step: 0.1 },
        { k: 'c_fb', l: '식음 원가율(%)', t: 'num', step: 0.1 }
      ] },
      { g: '건물 비용 (평당 · 연간)', items: [
        { k: 'b_py', l: '연면적(평)', t: 'num', step: 1 },
        { k: 'b_pm', l: 'PM fee(원/평/월)', t: 'num', step: 10 },
        { k: 'b_fm', l: 'FM fee(원/평/월)', t: 'num', step: 10 },
        { k: 'b_repair', l: '수선유지비(원/평/월)', t: 'num', step: 10 },
        { k: 'b_ins', l: '보험료(억/년)', t: 'num', step: 0.01 },
        { k: 'b_tax', l: '제세공과금(억/년)', t: 'num', step: 0.1 }
      ] },
      { g: '매입 · 매각 · 조달', items: [
        { k: 'price_eok', l: '매입가(억원)', t: 'num', step: 1 },
        { k: 'capex_eok', l: '컨버전·초기 CAPEX(억원)', t: 'num', step: 1 },
        { k: 'acq_cost_pct', l: '매입 부대비용(%)', t: 'num', step: 0.1 },
        { k: 'exit_cost_pct', l: '매각 부대비용(%)', t: 'num', step: 0.1 },
        { k: 'exit_cap_pct', l: '엑시트 캡레이트(%)', t: 'num', step: 0.05 },
        { k: 'noi_growth_pct', l: 'NOI 상승률(%/년)', t: 'num', step: 0.1 },
        { k: 'hold_years', l: '보유기간(년)', t: 'num', step: 1, min: 3, max: 10 },
        { k: 'ltv_senior', l: '선순위 LTV(%)', t: 'num', step: 0.1 },
        { k: 'ltv_mezz', l: '중순위 LTV(%)', t: 'num', step: 0.1 },
        { k: 's_rate1', l: '선순위 1~2년차(%)', t: 'num', step: 0.05 },
        { k: 's_rate2', l: '선순위 3~5년차(%)', t: 'num', step: 0.05 },
        { k: 's_rate3', l: '선순위 6년차 이후(%)', t: 'num', step: 0.05 },
        { k: 'm_rate1', l: '중순위 1~2년차(%)', t: 'num', step: 0.05 },
        { k: 'target_irr', l: '목표 IRR(%) — 민감도 색상 기준', t: 'num', step: 0.5 }
      ] }
    ],
    defaults: function (a) {
      var rooms = 213, occ = 80, adr = 120000;
      var f = factsMap(a);
      var rm = pickNum(f, ['객실수', '객실 수'], 0);
      if (rm) rooms = rm;
      if (/213/.test(String(a && a.scale_info))) rooms = 213;
      return {
        engine: 'hotel', mode: 'hotel', asset_id: a ? a.id : '', name: a ? a.name : '호텔',
        rooms: rooms, occ: occ, adr: adr, fb_pct: 2.3, other_rev: 5.0,
        c_staff: 72, c_house: 142, c_util: 201, c_cons: 75, c_comm: 12, c_repair: 141, c_etc: 35,
        c_ota: 5.4, c_mgmt: 1.0, c_fb: 6.2,
        b_py: pickAreaPy(a, 4865), b_pm: 350, b_fm: 2800, b_repair: 1000, b_ins: 0.16, b_tax: 2.0,
        price_eok: 0, capex_eok: 147, acq_cost_pct: 4.6, exit_cost_pct: 0.5, exit_cap_pct: 7.6,
        noi_growth_pct: 2.5, hold_years: 5, ltv_senior: 55, ltv_mezz: 0,
        s_rate1: 5.0, s_rate2: 4.7, s_rate3: 4.5, m_rate1: 7.0, m_rate2: 6.5, m_rate3: 6.2,
        target_irr: 10
      };
    },
    calc: function (inp) {
      var rooms = num(inp.rooms), occ = num(inp.occ) / 100, adr = num(inp.adr);
      var roomRev = rooms * 365 * occ * adr / 1e8;
      var fbRev = roomRev * num(inp.fb_pct) / 100;
      var otherRev = num(inp.other_rev);
      var rev = roomRev + fbRev + otherRev;
      var perRoom = (num(inp.c_staff) + num(inp.c_house) + num(inp.c_util) + num(inp.c_cons) + num(inp.c_comm) + num(inp.c_repair) + num(inp.c_etc));
      var hotelFixed = rooms * perRoom / 1e4;                 // 만원 → 억
      var ota = roomRev * num(inp.c_ota) / 100;
      var mgmt = roomRev * num(inp.c_mgmt) / 100;
      var fbCost = fbRev * num(inp.c_fb) / 100;
      var hotelOpex = hotelFixed + ota + mgmt + fbCost;
      var py = num(inp.b_py);
      var pm = py * num(inp.b_pm) * 12 / 1e8;
      var fm = py * num(inp.b_fm) * 12 / 1e8;
      var rep = py * num(inp.b_repair) * 12 / 1e8;
      var bldgOpex = pm + fm + rep + num(inp.b_ins) + num(inp.b_tax);
      var noi = rev - hotelOpex - bldgOpex;
      var out = cf(inp, noi, inp.noi_growth_pct);
      out.rev = rev; out.roomRev = roomRev; out.fbRev = fbRev; out.otherRev = otherRev;
      out.hotelOpex = hotelOpex; out.bldgOpex = bldgOpex; out.noi = noi; out.gopMargin = rev > 0 ? noi / rev * 100 : NaN;
      out.revpar = occ * adr; out.perKey = num(inp.price_eok) > 0 && rooms > 0 ? num(inp.price_eok) / rooms : NaN;
      out.perKeyTotal = rooms > 0 ? out.total / rooms : NaN;
      out.lines = [
        ['객실 매출', roomRev, '실'], ['식음 수익', fbRev, ''], ['근생·주차·기타', otherRev, ''],
        ['호텔 운영비 — 실당 고정', -hotelFixed, ''], ['　· OTA·지급수수료', -ota, ''], ['　· 위탁운영 수수료', -mgmt, ''], ['　· 식음 원가', -fbCost, ''],
        ['건물 PM·FM', -pm - fm, ''], ['수선유지비', -rep, ''], ['보험·제세공과금', -(num(inp.b_ins) + num(inp.b_tax)), ''],
        ['NOI', noi, 'noi']
      ];
      return out;
    },
    drivers: [
      { k: 'occ', l: 'OCC(%)', deltas: [-10, -5, 0, 5, 10], fmt: function (v) { return v + '%'; } },
      { k: 'adr', l: 'ADR(천원)', deltas: [-20, -10, 0, 10, 20], scale: 1000, fmt: function (v) { return n0(v / 1000) + '천'; } }
    ],
    notes: [
      '[원문] 와이즈파크 컨버전 모델(2026-03): 213실 · OCC 80% · ADR 120,000원 → 객실매출 74.6억 · 식음 1.9억 · 근생 5.0억 → NOI 57.4억(Y1)~67.1억(Y6)',
      '[원문] 실당 운영비 — 인건비 72만 · 룸메이드 142만 · 수광비 201만 · 소모품 75만 · 통신 12만 · 수선 141만 · 기타 35만원/실/년',
      '[원문] 건물비 — PM 350원/평/월 · FM 2,800원/평/월 · 수선 1,000원/평/월 · 보험 0.16억 · 제세공과금 2.02억(종부세·재산세·교통유발부담금) = 연 4.6억',
      '[가정] 위 실당 비용은 원 모델의 81실 기준 수치를 213실로 나눠 쓴 값입니다. 실제 213실 운영에서는 인건비·수광비가 더 커질 수 있으니 보수적으로 볼 때는 인건비·수광비를 올려 잡으세요.',
      '[가정] 2026년 시장 기준 매입 Cap 6.5% 내외, 엑시트 Cap 7.0~7.6%를 기본값으로 두었습니다(모델 원문: 매입 6.53% · 매각 7.64%).',
      '[참고] ADR·OCC 벤치마크 — 해운대 L7·신라스테이 마포 IM(원 모델 인용), 2026년 부산 남포동 상권 OCC 74%·ADR 9.4만원'
    ]
  };

  /* ══════════════════════════════════ 골프장 ══════════════════════════════════ */
  var GOLF = {
    key: 'golf', label: '⛳ 골프장', name: '골프장 운영 수익',
    desc: '그린피·카트·식음·그늘집·기타 매출 − 코스관리·카트관리·매출원가·판관비 → 영업이익 → IRR',
    groups: [
      { g: '규모 · 내장객', items: [
        { k: 'holes', l: '홀 수', t: 'num', step: 1 },
        { k: 'days', l: '연간 영업일수', t: 'num', step: 1 },
        { k: 'visitors', l: '일평균 내장객(명)', t: 'num', step: 1 },
        { k: 'weekend_share', l: '주말 내장객 비중(%)', t: 'num', step: 1 }
      ] },
      { g: '객단가', items: [
        { k: 'fee_week', l: '주중 그린피(원/인)', t: 'num', step: 1000 },
        { k: 'fee_weekend', l: '주말 그린피(원/인)', t: 'num', step: 1000 },
        { k: 'cart_fee', l: '카트 대여료(원/인)', t: 'num', step: 1000 },
        { k: 'fb_price', l: '식음 단가(원/인)', t: 'num', step: 1000 },
        { k: 'fb_util', l: '식음 이용률(%)', t: 'num', step: 1 },
        { k: 'shelter_price', l: '그늘집 단가(원/인)', t: 'num', step: 500 },
        { k: 'shelter_util', l: '그늘집 이용률(%)', t: 'num', step: 1 },
        { k: 'other_price', l: '기타 매출(원/인)', t: 'num', step: 500 },
        { k: 'other_util', l: '기타 이용률(%)', t: 'num', step: 1 }
      ] },
      { g: '비용 구조', items: [
        { k: 'maint_pct', l: '코스관리비(그린피 대비 %)', t: 'num', step: 0.5 },
        { k: 'cart_mgmt_pct', l: '카트관리비(카트매출 대비 %)', t: 'num', step: 0.5 },
        { k: 'fb_cogs_pct', l: '식음 원가율(%)', t: 'num', step: 0.5 },
        { k: 'other_cogs_pct', l: '기타 원가율(%)', t: 'num', step: 0.5 },
        { k: 'sga_pct', l: '판매·관리비(매출 대비 %)', t: 'num', step: 0.5 }
      ] },
      { g: '투자 · 매각', items: [
        { k: 'dev_eok', l: '조성·건축 투자비(억원)', t: 'num', step: 1 },
        { k: 'land_eok', l: '토지비(억원)', t: 'num', step: 1 },
        { k: 'price_eok', l: '매입가(억원, M&A 시)', t: 'num', step: 1 },
        { k: 'acq_cost_pct', l: '매입 부대비용(%)', t: 'num', step: 0.1 },
        { k: 'exit_cap_pct', l: '엑시트 캡레이트(%)', t: 'num', step: 0.05 },
        { k: 'exit_cost_pct', l: '매각 부대비용(%)', t: 'num', step: 0.1 },
        { k: 'noi_growth_pct', l: '영업이익 상승률(%/년)', t: 'num', step: 0.1 },
        { k: 'hold_years', l: '보유기간(년)', t: 'num', step: 1, min: 3, max: 10 },
        { k: 'ltv_senior', l: '선순위 LTV(%)', t: 'num', step: 0.1 },
        { k: 's_rate1', l: '선순위 금리(%)', t: 'num', step: 0.05 },
        { k: 's_rate2', l: '선순위 금리(3~5년차 %)', t: 'num', step: 0.05 },
        { k: 's_rate3', l: '선순위 금리(6년차~ %)', t: 'num', step: 0.05 },
        { k: 'target_irr', l: '목표 IRR(%)', t: 'num', step: 0.5 }
      ] }
    ],
    defaults: function (a) {
      return {
        engine: 'golf', mode: 'golf', asset_id: a ? a.id : '', name: a ? a.name : '골프장',
        holes: (regexNum(a && a.scale_info, /(\d+)\s*홀/) || 27), days: 300, visitors: 330, weekend_share: 30,
        fee_week: 200000, fee_weekend: 250000, cart_fee: 25000, fb_price: 18000, fb_util: 35,
        shelter_price: 8000, shelter_util: 80, other_price: 12000, other_util: 50,
        maint_pct: 25, cart_mgmt_pct: 10, fb_cogs_pct: 30, other_cogs_pct: 70, sga_pct: 35,
        dev_eok: 700, land_eok: 0, price_eok: 0, acq_cost_pct: 4.6, exit_cap_pct: 7.5, exit_cost_pct: 1.0,
        noi_growth_pct: 2.0, hold_years: 5, ltv_senior: 55, ltv_mezz: 0,
        s_rate1: 5.2, s_rate2: 4.9, s_rate3: 4.6, m_rate1: 7.0, m_rate2: 6.5, m_rate3: 6.2, target_irr: 10
      };
    },
    calc: function (inp) {
      var v = num(inp.visitors) * num(inp.days);
      var ws = num(inp.weekend_share) / 100;
      var fee = num(inp.fee_week) * (1 - ws) + num(inp.fee_weekend) * ws;
      var green = v * fee / 1e8;
      var cart = v * num(inp.cart_fee) / 1e8;
      var fb = v * num(inp.fb_util) / 100 * num(inp.fb_price) / 1e8;
      var shelter = v * num(inp.shelter_util) / 100 * num(inp.shelter_price) / 1e8;
      var other = v * num(inp.other_util) / 100 * num(inp.other_price) / 1e8;
      var rev = green + cart + fb + shelter + other;
      var maint = green * num(inp.maint_pct) / 100;
      var cartMgmt = cart * num(inp.cart_mgmt_pct) / 100;
      var fbCogs = fb * num(inp.fb_cogs_pct) / 100;
      var otherCogs = (other + shelter) * num(inp.other_cogs_pct) / 100;
      var sga = rev * num(inp.sga_pct) / 100;
      var ebit = rev - maint - cartMgmt - fbCogs - otherCogs - sga;
      var totalInv = num(inp.dev_eok) + num(inp.land_eok) + num(inp.price_eok);
      var fin = finOf(inp, num(inp.dev_eok) + num(inp.land_eok), true);
      var out = cf(fin, ebit, inp.noi_growth_pct);
      out.rev = rev; out.visitors = v; out.green = green; out.cart = cart; out.fb = fb; out.shelter = shelter; out.other = other;
      out.maint = maint; out.cartMgmt = cartMgmt; out.fbCogs = fbCogs; out.otherCogs = otherCogs; out.sga = sga;
      out.ebit = ebit; out.ebitMargin = rev > 0 ? ebit / rev * 100 : NaN;
      out.greenFeeAvg = fee; out.invPerHole = num(inp.holes) > 0 ? totalInv / num(inp.holes) : NaN;
      out.perVisitorRev = v > 0 ? rev * 1e8 / v : NaN; out.perVisitorProfit = v > 0 ? ebit * 1e8 / v : NaN;
      out.capex = num(inp.dev_eok) + num(inp.land_eok);
      out.total = (num(inp.price_eok) + out.capex);
      out.lines = [
        ['그린피', green, ''], ['카트 대여', cart, ''], ['식음', fb, ''], ['그늘집', shelter, ''], ['기타', other, ''],
        ['코스관리비', -maint, ''], ['카트관리비', -cartMgmt, ''], ['식음 원가', -fbCogs, ''], ['기타 원가', -otherCogs, ''], ['판매·관리비', -sga, ''],
        ['영업이익(EBIT)', ebit, 'noi']
      ];
      return out;
    },
    drivers: [
      { k: 'visitors', l: '일평균 내장객', deltas: [-100, -50, 0, 50, 100], fmt: function (v) { return v + '명'; } },
      { k: 'fee_weekend', l: '주말 그린피', deltas: [-30000, -15000, 0, 15000, 30000], fmt: function (v) { return n0(v / 10000) + '만'; } }
    ],
    notes: [
      '[원문] 청라골프장(27홀, 2017) — 주중 198일·주말 105일, 비회원 그린피 주말 195,000 / 주중 163,000원, 카트 20,000원/인, 식음 15,000원, 그늘집 6,000원, 기타 10,000원',
      '[원문] 비용 구조 — 코스관리비 그린피의 25%, 카트관리비 10%, 식음원가 30%, 기타원가 70%, 판관비는 비전힐스 실적 대비 약 55%(감가 포함)',
      '[원문] 총투자 495.65억(조성 210억·건축 117.6억·유틸리티 28억·설계 22.4억·운영설비 40억 등), IRR 12.20%(할인율 8%, 17년)',
      '[가정] 2026년 기준으로 조성·건축비를 700억(27홀)·그린피 수도권 주중 20만·주말 25만원·일평균 내장객 330명(연 300일, 약 9.9만명)으로 갱신했습니다. 청라 모델의 매출 규모(연 200억원대)에 맞춘 값입니다.',
      '[가정] 엑시트 캡 12%는 골프장 거래 관행(EBITDA 8배 수준)을 반영한 값입니다. 원 모델은 할인율 8%·17년으로 IRR 12.2%를 산출했습니다.',
      '[가정] 판관비 35%는 감가상각을 제외한 운영 기준입니다(원 모델 55%는 감가 포함).'
    ]
  };

  /* ══════════════════════════════════ 리조트 ══════════════════════════════════ */
  var RESORT = {
    key: 'resort', label: '🏖 리조트·콘도', name: '리조트 분양 + 운영 수지',
    desc: '콘도 분양수입 + 운영수입 − 토지비·건축비·판매비·금융비 → 세전이익·수익률',
    groups: [
      { g: '객실 · 분양', items: [
        { k: 'rooms', l: '객실 수(실)', t: 'num', step: 1 },
        { k: 'sale_ratio', l: '분양 비율(%)', t: 'num', step: 1 },
        { k: 'unit_price', l: '실당 분양가(억원)', t: 'num', step: 0.1 },
        { k: 'adr', l: '운영 객실 ADR(원)', t: 'num', step: 1000 },
        { k: 'occ', l: '운영 OCC(%)', t: 'num', step: 0.5 },
        { k: 'ancillary', l: '부대시설 수입(억/년)', t: 'num', step: 0.1 }
      ] },
      { g: '사업비', items: [
        { k: 'land_py', l: '사업면적(평)', t: 'num', step: 1 },
        { k: 'land_price', l: '토지 단가(만원/평)', t: 'num', step: 1 },
        { k: 'gfa_py', l: '연면적(평)', t: 'num', step: 1 },
        { k: 'build_cost', l: '건축비(만원/평)', t: 'num', step: 10 },
        { k: 'sale_cost_pct', l: '판매비(분양수입 %)', t: 'num', step: 0.1 },
        { k: 'finance_eok', l: '금융비(억원)', t: 'num', step: 0.5 },
        { k: 'reserve_eok', l: '예비비·개원준비금(억원)', t: 'num', step: 0.5 }
      ] },
      { g: '수익 · 매각', items: [
        { k: 'op_years', l: '운영 반영 연수', t: 'num', step: 1, min: 1, max: 10 },
        { k: 'op_margin', l: '운영 NOI 마진(%)', t: 'num', step: 0.5 },
        { k: 'exit_cap_pct', l: '운영분 엑시트 캡(%)', t: 'num', step: 0.05 },
        { k: 'price_eok', l: '매입가(억원)', t: 'num', step: 1 },
        { k: 'target_irr', l: '목표 수익률(%)', t: 'num', step: 0.5 }
      ] }
    ],
    defaults: function (a) {
      return {
        engine: 'resort', mode: 'resort', asset_id: a ? a.id : '', name: a ? a.name : '리조트',
        rooms: 154, sale_ratio: 100, unit_price: 4.17, adr: 180000, occ: 60, ancillary: 0,
        land_py: 11569, land_price: 10.4, gfa_py: 7738, build_cost: 500, sale_cost_pct: 4.9,
        finance_eok: 0, reserve_eok: 10, op_years: 5, op_margin: 30, exit_cap_pct: 7.0,
        price_eok: 0, acq_cost_pct: 4.6, exit_cost_pct: 0.5, noi_growth_pct: 2.0, hold_years: 5,
        ltv_senior: 55, ltv_mezz: 0, s_rate1: 5.2, s_rate2: 4.9, s_rate3: 4.6,
        m_rate1: 7.0, m_rate2: 6.5, m_rate3: 6.2, target_irr: 10
      };
    },
    calc: function (inp) {
      var rooms = num(inp.rooms);
      var sellRooms = rooms * num(inp.sale_ratio) / 100;
      var saleRev = sellRooms * num(inp.unit_price);
      var opRooms = rooms - sellRooms;
      var opRev = opRooms * 365 * num(inp.occ) / 100 * num(inp.adr) / 1e8 + num(inp.ancillary);
      var opNoi = opRev * num(inp.op_margin) / 100;
      var land = num(inp.land_py) * num(inp.land_price) / 1e4;
      var build = num(inp.gfa_py) * num(inp.build_cost) / 1e4;
      var saleCost = saleRev * num(inp.sale_cost_pct) / 100;
      var cost = land + build + saleCost + num(inp.finance_eok) + num(inp.reserve_eok);
      var profit = saleRev - cost + opNoi * num(inp.op_years);
      /* 분양형 수지는 IRR 대신 세전이익률로 본다 (분양 시점·스케줄 가정이 필요해 IRR을 만들지 않음) */
      var out = {
        price: num(inp.price_eok), capex: cost, total: cost, acq: 0,
        senior: 0, mezz: 0, equity: 0, ltv: 0, noi1: opNoi,
        N: Math.round(num(inp.hold_years, 5)), rows: [], exitNoi: opNoi, exitValue: NaN, netSale: 0,
        unlevIrr: NaN, levIrr: NaN, em: NaN, avgCoc: NaN, dscrMin: NaN, entryCap: NaN, noCf: true
      };
      out.saleRev = saleRev; out.sellRooms = sellRooms; out.opRev = opRev; out.opNoi = opNoi;
      out.land = land; out.build = build; out.saleCost = saleCost; out.cost = cost; out.profit = profit;
      out.margin = (saleRev + opNoi * num(inp.op_years)) > 0 ? profit / (saleRev + opNoi * num(inp.op_years)) * 100 : NaN;
      out.perUnitCost = rooms > 0 ? cost / rooms : NaN;
      out.lines = [
        ['콘도 분양수입(' + n0(sellRooms) + '실)', saleRev, ''],
        ['운영수입(연 ' + n0(num(inp.op_years)) + '년)', opRev * num(inp.op_years), ''],
        ['토지비', -land, ''], ['건축비', -build, ''], ['판매비', -saleCost, ''],
        ['금융비', -num(inp.finance_eok), ''], ['예비비·개원준비', -num(inp.reserve_eok), ''],
        ['세전이익', profit, 'noi']
      ];
      return out;
    },
    drivers: [
      { k: 'unit_price', l: '실당 분양가(억)', deltas: [-1.0, -0.5, 0, 0.5, 1.0], fmt: function (v) { return n1(v) + '억'; } },
      { k: 'build_cost', l: '건축비(만원/평)', deltas: [-50, -25, 0, 25, 50], fmt: function (v) { return n0(v); } }
    ],
    notes: [
      '[원문] 콘도·리조트 수지 모델(2013) — 154실(회원분 88 + 법인분 66), 분양수입 642.5억, 실당 1.57~7.29억',
      '[원문] 사업비 — 토지 11,569평×10.4만원/평 12.0억, 건축 7,738평×434.2만원/평 336.0억, 판매비 4.9%(광고 1%+분양대행 3%+신탁 0.9%), 금융비 8%×21개월 52.9억, 예비 10억 → 총 524.1억, 세전이익 118.4억(18.4%)',
      '[가정] 건축비는 2013년 434만원/평 → 2026년 500만원/평으로 갱신했습니다. 리조트 신축은 마감·부대시설 수준에 따라 450~700만원/평 범위입니다.',
      '[가정] 분양 비율을 100% 미만으로 두면 잔여 객실을 운영(NOI)으로 계산합니다. OCC·ADR은 리조트·콘도 시장 평균 가정치입니다.'
    ]
  };

  /* ══════════════════════════════════ 데이터센터 ══════════════════════════════════ */
  var DC = {
    key: 'datacenter', label: '🖥 데이터센터', name: '데이터센터 개발·임대 수지',
    desc: 'IT 부하(MW)×임대단가 − PUE 전력비·운영비 → NOI → 감당 지가·IRR',
    groups: [
      { g: '시설 · 임대', items: [
        { k: 'mw', l: 'IT 부하(MW)', t: 'num', step: 0.5 },
        { k: 'kw_rate', l: '임대단가(원/kW/월)', t: 'num', step: 1000 },
        { k: 'util', l: '가동률(%)', t: 'num', step: 1 },
        { k: 'pue', l: 'PUE(전력사용효율)', t: 'num', step: 0.05 },
        { k: 'power', l: '전력단가(원/kWh, 참고)', t: 'num', step: 1 }
      ] },
      { g: '개발비 · 운영비', items: [
        { k: 'dev_per_mw', l: '개발비(억원/MW)', t: 'num', step: 1 },
        { k: 'land_eok', l: '토지비(억원)', t: 'num', step: 1 },
        { k: 'opex_pct', l: '운영비(임대매출 대비 %)', t: 'num', step: 0.5 },
        { k: 'capex_eok', l: '추가 CAPEX(억원)', t: 'num', step: 1 }
      ] },
      { g: '매입 · 매각 · 조달', items: [
        { k: 'price_eok', l: '매입가(억원, 기존 자산)', t: 'num', step: 1 },
        { k: 'acq_cost_pct', l: '매입 부대비용(%)', t: 'num', step: 0.1 },
        { k: 'exit_cap_pct', l: '엑시트 캡레이트(%)', t: 'num', step: 0.05 },
        { k: 'exit_cost_pct', l: '매각 부대비용(%)', t: 'num', step: 0.1 },
        { k: 'noi_growth_pct', l: 'NOI 상승률(%/년)', t: 'num', step: 0.1 },
        { k: 'hold_years', l: '보유기간(년)', t: 'num', step: 1, min: 3, max: 10 },
        { k: 'ltv_senior', l: '선순위 LTV(%)', t: 'num', step: 0.1 },
        { k: 's_rate1', l: '선순위 금리(%)', t: 'num', step: 0.05 },
        { k: 's_rate2', l: '선순위 금리(3~5년차 %)', t: 'num', step: 0.05 },
        { k: 's_rate3', l: '선순위 금리(6년차~ %)', t: 'num', step: 0.05 },
        { k: 'target_irr', l: '목표 IRR(%)', t: 'num', step: 0.5 }
      ] }
    ],
    defaults: function (a) {
      var mw = num(regexNum(a && (a.name + ' ' + a.scale_info + ' ' + a.notes), /(\d+(?:\.\d+)?)\s*(?:MW|메가|메가와트)/i), 10);
      return {
        engine: 'datacenter', mode: 'datacenter', asset_id: a ? a.id : '', name: a ? a.name : '데이터센터',
        mw: mw || 10, kw_rate: 150000, util: 95, pue: 1.4, power: 130,
        dev_per_mw: 150, land_eok: 0, opex_pct: 30, capex_eok: 0,
        price_eok: 0, acq_cost_pct: 1.0, exit_cap_pct: 5.5, exit_cost_pct: 0.5,
        noi_growth_pct: 2.0, hold_years: 7, ltv_senior: 60, ltv_mezz: 0,
        s_rate1: 5.0, s_rate2: 4.8, s_rate3: 4.6, m_rate1: 6.8, m_rate2: 6.3, m_rate3: 6.0, target_irr: 11
      };
    },
    calc: function (inp) {
      var mw = num(inp.mw), util = num(inp.util) / 100;
      var rev = mw * 1000 * num(inp.kw_rate) * 12 * util / 1e8;
      /* 전력비는 대부분 임차인 pass-through(원가 회수)이므로 NOI 에서 제외하고 참고치로 표시 */
      var kwh = mw * num(inp.pue) * 1000 * 8760 * util;
      var power = kwh * num(inp.power) / 1e8;
      var opex = rev * num(inp.opex_pct) / 100;
      var noi = rev - opex;
      var dev = mw * num(inp.dev_per_mw);
      var total = dev + num(inp.land_eok) + num(inp.capex_eok) + num(inp.price_eok);
      var out = cf(finOf(inp, dev + num(inp.land_eok), true), noi, inp.noi_growth_pct);
      if (num(inp.price_eok) > 0 && dev <= 0) out.total = num(inp.price_eok) * (1 + num(inp.acq_cost_pct) / 100);
      out.rev = rev; out.power = power; out.opex = opex; out.noi = noi; out.dev = dev;
      out.devTotal = total; out.yield = total > 0 ? noi / total * 100 : NaN;
      out.revPerMw = mw > 0 ? rev / mw : NaN; out.noiPerMw = mw > 0 ? noi / mw : NaN;
      out.powerPerKw = num(inp.power) * 730 * num(inp.pue);
      out.landResidual = num(inp.exit_cap_pct) > 0 ? (noi / (num(inp.exit_cap_pct) / 100)) - dev - num(inp.capex_eok) : NaN;
      out.lines = [
        ['임대 매출(' + n1(mw) + 'MW × ' + n0(num(inp.kw_rate)) + '원/kW)', rev, ''],
        ['운영비(인건·유지보수·보험·PM)', -opex, ''],
        ['NOI', noi, 'noi'],
        ['개발비(' + n1(num(inp.dev_per_mw)) + '억/MW)', -dev, ''],
        ['참고) 전력비 pass-through(연)', -power, '']
      ];
      return out;
    },
    drivers: [
      { k: 'kw_rate', l: '임대단가(원/kW)', deltas: [-30000, -15000, 0, 15000, 30000], fmt: function (v) { return n0(v / 1000) + '천'; } },
      { k: 'dev_per_mw', l: '개발비(억/MW)', deltas: [-30, -15, 0, 15, 30], fmt: function (v) { return n0(v); } }
    ],
    notes: [
      '[원문] IBC·한진CY·김포TJ 재무모델의 수익→비용→NOI→조달→Exit 구조를 그대로 따랐습니다(연도별 현금흐름·LTV 구간금리).',
      '[가정] 2026년 수도권 기준 코로케이션 임대단가 15만원/kW/월, 개발비 150억원/MW, 운영비 30%(인건·유지보수·보험·PM)를 기본값으로 두었습니다.',
      '[가정] 전력비는 임차인 pass-through(원가 회수)로 보고 NOI 에서 제외했습니다. 자기부담으로 돌릴 경우 PUE 1.4·130원/kWh 기준 kW당 월 13.3만원이 추가 비용입니다.',
      '[가정] 실제 프로젝트는 수전 용량(MW)·계약전력·인허가 조건에 따라 개발비가 120~200억/MW로 크게 달라집니다. 팀장회의에서 논의된 천안 100MW·양산 80MW 부지는 수전 규모 기준입니다.',
      '[참고] 감당 지가 = (NOI ÷ Exit Cap) − 개발비 − CAPEX 로 계산해, 부지 매입 상한을 바로 볼 수 있게 했습니다.'
    ]
  };

  var ENGINES = { hotel: HOTEL, golf: GOLF, resort: RESORT, datacenter: DC };

  /* ───────────────────────── 공통 유틸 ───────────────────────── */
  function factsMap(a) {
    var m = {};
    ((a && a.facts) || []).forEach(function (f) { if (f && f.label) m[String(f.label)] = String(f.value || ''); });
    return m;
  }
  function pickNum(m, keys, dflt) {
    for (var i = 0; i < keys.length; i++) {
      var v = m[keys[i]];
      if (v) { var n = num(String(v).replace(/[^\d.\-]/g, ''), 0); if (n) return n; }
    }
    return dflt;
  }
  function pickAreaPy(a, dflt) {
    var m = factsMap(a);
    var v = m['연면적'] || (a && a.scale_info) || '';
    var mm = String(v).match(/([\d,\.]+)\s*평/);
    return mm ? num(mm[1].replace(/,/g, ''), dflt) : dflt;
  }
  function regexNum(s, re) { var m = String(s || '').match(re); return m ? num(m[1]) : 0; }

  function has(k) { return !!ENGINES[k]; }
  function engine(k) { return ENGINES[k] || null; }
  function defaults(k, a) { return ENGINES[k] ? ENGINES[k].defaults(a) : null; }

  function fieldHTML(e, inp, f) {
    var id = 'v-' + f.k;
    var v = (inp[f.k] === undefined || inp[f.k] === null) ? '' : inp[f.k];
    return '<div class="vf"><label for="' + id + '">' + f.l + '</label>' +
      '<input id="' + id + '" data-k="' + f.k + '" type="number" inputmode="decimal" value="' + String(v) + '"' +
      (f.step ? ' step="' + f.step + '"' : '') + (f.min !== undefined ? ' min="' + f.min + '"' : '') +
      (f.max !== undefined ? ' max="' + f.max + '"' : '') + '></div>';
  }

  function kpi(r, e, inp) {
    var target = num(inp.target_irr, 10);
    var ok = isFinite(r.levIrr) && r.levIrr * 100 >= target;
    function card(l, v, s, cls) {
      return '<div class="vk' + (cls ? ' ' + cls : '') + '"><span class="vk-l">' + l + '</span>' +
        '<span class="vk-v">' + v + '</span>' + (s ? '<span class="vk-s">' + s + '</span>' : '') + '</div>';
    }
    var out = [];
    if (e.key === 'hotel') {
      out.push(card('Y1 매출', n1(r.rev) + '억', '객실 ' + n1(r.roomRev) + ' · 식음 ' + n1(r.fbRev) + ' · 기타 ' + n1(r.otherRev)));
      out.push(card('GOP (NOI)', n1(r.noi) + '억', 'GOP 마진 ' + pct1(r.gopMargin)));
      out.push(card('RevPAR', n0(r.revpar) + '원', 'OCC ' + n1(num(inp.occ)) + '% × ADR ' + n0(num(inp.adr))));
      out.push(card('실당 매입가', isFinite(r.perKey) && r.perKey > 0 ? n1(r.perKey) + '억/실' : '-', '총투자 기준 ' + (isFinite(r.perKeyTotal) ? n1(r.perKeyTotal) + '억/실' : '-')));
    } else if (e.key === 'golf') {
      out.push(card('연 매출', n1(r.rev) + '억', '내장객 ' + n0(r.visitors) + '명 · 평균 그린피 ' + n0(r.greenFeeAvg)));
      out.push(card('영업이익(EBIT)', n1(r.ebit) + '억', 'EBIT 마진 ' + pct1(r.ebitMargin)));
      out.push(card('객단가 / 객당 이익', n0(r.perVisitorRev) + '원', '객당 ' + n0(r.perVisitorProfit) + '원'));
      out.push(card('홀당 투자비', isFinite(r.invPerHole) ? n1(r.invPerHole) + '억' : '-', '총투자 ' + n1(r.total) + '억'));
    } else if (e.key === 'resort') {
      out.push(card('분양수입', n1(r.saleRev) + '억', n0(r.sellRooms) + '실 × ' + n1(num(inp.unit_price)) + '억'));
      out.push(card('총사업비', n1(r.cost) + '억', '토지 ' + n1(r.land) + ' · 건축 ' + n1(r.build) + ' · 판매 ' + n1(r.saleCost)));
      out.push(card('세전이익', n1(r.profit) + '억', '수익률 ' + pct1(r.margin)));
      out.push(card('실당 사업비', isFinite(r.perUnitCost) ? n1(r.perUnitCost) + '억' : '-', '운영 NOI(연) ' + n1(r.opNoi) + '억'));
      out.push(card('세전이익률', pct1(r.margin), '분양+운영 ' + n0(num(inp.op_years)) + '년 기준'));
    } else {
      out.push(card('연 임대매출', n1(r.rev) + '억', n1(num(inp.mw)) + 'MW · ' + n0(num(inp.kw_rate)) + '원/kW'));
      out.push(card('NOI', n1(r.noi) + '억', 'NOI 수익률 ' + pct1(r.yield)));
      out.push(card('개발비', n1(r.devTotal) + '억', n1(num(inp.dev_per_mw)) + '억/MW × ' + n1(num(inp.mw)) + 'MW'));
      out.push(card('감당 지가', isFinite(r.landResidual) ? n0(r.landResidual) + '억' : '-', 'Exit Cap ' + n2(num(inp.exit_cap_pct)) + '% 기준'));
    }
    if (e.noCf) return out.join('');
    out.push(card('매입가', num(inp.price_eok) > 0 ? n1(num(inp.price_eok)) + '억' : '미입력', num(inp.price_eok) > 0 ? ('부대비용 ' + n1(r.acq) + '억') : '매수자 제안가 입력 필요'));
    out.push(card('총투자비', n1(r.total) + '억', '매입가 + 부대비용 + CAPEX ' + n1(num(inp.capex_eok)) + '억'));
    out.push(card('에쿼티', n1(r.equity) + '억', '부채 ' + n1(r.senior + r.mezz) + '억 · LTV ' + pct1(r.ltv)));
    out.push(card('Levered IRR', isFinite(r.levIrr) ? pct2(r.levIrr * 100) : '-', '목표 ' + n1(target) + '% ' + (ok ? '▲ 초과' : '▽ 미달'), ok ? 'good' : 'bad'));
    out.push(card('Unlevered IRR', isFinite(r.unlevIrr) ? pct2(r.unlevIrr * 100) : '-', '자산 단독'));
    out.push(card('Equity Multiple', isFinite(r.em) ? r.em.toFixed(2) + 'x' : '-', '총회수/에쿼티'));
    out.push(card('평균 CoC', isFinite(r.avgCoc) ? pct2(r.avgCoc * 100) : '-', '연 NCF/에쿼티'));
    out.push(card('Exit 가치', isFinite(r.exitValue) ? n1(r.exitValue) + '억' : '-', 'Exit Cap ' + n2(num(inp.exit_cap_pct)) + '%'));
    out.push(card('최저 DSCR', isFinite(r.dscrMin) ? r.dscrMin.toFixed(2) + 'x' : '-', '이자 대비 NOI'));
    return out.join('');
  }

  function plHTML(r, e) {
    if (!r.lines) return '';
    var rows = r.lines.map(function (l) {
      var cls = l[2] ? ' class="' + l[2] + '"' : '';
      var v = l[1];
      var neg = v < 0;
      return '<tr' + cls + '><th>' + l[0] + '</th><td class="' + (neg ? 'neg' : '') + '">' + (neg ? '(' + n1(Math.abs(v)) + ')' : n1(v)) + '</td></tr>';
    }).join('');
    return '<section class="val-block"><h3>' + e.label + ' 연간 손익 (Y1, 억원)</h3>' +
      '<table class="val-pl">' + rows + '</table>' +
      '<p class="val-note">' + (e.noCf
        ? 'Y1 기준. 분양수입과 운영 NOI 를 함께 반영한 세전이익입니다(IRR 대신 세전이익률로 평가).'
        : 'Y1 기준. 이후 연도는 NOI 상승률 ' + n1(num(r._inp ? r._inp.noi_growth_pct : 2)) + '%/년으로 가정합니다.') + '</p></section>';
  }

  function cashflowHTML(r) {
    var head = '<tr><th>연차</th><th>NOI</th><th>이자</th><th>NCF</th><th>누적</th><th>DSCR</th><th>CoC</th></tr>';
    var body = r.rows.map(function (x) {
      return '<tr><td>' + x.y + '</td><td>' + n1(x.noi) + '</td><td>' + n1(x.interest) + '</td><td>' + n1(x.ncf) + '</td>' +
        '<td>' + n1(x.cum) + '</td><td>' + (isFinite(x.dscr) ? x.dscr.toFixed(2) : '-') + '</td><td>' + (isFinite(x.coc) ? pct1(x.coc * 100) : '-') + '</td></tr>';
    }).join('');
    return '<section class="val-block"><h3>연도별 현금흐름 (억원)</h3><div class="val-table-wrap"><table class="val-cf">' + head + body + '</table></div></section>';
  }

  function sensHTML(inp, e, metric) {
    if (!e.drivers) return '';
    if (e.noCf) metric = 'margin';
    var d1 = e.drivers[0], d2 = e.drivers[1];
    var base1 = num(inp[d1.k]), base2 = num(inp[d2.k]);
    var v1 = d1.deltas.map(function (d) { return d1.scale ? base1 + d * d1.scale : base1 + d; });
    var v2 = d2.deltas.map(function (d) { return d2.scale ? base2 + d * d2.scale : base2 + d; });
    var target = num(inp.target_irr, 10);
    var head = '<tr><th>' + d1.l + ' ↓ / ' + d2.l + ' →</th>' + v2.map(function (v) { return '<th>' + d2.fmt(v) + '</th>'; }).join('') + '</tr>';
    var body = v1.map(function (a1) {
      return '<tr><th>' + d1.fmt(a1) + '</th>' + v2.map(function (a2) {
        var t = {}; for (var k in inp) if (Object.prototype.hasOwnProperty.call(inp, k)) t[k] = inp[k];
        t[d1.k] = a1; t[d2.k] = a2;
        var r = e.calc(t);
        var val, cls = '';
        if (metric === 'noi') { val = n1(r.noi !== undefined ? r.noi : r.ebit); }
        else if (metric === 'cap') { val = pct2(r.entryCap); }
        else if (metric === 'margin') { val = pct1(r.margin); }
        else { val = isFinite(r.levIrr) ? pct2(r.levIrr * 100) : '-'; if (r.levIrr * 100 >= target) cls = 'good'; if (r.levIrr * 100 < target - 3) cls = 'bad'; }
        var isBase = Math.abs(a1 - base1) < 1e-9 && Math.abs(a2 - base2) < 1e-9;
        return '<td class="' + cls + (isBase ? ' base' : '') + '">' + val + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<section class="val-block"><h3>민감도 — ' + d1.l + ' × ' + d2.l + ' (' + (metric === 'noi' ? 'NOI/영업이익(억)' : metric === 'cap' ? '수익률(%)' : metric === 'margin' ? '세전이익률(%)' : 'Levered IRR') + ')</h3>' +
      '<div class="val-table-wrap"><table class="val-sens">' + head + body + '</table></div></section>';
  }

  function body(k, inp) {
    var e = ENGINES[k];
    if (!e) return '';
    var r = e.calc(inp);
    r._inp = inp;
    var html = '';
    html += '<div class="val-grid">';
    html += '<div class="val-inputs" id="valInputs"><div class="val-engine-head"><span class="ve-badge">' + e.label + '</span>' +
      '<strong>' + e.name + '</strong><p>' + e.desc + '</p></div>';
    e.groups.forEach(function (g) {
      html += '<section class="vg"><h4>' + g.g + '</h4><div class="vg-grid">';
      g.items.forEach(function (f) { html += fieldHTML(e, inp, f); });
      html += '</div></section>';
    });
    html += '<div class="val-actions"><button type="button" class="btn btn-ghost" id="valFavBtn">⭐ 즐겨찾기</button>' +
      (k === 'hotel' ? '<span class="val-hint">와이즈파크 81→213실 컨버전 기본값이 들어 있습니다.</span>' : '') + '</div>';
    html += '</div>';
    html += '<main class="val-result"><div class="val-kpis" id="valKpis">' + kpi(r, e, inp) + '</div>' +
      '<div id="valPL">' + plHTML(r, e) + '</div>' +
      '<section class="val-block"><h3>민감도</h3><div class="val-sens-wrap" id="valSens">' +
      sensHTML(inp, e, 'irr') + '</div></section>' +
      (e.noCf ? '' : '<section class="val-block"><h3>연도별 현금흐름</h3><div id="valCF2">' + cashflowHTML(r) + '</div></section>') +
      '<section class="val-block"><h3>가정·출처 (모델 28종 레퍼런스)</h3><ul class="val-notes">' +
      e.notes.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ul></section>' +
      '</main></div>';
    return html;
  }

  /** 입력 변경 시 결과부만 갱신 */
  function refresh(k, inp, host) {
    var e = ENGINES[k];
    if (!e) return;
    var r = e.calc(inp); r._inp = inp;
    var root = host || document;
    var kp = root.querySelector('#valKpis'); if (kp) kp.innerHTML = kpi(r, e, inp);
    var pl = root.querySelector('#valPL'); if (pl) pl.innerHTML = plHTML(r, e);
    var sn = root.querySelector('#valSens'); if (sn) sn.innerHTML = sensHTML(inp, e, 'irr');
    var cfh = root.querySelector('#valCF2'); if (cfh && !e.noCf) cfh.innerHTML = cashflowHTML(r);
  }

  /** 섹터 엔진 입력 바인딩 — 숫자 입력만 다룬다 */
  function bind(host, getInp, onChange) {
    var box = host.querySelector('#valInputs');
    if (!box) return;
    box.addEventListener('input', function (ev) {
      var el = ev.target;
      var k = el.getAttribute('data-k');
      if (!k) return;
      if (el.value === '') return;
      var inp = getInp();
      inp[k] = num(el.value);
      onChange(k);
    });
  }

  window.NAI_VALSEC = {
    ENGINES: ENGINES, has: has, engine: engine, defaults: defaults,
    body: body, refresh: refresh, bind: bind, calc: function (k, inp) { return ENGINES[k] ? ENGINES[k].calc(inp) : null; }
  };
})();
