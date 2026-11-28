# 개인 브랜딩·운영 주체 표기 정리 기록 (2026-11-28)

플랫폼(OAAB)을 **개인 이름·직함·초대 링크 없이, 운영 주체 중립**으로 운영하기 위해 지운 문구 목록입니다.
나중에 사용자가 직접 이름·법인명을 넣고 싶다고 하면 이 문서를 보고 되돌리면 됩니다.

## 원칙 (2026-11-28 사용자 지시)

1. 외부에 보이는 화면·발신 문구에 **개인 실명·직함·연락처·개인 초대(추천) 링크**를 쓰지 않는다.
2. 운영 주체를 **NAI Korea로 표기하지 않는다** — 이 플랫폼은 NAI Korea와 운영상 관계가 없는 독립 플랫폼이다.
3. **NAI Korea는 '데이터 출처'로만** 남긴다 — 실제로 NAI가 매각·임대 자문을 한 건의 사례·거래 정보에 출처로 붙는 경우만.
4. 관리자·운영자 라벨은 **'관리자'** 로 통일한다(개인 실명·직함·회사명 없음).
5. 운영 주체·문의처·푸터는 하드코딩하지 않고 `config.js` 의 `PLATFORM` 값 하나로 모은다(지금은 비움 → 플랫폼 이름 표기).
   약 1년간 업데이트·테스트·배포 후, 법인 설립 시점에 `PLATFORM.operator` 만 채우면 전체에 반영된다.

## 지운 것 / 바꾼 것

| 위치 | 이전 | 이후 |
|---|---|---|
| `config.js` PICKLE_MODE / PICKLE_INVITE_URL | `"invite"` + 개인 초대 링크 `pickle.com/i/2X6HQCBL47MN` | `"default"`, 초대 링크 빈 값 |
| `ai.js` pickleNote() | `권준오 상무의 피클 초대 링크 · pickle.com` | `AI 대화형 분석 · pickle.com` |
| `ai.js` 진입 URL 로직 | 초대 링크 우선 | 초대 링크가 비어 있으면 일반 진입(`pickle.com/app`) |
| `match.js` AI 매칭 CTA 주석·문구 | `권준오 상무의 피클 초대 링크 · pickle.com` | `AI 대화형 분석 · pickle.com` |
| `index.html` 리멤버 게이트 안내 | `권준오 상무와 리멤버 명함을 교환하셨다면…` | `담당자와 리멤버 명함을 교환하셨다면…` |
| `index.html` 신규등록 안내 | `리멤버 앱에서 권준오(010-7731-4316)를 검색해…` | `리멤버 앱에서 담당자 명함을 교환해 주세요…` (개인 번호 제거) |
| `home.js` IM/TM 브리프 Contact 슬라이드 | `NAI Korea` 주소·TEL·`담당 권준오 상무 · 010-7731-4316 · jk@naikorea.com` | 플랫폼 이름 + `PLATFORM.contact`(비면 "플랫폼 접수 화면을 통해 문의") |
| `home.js` IM 표지 문구 | `NAI Korea 매각자문 · 날짜` | `매각자문 브리프 · 날짜` |
| `home.js` Next Step | `NAI Korea 담당자와 조건 협의 후…` | `담당자와 조건 협의 후…` |
| `home.js` 브리프 하단 | `NAI Korea · Open AI Asset Bridge · 날짜` / `NAI Korea 양식(.pptx/PDF)` | 플랫폼 표기(`PLATFORM.footer`) / `별도 양식(.pptx/PDF)` |
| `share.js` 발신자 상수 `ME` | 이름·직함·휴대폰·회사·주소 하드코딩 | 삭제 → `PLATFORM.name()/contact()` |
| `share.js` 메일 제목 머리 | `[NAI Korea]` | `[Open AI Asset Bridge]` |
| `share.js` 인사말 | `안녕하세요, NAI Korea 권준오 상무입니다.` | `안녕하세요, Open AI Asset Bridge 담당자입니다.` |
| `share.js` 회신 안내·서명 | `NAI Korea에서 조건 확인 후…` / 회사·이름·직함·TEL·E | `조건 확인 후…` / 플랫폼 이름 + `PLATFORM.contact` |
| `investors.js` 담당 연락처 비공개 안내 | `문의: NAI Korea` | `문의: Open AI Asset Bridge` |
| `investors.js` 티저 메일 제목 | `[NAI Korea] 물건 티저 안내` | `[Open AI Asset Bridge] 물건 티저 안내` |
| `investors.js` 메일 서명 | `NAI Korea 권준오 상무` | 플랫폼 이름 |
| `investors.js` 담당자 기본 후보·입력 예시 | `['권준오 상무']`, `예) 권준오 상무 — 비우면 담당 미지정` | 빈 목록, `예) 담당자 구분명 — 비우면 담당 미지정` |
| `broadcast.js` 아티클 공유 인사 | `안녕하세요, NAI Korea 권준오입니다.` | `안녕하세요, Open AI Asset Bridge입니다.` |
| `crm.js` 작성자명 입력 예시 | `예) 권준오` | `예) 홍길동` |
| `hub.js` TR 임차의뢰 설명 | `NAI Korea 가 보유 물건 …` | `보유 자산 DB · 매각·LM 물건 …` |
| `adminhq.js` 소속 입력 예시 | `예) NAI Korea CM팀` | `예) CM팀` |
| `rfp.js` / `rfpflow.js` 메일 문의 기본값 | `문의: NAI Korea` | 플랫폼 이름 |
| `rfpcore.js` RFP 의뢰인 기본값 | `client: 'NAI Korea'` | 플랫폼 이름 |
| `acl.js` 접속코드 전달 문구 | `문의: NAI Korea` | `문의: Open AI Asset Bridge` |
| `report.js` 리포트 하단 | `본 리포트는 NAI Korea 내부·고객 검토용` | `본 리포트는 내부·고객 검토용` |
| `finance.js` 문의 보내는 곳 기본값 | `NAI Korea` | 플랫폼 이름 |
| `manifest.webmanifest` | `Open AI Asset Bridge — NAI Korea` / `NAI Korea 상업용 부동산 …` | `Open AI Asset Bridge` / `상업용 부동산 물건·투자자(SI·FI)·접수 통합 딜 브리지` |

## 일부러 남긴 것 (이유)

- **데이터 출처 표기**: `advisordata.js`(자문사 목록의 NAI Korea), `market_review_2026q3.js`(3Q 리포트 발행처·발표자), `nai.js`(NAI 매각·LM 물건 안내), `market_report` 등 — 실제 출처·자료 주체가 NAI인 건의 표기.
- **탭 이름** `🏷️ NAI 매각` · `🔑 NAI 임대` · `🗂️ NAI 행정`: 화면이 보여 주는 데이터가 'NAI가 주관한 매각·임대 물건'이라는 **출처 구분**이라 유지. (운영 주체 표기 아님)
- **메일 서명이 필요한 업무 메일**: 서명 자체는 플랫폼 표기로 바꿨고, 개인 실명은 넣지 않음.
- **`JK Value`**: CA·VDR·LOI 절차의 프로그램 이름(개인 실명 아님). 필요하면 별도로 바꿀 수 있음.
- `tr.js`(index.html 미사용 파일)의 옛 문구: 화면에 로드되지 않아 그대로 둠.

## 되돌리는 방법

- 개인 초대 링크를 다시 쓰려면: `config.js` → `PICKLE_MODE: "invite"`, `PICKLE_INVITE_URL: "<주소>"`.
- 운영 주체(법인명)를 넣으려면: `config.js` → `PLATFORM.operator`(법인명), `PLATFORM.contact`(문의처), `PLATFORM.footer`(푸터·저작권).
  → 상단·푸터·문의·메일 서명·IM 브리프에 한 번에 반영됩니다.
- 개인 실명을 특정 화면에만 다시 넣으려면: 해당 화면에서 `NAI_PLATFORM.name()` 대신 원하는 문자열로 바꾸면 됩니다.
