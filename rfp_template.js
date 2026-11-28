/* =========================================================================
   Open AI Asset Bridge — rfp_template.js
   RFP 표준 골격 데이터 (2026-11-28)
   -------------------------------------------------------------------------
   근거: NAI Korea가 실제 받은 인바운드 RFP 5건의 공통 골격
     · 클럽디 보은 CC — 한강에셋자산운용 (2026-10-30)
     · 종로플레이스 — 캐피탈랜드투자운용 (2026-11-03)
     · KB영등포타워 — KB자산운용 (2026-11)
     · 수서역세권 B1-3·4BL — 웰스어드바이저스+이든자산운용 (2026-11)
     · 케이카 오산동탄 — 하나자산신탁 하나트러스트제7호 (2026-11-20)

   ※ 이 파일이 "섹션 정의 데이터"입니다. 양식이 바뀌면 이 객체만 갈아끼우면
     초안 생성(rfpcore.newRfp)과 문서 출력(rfpHTML)이 함께 따라갑니다.
     원문 배점 수치는 5건 모두 비공개(내부 기준)였으므로 가중치는 내부용 기본값이며
     참여자 화면에는 항목명만 보입니다(weights_public:false).
   ========================================================================= */
window.NAI_RFP_TEMPLATE = {
  version: '2026-11-28.1',
  basis: '인바운드 RFP 실물 5건 공통 골격 (work/rfp_samples, 2026-11-28)',
  weights_public: false,

  /* ①~⑦ 문서 골격 */
  sections: [
    { key: 'overview', no: 'I', title: '용역 개요', hint: '용역명 · 목적물(물건 개요표) · 매도자 · 용역기간 · 선정방법 · 용역범위' },
    { key: 'scope', no: 'II', title: '용역 범위', hint: '매각 자문 일체 — 실사·마케팅·투자자 접촉·입찰·협상·종결' },
    { key: 'schedule', no: 'III', title: '추진 일정', hint: 'RFP 발송 · 제안서 접수 마감 · 제안설명회(PT) · 우선협상대상자 선정' },
    { key: 'proposal', no: 'IV', title: '제안서 목차 · 작성 방법', hint: '제출 방식(Hard/Soft) · 언어 · 분량 · 밀봉 보수 여부' },
    { key: 'criteria', no: 'V', title: '평가 기준', hint: '평가항목(배점은 내부 기준 — 외부 비공개)' },
    { key: 'notes', no: 'VI', title: '기타 · 유의사항', hint: '담합 배제 · 제출서류 미비 · 일정 변경 · 결과 비공개' },
    { key: 'forms', no: 'VII', title: '별첨 양식', hint: '입찰참가 신청서 · 서약서 · 실적표 · CA(비밀유지약정서)' }
  ],

  /* 딜별 차이를 담는 옵션 — 초안에서 선택 */
  options: {
    submit_mode: ['Hard copy', 'Soft copy(PDF)', 'Hard + Soft'],
    language: ['국문', '영문', '국·영문 택1'],
    fee_sealed: ['제안서에 포함', '보수 별도 봉인 제출'],
    consortium: ['불가', '허용(사전 협의)'],
    signature_doc: ['CA(비밀유지약정서)', '서약서', 'CA + 서약서(통합 가능)']
  },

  /* 평가 6축(+보수) — 항목명은 참여자에게 공개, 배점은 내부 */
  criteria: [
    { key: 'track', label: '용역수행 실적(최근 3년 유사용역)', weight: 20 },
    { key: 'understand', label: '물건·시장 이해도', weight: 15 },
    { key: 'strategy', label: '매각 추진전략·수행방안', weight: 15 },
    { key: 'price', label: '예상 매각가격 적정성', weight: 20 },
    { key: 'buyers', label: '매수의향자 확보', weight: 15 },
    { key: 'team', label: '조직·인력(업무분담)', weight: 7 },
    { key: 'fee', label: '용역보수(기본+성과)', weight: 8 }
  ],

  /* 제출 요구서류 — 실물 5건 기준 */
  docs: [
    '제안서 (A4, 자율양식)',
    'CA(비밀유지약정서) 또는 입찰참가 서약서 날인본',
    '입찰참가 신청서 (대리인 재직증명·사용인감계·법인등기부등본)',
    '매입·매각 자문 실적표 (최근 3년, 본건 유사물건 중심)'
  ],

  /* 물건 자료 세트 표준 분류(종로플레이스 구조) */
  materials: [
    '건물 개요', 'Rent roll(계약 체결 기준)', 'Rent roll(현황)', 'OPEX·CAPEX',
    '임대차 만기·WALE', '추가관리비·주차수입', '도면', 'Q&A'
  ],

  /* 일정 기본값(발송→접수 9~20일, 접수→선정 4일~2주) */
  schedule: {
    offer_days: 14,
    pt_days: 21,
    select_days: 24,
    loi_days: 49,
    close_days: 90
  },

  /* 수수료 구간 예시 문구(딜별 수정) */
  fee_note: '매각가 구간별 성과수수료율 + 기본 보수. 보수는 제안서와 별도 봉인 제출할 수 있습니다.',

  /* 샘플 교체 지점 — 아직 실물이 없어 임시 양식으로 두는 항목 */
  placeholders: [
    { key: 'bid_package', label: '입찰 서류 구성·패키징·제출 형식', status: '샘플 대기 (11/30~12/1 제공 예정)' },
    { key: 'fee_schedule', label: '보수 구간표(표준)', status: '딜별 협의' },
    { key: 'ca_form', label: '딜별 CA 양식', status: '실물 6종 확보 — 딜에 연결' }
  ]
};
