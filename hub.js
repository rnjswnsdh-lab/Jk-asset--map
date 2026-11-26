/* =========================================================================
   Open AI Asset Bridge — hub.js  (📝 딜·참여 등록 허브, 2026-11-24)
   -------------------------------------------------------------------------
   기존 📋 TR 임차의뢰 단일 모달을 6가지 유형을 받는 참여 허브로 확장했습니다.

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
      desc: '희망 조건을 남기면 NAI Korea 가 보유 물건 · 매각·LM 물건 · 외부 매물 중 부합 후보를 찾아 회신합니다. (Tenant Request)',
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
      code: 'finance', short: '대출·금융', icon: '🏦', label: '대출 / 금융 PR (금리·LTV·조건)',
      desc: '증권사·금융기관의 대출 조건(금리·LTV·만기·트랑슈)을 제시합니다. NAI 딜 파이프라인과 매칭합니다.',
      deal: '매입',
      fields: [
        { k: 'asset', l: '대상 사업 · 물건', wide: true, ph: '예) 오피스 매입 1,000억 / 물류센터 개발PF' },
        { k: 'finType', l: '금융 유형', t: 'select', opts: [
          { v: '선순위', l: '선순위 담보대출' }, { v: '중순위·메자닌', l: '중순위 · 메자닌' },
          { v: '브릿지', l: '브릿지론' }, { v: '개발PF', l: '개발 PF' }, { v: '리파이낸싱', l: '리파이낸싱' }
        ], v: '선순위' },
        { k: 'amount', l: '대출 가능 금액', ph: '예) 600억원 ~ 900억원' },
        { k: 'ltv', l: 'LTV', ph: '예) 60~65%' },
        { k: 'rate', l: '금리', ph: '예) 4.3~4.8% (3년 고정)' },
        { k: 'maturity', l: '만기 · 연장', ph: '예) 5년 (1년 연장옵션)' },
        { k: 'tranche', l: '트랑슈 · 조건', wide: true, ph: '예) 선순위 only, DSCR 1.25x 이상, 임대율 90% 이상' },
        { k: 'memo', l: '비고', t: 'textarea', wide: true, rows: 2, ph: '취급 가능 지역·자산군, 심사 소요기간, 수수료 등' }
      ],
      title: function (v) { return '[금융] ' + (v.finType || '대출') + ' · ' + (v.asset || '대상 미정') + (v.amount ? ' · ' + v.amount : ''); }
    }
  ];

  /* 접수 유형 라벨 — 목록 필터 칩(['매각','매입','임대','TR','호텔운영','금융'])과
     정확히 같은 문자열이어야 유형별 필터에 잡힙니다. (호텔은 label 첫 단어가 '호텔'이라 어긋났음) */
  var TYPE_TAGS = { sale: '매각', buy: '매입', lease: '임대', tr: 'TR', hotel: '호텔운영', finance: '금융' };
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
    h += '<p>매각·매입·임대·TR·호텔운영·금융 6가지 유형을 한 곳에서 등록합니다. 접수 내용은 담당자만 확인합니다.</p></div>';
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
    h += '<label class="tr-f"><span>회사 <b>*</b></span><input name="company" type="text" value="' + esc((me() && me().company) || '') + '" placeholder="예) ㈜OO자산운용"></label>';
    h += '<label class="tr-f"><span>성명 <b>*</b></span><input name="name" type="text" value="' + esc(role() === 'internal' ? '' : ((me() && me().name) || '')) + '" placeholder="예) 홍길동"></label>';
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
    if (host) { host.classList.add('hidden'); host.innerHTML = ''; }
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
    var codes = ['매각', '매입', '임대', 'TR', '호텔운영', '금융'];
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
      var hay = [r.asset_name, companyOf(r), r.name, r.phone, r.email, r.memo, r.price, r.area_py].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function tableHTML() {
    var rows = rowsForList();
    if (!rows.length) return '<p class="hub-empty">조건에 맞는 접수 내역이 없습니다.</p>';
    var h = '<div class="hub-table-wrap"><table class="hub-table"><thead><tr>' +
      '<th>일시</th><th>유형</th><th>대상</th><th>회사</th><th>담당</th><th>연락처</th>' +
      '<th>금액 · 조건</th><th>상태</th><th>공유</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var when = String(r.timestamp || r.at || '').replace('T', ' ').slice(0, 16);
      h += '<tr>' +
        '<td class="nowrap">' + esc(when) + '</td>' +
        '<td><span class="hub-tag t-' + esc(normType(r)) + '">' + esc(normType(r)) + '</span></td>' +
        '<td class="wide-cell"><b>' + esc(r.asset_name || '') + '</b>' +
        (r.memo ? '<span class="hub-memo">' + esc(String(r.memo).slice(0, 160)) + '</span>' : '') + '</td>' +
        '<td>' + companyCell(r) + '</td>' +
        '<td>' + esc([personOf(r), r.title].filter(Boolean).join(' ')) + '</td>' +
        '<td class="nowrap">' + esc(r.phone || '') + '</td>' +
        '<td>' + esc([r.price, r.area_py, r.rent, r.timeline].filter(Boolean).join(' · ')) + '</td>' +
        '<td><span class="hub-st">' + esc(r.status || '접수') + '</span></td>' +
        '<td class="nowrap"><button type="button" class="mini-btn hub-share" data-hub-share="' + esc(r.id || '') + '" title="블라인드 기준으로 파트너에게 메일 공유">📧</button></td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  function renderListBody() {
    var body = $('#hubListBody');
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
    if (!host || host.classList.contains('hidden')) {
      host.innerHTML = '<div class="tr-card hub-card" role="dialog" aria-modal="true" aria-label="접수 목록">' + listShellHTML() + '</div>';
      host.classList.remove('hidden');
      bindHost(host);
    } else {
      var card = host.querySelector('.tr-card');
      if (card) card.innerHTML = listShellHTML();
    }
    bindList();
    loadList();
  }

  function listShellHTML() {
    return '<div class="tr-head"><div><h3>📥 접수 목록</h3>' +
      '<p>딜·참여 등록 허브로 접수된 내역입니다. 유형별로 걸러 보고 검색할 수 있습니다.' +
      (isAdmin() ? ' <b>관리자</b> 권한에서는 업체명 원문이 보입니다.' : ' 업체명은 <b>🔒 블라인드</b>로 표시됩니다.') + '</p></div>' +
      '<button type="button" class="tr-x" data-hub="close" aria-label="닫기">×</button></div>' +
      '<div class="hub-list-tools"><div id="hubListChips" class="hub-fchips"></div>' +
      '<input id="hubListQ" type="search" placeholder="물건 · 회사 · 담당 · 연락처 검색" autocomplete="off">' +
      '<span id="hubListCount" class="hub-count">불러오는 중…</span>' +
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
      var f = e.target.closest('[data-hub-filter]');
      if (f) { LIST.filter = f.getAttribute('data-hub-filter'); renderListBody(); return; }
      var b = e.target.closest('[data-hub]');
      if (!b) return;
      var act = b.getAttribute('data-hub');
      if (act === 'close') close();
      else if (act === 'form') open(HUB.type, HUB.prefill);
    };
    var q = $('#hubListQ');
    if (q) q.addEventListener('input', function () { LIST.q = q.value; renderListBody(); });
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
      LIST.items = (JSON.parse(localStorage.getItem(MINE_KEY) || '[]'));
      LIST.source = note || 'local';
      paint();
      body.innerHTML += '<p class="hub-foot">' + (note === 'server' ? '비공개 시트 <b>lois</b> 기준.' : '이 브라우저에서 제출한 내역입니다.') + '</p>';
    }
    /* 서버 접수 목록 — 관리자=원문, 그 외 권한=업체명 블라인드(서버가 마스킹해 내려줍니다) */
    apiGet('requests').then(function (j) {
      if (j && j.ok && j.items && j.items.length) {
        LIST.items = j.items;
        LIST.source = 'server';
        paint();
        body.innerHTML += '<p class="hub-foot">비공개 시트 <b>lois</b> 기준 · 유형은 <b>request_type</b> 컬럼으로 구분합니다.' +
          (isAdmin() ? '' : ' 업체명은 관리자만 볼 수 있어 <b>블라인드</b>로 표시됩니다.') + '</p>';
        return;
      }
      if (!isAdmin()) { localRender('local'); return; }
      /* 새 조회 API 가 없으면 기존 lois 조회로 대체 */
      return apiGet('lois').then(function (j2) {
        if (j2 && j2.ok && j2.items) {
          LIST.items = j2.items;
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
