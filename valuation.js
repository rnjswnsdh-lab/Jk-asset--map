/* =========================================================================
   NAI Korea 상업용 부동산 통합 지도 — valuation.js
   📊 밸류에이션 · 수익성 시뮬레이터 (2026-11-22 신설)

   - 물건별 렌트롤·OPEX·CAPEX 자료를 바탕으로 매입~매각 현금흐름을 재계산
   - 이니셜 캡 ↔ 매입가 연동, 구간별 조달금리, 엑시트 캡
   - 2D 민감도: ① 이니셜 캡 × 엑시트 캡  ② 조달금리 × 엑시트 캡
   - 프리셋: 종로플레이스(오피스·엣지DC), 김포고촌 KMTC, 수서 B1-3BL, 이천 덕평(롯데 PFV)
     — 수익형(렌트롤) 모드 / 케이카 오산동탄 — 공동주택 개발형(RLV) 모드
   - 물건 상세의 [📊 수익성 시뮬레이션]이 해당 물건의 프리셋으로 연결됩니다.
   - 공동주택 개발형(mode: 'dev_res'): 용적률·기부채납·분양가·공사비 → 분양수입·사업비 →
     감당 가능 지가(RLV)를 역산. 2종/3종 비교, 분양가×기부채납·용적률×공사비 2D 민감도.
   - 관리자 코드는 시나리오를 비공개 시트(valuations)에 저장·불러오기
     읽기 전용 코드는 저장 불가, 슬라이더·민감도 테스트는 자유
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
  function nEok(v) { return (v === null || v === undefined || !isFinite(v)) ? '-' : (Math.abs(v - Math.round(v)) < 0.05 ? n0(v) : n1(v)); }

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
    },
    /* ── 2026-11-23 추가: 케이카 오산동탄(공동주택 개발형) · 수서 B1-3BL · 롯데 덕평 ── */
    {
      id: 'kia-osan',
      name: '케이카 오산동탄 (공동주택 개발형 · RLV)',
      short: '케이카 개발형',
      asset_ids: ['land-kia-osan'],
      sector: 'residential',
      mode: 'dev_res',
      src: '하나트러스트제7호 제8기 감사보고서(2026-06-30)·매각자문사 선정 RFP(2026-11-20) + 오산시 도시계획 조례 §51(2종 220%·3종 280%) + 오산 은계동·세교2지구 실거래',
      memo: '2026-11-23 개발형 수지 검토: 기부채납 17%·공사비 680만 기준 — 2종 220% 분양가 1,450/1,550/1,650만 → RLV 81/182/283억 · 3종 280% 1,550/1,650/1,750만 → 232/360/488억. 장부원가 463.7억 회수는 3종에서 분양가 평당 1,731만 원(84㎡ 공급 33평 ≈ 5.7억) 필요',
      verify: '이 화면의 RLV는 2026-11-23 검토식(순대지 = 사업지 × (1−기부채납), 지상 연면적 = 순대지 × 용적률, 지하 포함 연면적 = 지상 × 1.45, 세대수 = 지상 ÷ 33평, 사업비 = 지하 포함 연면적 × 공사비 + 매출 × 간접·금융·판매비 18% + 매출 × 시행마진 10%)을 그대로 구현했습니다. 기본값(3종 280%·기부채납 17%·공사비 680만·분양가 1,650만)에서 RLV 360억·평당 469만 원으로 검토치와 일치하고, 2종 220%·1,450만에서 81억·1,650만에서 283억이 재현됩니다.',
      notes: [
        '사업지: 오산시 은계동 7-30 외 9필지(현충로 95) 대지 25,352㎡ = 7,669평, 자연녹지·시가화예정 주거용지 [원문: RFP·감사보고서]',
        '인접 3,578평 포함 37,181㎡(11,247평) 도시개발구역 지정 제안서 제출 상태 — 통합 개발 시 사업지 면적을 전환해 보세요 [원문: RFP]',
        '용적률: 제2종 일반주거 220% / 제3종 일반주거 280% — 오산시 도시계획 조례 §51 상한 [원문]',
        '기부채납 17%는 도로·공원·녹지 등 기반시설 무상귀속 가정. 자연녹지→3종 상향 시 공공기여가 20~25%로 커질 수 있어 민감도 표에서 함께 보세요 [가정]',
        '지하 포함 연면적 계수 1.45(세대당 1.3~1.5대 주차), 세대당 공급 33평(84㎡)은 산출 가정 [가정]',
        '간접비·금융비·판매비 18%, 시행사 마진 10% (분양수입 대비) [가정]',
        '직접공사비 680만 원/평(지하 포함 연면적 기준) [가정]',
        '분양가 1,650만 원/평 ≈ 84㎡ 5.4억 원. 은계동 구축 평당 1,120만·세교2지구 신축 1,450만대 실거래 참고 [원문: 실거래]',
        '오산대역·오산역 도보 약 40분 비역세권 — 분양가 상단(1,850만 이상)은 신축 실거래 상회 구간 [원문: 카카오맵]'
      ],
      ref: {
        title: '참고 — 현재 리츠 보유·임대 조건 (하나트러스트제7호 제8기)',
        rows: [
          ['연 임대수익', '23.52억 (반기 11.76억 × 2)'],
          ['관리수익 · 시설관리비', '2.56억 / 2.56억 상계 → Y1 NOI 23.5억'],
          ['장부 취득원가', '463.7억 (토지 377.9 + 건물 85.9)'],
          ['차입금', '228억 (우리은행 180억 4.36% · 농협 48억 4.10%)'],
          ['임차보증금', '43.5억'],
          ['임차인 · 만기', '케이지모빌리티플랫폼 단일 · 2027-06-30 (2+1년 연장 확약)'],
          ['Going-in Cap', '5.07% (NOI 23.52억 ÷ 463.7억) · Exit 5.25% 기준 IRR 6.0%'],
          ['건물', '연면적 8,796.5평 · 1999~2017년 준공 모빌리티 시설']
        ]
      },
      inp: {
        mode: 'dev_res', name: '케이카 오산동탄 (공동주택 개발형)', sector: 'residential',
        asset_id: 'land-kia-osan', hold_years: 0, target_irr: 0,
        area_py: 7669, far_pct: 280, donation_pct: 17,
        sale_price_py: 1650, dev_cost_py: 680, soft_cost_pct: 18, profit_pct: 10,
        gfa_factor: 1.45, unit_py: 33, book_eok: 463.7
      }
    },
    {
      id: 'suseo-b13',
      name: '수서역세권 B1-3BL (선매각 2,850억·안정화)',
      short: '수서 3BL',
      asset_ids: ['off-suseo-b13'],
      sector: 'office',
      src: '수서 B1-3·4BL 자산소개자료(2026-11-12) + NAI 개발원가·적정매각가 추정(2026-11-16) 안정화 임대수지',
      memo: '적정 매각가 2,850억(범위 2,750~2,950억) · 개발원가 2,384억(평당 2,050만) · 안정화 NOI 134.96억 · 업무 임대료 108,000원/평·월',
      verify: '안정화 임대료 108,000원/평·월·공실 5%·렌트프리 0.55개월을 넣으면 Y1 NOI 134억(원문 모델 134.96억)이 재현됩니다. 매수자 기준 Going-in Cap 4.70%·엑시트 캡 4.50%에서 자산 단독 IRR 6.9%·레버리지 9.4%로 목표 12%에 미달 — 매도자(WAD) 이익은 매각가 2,850억 대 원가 2,384억의 466억에서 나오는 구조입니다.',
      notes: [
        '연면적 12,439.21평 · 업무 임대면적 10,965.8평 · 근생 1,473.41평 [원문: 자산소개자료]',
        '업무 108,000원/평·월 = GBD 프라임 138,300원을 전용률(48.5%÷58%)로 조정 후 수서 할인 −7% [가정: 세빌스 3Q26]',
        '근생 150,000원/평·월·공실 5%·렌트프리 4%(0.55개월) → PGI 168.6억·EGI 153.8억 [원문 모델 04_임대수지]',
        '건물주 OPEX 18.84억(3BL 배분분) → NOI 134.96억 [원문 모델]',
        '개발원가 2,384억 = 공사비 1,068.3억(KCC 실계약) + 금융비 386.3억 + 토지·간접비 929억 [원문·추정]',
        '매입가 2,850억은 Cap 4.5~5.0%(2,700~3,000억)와 목표 IRR 12~15%(2,560~3,000억)의 교집합 중앙값 [가정]',
        '조달 LTV 60%·금리 5.2→4.8→4.6%는 2026년 오피스 담보대출 수준 가정 [가정]',
        '엑시트 캡 4.50%·임대료 상승 2.5%/년 [가정]'
      ],
      inp: {
        name: '수서역세권 B1-3BL 오피스', sector: 'office', area_py: 12439.2, hold_years: 5,
        anchor: 'price', price_eok: 2850, entry_cap: 0, acq_cost_pct: 4.6, exit_cost_pct: 0.5, exit_cap_pct: 4.5,
        rent_mode: 'annual', rent_annual: 168.638, rent_per_py_month: 0, rf_months: 0.55,
        other_income: 0, vacancy_pct: 5, rent_growth_pct: 2.5,
        opex: 18.84, opex_growth_pct: 2.5, other_cost: 0,
        capex_initial: 0, capex_annual: 0.5, exit_capex: 0,
        add_noi: 0, add_noi_start: 2,
        ltv_senior: 60, ltv_mezz: 0, deposit_eok: 0,
        s_rate1: 5.2, s_rate2: 4.8, s_rate3: 4.6,
        m_rate1: 0, m_rate2: 0, m_rate3: 0,
        target_irr: 12
      }
    },
    {
      id: 'lotte-deokpyeong',
      name: '이천 덕평 물류센터 (기존 임대 유지·시장가 기준)',
      short: '롯데 덕평',
      asset_ids: ['log-fnd-032'],
      sector: 'logistics',
      src: '롯데건설 자료(2026-11-19)·자산개요(2026-11-02) + NAI 맥스개발 수지분석(2026-11-20) 기존 임대 유지 시나리오',
      memo: '기존 A·B·C동 17,712평 · 롯데글로벌로지스 책임임차 2.7만원/평(2030-06 만기) · NOI 48.8억 / Cap 6.0~6.5% 가치 751~813억 vs 대출 1,570억',
      verify: '연 임대수입 57.4억의 85%를 NOI로 보면 48.8억, Cap 6.0% 가치 813억이 재현됩니다. 현재 대출 1,570억이 담보가치를 700~800억 웃돌아(LTV 177~209%) 에쿼티가 이미 잠식된 구조 — DC 전환·수전 프리미엄이나 필지 분할매각 없이는 리파이(B/L 2027-02)가 성립하지 않습니다.',
      notes: [
        '기존 연면적 17,711.78평(A 6,931.53 / B 10,730.49 / C 49.76) · 2006~2009년 준공 [원문: 자산개요]',
        '책임임차 2025-07 개시·5년·평당 2.7만원(연면적 기준) → 연 임대수입 57.4억 [원문: 롯데 메일 본문]',
        'NOI 48.8억은 임대수입의 85%(관리비 별도 정산·공실 0·단일 임차) 가정 [가정]',
        '매입가 813억은 Cap 6.0% 시장가치 — 인수원가 1,300억·현 투입원가 1,620억과 구분해 보세요 [추정]',
        '엑시트 캡 6.0%(2006년 준공·지하 48%·관련사 임차), 임대료 상승 1.0%/년 [가정]',
        '보유 4년은 책임임차 만기 2030-06에 맞춘 가정 [가정]',
        'DC 20MW 전환·물류 단독 맥스개발 수지는 별도 — 필요 임대료 7.5~10.3만원/평(YoC 5.5~6.5%)로 시세의 2~3배 [원문: 맥스개발 수지분석]'
      ],
      inp: {
        name: '이천 덕평 물류센터 (기존 임대)', sector: 'logistics', area_py: 17711.78, hold_years: 4,
        anchor: 'price', price_eok: 813, entry_cap: 0, acq_cost_pct: 4.6, exit_cost_pct: 0.5, exit_cap_pct: 6.0,
        rent_mode: 'annual', rent_annual: 57.4, rent_per_py_month: 0, rf_months: 0,
        other_income: 0, vacancy_pct: 0, rent_growth_pct: 1.0,
        opex: 8.6, opex_growth_pct: 2.0, other_cost: 0,
        capex_initial: 0, capex_annual: 0.5, exit_capex: 0,
        add_noi: 0, add_noi_start: 2,
        ltv_senior: 60, ltv_mezz: 0, deposit_eok: 0,
        s_rate1: 6.0, s_rate2: 6.0, s_rate3: 6.0,
        m_rate1: 0, m_rate2: 0, m_rate3: 0,
        target_irr: 6
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

  /* ═══════════════ 밸류애드(Value-add) 레이어 — 2026-11-24 ═══════════════
     사용자가 직접 조절하는 5개 파라미터를 기본 입력(inp)에 적용한 사본을 만들어
     As-Is 와 같은 엔진(calc)으로 다시 계산합니다. 별도 근사식이 아니라 동일 엔진이므로
     NOI·매각가·IRR·CoC 가 같은 기준으로 비교됩니다. */
  function vaInput(inp) {
    var o = clone(inp);
    var up = num(VA.uplift) / 100;
    if (up) {
      if (o.rent_mode === 'pyeong') o.rent_per_py_month = num(o.rent_per_py_month) * (1 + up);
      else o.rent_annual = num(o.rent_annual) * (1 + up);
    }
    if (num(VA.vacancy)) o.vacancy_pct = Math.max(0, num(o.vacancy_pct) - num(VA.vacancy));
    if (num(VA.capex)) o.capex_initial = num(o.capex_initial) + num(VA.capex);
    if (num(VA.exitCap)) o.exit_cap_pct = Math.max(0.5, num(o.exit_cap_pct) + num(VA.exitCap));
    if (num(VA.growth)) o.rent_growth_pct = num(o.rent_growth_pct) + num(VA.growth);
    return o;
  }
  function vaActive() { return !!(num(VA.uplift) || num(VA.vacancy) || num(VA.capex) || num(VA.exitCap) || num(VA.growth)); }

  function vaDelta(a, b, fmt, invert) {
    if (a === null || a === undefined || b === null || b === undefined || !isFinite(a) || !isFinite(b)) return '<span class="va-d">-</span>';
    var d = b - a;
    if (Math.abs(d) < 1e-9) return '<span class="va-d">±0</span>';
    var good = invert ? d < 0 : d > 0;
    return '<span class="va-d ' + (good ? 'up' : 'down') + '">' + (d > 0 ? '▲ ' : '▼ ') + fmt(Math.abs(d)) + '</span>';
  }

  function vaField(label, key, val, min, max, step, unit, hint) {
    return '<div class="va-f"><div class="va-fhead"><span>' + esc(label) + '</span>' +
      '<b><input type="number" data-va="' + key + '" value="' + esc(val) + '" step="' + step + '" min="' + min + '" max="' + max + '">' + unit + '</b></div>' +
      '<input type="range" data-va-range="' + key + '" value="' + esc(val) + '" min="' + min + '" max="' + max + '" step="' + step + '">' +
      '<em>' + esc(hint) + '</em></div>';
  }

  function vaSectionHTML(r) {
    var base = vaInput(S.inp);
    var vr = calc(base);
    var rows = [
      ['Y1 NOI (억/년)', n1(r.noi1), n1(vr.noi1), vaDelta(r.noi1, vr.noi1, function (v) { return n1(v); })],
      ['연 임대수입 (억)', n1(r.d.eff), n1(vr.d.eff), vaDelta(r.d.eff, vr.d.eff, function (v) { return n1(v); })],
      ['공실률 (%)', pct1(num(S.inp.vacancy_pct)), pct1(num(base.vacancy_pct)), vaDelta(num(S.inp.vacancy_pct), num(base.vacancy_pct), function (v) { return pct1(v); }, true)],
      ['총투자비 (억)', n0(r.total), n0(vr.total), vaDelta(r.total, vr.total, function (v) { return n0(v) + '억'; }, true)],
      ['에쿼티 (억)', n0(r.equity), n0(vr.equity), vaDelta(r.equity, vr.equity, function (v) { return n0(v) + '억'; }, true)],
      ['Exit Cap (%)', pct2(num(S.inp.exit_cap_pct)), pct2(num(base.exit_cap_pct)), vaDelta(num(S.inp.exit_cap_pct), num(base.exit_cap_pct), function (v) { return v.toFixed(2) + '%p'; }, true)],
      ['Exit 매각가 (억)', n0(r.exitValue), n0(vr.exitValue), vaDelta(r.exitValue, vr.exitValue, function (v) { return n0(v) + '억'; })],
      ['Levered IRR', irrPct(r.levIrr), irrPct(vr.levIrr), vaDelta(r.levIrr * 100, vr.levIrr * 100, function (v) { return pct2(v) + 'p'; })],
      ['Unlevered IRR', irrPct(r.unlevIrr), irrPct(vr.unlevIrr), vaDelta(r.unlevIrr * 100, vr.unlevIrr * 100, function (v) { return pct2(v) + 'p'; })],
      ['Equity Multiple', isFinite(r.em) ? r.em.toFixed(2) + 'x' : '-', isFinite(vr.em) ? vr.em.toFixed(2) + 'x' : '-', vaDelta(r.em, vr.em, function (v) { return v.toFixed(2) + 'x'; })],
      ['평균 CoC', pct2(r.avgCoc * 100), pct2(vr.avgCoc * 100), vaDelta(r.avgCoc * 100, vr.avgCoc * 100, function (v) { return pct2(v) + 'p'; })]
    ];
    var capex = num(VA.capex);
    var capGain = (isFinite(r.exitValue) && isFinite(vr.exitValue)) ? (vr.exitValue - r.exitValue) : NaN;
    var mult = (capex > 0 && isFinite(capGain)) ? (capGain / capex) : NaN;

    return '<section class="val-block va-block" id="valVA"><div class="val-block-head"><h3>🏗️ 밸류애드(Value-add) 시뮬레이터</h3>' +
      '<span class="va-tag' + (vaActive() ? ' on' : '') + '">' + (vaActive() ? '적용 중' : 'As-Is 기준') + '</span>' +
      '<button type="button" class="mini-btn" id="vaReset">초기화</button></div>' +
      '<div class="va-presets">' +
      [['경량 CAPEX', { uplift: 3, vacancy: 2, capex: 20, exitCap: 0, growth: 0 }],
       ['표준 리포지셔닝', { uplift: 8, vacancy: 3, capex: 80, exitCap: -0.25, growth: 0.5 }],
       ['적극 리모델링', { uplift: 15, vacancy: 5, capex: 200, exitCap: -0.5, growth: 1 }]]
        .map(function (p) { return '<button type="button" class="va-preset" data-va-preset="' + esc(p[0]) + '">' + esc(p[0]) + '</button>'; }).join('') +
      '</div>' +
      '<div class="va-grid">' +
      vaField('임대료 상향률', 'uplift', VA.uplift, 0, 30, 0.5, '%', '임대 롤오버·리뉴얼로 명목 임대료를 올리는 폭') +
      vaField('공실 해소', 'vacancy', VA.vacancy, 0, 15, 0.5, '%p', '공실률을 낮추어 임대수입을 회수하는 폭') +
      vaField('리모델링 CAPEX', 'capex', VA.capex, 0, 600, 5, '억원', '초기 투자비에 더해지는 공사·설비 투자') +
      vaField('Exit Cap 변동', 'exitCap', VA.exitCap, -1.5, 1.5, 0.05, '%p', '매각 시점 캡레이트 (음수 = 자산가치 상승)') +
      vaField('임대료 상승률 가속', 'growth', VA.growth, 0, 3, 0.1, '%p', '연 임대료 상승률에 더하는 폭') +
      '</div>' +
      '<div class="va-summary">' +
      '<div class="va-sum"><span>자산가치 증가</span><b>' + (isFinite(capGain) ? (capGain > 0 ? '+' : '') + n1(capGain) + '억' : '-') + '</b><em>Exit 매각가 기준</em></div>' +
      '<div class="va-sum"><span>투입 CAPEX</span><b>' + (capex ? n1(capex) + '억' : '-') + '</b><em>초기 투자비 가산</em></div>' +
      '<div class="va-sum"><span>가치/CAPEX 배수</span><b>' + (isFinite(mult) ? mult.toFixed(2) + 'x' : '-') + '</b><em>1.0x 이상이면 가치 창출</em></div>' +
      '<div class="va-sum"><span>IRR 변화</span><b class="' + (vr.levIrr >= r.levIrr ? 'good' : 'bad') + '">' +
      (isFinite(vr.levIrr) && isFinite(r.levIrr) ? ((vr.levIrr - r.levIrr) * 100 > 0 ? '+' : '') + ((vr.levIrr - r.levIrr) * 100).toFixed(2) + '%p' : '-') + '</b><em>Levered IRR</em></div>' +
      '</div>' +
      '<div class="val-table-wrap"><table class="vt va-table"><thead><tr><th>지표</th><th>As-Is</th><th>Value-Add</th><th>변화</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr><th>' + esc(x[0]) + '</th><td>' + x[1] + '</td><td class="b">' + x[2] + '</td><td>' + x[3] + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="va-note">밸류애드 값은 기본 입력 위에 얹혀 <b>같은 엔진</b>으로 다시 계산됩니다(별도 근사 없음). ' +
      'CAPEX 는 초기 투자비·에쿼티에 더해지고, Exit Cap 하락은 매각가를 올립니다. 실제 집행 전 공사비·임대차 조건을 확인하세요.</p>' +
      '</section>';
  }

  /* ═══════════════════ 공동주택 개발형(RLV) 엔진 ═══════════════════════ */
  /* 2026-11-23 오산 케이카 개발형 수지 검토식 그대로 구현:
     순대지 = 사업지 × (1−기부채납)
     지상 연면적 = 순대지 × 용적률, 지하 포함 연면적 = 지상 × 1.45
     분양수입 = 지상 연면적 × 분양가
     사업비 = 지하 포함 연면적 × 직접공사비 + 분양수입 × (간접·금융·판매비 + 시행마진)
     RLV(감당 지가) = 분양수입 − 사업비                                            */
  function isDev(inp) { return !!inp && inp.mode === 'dev_res'; }

  /* 섹터 엔진 선택 — 호텔·골프장·리조트·데이터센터는 valsec.js, 나머지는 기존 엔진 */
  function engineOf(inp) {
    if (!inp) return 'income';
    if (inp.mode === 'dev_res') return 'dev_res';
    if (inp.engine) return inp.engine;
    return 'income';
  }
  function isSector(inp) {
    var e = engineOf(inp);
    return !!(window.NAI_VALSEC && window.NAI_VALSEC.has(e));
  }
  /** 물건 → 엔진 코드 (섹터·구분 키워드 기반) */
  function engineForAsset(a) {
    if (!a) return 'income';
    if (a.sector === 'golf') return 'golf';
    var txt = String(a.sub_type || '') + ' ' + String(a.name || '') + ' ' + String(a.scale_info || '');
    if (/골프/.test(txt)) return 'golf';
    if (/리조트|콘도/.test(txt)) return 'resort';
    if (a.sector === 'hotel') return 'hotel';
    if (a.sector === 'datacenter') return 'datacenter';
    if (a.sector === 'land') return 'dev_res';
    if (a.sector === 'living' && /(개발|신축|예정|재개발)/.test(txt)) return 'dev_res';
    return 'income';
  }

  var DEV_DEFAULTS = {
    area_py: 7669, far_pct: 280, donation_pct: 17, sale_price_py: 1650,
    dev_cost_py: 680, soft_cost_pct: 18, profit_pct: 10,
    gfa_factor: 1.45, unit_py: 33, book_eok: 463.7
  };

  /** 저장 시나리오 등 외부 payload 호환: mode 판별 + 개발형 기본값 보정 */
  function normalizeInp(o) {
    var p = clone(o || {});
    if (!p.mode) {
      p.mode = (p.far_pct !== undefined || p.donation_pct !== undefined || p.sale_price_py !== undefined)
        ? 'dev_res' : 'income';
    }
    if (p.mode === 'dev_res') {
      for (var k in DEV_DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(DEV_DEFAULTS, k) && (p[k] === undefined || p[k] === null || p[k] === '')) p[k] = DEV_DEFAULTS[k];
      }
    }
    return p;
  }

  function devCalc(inp) {
    var area = num(inp.area_py, DEV_DEFAULTS.area_py);
    var far = num(inp.far_pct, DEV_DEFAULTS.far_pct);
    var don = num(inp.donation_pct, DEV_DEFAULTS.donation_pct);
    var sp = num(inp.sale_price_py, DEV_DEFAULTS.sale_price_py);
    var cpp = num(inp.dev_cost_py, DEV_DEFAULTS.dev_cost_py);
    var soft = num(inp.soft_cost_pct, DEV_DEFAULTS.soft_cost_pct);
    var profit = num(inp.profit_pct, DEV_DEFAULTS.profit_pct);
    var gf = num(inp.gfa_factor, DEV_DEFAULTS.gfa_factor);
    var up = num(inp.unit_py, DEV_DEFAULTS.unit_py);
    var book = num(inp.book_eok, DEV_DEFAULTS.book_eok);

    var netPy = area * (1 - don / 100);
    var abovePy = netPy * far / 100;
    var gfaPy = abovePy * gf;
    var units = up > 0 ? abovePy / up : NaN;
    var revenue = abovePy * sp / 1e4;
    var constCost = gfaPy * cpp / 1e4;
    var softCost = revenue * soft / 100;
    var devProfit = revenue * profit / 100;
    var rlv = revenue - constCost - softCost - devProfit;
    var fRate = (soft + profit) / 100;
    var needPrice = (abovePy > 0 && fRate < 1) ? (book + constCost) * 1e4 / (abovePy * (1 - fRate)) : NaN;

    return {
      area: area, areaSqm: area * 3.305785, netPy: netPy, abovePy: abovePy, gfaPy: gfaPy, units: units,
      far: far, don: don, sp: sp, cpp: cpp, soft: soft, profit: profit, gf: gf, up: up,
      revenue: revenue, constCost: constCost, softCost: softCost, devProfit: devProfit,
      totalCost: constCost + softCost + devProfit,
      rlv: rlv, rlvPerPy: area > 0 ? rlv * 1e4 / area : NaN,
      needPrice: needPrice, book: book, gap: rlv - book,
      gapPct: book > 0 ? (rlv - book) / book * 100 : NaN,
      recoverPct: book > 0 ? rlv / book * 100 : NaN,
      costRatio: revenue > 0 ? (constCost + softCost + devProfit) / revenue * 100 : NaN
    };
  }

  /** 입력값 일부만 바꾼 개발형 계산 (2종/3종 비교·민감도용) */
  function devAt(over) {
    var t = {};
    for (var k in S.inp) if (Object.prototype.hasOwnProperty.call(S.inp, k)) t[k] = S.inp[k];
    for (var k2 in over) if (Object.prototype.hasOwnProperty.call(over, k2)) t[k2] = over[k2];
    return devCalc(t);
  }

  /* ═════════════════════════════ 상태 ══════════════════════════════════ */
  var VA = { uplift: 0, vacancy: 0, capex: 0, exitCap: 0, growth: 0 };
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
    booted: false,
    favs: [],             // ⭐ 즐겨찾기 (localStorage)
    recent: []            // 🔥 최근 검토 물건 (localStorage)
  };

  /* ── 즐겨찾기 · 최근 검토 (2026-11-24) ──────────────────────────────
     즐겨찾기 = 물건 또는 섹터 계산기. 최근 검토 = 계산기를 연 물건 (최대 8건). */
  var FAV_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':val-favs:v1';
  var RECENT_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':val-recent:v1';
  function loadList(key) {
    try { var v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveList(key, list) { try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* noop */ } }
  function loadPrefs() { S.favs = loadList(FAV_KEY); S.recent = loadList(RECENT_KEY); }
  function pushRecent(a, eng) {
    if (!a || !a.id) return;
    S.recent = (S.recent || []).filter(function (x) { return x.id !== a.id; });
    S.recent.unshift({ id: a.id, name: a.name || a.id, engine: eng || '', at: Date.now() });
    S.recent = S.recent.slice(0, 8);
    saveList(RECENT_KEY, S.recent);
  }
  function favKeyOf(o) { return (o.kind || 'asset') + ':' + (o.id || o.engine); }
  function isFav(o) {
    var k = favKeyOf(o);
    return (S.favs || []).some(function (x) { return favKeyOf(x) === k; });
  }
  function toggleFav(o) {
    var k = favKeyOf(o);
    var had = isFav(o);
    S.favs = (S.favs || []).filter(function (x) { return favKeyOf(x) !== k; });
    if (!had) S.favs.unshift(o);
    S.favs = S.favs.slice(0, 20);
    saveList(FAV_KEY, S.favs);
  }

  function clone(o) {
    var out = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    return out;
  }

  /* ═════════════════════════════ 렌더 ══════════════════════════════════ */
  var FIELDS = [
    { g: '기초 자산', items: [
      { k: 'name', l: '물건명', t: 'text', w: 2 },
      { k: 'sector', l: '섹터', t: 'select', w: 1, opts: [['office', '오피스'], ['logistics', '물류센터'], ['datacenter', '데이터센터'], ['hotel', '호텔'], ['retail', '리테일'], ['senior', '👴 시니어 하우징']] },
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

  /* ══════════ 공동주택 개발형(RLV) 화면 ══════════════════════════════ */
  var DEV_SITE = { single: 7669, merged: 11247 };

  function devRange(k, label, min, max, step) {
    var v = num(S.inp[k], DEV_DEFAULTS[k]);
    return '<div class="vf wide dev-f"><label for="v-' + k + '">' + esc(label) + '</label>' +
      '<div class="dev-range">' +
      '<input type="range" data-k="' + k + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '">' +
      '<input id="v-' + k + '" type="number" inputmode="decimal" data-k="' + k + '" step="' + step + '" value="' + v + '">' +
      '</div></div>';
  }

  function devNumber(k, label, min, max, step) {
    var v = num(S.inp[k], DEV_DEFAULTS[k]);
    return '<div class="vf wide dev-f"><label for="v-' + k + '">' + esc(label) + '</label>' +
      '<input id="v-' + k + '" type="number" inputmode="decimal" data-k="' + k + '"' +
      (step ? ' step="' + step + '"' : '') + (min !== null ? ' min="' + min + '"' : '') +
      (max !== null ? ' max="' + max + '"' : '') + ' value="' + v + '"></div>';
  }

  function devInputsHTML(d) {
    var h = '';
    h += '<section class="vg"><h4>사업지</h4>';
    h += '<div class="dev-toggle" data-dev-area>' +
      '<button type="button" data-area="' + DEV_SITE.single + '" class="' + (Math.abs(d.area - DEV_SITE.single) < 1 ? 'on' : '') + '">본건 단독 7,669평</button>' +
      '<button type="button" data-area="' + DEV_SITE.merged + '" class="' + (Math.abs(d.area - DEV_SITE.merged) < 1 ? 'on' : '') + '">인접지 통합 11,247평</button>' +
      '</div>';
    h += '<div class="vg-grid">' + devNumber('area_py', '사업지 면적(평)', 1000, 30000, 1) + '</div>';
    h += '<p class="dev-note">' + n0(d.areaSqm) + '㎡ · 기부채납 차감 후 실효 대지 ' + n0(d.netPy) + '평</p>';
    h += '</section>';

    h += '<section class="vg"><h4>용도지역 · 용적률</h4>';
    h += '<div class="dev-toggle" data-dev-far>' +
      '<button type="button" data-far="220" class="' + (Math.abs(d.far - 220) <= Math.abs(d.far - 280) ? 'on' : '') + '">제2종 220%</button>' +
      '<button type="button" data-far="280" class="' + (Math.abs(d.far - 280) < Math.abs(d.far - 220) ? 'on' : '') + '">제3종 280%</button>' +
      '</div>';
    h += '<div class="vg-grid">' + devRange('far_pct', '상한 용적률(%)', 150, 350, 1) + '</div>';
    h += '<p class="dev-note">지상 연면적 ' + n0(d.abovePy) + '평 · 세대수 ' + n0(d.units) + '세대</p>';
    h += '</section>';

    h += '<section class="vg"><h4>기부채납 · 분양가</h4><div class="vg-grid">';
    h += devRange('donation_pct', '기부채납률(%)', 0, 30, 0.5);
    h += devRange('sale_price_py', '평균 분양가(만 원/평)', 1300, 2100, 10);
    h += '</div><p class="dev-note">84㎡ 공급 33평 환산 ' + n1(d.sp * d.up / 1e4) + '억 원/세대</p></section>';

    h += '<section class="vg"><h4>공사비 · 개발 제비용</h4><div class="vg-grid">';
    h += devRange('dev_cost_py', '직접공사비(만 원/평)', 500, 900, 5);
    h += devRange('soft_cost_pct', '간접·금융·판매비(%)', 0, 30, 0.5);
    h += devRange('profit_pct', '시행사 마진(%)', 0, 20, 0.5);
    h += '</div><p class="dev-note">공사비는 지하 포함 연면적 ' + n0(d.gfaPy) + '평 기준 · 제비용·마진은 분양수입 대비</p></section>';

    h += '<section class="vg"><h4>산출 가정 · 비교 기준</h4><div class="vg-grid">';
    h += devNumber('gfa_factor', '지하 포함 계수(× 지상)', 1.1, 2.0, 0.05);
    h += devNumber('unit_py', '세대당 공급면적(평)', 20, 50, 1);
    h += devNumber('book_eok', '기준 토지가액(장부원가, 억)', null, null, 0.1);
    h += '</div><p class="dev-note">장부원가 463.7억은 리츠 취득원가(토지 377.9 + 건물 85.9)입니다.</p></section>';
    return h;
  }

  function devKpiHTML(d) {
    var ok = d.rlv >= d.book;
    var priceOk = isFinite(d.needPrice) && d.sp >= d.needPrice;
    function card(label, value, sub, cls) {
      return '<div class="vk' + (cls ? ' ' + cls : '') + '"><span class="vk-l">' + esc(label) + '</span>' +
        '<span class="vk-v">' + value + '</span>' + (sub ? '<span class="vk-s">' + sub + '</span>' : '') + '</div>';
    }
    function signed(v, unit, dec) {
      if (!isFinite(v)) return '-';
      var a = dec ? n1(Math.abs(v)) : n0(Math.abs(v));
      return (v >= 0 ? '+' : '−') + a + unit;
    }
    return [
      card('예상 세대수', n0(d.units) + '세대', '84㎡ 공급 ' + n1(d.up) + '평 기준'),
      card('총 분양수입', n0(d.revenue) + '억', '분양가 ' + n0(d.sp) + '만/평'),
      card('총 건축·사업비', n0(d.totalCost) + '억', '토지 제외 · 매출의 ' + n1(d.costRatio) + '%'),
      card('감당 가능 지가 RLV', n0(d.rlv) + '억', '토지 평당 ' + n0(d.rlvPerPy) + '만원', ok ? 'good' : 'bad'),
      card('장부원가 대비 갭', signed(d.gap, '억'), '장부 ' + nEok(d.book) + '억 대비 ' + signed(d.gapPct, '%', true), ok ? 'good' : 'bad'),
      card('원가 회수 필요 분양가', isFinite(d.needPrice) ? n0(d.needPrice) + '만/평' : '-', '현재 ' + signed(d.sp - d.needPrice, '만', false) + ' · 84㎡ ' + n1(d.needPrice * d.up / 1e4) + '억', priceOk ? 'good' : 'bad'),
      card('용적률 · 기부채납', n0(d.far) + '% / ' + n1(d.don) + '%', '지상 연면적 ' + n0(d.abovePy) + '평'),
      card('지하 포함 연면적', n0(d.gfaPy) + '평', '계수 ' + (Math.round(d.gf * 100) / 100) + ' × 지상'),
      card('사업지 면적', n0(d.area) + '평', n0(d.areaSqm) + '㎡ · 실효 ' + n0(d.netPy) + '평'),
      card('장부원가 회수율', n1(d.recoverPct) + '%', 'RLV ÷ ' + nEok(d.book) + '억', ok ? 'good' : 'bad')
    ].join('');
  }

  function devCalcHTML(d) {
    var h = '<table class="dev-t"><tbody>';
    function row(label, num, memo, cls) {
      h += '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th>' + esc(label) + '</th>' +
        '<td class="num' + (label.indexOf('RLV') >= 0 ? (d.rlv >= d.book ? ' pos' : ' neg') : '') + '">' + num + '</td>' +
        '<td class="memo">' + esc(memo) + '</td></tr>';
    }
    row('총 분양수입', '+' + n0(d.revenue) + '억', '지상 ' + n0(d.abovePy) + '평 × ' + n0(d.sp) + '만 원/평');
    row('직접공사비', '−' + n0(d.constCost) + '억', '지하 포함 ' + n0(d.gfaPy) + '평 × ' + n0(d.cpp) + '만 원/평');
    row('간접비·금융비·판매비 ' + n1(d.soft) + '%', '−' + n0(d.softCost) + '억', '분양수입 대비');
    row('시행사 마진 ' + n1(d.profit) + '%', '−' + n0(d.devProfit) + '억', '분양수입 대비');
    row('감당 가능 지가 RLV', n0(d.rlv) + '억', '토지 평당 ' + n0(d.rlvPerPy) + '만원 (장부 평당 ' + n0(d.book * 1e4 / d.area) + '만원)', 'sum');
    row('장부 취득원가', nEok(d.book) + '억', '토지 377.9 + 건물 85.9');
    row('차액 (RLV − 장부)', (d.gap >= 0 ? '+' : '−') + n0(Math.abs(d.gap)) + '억', d.gap >= 0 ? '원가 회수 가능' : '원가 회수까지 ' + n0(Math.abs(d.gap)) + '억 부족', 'sum');
    h += '</tbody></table>';
    return h;
  }

  function devCompareHTML(d) {
    function card(label, x) {
      var ok = x.rlv >= x.book;
      var on = Math.abs(x.far - d.far) < 0.5;
      return '<div class="dev-cmp-card' + (on ? ' is-on' : '') + '">' +
        '<div class="dcc-head"><h5>' + esc(label) + '</h5>' +
        '<span class="dcc-tag' + (ok ? ' ok' : '') + '">' + (ok ? '원가 회수' : '원가 미달') + '</span></div><dl>' +
        '<dt>예상 세대수</dt><dd>' + n0(x.units) + '세대</dd>' +
        '<dt>총 분양수입</dt><dd>' + n0(x.revenue) + '억</dd>' +
        '<dt>감당 지가 RLV</dt><dd class="b">' + n0(x.rlv) + '억</dd>' +
        '<dt>토지 평당</dt><dd>' + n0(x.rlvPerPy) + '만원</dd>' +
        '<dt>장부 대비 갭</dt><dd class="' + (x.gap >= 0 ? 'pos' : 'neg') + '">' + (x.gap >= 0 ? '+' : '−') + n0(Math.abs(x.gap)) + '억</dd>' +
        '<dt>필요 분양가</dt><dd>' + (isFinite(x.needPrice) ? n0(x.needPrice) + '만/평' : '-') + '</dd>' +
        '</dl></div>';
    }
    return '<div class="dev-cmp">' + card('제2종 일반주거 220%', devAt({ far_pct: 220 })) +
      card('제3종 일반주거 280%', devAt({ far_pct: 280 })) + '</div>' +
      '<p class="mt-hint">현재 사업지 면적·기부채납·분양가·공사비는 그대로 두고 용적률만 2종/3종으로 바꾼 값입니다. 자연녹지에서 3종 직행 시 기부채납이 20% 이상으로 커질 수 있습니다.</p>';
  }

  function nearestIdx(v, arr) {
    var best = 0, gap = Infinity;
    for (var i = 0; i < arr.length; i++) { var g = Math.abs(arr[i] - v); if (g < gap) { gap = g; best = i; } }
    return best;
  }

  function devMatrixHTML(rowLabel, colLabel, rowVals, colVals, rowFmt, colFmt, cellFn, baseRow, baseCol, book) {
    var head = '<tr><th class="mt-corner">' + esc(rowLabel) + ' ↓ / ' + esc(colLabel) + ' →</th>';
    colVals.forEach(function (c) {
      head += '<th class="' + (Math.abs(c - baseCol) < 1e-9 ? 'is-base' : '') + '">' + colFmt(c) + '</th>';
    });
    head += '</tr>';
    var body = '';
    rowVals.forEach(function (rv) {
      body += '<tr><th class="mt-row' + (Math.abs(rv - baseRow) < 1e-9 ? ' is-base' : '') + '">' + rowFmt(rv) + '</th>';
      colVals.forEach(function (cv) {
        var v = cellFn(rv, cv);
        var cls = [];
        if (Math.abs(rv - baseRow) < 1e-9 && Math.abs(cv - baseCol) < 1e-9) cls.push('is-base');
        if (isFinite(v)) {
          if (v >= book * 1.2) cls.push('good-2');
          else if (v >= book) cls.push('good');
          else if (v >= book * 0.9) cls.push('warn');
        }
        body += '<td class="' + esc(cls.join(' ')) + '">' + (isFinite(v) ? n0(v) : '-') + '</td>';
      });
      body += '</tr>';
    });
    return '<table class="mt"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  function devMatrix1(d) {
    var rowsV = [], colsV = [15, 17, 19, 21, 23, 25];
    for (var p = 1450; p <= 1850; p += 50) rowsV.push(p);
    var baseRow = rowsV[nearestIdx(d.sp, rowsV)];
    var baseCol = colsV[nearestIdx(d.don, colsV)];
    return devMatrixHTML('분양가(만원/평)', '기부채납률', rowsV, colsV,
      function (v) { return n0(v) + '만'; },
      function (v) { return n1(v) + '%'; },
      function (sp, don) { return devAt({ sale_price_py: sp, donation_pct: don }).rlv; },
      baseRow, baseCol, d.book);
  }

  function devMatrix2(d) {
    var rowsV = [], colsV = [];
    for (var f = 200; f <= 280; f += 10) rowsV.push(f);
    for (var c = 630; c <= 730; c += 20) colsV.push(c);
    var baseRow = rowsV[nearestIdx(d.far, rowsV)];
    var baseCol = colsV[nearestIdx(d.cpp, colsV)];
    return devMatrixHTML('용적률(%)', '직접공사비(만원/평)', rowsV, colsV,
      function (v) { return n1(v) + '%'; },
      function (v) { return n0(v) + '만'; },
      function (far, cpp) { return devAt({ far_pct: far, dev_cost_py: cpp }).rlv; },
      baseRow, baseCol, d.book);
  }

  function devNotesHTML() {
    var p = presetById(S.presetId) || presetById('kia-osan');
    var h = '';
    if (!p) return '<div class="val-note-empty">개발형 가정 데이터를 찾을 수 없습니다.</div>';
    if (p.src) h += '<div class="vs-src"><strong>데이터 출처</strong><p>' + esc(p.src) + '</p></div>';
    if (p.memo) h += '<div class="vs-memo"><strong>2026-11-23 내부 검토치 (대조용)</strong><p>' + esc(p.memo) + '</p></div>';
    if (p.verify) h += '<div class="vs-verify"><strong>검증 노트</strong><p>' + esc(p.verify) + '</p></div>';
    if (p.notes) {
      h += '<ul class="vs-list">';
      p.notes.forEach(function (n) {
        var cls = /\[가정/.test(n) ? 'assume' : 'doc';
        h += '<li class="' + cls + '"><span class="vs-badge">' + (cls === 'doc' ? '원문' : '가정') + '</span>' + esc(n) + '</li>';
      });
      h += '</ul>';
    }
    if (p.ref) {
      h += '<div class="dev-ref"><strong>' + esc(p.ref.title) + '</strong><table class="dev-t sm"><tbody>';
      p.ref.rows.forEach(function (r) {
        h += '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '<p class="vs-foot">※ RLV는 분양수입에서 공사비·제비용·시행마진을 뺀 잔여지가로, 토지 취득세·등기비·PF 수수료 세부, 공사비 에스컬레이션, 분양 리스크(미분양)는 반영하지 않은 단순 모델입니다. 실제 입찰가 판단 전 설계·시공사 견적과 분양 검증 필요.</p>';
    return h;
  }

  function devBody() {
    var d = devCalc(S.inp);
    var h = '';
    h += '<div class="val-main">';
    h += '<aside class="val-inputs" id="valInputs">' + devInputsHTML(d) + '</aside>';
    h += '<main class="val-out">';
    h += valBarHTML();
    h += '<div class="val-kpis" id="valKpis">' + devKpiHTML(d) + '</div>';
    h += '<section class="val-block"><h3>RLV 산출 내역 <span>(단위: 억원)</span></h3><div id="valCalc">' + devCalcHTML(d) + '</div></section>';
    h += '<section class="val-block"><h3>제2종(220%) vs 제3종(280%) <span>(현재 조건 기준)</span></h3><div id="valCmp">' + devCompareHTML(d) + '</div></section>';
    h += '<section class="val-block"><div class="val-block-head"><h3>① 분양가 × 기부채납률 → RLV</h3>' +
      '<span class="seg-mini" data-dev-note>억원 · 초록 ≥ 장부 ' + nEok(d.book) + '억</span></div>' +
      '<div id="valM1">' + devMatrix1(d) + '</div>' +
      '<p class="mt-hint">행 = 평당 분양가(1,450~1,850만), 열 = 기부채납률(15·17·19·21·23·25%). 민녹색 = 장부원가 이상, 진녹색 = 장부원가 120% 이상, 주황 = 장부원가 90~100%.</p></section>';
    h += '<section class="val-block"><h3>② 용적률 × 직접공사비 → RLV <span>(억원)</span></h3>' +
      '<div id="valM2">' + devMatrix2(d) + '</div>' +
      '<p class="mt-hint">행 = 상한 용적률(200~280%), 열 = 직접공사비(630~730만 원/평, 지하 포함 연면적 기준).</p></section>';
    h += '<section class="val-block"><h3>가정·출처</h3><div id="valNotes">' + devNotesHTML() + '</div></section>';
    h += '</main></div>';
    return h;
  }

  function valBarHTML() {
    var admin = S.role === 'admin';
    var h = '';
    h += '<div class="val-bar">';
    h += '<span class="val-badge" id="valCalcTag">기준: ' + esc(presetById(S.presetId) ? presetById(S.presetId).name : '사용자 입력') + '</span>';
    h += '<span class="val-save">' +
      (admin ? '<input id="valSaveName" type="text" placeholder="' + (isDev(S.inp) ? '시나리오 이름 (예: 3종 280%·분양 1,650만)' : '시나리오 이름 (예: 종플 3,600억·Exit 5.0%)') + '">' +
        '<button type="button" class="btn-s" id="valSaveBtn">💾 시트에 저장</button>' : '<span class="ro-note">읽기 전용 — 저장 불가(계산·민감도는 자유)</span>') +
      '<span class="sv-load">' + savedHTML() + '</span>' +
      '<button type="button" class="btn-s ghost" id="valLoadBtn">불러오기</button>' +
      (admin ? '<button type="button" class="btn-s ghost" id="valDelBtn">삭제</button>' : '') +
      '</span>';
    h += '</div>';
    return h;
  }

  /** 수익형(임대) 화면 본문 — 기존 동작 그대로 */
  function incBody(r) {
    var html = '';
    html += '<div class="val-main">';
    /* 좌: 입력 */
    html += '<aside class="val-inputs" id="valInputs">' + inputsHTML(r) + '</aside>';
    /* 우: 결과 */
    html += '<main class="val-out">';
    html += valBarHTML();
    html += '<div class="val-kpis" id="valKpis">' + kpiHTML(r) + '</div>';
    html += '<section class="val-block"><h3>연도별 현금흐름 <span>(단위: 억원)</span></h3><div class="val-table-wrap" id="valCF">' + cashflowHTML(r) + '</div></section>';
    html += vaSectionHTML(r);

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
    html += '</main></div>';
    return html;
  }

  function agoText(ts) {
    if (!ts) return '';
    var d = Math.max(0, Date.now() - ts);
    var m = Math.round(d / 60000);
    if (m < 1) return '방금';
    if (m < 60) return m + '분 전';
    var h = Math.round(m / 60);
    if (h < 24) return h + '시간 전';
    return Math.round(h / 24) + '일 전';
  }
  function assetById(id) {
    var st = window.naiMap && window.naiMap.state;
    return (st && st.index && st.index[id]) ? st.index[id] : null;
  }
  function favChipsHTML() {
    var list = S.favs || [];
    var chips = list.map(function (o) {
      var lb = o.kind === 'preset' ? ('프리셋 · ' + (o.name || o.id)) : ('⭐ ' + (o.name || o.id));
      return '<button type="button" class="vf-chip" data-fav-open="' + esc(o.id) + '" data-fav-kind="' + esc(o.kind || 'asset') + '">' + esc(lb) + '<span class="vf-x" data-fav-del="' + esc(o.id) + '" data-fav-kinddel="' + esc(o.kind || 'asset') + '">×</span></button>';
    }).join('');
    if (!chips) chips = '<span class="vf-empty">계산기 왼쪽의 ⭐ 즐겨찾기 버튼으로 물건을 고정해 두세요.</span>';
    return chips;
  }
  function recentChipsHTML() {
    var list = S.recent || [];
    if (!list.length) return '<span class="vf-empty">지도·목록에서 물건을 클릭하면 여기에 쌓입니다.</span>';
    return list.map(function (o) {
      return '<button type="button" class="vf-chip recent" data-recent-open="' + esc(o.id) + '">' + esc(o.name || o.id) +
        '<span class="vf-time">' + esc(agoText(o.at)) + '</span></button>';
    }).join('');
  }
  function launcherHTML() {
    if (!window.NAI_VALSEC) return '';
    var keys = ['hotel', 'logistics', 'office', 'datacenter', 'golf', 'resort', 'dev_res', 'retail'];
    var label = { hotel: '🏨 호텔', logistics: '🚚 물류', office: '🏢 오피스', datacenter: '🖥 DC', golf: '⛳ 골프장', resort: '🏖 리조트', dev_res: '🏗 공동주택(RLV)', retail: '🛍 리테일' };
    return '<div class="val-launch"><span class="vl-t">섹터 계산기</span><div class="vl-chips">' +
      keys.map(function (k) { return '<button type="button" class="vl-chip' + (engineOf(S.inp) === k ? ' on' : '') + '" data-launch="' + k + '">' + label[k] + '</button>'; }).join('') +
      '</div><details class="val-presets-fold"><summary>기존 검토 프리셋 6종</summary><div class="val-presets">' + presetHTML() + '</div></details></div>';
  }

  function topHTML() {
    var dev = isDev(S.inp);
    var eng = engineOf(S.inp);
    var sec = (window.NAI_VALSEC && window.NAI_VALSEC.engine) ? window.NAI_VALSEC.engine(eng) : null;
    var title = dev ? '🏗️ 공동주택 개발형 수지 · RLV' : (sec ? (sec.label + ' ' + sec.name) : '📊 물건별 밸류에이션 · 민감도');
    var sub = dev
      ? '사업지·용적률·기부채납·분양가·공사비 → 분양수입·사업비 → 감당 가능 지가(RLV). 장부원가 대비 갭과 원가 회수 필요 분양가를 실시간 계산합니다.'
      : (sec ? sec.desc : '렌트롤·OPEX·CAPEX → 연도별 현금흐름 → IRR·EM·CoC. 이니셜 캡·엑시트 캡·구간별 금리를 바꿔 즉시 재계산합니다.');
    var curAsset = S.inp && S.inp.asset_id ? assetById(S.inp.asset_id) : null;
    var favOn = curAsset ? isFav({ kind: 'asset', id: curAsset.id }) : false;
    return '<div class="val-top"><div class="val-title"><h2>' + title + '</h2><p>' + sub + '</p>' +
      '<p class="val-assume-note">※ 아래 숫자는 <b>가정값 기반 시뮬레이션</b>입니다. 입력값(임대료·공실률·금리·캡레이트 등)을 바꾸면 결과가 즉시 바뀌며, [가정] 표기 값은 시장 가정치입니다. 특정 물건의 실제 임대료·NOI 실값과 다를 수 있습니다.</p>' +
      (curAsset ? '<p class="val-cur">🗂 선택 물건: <b>' + esc(curAsset.name) + '</b>' +
        '<button type="button" class="mini-btn" data-fav-toggle="' + esc(curAsset.id) + '">' + (favOn ? '⭐ 즐겨찾기 해제' : '⭐ 즐겨찾기') + '</button>' +
        '<button type="button" class="mini-btn" data-goto-map="' + esc(curAsset.id) + '">지도에서 보기</button></p>' : '') +
      '</div>' +
      '<div class="val-favbar">' +
      '<div class="vf-block"><span class="vf-t">⭐ 즐겨찾기</span><div class="vf-chips">' + favChipsHTML() + '</div></div>' +
      '<div class="vf-block"><span class="vf-t">🔥 최근 검토</span><div class="vf-chips">' + recentChipsHTML() + '</div></div>' +
      '</div>' + launcherHTML() + '</div>';
  }

  function renderAll() {
    var host = $('#valView');
    if (!host) return;
    var eng = engineOf(S.inp);
    var bodyHtml;
    if (isDev(S.inp)) bodyHtml = devBody();
    else if (window.NAI_VALSEC && window.NAI_VALSEC.has(eng)) bodyHtml = window.NAI_VALSEC.body(eng, S.inp);
    else bodyHtml = incBody(calc(S.inp));
    var html = '<div class="val-shell">' + topHTML() + bodyHtml + '</div>';
    host.innerHTML = html;
    bindAll();
  }

  /** 값 변경 시 결과부만 다시 그림 (입력 포커스 유지) */
  function recalcOnly() {
    if (isDev(S.inp)) { recalcDevOnly(); return; }
    if (isSector(S.inp)) {
      try { window.NAI_VALSEC.refresh(engineOf(S.inp), S.inp, $('#valView')); } catch (e) { /* noop */ }
      var tg = $('#valCalcTag');
      if (tg) tg.textContent = '기준: ' + (S.inp.name || '사용자 입력');
      return;
    }
    var r = calc(S.inp);
    var k = $('#valKpis'); if (k) k.innerHTML = kpiHTML(r);
    var cf = $('#valCF'); if (cf) cf.innerHTML = cashflowHTML(r);
    var va = $('#valVA');
    if (va) { var tmp = document.createElement('div'); tmp.innerHTML = vaSectionHTML(r); va.parentNode.replaceChild(tmp.firstChild, va); bindVA(); }
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

  /** 개발형: 결과부 + 토글 상태만 갱신 */
  function recalcDevOnly() {
    var d = devCalc(S.inp);
    var k = $('#valKpis'); if (k) k.innerHTML = devKpiHTML(d);
    var c = $('#valCalc'); if (c) c.innerHTML = devCalcHTML(d);
    var cmp = $('#valCmp'); if (cmp) cmp.innerHTML = devCompareHTML(d);
    var m1 = $('#valM1'); if (m1) m1.innerHTML = devMatrix1(d);
    var m2 = $('#valM2'); if (m2) m2.innerHTML = devMatrix2(d);
    var tag = $('#valCalcTag');
    if (tag) {
      var p = presetById(S.presetId);
      tag.textContent = '기준: ' + (p ? p.name : '사용자 입력');
      tag.classList.toggle('modified', !!p && !sameInp(p.inp, S.inp));
    }
    $$('[data-dev-area] button').forEach(function (b) {
      b.classList.toggle('on', Math.abs(d.area - num(b.getAttribute('data-area'))) < 1);
    });
    $$('[data-dev-far] button').forEach(function (b) {
      var v = num(b.getAttribute('data-far'));
      var other = v === 220 ? 280 : 220;
      b.classList.toggle('on', Math.abs(d.far - v) < Math.abs(d.far - other));
    });
  }

  function sameInp(a, b) {
    var skip = { target_irr: 1, name: 1, anchor: 1, asset_id: 1 };
    for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k) && !skip[k] && String(a[k]) !== String(b[k])) return false;
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
  /** 수익형 입력 바인딩 (기존 동작 그대로) */
  function bindIncomeInputs() {
    var inputs = $('#valInputs');
    if (!inputs) return;
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

  /** 개발형 입력 바인딩 — 슬라이더·숫자 입력을 짝지어 동기화 */
  function bindDevInputs() {
    var inputs = $('#valInputs');
    if (!inputs) return;
    inputs.addEventListener('input', function (e) {
      var el = e.target;
      var k = el.getAttribute('data-k');
      if (!k) return;
      if (el.value === '') return;                       // 입력 중 빈칸은 무시
      S.inp[k] = num(el.value);
      $$('[data-k="' + k + '"]', inputs).forEach(function (x) {
        if (x !== el && x.value !== el.value) x.value = el.value;
      });
      recalcDevOnly();
    });
    $$('[data-dev-area] button', inputs).forEach(function (b) {
      b.addEventListener('click', function () {
        S.inp.area_py = num(b.getAttribute('data-area'));
        renderAll();
      });
    });
    $$('[data-dev-far] button', inputs).forEach(function (b) {
      b.addEventListener('click', function () {
        S.inp.far_pct = num(b.getAttribute('data-far'));
        renderAll();
      });
    });
  }

  /** 밸류애드 슬라이더·숫자·프리셋 바인딩 */
  function bindVA() {
    var host = $('#valView');
    if (!host || !$('#valVA')) return;
    $$('[data-va]', host).forEach(function (el) {
      if (el._vaBound) return;
      el._vaBound = 1;
      el.addEventListener('change', function () {
        var k = el.getAttribute('data-va');
        VA[k] = num(el.value);
        var rg = $('[data-va-range="' + k + '"]', host);
        if (rg) rg.value = VA[k];
        recalcOnly();
      });
    });
    $$('[data-va-range]', host).forEach(function (el) {
      if (el._vaBound) return;
      el._vaBound = 1;
      el.addEventListener('input', function () {
        var k = el.getAttribute('data-va-range');
        VA[k] = num(el.value);
        var nm = $('[data-va="' + k + '"]', host);
        if (nm) nm.value = VA[k];
        recalcOnly();
      });
    });
    $$('[data-va-preset]', host).forEach(function (el) {
      if (el._vaBound) return;
      el._vaBound = 1;
      el.addEventListener('click', function () {
        var name = el.getAttribute('data-va-preset');
        var sets = {
          '경량 CAPEX': { uplift: 3, vacancy: 2, capex: 20, exitCap: 0, growth: 0 },
          '표준 리포지셔닝': { uplift: 8, vacancy: 3, capex: 80, exitCap: -0.25, growth: 0.5 },
          '적극 리모델링': { uplift: 15, vacancy: 5, capex: 200, exitCap: -0.5, growth: 1 }
        };
        var st = sets[name];
        if (!st) return;
        for (var k in st) if (Object.prototype.hasOwnProperty.call(st, k)) VA[k] = st[k];
        renderAll();
        toast('밸류애드 프리셋 「' + name + '」을 적용했습니다.');
      });
    });
    var rst = $('#vaReset', host);
    if (rst && !rst._vaBound) {
      rst._vaBound = 1;
      rst.addEventListener('click', function () {
        VA.uplift = 0; VA.vacancy = 0; VA.capex = 0; VA.exitCap = 0; VA.growth = 0;
        renderAll();
      });
    }
  }

  function bindAll() {
    var host = $('#valView');
    if (!host) return;

    $$('.vp-btn', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-preset');
        var p = presetById(id);
        if (!p) return;
        S.presetId = id;
        S.inp = normalizeInp(clone(p.inp));
        S.inp.anchor = 'price';
        renderAll();
        toast(p.name + ' 프리셋을 불러왔습니다.');
      });
    });

    bindVA();
    if (isDev(S.inp)) bindDevInputs();
    else if (isSector(S.inp)) {
      if (window.NAI_VALSEC) window.NAI_VALSEC.bind(host, function () { return S.inp; }, function () { recalcOnly(); });
    } else bindIncomeInputs();

    /* ── 섹터 계산기 띄우기 / 즐겨찾기 / 최근 검토 ── */
    $$('[data-launch]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-launch');
        loadPrefs();
        if (k === 'dev_res') {
          S.presetId = '';
          S.inp = normalizeInp({ mode: 'dev_res', name: '공동주택 개발 검토' });
          toast('🏗 공동주택 개발형(RLV) 계산기를 열었습니다.');
        } else if (window.NAI_VALSEC && window.NAI_VALSEC.has(k)) {
          S.presetId = '';
          S.inp = window.NAI_VALSEC.defaults(k, null);
          toast(window.NAI_VALSEC.engine(k).name + ' 계산기를 열었습니다.');
        } else {
          var secKey = (k === 'logistics' || k === 'office' || k === 'retail') ? k : 'office';
          S.presetId = '';
          S.inp = normalizeInp({
            mode: 'income', name: secKey === 'logistics' ? '물류센터' : (secKey === 'retail' ? '리테일' : '오피스'),
            sector: secKey, area_py: 10000, hold_years: 5, anchor: 'price', price_eok: 1000, entry_cap: 0,
            acq_cost_pct: secKey === 'logistics' ? 4.6 : 6.4, exit_cost_pct: 0.5,
            exit_cap_pct: secKey === 'office' ? 4.5 : 5.5, rent_mode: 'pyeong', rent_annual: 0,
            rent_per_py_month: secKey === 'office' ? 95000 : 35000, rf_months: 2, other_income: 0,
            vacancy_pct: 3, rent_growth_pct: 2, opex: 0, opex_growth_pct: 2, other_cost: 0,
            capex_initial: 0, capex_annual: 0, exit_capex: 0, add_noi: 0, add_noi_start: 2,
            ltv_senior: 60, ltv_mezz: 0, deposit_eok: 0, s_rate1: 5.2, s_rate2: 4.8, s_rate3: 4.5,
            m_rate1: 6.7, m_rate2: 6.2, m_rate3: 5.8, target_irr: 10
          });
        }
        renderAll();
      });
    });
    $$('[data-fav-toggle]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-fav-toggle');
        var a = assetById(id);
        if (!a) return;
        toggleFav({ kind: 'asset', id: a.id, name: a.name });
        renderAll();
        toast(isFav({ kind: 'asset', id: a.id }) ? '⭐ 즐겨찾기에 담았습니다.' : '즐겨찾기에서 뺐습니다.');
      });
    });
    var favBtn = $('#valFavBtn', host);
    if (favBtn) favBtn.addEventListener('click', function () {
      var id = S.inp && S.inp.asset_id;
      var a = id ? assetById(id) : null;
      if (!a && !S.inp.engine) { toast('물건을 먼저 고르세요.', true); return; }
      var o = a ? { kind: 'asset', id: a.id, name: a.name } : { kind: 'engine', id: S.inp.engine, name: (window.NAI_VALSEC ? window.NAI_VALSEC.engine(S.inp.engine).name : S.inp.engine) };
      toggleFav(o);
      renderAll();
    });
    $$('[data-fav-open]', host).forEach(function (b) {
      b.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-fav-del]')) return;
        var id = b.getAttribute('data-fav-open');
        var kind = b.getAttribute('data-fav-kind') || 'asset';
        loadPrefs();
        if (kind === 'preset') {
          var p = presetById(id);
          if (p) { S.presetId = p.id; S.inp = normalizeInp(clone(p.inp)); renderAll(); }
          return;
        }
        var a = assetById(id);
        if (a) { openForAsset(a); return; }
        if (kind === 'engine' && window.NAI_VALSEC && window.NAI_VALSEC.has(id)) {
          S.presetId = ''; S.inp = window.NAI_VALSEC.defaults(id, null); renderAll();
        }
      });
    });
    $$('[data-fav-del]', host).forEach(function (x) {
      x.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var id = x.getAttribute('data-fav-del');
        var kind = x.getAttribute('data-fav-kinddel') || 'asset';
        toggleFav({ kind: kind, id: id });
        renderAll();
      });
    });
    $$('[data-recent-open]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var a = assetById(b.getAttribute('data-recent-open'));
        if (a) openForAsset(a); else toast('해당 물건을 찾을 수 없습니다.', true);
      });
    });
    $$('[data-goto-map]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-goto-map');
        if (window.naiShowView) window.naiShowView('map');
        if (window.naiMap && window.naiMap.select) window.naiMap.select(id);
      });
    });

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
    if (S.role !== 'admin') { toast('저장은 관리자만 가능합니다.', true); return; }
    var host = $('#valView');
    var nameEl = $('#valSaveName');
    var name = (nameEl && nameEl.value.trim()) || (S.inp.name + ' ' + new Date().toISOString().slice(5, 10));
    var payload = clone(S.inp);
    if (isDev(S.inp)) {
      var dv = devCalc(S.inp);
      payload._metric = {
        rlv: Math.round(dv.rlv), rlvPerPy: Math.round(dv.rlvPerPy), units: Math.round(dv.units),
        revenue: Math.round(dv.revenue), needPrice: Math.round(dv.needPrice), gap: Math.round(dv.gap),
        far: dv.far, donation: dv.don, salePrice: dv.sp, book: dv.book
      };
    } else {
      var r = calc(S.inp);
      payload._metric = {
        irr: Math.round(r.levIrr * 10000) / 100, coc: Math.round(r.avgCoc * 10000) / 100,
        em: Math.round(r.em * 100) / 100, price: Math.round(r.price * 10) / 10,
        entryCap: Math.round(r.entryCap * 10000) / 100, exitValue: Math.round(r.exitValue)
      };
    }
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
    S.inp = normalizeInp(clone(hit.payload));
    S.inp.anchor = 'price';
    S.presetId = '';
    renderAll();
    toast(hit.name + ' — 불러왔습니다.');
  }

  function deleteScenario() {
    if (S.role !== 'admin') { toast('삭제는 관리자만 가능합니다.', true); return; }
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

  /** 경·공매 물건인지·최저입찰가(억) — 시트 facts 기반 */
  function aucMinBid(a) {
    var auc = false;
    var minBid = 0;
    var facts = (a && a.facts) || [];
    for (var i = 0; i < facts.length; i++) {
      var lb = String(facts[i].label || '');
      if (lb === '경매구분') auc = true;
      if (lb.indexOf('최저입찰가') === 0) {
        auc = true;
        var m = String(facts[i].value || '').match(/([\d,]+(?:\.\d+)?)\s*억/);
        if (m) minBid = num(String(m[1]).replace(/,/g, ''));
      }
    }
    if (!auc && a && (/^auc-/i.test(String(a.id || '')) || a.status_group === '경·공매')) auc = true;
    return { auction: auc, minBid: minBid };
  }

  /** 지도 상세 패널의 [📊 수익성 시뮬레이션] → 해당 물건의 섹터 엔진·프리셋으로 이동 */
  function assetAreaPy(a) {
    var m = String((a && a.scale_info) || '').match(/([\d,\.]+)\s*평/);
    return m ? num(String(m[1]).replace(/,/g, '')) : 0;
  }
  function assetPriceEok(a) {
    /* '매각가 900억' 처럼 가격 라벨에 직접 붙은 숫자만 매입가로 쓴다.
       ("공사비 약 147억" 같은 다른 항목을 매입가로 오인하지 않도록) */
    var s = String((a && a.price_info) || '');
    var m = s.match(/(?:매각가|희망매각가|희망 매각가|매입가|분양가|제안가|가격)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*억/);
    return m ? num(String(m[1]).replace(/,/g, '')) : 0;
  }

  function openForAsset(a) {
    if (!a) return;
    var au = aucMinBid(a);
    var eng = engineForAsset(a);
    loadPrefs();

    /* 섹터 엔진 (호텔·골프·리조트·DC) */
    if (window.NAI_VALSEC && window.NAI_VALSEC.has(eng)) {
      S.presetId = '';
      S.inp = window.NAI_VALSEC.defaults(eng, a);
      S.inp.asset_id = a.id;
      S.inp.name = a.name || S.inp.name;
      var pr = assetPriceEok(a);
      if (au.minBid) pr = au.minBid;
      if (pr > 0) S.inp.price_eok = pr;
      pushRecent(a, eng);
      showView();
      renderAll();
      toast('🎯 ' + (window.NAI_VALSEC.engine(eng).name) + '으로 열었습니다. 시장 가정치는 자료에 맞게 보정하세요.');
      return;
    }

    /* 공동주택 개발형(RLV) — 토지·개발부지 */
    if (eng === 'dev_res') {
      var ar = assetAreaPy(a);
      S.presetId = '';
      var base = clone(DEV_DEFAULTS);
      base.mode = 'dev_res';
      base.name = a.name || '개발부지';
      base.asset_id = a.id;
      if (ar) base.area_py = Math.round(ar);
      var pe = assetPriceEok(a);
      if (pe) base.book_eok = pe;
      S.inp = normalizeInp(base);
      pushRecent(a, 'dev_res');
      showView();
      renderAll();
      toast('🏗 공동주택 개발형(RLV)으로 열었습니다 — 사업지 면적·용적률·분양가를 확인하세요.');
      return;
    }

    var p = null;
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].asset_ids && PRESETS[i].asset_ids.indexOf(a.id) >= 0) { p = PRESETS[i]; break; }
    }
    if (p) {
      S.presetId = p.id;
      S.inp = normalizeInp(clone(p.inp));
      S.inp.asset_id = a.id;
      S.inp.name = a.name || S.inp.name;
    } else {
      var area = 0;
      var m = String(a.scale_info || '').match(/([\d,\.]+)\s*평/);
      if (m) area = num(String(m[1]).replace(/,/g, ''));
      var price = 0;
      var pm = String(a.price_info || '').match(/([\d,]{3,})\s*억/);
      if (pm) price = num(String(pm[1]).replace(/,/g, ''));
      if (au.minBid) price = au.minBid;   // 경·공매는 최저입찰가를 매입가로 자동 세팅
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
      toast(au.auction
        ? ('경·공매 물건 — 최저입찰가 ' + (au.minBid ? au.minBid.toLocaleString('ko-KR') + '억원' : '미확인') + '을 매입가로 넣었습니다. 임대료·OPEX는 평당 시장 가정치이니 실제 자료로 보정하세요.')
        : '이 물건은 아직 원문 수지 프리셋이 없습니다. 임대료·OPEX를 평당 시장 가정치로 채웠으니 실제 자료로 보정하세요.');
    }
    S.inp.asset_id = a.id;
    pushRecent(a, 'income');
    showView();
    renderAll();
  }

  function show() {
    readRole();
    loadPrefs();
    if (!S.inp) {
      var p = presetById(S.presetId) || PRESETS[0];
      S.presetId = p.id;
      S.inp = normalizeInp(clone(p.inp));
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
    S.inp = normalizeInp(clone(p.inp));
    S.inp.anchor = 'price';
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('[data-act="simulate"]')) { /* app.js가 처리 */ }
    });
  }

  /* 노드 테스트용 코어 노출 */
  window.NAI_VAL_CORE = { calc: calc, derive: derive, irr: irr, PRESETS: PRESETS, devCalc: devCalc, isDev: isDev };
  window.NAI_VAL = {
    show: show,
    openForAsset: openForAsset,
    loadSaved: function () { return loadSaved(true); },
    state: S
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
