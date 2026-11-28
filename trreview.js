/* =========================================================================
   Open AI Asset Bridge — trreview.js  (🧠 접수 → AI 매칭 → 관리자 승인 → 담당자 연결)
   -------------------------------------------------------------------------
   접수(TR 임차 · 매입 · 매각 · 임대 · 호텔운영 · 금융 · 자문사딜) 처리 파이프라인의
   '운영자(관리자) 매칭 검토' 단계입니다. (2026-11-28)

   단계 (stage)
     received  → matched → approved → routed → draft → delivered → closed
     · matched   : 접수 조건으로 보유 자산 DB 를 채점해 상위 후보 N개를 만든 순간
     · approved  : 관리자가 후보를 승인(≥1)한 순간 — 승인 전에는 다음 단계로 넘어가지 않습니다
     · routed    : 승인 건을 담당자 큐로 넘긴 순간 (담당자 지정 필수)
     · draft     : 요청자에게 보낼 문구 초안을 만든 순간 (보내지 않아도 저장)
     · delivered : 관리자가 '전달했다'고 표시한 순간 (자동 발송 없음)
   승인 방식은 settings.approvalMode 하나로 'admin' | 'auto' 를 갈아끼웁니다.
   지금은 'admin' 이며, 'auto' 는 구조만 열어 두었습니다(자동 발송은 어떤 모드에서도 없음).

   저장
     · 주 저장: 이 브라우저 localStorage `{prefix}:trreview:v1` — 접수 1건당 레코드 1개
     · 원격 반영(가능한 것만): POST {action:'submission_status', kind:'lois', id, status}
       로 접수 시트(lois)의 상태 열에 단계 요약만 미러링합니다.
       (현재 서버는 request_update / review_save 같은 새 액션을 모릅니다 → unknown_action.
        상세 레코드는 로컬에 남고, 화면에 '로컬 저장' 한계를 표시합니다.)
     · 내보내기: JSON(전체 레코드) / CSV(승인·제외 판단, 개인정보 제외) — 학습·분석용

   레코드 스키마 (v1) — 나중에 매칭 모델을 학습시킬 수 있는 형태로 한 건에 모두 남깁니다
     {
       v: 1, rid, requestId, stage, createdAt, updatedAt, by: '관리자',
       request: {
         id, type, receivedAt,
         raw:  { asset_name, region, area_py, price, rent, timeline, memo, deal_type, status },
         norm: { deal, sector, sectorLabel, regions[], cities[], zones[],
                 area:{min,max,text}, price:{min,max,text}, rent:{text,perPyeong},
                 spec:[], timing:{text,fromYear}, timelineText }
       },
       runs: [{
         at, model: 'rule-v1', assetCount, topN, minScore, weights:{...},
         candidates: [{
           assetId, name, sector, region, score:{pct,earned,max,unknown},
           evidence: [{k,label,state:'match'|'partial'|'miss'|'unknown',pts,max,detail}],
           decision:'approved'|'excluded'|'alternative'|'', decidedAt, note
         }]
       }],
       approval: { by:'관리자', at, approved:[assetId], excluded:[assetId], memo, assignee:{id,name,org} },
       route: { at, assignee, queue:'담당자 큐', confirmed, confirmedAt },
       delivery: { subject, body, at, sent, sentAt, channel:'mailto' },
       history: [{ at, stage, action, by:'관리자', note }]
     }

   개인정보·브랜딩 원칙 (2026-11-28)
     · 화면·발신 문구에 개인 실명·직함·연락처, 개인 초대 링크, NAI Korea 운영자 표기를 쓰지 않습니다.
     · 운영자 표기는 '관리자', 플랫폼 표기는 config.js PLATFORM(기본 'Open AI Asset Bridge').
     · NAI Korea 는 자산 '출처' 열에만, 실제 출처가 NAI 인 건에 한해 남깁니다.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var PREFIX = CFG.STORAGE_PREFIX || 'nai-map';
  var TOKEN_KEY = PREFIX + ':token:v1';
  var STORE_KEY = PREFIX + ':trreview:v1';

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
  function assets() {
    var st = window.naiMap && window.naiMap.state;
    return (st && st.assets) ? st.assets : [];
  }
  function platName() { return (window.NAI_PLATFORM && window.NAI_PLATFORM.name) ? window.NAI_PLATFORM.name() : 'Open AI Asset Bridge'; }
  function platContact() { return (window.NAI_PLATFORM && window.NAI_PLATFORM.contact) ? window.NAI_PLATFORM.contact() : ''; }
  function nai() { return (window.NAI_PLATFORM && window.NAI_PLATFORM.sourceOf) ? (window.NAI_PLATFORM.sourceOf('nai') || 'NAI Korea') : 'NAI Korea'; }

  function toast(msg, err) {
    if (window.naiToast) { try { window.naiToast(msg, err); return; } catch (e) { /* noop */ } }
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3400);
  }
  function nfmt(v) { return (v == null || !isFinite(v)) ? '' : Number(v).toLocaleString('ko-KR'); }
  function nowISO() { return new Date().toISOString(); }
  function fmtTime(v) {
    if (!v) return '';
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      var d = new Date(s);
      if (!isNaN(d)) {
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
      }
    }
    return s.replace('T', ' ').slice(0, 16);
  }

  /* ───────────────────────── 단계 정의 ───────────────────────── */
  var STAGES = [
    { k: 'received', l: '접수', icon: '📥', tip: '접수만 된 상태' },
    { k: 'matched', l: 'AI 후보', icon: '🤖', tip: '보유 자산 후보를 만든 상태' },
    { k: 'approved', l: '관리자 승인', icon: '✅', tip: '후보 승인·담당자 지정' },
    { k: 'routed', l: '담당자 연결', icon: '🔗', tip: '담당자 큐로 이동' },
    { k: 'draft', l: '전달 초안', icon: '✉️', tip: '요청자에게 보낼 문구 준비' },
    { k: 'delivered', l: '전달 완료', icon: '📤', tip: '관리자가 직접 전달' },
    { k: 'closed', l: '종결', icon: '🏁', tip: '종결' }
  ];
  function stageIdx(k) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].k === k) return i;
    return 0;
  }
  function stageOf(k) { return STAGES[stageIdx(k)]; }
  /* 접수 시트(lois) 상태 열에 미러링할 요약값 — 서버가 아는 값만 씁니다 */
  var SERVER_STATUS = {
    received: '접수', matched: '검토중', approved: '후보제시',
    routed: '매칭완료', draft: '매칭완료', delivered: '종결', closed: '종결'
  };

  /* ───────────────────────── 설정·저장 ───────────────────────── */
  function defaults() {
    return {
      v: 1,
      settings: {
        approvalMode: 'admin',            /* 'admin' | 'auto' — 지금은 관리자 확인 */
        autoRoute: false,                 /* 승인 후 자동 라우팅 여지 (미구현·false 고정) */
        topN: 8,
        minScore: 45,
        weights: { sector: 30, region: 20, area: 20, price: 15, spec: 10, timing: 5 },
        assignees: [],                    /* [{id,name,org,note}] — 추측으로 채우지 않습니다 */
        autoSend: false                   /* 자동 발송 없음 — 값을 바꿔도 발송 기능은 없습니다 */
      },
      reviews: {},
      updatedAt: ''
    };
  }
  function loadStore() {
    var d = defaults();
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return d;
      var j = JSON.parse(raw);
      if (!j || typeof j !== 'object') return d;
      if (j.settings) d.settings = Object.assign(d.settings, j.settings);
      d.settings.weights = Object.assign(defaults().settings.weights, j.settings && j.settings.weights || {});
      if (j.reviews && typeof j.reviews === 'object') d.reviews = j.reviews;
      d.updatedAt = j.updatedAt || '';
    } catch (e) { /* 손상된 저장값은 기본값으로 */ }
    return d;
  }
  var DB = loadStore();
  function saveStore() {
    DB.updatedAt = nowISO();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(DB));
      return true;
    } catch (e) {
      toast('이 브라우저 저장 공간이 가득 찼습니다 — JSON 내보내기로 백업해 주세요.', true);
      return false;
    }
  }
  var SET = function () { return DB.settings; };

  /* ───────────────────────── 접수 불러오기 ───────────────────────── */
  var ST = { reqs: [], loading: false, loaded: false, sel: '', filter: 'ALL', q: '', view: 'inbox', picker: '', err: '' };

  function apiGet(type) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var url = base + (base.indexOf('?') < 0 ? '?' : '&') + 'type=' + encodeURIComponent(type) +
      '&token=' + encodeURIComponent(getToken());
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function apiPost(payload) {
    var base = CFG.SYNC_URL;
    if (!base || !getToken()) return Promise.resolve({ ok: false, error: 'no_sync' });
    return fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: getToken() }, payload))
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'network' }; });
  }

  function normType(row) {
    var t = String(row.request_type || '').trim();
    if (t) return t;
    var m = String(row.memo || '').match(/^\[(?:유형=)?([^\]]+)\]/);
    if (m) return m[1].replace(/\s.*$/, '');
    return 'TR';
  }
  function reqRow(r) {
    return {
      id: String(r.id || r.asset_id || ''),
      type: normType(r),
      title: String(r.asset_name || ''),
      region: String(r.region || ''),
      areaText: String(r.area_py || ''),
      price: String(r.price || ''),
      rent: String(r.rent || ''),
      timeline: String(r.timeline || ''),
      memo: String(r.memo || ''),
      deal: String(r.deal_type || ''),
      company: String(r.company || ''),
      name: String(r.name || ''),
      title2: String(r.title || ''),
      phone: String(r.phone || ''),
      email: String(r.email || ''),
      status: String(r.status || '접수'),
      at: String(r.timestamp || r.at || ''),
      owner: String(r.owner || ''),
      _raw: r
    };
  }
  function loadRequests(force) {
    if (ST.loading) return Promise.resolve();
    if (ST.loaded && !force) return Promise.resolve();
    ST.loading = true; ST.err = '';
    render();
    return apiGet('requests').then(function (j) {
      if (j && j.ok && j.items) {
        ST.reqs = j.items.map(reqRow).filter(function (r) { return r.id; });
        ST.badge = 'server';
      } else {
        return apiGet('lois').then(function (j2) {
          if (j2 && j2.ok && j2.items) {
            ST.reqs = j2.items.map(reqRow).filter(function (r) { return r.id; });
            ST.badge = 'lois';
          } else { ST.badge = 'none'; ST.reqs = []; }
        });
      }
    }).catch(function () { ST.badge = 'none'; ST.err = '접수 목록을 불러오지 못했습니다.'; })
      .then(function () {
        ST.loading = false; ST.loaded = true;
        /* 이미 검토 기록이 있는데 목록에서 사라진 건은 남겨 둡니다(삭제·보관 대비) */
        render();
      });
  }
  function reqById(id) {
    for (var i = 0; i < ST.reqs.length; i++) if (ST.reqs[i].id === String(id)) return ST.reqs[i];
    return null;
  }

  /* ───────────────────────── 조건 정규화 ───────────────────────── */
  var SECTOR_LABEL = {
    office: '오피스', logistics: '물류센터', datacenter: '데이터센터', hotel: '호텔',
    retail: '리테일', living: '멀티패밀리·임대', land: '토지·개발부지', golf: '골프장',
    senior: '시니어', shipper: '화주·임차수요'
  };
  var SECTOR_RULES = [
    { k: 'golf', re: /골프장|컨트리\s*클럽|그린피/ },
    { k: 'datacenter', re: /데이터\s*센터|데이타\s*센터|IDC|엣지\s*DC|서버\s*센터/ },
    { k: 'hotel', re: /호텔|리조트|숙박|객실|호스텔/ },
    { k: 'logistics', re: /물류|창고|냉동|냉장|저온|풀필먼트|3\s*PL|배송\s*센터|택배|BTS/i },
    { k: 'office', re: /오피스|사옥|빌딩|타워|업무\s*시설|사무실/ },
    { k: 'retail', re: /리테일|백화점|아울렛|쇼핑몰|상가|마트|근린|매장/ },
    { k: 'living', re: /임대\s*주택|멀티\s*패밀리|코리빙|기숙사|오피스텔|주거|아파트/ },
    { k: 'land', re: /토지|부지|나대지|개발\s*부지|대지|임야|공장\s*부지/ },
    { k: 'senior', re: /시니어|실버|요양|노인/ },
    { k: 'shipper', re: /화주|임차\s*수요|입주\s*수요/ }
  ];
  var PROVINCES = ['서울', '경기', '인천', '부산', '대구', '대전', '세종', '광주', '울산',
    '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
  var CITIES = ['용인', '이천', '여주', '양주', '포천', '안성', '평택', '화성', '김포', '파주', '하남',
    '남양주', '시흥', '부천', '안양', '광명', '군포', '의왕', '과천', '구리', '오산', '안산', '수원',
    '성남', '분당', '판교', '고양', '일산', '동탄', '기흥', '광주시', '천안', '아산', '청주', '음성',
    '진천', '전주', '익산', '포항', '구미', '원주', '춘천', '김해', '양산', '창원', '진주', '송도',
    '논현', '청담', '도산대로', '역삼', '삼성동', '서초', '교대', '여의도', '종로', '광화문', '여의도',
    '덕평', '호법', '양지', '이촌', '성수', '마곡'];
  var ZONES = ['CBD', 'GBD', 'BBD', 'YBD'];

  function memoPairs(memo) {
    var out = {};
    String(memo || '').split('|').forEach(function (seg) {
      var s = seg.trim();
      var i = s.indexOf('=');
      if (i > 0) out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
    });
    return out;
  }
  function pickNum(s) {
    var m = String(s || '').match(/([\d,]+(?:\.\d+)?)/);
    return m ? Number(String(m[1]).replace(/,/g, '')) : null;
  }
  /** 평 단위 면적 범위 — "5,000~10,000평", "15,000평 이상", "1만 평", "전용 900평", "약 3,000평" */
  function parseArea(text) {
    var s = String(text || '');
    if (!s) return null;
    var man = s.match(/(\d+(?:\.\d+)?)\s*만\s*(?:(\d[\d,]*)\s*)?평/);
    var lo = null, hi = null;
    if (man) {
      lo = Number(man[1]) * 10000 + (man[2] ? Number(String(man[2]).replace(/,/g, '')) : 0);
      hi = lo;
    } else {
      var ran = s.match(/([\d,]{2,})\s*~\s*([\d,]{2,})\s*평/);
      if (ran) {
        lo = Number(String(ran[1]).replace(/,/g, ''));
        hi = Number(String(ran[2]).replace(/,/g, ''));
      } else {
        var one = s.match(/([\d,]{2,})\s*평/);
        if (!one) return null;
        lo = Number(String(one[1]).replace(/,/g, ''));
        hi = lo;
      }
    }
    if (/이상/.test(s) && hi) hi = null;
    if (/이하|미만/.test(s) && lo) { hi = lo; lo = null; }
    return { min: lo, max: hi, text: s.slice(0, 40) };
  }
  /** 금액 범위 — 억 단위: "400~600억", "1,000억 원 내외", "건당 2,000~2,500억" */
  function parsePrice(text) {
    var s = String(text || '');
    if (!s) return null;
    var man = s.match(/([\d,\.]+)\s*조/);
    if (man) {
      var jo = Number(String(man[1]).replace(/,/g, '')) * 10000;
      return { min: jo, max: jo, text: s.slice(0, 40) };
    }
    var ran = s.match(/([\d,]{2,})\s*~\s*([\d,]{2,})\s*억/);
    if (ran) return { min: Number(String(ran[1]).replace(/,/g, '')), max: Number(String(ran[2]).replace(/,/g, '')), text: s.slice(0, 40) };
    var one = s.match(/([\d,]{2,})\s*억/);
    if (one) {
      var v = Number(String(one[1]).replace(/,/g, ''));
      if (/내외|수준|안팎|전후/.test(s)) return { min: v * 0.85, max: v * 1.15, text: s.slice(0, 40) };
      return { min: v, max: v, text: s.slice(0, 40) };
    }
    return null;
  }
  /** 평당 임대료(만원) — "평당 월 3.3만원", "전용 NOC 15만 원", "평당 4.2만" */
  function parseRent(text) {
    var s = String(text || '');
    if (!s) return null;
    var m = s.match(/(?:평당|NOC|노크|평)\D{0,6}([\d,\.]+)\s*만\s*원?/i);
    if (m) return { perPyeong: Number(String(m[1]).replace(/,/g, '')), text: s.slice(0, 40) };
    var won = s.match(/(?:평당)\D{0,6}([\d,]{4,})\s*원/);
    if (won) return { perPyeong: Number(String(won[1]).replace(/,/g, '')) / 10000, text: s.slice(0, 40) };
    return null;
  }
  function specTokens(text) {
    var s = String(text || '');
    var out = [];
    [['냉동', /냉동/], ['냉장', /냉장/], ['상온', /상온/], ['저온', /저온/], ['신선', /신선/],
      ['층고', /층고/], ['도크', /도크/], ['하중', /하중/], ['주차', /주차/], ['역세권', /역세권/],
      ['1층', /1\s*층/], ['전층', /전층/], ['BTS', /BTS/i], ['개발', /개발|신축|컨버전/],
      ['사옥', /사옥/], ['매장', /매장/], ['실사용', /자가|실사용/]
    ].forEach(function (x) { if (x[1].test(s)) out.push(x[0]); });
    return out;
  }
  function parseTiming(text) {
    var s = String(text || '');
    if (!s) return { text: '', fromYear: null };
    var m = s.match(/(20\d{2}|\d{2})\s*[\.년]?\s*(?:([1-4])\s*(?:분기|Q|H|반기))?/i);
    var y = null;
    if (m) {
      y = Number(m[1]);
      if (y < 100) y += 2000;
    }
    return { text: s.slice(0, 40), fromYear: y };
  }

  function parseRequest(r) {
    var pairs = memoPairs(r.memo);
    var blob = [r.title, r.region, r.areaText, r.price, r.rent, r.timeline, r.memo].join(' ');
    /* 섹터: 메모의 '섹터=' → 없으면 본문 정규식 */
    var sector = null, sectorLabel = '';
    var secText = pairs['섹터'] || '';
    if (secText) {
      for (var i = 0; i < SECTOR_RULES.length; i++) {
        if (SECTOR_RULES[i].re.test(secText)) { sector = SECTOR_RULES[i].k; sectorLabel = secText; break; }
      }
    }
    if (!sector) {
      for (var j = 0; j < SECTOR_RULES.length; j++) {
        if (SECTOR_RULES[j].re.test(blob)) { sector = SECTOR_RULES[j].k; sectorLabel = secText || SECTOR_LABEL[sector] || ''; break; }
      }
    }
    if (!sectorLabel && sector) sectorLabel = SECTOR_LABEL[sector] || sector;
    /* 권역 */
    var regions = [], cities = [], zones = [];
    PROVINCES.forEach(function (p) { if (blob.indexOf(p) >= 0) regions.push(p); });
    if (/수도권/.test(blob)) {
      ['서울', '경기', '인천'].forEach(function (p) { if (regions.indexOf(p) < 0) regions.push(p); });
      regions._metro = true;
    }
    CITIES.forEach(function (c) { if (blob.indexOf(c) >= 0) cities.push(c); });
    ZONES.forEach(function (z) { if (new RegExp('(^|[^A-Za-z])' + z + '([^A-Za-z]|$)').test(blob)) zones.push(z); });
    /* 면적·금액·임대료 */
    var area = parseArea(r.areaText) || parseArea(pairs['필요 규모']) || parseArea(pairs['희망 면적']) ||
      parseArea(pairs['규모']) || parseArea(r.title);
    var priceText = r.price || pairs['예산'] || pairs['예산 · 금액'] || '';
    var price = parsePrice(priceText);
    var rent = parseRent(r.rent || pairs['희망 임대료 · 예산'] || priceText);
    var spec = specTokens([pairs['상세 스펙 (온도·층고·하중·도크)'], pairs['상세 스펙'], pairs['스펙'], pairs['메모'], r.memo, r.title].join(' '));
    var timing = parseTiming(r.timeline || pairs['입주 희망 시기'] || pairs['희망 시기']);
    var deal = r.deal || (/매입|매수|인수/.test(r.type) ? '매입' : '임차');
    return {
      deal: deal, sector: sector, sectorLabel: sectorLabel,
      regions: regions, cities: cities, zones: zones,
      area: area, price: price, rent: rent, spec: spec, timing: timing,
      metro: !!(regions._metro || /수도권/.test(blob))
    };
  }

  /* ───────────────────────── 자산 값 읽기 ───────────────────────── */
  function factOf(a, names) {
    var f = a.facts || [];
    for (var i = 0; i < f.length; i++) {
      for (var n = 0; n < names.length; n++) {
        if (String(f[i].label || '').indexOf(names[n]) >= 0) return String(f[i].value || '');
      }
    }
    return '';
  }
  function areaOf(a) {
    var s = String(a.scale_info || '');
    var m = s.match(/([\d,]{2,})\s*평/);
    if (m) return Number(String(m[1]).replace(/,/g, ''));
    var m2 = s.match(/([\d,]{3,})\s*㎡/);
    if (m2) return Math.round(Number(String(m2[1]).replace(/,/g, '')) / 3.3058);
    var f = factOf(a, ['연면적', '매각면적', '대지면적', '전용면적']);
    var fm = String(f).match(/([\d,]{2,})\s*평/);
    if (fm) return Number(String(fm[1]).replace(/,/g, ''));
    return null;
  }
  function priceOf(a) {
    var s = String(a.price_info || '');
    var m = s.match(/([\d,]+(?:\.\d+)?)\s*억/);
    if (m) return { eok: Number(String(m[1]).replace(/,/g, '')), basis: /매입/.test(s) ? '매입가' : (/감정/.test(s) ? '감정가' : (/호가|매각/.test(s) ? '호가' : '금액')) };
    var f = factOf(a, ['최저입찰가', '감정가']);
    var fm = String(f).match(/([\d,]+(?:\.\d+)?)\s*억/);
    return fm ? { eok: Number(String(fm[1]).replace(/,/g, '')), basis: '감정가·입찰가' } : null;
  }
  function rentOf(a) {
    /* 매입가·감정가(평당 590만원 등)를 임대료로 읽지 않습니다 — 임대 표기가 있는 값만 씁니다 */
    var pi = /임대/.test(String(a.price_info || '')) ? String(a.price_info) : '';
    var s = pi + ' ' + String(a.notes || '') + ' ' + factOf(a, ['임대료', 'NOC', '월 임대']);
    var m = s.match(/(?:평당|NOC)\D{0,6}([\d,\.]+)\s*만/);
    if (m) return { perPyeong: Number(String(m[1]).replace(/,/g, '')), text: m[0].slice(0, 30) };
    return null;
  }
  function hayOf(a) {
    if (a._trmhay) return a._trmhay;
    var parts = [a.name, a.address, a.region, a.owner_amc, a.fund_vehicle, a.tenants,
      a.sub_type, a.status, a.status_group, a.scale_info, a.price_info, a.notes];
    (a.facts || []).forEach(function (f) { parts.push(String(f.label || '') + ' ' + String(f.value || '')); });
    a._trmhay = parts.filter(Boolean).join(' ').toLowerCase();
    return a._trmhay;
  }
  function srcOf(a) {
    var s = String(a.source || '').trim();
    if (!s) return '';
    /* 출처 문자열에 NAI 협업·자문 사실이 있으면 그대로 출처로 표기 */
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  }
  function naiSourced(a) {
    return /NAI|엔에이아이/.test(String(a.source || '') + ' ' + String(a.owner_amc || ''));
  }

  /* ───────────────────────── 채점 ───────────────────────── */
  var WEIGHT_LABEL = { sector: '섹터', region: '권역', area: '규모(면적)', price: '가격·임대조건', spec: '용도·스펙', timing: '시점' };

  function scoreAsset(P, A, W) {
    var ev = [];
    /* ① 섹터 */
    if (P.sector) {
      if (A.sector === P.sector) {
        ev.push({ k: 'sector', label: '섹터', state: 'match', pts: W.sector, max: W.sector, detail: (SECTOR_LABEL[A.sector] || A.sector) + ' 일치' });
      } else {
        ev.push({ k: 'sector', label: '섹터', state: 'miss', pts: 0, max: W.sector, detail: '요청 ' + (SECTOR_LABEL[P.sector] || P.sector) + ' / 자산 ' + (SECTOR_LABEL[A.sector] || A.sector) });
        return { pct: 0, earned: 0, max: W.sector, unknown: 0, evidence: ev, excluded: '섹터 불일치' };
      }
    } else {
      ev.push({ k: 'sector', label: '섹터', state: 'unknown', pts: 0, max: W.sector, detail: '요청 섹터 미확인' });
    }

    /* ② 권역 */
    if ((P.regions && P.regions.length) || (P.cities && P.cities.length) || (P.zones && P.zones.length)) {
      var where = String(A.name || '') + ' ' + String(A.address || '');
      var cityHit = (P.cities || []).filter(function (c) { return where.indexOf(c) >= 0; })[0];
      var zoneHit = (P.zones || []).filter(function (z) { return String(A.region || '') === z || where.indexOf(z) >= 0; })[0];
      var regionHit = (P.regions || []).filter(function (p) { return String(A.region || '') === p; })[0];
      if (cityHit) ev.push({ k: 'region', label: '권역', state: 'match', pts: W.region, max: W.region, detail: cityHit + ' 일치 · ' + (A.region || '') });
      else if (zoneHit) ev.push({ k: 'region', label: '권역', state: 'match', pts: W.region, max: W.region, detail: zoneHit + ' 일치' });
      else if (regionHit) ev.push({ k: 'region', label: '권역', state: 'partial', pts: Math.round(W.region * 0.75), max: W.region, detail: regionHit + ' 일치(시·군 미확인)' });
      else ev.push({ k: 'region', label: '권역', state: 'miss', pts: 0, max: W.region, detail: '요청 ' + ((P.cities || []).concat(P.regions || []).join('·') || '-') + ' / 자산 ' + (A.region || '미상') });
    } else {
      ev.push({ k: 'region', label: '권역', state: 'unknown', pts: 0, max: W.region, detail: '요청 권역 미확인' });
    }

    /* ③ 규모 */
    if (P.area && (P.area.min || P.area.max)) {
      var av = areaOf(A);
      if (av) {
        var lo = P.area.min == null ? 0 : P.area.min, hi = P.area.max == null ? Infinity : P.area.max;
        var inLo = av >= lo * 0.85, inHi = av <= (isFinite(hi) ? hi * 1.15 : Infinity);
        var nearLo = av >= lo * 0.6, nearHi = av <= (isFinite(hi) ? hi * 1.5 : Infinity);
        /* '15,000평 이상'처럼 상한이 없는 조건은 3배를 넘으면 같은 규모로 보지 않습니다 */
        if (!isFinite(hi) && lo) {
          var openR = av / lo;
          if (openR <= 2.5) { inHi = true; nearHi = true; }
          else if (openR <= 4) { inHi = false; nearHi = true; }
          else { inHi = false; nearHi = false; }
        }
        if (inLo && inHi) ev.push({ k: 'area', label: '규모(면적)', state: 'match', pts: W.area, max: W.area, detail: nfmt(av) + '평 · 요청 ' + (P.area.text || '') });
        else if (nearLo && nearHi) ev.push({ k: 'area', label: '규모(면적)', state: 'partial', pts: Math.round(W.area * 0.6), max: W.area, detail: nfmt(av) + '평 · 요청 범위 인접' });
        else ev.push({ k: 'area', label: '규모(면적)', state: 'miss', pts: 0, max: W.area, detail: nfmt(av) + '평 · 요청 ' + (P.area.text || '') });
      } else {
        ev.push({ k: 'area', label: '규모(면적)', state: 'unknown', pts: 0, max: W.area, detail: '자산 면적 미확보' });
      }
    } else {
      ev.push({ k: 'area', label: '규모(면적)', state: 'unknown', pts: 0, max: W.area, detail: '요청 면적 미확인' });
    }

    /* ④ 가격·임대조건 */
    var pr = priceOf(A);
    var rn = rentOf(A);
    if (P.deal === '임차' && P.rent && P.rent.perPyeong) {
      if (rn && rn.perPyeong) {
        var rr = rn.perPyeong / P.rent.perPyeong;
        if (rr <= 1.1) ev.push({ k: 'price', label: '가격·임대조건', state: 'match', pts: W.price, max: W.price, detail: '평당 ' + rn.perPyeong + '만원 · 요청 ' + P.rent.perPyeong + '만원' });
        else if (rr <= 1.35) ev.push({ k: 'price', label: '가격·임대조건', state: 'partial', pts: Math.round(W.price * 0.6), max: W.price, detail: '평당 ' + rn.perPyeong + '만원 · 요청보다 높음' });
        else ev.push({ k: 'price', label: '가격·임대조건', state: 'miss', pts: 0, max: W.price, detail: '평당 ' + rn.perPyeong + '만원 · 요청 ' + P.rent.perPyeong + '만원' });
      } else {
        ev.push({ k: 'price', label: '가격·임대조건', state: 'unknown', pts: 0, max: W.price, detail: '자산 임대료 미확보' });
      }
    } else if (P.price && (P.price.min || P.price.max)) {
      if (pr) {
        var pctOk = pr.eok >= P.price.min * 0.85 && pr.eok <= P.price.max * 1.15;
        var pctNear = pr.eok >= P.price.min * 0.6 && pr.eok <= P.price.max * 1.5;
        var base = pr.eok.toLocaleString('ko-KR') + '억(' + pr.basis + ')';
        if (pctOk) ev.push({ k: 'price', label: '가격·임대조건', state: 'match', pts: W.price, max: W.price, detail: base + ' · 요청 범위 내' });
        else if (pctNear) ev.push({ k: 'price', label: '가격·임대조건', state: 'partial', pts: Math.round(W.price * 0.5), max: W.price, detail: base + ' · 요청 범위 인접' });
        else ev.push({ k: 'price', label: '가격·임대조건', state: 'miss', pts: 0, max: W.price, detail: base + ' · 요청 ' + (P.price.text || '') });
      } else {
        ev.push({ k: 'price', label: '가격·임대조건', state: 'unknown', pts: 0, max: W.price, detail: '자산 가격 미확보' });
      }
    } else {
      ev.push({ k: 'price', label: '가격·임대조건', state: 'unknown', pts: 0, max: W.price, detail: P.deal === '임차' ? '요청 임대료 미확인' : '요청 예산 미확인' });
    }

    /* ⑤ 용도·스펙 */
    if (P.spec && P.spec.length) {
      var hay = hayOf(A);
      var hasSpecData = /온도|냉동|냉장|상온|층고|도크|하중|주차/.test(hay);
      var hits = P.spec.filter(function (t) { return hay.indexOf(String(t).toLowerCase()) >= 0; });
      if (hits.length) {
        var ratio = hits.length / P.spec.length;
        var st = ratio >= 0.5 ? 'match' : 'partial';
        ev.push({ k: 'spec', label: '용도·스펙', state: st, pts: Math.round(W.spec * (st === 'match' ? 1 : 0.5)), max: W.spec, detail: hits.join('·') + ' 확인 (' + hits.length + '/' + P.spec.length + ')' });
      } else if (!hasSpecData) {
        ev.push({ k: 'spec', label: '용도·스펙', state: 'unknown', pts: 0, max: W.spec, detail: '자산 스펙 정보 미확보' });
      } else {
        ev.push({ k: 'spec', label: '용도·스펙', state: 'miss', pts: 0, max: W.spec, detail: '요청 ' + P.spec.join('·') + ' 미확인' });
      }
    } else {
      ev.push({ k: 'spec', label: '용도·스펙', state: 'unknown', pts: 0, max: W.spec, detail: '요청 스펙 미확인' });
    }

    /* ⑥ 시점 */
    var built = String(factOf(A, ['준공', '사용승인', '완공']) || '').match(/(20\d{2})/);
    if (P.timing && P.timing.fromYear) {
      if (built) {
        var by = Number(built[1]);
        if (by <= P.timing.fromYear) ev.push({ k: 'timing', label: '시점', state: 'match', pts: W.timing, max: W.timing, detail: '준공 ' + by + ' · 요청 ' + P.timing.fromYear });
        else if (by <= P.timing.fromYear + 1) ev.push({ k: 'timing', label: '시점', state: 'partial', pts: Math.round(W.timing * 0.4), max: W.timing, detail: '준공 ' + by + ' · 요청보다 늦음' });
        else ev.push({ k: 'timing', label: '시점', state: 'miss', pts: 0, max: W.timing, detail: '준공 ' + by + ' · 요청 ' + P.timing.fromYear });
      } else {
        ev.push({ k: 'timing', label: '시점', state: 'unknown', pts: 0, max: W.timing, detail: '자산 준공·입주 시점 미확보' });
      }
    } else {
      ev.push({ k: 'timing', label: '시점', state: 'unknown', pts: 0, max: W.timing, detail: '요청 시점 미확인' });
    }

    var earned = 0, max = 0, unknown = 0, totalW = 0;
    ev.forEach(function (e) {
      totalW += (e.max || 0);
      if (e.state === 'unknown') { unknown++; return; }
      earned += e.pts; max += e.max;
    });
    /* pct = 전체 가중치(100) 기준 점수 — 미확보 항목은 0점으로 반영되어 순위가 왜곡되지 않습니다.
       coverage = 확보된 항목의 가중치 비율(데이터 충실도). fit = 확보 항목만 기준 적합도. */
    var pct = totalW ? Math.round(earned / totalW * 100) : 0;
    var coverage = totalW ? Math.round(max / totalW * 100) : 0;
    var fit = max ? Math.round(earned / max * 100) : 0;
    return { pct: pct, fit: fit, coverage: coverage, earned: earned, max: max, total: totalW, unknown: unknown, evidence: ev };
  }

  function runMatch(rec, force) {
    /* 이미 담당자·전달 단계로 넘어간 건은 후보를 다시 만들지 않습니다(이력 보존) */
    if (force && ['routed', 'draft', 'delivered', 'closed'].indexOf(rec.stage) >= 0) return null;
    var W = SET().weights;
    var list = assets();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var s = scoreAsset(rec.request.norm, a, W);
      if (s.excluded) continue;
      if (s.pct < SET().minScore) continue;
      out.push({
        assetId: String(a.id || ''), name: String(a.name || ''), sector: a.sector, region: a.region || '',
        score: { pct: s.pct, fit: s.fit, coverage: s.coverage, earned: s.earned, max: s.max, total: s.total, unknown: s.unknown },
        evidence: s.evidence, decision: '', decidedAt: '', note: ''
      });
    }
    out.sort(function (x, y) {
      if (y.score.pct !== x.score.pct) return y.score.pct - x.score.pct;
      if ((y.score.coverage || 0) !== (x.score.coverage || 0)) return (y.score.coverage || 0) - (x.score.coverage || 0);
      return String(x.name).localeCompare(String(y.name), 'ko');
    });
    /* 같은 자산이 두 번 들어오는 경우(중복 행) 한 번만 남깁니다 */
    var seen = {}, uniq = [];
    out.forEach(function (c) {
      var k = String(c.name || '').trim();
      if (seen[k]) return;
      seen[k] = 1; uniq.push(c);
    });
    out = uniq.slice(0, SET().topN || 8);
    var run = {
      at: nowISO(), model: 'rule-v1', assetCount: list.length,
      topN: SET().topN, minScore: SET().minScore, weights: JSON.parse(JSON.stringify(W)),
      candidates: out
    };
    rec.runs = rec.runs || [];
    rec.runs.push(run);
    if (rec.runs.length > 12) rec.runs = rec.runs.slice(-12);
    if (force) {
      /* 후보를 새로 만들면 이전 판단은 새 후보에 없는 id 이므로 비웁니다 */
      rec.approval.approved = []; rec.approval.excluded = [];
      rec.approval.at = '';
      rec.stage = 'matched';
    } else if (rec.stage === 'received') rec.stage = 'matched';
    pushHistory(rec, 'candidates_generated', out.length + '건 후보 · 모델 rule-v1');
    return run;
  }
  function currentRun(rec) { return (rec.runs && rec.runs.length) ? rec.runs[rec.runs.length - 1] : null; }

  function pushHistory(rec, action, note, stage) {
    rec.history = rec.history || [];
    rec.history.push({ at: nowISO(), stage: stage || rec.stage, action: action, by: '관리자', note: note || '' });
    rec.updatedAt = nowISO();
  }

  /* ───────────────────────── 레코드 생성 ───────────────────────── */
  function reviewOf(row, create) {
    var id = String(row.id);
    if (!DB.reviews[id] && create) {
      var P = parseRequest(row);
      DB.reviews[id] = {
        v: 1, rid: id, requestId: id, stage: 'received', createdAt: nowISO(), updatedAt: nowISO(), by: '관리자',
        request: {
          id: id, type: row.type, receivedAt: row.at,
          raw: {
            asset_name: row.title, region: row.region, area_py: row.areaText, price: row.price,
            rent: row.rent, timeline: row.timeline, memo: row.memo, deal_type: row.deal, status: row.status
          },
          norm: {
            deal: P.deal, sector: P.sector, sectorLabel: P.sectorLabel,
            regions: P.regions, cities: P.cities, zones: P.zones,
            area: P.area, price: P.price, rent: P.rent, spec: P.spec,
            timing: P.timing, timelineText: row.timeline
          }
        },
        runs: [],
        approval: { by: '관리자', at: '', approved: [], excluded: [], memo: '', assignee: null },
        route: null, delivery: null,
        history: [{ at: nowISO(), stage: 'received', action: 'review_opened', by: '관리자', note: '' }]
      };
      /* 승인 정책 훅 — auto 모드에서는 후보 생성 직후 상위 1건을 자동 승인합니다(구조만) */
      var run = runMatch(DB.reviews[id]);
      applyApprovalPolicy(DB.reviews[id], run);
      saveStore();
    }
    return DB.reviews[id] || null;
  }
  function applyApprovalPolicy(rec, run) {
    if (SET().approvalMode !== 'auto' || !run || !run.candidates.length) return;
    var top = run.candidates[0];
    if (!top.decision) {
      top.decision = 'approved';
      top.decidedAt = nowISO();
      top.note = '자동 승인(설정 approvalMode=auto)';
      rec.approval.approved = [top.assetId];
      rec.approval.at = nowISO();
      rec.stage = 'approved';
      pushHistory(rec, 'approved_auto', top.name);
    }
  }

  /* ───────────────────────── 화면 ───────────────────────── */
  function ensureHost() {
    var host = $('#trReviewModal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'trReviewModal';
      host.className = 'hub-modal trm-modal hidden';
      document.body.appendChild(host);
    }
    return host;
  }
  function close() {
    var host = $('#trReviewModal');
    if (host) { host.classList.add('hidden'); host.innerHTML = ''; }
    document.removeEventListener('keydown', escKey);
    document.body.classList.remove('trm-full');
  }
  function escKey(e) { if (e.key === 'Escape') close(); }

  function open(opts) {
    opts = opts || {};
    if (!isAdmin()) { toast('관리자 전용 화면입니다.', true); return; }
    ST.sel = opts.id ? String(opts.id) : ST.sel;
    var host = ensureHost();
    host.classList.remove('hidden');
    render();
    if (!ST.loaded) loadRequests();
    document.removeEventListener('keydown', escKey);
    document.addEventListener('keydown', escKey);
  }
  function openFor(id) { open({ id: id }); }

  function rowsFiltered() {
    var q = ST.q.trim().toLowerCase();
    return ST.reqs.filter(function (r) {
      if (ST.filter !== 'ALL' && r.type !== ST.filter) return false;
      if (!q) return true;
      return [r.title, r.region, r.areaText, r.price, r.rent, r.memo, r.company, r.name, r.id].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var ra = DB.reviews[a.id], rb = DB.reviews[b.id];
      var sa = String(a.at), sb = String(b.at);
      if (sb !== sa) return sb.localeCompare(sa);
      return 0;
    });
  }

  function kpi() {
    var counts = { total: ST.reqs.length, waiting: 0, approved: 0, queue: 0, draft: 0 };
    ST.reqs.forEach(function (r) {
      var rec = DB.reviews[r.id];
      var st = rec ? rec.stage : 'received';
      if (st === 'received' || st === 'matched') counts.waiting++;
      if (st === 'approved') counts.approved++;
      if (st === 'routed') counts.queue++;
      if (st === 'draft') counts.draft++;
    });
    return [
      ['접수', counts.total, '전체 접수 건'],
      ['검토 대기', counts.waiting, '후보·승인 전'],
      ['승인', counts.approved, '담당자 지정 대기'],
      ['담당자 큐', counts.queue, '연결·확인 대기'],
      ['전달 초안', counts.draft, '요청자 발송 대기']
    ].map(function (k) {
      return '<div class="trm-k"><span>' + esc(k[0]) + '</span><strong>' + nfmt(k[1]) + '</strong><em>' + esc(k[2]) + '</em></div>';
    }).join('');
  }

  function typeChips() {
    var types = {};
    ST.reqs.forEach(function (r) { types[r.type] = (types[r.type] || 0) + 1; });
    var keys = Object.keys(types).sort(function (a, b) { return types[b] - types[a]; });
    var h = '<button type="button" class="hub-fchip' + (ST.filter === 'ALL' ? ' on' : '') + '" data-trm-filter="ALL">전체 <b>' + ST.reqs.length + '</b></button>';
    keys.forEach(function (k) {
      h += '<button type="button" class="hub-fchip' + (ST.filter === k ? ' on' : '') + '" data-trm-filter="' + esc(k) + '">' + esc(k) + ' <b>' + types[k] + '</b></button>';
    });
    return h;
  }

  function stageBadge(rec) {
    var st = rec ? rec.stage : 'received';
    var s = stageOf(st);
    var cls = 'trm-st s-' + st;
    return '<span class="' + cls + '">' + s.icon + ' ' + esc(s.l) + '</span>';
  }

  function listHTML() {
    var rows = rowsFiltered();
    if (!rows.length) return '<p class="hub-empty">접수 내역이 없습니다.</p>';
    var h = '<div class="trm-list">';
    rows.forEach(function (r) {
      var rec = DB.reviews[r.id];
      var run = rec ? currentRun(rec) : null;
      var top = run && run.candidates.length ? run.candidates[0] : null;
      var on = String(ST.sel) === r.id ? ' on' : '';
      h += '<button type="button" class="trm-row' + on + '" data-trm-sel="' + esc(r.id) + '">';
      h += '<div class="trm-row-top"><b>' + esc(r.title || '(제목 없음)') + '</b>' + stageBadge(rec) + '</div>';
      h += '<div class="trm-row-meta"><span class="trm-tag">' + esc(r.type) + '</span>' +
        '<span>' + esc(r.region || '권역 미정') + '</span>' +
        (r.areaText ? '<span>' + esc(String(r.areaText).slice(0, 22)) + '</span>' : '') +
        (r.timeline ? '<span>' + esc(String(r.timeline).slice(0, 18)) + '</span>' : '') + '</div>';
      h += '<div class="trm-row-foot">' + (top ? '🤖 최상위 후보 <b>' + top.score.pct + '%</b> · ' + esc(top.name) : (rec ? '후보 미생성' : '검토 전')) +
        ' · ' + esc(fmtTime(r.at)) + '</div>';
      h += '</button>';
    });
    h += '</div>';
    return h;
  }

  function queueRows() {
    var out = [];
    Object.keys(DB.reviews).forEach(function (id) {
      var rec = DB.reviews[id];
      if (['routed', 'draft', 'delivered'].indexOf(rec.stage) >= 0) out.push({ id: id, rec: rec });
    });
    out.sort(function (a, b) { return String(b.rec.updatedAt).localeCompare(String(a.rec.updatedAt)); });
    return out;
  }
  function queueHTML() {
    var rows = queueRows();
    if (!rows.length) return '<p class="hub-empty">담당자 큐에 있는 건이 없습니다. 승인 후 <b>담당자 큐로 보내기</b>를 누르면 여기로 옵니다.</p>';
    var h = '<div class="trm-tablewrap"><table class="hub-table"><thead><tr>' +
      '<th>단계</th><th>접수 건</th><th>승인 후보</th><th>담당자</th><th>연결</th><th>전달</th></tr></thead><tbody>';
    rows.forEach(function (x) {
      var rec = x.rec, run = currentRun(rec);
      var names = (rec.approval.approved || []).map(function (aid) {
        var c = run && run.candidates.filter(function (y) { return y.assetId === aid; })[0];
        return c ? c.name : aid;
      }).join(' · ');
      var row = reqById(x.id);
      h += '<tr class="trm-qrow" data-trm-sel="' + esc(x.id) + '">' +
        '<td>' + stageBadge(rec) + '</td>' +
        '<td><b>' + esc(row ? row.title : (rec.request.raw.asset_name || '')) + '</b>' +
        '<div class="ad-det">' + esc(rec.request.type) + ' · ' + esc(fmtTime(rec.request.receivedAt)) + '</div></td>' +
        '<td>' + esc(names || '—') + '</td>' +
        '<td>' + esc(rec.approval.assignee ? (rec.approval.assignee.name + (rec.approval.assignee.org ? ' (' + rec.approval.assignee.org + ')' : '')) : '미지정') + '</td>' +
        '<td>' + (rec.route ? (rec.route.confirmed ? '<span class="trm-ok">확인 ' + esc(fmtTime(rec.route.confirmedAt)) + '</span>' : '<span class="trm-wait">확인 대기</span>') : '—') + '</td>' +
        '<td>' + (rec.delivery && rec.delivery.sent ? '<span class="trm-ok">전달 ' + esc(fmtTime(rec.delivery.sentAt)) + '</span>' : (rec.delivery ? '<span class="trm-wait">초안</span>' : '—')) + '</td>' +
        '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  function stepperHTML(rec) {
    var cur = stageIdx(rec.stage);
    return '<div class="trm-steps">' + STAGES.map(function (s, i) {
      var cls = i < cur ? ' done' : (i === cur ? ' on' : '');
      return '<div class="trm-step' + cls + '" title="' + esc(s.tip) + '"><i>' + s.icon + '</i><span>' + esc(s.l) + '</span></div>';
    }).join('<em class="trm-arrow">›</em>') + '</div>';
  }

  function kv(label, value, cls) {
    return '<div class="trm-f' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + '</span><b>' + (value === '' || value == null ? '—' : value) + '</b></div>';
  }

  function assetOf(id) {
    var list = assets();
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
    return null;
  }

  function assetDetailHTML(a) {
    if (!a) return '<p class="trm-note">자산 DB에서 이 건을 찾지 못했습니다(삭제·이름 변경 가능).</p>';
    var priceBasis = priceOf(a);
    var rent = rentOf(a);
    var src = srcOf(a);
    var h = '<div class="trm-adt">';
    h += '<div class="trm-adt-head"><b>' + esc(a.name) + '</b>' +
      '<span class="trm-tag">' + esc(SECTOR_LABEL[a.sector] || a.sector || '') + '</span></div>';
    h += '<div class="trm-adt-grid">';
    h += kv('권역·주소', esc([a.region, a.address].filter(Boolean).join(' · ')));
    h += kv('규모', esc(a.scale_info || '미확보'));
    h += kv('가격', esc(a.price_info || '미확보') + (priceBasis ? '<em class="trm-basis">' + esc(priceBasis.basis) + ' 기준</em>' : ''));
    h += kv('임대조건', rent ? esc('평당 ' + rent.perPyeong + '만원') : esc(factOf(a, ['임대료']) || '미확보'));
    h += kv('상태', esc([a.status, a.status_group].filter(Boolean).join(' · ') || '미확보'));
    h += kv('운용·소유', esc(a.owner_amc || '미확보'));
    h += '</div>';
    h += '<div class="trm-adt-facts">';
    (a.facts || []).slice(0, 10).forEach(function (f) {
      h += '<span><i>' + esc(f.label || '') + '</i>' + esc(String(f.value || '').slice(0, 90)) + '</span>';
    });
    h += '</div>';
    if (src) {
      h += '<div class="trm-adt-src"><b>출처</b> ' + esc(src) +
        (naiSourced(a) ? ' <span class="trm-src-tag">' + esc(nai()) + '</span>' : '') + '</div>';
    } else {
      h += '<div class="trm-adt-src"><b>출처</b> 미확인</div>';
    }
    h += '<div class="trm-adt-acts">' +
      '<button type="button" class="mini-btn" data-trm-map="' + esc(a.id) + '">🗺️ 지도에서 보기</button>' +
      '<button type="button" class="mini-btn" data-trm-pick="' + esc(a.id) + '">이 자산을 후보로 지정</button>' +
      '</div>';
    return h;
  }

  function evidenceHTML(ev) {
    var LBL = { match: '일치', partial: '부분', miss: '불일치', unknown: '미확보' };
    return '<div class="trm-ev">' + ev.map(function (e) {
      return '<div class="trm-ev-row st-' + e.state + '">' +
        '<span class="trm-ev-k">' + esc(e.label) + '</span>' +
        '<span class="trm-ev-v">' + esc(e.detail || '') + '</span>' +
        '<span class="trm-ev-p">' + (e.state === 'unknown' ? '—' : (e.pts + '/' + e.max)) + '</span>' +
        '<span class="trm-ev-s">' + esc(LBL[e.state] || e.state) + '</span></div>';
    }).join('') + '</div>';
  }

  function candidatesHTML(rec, run) {
    if (!run) return '<p class="hub-empty">아직 후보를 만들지 않았습니다.</p>';
    if (!run.candidates.length) {
      return '<p class="hub-empty">조건에 맞는 후보가 없습니다 — 섹터·권역 기준을 넘는 자산이 없습니다. ' +
        '<b>대체 후보 직접 지정</b>으로 자산을 골라 추가할 수 있습니다.</p>';
    }
    var h = '<div class="trm-cands">';
    run.candidates.forEach(function (c, i) {
      var a = assetOf(c.assetId);
      var dec = c.decision;
      h += '<article class="trm-cand' + (dec === 'approved' ? ' is-ok' : (dec === 'excluded' ? ' is-no' : '')) + '">';
      h += '<div class="trm-cand-head">';
      h += '<span class="trm-rank">' + (i + 1) + '</span>';
      h += '<span class="trm-cand-name"><b>' + esc(c.name || (a && a.name) || c.assetId) + '</b>' +
        '<em>' + esc((c.region || (a && a.region) || '') + ' · ' + (SECTOR_LABEL[c.sector] || c.sector || '')) + '</em></span>';
      h += '<span class="trm-score" title="전체 가중치 기준 점수 · 미확보 항목은 0점"><b>' + c.score.pct + '</b><i>%</i>' +
        '<u>확보율 ' + (c.score.coverage != null ? c.score.coverage : 100) + '% · 미확보 ' + (c.score.unknown || 0) + '항목</u></span>';
      h += '</div>';
      h += evidenceHTML(c.evidence);
      h += '<div class="trm-cand-acts">' +
        '<button type="button" class="mini-btn' + (dec === 'approved' ? ' on' : '') + '" data-trm-dec="approve" data-trm-id="' + esc(c.assetId) + '">✅ 승인</button>' +
        '<button type="button" class="mini-btn' + (dec === 'excluded' ? ' danger' : '') + '" data-trm-dec="exclude" data-trm-id="' + esc(c.assetId) + '">✕ 제외</button>' +
        '<button type="button" class="mini-btn" data-trm-open="' + esc(c.assetId) + '">자산 상세</button>' +
        (dec ? '<span class="trm-dec">' + (dec === 'approved' ? '승인됨' : '제외됨') + (c.decidedAt ? ' · ' + esc(fmtTime(c.decidedAt)) : '') + '</span>' : '') +
        '</div>';
      h += '<div class="trm-assetbox hidden" id="trmAsset-' + esc(c.assetId) + '">' + assetDetailHTML(a) + '</div>';
      h += '</article>';
    });
    h += '</div>';
    h += '<p class="trm-note">점수는 <b>가중치 합계(100) 기준</b>입니다 — 데이터가 없는 항목은 <b>미확보</b>로 0점 처리되고, 옆에 확보율·미확보 항목 수를 함께 표시합니다. ' +
      '자산 지표는 매입가·감정가·IR 자료 기준이므로 호가와 다를 수 있습니다.</p>';
    return h;
  }

  function assigneeOptions(sel) {
    var list = SET().assignees || [];
    var h = '<option value="">— 담당자 선택 —</option>';
    list.forEach(function (a) {
      h += '<option value="' + esc(a.id) + '"' + (sel === a.id ? ' selected' : '') + '>' +
        esc(a.name + (a.org ? ' · ' + a.org : '')) + '</option>';
    });
    if (sel && !list.filter(function (a) { return a.id === sel; }).length) {
      h += '<option value="' + esc(sel) + '" selected>' + esc(sel) + ' (목록에 없음)</option>';
    }
    return h;
  }

  function approvalHTML(rec) {
    var ap = rec.approval || {};
    var run = currentRun(rec);
    var nOk = (ap.approved || []).length;
    var h = '<div class="trm-sec"><h4>③ 관리자 확인</h4>';
    h += '<p class="trm-note">후보를 <b>승인</b>해야 다음 단계(담당자 연결)로 넘어갑니다. 승인 전에는 큐로 보낼 수 없습니다. ' +
      (SET().approvalMode === 'auto' ? '<b class="trm-warn">지금은 자동 승인 모드(실험)</b>입니다.' : '승인 방식: <b>관리자 확인</b>(approvalMode=admin).') + '</p>';
    h += '<div class="trm-approve-grid">';
    h += '<label class="trm-field wide"><span>검토 메모 (판단 이유 — 학습 데이터로 저장됩니다)</span>' +
      '<textarea id="trmMemo" rows="3" placeholder="예) 용인권 후보 2건이 규모·권역 일치. 임대료는 미확보라 조건 확인 필요.">' + esc(ap.memo || '') + '</textarea></label>';
    h += '<label class="trm-field"><span>담당자</span><select id="trmAssignee">' + assigneeOptions(ap.assignee && ap.assignee.id) + '</select></label>';
    h += '<label class="trm-field"><span>담당 조직 · 구분</span><input id="trmAssigneeOrg" type="text" value="' + esc((ap.assignee && ap.assignee.org) || '') + '" placeholder="예) 물류팀 / 파트너사명"></label>';
    h += '</div>';
    h += '<div class="trm-approve-sum">승인 후보 <b>' + nOk + '</b>건' +
      (nOk ? '' : ' <em>— 후보 카드에서 ✅ 승인을 눌러 주세요</em>') +
      (ap.assignee ? ' · 담당자 <b>' + esc(ap.assignee.name) + '</b>' : ' · 담당자 미지정') + '</div>';
    h += '<div class="trm-acts">';
    h += '<button type="button" class="btn btn-outline" data-trm-act="save">💾 메모·담당자 저장</button>';
    h += '<button type="button" class="btn btn-primary" data-trm-act="approve"' + (nOk ? '' : ' disabled') + '>✅ 승인 확정</button>';
    h += '<button type="button" class="btn btn-primary" data-trm-act="route"' +
      ((nOk && stageIdx(rec.stage) >= stageIdx('approved') && ap.assignee) ? '' : ' disabled') + '>🔗 담당자 큐로 보내기</button>';
    h += '</div>';
    if (!ap.assignee) h += '<p class="trm-note">담당자 목록이 비어 있으면 아래 <b>⚙️ 설정</b>에서 담당자·조직을 추가하세요. (추측으로 채우지 않습니다)</p>';
    h += '</div>';
    return h;
  }

  function routeHTML(rec) {
    if (!rec.route) return '';
    var r = rec.route;
    var h = '<div class="trm-sec"><h4>④ 담당자 연결</h4>';
    h += '<div class="trm-route">';
    h += '<div><span>담당자</span><b>' + esc(r.assignee ? r.assignee.name : '—') + (r.assignee && r.assignee.org ? ' · ' + esc(r.assignee.org) : '') + '</b></div>';
    h += '<div><span>큐</span><b>' + esc(r.queue || '담당자 큐') + '</b></div>';
    h += '<div><span>보낸 시각</span><b>' + esc(fmtTime(r.at)) + '</b></div>';
    h += '<div><span>담당자 확인</span><b>' + (r.confirmed ? '<span class="trm-ok">확인 완료 ' + esc(fmtTime(r.confirmedAt)) + '</span>' : '<span class="trm-wait">대기</span>') + '</b></div>';
    h += '</div>';
    h += '<div class="trm-acts">';
    h += '<button type="button" class="btn btn-outline" data-trm-act="confirm"' + (r.confirmed ? ' disabled' : '') + '>☑ 담당자 확인 완료로 표시</button>';
    h += '<button type="button" class="btn btn-primary" data-trm-act="draft" data-trm-mode="build">✉️ 요청자 전달 초안 만들기</button>';
    h += '</div>';
    h += '<p class="trm-note">담당자 화면·외부 시스템으로의 자동 전송은 하지 않습니다. 큐는 이 플랫폼 안의 상태 기록입니다.</p>';
    h += '</div>';
    return h;
  }

  function draftHTML(rec) {
    if (!rec.delivery) return '';
    var d = rec.delivery;
    var row = reqById(rec.rid);
    var to = row && row.email ? row.email : '';
    var h = '<div class="trm-sec"><h4>⑤ 요청자 전달 (초안 · 자동 발송 없음)</h4>';
    h += '<label class="trm-field wide"><span>제목</span><input id="trmDraftSubj" type="text" value="' + esc(d.subject) + '"></label>';
    h += '<label class="trm-field wide"><span>본문 (미리보기 · 수정 가능)</span><textarea id="trmDraftBody" rows="10">' + esc(d.body) + '</textarea></label>';
    h += '<div class="trm-route"><div><span>받는 사람</span><b>' + esc(to || '요청자 이메일 미확인 — 직접 입력 필요') + '</b></div>' +
      '<div><span>초안 생성</span><b>' + esc(fmtTime(d.at)) + '</b></div>' +
      '<div><span>전달</span><b>' + (d.sent ? '<span class="trm-ok">전달 표시 ' + esc(fmtTime(d.sentAt)) + '</span>' : '<span class="trm-wait">미전달(초안)</span>') + '</b></div></div>';
    h += '<div class="trm-acts">';
    h += '<button type="button" class="btn btn-outline" data-trm-act="draft-save">💾 초안 저장</button>';
    h += '<button type="button" class="btn btn-primary" data-trm-act="draft-mail">📮 메일 초안 열기(내 메일앱)</button>';
    h += '<button type="button" class="btn btn-outline" data-trm-act="draft-sent"' + (d.sent ? ' disabled' : '') + '>✅ 전달 완료로 표시</button>';
    h += '<button type="button" class="btn btn-outline" data-trm-act="close-case">🏁 종결</button>';
    h += '</div>';
    h += '<p class="trm-note">메일은 이 브라우저의 메일 앱에서 열립니다 — 보내기는 관리자가 직접 누릅니다. 플랫폼은 자동 발송하지 않습니다.</p>';
    h += '<p class="trm-note">발신 표기: <b>' + esc(platName()) + '</b>' + (platContact() ? ' · ' + esc(platContact()) : '') +
      ' — 개인 실명·직함·회사명은 넣지 않습니다(config.js PLATFORM).</p>';
    h += '</div>';
    return h;
  }

  var ACTION_LABEL = {
    review_opened: '검토 시작', candidates_generated: 'AI 후보 생성', candidate_approved: '후보 승인',
    candidate_excluded: '후보 제외', candidate_cleared: '판단 취소', candidate_alternative: '대체 후보 지정',
    review_saved: '메모·담당자 저장', approved_by_admin: '관리자 승인 확정', approved_auto: '자동 승인(설정)',
    routed: '담당자 큐로 이동', assignee_confirmed: '담당자 확인 완료', draft_built: '전달 초안 생성',
    draft_saved: '초안 저장', draft_mail_opened: '메일 초안 열기', delivered: '전달 완료 표시', closed: '종결'
  };
  function historyHTML(rec) {
    var hist = (rec.history || []).slice(-12).reverse();
    if (!hist.length) return '';
    return '<div class="trm-sec"><h4>이력</h4><ul class="trm-hist">' + hist.map(function (h) {
      return '<li><em>' + esc(fmtTime(h.at)) + '</em><span>' + esc(h.by || '관리자') + '</span>' +
        '<b>' + esc(stageOf(h.stage).l) + '</b>' + esc(ACTION_LABEL[h.action] || h.action || '') + (h.note ? ' — ' + esc(h.note) : '') + '</li>';
    }).join('') + '</ul></div>';
  }

  function detailHTML() {
    var row = reqById(ST.sel);
    if (!row) return '<div class="trm-empty"><b>왼쪽에서 접수 건을 선택하세요.</b><p>접수 조건을 확인하고 AI 후보 → 관리자 승인 → 담당자 연결 → 요청자 전달 순으로 진행합니다.</p></div>';
    var rec = reviewOf(row, true);
    var run = currentRun(rec);
    var P = rec.request.norm;
    var h = '<div class="trm-detail">';
    h += '<div class="trm-dhead"><div><b>' + esc(row.title) + '</b>' +
      '<p>' + esc(row.type) + ' · 접수 ' + esc(fmtTime(row.at)) + (row.id ? ' · ID ' + esc(row.id) : '') + '</p></div>' + stageBadge(rec) + '</div>';
    h += stepperHTML(rec);
    h += '<div class="trm-sec"><h4>① 요청 조건</h4><div class="trm-fgrid">';
    h += kv('거래 구분', esc(P.deal || row.deal || ''));
    h += kv('섹터', esc(P.sectorLabel || SECTOR_LABEL[P.sector] || '미확인'));
    h += kv('권역', esc((P.cities || []).concat((P.regions || []).filter(function (x) { return P.cities.indexOf(x) < 0; })).join(' · ') || '미확인'));
    h += kv('규모', esc(row.areaText || (P.area && P.area.text) || '미확인'));
    h += kv('가격·임대료', esc([row.price, row.rent].filter(Boolean).join(' / ') || '미확인'));
    h += kv('희망 시점', esc(row.timeline || '미확인'));
    h += kv('요청자', esc([row.company, row.name2 || row.name].filter(Boolean).join(' · ') || '미확인'));
    h += kv('연락', esc([row.phone, row.email].filter(Boolean).join(' / ') || '미확인'));
    h += '</div>';
    if (row.memo) h += '<details class="trm-memo"><summary>접수 원문 보기</summary><p>' + esc(row.memo) + '</p></details>';
    h += '</div>';

    h += '<div class="trm-sec"><div class="trm-sec-head"><h4>② AI 매칭 후보</h4>' +
      '<span class="trm-sec-tools">자산 ' + nfmt(assets().length) + '건 기준 · 모델 rule-v1' +
      ' · <button type="button" class="mini-btn" data-trm-act="rematch">↻ 다시 생성</button></span></div>';
    h += candidatesHTML(rec, run);
    h += '<div class="trm-picker"><label class="trm-field wide"><span>대체 후보 직접 지정 (자산명·주소 검색)</span>' +
      '<input id="trmPickQ" type="search" value="' + esc(ST.picker || '') + '" placeholder="예) 용인 물류 / 이천 냉동 / 종로 타워"></label>';
    if (ST.picker) h += '<div class="trm-pickresults">' + pickResultsHTML() + '</div>';
    h += '</div>';
    h += '</div>';

    h += approvalHTML(rec);
    h += routeHTML(rec);
    h += draftHTML(rec);
    h += historyHTML(rec);
    h += '</div>';
    return h;
  }

  function pickResultsHTML() {
    var q = ST.picker.trim().toLowerCase();
    if (!q) return '';
    var list = assets().filter(function (a) {
      return (String(a.name || '') + ' ' + String(a.address || '')).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 8);
    if (!list.length) return '<p class="hub-empty">검색 결과가 없습니다.</p>';
    return list.map(function (a) {
      return '<div class="trm-pickrow"><span><b>' + esc(a.name) + '</b><em>' + esc((a.address || '') + ' · ' + (SECTOR_LABEL[a.sector] || a.sector || '')) + '</em></span>' +
        '<button type="button" class="mini-btn" data-trm-pick="' + esc(a.id) + '">＋ 후보 추가</button></div>';
    }).join('');
  }

  function settingsHTML() {
    var s = SET();
    var h = '<div class="trm-detail"><div class="trm-dhead"><div><b>⚙️ 매칭 검토 설정</b>' +
      '<p>담당자 목록·점수 가중치·승인 방식을 정합니다. 설정은 이 브라우저에 저장됩니다.</p></div></div>';
    h += '<div class="trm-sec"><h4>승인 방식</h4><div class="trm-fgrid">';
    h += '<label class="trm-field"><span>approvalMode</span><select id="trmMode">' +
      '<option value="admin"' + (s.approvalMode === 'admin' ? ' selected' : '') + '>admin — 관리자 확인(현재)</option>' +
      '<option value="auto"' + (s.approvalMode === 'auto' ? ' selected' : '') + '>auto — 자동 승인(실험·구조만)</option>' +
      '</select></label>';
    h += '<label class="trm-field"><span>후보 수(topN)</span><input id="trmTopN" type="number" min="3" max="20" value="' + (s.topN || 8) + '"></label>';
    h += '<label class="trm-field"><span>최소 점수(%)</span><input id="trmMinScore" type="number" min="20" max="90" value="' + (s.minScore || 45) + '"></label>';
    h += '</div><p class="trm-note">‘auto’는 승인 단계를 나중에 AI로 대체할 자리만 열어 둔 것입니다. 자동 발송·자동 라우팅은 어떤 모드에서도 하지 않습니다.</p></div>';
    h += '<div class="trm-sec"><h4>점수 가중치</h4><div class="trm-wgrid">';
    Object.keys(s.weights).forEach(function (k) {
      h += '<label class="trm-field"><span>' + esc(WEIGHT_LABEL[k] || k) + '</span><input data-w="' + k + '" type="number" min="0" max="50" value="' + s.weights[k] + '"></label>';
    });
    h += '</div><p class="trm-note">가중치는 확보된 항목만으로 100% 환산합니다. 미확보 항목이 있으면 그 항목은 분모에서 빠집니다.</p></div>';
    h += '<div class="trm-sec"><div class="trm-sec-head"><h4>담당자 · 담당 조직</h4>' +
      '<span class="trm-sec-tools"><button type="button" class="mini-btn" data-trm-act="import-partners">설정의 공유 그룹·파트너에서 불러오기</button></span></div>';
    if (!(s.assignees || []).length) {
      h += '<p class="hub-empty">등록된 담당자가 없습니다. 아래에서 직접 추가하세요. (이름을 추측해 넣지 않습니다)</p>';
    } else {
      h += '<div class="trm-tablewrap"><table class="hub-table"><thead><tr><th>담당자</th><th>조직·구분</th><th>메모</th><th>관리</th></tr></thead><tbody>';
      s.assignees.forEach(function (a) {
        h += '<tr><td><b>' + esc(a.name) + '</b></td><td>' + esc(a.org || '—') + '</td><td>' + esc(a.note || '') + '</td>' +
          '<td><button type="button" class="mini-btn danger" data-trm-delassignee="' + esc(a.id) + '">삭제</button></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '<div class="trm-approve-grid"><label class="trm-field"><span>담당자명 · 역할명</span><input id="trmNewName" type="text" placeholder="예) 물류 담당 / 파트너 A"></label>' +
      '<label class="trm-field"><span>조직 · 구분</span><input id="trmNewOrg" type="text" placeholder="예) 물류팀 / 아이스케어"></label>' +
      '<label class="trm-field"><span>메모</span><input id="trmNewNote" type="text" placeholder="예) 수도권 물류 담당"></label></div>';
    h += '<div class="trm-acts"><button type="button" class="btn btn-primary" data-trm-act="add-assignee">＋ 담당자 추가</button>' +
      '<span class="hub-spacer"></span><button type="button" class="btn btn-outline" data-trm-act="save-settings">설정 저장</button></div>';
    h += '</div>';
    h += '<div class="trm-sec"><h4>데이터</h4><p class="trm-note">접수·매칭·승인·라우팅·전달 이력을 JSON/CSV로 내려받습니다. 원격 저장은 접수 상태 열만 반영됩니다.</p>' +
      '<div class="trm-acts"><button type="button" class="btn btn-outline" data-trm-act="export-json">⬇ JSON 내보내기</button>' +
      '<button type="button" class="btn btn-outline" data-trm-act="export-csv">⬇ CSV 내보내기</button>' +
      '<button type="button" class="btn btn-outline" data-trm-act="store-info">저장 상태</button></div></div>';
    h += '</div>';
    return h;
  }

  function shellHTML() {
    var h = '';
    h += '<div class="tr-card trm-card" role="dialog" aria-modal="true" aria-label="접수 매칭 검토">';
    h += '<div class="tr-head trm-head"><div><h3>🧠 접수 매칭 검토</h3>' +
      '<p>접수 → AI 후보 → <b>관리자 승인</b> → 담당자 연결 → 요청자 전달. 승인 전에는 다음 단계로 넘어가지 않습니다.</p></div>' +
      '<button type="button" class="tr-x" data-trm="close" aria-label="닫기">×</button></div>';
    h += '<div class="trm-kpis" id="trmKpi">' + kpi() + '</div>';
    h += '<div class="trm-tabs">' +
      '<button type="button" class="trm-tab' + (ST.view === 'inbox' ? ' on' : '') + '" data-trm-view="inbox">📥 접수 인박스</button>' +
      '<button type="button" class="trm-tab' + (ST.view === 'queue' ? ' on' : '') + '" data-trm-view="queue">🔗 담당자 큐 <b>' + queueRows().length + '</b></button>' +
      '<button type="button" class="trm-tab' + (ST.view === 'settings' ? ' on' : '') + '" data-trm-view="settings">⚙️ 설정</button>' +
      '<span class="hub-spacer"></span>' +
      '<span class="trm-savehint" title="상세 레코드는 이 브라우저에 저장됩니다">💾 로컬 저장 · 접수 상태는 시트 미러링</span>' +
      '</div>';
    h += '<div class="trm-body">';
    if (ST.view === 'inbox') {
      h += '<aside class="trm-side">';
      h += '<div class="trm-tools"><div class="trm-chips">' + typeChips() + '</div>' +
        '<input id="trmQ" type="search" value="' + esc(ST.q) + '" placeholder="접수 검색 (제목·권역·회사)" autocomplete="off">' +
        '<button type="button" class="mini-btn" data-trm="reload">↻</button></div>';
      h += '<div class="trm-listwrap">' + (ST.loading ? '<p class="hub-empty">불러오는 중…</p>' : listHTML()) + '</div>';
      h += '</aside>';
      h += '<section class="trm-main">' + detailHTML() + '</section>';
    } else if (ST.view === 'queue') {
      h += '<section class="trm-fullwrap">' + queueHTML() + '</section>';
    } else {
      h += '<section class="trm-fullwrap">' + settingsHTML() + '</section>';
    }
    h += '</div>';
    h += '</div>';
    return h;
  }

  function render() {
    var host = ensureHost();
    var sc = host.querySelector('.trm-main');
    var keepScroll = sc ? sc.scrollTop : 0;
    host.innerHTML = shellHTML();
    var body = host.querySelector('.trm-main');
    if (body && keepScroll) body.scrollTop = keepScroll;
    if (window.OAAB_GROW) {
      var card = host.querySelector('.trm-card');
      if (card) window.OAAB_GROW.attach(card, { head: '.trm-head' });
    }
    bind();
  }

  /* ───────────────────────── 이벤트 ───────────────────────── */
  function bind() {
    var host = $('#trReviewModal');
    if (!host) return;
    host.onclick = function (e) {
      if (e.target === host) { /* 바깥 클릭은 닫지 않음(실수 방지) */ return; }
      var t;
      if ((t = e.target.closest('[data-trm="close"]'))) { close(); return; }
      if ((t = e.target.closest('[data-trm="reload"]'))) { ST.loaded = false; loadRequests(true); return; }
      if ((t = e.target.closest('[data-trm-view]'))) { ST.view = t.getAttribute('data-trm-view'); render(); return; }
      if ((t = e.target.closest('[data-trm-filter]'))) { ST.filter = t.getAttribute('data-trm-filter'); render(); return; }
      if ((t = e.target.closest('[data-trm-sel]'))) {
        ST.sel = t.getAttribute('data-trm-sel'); ST.view = 'inbox'; ST.picker = ''; render(); return;
      }
      if ((t = e.target.closest('[data-trm-dec]'))) { decide(t.getAttribute('data-trm-id'), t.getAttribute('data-trm-dec')); return; }
      if ((t = e.target.closest('[data-trm-open]'))) {
        var box = $('#trmAsset-' + t.getAttribute('data-trm-open'));
        if (box) box.classList.toggle('hidden');
        return;
      }
      if ((t = e.target.closest('[data-trm-pick]'))) { addPick(t.getAttribute('data-trm-pick')); return; }
      if ((t = e.target.closest('[data-trm-map]'))) {
        var aid = t.getAttribute('data-trm-map');
        close();
        if (window.naiShowView) window.naiShowView('map');
        if (window.naiMap && window.naiMap.select) window.naiMap.select(aid);
        return;
      }
      if ((t = e.target.closest('[data-trm-delassignee]'))) { delAssignee(t.getAttribute('data-trm-delassignee')); return; }
      var act = e.target.closest('[data-trm-act]');
      if (act) { doAct(act.getAttribute('data-trm-act')); return; }
    };
    var q = $('#trmQ');
    if (q) {
      q.addEventListener('input', function () { ST.q = q.value; refreshList(); });
    }
    var pq = $('#trmPickQ');
    if (pq) {
      pq.addEventListener('input', function () {
        ST.picker = pq.value;
        var wrap = host.querySelector('.trm-pickresults');
        var html = pickResultsHTML();
        if (wrap) wrap.innerHTML = html;
        else if (html) {
          var d = document.createElement('div');
          d.className = 'trm-pickresults';
          d.innerHTML = html;
          pq.parentNode.parentNode.appendChild(d);
        }
      });
    }
    var mode = $('#trmMode'); /* 설정 화면은 저장 버튼에서 읽습니다 */
  }

  function refreshList() {
    var wrap = $('.trm-listwrap');
    if (wrap) wrap.innerHTML = listHTML();
    var chips = $('.trm-chips');
    if (chips) chips.innerHTML = typeChips();
    var kp = $('#trmKpi');
    if (kp) kp.innerHTML = kpi();
  }

  function rec() {
    var row = reqById(ST.sel);
    if (!row) { toast('접수 건을 먼저 선택하세요.', true); return null; }
    return reviewOf(row, true);
  }

  function syncStatus(id, stage) {
    var row = reqById(id);
    var status = SERVER_STATUS[stage];
    if (!row || !status || String(id).indexOf('local-') === 0) return Promise.resolve({ ok: false, error: 'local' });
    return apiPost({ action: 'submission_status', kind: 'lois', id: id, status: status })
      .then(function (j) { return j || { ok: false }; });
  }

  /** 다시 그리기 전에 입력 중인 메모·담당자를 레코드에 보존합니다(렌더로 입력이 날아가지 않게) */
  function stashForm(r) {
    if (!r) return;
    var memo = $('#trmMemo');
    if (memo) r.approval.memo = String(memo.value || '');
    var aid = $('#trmAssignee');
    if (aid && aid.value) {
      var org = $('#trmAssigneeOrg');
      var found = (SET().assignees || []).filter(function (a) { return a.id === aid.value; })[0];
      r.approval.assignee = { id: aid.value, name: found ? found.name : aid.value, org: (org ? String(org.value || '') : '') || (found && found.org) || '' };
    }
  }

  function decide(assetId, what) {
    var r = rec(); if (!r) return;
    stashForm(r);
    var run = currentRun(r); if (!run) return;
    var c = run.candidates.filter(function (x) { return String(x.assetId) === String(assetId); })[0];
    if (!c) return;
    if (r.stage !== 'received' && r.stage !== 'matched' && r.stage !== 'approved') {
      toast('이미 다음 단계로 넘어간 건입니다. 다시 검토하려면 ‘다시 생성’ 후 승인하세요.', true);
      return;
    }
    var want = what === 'approve' ? 'approved' : (c.decision === (what === 'approve' ? 'approved' : 'excluded') ? '' : 'excluded');
    c.decision = want;
    c.decidedAt = want ? nowISO() : '';
    r.approval.approved = run.candidates.filter(function (x) { return x.decision === 'approved'; }).map(function (x) { return x.assetId; });
    r.approval.excluded = run.candidates.filter(function (x) { return x.decision === 'excluded'; }).map(function (x) { return x.assetId; });
    if (r.stage === 'approved' && !r.approval.approved.length) r.stage = 'matched';
    pushHistory(r, want ? ('candidate_' + want) : 'candidate_cleared', c.name);
    saveStore();
    render();
  }

  function addPick(assetId) {
    var r = rec(); if (!r) return;
    stashForm(r);
    var run = currentRun(r);
    if (!run) return;
    if (run.candidates.filter(function (c) { return String(c.assetId) === String(assetId); }).length) {
      toast('이미 후보에 있는 자산입니다.');
      return;
    }
    var a = assetOf(assetId);
    if (!a) return;
    var s = scoreAsset(r.request.norm, a, SET().weights);
    run.candidates.push({
      assetId: String(a.id), name: a.name, sector: a.sector, region: a.region || '',
      score: { pct: s.pct, fit: s.fit, coverage: s.coverage, earned: s.earned, max: s.max, total: s.total, unknown: s.unknown },
      evidence: s.evidence.concat([{ k: 'manual', label: '관리자 지정', state: 'match', pts: 0, max: 0, detail: '관리자가 직접 추가' }]),
      decision: 'approved', decidedAt: nowISO(), note: '관리자 직접 지정(대체 후보)'
    });
    r.approval.approved = run.candidates.filter(function (x) { return x.decision === 'approved'; }).map(function (x) { return x.assetId; });
    pushHistory(r, 'candidate_alternative', a.name);
    saveStore();
    ST.picker = '';
    render();
    toast('대체 후보로 추가하고 승인했습니다.');
  }

  function doAct(act) {
    var r = rec(); if (!r) return;
    if (['rematch', 'draft', 'draft-mail', 'draft-sent', 'close-case'].indexOf(act) >= 0) stashForm(r);
    var host = $('#trReviewModal');
    var q = function (id) { var el = $('#' + id); return el ? String(el.value || '').trim() : ''; };
    if (act === 'save') {
      r.approval.memo = q('trmMemo');
      var aid = q('trmAssignee');
      var org = q('trmAssigneeOrg');
      var found = (SET().assignees || []).filter(function (a) { return a.id === aid; })[0];
      r.approval.assignee = aid ? { id: aid, name: found ? found.name : aid, org: org || (found && found.org) || '' } : null;
      pushHistory(r, 'review_saved', '메모·담당자 저장');
      saveStore(); render(); toast('저장했습니다.');
      return;
    }
    if (act === 'approve') {
      if (!r.approval.approved.length) { toast('승인할 후보를 먼저 선택하세요.', true); return; }
      r.approval.memo = q('trmMemo') || r.approval.memo;
      var aid2 = q('trmAssignee'); var org2 = q('trmAssigneeOrg');
      if (aid2) {
        var f2 = (SET().assignees || []).filter(function (a) { return a.id === aid2; })[0];
        r.approval.assignee = { id: aid2, name: f2 ? f2.name : aid2, org: org2 || (f2 && f2.org) || '' };
      }
      r.approval.at = nowISO();
      r.approval.by = '관리자';
      r.stage = 'approved';
      pushHistory(r, 'approved_by_admin', r.approval.approved.length + '건 승인');
      saveStore();
      syncStatus(r.rid, r.stage).then(function (j) {
        render();
        toast(j && j.ok ? '승인했습니다. 접수 상태도 시트에 반영했습니다.' : '승인했습니다. (시트 상태 반영은 실패 — 로컬 저장)', !(j && j.ok));
      });
      return;
    }
    if (act === 'route') {
      if (!r.approval.approved.length) { toast('승인된 후보가 없습니다.', true); return; }
      if (stageIdx(r.stage) < stageIdx('approved')) { toast('먼저 승인을 확정하세요.', true); return; }
      if (!r.approval.assignee) { toast('담당자를 지정해야 큐로 보낼 수 있습니다.', true); return; }
      r.route = {
        at: nowISO(), assignee: r.approval.assignee, queue: '담당자 큐',
        confirmed: false, confirmedAt: ''
      };
      r.stage = 'routed';
      pushHistory(r, 'routed', (r.approval.assignee.name + ' · ' + r.approval.assignee.org));
      saveStore();
      syncStatus(r.rid, r.stage).then(function (j) {
        render();
        toast(j && j.ok ? '담당자 큐로 보냈습니다. (시트 상태 반영)' : '담당자 큐로 보냈습니다. (로컬 저장)', !(j && j.ok));
      });
      return;
    }
    if (act === 'confirm') {
      if (!r.route) return;
      r.route.confirmed = true; r.route.confirmedAt = nowISO();
      pushHistory(r, 'assignee_confirmed', r.route.assignee.name);
      saveStore(); render(); toast('담당자 확인 완료로 표시했습니다.');
      return;
    }
    if (act === 'draft') {
      buildDraft(r); return;
    }
    if (act === 'draft-save') {
      if (!r.delivery) return;
      r.delivery.subject = q('trmDraftSubj');
      r.delivery.body = q('trmDraftBody');
      pushHistory(r, 'draft_saved', '');
      saveStore(); render(); toast('초안을 저장했습니다.');
      return;
    }
    if (act === 'draft-mail') {
      if (!r.delivery) return;
      var row = reqById(r.rid);
      var to = (row && row.email) || '';
      var url = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(r.delivery.subject) +
        '&body=' + encodeURIComponent(r.delivery.body);
      if (url.length > 7000) {
        toast('본문이 길어 메일앱으로 넘길 수 없습니다 — 본문을 복사해 사용하세요.', true);
        return;
      }
      try { window.open(url, '_blank'); } catch (e) { location.href = url; }
      pushHistory(r, 'draft_mail_opened', to ? '메일앱 열기' : '수신자 미확인');
      saveStore();
      toast('메일 초안을 열었습니다. 보내기는 직접 확인 후 눌러 주세요.');
      return;
    }
    if (act === 'draft-sent') {
      if (!r.delivery) return;
      r.delivery.sent = true; r.delivery.sentAt = nowISO();
      r.stage = 'delivered';
      pushHistory(r, 'delivered', '관리자 전달 표시');
      saveStore();
      syncStatus(r.rid, r.stage).then(function (j) { render(); toast('전달 완료로 표시했습니다.'); });
      return;
    }
    if (act === 'close-case') {
      r.stage = 'closed';
      pushHistory(r, 'closed', '');
      saveStore(); syncStatus(r.rid, r.stage); render(); toast('종결로 표시했습니다.');
      return;
    }
    if (act === 'rematch') {
      if (!runMatch(r, true)) { toast('담당자·전달 단계로 넘어간 건은 후보를 다시 만들 수 없습니다.', true); return; }
      saveStore(); render(); toast('후보를 다시 만들었습니다(이전 결과는 이력에 남습니다).');
      return;
    }
    if (act === 'save-settings') {
      var s = SET();
      var mode = q('trmMode'); if (mode) s.approvalMode = mode;
      var tn = Number(q('trmTopN')); if (tn) s.topN = tn;
      var ms = Number(q('trmMinScore')); if (ms) s.minScore = ms;
      $$('[data-w]', host).forEach(function (el) {
        var k = el.getAttribute('data-w'); var v = Number(el.value);
        if (k && isFinite(v)) s.weights[k] = v;
      });
      saveStore(); render(); toast('설정을 저장했습니다. 새로 만드는 후보부터 적용됩니다.');
      return;
    }
    if (act === 'add-assignee') {
      var name = q('trmNewName'), org = q('trmNewOrg'), note = q('trmNewNote');
      if (!name) { toast('담당자명·역할명을 입력하세요.', true); return; }
      var s2 = SET();
      s2.assignees = s2.assignees || [];
      s2.assignees.push({ id: 'as-' + Date.now().toString(36), name: name, org: org, note: note });
      saveStore(); render(); toast('담당자를 추가했습니다.');
      return;
    }
    if (act === 'import-partners') {
      var s3 = SET(); s3.assignees = s3.assignees || [];
      var add = 0;
      (CFG.SHARE_GROUPS || []).forEach(function (g) {
        if (!s3.assignees.some(function (a) { return a.name === g.name; })) {
          s3.assignees.push({ id: 'as-g-' + g.key, name: g.name, org: '공유 그룹', note: g.note || '' });
          add++;
        }
      });
      (CFG.PARTNERS || []).forEach(function (p, i) {
        if (!p.org) return;
        if (!s3.assignees.some(function (a) { return a.org === p.org; })) {
          s3.assignees.push({ id: 'as-p-' + i, name: p.org, org: p.role || '파트너', note: p.note || '' });
          add++;
        }
      });
      saveStore(); render();
      toast(add ? add + '개 담당자를 설정에서 불러왔습니다. 필요 없는 항목은 삭제하세요.' : '이미 모두 등록되어 있습니다.');
      return;
    }
    if (act === 'export-json') { exportJSON(); return; }
    if (act === 'export-csv') { exportCSV(); return; }
    if (act === 'store-info') {
      var size = 0;
      try { size = new Blob([JSON.stringify(DB)]).size; } catch (e) { size = String(JSON.stringify(DB)).length; }
      toast('레코드 ' + Object.keys(DB.reviews).length + '건 · 약 ' + Math.round(size / 1024) + 'KB · 저장 위치 localStorage(' + STORE_KEY + ')');
      return;
    }
    if (act === 'del-assignee') { /* 위임 처리 */ }
  }

  function delAssignee(id) {
    var s = SET();
    s.assignees = (s.assignees || []).filter(function (a) { return a.id !== id; });
    saveStore(); render(); toast('담당자를 삭제했습니다.');
  }

  /* ───────────────────────── 전달 초안 ───────────────────────── */
  function buildDraft(r) {
    var row = reqById(r.rid) || { title: '', company: '', name: '' };
    var run = currentRun(r);
    var names = (r.approval.approved || []).map(function (aid) {
      var c = run && run.candidates.filter(function (y) { return y.assetId === aid; })[0];
      return c ? { c: c, a: assetOf(aid) } : null;
    }).filter(Boolean);
    var P = r.request.norm;
    var L = [];
    L.push('안녕하세요, ' + platName() + '입니다.');
    L.push('');
    var areaTxt = row.areaText || '';
    if (/^[\d,]+$/.test(String(areaTxt).trim())) areaTxt = nfmt(Number(String(areaTxt).replace(/,/g, ''))) + '평';
    L.push('남겨 주신 임차·매입 조건(' + [P.sectorLabel || '', (P.cities || []).concat((P.regions || []).filter(function (x) { return P.cities.indexOf(x) < 0; })).slice(0, 3).join('·'), areaTxt, row.timeline].filter(Boolean).join(' · ') + ')에 대해 검토한 후보를 아래와 같이 정리했습니다.');
    L.push('');
    names.forEach(function (x, i) {
      var a = x.a || {};
      L.push((i + 1) + ') ' + (x.c.name || a.name || ''));
      if (a.address) L.push('   · 소재: ' + a.address);
      if (a.scale_info) L.push('   · 규모: ' + a.scale_info);
      if (a.price_info) L.push('   · 가격·조건: ' + a.price_info);
      if (a.status || a.status_group) L.push('   · 상태: ' + [a.status, a.status_group].filter(Boolean).join(' · '));
      if (a.source && naiSourced(a)) L.push('   · 출처: ' + nai() + ' 자료');
    });
    L.push('');
    L.push('상세 자료(도면·렌트롤·IM)는 비밀유지 약정(NDA) 후 제공 가능합니다. 회신 주시면 일정을 조율하겠습니다.');
    L.push('');
    L.push('감사합니다.');
    L.push(platName() + (platContact() ? ' · ' + platContact() : ''));
    var subject = '[' + platName() + '] ' + (r.request.type || '접수') + ' 조건 검토 후보 안내' + (names.length ? ' (' + names.length + '건)' : '');
    r.delivery = {
      subject: subject, body: L.join('\n'), at: nowISO(),
      sent: false, sentAt: '', channel: 'mailto'
    };
    if (stageIdx(r.stage) < stageIdx('draft')) r.stage = 'draft';
    pushHistory(r, 'draft_built', names.length + '건 후보 포함');
    saveStore();
    render();
    toast('전달 초안을 만들었습니다. 보내지 않아도 초안으로 저장됩니다.');
  }

  /* ───────────────────────── 내보내기 ───────────────────────── */
  function download(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
      return true;
    } catch (e) { toast('다운로드에 실패했습니다.', true); return false; }
  }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }
  function exportJSON() {
    var out = { v: 1, exportedAt: nowISO(), model: 'rule-v1', settings: DB.settings, reviews: DB.reviews };
    if (download('OAAB_접수매칭_검토이력_' + stamp() + '.json', JSON.stringify(out, null, 2), 'application/json;charset=utf-8')) {
      toast('JSON 으로 내보냈습니다 (레코드 ' + Object.keys(DB.reviews).length + '건).');
    }
  }
  function exportCSV() {
    var head = ['접수ID', '접수유형', '접수시각', '단계', '정규화_섹터', '정규화_권역', '정규화_면적', '정규화_금액', '정규화_시점',
      '후보순번', '후보자산ID', '후보자산명', '점수', '확보항목', '미확보항목', '판단', '판단시각', '판단메모',
      '담당자', '담당조직', '라우팅시각', '담당자확인', '전달여부', '전달시각', '관리자검토메모'];
    var lines = [];
    Object.keys(DB.reviews).forEach(function (id) {
      var r = DB.reviews[id];
      if (!r) return;
      var run = currentRun(r);
      var base = [id, r.request.type, r.request.receivedAt, stageOf(r.stage).l,
        r.request.norm.sectorLabel || '', (r.request.norm.cities || []).concat(r.request.norm.regions || []).join('·'),
        (r.request.norm.area && r.request.norm.area.text) || '', (r.request.norm.price && r.request.norm.price.text) || '',
        (r.request.norm.timing && r.request.norm.timing.text) || ''];
      if (!run || !run.candidates.length) { lines.push(base.concat(['', '', '', '', '', '', '', '', '', '', '', '', r.approval.memo || ''])); return; }
      run.candidates.forEach(function (c, i) {
        var evSu = c.evidence.filter(function (e) { return e.state !== 'unknown'; }).length;
        var evUn = c.evidence.filter(function (e) { return e.state === 'unknown'; }).length;
        lines.push(base.concat([
          i + 1, c.assetId, c.name, c.score.pct, evSu, evUn,
          c.decision === 'approved' ? '승인' : (c.decision === 'excluded' ? '제외' : '미판단'),
          c.decidedAt || '', (c.note || '').replace(/[,\n]/g, ' '),
          (r.approval.assignee && r.approval.assignee.name) || '', (r.approval.assignee && r.approval.assignee.org) || '',
          (r.route && r.route.at) || '', (r.route && r.route.confirmed) ? '확인' : '대기',
          (r.delivery && r.delivery.sent) ? '전달' : (r.delivery ? '초안' : '미작성'),
          (r.delivery && r.delivery.sentAt) || '', (r.approval.memo || '').replace(/[,\n]/g, ' ')
        ]));
      });
    });
    var cell = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var csv = '\ufeff' + head.join(',') + '\n' + lines.map(function (l) { return l.map(cell).join(','); }).join('\n');
    if (download('OAAB_접수매칭_판단이력_' + stamp() + '.csv', csv, 'text/csv;charset=utf-8')) {
      toast('CSV 로 내보냈습니다 (' + lines.length + '행).');
    }
  }

  /* ───────────────────────── 허브 접수 상세에 붙는 요약 블록 ───────────────────────── */
  function summaryFor(row) {
    if (!row || !isAdmin()) return '';
    var id = String(row.id || '');
    if (!id) return '';
    var rec = DB.reviews[id];
    var h = '<div class="trm-inline"><div class="trm-inline-head"><b>🧠 매칭 검토</b>' +
      (rec ? stageBadge(rec) : '<span class="trm-st s-received">📥 검토 전</span>') +
      '<span class="hub-spacer"></span>' +
      '<button type="button" class="btn btn-outline" data-trm-open-review="' + esc(id) + '">매칭 검토 열기</button></div>';
    if (!rec) {
      h += '<p class="trm-note">아직 검토 기록이 없습니다. [매칭 검토 열기]를 누르면 보유 자산 DB에서 후보를 만들고 승인 절차를 시작합니다.</p></div>';
      return h;
    }
    var run = currentRun(rec);
    var top = run && run.candidates.length ? run.candidates.slice(0, 3) : [];
    if (!top.length) h += '<p class="trm-note">후보 없음 — 검토 화면에서 다시 생성하거나 대체 후보를 지정하세요.</p>';
    else {
      h += '<div class="trm-inline-cands">' + top.map(function (c) {
        return '<div class="trm-inline-cand"><b>' + esc(c.name) + '</b><span>' + c.score.pct + '%</span>' +
          '<em>' + esc(c.decision === 'approved' ? '승인' : (c.decision === 'excluded' ? '제외' : '미판단')) + '</em></div>';
      }).join('') + '</div>';
    }
    h += '<p class="trm-note">승인 ' + (rec.approval.approved || []).length + '건 · 담당자 ' +
      esc(rec.approval.assignee ? rec.approval.assignee.name : '미지정') + ' · 단계 ' + esc(stageOf(rec.stage).l) + '</p></div>';
    return h;
  }

  function bindDetailHook() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-trm-open-review]');
      if (!b) return;
      e.preventDefault();
      open({ id: b.getAttribute('data-trm-open-review') });
    });
  }
  bindDetailHook();

  window.NAI_TRREVIEW = {
    open: open, openFor: openFor, close: close,
    summaryFor: summaryFor,
    stageOf: stageOf,
    review: function (id) { return DB.reviews[String(id)] || null; },
    settings: function () { return DB.settings; },
    store: function () { return DB; },
    scorePreview: function (requestRow) {
      var P = parseRequest(reqRow(requestRow));
      var W = SET().weights;
      return assets().map(function (a) {
        var s = scoreAsset(P, a, W);
        return { assetId: a.id, name: a.name, pct: s.pct, evidence: s.evidence };
      }).filter(function (x) { return x.pct >= SET().minScore; })
        .sort(function (x, y) { return y.pct - x.pct; }).slice(0, SET().topN);
    },
    parseRequest: parseRequest,
    __exportParse: parseArea,
    __test: { parseRequest: parseRequest, scoreAsset: scoreAsset, runMatch: runMatch }
  };
})();
