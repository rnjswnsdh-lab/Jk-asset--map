/* OAAB 2026 3Q 통합 마켓 리포트 데이터 (2026-11-28)
   ─ 출처 : NAI Korea Research 3Q 발표본 / NAI 내부 자료(시장 데이터·거래사례·전략회의) / 2015-2024 Hotel Market Data /
           타사 7개사 3Q 리포트 교차검증(2026-11-28)
   ─ 원칙 : 모든 지표에 basis(면적기준)·sample(표본)·source 를 함께 표기. 단일 수치 금지.
   ─ 외부 원문의 문장·도표·표 배열은 옮기지 않고 수치·사실만 자체 재구성. */
window.OAAB_MARKET_REPORT_2026Q3 = {
  "meta": {
    "title": "2026 3Q 통합 마켓 리포트",
    "kicker": "OAAB · OPEN AI ASSET BRIDGE",
    "subtitle": "공실률 2계열 · NOC 2계열 · 2026년 오피스 거래 35건 12.59조",
    "as_of": "2026-09-30",
    "published": "2026-11-28",
    "sectors_updated": "2026-11-28",
    "new_sectors": ["retail", "logistics", "hotel", "dc"],
    "scope": "오피스·리테일·물류·호텔·DC 5개 섹터 (NAI Korea Research 및 내부 자료 + 외부 기관 교차검증)",
    "sources": 18,
    "note": "NAI 단일 수치(2.07%)에 의존하지 않는 자체 발간본. 모든 수치에 기준·표본·출처를 병기했습니다."
  },
  "headline": [
    "임대는 견조 — 프라임 공실 3.1~5.8%·임대료 YoY +5.5%, 전체 오피스 공실 5.7~6.9%",
    "투자는 선별적 — 2026년 거래 35건 12.59조, 3Q 4.80조로 연중 최대이나 전분기 대비 감소",
    "가격은 조정 대기 — Cap 4.2~4.5% · 국고5년 4.10% · 스프레드 0.10%p로 하방 여지",
    "섹터 확장 — 물류 공실 13.1%·Cap 5.3~5.4%, 호텔 RevPAR +10.1%, DC 공실 5% 미만 · 리테일 거래 5.13조"
  ],
  "readme": [
    { "label": "공실률 2계열", "text": "프라임·A급 3.1~5.8% ↔ 전체 오피스 5.7~6.9%. 같은 분기에 2.6%p 차이 — 표본 차이이며 오류 아님" },
    { "label": "NOC 2계열", "text": "290,534원(전용)과 164,808원(임대)은 같은 임대료. 배율 1.76 = 1÷전용률 56.7%" },
    { "label": "표기 원칙", "text": "basis(전용·임대) · sample(프라임·전체·자체표본) · source · as_of 4개 중 하나라도 없으면 표기하지 않음" },
    { "label": "자체표본 2.07%", "text": "8개 기관 중 최저. IM·제안서 외부 인용 금지, 내부 시계열 전용" }
  ],
  "macro": {
    "rows": [
      { "label": "한국 기준금리", "q1": "2.50", "q2": "2.50", "q3": "2.75", "q4": "3.00", "unit": "%" },
      { "label": "미국 기준금리", "q1": "3.75", "q2": "3.75", "q3": "3.75", "q4": "4.00", "unit": "%" },
      { "label": "국고채 3년", "q1": "3.20", "q2": "3.62", "q3": "3.87", "q4": "—", "unit": "%" },
      { "label": "국고채 5년", "q1": "3.46", "q2": "3.83", "q3": "4.10", "q4": "—", "unit": "%" },
      { "label": "Cap Rate (서울·GM)", "q1": "4.0", "q2": "4.1", "q3": "4.2", "q4": "—", "unit": "%" },
      { "label": "Cap − 국고5년 스프레드", "q1": "0.54", "q2": "0.27", "q3": "0.10", "q4": "—", "unit": "%p" },
      { "label": "M2 (평잔)", "q1": "4,130.8", "q2": "4,211.5", "q3": "4,234.9", "q4": "—", "unit": "조원" }
    ],
    "comments": [
      "3Q 기준금리 2.50→2.75%, 국고5년 3.83→4.10% 상승. Cap Rate는 4.1→4.2%에 그침",
      "스프레드 0.10%p — 2022 4Q 이후 최저. 자산가격이 금리 상승을 따라가지 못한 국면",
      "4Q 기준금리 3.00%·미국 4.00%는 CM 워크북 입력값(전망 성격) — 추가 인상 시 Cap 4.3~4.5% 상단 테스트"
    ]
  },
  "lease": {
    "bands": { "prime": "3.1~5.8", "all": "5.7~6.9", "own": "2.07" },
    "vacancy": [
      { "cluster": "프라임·A급", "org": "CBRE", "sample": "Grade A · GFA 3.3만㎡↑", "seoul": "3.1", "cbd": "5.1", "gbd": "1.0", "ybd": "1.7", "etc": "—", "qoq": "−1.1%p" },
      { "cluster": "프라임·A급", "org": "뉴마크", "sample": "A급", "seoul": "4.5", "cbd": "7.0", "gbd": "2.7", "ybd": "2.3", "etc": "—", "qoq": "+0.2%p" },
      { "cluster": "프라임·A급", "org": "세빌스", "sample": "프라임 108동 804만㎡", "seoul": "4.6", "cbd": "7.3", "gbd": "1.8", "ybd": "3.6", "etc": "—", "qoq": "+0.4%p" },
      { "cluster": "프라임·A급", "org": "쿠시먼앤드웨이크필드", "sample": "Grade A", "seoul": "5.0", "cbd": "7.2", "gbd": "3.0", "ybd": "3.6", "etc": "—", "qoq": "−0.8%p" },
      { "cluster": "프라임·A급", "org": "JLL", "sample": "Grade A", "seoul": "5.8", "cbd": "10.6", "gbd": "0.8", "ybd": "5.0", "etc": "—", "qoq": "−0.8%p" },
      { "cluster": "전체 오피스", "org": "알스퀘어", "sample": "전체 · 2Q 표본 945동", "seoul": "5.7", "cbd": "5.2", "gbd": "0.6~1.4", "ybd": "—", "etc": "10.0", "qoq": "−0.8%p" },
      { "cluster": "전체 오피스", "org": "젠스타메이트", "sample": "전체 · 신축 포함", "seoul": "6.7", "cbd": "6.3", "gbd": "3.4", "ybd": "3.0", "etc": "12.9", "qoq": "—" },
      { "cluster": "전체 오피스", "org": "NAI 내부 자료 (2Q)", "sample": "전체 · 신축 포함", "seoul": "6.9", "cbd": "6.8", "gbd": "3.5", "ybd": "2.8", "etc": "13.3", "qoq": "3Q 미기입" },
      { "cluster": "자체표본", "org": "NAI Korea Research", "sample": "표본·분모 미공개", "seoul": "2.07", "cbd": "2.14", "gbd": "1.95", "ybd": "2.31", "etc": "1.92", "qoq": "−0.43%p" }
    ],
    "noc": [
      { "label": "NOC (임대료+관리비)", "seoul": "266,128", "cbd": "290,534", "gbd": "309,248", "ybd": "223,207", "basis": "전용면적(NFA)" },
      { "label": "명목임대료 + 관리비", "seoul": "145,297<br><small>103,785 + 41,512</small>", "cbd": "164,808<br><small>118,108 + 46,700</small>", "gbd": "160,800<br><small>118,700 + 42,100</small>", "ybd": "141,100<br><small>99,500 + 41,600</small>", "basis": "임대면적(GLA)" },
      { "label": "역산 전용률", "seoul": "54.6%", "cbd": "56.7%", "gbd": "—", "ybd": "—", "basis": "NOC÷GLA" }
    ],
    "comments": [
      "CBD 공실 7.3%(프라임) ↔ 6.8%(전체) — 2분기 G1서울 143,432㎡·르네스퀘어 60,344㎡ 준공 반영",
      "GBD·YBD 프라임 4% 미만 — 세빌스 GBD 1.8%·YBD 3.6%(−0.6%p), GBD는 5분기 연속 2% 미만",
      "임대료 YoY +5.5% — CBD +6.4%·GBD +4.8%·YBD +4.6%, 관리비 50,000원/평(+3.2%)",
      "3Q 신규 공급 25건 47,000평 — 주요 권역 외(ETC) 집중. 4Q CBD 이을타워 44,907㎡ 예정"
    ]
  },
  "deals": {
    "total": { "count": 35, "eok": 125934, "q13_count": 33, "q13_eok": 120914 },
    "quarterly": [
      { "q": "2026 1Q", "count": 12, "eok": 39895 },
      { "q": "2026 2Q", "count": 10, "eok": 33023 },
      { "q": "2026 3Q", "count": 11, "eok": 47996 },
      { "q": "2026 4Q(10월)", "count": 2, "eok": 5020 }
    ],
    "regions": [
      { "region": "GBD", "count": 5, "eok": 20081, "avg": 4481, "median": 4501, "min": 3355, "max": 5210 },
      { "region": "Others", "count": 10, "eok": 21574, "avg": 3290, "median": 3182, "min": 1331, "max": 6275 },
      { "region": "CBD", "count": 13, "eok": 60018, "avg": 3092, "median": 2745, "min": 1989, "max": 4508 },
      { "region": "YBD", "count": 3, "eok": 15890, "avg": 2605, "median": 2050, "min": 1925, "max": 3840 },
      { "region": "BBD", "count": 4, "eok": 8371, "avg": 1906, "median": 1959, "min": 1112, "max": 2593 }
    ],
    "buyers": [
      { "type": "FI", "count": 19, "eok": 95152, "share": 75.6 },
      { "type": "SI(사옥·전략투자)", "count": 12, "eok": 25630, "share": 20.4 },
      { "type": "해외 FI", "count": 3, "eok": 5152, "share": 4.1 },
      { "type": "미상", "count": 1, "eok": 0, "share": 0 }
    ],
    "cap": [
      { "org": "NAI 내부 자료 (서울·GM)", "value": "4.2", "prev": "4.1", "note": "국고5년 4.10% · 스프레드 0.10%p" },
      { "org": "젠스타메이트", "value": "4.2", "prev": "4.1", "note": "매매가격지수 586(−1.9% QoQ)" },
      { "org": "CBRE", "value": "4.3", "prev": "4.2", "note": "Grade A 명목 · 2년 만의 상승 전환" },
      { "org": "알스퀘어", "value": "4.49", "prev": "소폭 상승", "note": "국고3년 3.87% · 스프레드 0.62%p" },
      { "org": "세빌스", "value": "실질 4%대 초중반", "prev": "소폭 상승", "note": "렌트프리 반영 실질 기준" }
    ],
    "top": [
      { "rank": 1, "name": "G1서울", "region": "CBD", "py": "43,388", "eok": "1조 5,230억", "ppy": "3,510", "buyer": "미래에셋자산운용", "btype": "FI · 우정사업본부 블라인드" },
      { "rank": 2, "name": "서울스퀘어", "region": "CBD", "py": "40,174", "eok": "1조 2,800억", "ppy": "3,186", "buyer": "한국투자리얼에셋운용", "btype": "FI" },
      { "rank": 3, "name": "하나증권빌딩", "region": "YBD", "py": "21,123", "eok": "8,112억", "ppy": "3,840", "buyer": "하나대체투자자산운용", "btype": "FI" },
      { "rank": 4, "name": "파인에비뉴 A동", "region": "CBD", "py": "19,897", "eok": "8,000억", "ppy": "4,021", "buyer": "MDM자산운용", "btype": "FI" },
      { "rank": 5, "name": "역삼동 오피스[선매각]", "region": "GBD", "py": "15,696", "eok": "7,926억", "ppy": "5,050", "buyer": "한국토지신탁", "btype": "FI" },
      { "rank": 6, "name": "넷마블 지타워", "region": "Others", "py": "52,325", "eok": "6,967억", "ppy": "1,331", "buyer": "지베스코자산운용", "btype": "FI" },
      { "rank": 7, "name": "을지트윈타워 서관", "region": "CBD", "py": "26,150", "eok": "6,570억", "ppy": "2,512", "buyer": "퍼시픽자산운용", "btype": "FI" },
      { "rank": 8, "name": "세미콜론 문래", "region": "YBD", "py": "29,990", "eok": "6,148억", "ppy": "2,050", "buyer": "KB자산운용(국민연금 코어)", "btype": "FI" },
      { "rank": 9, "name": "강남358타워", "region": "GBD", "py": "9,887", "eok": "4,450억", "ppy": "4,501", "buyer": "현송교육문화재단", "btype": "SI" },
      { "rank": 10, "name": "브이플렉스", "region": "GBD", "py": "8,119", "eok": "4,230억", "ppy": "5,210", "buyer": "비즈코", "btype": "SI" }
    ],
    "comments": [
      "2026년 클로징·계약 35건 12.59조 — 1~3Q만 33건 12.09조, 분기 1Q 3.99조 → 3Q 4.80조",
      "발표본(전략회의)은 32건 12.3조 41.4만평 — 잔금 미도래·계열사거래 처리 기준 차이(3건)",
      "시장 전체 규모는 3Q 6.12조(CM 투자시장) ↔ 세빌스 6.2조. Deal Status는 당사 확인 개별 거래 기준",
      "젠스타 2분기부터 거래사례 미제공 — 외부 원천 중단, 자체 DB 필요성의 실제 사례"
    ]
  },
  "sectors": [
    { "sector": "오피스", "grade": "확정", "detail": "클로징·계약 33건(연중 35건)", "numbers": "12.09조 (12.59조)", "source": "NAI 내부 자료" },
    { "sector": "물류", "grade": "관계자 확인", "detail": "아레나스 양지→코람코자산신탁 / CBRE IM 5개→와이드크릭+하인즈 / 롯데 덕평→코람코+우정 우협 / 페블스톤 평택+여주→이지스+베인", "numbers": "6,200억 / 약 4,300억 / 우협(2026-09) / 평당 500만 초반", "source": "시장 관계자 통화 2026-11-22 (공시 미대조)" },
    { "sector": "호텔", "grade": "확정", "detail": "신라스테이 구로(동작구 신대방동 698) 쉐어딜 · 2024 서울 OCC 78.62%·ADR 200,703원·RevPAR 157,793원", "numbers": "850억 / 5,245평 / 1,621만원·평", "source": "NAI 내부 자료 · 한국호텔업협회" },
    { "sector": "DC", "grade": "확정", "detail": "클로징 0건 — 춘천 수열클러스터 250MW 공모(조성원가 790,913원/㎡, 12-01 설명회·12-21 마감), GS 동해 AI DC 2026-11-28 착공", "numbers": "총 2,253.7억", "source": "K-water 공고 · 보도" },
    { "sector": "리테일", "grade": "확정", "detail": "NAI 3Q 집계 — 거래 5.13조(+8.2%), 중대형 상가 공실 9.9%", "numbers": "5.13조 / 9.9%", "source": "NAI 내부 자료" }
  ],
  /* ── 섹터별 본문 (2026-11-28 확장) — 섹터 추가 = 이 배열에 항목 추가 ──
     필드: key·name·icon·grade·lead·kpis(≤4)·deals(≤3)·demand·supply·implication·note·source
     kpis: label·value·unit·basis(기준)·sample(표본)·source·as_of  */
  "sectors_detail": [
    {
      "key": "retail", "name": "리테일", "icon": "🛍️", "grade": "확정",
      "lead": "거래는 개발형 대형 딜이 끌고, 임대는 공실 부담이 이어지는 이중 국면.",
      "as_of": "2026-09-30",
      "kpis": [
        { "label": "3Q 거래금액", "value": "5.13", "unit": "조원", "basis": "중대형·소규모 상가 등 리테일 클로징·계약", "sample": "당사 확인 개별 거래", "source": "NAI 내부 자료", "as_of": "2026-09-30" },
        { "label": "중대형 상가 공실률", "value": "9.9", "unit": "%", "basis": "중대형 상가(3층 이상·330㎡ 초과)", "sample": "리서치 표본 상가", "source": "NAI 내부 자료", "as_of": "2026-09-30" },
        { "label": "중대형 상가 공실률", "value": "14.7", "unit": "%", "basis": "전국 표본 · 소규모 8.7%", "sample": "상권 385개 표본", "source": "한국부동산원 3Q 임대동향조사", "as_of": "2026-10-29" },
        { "label": "중대형 상가 임대료", "value": "26,700", "unit": "원/㎡·월", "basis": "전국 평균 · 1층 기준 · 서울 1층 57,100원", "sample": "표본 현장조사", "source": "한국부동산원", "as_of": "2026-10-29" }
      ],
      "deals": [
        { "name": "홈플러스 영등포점", "when": "2026 3Q", "size": "3,500억", "basis": "연면적 20,008평", "buyer": "KB증권 컨소시엄", "source": "NAI 내부 자료" },
        { "name": "이마트 천호점", "when": "2026 3Q", "size": "1,666억", "basis": "연면적 5,236평", "buyer": "SK디앤디·신한자산운용", "source": "NAI 내부 자료" }
      ],
      "demand": "신규 공급 76건·약 2만 평으로 최근 3년 최저 — 공급 축소가 임대 회복의 유일한 변수.",
      "supply": "상가 임대가격지수 −0.02% QoQ(서울 +0.43%) · 뚝섬 +9.92%·명동 +4.53% — 관광 상권만 상승, 내수는 소매판매 −1.8~2.6%(7~8월).",
      "implication": "운영수익보다 용도전환·개발 잠재력이 가격을 만든다 — 리테일은 '부지 딜'로 접근.",
      "note": "공실률 2계열: NAI 9.9%(중대형) ↔ 부동산원 14.7%(전국 표본) — 표본·모집단 차이로 직접 비교하지 않음.",
      "source": "NAI 내부 자료 · 한국부동산원 3Q 임대동향조사"
    },
    {
      "key": "logistics", "name": "물류센터", "icon": "🚚", "grade": "교차검증(JLL·CBRE)",
      "lead": "공급이 연내 사실상 마무리되며 공실 하락·임대료 상승으로 국면 전환.",
      "as_of": "2026-09-30",
      "kpis": [
        { "label": "공실률", "value": "13.1", "unit": "%", "basis": "수도권 전체(SCA)", "sample": "Grade A·전체 권역", "source": "JLL 코리아 3Q 수도권 물류", "as_of": "2026-09-30" },
        { "label": "A급 상온 명목임대료", "value": "36,500", "unit": "원/평·월", "basis": "상온 · 명목(렌트프리 제외)", "sample": "수도권 Grade A", "source": "JLL 코리아", "as_of": "2026-09-30" },
        { "label": "Cap Rate", "value": "5.3~5.4", "unit": "%", "basis": "A급 물류 · NOI 기준", "sample": "JLL 5.3%(+10bp) · CBRE 5.4%", "source": "JLL · CBRE 3Q", "as_of": "2026-09-30" },
        { "label": "3Q 거래금액", "value": "5,072", "unit": "억원", "basis": "물류자산 거래 · CBRE는 공장 포함 약 1조", "sample": "JLL 집계", "source": "JLL 코리아", "as_of": "2026-09-30" }
      ],
      "deals": [
        { "name": "평택 로지스틱스파크", "when": "2026 3Q", "size": "3,430억", "basis": "매입", "buyer": "삼성SRA자산운용(국민연금 블라인드)", "source": "CBRE" },
        { "name": "평택 어연 삼성전자로지텍 물류센터", "when": "2026 3Q", "size": "1,050억", "basis": "선매입 약정", "buyer": "ADF자산운용", "source": "CBRE" }
      ],
      "demand": "3Q 순흡수 126,762평(상반기 합계 +51%) · 신규 임차 71%가 3PL·이커머스, 인천 25%·안성 20%·이천 10% · K뷰티(에이피알, 당목로지스파크 156,070㎡ 통임차) 확장.",
      "supply": "3Q 4개 센터 준공, 4Q 2개(남동부) — 연간 공급 2025년 절반 이하, 허가 9건·착공 8건.",
      "implication": "공급 절벽 + 공실 하락 → 임대료·Cap 상승 압력. 선임차 우량 자산은 매도 우위, 저온→상온 컨버전이 엑시트 카드.",
      "note": "공실률 2계열: JLL 13.1%(수도권 전체) ↔ CBRE 상반기 14%(A급) — 시점·표본 차이.",
      "source": "JLL 코리아 · CBRE 코리아 3Q 2026"
    },
    {
      "key": "hotel", "name": "호텔", "icon": "🏨", "grade": "교차검증(야놀자리서치·CBRE·JLL)",
      "lead": "수요는 사상 최대, 객실은 2019년 수준 — 성장분이 객실단가(ADR)로 흡수되는 구조.",
      "as_of": "2026-09-30",
      "kpis": [
        { "label": "3Q RevPAR", "value": "+10.1", "unit": "% YoY", "basis": "가용 객실당 매출 · ADR +9.0%·OCC +1.0%", "sample": "전국 호텔·리조트", "source": "야놀자리서치 3Q 숙박업 동향", "as_of": "2026-09-30" },
        { "label": "서울 OCC(2025)", "value": "76", "unit": "%", "basis": "연간 평균 · ADR 24.8만원 · RevPAR 18.9만원", "sample": "CoStar/STR 체인스케일", "source": "CBRE 호텔 리포트", "as_of": "2025-12-31" },
        { "label": "방한 외래객(1~9월)", "value": "1,711", "unit": "만 명", "basis": "누적 입국 · 전년동기 +21.5%(2019년 132.3%)", "sample": "전체 방한객", "source": "한국관광공사 한국관광통계", "as_of": "2026-09-30" },
        { "label": "서울 객실 공급", "value": "68,020", "unit": "실", "basis": "관광·일반호텔 678개 · 연평균 +0.1%(2010~19 +8.5%)", "sample": "서울시 숙박업 인허가", "source": "CBRE 호텔 리포트", "as_of": "2026-07-31" }
      ],
      "deals": [
        { "name": "신라스테이 구로(신대방동 698)", "when": "2026 3Q", "size": "850억", "basis": "5,245평 · 평당 1,621만원 · 쉐어딜", "buyer": "캡스톤자산운용", "source": "NAI 내부 자료" },
        { "name": "서울 호텔 거래시장", "when": "2026 3Q", "size": "USD 1.1B", "basis": "전년 동기 +14% · 개별 딜 내역 미확보", "buyer": "-", "source": "JLL 서울 호텔 3Q" }
      ],
      "demand": "방한객·내국인 수요 견조하나 지역 편차 — 부산 1·2성 RevPAR +57.6%, 강원 모텔 +40.5%, 전라 3성 −9.5%.",
      "supply": "객실 공급 정체(2019년 수준), 신규는 상위 등급(어퍼업스케일)에 집중 — 가동률 추가 상승 여력 8% 내외.",
      "implication": "매입 후 리브랜딩·운영 개선(밸류애드)이 수익의 원천 — 가동률보다 ADR·RevPAR 관리가 관건.",
      "note": "표본 3계열: 한국호텔업협회 호텔업운영현황 2024년분(OCC 78.62%·ADR 200,703원·RevPAR 157,793원) · CoStar 2025 서울 · 야놀자리서치 2026 3Q — 직접 비교 금지.",
      "source": "한국호텔업협회 · 한국관광공사 · 야놀자리서치 · CBRE · JLL"
    },
    {
      "key": "dc", "name": "데이터센터", "icon": "🖥️", "grade": "교차검증(CBRE·보도)",
      "lead": "전력이 곧 공급 — 승인 문턱이 자산 가치를 만드는 시장. 거래시장은 아직 형성 전.",
      "as_of": "2026-07-31",
      "kpis": [
        { "label": "수도권 공실률", "value": "<5", "unit": "%", "basis": "IT Load(MW) 기준", "sample": "수도권 상업용 DC", "source": "CBRE 데이터센터 리포트", "as_of": "2026-07-13" },
        { "label": "상면 임대료", "value": "25", "unit": "만원/kW·월", "basis": "1MW 이상 사례 · 2019년 14만원(+70%)", "sample": "권역별 사례", "source": "CBRE 데이터센터 리포트", "as_of": "2025-12-31" },
        { "label": "누적 공급(2028F)", "value": "1,450", "unit": "MW+", "basis": "수도권 · 2024·2025 흡수율 99.7%·99.4%", "sample": "IT Load", "source": "CBRE", "as_of": "2026-07-13" },
        { "label": "계통 영향평가 승인률", "value": "1.9", "unit": "%", "basis": "522건 33,592MW 신청 → 10건 1,010MW 승인", "sample": "2026-03 누적", "source": "한국전력 · CBRE", "as_of": "2026-03-31" }
      ],
      "deals": [
        { "name": "춘천 수열클러스터 DC 용지 8필지", "when": "2026-11-24~12-21", "size": "284,949㎡", "basis": "240MW 계획(최대 300MW) · 일괄 공급", "buyer": "입주기업 공모 중", "source": "춘천시 · K-water" },
        { "name": "3Q 대형 클로징", "when": "2026 3Q", "size": "미확보", "basis": "확인된 거래 없음 · 가격지표(Cap) 미형성", "buyer": "-", "source": "-" }
      ],
      "demand": "AI 수요로 선임차가 준공 전에 체결 — 2027년 물량 16.0%·2028년 23.5% 선임차, 글로벌 CSP 54%+국내 IT 34%.",
      "supply": "전력 확보가 유일한 진입 조건 — 서해안 HVDC 실사용 2030년 이후, 중부권 신규 수전 사실상 차단.",
      "implication": "전력·앵커 임차를 확보한 자산만 프리미엄 — '전력 확보 → 앵커 LOI → 매각' 순서로 접근.",
      "note": "DC는 거래 클로징이 확인되지 않아 가격지표를 비워 둠(미확보).",
      "source": "CBRE 데이터센터 리포트 · 춘천시 공고"
    }
  ],
  "sectors_next": [
    { "name": "골프장·리조트", "status": "미확보", "note": "레저백서(한국레저산업연구소)는 유료 간행물로 공개 접근 불가 — 2026년판 미확보. 공개 보도 기준 2024년 골프장 시장규모 9조 79억원(레저백서 2025)까지만 확인." },
    { "name": "리빙·코리빙", "status": "미확보", "note": "공개 3Q 지표 없음 — 데이터 확보 시 추가." }
  ],
  "sectors_home": [
    { "key": "office", "name": "오피스", "icon": "🏢", "value": "3.1~5.8", "unit": "%", "label": "프라임 공실률", "delta": "거래 35건 12.59조", "badge": "" },
    { "key": "retail", "name": "리테일", "icon": "🛍️", "value": "5.13", "unit": "조", "label": "3Q 거래금액", "delta": "+8.2% · 공실 9.9%", "badge": "NEW" },
    { "key": "logistics", "name": "물류센터", "icon": "🚚", "value": "13.1", "unit": "%", "label": "수도권 공실률", "delta": "−2.47%p · 임대료 +2.6%", "badge": "NEW" },
    { "key": "hotel", "name": "호텔", "icon": "🏨", "value": "+10.1", "unit": "%", "label": "RevPAR YoY", "delta": "ADR +9.0% · 방한 1,711만", "badge": "NEW" },
    { "key": "dc", "name": "데이터센터", "icon": "🖥️", "value": "<5", "unit": "%", "label": "수도권 공실률", "delta": "임대료 25만원/kW", "badge": "NEW" }
  ],
  "outlook": [
    { "label": "CBD 공실률", "text": "7.3% → 8~9%대 상승 [추정] — 이을타워 44,907㎡ 4Q 공급 + 쌍용C&E 8,300㎡·신한은행 5,900㎡·KB손보 2,100㎡·CJ웰케어 4,100㎡ 퇴거", "tag": "세빌스 원문은 「상승 불가피」까지, 9%는 OAAB 추정" },
    { "label": "GBD·YBD 공실률", "text": "4% 미만 유지 — 신규 공급 부재, GBD 5분기 연속 2% 미만", "tag": "세빌스" },
    { "label": "Cap Rate", "text": "4.2% → 4.3~4.5% 상단 테스트 — 기준금리 4Q 3.00%, 국고5년 4.10%, 스프레드 0.10%p", "tag": "CM 1.거시경제" },
    { "label": "임대료", "text": "YoY +5%대 유지, 자산별 양극화 — 공실 많은 건물은 렌트프리 확대", "tag": "세빌스 +5.5%" },
    { "label": "투자시장", "text": "대형·블라인드 중심 선별 지속 — 1,000억↑ 대형거래가 거래금액 80~87%", "tag": "NAI 3Q · CM" },
    { "label": "2027년 공급", "text": "프라임 신규 공급 0 — 2027년 CBD 공실 재하락 가능", "tag": "세빌스" }
  ],
  "implications": [
    { "label": "매각 자문", "text": "사옥 SI 매수세(2026년 12건 2.56조)가 유일한 확실한 수요 — 임차 만기·이전 니즈 기업을 매수자로 직접 겨냥" },
    { "label": "매입 검토", "text": "Cap 스프레드 0.10%p는 「시장가 매입 시 IRR 8%대」 구간 — 목표 IRR 10% 역산가는 Going-in 4.7% 수준" },
    { "label": "물류", "text": "우협가 평당 500만 초반 조정 국면 — 코어 블라인드(KB·케펠) 매수 기회, 저온 비중·WALE이 심의 변수" },
    { "label": "DC", "text": "거래시장 형성 전 — 앵커 임차·공동 SI로 개발 단계 진입, 전력 확보가 선결 조건" }
  ],
  "sources": [
    { "org": "CBRE 코리아", "doc": "Seoul Figures Q3 2026", "date": "2026-10-21", "url": "https://www.cbrekorea.com/press-releases/seoul-figures-q3-2026" },
    { "org": "세빌스 코리아", "doc": "서울 프라임 오피스 Q3/2026", "date": "2026-10-28", "url": "https://www.savills.co.kr/research_articles/166316/239399-0" },
    { "org": "쿠시먼앤드웨이크필드", "doc": "서울 오피스 MarketBeat Q3 2026", "date": "2026-10-26", "url": "https://www.cushmanwakefield.com/ko-kr/south-korea/insights/seoul-marketbeat/office-marketbeat-report" },
    { "org": "JLL 코리아", "doc": "2026 3분기 서울 A급 오피스 시장 동향", "date": "2026-11-11", "url": "https://www.hankyung.com/article/202611119943i" },
    { "org": "뉴마크", "doc": "2026 3Q 서울 A급 오피스 (보도 인용)", "date": "2026-10-19", "url": "" },
    { "org": "알스퀘어", "doc": "2026년 3분기 오피스 마켓 리포트", "date": "2026-11-13", "url": "https://www.newsis.com/view/NISX20261113_0003866703" },
    { "org": "젠스타메이트", "doc": "Korea Office Market Report Q3 2026", "date": "2026-10-21", "url": "https://www.wowtv.co.kr/NewsCenter/News/Read?articleId=202611135247r" },
    { "org": "JLL 코리아", "doc": "2026년 3분기 수도권 물류시장 동향", "date": "2026-10-28", "url": "https://jll.inblog.io/jll-%EC%BD%94%EB%A6%AC%EC%95%84-2026%EB%85%84-3%EB%B6%84%EA%B8%B0-%EC%88%98%EB%8F%84%EA%B6%8C-%EB%AC%BC%EB%A5%98%EC%8B%9C%EC%9E%A5-%EB%8F%99%ED%96%A5-%EB%B0%9C%ED%91%9C-393781" },
    { "org": "JLL", "doc": "Seoul Industrial Market Dynamics Q3 2026", "date": "2026-11-24", "url": "https://www.jll.com/en-us/insights/market-dynamics/seoul-industrial" },
    { "org": "JLL", "doc": "Seoul Hotel Market Dynamics Q3 2026", "date": "2026-11-25", "url": "https://www.jll.com/en-us/insights/market-dynamics/seoul-hotel" },
    { "org": "한국부동산원", "doc": "2026년 3분기 상업용부동산 임대동향조사", "date": "2026-10-29", "url": "https://www.bseconomy.com/m/view.php?idx=57873&mcode=" },
    { "org": "야놀자리서치", "doc": "2026년 3분기 국내 숙박업 동향 보고서", "date": "2026-10-27", "url": "https://www.hotelrestaurant.co.kr/news/articleView.html?idxno=22433" },
    { "org": "한국관광공사", "doc": "2026년 9월 한국관광통계 (문체부 보도자료 2026-10-22)", "date": "2026-10-28", "url": "https://www.mcst.go.kr/site/s_notice/press/pressView.jsp?pSeq=22790" },
    { "org": "CBRE 코리아", "doc": "호텔 리포트 — 객실은 그대로, 가치는 새롭게", "date": "2026-11", "url": "https://mktgdocs.cbre.com/2299/a362ebcf-4473-43f2-bd6d-ec3d3498bfb8-1508574535/_CBRE__Hotel_Report_FN_(KR).pdf" },
    { "org": "CBRE 코리아", "doc": "한국 데이터센터 투자 — 공급 제약과 희소성 프리미엄", "date": "2026-07-13", "url": "https://www.cbrekorea.com/press-releases/korea-data-center-investment" },
    { "org": "춘천시", "doc": "수열클러스터 데이터센터 입주기업 공개모집", "date": "2026-11-24", "url": "https://www.chuncheon.go.kr/mayor/newsroom/press-release/?bbsId=BBSMSTR_000000000335&flag=view&nttId=531953" },
    { "org": "한국호텔업협회", "doc": "호텔업운영현황 2015~2024", "date": "2025", "url": "" },
    { "org": "NAI Korea Research 및 내부 자료", "doc": "2026 3Q 시장 데이터", "date": "2026-11-28", "url": "" }
  ],
  "limits": [
    { "item": "CM 3Q 임대·공급 미기입", "text": "3.임대시장·4.공급시장 2026 3Q 공란(갱신 2026-10-29) — 11월 정기보고 시 백필" },
    { "item": "공실률 두 계열", "text": "자체표본 2.07% ↔ 전체 6.9% — 표본 건물·분모 미확인" },
    { "item": "NOC 기준 표기", "text": "290,534에 「전용면적 기준」 각주 의무화" },
    { "item": "거래 집계 정합", "text": "발표본 32건 12.3조 ↔ 내부 집계 35건 12.59조(3건 차이)" },
    { "item": "물류·DC 거래 집계", "text": "내부 거래사례는 오피스 전용 — 물류·DC는 외부 보도·리서치 기준으로만 채움" },
    { "item": "호텔 실적 3계열", "text": "호텔업협회 2024 · CoStar 2025 · 야놀자리서치 2026 3Q — 표본이 달라 한 줄로 합치지 않음" },
    { "item": "골프·리조트", "text": "레저백서 유료 간행물로 공개 접근 불가 — 2026년판 미확보(섹터 자리만 마련)" },
    { "item": "DC 가격지표", "text": "3Q 대형 클로징 확인 없음 — Cap Rate 등 가격지표 미확보" }
  ]
};
