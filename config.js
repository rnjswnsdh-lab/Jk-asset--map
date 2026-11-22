/* =========================================================================
   NAI Korea 상업용 부동산 통합 지도 — 설정 파일
   -------------------------------------------------------------------------
   ▶ 카카오맵을 쓰려면 아래 KAKAO_JS_KEY 에 'JavaScript 키'를 넣으세요.
     1) https://developers.kakao.com → 내 애플리케이션 → 앱 선택
     2) [플랫폼] → Web 플랫폼 등록 → 이 앱을 여는 도메인 등록
        (예: file:// 로 열면 도메인 등록이 안 되므로, 아래 README의
         '로컬 서버로 열기' 방법을 쓰거나 호스팅 주소를 등록하세요)
     3) [앱 키] → JavaScript 키 복사 → 아래 따옴표 안에 붙여넣기
   ▶ 키가 비어 있으면 앱은 '미리보기 모드'(좌표 점 지도)로 동작합니다.
     데이터·검색·수정·추가·내보내기는 키 없이도 모두 사용할 수 있습니다.
   ========================================================================= */
window.NAI_MAP_CONFIG = {
  KAKAO_JS_KEY: "38ad693430e19f1395ff6005d6250dce",

  /* 데이터 파일 위치 (기본: 같은 폴더의 data/assets.json) */
  DATA_URL: "",

  /* ── 선택 사항: 원격 동기화 ─────────────────────────────────────────────
     Google Apps Script 웹앱 등과 연결하면 수정 내용이 여러 기기에서 공유됩니다.
     비워 두면 브라우저 localStorage 에만 저장됩니다.
     연동 규격은 README.md 의 'syncAdapter 규격'을 참고하세요. */
  SYNC_URL: "https://script.google.com/macros/s/AKfycbz2Kxvr6Mow5LBWLZcCxK1jE-XTWIiVnFxNEBCeoDjAvwOiWAR_419LvLkAepQtqknz/exec",
  SYNC_TOKEN: "",
  SYNC_POLL_SECONDS: 0, // 0 = 자동 새로고침 없음 (예: 30 입력 시 30초마다 pull)

  /* 저장 키 접두어 (같은 브라우저에서 여러 지도를 쓸 때 구분용) */
  STORAGE_PREFIX: "nai-map",

  /* 지도 초기 위치 (서울시청) */
  DEFAULT_CENTER: { lat: 37.5665, lng: 126.9780 },
  DEFAULT_LEVEL: 8,

  /* 섹터 정의 — 색상·라벨·아이콘 문자 */
  SECTORS: {
    hotel:      { label: "호텔",       color: "#e5484d", dark: "#b3262c", short: "H" },
    logistics:  { label: "물류센터",   color: "#2f6fed", dark: "#1d4fbe", short: "L" },
    office:     { label: "오피스",     color: "#12a06b", dark: "#0b7a50", short: "O" },
    datacenter: { label: "데이터센터", color: "#8b5cf6", dark: "#6d3fd4", short: "D" },
    /* 5번째 섹터 — 화주·임차수요(사용 물류센터·부족권역·공개 신규수요). 주황색으로 구분 */
    shipper:    { label: "화주·임차수요", color: "#f97316", dark: "#c2410c", short: "S" }
  },

  /* 진행상태 그룹 — 배지 색상 */
  STATUS_GROUPS: {
    "운영중":       "#12a06b",
    "개발중":       "#f59e0b",
    "거래진행중":   "#ef4444",
    "거래완료":     "#6b7280",
    "만기·매각예정": "#2563eb",
    "매각철회":     "#9ca3af",
    "검토중":       "#a855f7",
    "확인 필요":    "#94a3b8"
  },

  /* 목록에 표시할 최대 건수 (검색·필터 결과가 많을 때 성능 보호) */
  LIST_RENDER_LIMIT: 600
};
