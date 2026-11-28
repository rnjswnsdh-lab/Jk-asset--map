/* =========================================================================
   Open AI Asset Bridge — hub.js  (📝 딜·참여 등록 허브, 2026-11-24)
   -------------------------------------------------------------------------
   기존 📋 TR 임차의뢰 단일 모달을 7가지 유형(자문사 딜 참여 포함)을 받는 참여 허브로 확장했습니다.

     ① 매각 (매물 등록)          ② 매입 / 투자 (사옥·투자 의향)
     ③ 임대 / LM (임대 물건)      ④ TR 임차의뢰
     ⑤ 호텔 운영 참여 (운영사)    ⑥ 대출 / 금융 PR (금리·LTV·조건)

   저장
   - POST {action:'submit_request'} → 비공개 시트 `lois` 에 request_type 컬럼과 함께 적재
     (Apps Script Hub.gs). 서버가 아직 새 액션을 모르는 경우(unknown_action) 기존
     submit_loi 로 자동 우회하고, 메모 머리에 `[유형=…]` 을 남겨 구분합니다.
   - 기존 TR 레코드(request_type 없음)는 목록에서 '④ TR 임차의뢰'로 읽힙니다(호환).

   목록
   - 관리자: GET {type:'requests'} 로 전체 접수 조회 + 유형 필터·검색
   - 그 외: 이 브라우저에서 제출한 내역(localStorage)만 표시
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var MINE_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':hub:mine:v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function me() { return (window.naiMap && window.naiMap.me) ? window.naiMap.me() : null; }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }

  /* ───────────────── 비관리자 업체명 블라인드 (서버와 같은 규칙) ─────────────────
     실제 업체명은 관리자에게만 보입니다. 그 외 권한(CM팀·물류TF·외부)에게는
     blind_name(접수 시 저장) 또는 업종만 남긴 표기를 씁니다. */
  var BLIND_PREFIX = '🔒 ';
  function blindNameOf(company, sector) {
    var c = String(company || '');
    if (!c) return '비공개 고객사';
    if (/자산운용|운용|AMC/i.test(c)) return '비공개 자산운용사 (금융·투자)';
    if (/리츠|REIT/i.test(c)) return '비공개 리츠 (금융·투자)';
    if (/증권/.test(c)) return '비공개 증권사 (금융·투자)';
    if (/은행|저축은행/.test(c)) return '비공개 금융기관 (금융·투자)';
    if (/보험/.test(c)) return '비공개 보험사 (금융·투자)';
    if (/연기금|공제회|교직원/.test(c)) return '비공개 연기금·공제회';
    if (/물류|로지스|택배|운송/i.test(c)) return '비공개 물류기업';
    if (/호텔|리조트|운영/.test(c)) return '비공개 호텔·운영사';
    if (/건설|건영|종합건설/.test(c)) return '비공개 건설사';
    if (/부동산|디벨로퍼|개발/.test(c)) return '비공개 부동산 개발사';
    if (String(sector || '') === 'shipper') return '비공개 화주기업';
    return '비공개 고객사';
  }
  /** 목록·상세에 표시할 업체명 — 관리자만 원문 */
  function companyOf(row) {
    if (!row) return '';
    if (isAdmin()) return String(row.company || '');
    return String(row.blind_name || '').trim() || blindNameOf(row.company, row.sector);
  }
  function companyCell(row) {
    var name = companyOf(row);
    if (!name) return '';
    return isAdmin() ? esc(name) : '<span class="hub-blind" title="업체명은 관리자만 볼 수 있습니다">' + esc(BLIND_PREFIX + name) + '</span>';
  }
  /* 담당자명 — 비관리자에게는 회사명·기관명형 표기(쿠팡 CLS·에스원 임차자문 등)를 숨깁니다 */
  var CORP_NAME = /(㈜|\(주\)|주식회사|자산운용|CLS|임차자문|파트너스|캐피탈|증권|은행|리츠|AMC|물류|화주)/;
  function personOf(row) {
    var nm = String((row && row.name) || '');
    if (isAdmin()) return nm;
    return CORP_NAME.test(nm) ? '' : nm;
  }

  /* 🔒 TR 요청자·연락처 비공개 (2026-11-28)
     서버가 관리자·등록자 본인이 아닌 조회자의 요청자 필드를 '비공개'로 내려보냅니다.
     화면에서는 🔒 안내로 보여 주고, 담당자(owner, NAI)는 그대로 공개합니다. */
  function requesterMasked(row) {
    if (!row) return false;
    if (row.requester_private === true || String(row.requester_private) === 'true') return true;
    return String(row.name || '') === '비공개';
  }
  /* 담당 표기 — 운영자(관리자) 계정으로 등록된 건은 실명 대신 '관리자'로 (2026-11-28 블라인드 원칙) */
  function ownerLabel(row) {
    var owner = String((row && row.owner) || '').trim();
    if (!owner) return '';
    if (String((row && row.role) || '') === 'admin' || String((row && row.created_by) || '') === 'admin') return '관리자';
    return owner;
  }
  function requesterCell(row) {
    var owner = ownerLabel(row);
    var own = owner ? '<span class="hub-sub">담당 ' + esc(owner) + '</span>' : '';
    if (requesterMasked(row)) {
      return '<span class="hub-blind nowrap" title="TR 요청자·연락처는 관리자와 이 TR 을 등록한 본인만 볼 수 있습니다">🔒 비공개</span>' + own;
    }
    var who = [personOf(row), (row && row.title) || ''].filter(Boolean).join(' ');
    return esc(who || '-') + own;
  }
  function phoneCell(row) {
    if (requesterMasked(row)) return '<span class="hub-blind">🔒 비공개</span>';
    var p = String((row && row.phone) || '');
    if (!p) return '';
    if (p === '비공개') return '<span class="hub-blind">비공개</span>';
    return esc(p);
  }

  /* ─────────── 접수 건 수정·삭제 권한 — 등록자 본인 또는 관리자 (2026-11-28) ───────────
     그 외 계정은 버튼을 만들지 않고, 서버(request_update·request_delete)도 같은 기준으로 거부합니다.
     남의 접수 건은 지금처럼 요청자·연락처가 🔒 비공개로 내려옵니다. */
  function digitsOf(s) { return String(s == null ? '' : s).replace(/[^0-9]/g, ''); }
  function myId_() {
    var m = me() || {};
    return {
      email: String(m.email || '').toLowerCase().trim(),
      phone: digitsOf(m.phone),
      name: String(m.name || '').trim(),
      company: String(m.company || '').trim()
    };
  }
  function isMyRequest(row) {
    if (!row) return false;
    var id = myId_();
    if (id.email && row.email && id.email === String(row.email).toLowerCase().trim()) return true;
    var rp = digitsOf(row.phone);
    if (id.phone && rp.length >= 7 && id.phone === rp) return true;
    if (id.name && row.name && String(row.name).trim() !== '비공개' && id.name === String(row.name).trim()) {
      if (!row.company || !id.company || String(row.company).trim() === id.company) return true;
    }
    return false;
  }
  function canModify(row) { return isAdmin() || isMyRequest(row); }

  /** 📧 파트너 메일 공유 — 행을 블라인드 기준으로 넘깁니다 */
  function openShare(id) {
    var row = null;
    for (var i = 0; i < LIST.items.length; i++) if (String(LIST.items[i].id) === String(id)) { row = LIST.items[i]; break; }
    if (!row) return;
    if (!window.NAI_SHARE) { toast('메일 공유 모듈을 불러오지 못했습니다. 새로고침해 주세요.', true); return; }
    /* 항상 블라인드 표기를 넘깁니다 — 관리자 화면에서도 실명은 메일 본문에 넣지 않습니다 */
    var blind = String(row.blind_name || '').trim() || blindNameOf(row.company, row.sector);
    window.NAI_SHARE.openRequest({
      request_type: normType(row), blind_name: blind, region: row.region || '',
      area_py: row.area_py || '', price: row.price || '', rent: row.rent || '',
      timeline: row.timeline || '', memo: row.memo || '', asset_name: row.asset_name || '',
      /* 본문에 섞여 들어갈 수 있는 실명 토큰 — 발견되면 블라인드 표기로 치환 */
      hideTokens: [row.company, row.name, row.title]
    });
  }

  function toast(msg, err) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3400);
  }

  /* ───────────────────────────── 유형 정의 ───────────────────────────── */
  var SECTORS = [
    { v: 'office', l: '오피스 · 사옥' },
    { v: 'logistics', l: '물류센터' },
    { v: 'datacenter', l: '데이터센터' },
    { v: 'hotel', l: '호텔' },
    { v: 'retail', l: '리테일 · 상업시설' },
    { v: 'living', l: '멀티패밀리 · 임대주택' },
    { v: 'land', l: '토지 · 개발부지' },
    { v: 'golf', l: '골프장' },
    { v: 'senior', l: '선순위 · 메자닌 · 대출' },
    { v: 'etc', l: '기타' }
  ];

  function regionList() {
    var set = {};
    var st = window.naiMap && window.naiMap.state;
    (st && st.assets ? st.assets : []).forEach(function (a) {
      var r = String(a.region || '').trim();
      if (r) set[r] = (set[r] || 0) + 1;
    });
    ['서울', '경기', '인천', '부산', '대구', '대전', '세종', '광주·전남', '충남', '충북',
      '경남', '경북', '전북', '울산', '강원', '제주', 'CBD', 'GBD', 'BBD', 'YBD'].forEach(function (r) {
      if (!set[r]) set[r] = 0;
    });
    return Object.keys(set).sort(function (a, b) { return set[b] - set[a]; });
  }
  function regionOpts() {
    return [{ v: '', l: '선택 안 함' }].concat(regionList().map(function (r) { return { v: r, l: r }; }));
  }

  var TYPES = [
    {
      code: 'sale', short: '매각', icon: '🏷️', label: '매각 · 매물 등록',
      desc: '매각을 검토하는 물건을 등록합니다. NAI 매각자문·LM 후보로 검토하고, 필요 시 투자자 풀과 교차 매칭합니다.',
      deal: '매입',
      fields: [
        { k: 'asset', l: '물건명', req: true, wide: true, ph: '예) 서울 중구 OO타워 (목록에서 선택하거나 직접 입력)' },
        { k: 'sector', l: '섹터', t: 'select', opts: SECTORS, v: 'office' },
        { k: 'addr', l: '주소', ph: '예) 서울 중구 청진동 70' },
        { k: 'scale', l: '규모 · 면적', ph: '예) 연면적 12,000평 / 대지 3,000평' },
        { k: 'price', l: '희망 매각가', ph: '예) 1,200억원 (평당 1,000만원)' },
        { k: 'timeline', l: '매각 희망 시기', ph: '예) 2027년 상반기' },
        { k: 'status', l: '진행 상태', t: 'select', opts: [
          { v: '매각 검토', l: '매각 검토' }, { v: '입찰 진행', l: '입찰 진행' }, { v: '수의계약', l: '수의계약 협의' },
          { v: '오퍼 수령', l: '오퍼 수령' }, { v: '매각 완료', l: '매각 완료(사후 정리)' }
        ], v: '매각 검토' },
        { k: 'lease', l: '임차 · 만기', wide: true, ph: '예) OO공사 통임차 2030-12 만기, 연 2% 인상' },
        { k: 'memo', l: '매각 사유 · 특이사항', t: 'textarea', wide: true, rows: 2, ph: '담보·대출 승계, 공실, 리모델링 이력 등' }
      ],
      title: function (v) { return '[매각] ' + (v.asset || '물건 미정') + (v.addr ? ' · ' + v.addr.split(' ').slice(0, 2).join(' ') : ''); }
    },
    {
      code: 'buy', short: '매입', icon: '🎯', label: '매입 / 투자 (사옥·투자 의향)',
      desc: '매입·투자 의향을 남깁니다. 예산·권역·목적에 맞는 매물을 NAI DB·오프마켓에서 찾아 제안합니다.',
      deal: '매입',
      fields: [
        { k: 'asset', l: '관심 물건 · 권역', wide: true, ph: '예) 서울 CBD 3,000평 사옥 / 특정 물건명' },
        { k: 'sector', l: '섹터', t: 'select', opts: SECTORS, v: 'office' },
        { k: 'region', l: '희망 지역 · 권역', t: 'select', opts: regionOpts() },
        { k: 'price', l: '예산', ph: '예) 700~1,000억원' },
        { k: 'area', l: '희망 면적(평)', ph: '예) 3,000~5,000' },
        { k: 'timeline', l: '희망 시기', ph: '예) 6개월 내 / 2027 상반기' },
        { k: 'purpose', l: '투자 목적', t: 'select', opts: [
          { v: '사옥(자가사용)', l: '사옥 · 자가사용' }, { v: '코어(안정수익)', l: '코어 · 안정수익' },
          { v: '코어플러스', l: '코어플러스' }, { v: '밸류애드', l: '밸류애드' }, { v: '개발·컨버전', l: '개발 · 컨버전' }
        ], v: '사옥(자가사용)' },
        { k: 'finance', l: '자금조달', ph: '예) 자기자본 40% + 선순위 60%(4.8%)' },
        { k: 'memo', l: '투자 조건 · 비고', t: 'textarea', wide: true, rows: 2, ph: '필수 조건, 제외 대상, 의사결정 일정 등' }
      ],
      title: function (v) { return '[매입] ' + (v.region ? v.region + ' · ' : '') + (v.asset || '투자 의향'); }
    },
    {
      code: 'lease', short: '임대·LM', icon: '🔑', label: '임대 / LM (임대 물건 등록)',
      desc: '임대할 물건(또는 공실)을 등록합니다. NAI LM·임차인 풀과 연결해 임차 수요를 매칭합니다.',
      deal: '임차',
      fields: [
        { k: 'asset', l: '물건명', req: true, wide: true, ph: '예) 성수동 OO타워 5~7층' },
        { k: 'sector', l: '섹터', t: 'select', opts: SECTORS, v: 'office' },
        { k: 'addr', l: '주소', ph: '예) 서울 성동구 성수동2가 271-1' },
        { k: 'area', l: '임대 가능 면적(평)', ph: '예) 1,200평 (3개층)' },
        { k: 'rent', l: '희망 임대료', ph: '예) 평당 월 4.2만원 (관리비 별도)' },
        { k: 'timeline', l: '입주 가능 시기', ph: '예) 즉시 / 2027년 3월' },
        { k: 'spec', l: '임차 조건', wide: true, ph: '예) 층고 4.5m, 하중 1t/㎡, 전력 500kW, 주차 40대' },
        { k: 'deposit', l: '보증금 · 명도', ph: '예) 보증금 6개월치, 명도 완료' },
        { k: 'memo', l: '비고', t: 'textarea', wide: true, rows: 2 }
      ],
      title: function (v) { return '[임대] ' + (v.asset || '물건 미정') + (v.area ? ' · ' + v.area : ''); }
    },
    {
      code: 'tr', short: 'TR 임차', icon: '📋', label: 'TR 임차의뢰 (화주·임차인)',
      desc: '희망 조건을 남기면 보유 자산 DB · 매각·LM 물건 · 외부 매물 중 부합 후보를 찾아 회신합니다. (Tenant Request)',
      deal: '임차',
      fields: [
        { k: 'region', l: '희망 지역 · 권역', t: 'select', opts: regionOpts() },
        { k: 'sector', l: '섹터', t: 'select', opts: SECTORS, v: 'logistics' },
        { k: 'deal', l: '거래 구분', t: 'select', opts: [{ v: '임차', l: '임차 (리스)' }, { v: '매입', l: '매입 (인수)' }], v: '임차' },
        { k: 'area', l: '희망 면적(평)', ph: '예) 15,000' },
        { k: 'rent', l: '희망 임대료 · 예산', wide: true, ph: '임차: 평당 월 3.3만원 / 매입: 1,200억원' },
        { k: 'timeline', l: '입주 희망 시기', ph: '예) 2027년 상반기 / 6개월 내' },
        { k: 'spec', l: '상세 스펙 (온도·층고·하중·도크)', t: 'textarea', wide: true, rows: 2, ph: '예) 냉동 -25℃ 5,000평 + 상온 10,000평, 층고 10m 이상, 도크 40대, 하중 1.5t/㎡' },
        { k: 'memo', l: '메모', t: 'textarea', wide: true, rows: 2, ph: '후보 물건 조건 · 기타 요청사항' }
      ],
      title: function (v) { return '[TR] ' + (v.region || '전국') + ' · ' + sectorLabel(v.sector) + (v.area ? ' · ' + v.area + '평' : ''); }
    },
    {
      code: 'hotel', short: '호텔운영', icon: '🏨', label: '호텔 운영 참여 (운영사)',
      desc: '호텔·리조트 운영사(위탁·직영·브랜드)의 참여 의향을 등록합니다. NAI 호텔 컨버전·개발 딜과 매칭합니다.',
      deal: '임차',
      fields: [
        { k: 'asset', l: '관심 호텔 · 사업장', wide: true, ph: '예) 부산 중구 OO호텔 컨버전 / 특정 사업장' },
        { k: 'region', l: '희망 지역 · 권역', t: 'select', opts: regionOpts() },
        { k: 'rooms', l: '객실 수(실)', ph: '예) 200' },
        { k: 'opType', l: '운영 형태', t: 'select', opts: [
          { v: '위탁운영', l: '위탁운영 (Management Contract)' }, { v: '직영', l: '직영' },
          { v: '브랜드·프랜차이즈', l: '브랜드 · 프랜차이즈' }, { v: '임차운영', l: '임차운영 (Lease)' }
        ], v: '위탁운영' },
        { k: 'track', l: '운영 경력 · 포트폴리오', wide: true, ph: '예) 국내 12개 호텔 위탁운영(3,400실), OCC 78%' },
        { k: 'terms', l: '제안 조건', wide: true, ph: '예) 기본수수료 매출 3% + 인센티브 6%, 성과보증 2년' },
        { k: 'timeline', l: '참여 희망 시기', ph: '예) 2027년 개관 목표' },
        { k: 'memo', l: '비고', t: 'textarea', wide: true, rows: 2, ph: '브랜드·등급, F&B 운영 여부, 투자 참여 가능 범위 등' }
      ],
      title: function (v) { return '[호텔운영] ' + (v.asset || (v.region || '') + ' 호텔') + (v.rooms ? ' · ' + v.rooms + '실' : ''); }
    },
    {
      code: 'finance', short: '대출·금융', icon: '🏦', label: '대출신청 / 금융주선 (자격증명 필수)',
      desc: '대출 신청 및 금융주선(증권사·금융기관의 금리·LTV·만기·트랑슈 제시)을 접수합니다. 금융기관·심사역 자격증명을 반드시 함께 제출해야 검토됩니다.',
      deal: '매입',
      fields: [
        { k: 'asset', l: '대상 사업 · 물건', wide: true, ph: '예) 오피스 매입 1,000억 / 물류센터 개발PF' },
        { k: 'finType', l: '금융 유형', t: 'select', opts: [
          { v: '선순위', l: '선순위 담보대출' }, { v: '중순위·메자닌', l: '중순위 · 메자닌' },
          { v: '브릿지', l: '브릿지론' }, { v: '개발PF', l: '개발 PF' }, { v: '리파이낸싱', l: '리파이낸싱' }
        ], v: '선순위' },
        { k: 'cred', l: '자격 증명 (필수)', req: true, wide: true, ph: '예) 금융투자업 인가번호 / 기관 고유번호 / 심사역 명함(성명·직책·연락처)' },
        { k: 'amount', l: '대출 가능 금액', ph: '예) 600억원 ~ 900억원' },
        { k: 'ltv', l: 'LTV', ph: '예) 60~65%' },
        { k: 'rate', l: '금리', ph: '예) 4.3~4.8% (3년 고정)' },
        { k: 'maturity', l: '만기 · 연장', ph: '예) 5년 (1년 연장옵션)' },
        { k: 'tranche', l: '트랑슈 · 조건', wide: true, ph: '예) 선순위 only, DSCR 1.25x 이상, 임대율 90% 이상' },
        { k: 'memo', l: '비고', t: 'textarea', wide: true, rows: 2, ph: '취급 가능 지역·자산군, 심사 소요기간, 수수료 등' }
      ],
      title: function (v) { return '[금융] ' + (v.finType || '대출') + ' · ' + (v.asset || '대상 미정') + (v.amount ? ' · ' + v.amount : ''); }
    },
    {
      code: 'advisor', short: '자문사딜', icon: '🧾', label: '자문사 딜 참여',
      desc: '매각·매입·임대·금융 딜에 자문사(회계·세무·감정·기술·법률·AMC)로 참여 의향을 접수합니다. 접수된 자문사 딜은 자문사 딜 프로세싱 시트에서 진행 단계를 관리합니다.',
      deal: '매입',
      fields: [
        { k: 'asset', l: '참여 대상 딜 · 물건', wide: true, ph: '예) CBD 오피스 매각자문 / 특정 물건명' },
        { k: 'advType', l: '자문 유형', t: 'select', opts: [
          { v: '매각자문', l: '매각 자문' }, { v: '매입자문', l: '매입 자문' },
          { v: '임대자문', l: '임대(LM) 자문' }, { v: '금융자문', l: '금융 · PF 자문' },
          { v: '감정·기술', l: '감정 · 기술용역' }, { v: '회계·세무', l: '회계 · 세무' },
          { v: '법률', l: '법률' }, { v: 'AMC·운용', l: 'AMC · 운용 대행' }
        ], v: '매각자문' },
        { k: 'region', l: '권역', t: 'select', opts: regionOpts() },
        { k: 'cred', l: '자격 · 실적', wide: true, ph: '예) 감정평가법인 등록번호 / 연간 자문 12건 · 오피스 8건' },
        { k: 'fee', l: '수수료 · 보수 조건', ph: '예) 성공보수 0.8% / 착수보수 3,000만원' },
        { k: 'timeline', l: '참여 가능 시기', ph: '예) 즉시 / 2026-12 착수' },
        { k: 'memo', l: '비고', t: 'textarea', wide: true, rows: 2, ph: '이해상충 여부, 보유 장비·인력, 협업 제안 등' }
      ],
      title: function (v) { return '[자문사딜] ' + (v.advType || '자문') + ' · ' + (v.asset || '대상 미정'); }
    }
  ];

  /* 접수 유형 라벨 — 목록 필터 칩(['매각','매입','임대','TR','호텔운영','금융'])과
     정확히 같은 문자열이어야 유형별 필터에 잡힙니다. (호텔은 label 첫 단어가 '호텔'이라 어긋났음) */
  var TYPE_TAGS = { sale: '매각', buy: '매입', lease: '임대', tr: 'TR', hotel: '호텔운영', finance: '금융', advisor: '자문사딜' };
  function tagOf(t) { return TYPE_TAGS[t.code] || String(t.label || '').split(' ')[0]; }
  /** 폼에 '물건명' 입력칸이 있는 유형인지 — 없는 유형(TR·매입·호텔·금융)에
      물건명을 요구하면 입력할 칸조차 없어 접수가 영구히 막힙니다. */
  function hasAssetField(t) {
    return (t.fields || []).some(function (f) { return f.k === 'asset'; });
  }
  function needAsset(t) {
    return (t.fields || []).some(function (f) { return f.k === 'asset' && f.req; });
  }

  function typeByCode(c) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].code === c) return TYPES[i];
    return null;
  }
  function typeIndexOf(c) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].code === c) return i;
    return 3;
  }
  function sectorLabel(v) {
    var hit = SECTORS.filter(function (o) { return o.v === v; })[0];
    return hit ? hit.l.split(' ')[0] : (v || '기타');
  }

  /* ─────────────────────── 입력 필드 렌더 ─────────────────────── */
  function fieldHTML(f, val) {
    var name = f.k;
    var input;
    var v = (val == null ? (f.v || '') : val);
    if (f.t === 'select') {
      input = '<select name="' + name + '">' + (f.opts || []).map(function (o) {
        return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(v) ? ' selected' : '') + '>' + esc(o.l) + '</option>';
      }).join('') + '</select>';
    } else if (f.t === 'textarea') {
      input = '<textarea name="' + name + '" rows="' + (f.rows || 3) + '" placeholder="' + esc(f.ph || '') + '">' + esc(v) + '</textarea>';
    } else {
      input = '<input name="' + name + '" type="text" value="' + esc(v) + '" placeholder="' + esc(f.ph || '') + '"' +
        (name === 'area' || name === 'rooms' ? ' inputmode="numeric"' : '') +
        (name === 'asset' ? ' list="hubAssetList"' : '') + '>';
    }
    return '<label class="tr-f' + (f.wide ? ' wide' : '') + '"><span>' + esc(f.l) + (f.req ? ' <b>*</b>' : '') + '</span>' + input + '</label>';
  }

  function assetOptionsHTML() {
    var st = window.naiMap && window.naiMap.state;
    var list = (st && st.assets ? st.assets : []).slice(0, 4000);
    return list.map(function (a) { return '<option value="' + esc(a.name) + '">' + esc((a.address || '') + ' · ' + sectorLabel(a.sector)) + '</option>'; }).join('');
  }

  function fieldsHTML(type, prefill) {
    var p = prefill || {};
    var h = '';
    type.fields.forEach(function (f) {
      h += fieldHTML(f, p[f.k]);
    });
    return h;
  }

  /* ───────────────────────── 허브 모달 ───────────────────────── */
  var HUB = { type: 'tr', prefill: null, mode: 'form' };
  var RESTRICT = { logi: false };

  function ensureHost() {
    var host = $('#hubModal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'hubModal';
      host.className = 'hub-modal hidden';
      document.body.appendChild(host);
    }
    return host;
  }

  function chipsHTML(active) {
    return TYPES.map(function (t, i) {
      var hide = RESTRICT.logi && ['sale', 'lease', 'tr'].indexOf(t.code) < 0;
      return '<button type="button" class="hub-type' + (hide ? ' hidden' : '') + '"' + (t.code === active ? ' on' : '') + '" data-hub-type="' + t.code + '">' +
        '<span class="ht-i">' + t.icon + '</span><span class="ht-n">' + (i + 1) + '</span>' +
        '<span class="ht-l">' + esc(t.short) + '</span></button>';
    }).join('');
  }

  function buildForm(type) {
    var t = typeByCode(type) || TYPES[3];
    var p = HUB.prefill || {};
    var h = '';
    h += '<div class="tr-head">';
    h += '<div><h3>' + t.icon + ' 딜·참여 등록 허브</h3>';
    h += '<p>매각·매입·임대·TR·호텔운영·금융·자문사딜 7가지 유형을 한 곳에서 등록합니다. 접수 내용은 담당자만 확인합니다.</p></div>';
    h += '<button type="button" class="tr-x" data-hub="close" aria-label="닫기">×</button>';
    h += '</div>';
    h += '<div class="hub-types">' + chipsHTML(t.code) + '</div>';
    h += '<div class="tr-scroll">';
    h += '<div class="hub-desc"><b>' + TYPES[typeIndexOf(t.code)].icon + ' ' + esc(t.label) + '</b><span>' + esc(t.desc) + '</span></div>';
    h += '<div class="tr-sec"><h4>① ' + esc(t.label.split(' ')[0]) + ' 조건</h4><div class="tr-grid">';
    h += fieldsHTML(t, { sector: p.sector, region: p.region, deal: p.deal, area: p.area, rent: p.rent, timeline: p.timeline, spec: p.spec, memo: p.memo, asset: p.asset });
    h += '</div>';
    var dl = hasAssetField(t) ? '<datalist id="hubAssetList">' + assetOptionsHTML() + '</datalist>' : '';
    h += dl + '</div>';
    h += '<div class="tr-sec"><h4>② 연락처</h4><div class="tr-grid">';
    var extUser = role() === 'external';
    h += '<label class="tr-f"><span>회사 <b>*</b></span><input name="company" type="text" value="' + esc(extUser ? ((me() && me().company) || '') : '') + '" placeholder="예) ㈜OO자산운용"></label>';
    h += '<label class="tr-f"><span>성명 <b>*</b></span><input name="name" type="text" value="' + esc(extUser ? ((me() && me().name) || '') : '') + '" placeholder="예) 홍길동"></label>';
    h += '<label class="tr-f"><span>직책</span><input name="title" type="text" value="' + esc(p.title || '') + '" placeholder="예) 투자본부 이사"></label>';
    h += '<label class="tr-f"><span>연락처 <b>*</b></span><input name="phone" type="tel" inputmode="tel" value="' + esc(p.phone || '') + '" placeholder="010-0000-0000"></label>';
    h += '<label class="tr-f wide"><span>이메일</span><input name="email" type="email" value="' + esc(p.email || '') + '" placeholder="name@company.com"></label>';
    h += '</div></div>';
    h += '<p class="tr-note">접수 내용은 비공개 시트 <b>lois</b>에 유형(<b>request_type</b>)과 함께 기록되며 담당자만 확인합니다. ' +
      '허위·중복 접수는 별도 안내 없이 정리될 수 있습니다.</p>';
    h += '<div class="tr-err hidden" id="hubErr"></div>';
    h += '</div>';
    h += '<div class="tr-actions">';
    h += '<button type="button" class="btn btn-outline" data-hub="list">📥 접수 목록</button>';
    h += '<span class="hub-spacer"></span>';
    h += '<button type="button" class="btn btn-outline" data-hub="close">취소</button>';
    h += '<button type="button" class="btn btn-primary" data-hub="submit" id="hubSubmit">' + esc(t.short) + ' 접수하기</button>';
    h += '</div>';
    return h;
  }

  function open(type, prefill) {
    if (!getToken()) { toast('접속(인증) 후 신청할 수 있습니다 — 우측 상단 🔑 버튼으로 접속하세요.', true); return; }
    HUB.type = typeByCode(type) ? type : 'tr';
    HUB.prefill = prefill || null;
    var host = ensureHost();
    host.innerHTML = '<div class="tr-card hub-card" role="dialog" aria-modal="true" aria-label="딜·참여 등록 허브">' + buildForm(HUB.type) + '</div>';
    host.classList.remove('hidden');
    bindHost(host);
    setTimeout(function () {
      var first = host.querySelector('.tr-scroll input');
      if (first) first.focus();
    }, 60);
  }

  function close() {
    var host = $('#hubModal');
    if (host) { host.classList.add('hidden'); host.classList.remove('is-full', 'mg-host', 'mg-max'); host.innerHTML = ''; }
    document.body.classList.remove('hub-full');
    DET.full = false;
    document.removeEventListener('keydown', escKey);
  }
  function escKey(e) { if (e.key === 'Escape') close(); }

  function bindHost(host) {
    document.removeEventListener('keydown', escKey);
    document.addEventListener('keydown', escKey);
    host.onclick = function (e) {
      if (e.target === host) { close(); return; }
      var t = e.target.closest('[data-hub-type]');
      if (t) { switchType(t.getAttribute('data-hub-type')); return; }
      var b = e.target.closest('[data-hub]');
      if (!b) return;
      var act = b.getAttribute('data-hub');
      if (act === 'close') close();
      else if (act === 'submit') submit(host);
      else if (act === 'list') openList();
    };
  }

  /** 유형 전환: 입력값(연락처·공통)을 유지한 채 조건부만 다시 그립니다 */
  function switchType(code) {
    var host = $('#hubModal');
    if (!host) return;
    var keep = {};
    ['company', 'name', 'title', 'phone', 'email'].forEach(function (k) {
      var el = host.querySelector('[name="' + k + '"]');
      if (el) keep[k] = el.value;
    });
    ['asset', 'memo', 'region', 'area', 'price', 'rent', 'timeline'].forEach(function (k) {
      var el = host.querySelector('[name="' + k + '"]');
      if (el && el.value) keep[k] = el.value;
    });
    HUB.prefill = keep;
    open(code, keep);
  }

  function val(host, name) {
    var el = host.querySelector('[name="' + name + '"]');
    return el ? String(el.value || '').trim() : '';
  }
  function err(host, msg) {
    var el = $('#hubErr', host);
    if (el) { el.textContent = msg; el.classList.toggle('hidden', !msg); }
    else toast(msg, true);
  }

  /** 희망 권역·물건명 → 권역 대표 좌표 (지도 TR 레이어와 같은 표) */
  function coordOf(v) {
    var rc = (window.NAI_TR_LAYER && window.NAI_TR_LAYER.resolveCoord) ? window.NAI_TR_LAYER.resolveCoord : null;
    if (!rc) return ['', ''];
    var hit = rc(String(v.region || '')) || rc(String(v.asset || '')) || null;
    return hit ? [hit[0], hit[1]] : ['', ''];
  }

  function collect(host, t) {
    var v = {};
    t.fields.forEach(function (f) { v[f.k] = val(host, f.k); });
    v.company = val(host, 'company');
    v.name = val(host, 'name');
    v.title = val(host, 'title');
    v.phone = val(host, 'phone');
    v.email = val(host, 'email');
    return v;
  }

  /** 유형별 상세 항목 → 메모(구조화 문자열) */
  function memoOf(t, v) {
    var parts = [];
    t.fields.forEach(function (f) {
      var raw = v[f.k];
      if (!raw) return;
      if (f.k === 'memo') return;
      var label = f.l.replace(/\s*\(.*\)\s*$/, '');
      var shown = raw;
      if (f.t === 'select' && f.opts) {
        var hit = f.opts.filter(function (o) { return String(o.v) === String(raw); })[0];
        if (hit) shown = hit.l;
      }
      parts.push(label + '=' + shown);
    });
    var out = parts.join(' | ');
    if (v.memo) out += (out ? ' | ' : '') + '메모=' + v.memo;
    return out + ' | 접수경로=웹 딜·참여 허브(' + t.short + ')';
  }

  function remember(v, t, title) {
    try {
      var list = JSON.parse(localStorage.getItem(MINE_KEY) || '[]');
      list.unshift({
        at: new Date().toISOString(), request_type: tagOf(t), asset_name: title,
        company: v.company, blind_name: v._blind || blindNameOf(v.company), name: v.name, phone: v.phone,
        price: v.price || v.amount || v.rent || '', status: '접수'
      });
      localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(0, 30)));
    } catch (e) { /* noop */ }
  }

  function submit(host) {
    var t = typeByCode(HUB.type) || TYPES[3];
    var v = collect(host, t);
    if (needAsset(t) && !v.asset) { err(host, '물건명을 입력하세요.'); return; }
    /* 필수 항목 공통 검증 — 예: 대출·금융주선의 '자격 증명(필수)' */
    var missing = (t.fields || []).filter(function (f) { return f.req && !v[f.k]; })[0];
    if (missing) { err(host, missing.l.replace(/\s*\(.*\)\s*$/, '') + '을(를) 입력하세요.'); return; }
    if (!v.company) { err(host, '회사명을 입력하세요.'); return; }
    if (!v.name) { err(host, '성명을 입력하세요.'); return; }
    if (String(v.phone).replace(/[^0-9]/g, '').length < 7) { err(host, '연락처를 정확히 입력하세요.'); return; }
    if (v.email && v.email.indexOf('@') < 0) { err(host, '이메일 형식을 확인하세요.'); return; }

    var title = t.title(v);
    var base = CFG.SYNC_URL;
    if (!base) { err(host, '서버 주소가 설정되지 않았습니다.'); return; }
    var btn = $('#hubSubmit', host);
    if (btn) { btn.disabled = true; btn.textContent = '접수 중…'; }
    err(host, '');

    var st = window.naiMap && window.naiMap.state;
    var hitAsset = null;
    if (v.asset && st && st.assets) {
      hitAsset = st.assets.filter(function (a) { return a.name === v.asset; })[0] || null;
    }

    var common = {
      asset_id: hitAsset ? hitAsset.id : (String(t.code).toUpperCase() + '-' + Date.now().toString(36)),
      asset_name: title,
      request_type: tagOf(t),
      request_code: t.code,
      deal_type: (v.deal || t.deal || '임차'),
      price: v.price || v.amount || '',
      area_py: v.area || v.rooms || '',
      rent: v.rent || v.rate || '',
      timeline: v.timeline || '',
      company: v.company, name: v.name, title: v.title, phone: v.phone, email: v.email,
      /* 비관리자 화면용 블라인드 업체명·권역 좌표 (서버가 관리자 외 권한에 이 값만 내려보냅니다) */
      blind_name: blindNameOf(v.company, t.code === 'tr' ? 'shipper' : ''),
      region: v.region || '',
      lat: coordOf(v)[0], lng: coordOf(v)[1],
      memo: '[' + tagOf(t) + '] ' + memoOf(t, v)
    };
    v._blind = common.blind_name;

    function fallback() {
      var lo = {};
      for (var k in common) if (Object.prototype.hasOwnProperty.call(common, k)) lo[k] = common[k];
      lo.deal_type = (common.deal_type === '매입') ? '매입' : '임차';
      lo.memo = '[유형=' + common.request_type + '] ' + common.memo;
      delete lo.request_type; delete lo.request_code;
      return fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: getToken(), action: 'submit_loi', loi: lo })
      }).then(function (r) { return r.json(); }).then(function (j) {
        return { ok: !!(j && j.ok), id: (j && j.id) || '', fallback: true, error: j && j.error };
      });
    }

    fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: getToken(), action: 'submit_request', request: common })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) return { ok: true, id: j.id, status: j.status, fallback: false };
      var e = String((j && j.error) || '');
      if (e === 'unknown_action' || e === 'bad_action' || e === 'not_found' || e === 'no_action') return fallback();
      return { ok: false, error: e || '알 수 없는 오류' };
    }).catch(function () {
      return fallback();
    }).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = t.short + ' 접수하기'; }
      if (!res || !res.ok) { err(host, '접수 실패: ' + ((res && res.error) || '네트워크 오류')); return; }
      remember(v, t, title);
      close();
      toast(t.short + ' 접수를 완료했습니다. 담당자가 검토 후 회신드립니다.');
      /* TR·매입은 지도 '수요 핀' 레이어와 같은 데이터입니다 — 켜져 있으면 새로 받아 반영 */
      if ((t.code === 'tr' || t.code === 'buy') && window.NAI_TR_LAYER) {
        try {
          if (!window.NAI_TR_LAYER.isOn || window.NAI_TR_LAYER.isOn()) window.NAI_TR_LAYER.refresh();
        } catch (e3) { /* noop */ }
      }
      if (window.naiMap && window.naiMap.log) {
        try { window.naiMap.log('hub_submit', t.short + ' · ' + title + ' · ' + v.company); } catch (e2) { /* noop */ }
      }
    });
  }

  /* ───────────────────────── 접수 목록 ───────────────────────── */
  function apiGet(type) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var url = base + (base.indexOf('?') < 0 ? '?' : '&') + 'type=' + encodeURIComponent(type) +
      '&token=' + encodeURIComponent(getToken());
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }

  var LIST = { items: [], filter: 'ALL', q: '', source: '' };

  function normType(row) {
    var t = String(row.request_type || '').trim();
    if (t) return t;
    var memo = String(row.memo || '');
    var m = memo.match(/^\[(?:유형=)?([^\]]+)\]/);
    if (m) return m[1].replace(/\s.*$/, '');
    if (/^TR-/.test(String(row.asset_id || ''))) return 'TR';
    return 'TR';
  }

  function typeChipsHTML() {
    var counts = {};
    LIST.items.forEach(function (r) { var k = normType(r); counts[k] = (counts[k] || 0) + 1; });
    var codes = ['매각', '매입', '임대', 'TR', '호텔운영', '금융', '자문사딜'];
    var h = '<button type="button" class="hub-fchip' + (LIST.filter === 'ALL' ? ' on' : '') + '" data-hub-filter="ALL">전체 <b>' + LIST.items.length + '</b></button>';
    codes.forEach(function (c) {
      h += '<button type="button" class="hub-fchip' + (LIST.filter === c ? ' on' : '') + '" data-hub-filter="' + esc(c) + '">' +
        esc(c) + ' <b>' + (counts[c] || 0) + '</b></button>';
    });
    return h;
  }

  function rowsForList() {
    var q = LIST.q.toLowerCase();
    return LIST.items.filter(function (r) {
      if (LIST.filter !== 'ALL' && normType(r) !== LIST.filter) return false;
      if (!q) return true;
      var hay = [r.asset_name, companyOf(r), r.name, r.phone, r.email, r.memo, r.price, r.area_py, r.owner].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function tableHTML() {
    var rows = rowsForList();
    if (!rows.length) return '<p class="hub-empty">조건에 맞는 접수 내역이 없습니다.</p>';
    var h = '<div class="hub-table-wrap"><table class="hub-table">' +
      '<colgroup><col class="c-date"><col class="c-type"><col><col class="c-company"><col class="c-who">' +
      '<col class="c-phone"><col class="c-cond"><col class="c-status"><col class="c-share"><col class="c-acts"></colgroup>' +
      '<thead><tr>' +
      '<th>일시</th><th>유형</th><th>대상</th><th>회사</th><th>요청자</th><th>연락처</th>' +
      '<th>금액 · 조건</th><th>상태</th><th>공유</th><th>관리</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var when = String(r.timestamp || r.at || '').replace('T', ' ').slice(0, 16);
      var id = String(r.id || '');
      var acts = '<button type="button" class="mini-btn" data-hub-open="' + esc(id) + '" title="접수 내용을 크게 봅니다">상세</button>' +
        (canModify(r)
          ? ' <button type="button" class="mini-btn" data-hub-edit="' + esc(id) + '" title="이 접수 건 수정">✏️</button>' +
            ' <button type="button" class="mini-btn danger" data-hub-del="' + esc(id) + '" title="이 접수 건 삭제">🗑️</button>'
          : '');
      h += '<tr class="hub-row" data-hub-open="' + esc(id) + '">' +
        '<td class="nowrap">' + esc(when) + '</td>' +
        '<td><span class="hub-tag t-' + esc(normType(r)) + '">' + esc(normType(r)) + '</span></td>' +
        '<td class="wide-cell"><b>' + esc(r.asset_name || '') + '</b>' +
        (r.memo ? '<span class="hub-memo">' + esc(String(r.memo).slice(0, 110)) + '</span>' : '') + '</td>' +
        '<td>' + companyCell(r) + '</td>' +
        '<td>' + requesterCell(r) + '</td>' +
        '<td class="nowrap">' + phoneCell(r) + '</td>' +
        '<td>' + esc([r.price, r.area_py, r.rent, r.timeline].filter(Boolean).join(' · ')) + '</td>' +
        '<td><span class="hub-st">' + esc(r.status || '접수') + '</span></td>' +
        '<td class="nowrap">' + shareCellHTML(r) + '</td>' +
        '<td class="nowrap"><span class="hub-acts">' + acts + '</span></td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  /** 접수 내역 엑셀 다운로드 (관리자) — 현재 유형·검색 조건 기준, 브라우저에서 생성 (2026-11-27) */
  function exportListXlsx() {
    if (!isAdmin()) { toast('접수 내역 다운로드는 관리자만 가능합니다.', true); return; }
    var rows = rowsForList();
    if (!rows.length) { toast('다운로드할 접수 내역이 없습니다.', true); return; }
    var data = rows.map(function (r) {
      var when = String(r.timestamp || r.at || '').replace('T', ' ').slice(0, 16);
      return {
        '접수일시': when,
        '유형': normType(r),
        '대상': r.asset_name || '',
        '회사': r.company || r.blind_name || '',
        '담당': [r.name, r.title].filter(Boolean).join(' '),
        '연락처': r.phone || '',
        '이메일': r.email || '',
        '금액·조건': [r.price, r.area_py, r.rent, r.timeline].filter(Boolean).join(' · '),
        '상태': r.status || '접수',
        '메모': String(r.memo || '').slice(0, 400)
      };
    });
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
    var fname = 'AssetBridge_접수내역_' + (LIST.filter === 'ALL' ? '전체유형' : LIST.filter) + '_' + stamp;
    try {
      if (window.XLSX && XLSX.utils && XLSX.writeFile) {
        var ws = XLSX.utils.json_to_sheet(data);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '접수내역');
        XLSX.writeFile(wb, fname + '.xlsx');
        toast(data.length + '건을 엑셀(.xlsx)로 저장했습니다.');
        return;
      }
    } catch (e) { /* CSV 대체 */ }
    var heads = Object.keys(data[0]);
    var esc2 = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var csv = '\ufeff' + heads.join(',') + '\n' + data.map(function (r) { return heads.map(function (h) { return esc2(r[h]); }).join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fname + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
    toast(data.length + '건을 CSV로 저장했습니다.');
  }

  /** PR(임차의뢰) 접수만 — 파트너·외부 임차현황 시스템 전달용 구조화 CSV (관리자) */
  function exportPrCsv() {
    if (!isAdmin()) { toast('PR 내보내기는 관리자만 가능합니다.', true); return; }
    var rows = LIST.items.filter(function (r) { return normType(r) === 'TR'; });
    if (!rows.length) { toast('PR(임차의뢰) 접수가 없습니다.', true); return; }
    var head = ['접수일시', '접수ID', '수요구분', '업체명(블라인드)', '희망권역', '희망면적', '예산·임대료', '입주시기', '상세스펙', '진행상태'];
    var esc2 = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var pick = function (memo, key) {
      var m = String(memo || '').match(new RegExp(key + '=([^|]+)'));
      return m ? m[1].trim() : '';
    };
    var lines = rows.map(function (r) {
      return [
        String(r.timestamp || r.at || '').replace('T', ' ').slice(0, 16),
        r.id || r.asset_id || '',
        r.request_type || 'TR',
        r.blind_name || '비공개 고객사',
        r.region || pick(r.memo, '희망 권역'),
        r.area_py || pick(r.memo, '희망 면적'),
        r.price || r.rent || pick(r.memo, '희망 임대료'),
        r.timeline || pick(r.memo, '입주 희망 시기'),
        pick(r.memo, '상세 스펙') || '',
        r.status || '접수'
      ].map(esc2).join(',');
    });
    var d = new Date();
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
    var csv = '\ufeff' + head.join(',') + '\n' + lines.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'AssetBridge_PR접수_' + stamp + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
    toast(rows.length + '건을 PR CSV로 저장했습니다. (발송·연동은 하지 않습니다)');
  }

  /** 공유 셀 — PR(임차의뢰) 이면서 공유 그룹(TFT)에 해당하는 건만 공유 버튼 (2026-11-27) */
  function shareCellHTML(r) {
    if (normType(r) !== 'TR') {
      return '<span class="hub-noshare" title="물건별·다른 유형 공유는 폐지 — PR(임차의뢰)만 공유">—</span>';
    }
    var gs = (window.NAI_TFT && window.NAI_TFT.groupsForRequest) ? window.NAI_TFT.groupsForRequest(r) : [];
    if (!gs.length) {
      var sec = (window.NAI_TFT && window.NAI_TFT.sectorOfRequest) ? window.NAI_TFT.sectorOfRequest(r) : '';
      return '<span class="hub-noshare" title="이 PR은 해당 섹터의 공유 그룹이 없습니다' + (sec ? ' (' + esc(sec) + ')' : '') + '">—</span>';
    }
    return '<button type="button" class="mini-btn hub-share" data-hub-share="' + esc(r.id || '') + '" ' +
      'title="' + esc(gs.map(function (g) { return g.name; }).join(', ')) + ' 에게 블라인드 기준으로 공유">📧 ' +
      esc(gs.map(function (g) { return g.name.replace(/ TFT$/, ' TFT'); }).join(' · ')) + ' 공유</button>';
  }

  /* ─────────────── 접수 상세 팝업 · 수정 · 삭제 (2026-11-28) ─────────────── */
  var DET = { id: '', full: false };

  function rowById(id) {
    for (var i = 0; i < LIST.items.length; i++) {
      if (String(LIST.items[i].id) === String(id)) return LIST.items[i];
    }
    return null;
  }
  function memoLines(memo) {
    return String(memo || '').split('|').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function memoPrefix(memo) {
    var m = String(memo || '').match(/^\s*(\[(?:유형=)?[^\]]+\])\s*/);
    return m ? m[1] : '';
  }
  function memoBody(memo) {
    return String(memo || '').replace(/^\s*\[(?:유형=)?[^\]]+\]\s*/, '');
  }
  function hdField(label, value) {
    return '<div class="hd-f"><span>' + esc(label) + '</span><b>' + (value === '' || value == null ? '—' : value) + '</b></div>';
  }

  function detailHTML(row) {
    var t = normType(row);
    var masked = requesterMasked(row) && !isAdmin();
    var when = String(row.timestamp || row.at || '').replace('T', ' ').slice(0, 16);
    var lines = memoLines(memoBody(row.memo));
    var h = '';
    h += '<div class="tr-head"><div><h3>' + esc(t) + ' 접수 상세</h3>' +
      '<p>' + esc(row.asset_name || '제목 없음') + (when ? ' · 접수 ' + esc(when) : '') +
      (row.id && String(row.id).indexOf('local-') !== 0 ? ' · ID ' + esc(row.id) : '') + '</p></div>' +
      '<button type="button" class="tr-x hub-full" data-hub-full="1" aria-label="전체 화면으로 보기" title="전체 화면 (카드 더블클릭)">⤢</button>' +
      '<button type="button" class="tr-x" data-hub="close" aria-label="닫기">×</button></div>';
    h += '<div class="tr-scroll hub-detail">';
    h += '<div class="hd-grid">';
    h += hdField('유형', '<span class="hub-tag t-' + esc(t) + '">' + esc(t) + '</span>');
    h += hdField('진행 상태', esc(row.status || '접수'));
    h += hdField('회사', companyCell(row));
    h += hdField('요청자', masked ? '<span class="hub-blind">🔒 비공개</span>' : esc(personOf(row) || '—'));
    h += hdField('직책', masked ? '<span class="hub-blind">🔒 비공개</span>' : esc(row.title || ''));
    h += hdField('연락처', phoneCell(row) || '—');
    h += hdField('이메일', masked ? '<span class="hub-blind">🔒 비공개</span>' : esc(row.email || ''));
    h += hdField('권역 · 지역', esc(row.region || ''));
    if (row.area_py) h += hdField('면적(평)', esc(row.area_py));
    if (row.price) h += hdField('예산 · 금액', esc(row.price));
    if (row.rent) h += hdField('임대료 · 금리', esc(row.rent));
    if (row.timeline) h += hdField('희망 시기', esc(row.timeline));
    if (row.owner) h += hdField('담당', esc(ownerLabel(row)));
    h += '</div>';
    if (lines.length) {
      h += '<div class="hd-memo"><b>접수 내용</b><ul>' +
        lines.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    }
    /* 🧠 매칭 검토 현황 — 접수 화면 안에서 후보·승인·담당자를 바로 확인 (2026-11-28) */
    if (isAdmin() && window.NAI_TRREVIEW && window.NAI_TRREVIEW.summaryFor) {
      try { h += window.NAI_TRREVIEW.summaryFor(row); } catch (e) { /* noop */ }
    }
    h += '</div>';
    h += '<div class="tr-actions">';
    h += '<button type="button" class="btn btn-outline" data-hub="list">← 접수 목록</button>';
    h += '<span class="hub-spacer"></span>';
    if (canModify(row)) {
      h += '<button type="button" class="btn btn-outline" data-hub-edit="' + esc(row.id) + '">✏️ 수정</button>';
      h += '<button type="button" class="btn btn-outline danger" data-hub-del="' + esc(row.id) + '">🗑️ 삭제</button>';
    }
    h += '<button type="button" class="btn btn-primary" data-hub="close">닫기</button>';
    h += '</div>';
    return h;
  }

  function openDetail(id) {
    var row = rowById(id);
    if (!row) { toast('접수 건을 찾지 못했습니다. 목록을 새로고쳤습니다.', true); openList(); return; }
    DET.id = String(id); DET.full = false;
    var host = ensureHost();
    host.classList.remove('is-full', 'mg-host');
    host.innerHTML = '<div class="tr-card hub-card hub-detail-card" role="dialog" aria-modal="true" aria-label="접수 상세">' +
      detailHTML(row) + '</div>';
    host.classList.remove('hidden');
    bindDetail(host);
  }

  function bindDetail(host) {
    document.removeEventListener('keydown', escKey);
    document.addEventListener('keydown', escKey);
    var card = host.querySelector('.hub-detail-card');
    host.onclick = function (e) {
      if (e.target === host) { close(); return; }          /* 바깥 클릭 = 닫기 (기존과 같은 동작) */
      if (e.target.closest('[data-hub-full]')) { toggleFull(); return; }
      var ed = e.target.closest('[data-hub-edit]');
      if (ed) { openEdit(ed.getAttribute('data-hub-edit')); return; }
      var dl = e.target.closest('[data-hub-del]');
      if (dl) { removeRequest(dl.getAttribute('data-hub-del')); return; }
      var b = e.target.closest('[data-hub]');
      if (b && b.getAttribute('data-hub') === 'list') openList();
    };
    /* 더블클릭 = 전체 화면 ↔ 원래 크기 (버튼·입력칸 위는 제외) */
    if (card) card.addEventListener('dblclick', function (e) {
      if (e.target.closest('input, textarea, select, button, a, label')) return;
      toggleFull();
    });
  }

  function toggleFull(force) {
    var host = $('#hubModal');
    var card = host && host.querySelector('.hub-detail-card');
    if (!card) return;
    DET.full = (force == null) ? !DET.full : !!force;
    card.classList.toggle('is-full', DET.full);
    host.classList.toggle('is-full', DET.full);
    document.body.classList.toggle('hub-full', DET.full);
    var b = card.querySelector('[data-hub-full]');
    if (b) {
      b.textContent = DET.full ? '⤡' : '⤢';
      b.setAttribute('aria-label', DET.full ? '원래 크기로 보기' : '전체 화면으로 보기');
      b.title = DET.full ? '원래 크기로 (카드 더블클릭)' : '전체 화면 (카드 더블클릭)';
    }
  }

  /* ── 수정 폼 ── */
  var STATUS_OPTS = ['접수', '검토중', '진행', '종결', '완료', '보류'];
  var TYPE_OPTS = ['매각', '매입', '임대', 'TR', '호텔운영', '금융', '자문사딜'];
  /** 현재 값이 목록에 없으면 맨 앞에 넣어 저장 시 값이 바뀌지 않게 합니다 */
  function optsWith(list, cur) {
    var v = String(cur == null ? '' : cur).trim();
    if (!v) return list.slice();
    return list.indexOf(v) >= 0 ? list.slice() : [v].concat(list);
  }

  function optHTML(list, sel) {
    return list.map(function (v) {
      return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }
  function editField(label, name, value, opts) {
    opts = opts || {};
    var input;
    if (opts.type === 'select') input = '<select name="' + name + '">' + optHTML(opts.list, value) + '</select>';
    else if (opts.type === 'textarea') input = '<textarea name="' + name + '" rows="4">' + esc(value || '') + '</textarea>';
    else input = '<input name="' + name + '" type="text" value="' + esc(value || '') + '"' +
      (opts.numeric ? ' inputmode="numeric"' : '') + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + '>';
    return '<label class="tr-f' + (opts.wide ? ' wide' : '') + '"><span>' + esc(label) + '</span>' + input + '</label>';
  }

  function openEdit(id) {
    var row = rowById(id);
    if (!row) return;
    if (!canModify(row)) { toast('본인이 등록한 접수 건 또는 관리자만 수정할 수 있습니다.', true); return; }
    DET.id = String(id);
    var masked = requesterMasked(row) && !isAdmin();
    var h = '<div class="tr-head"><div><h3>✏️ 접수 건 수정</h3>' +
      '<p>' + esc(normType(row)) + ' · ' + esc(row.asset_name || '') + '</p></div>' +
      '<button type="button" class="tr-x" data-hub="close" aria-label="닫기">×</button></div>';
    h += '<div class="tr-scroll">';
    h += '<div class="tr-sec"><h4>접수 내용</h4><div class="tr-grid">';
    h += editField('유형', 'e_type', normType(row), { type: 'select', list: optsWith(TYPE_OPTS, normType(row)) });
    h += editField('진행 상태', 'e_status', row.status || '접수', { type: 'select', list: optsWith(STATUS_OPTS, row.status || '접수') });
    h += editField('물건 · 대상', 'e_name', row.asset_name || '', { wide: true });
    h += editField('지역 · 권역', 'e_region', row.region || '');
    h += editField('면적(평)', 'e_area', row.area_py || '', { numeric: true });
    h += editField('예산 · 금액', 'e_price', row.price || '');
    h += editField('임대료 · 금리', 'e_rent', row.rent || '');
    h += editField('연락처', 'e_phone', masked ? '' : (row.phone || ''), { ph: masked ? '비공개 — 새로 입력하면 갱신됩니다' : '010-0000-0000' });
    h += editField('접수 내용 · 메모', 'e_memo', memoBody(row.memo), { type: 'textarea', wide: true });
    h += '</div></div>';
    h += '<p class="tr-note">수정 이력은 접근·감사 로그에 남습니다(누가 · 언제 · 무엇을). ' +
      '완료·보류로 바꾼 건도 목록에서 바로 확인할 수 있습니다.</p>';
    h += '<div class="tr-err hidden" id="hubEditErr"></div>';
    h += '</div>';
    h += '<div class="tr-actions">' +
      '<button type="button" class="btn btn-outline" data-hub-open="' + esc(id) + '">← 상세로</button>' +
      '<span class="hub-spacer"></span>' +
      '<button type="button" class="btn btn-outline" data-hub="list">목록</button>' +
      '<button type="button" class="btn btn-primary" data-hub-save="' + esc(id) + '" id="hubEditSave">저장</button></div>';
    var host = ensureHost();
    host.classList.remove('is-full', 'mg-host');
    host.innerHTML = '<div class="tr-card hub-card" role="dialog" aria-modal="true" aria-label="접수 건 수정">' + h + '</div>';
    host.classList.remove('hidden');
    bindEdit(host);
  }

  function bindEdit(host) {
    document.removeEventListener('keydown', escKey);
    document.addEventListener('keydown', escKey);
    host.onclick = function (e) {
      if (e.target === host) { close(); return; }
      var sv = e.target.closest('[data-hub-save]');
      if (sv) { saveEdit(sv.getAttribute('data-hub-save')); return; }
      var op = e.target.closest('[data-hub-open]');
      if (op) { openDetail(op.getAttribute('data-hub-open')); return; }
      var b = e.target.closest('[data-hub]');
      if (!b) return;
      var act = b.getAttribute('data-hub');
      if (act === 'close') close();
      else if (act === 'list') openList();
    };
  }

  function editErr(host, msg) {
    var el = $('#hubEditErr', host);
    if (el) { el.textContent = msg; el.classList.toggle('hidden', !msg); }
    else toast(msg, true);
  }

  /** 서버 액션 — request_update / request_delete. 서버가 아직 모르는 액션이면 local:true 로 알려 줍니다. */
  function postRequestAction(action, id, patch) {
    var base = CFG.SYNC_URL;
    if (!base || !getToken()) return Promise.resolve({ ok: true, server: false, error: 'no_sync' });
    return fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: getToken(), action: action, id: id, request: patch || {} })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) return { ok: true, server: true, item: j.item || null };
      var e = String((j && j.error) || '');
      /* 삭제 대상이 이미 서버에 없으면(not_found) 삭제된 것으로 봅니다 */
      if (action === 'request_delete' && e === 'not_found') return { ok: true, server: true, error: '' };
      if (/unknown|bad_action|no_action|unsupported/.test(e)) return { ok: true, server: false, error: e };
      return { ok: false, server: true, error: e || '알 수 없는 오류' };
    }).catch(function () { return { ok: true, server: false, error: 'network' }; });
  }

  function auditRequest(action, row, note) {
    try {
      if (window.naiMap && window.naiMap.log) {
        var who = me() || {};
        window.naiMap.log(action,
          [row.id || '', normType(row), String(row.asset_name || '').slice(0, 60),
            (who.name || who.company || '')].filter(Boolean).join(' · ') + (note || ''));
      }
    } catch (e) { /* 로그 실패는 화면과 무관 */ }
  }

  function applyRowPatch(row, patch) {
    Object.keys(patch).forEach(function (k) {
      if (patch[k] !== undefined) row[k] = patch[k];
    });
    row._edited = true;
  }

  /** 이 브라우저에 남긴 내 접수 내역(MINE_KEY) 갱신 */
  function syncMine(id, row, patch, remove) {
    try {
      var list = JSON.parse(localStorage.getItem(MINE_KEY) || '[]');
      if (!Array.isArray(list)) return;
      var next = list.filter(function (r, i) {
        var match = String(r.id || '') === String(id) ||
          (row && r.at && String(r.at) === String(row.at));
        if (!match) return true;
        if (remove) return false;
        if (patch) Object.keys(patch).forEach(function (k) { if (patch[k] !== undefined) r[k] = patch[k]; });
        return true;
      });
      localStorage.setItem(MINE_KEY, JSON.stringify(next.slice(0, 60)));
    } catch (e) { /* noop */ }
  }

  /* ─────────── 삭제 표시(이 브라우저) — 2026-11-28 ───────────
     서버(Apps Script)가 아직 request_delete 를 모르면 삭제는 '이 브라우저에만' 적용됩니다.
     그런데 LIST 를 다시 불러올 때마다 서버 목록이 그대로 와서 지운 행이 되살아났고
     ("삭제가 안 된다" 증상), 그때마다 '서버 미반영' 토스트가 떠서 실패처럼 보였습니다.
     지운 id 를 이 브라우저에 남겨 두어 다시 불러와도 목록에 나오지 않게 합니다.
     (id 가 없는 행은 절대 숨기지 않습니다 — 다른 접수 건이 함께 사라지면 안 됩니다.) */
  var DEL_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':hub:deleted:v1';
  function deletedIds() {
    try {
      var a = JSON.parse(localStorage.getItem(DEL_KEY) || '[]');
      return Array.isArray(a) ? a.map(String).filter(Boolean) : [];
    } catch (e) { return []; }
  }
  function markDeleted(id) {
    var sid = String(id || '').trim();
    if (!sid) return;
    var list = deletedIds().filter(function (x) { return x !== sid; });
    list.push(sid);
    try { localStorage.setItem(DEL_KEY, JSON.stringify(list.slice(-300))); } catch (e) { /* noop */ }
  }
  /** 목록에서 지운 행을 걸러 냅니다(서버가 다시 내려줘도 되살아나지 않도록). */
  function withoutDeleted(rows) {
    var arr = (rows || []).slice();
    var del = deletedIds();
    if (!del.length) return arr;
    return arr.filter(function (r) {
      var id = String((r && r.id) || '').trim();
      return !id || del.indexOf(id) < 0;
    });
  }

  function saveEdit(id) {
    var host = $('#hubModal');
    var row = rowById(id);
    if (!host || !row) return;
    if (!canModify(row)) { toast('수정 권한이 없습니다.', true); return; }
    var q = function (n) { var el = host.querySelector('[name="' + n + '"]'); return el ? String(el.value || '').trim() : ''; };
    var patch = {
      request_type: q('e_type'),
      asset_name: q('e_name'),
      region: q('e_region'),
      area_py: q('e_area'),
      price: q('e_price'),
      rent: q('e_rent'),
      status: q('e_status'),
      memo: (memoPrefix(row.memo) ? memoPrefix(row.memo) + ' ' : '') + q('e_memo')
    };
    var phone = q('e_phone');
    if (phone) patch.phone = phone;
    if (!patch.asset_name) { editErr(host, '물건 · 대상을 입력하세요.'); return; }
    if (phone && digitsOf(phone).length < 7) { editErr(host, '연락처를 정확히 입력하세요.'); return; }
    var btn = $('#hubEditSave', host);
    if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
    editErr(host, '');
    postRequestAction('request_update', id, patch).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = '저장'; }
      if (!res.ok) {
        editErr(host, /unauthor|forbidden|perm/.test(res.error || '') ? '수정 권한이 없습니다. (본인 또는 관리자)' : '수정에 실패했습니다: ' + res.error);
        return;
      }
      applyRowPatch(row, patch);
      if (row._local) syncMine(id, row, patch, false);
      auditRequest('request_update', row, res.server ? '' : ' (서버 미반영)');
      if (res.server) {
        toast('접수 건을 수정했습니다.');
        DET.id = String(id);
        openDetail(id);
        loadList();
      } else {
        toast('이 브라우저에만 저장했습니다 — 서버 반영은 Apps Script 패치 후 가능합니다.', true);
        DET.id = String(id);
        openDetail(id);
        renderListBody();
      }
    });
  }

  function removeRequest(id) {
    var sid = String(id || '').trim();
    if (!sid) {
      /* id 없는 행을 빈 문자열로 지우면 다른 접수 건까지 함께 사라질 수 있어 막습니다 */
      toast('삭제할 접수 건의 고유 ID가 없습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.', true);
      return;
    }
    var row = rowById(sid);
    if (!row) { toast('접수 건을 찾지 못했습니다.', true); return; }
    if (!canModify(row)) { toast('본인이 등록한 접수 건 또는 관리자만 삭제할 수 있습니다.', true); return; }
    var nm = String(row.asset_name || '').slice(0, 80);
    if (!window.confirm('이 접수 건을 삭제할까요?\n\n' + nm + '\n\n삭제 후에는 되돌릴 수 없습니다.')) return;
    postRequestAction('request_delete', sid, null).then(function (res) {
      if (!res.ok) {
        toast(/unauthor|forbidden|perm/.test(res.error || '') ? '삭제 권한이 없습니다. (본인 또는 관리자)' : '삭제하지 못했습니다: ' + res.error, true);
        return;
      }
      /* 화면·이 브라우저 목록에서 즉시 제거 (2026-11-28)
         서버가 아직 request_delete 를 모르는 경우(unknown_action)에는 목록을 다시 불러올 때
         서버 목록이 그대로 와서 지운 행이 되살아났습니다. 지운 id 를 남겨 다시 나오지 않게 합니다. */
      LIST.items = LIST.items.filter(function (r) { return String(r.id || '') !== sid; });
      if (row._local) syncMine(sid, row, null, true);
      else if (!res.server) markDeleted(sid);
      auditRequest('request_delete', row, res.server ? '' : ' (서버 미반영)');
      DET.id = '';
      openList();   /* 목록 새로 고침 — 삭제 표시 덕분에 다시 불러와도 되살아나지 않습니다 */
      /* 실패한 이유를 구분해 알립니다 — 연결 실패와 '서버가 아직 모르는 액션'은 대응이 다릅니다 */
      var why = String(res.error || '');
      toast(res.server ? '접수 건을 삭제했습니다.'
        : (/network|no_sync/.test(why)
          ? '목록에서 삭제했습니다. 서버에 연결하지 못해 비공개 시트(lois)에는 아직 반영되지 않았습니다.'
          : '목록에서 삭제했습니다. 비공개 시트(lois)에는 서버 배포 후 반영됩니다.'));
    }).catch(function () { toast('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', true); });
  }

  function renderListBody() {    var body = $('#hubListBody');
    if (!body) return;
    $$('[data-hub-filter]', body.parentNode).length; /* noop */
    var chips = $('#hubListChips');
    if (chips) chips.innerHTML = typeChipsHTML();
    var cnt = $('#hubListCount');
    if (cnt) cnt.textContent = rowsForList().length + '건 / 전체 ' + LIST.items.length + '건';
    body.innerHTML = tableHTML();
  }

  function openList() {
    var host = ensureHost();
    DET.full = false;
    host.classList.remove('is-full', 'mg-host', 'mg-max');
    document.body.classList.remove('hub-full');
    if (!host || host.classList.contains('hidden')) {
      host.innerHTML = '<div class="tr-card hub-card hub-list-card" role="dialog" aria-modal="true" aria-label="접수 목록">' + listShellHTML() + '</div>';
      host.classList.remove('hidden');
      bindHost(host);
    } else {
      var card = host.querySelector('.tr-card');
      if (card) card.innerHTML = listShellHTML();
    }
    /* 창 확대 — 목록도 더블클릭·⤢ 로 (2026-11-28) */
    if (window.OAAB_GROW) {
      var lc = host.querySelector('.tr-card');
      if (lc) window.OAAB_GROW.attach(lc, { head: '.tr-head' });
    }
    bindList();
    loadList();
  }

  function listShellHTML() {
    return '<div class="tr-head"><div><h3>📥 접수 목록</h3>' +
      '<p>딜·참여 등록 허브로 접수된 내역입니다. 유형별로 걸러 보고 검색할 수 있습니다.' +
      ' <b>행을 누르면</b> 접수 내용이 팝업으로 크게 열리고(더블클릭 = 전체 화면), 본인·관리자는 그 자리에서 수정·삭제할 수 있습니다.' +
      (isAdmin() ? ' <b>관리자</b> 권한에서는 업체명·요청자 원문이 보입니다.' : ' 업체명은 <b>🔒 블라인드</b>, TR 요청자·연락처는 <b>🔒 비공개</b>로 표시됩니다.') + '</p></div>' +
      '<button type="button" class="tr-x" data-hub="close" aria-label="닫기">×</button></div>' +
      '<div class="hub-list-tools"><div id="hubListChips" class="hub-fchips"></div>' +
      '<input id="hubListQ" type="search" data-enter="search" placeholder="물건 · 회사 · 담당 · 연락처 검색" autocomplete="off">' +
      '<span id="hubListCount" class="hub-count">불러오는 중…</span>' +
      (isAdmin() ? '<button type="button" class="mini-btn" data-hub="xlsx" title="현재 유형·검색 조건의 접수 내역을 엑셀로 저장">📥 엑셀 다운로드</button>' : '') +
      (isAdmin() ? '<button type="button" class="mini-btn" data-hub="pr-csv" title="PR(임차의뢰) 접수만 파트너 전달용 CSV로 저장">📤 PR CSV</button>' : '') +
      (isAdmin() ? '<button type="button" class="mini-btn" data-hub="review" title="접수 → AI 후보 → 관리자 승인 → 담당자 연결 → 요청자 전달">🧠 매칭 검토</button>' : '') +
      '<button type="button" class="mini-btn" data-hub="form">＋ 새 등록</button></div>' +
      '<div class="tr-scroll" id="hubListBody"><p class="hub-empty">불러오는 중…</p></div>';
  }

  function bindList() {
    var host = $('#hubModal');
    if (!host) return;
    host.onclick = function (e) {
      if (e.target === host) { close(); return; }
      var sh = e.target.closest('[data-hub-share]');
      if (sh) { openShare(sh.getAttribute('data-hub-share')); return; }
      var ed = e.target.closest('[data-hub-edit]');
      if (ed) { openEdit(ed.getAttribute('data-hub-edit')); return; }
      var dl = e.target.closest('[data-hub-del]');
      if (dl) { removeRequest(dl.getAttribute('data-hub-del')); return; }
      var op = e.target.closest('[data-hub-open]');
      if (op) { openDetail(op.getAttribute('data-hub-open')); return; }
      var f = e.target.closest('[data-hub-filter]');
      if (f) { LIST.filter = f.getAttribute('data-hub-filter'); renderListBody(); return; }
      var b = e.target.closest('[data-hub]');
      if (!b) return;
      var act = b.getAttribute('data-hub');
      if (act === 'close') close();
      else if (act === 'form') open(HUB.type, HUB.prefill);
      else if (act === 'review') { if (window.NAI_TRREVIEW) window.NAI_TRREVIEW.open(); }
      else if (act === 'xlsx') exportListXlsx();
      else if (act === 'pr-csv') exportPrCsv();
    };
    var q = $('#hubListQ');
    if (q) {
      q.addEventListener('input', function () { LIST.q = q.value; renderListBody(); });
      q.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        e.stopPropagation();
        LIST.q = q.value;
        renderListBody();
        if (window.innerWidth <= 900) q.blur();   // 모바일: 키보드를 닫아 결과를 보여줍니다
      });
    }
    /* 재렌더 후에도 검색어 유지 */
    if (q) q.value = LIST.q;
  }

  function loadList() {
    var body = $('#hubListBody');
    function paint() {
      var chips = $('#hubListChips');
      if (chips) chips.innerHTML = typeChipsHTML();
      var cnt = $('#hubListCount');
      if (cnt) cnt.textContent = rowsForList().length + '건 / 전체 ' + LIST.items.length + '건';
      body.innerHTML = LIST.items.length ? tableHTML() :
        '<p class="hub-empty">아직 접수한 내역이 없습니다. <b>＋ 새 등록</b>으로 첫 건을 등록해 보세요.</p>';
    }
    function localRender(note) {
      LIST.items = withoutDeleted(JSON.parse(localStorage.getItem(MINE_KEY) || '[]'));
      /* 이 브라우저에서 접수한 건 — 등록자 본인 확인용 표시 */
      LIST.items.forEach(function (r, i) { r._local = true; if (!r.id) r.id = 'local-' + i + '-' + String(r.at || '').slice(-6); });
      LIST.source = note || 'local';
      paint();
      body.innerHTML += '<p class="hub-foot">' + (note === 'server' ? '비공개 시트 <b>lois</b> 기준.' : '이 브라우저에서 제출한 내역입니다.') + '</p>';
    }
    /* 서버 접수 목록 — 관리자=원문, 그 외 권한=업체명 블라인드(서버가 마스킹해 내려줍니다) */
    apiGet('requests').then(function (j) {
      if (j && j.ok && j.items && j.items.length) {
        LIST.items = withoutDeleted(j.items);
        LIST.source = 'server';
        paint();
        body.innerHTML += '<p class="hub-foot">비공개 시트 <b>lois</b> 기준 · 유형은 <b>request_type</b> 컬럼으로 구분합니다.' +
          (isAdmin() ? '' : ' 업체명은 관리자만 볼 수 있어 <b>블라인드</b>로 표시되고, TR 요청자·연락처는 이 TR 을 등록한 본인과 관리자만 볼 수 있습니다.') + '</p>';
        return;
      }
      if (!isAdmin()) { localRender('local'); return; }
      /* 새 조회 API 가 없으면 기존 lois 조회로 대체 */
      return apiGet('lois').then(function (j2) {
        if (j2 && j2.ok && j2.items) {
          LIST.items = withoutDeleted(j2.items);
          LIST.source = 'server-lois';
          paint();
          body.innerHTML += '<p class="hub-foot">비공개 시트 <b>lois</b> 기준(기존 조회 API).</p>';
          return;
        }
        localRender('local');
      });
    }).catch(function () { localRender('local'); });
  }

  /** 물류TF 제한 — 매각·임대·TR 3종만 노출 */
  function restrict(mode) {
    if (mode !== 'logi') return;
    RESTRICT.logi = true;
    var host = $('#hubModal');
    if (host) $$('[data-hub-type]', host).forEach(function (b) {
      var c = b.getAttribute('data-hub-type');
      if (['sale', 'lease', 'tr'].indexOf(c) < 0) b.classList.add('hidden');
    });
  }

  window.NAI_HUB = { open: open, close: close, openList: openList, TYPES: TYPES, restrict: restrict };
  /* 기존 호출부(홈 타일·AI 매칭 버튼) 호환 */
  window.NAI_TR = { open: function (p) { open('tr', p); }, close: close };
})();
