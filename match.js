/* =========================================================================
   Open AI Asset Bridge (가칭) — match.js  (🤖 AI 매물 매칭, 2026-11-24)
   -------------------------------------------------------------------------
   · API 키 없이 브라우저 안에서만 도는 클라이언트 내장 자연어 조건 파서
     "용인 15,000평 임차 물류센터" / "GBD 3,000평 사옥 매입" / "부산 호텔 컨버전"
   · 지역·권역 · 섹터 · 거래유형(매각·임차·개발·경공매) · 면적(평) · 가격(억) ·
     온도(상온·냉동·냉장·신선) 를 뽑아 전체 DB(2,429건)를 부합도 순으로 정렬
   · 결과 → 지도·상세 / 밸류에이션 / TR 임차의뢰 로 바로 연결
   · 하단에 피클(Pickle) 초대 링크 CTA
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = { built: false, q: '', parsed: null, results: [], shown: 0, page: 20, ranAt: 0, loose: false, total: 0 };
  var PICKLE_URL = CFG.PICKLE_INVITE_URL || 'https://pickle.com/i/2X6HQCBL47MN';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function assets() {
    var st = window.naiMap && window.naiMap.state;
    return (st && st.assets) ? st.assets : [];
  }
  function toast(msg, err) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3000);
  }
  function nfmt(v) { return (v == null || !isFinite(v)) ? '' : Number(v).toLocaleString('ko-KR'); }
  function sectorMeta(k) {
    var SECT = CFG.SECTORS || {};
    return SECT[k] || { label: k, color: '#64748b' };
  }

  /* ───────────────────────── 사전 ───────────────────────── */

  var SECTOR_RULES = [
    { k: 'datacenter', re: /데이터\s*센터|데이타\s*센터|전산\s*센터|IDC|엣지\s*DC|서버\s*센터|(^|\s)DC(\s|$)/i, label: '데이터센터' },
    { k: 'hotel', re: /호텔|리조트|숙박|객실|모텔|호스텔|호텔\s*컨버전|컨버전\s*호텔/, label: '호텔' },
    { k: 'logistics', re: /물류|창고|냉동|냉장|저온|풀필먼트|3\s*PL|허브\s*센터|라스트\s*마일|배송\s*센터|택배|상온\s*센터|신선\s*센터/, label: '물류센터' },
    { k: 'office', re: /오피스|사옥|빌딩|타워|업무\s*시설|사무실|오피스\s*빌딩|메디컬/, label: '오피스' },
    { k: 'retail', re: /리테일|백화점|아울렛|쇼핑몰|상가|마트|근린|판매\s*시설/, label: '리테일' },
    { k: 'living', re: /임대\s*주택|멀티\s*패밀리|코리빙|기숙사|오피스텔|청년\s*주택|뉴스테이|주거|아파트/, label: '멀티패밀리·임대' },
    { k: 'land', re: /토지|부지|나대지|개발\s*부지|대지|임야|공장\s*부지|잡종지/, label: '토지·개발부지' },
    { k: 'shipper', re: /화주|임차\s*수요|입주\s*수요/, label: '화주·임차수요' }
  ];

  /* 시·군 → 광역 권역 (긴 이름을 먼저 매칭) */
  var CITY_REGION = [
    ['서울', '서울'], ['경기', '경기'], ['인천', '인천'], ['부산', '부산'], ['대구', '대구'],
    ['대전', '대전'], ['세종', '세종'], ['울산', '울산'], ['강원', '강원'], ['제주', '제주'],
    ['충북', '충북'], ['충남', '충남'], ['전북', '전북'], ['전남', '전남광주'], ['경북', '경북'], ['경남', '경남'],
    ['광주시', '경기'], ['광주', '전남광주'],
    ['수원', '경기'], ['성남', '경기'], ['용인', '경기'], ['이천', '경기'], ['평택', '경기'], ['안성', '경기'],
    ['화성', '경기'], ['김포', '경기'], ['파주', '경기'], ['양주', '경기'], ['포천', '경기'], ['하남', '경기'],
    ['남양주', '경기'], ['시흥', '경기'], ['부천', '경기'], ['안양', '경기'], ['광명', '경기'], ['군포', '경기'],
    ['의왕', '경기'], ['과천', '경기'], ['구리', '경기'], ['여주', '경기'], ['양평', '경기'], ['가평', '경기'],
    ['연천', '경기'], ['동두천', '경기'], ['의정부', '경기'], ['고양', '경기'], ['오산', '경기'], ['안산', '경기'],
    ['동탄', '경기'], ['기흥', '경기'], ['분당', '경기'], ['판교', '경기'], ['일산', '경기'], ['송도', '인천'],
    ['김해', '경남'], ['양산', '경남'], ['창원', '경남'], ['진주', '경남'], ['천안', '충남'], ['아산', '충남'],
    ['청주', '충북'], ['음성', '충북'], ['진천', '충북'], ['전주', '전북'], ['익산', '전북'], ['포항', '경북'],
    ['구미', '경북'], ['원주', '강원'], ['춘천', '강원']
  ];

  var ZONE_RULES = [
    { re: /(^|\s)CBD(\s|$)|종로|중구|광화문|을지로|시청|청진|서대문|마포/, zone: 'CBD' },
    { re: /(^|\s)GBD(\s|$)|강남|서초|역삼|삼성역|테헤란/, zone: 'GBD' },
    { re: /(^|\s)BBD(\s|$)|여의도|영등포|마포|당산/, zone: 'BBD' },
    { re: /(^|\s)YBD(\s|$)|용산|한남|이촌/, zone: 'YBD' }
  ];

  /* ───────────────────────── 파서 ───────────────────────── */

  function parseQuery(q) {
    var raw = String(q || '').trim();
    var p = { raw: raw, sector: null, region: null, city: null, zone: null, deal: null, area: null,
      price: null, priceMode: 'eq', temp: null, tokens: [], notes: [] };

    /* 섹터 */
    for (var i = 0; i < SECTOR_RULES.length; i++) {
      if (SECTOR_RULES[i].re.test(raw)) { p.sector = SECTOR_RULES[i].k; p.notes.push(SECTOR_RULES[i].label); break; }
    }

    /* 권역 코드 (CBD/GBD/BBD/YBD) — 시·군보다 우선 */
    for (var z = 0; z < ZONE_RULES.length; z++) {
      if (ZONE_RULES[z].re.test(raw)) { p.zone = ZONE_RULES[z].zone; break; }
    }

    /* 지역 (긴 이름 우선: '광주시' > '광주') */
    for (var c = 0; c < CITY_REGION.length; c++) {
      if (raw.indexOf(CITY_REGION[c][0]) >= 0) {
        p.region = CITY_REGION[c][1];
        p.city = CITY_REGION[c][0];
        break;
      }
    }

    /* 거래 유형 */
    if (/경매|공매|경·공매|입찰/.test(raw)) p.deal = 'auction';
    else if (/매입|매수|인수|매각|매도|엑시트/.test(raw)) p.deal = 'sale';
    else if (/임차|임대|리스|입주|lease/i.test(raw)) p.deal = 'lease';
    else if (/개발|신축|컨버전|증축|리모델링|재개발|용도변경/.test(raw)) p.deal = 'dev';
    if (/컨버전|용도변경/.test(raw)) { p.notes.push('컨버전'); if (!p.deal) p.deal = 'dev'; }

    /* 면적 — "15,000평" / "1만5천평" / "3,000 ㎡" */
    var man = raw.match(/(\d+(?:\.\d+)?)\s*만\s*(\d+(?:\.\d+)?)?\s*평/);
    var py = raw.match(/([\d,]{2,})\s*(평|py|PY|坪)/);
    var m2 = raw.match(/([\d,]{3,})\s*(㎡|m2|M2|제곱미터)/);
    if (man) {
      p.area = Number(man[1]) * 10000 + (man[2] ? Number(String(man[2]).padEnd(4, '0')) : 0);
    } else if (py) {
      p.area = Number(String(py[1]).replace(/,/g, ''));
    } else if (m2) {
      p.area = Math.round(Number(String(m2[1]).replace(/,/g, '')) / 3.3058);
    }

    /* 가격 — "3,000억" / "1조 2,000억" / "3,000억 이하" */
    if (/이하|미만|까지|max/i.test(raw)) p.priceMode = 'max';
    else if (/이상|부터|최소/i.test(raw)) p.priceMode = 'min';
    var jo = raw.match(/([\d,\.]+)\s*조/);
    var eok = raw.match(/([\d,\.]+)\s*억/);
    var won = raw.match(/([\d,]{3,})\s*원/);
    if (jo || eok) {
      p.price = (jo ? Number(String(jo[1]).replace(/,/g, '')) * 10000 : 0) +
        (eok ? Number(String(eok[1]).replace(/,/g, '')) : 0);
    } else if (won) {
      var w = Number(String(won[1]).replace(/,/g, ''));
      if (w >= 100000000) p.price = Math.round(w / 100000000);
    }

    /* 온도대 */
    if (/냉동|-?\s*2[0-9]\s*℃/.test(raw)) p.temp = '냉동';
    else if (/냉장/.test(raw)) p.temp = '냉장';
    else if (/상온/.test(raw)) p.temp = '상온';
    else if (/신선|콜드체인/.test(raw)) p.temp = '신선';

    /* 남은 검색어 토큰 — 이미 조건으로 읽은 말(지역·섹터·거래·단위)은 제외 */
    var strip = raw
      .replace(/([\d,.]+\s*(만)?\s*(억|조|평|py|㎡|m2|원|℃))/gi, ' ')
      .replace(/(매입|매각|매수|매도|인수|임차|임대|입주|개발|신축|컨버전|경매|공매|경·공매|물건|알려\s*줘|찾아\s*줘|추천|보여\s*줘|이하|이상|미만|까지|대략|정도|내외|규모|면적|가격)/g, ' ');
    if (p.city) strip = strip.split(p.city).join(' ');
    if (p.zone) strip = strip.split(p.zone).join(' ');
    p.tokens = strip.split(/\s+/).map(function (t) { return t.replace(/[.,·]/g, '').trim(); })
      .filter(function (t) { return t.length >= 2; })
      .filter(function (t) {
        if (p.region && t === p.region) return false;
        if (p.sector) {
          var rule = SECTOR_RULES.filter(function (r) { return r.k === p.sector; })[0];
          if (rule && rule.label.indexOf(t) >= 0) return false;
          if (rule && (t === '물류센터' || t === '오피스' || t === '호텔' || t === '사옥')) return false;
        }
        return true;
      })
      .slice(0, 6);
    return p;
  }

  /* ───────────────────────── 물건 파생값 ───────────────────────── */

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
    var f = factOf(a, ['연면적', '매각면적', '대지면적', '면적']);
    var fm = String(f).match(/([\d,]{2,})\s*평/);
    if (fm) return Number(String(fm[1]).replace(/,/g, ''));
    var fm2 = String(f).match(/([\d,]{3,})\s*㎡/);
    if (fm2) return Math.round(Number(String(fm2[1]).replace(/,/g, '')) / 3.3058);
    return null;
  }

  function priceOf(a) {
    var m = String(a.price_info || '').match(/([\d,]+(?:\.\d+)?)\s*억/);
    if (m) return Number(String(m[1]).replace(/,/g, ''));
    var f = factOf(a, ['최저입찰가', '감정가']);
    var fm = String(f).match(/([\d,]+(?:\.\d+)?)\s*억/);
    return fm ? Number(String(fm[1]).replace(/,/g, '')) : null;
  }

  function isAuctionAsset(a) {
    if (a.deal_type === 'auction') return true;
    if (/^auc-/i.test(String(a.id || ''))) return true;
    if (String(a.status_group || '') === '경·공매') return true;
    for (var i = 0; i < (a.facts || []).length; i++) {
      if (String(a.facts[i].label || '') === '경매구분') return true;
    }
    return false;
  }

  function hayOf(a) {
    if (a._mhay) return a._mhay;
    var parts = [a.name, a.address, a.region, a.owner_amc, a.fund_vehicle, a.tenants,
      a.sub_type, a.status, a.status_group, a.scale_info, a.price_info, a.notes];
    (a.facts || []).forEach(function (f) { parts.push(String(f.label || '') + ' ' + String(f.value || '')); });
    a._mhay = parts.filter(Boolean).join(' ').toLowerCase();
    return a._mhay;
  }

  /* ───────────────────────── 채점 ───────────────────────── */

  function scoreAsset(a, p) {
    var sc = 0, why = [];
    var hay = hayOf(a);

    if (p.sector) {
      if (a.sector === p.sector) { sc += 34; why.push({ ok: true, t: sectorMeta(a.sector).label }); }
      else {
        var rule = SECTOR_RULES.filter(function (r) { return r.k === p.sector; })[0];
        if (rule && rule.re.test(hay)) { sc += 18; why.push({ ok: true, t: '본문에 ' + rule.label }); }
        else sc -= 12;
      }
    }

    if (p.zone) {
      if (String(a.region || '') === p.zone) { sc += 26; why.push({ ok: true, t: p.zone + ' 권역' }); }
      else if (new RegExp(p.zone, 'i').test(hay)) { sc += 18; why.push({ ok: true, t: p.zone + ' 언급' }); }
      else sc -= 6;
    }

    if (p.region) {
      var where = String(a.name || '') + ' ' + String(a.address || '');
      var cityHit = p.city ? where.indexOf(p.city) >= 0 : false;
      if (cityHit) { sc += 34; why.push({ ok: true, t: p.city }); }
      else if (String(a.region || '') === p.region) { sc += 14; why.push({ ok: true, t: p.region + ' 권역' }); }
      else if (String(a.region || '').indexOf(p.region) >= 0) sc += 10;
      else sc -= 14;
    }

    if (p.deal) {
      var g = String(a.status_group || '');
      var auc = isAuctionAsset(a);
      if (p.deal === 'auction') {
        if (auc) { sc += 20; why.push({ ok: true, t: '경·공매' }); } else sc -= 20;
      } else if (p.deal === 'sale') {
        if (auc) sc -= 8;
        else if (/거래진행중|만기·매각예정|검토중|매각철회/.test(g) || /매각|매도|인수/.test(String(a.sub_type || '') + String(a.status || ''))) {
          sc += 16; why.push({ ok: true, t: '매각 추진' });
        } else sc += 4;
      } else if (p.deal === 'lease') {
        if (/운영중|운용중/.test(g) || a.tenants) { sc += 16; why.push({ ok: true, t: '운용·임차' }); }
        else if (/개발중|🏗️/.test(g)) sc -= 4;
      } else if (p.deal === 'dev') {
        if (/개발중|🏗️ 개발 인허가|검토중/.test(g)) { sc += 16; why.push({ ok: true, t: '개발·인허가' }); }
        else if (/운영중|운용중/.test(g)) sc -= 4;
      }
    }

    if (p.area) {
      var av = areaOf(a);
      if (av) {
        var r = av / p.area;
        if (r >= 0.85 && r <= 1.15) { sc += 20; why.push({ ok: true, t: nfmt(av) + '평' }); }
        else if (r >= 0.6 && r <= 1.45) { sc += 14; why.push({ ok: true, t: nfmt(av) + '평' }); }
        else if (r >= 0.3 && r <= 2.0) { sc += 7; why.push({ ok: false, t: nfmt(av) + '평' }); }
        else sc -= 6;
      } else { sc -= 2; }
    }

    if (p.price) {
      var pv = priceOf(a);
      if (pv) {
        var okPrice = false, nearPrice = false;
        if (p.priceMode === 'max') { okPrice = pv <= p.price * 1.05; nearPrice = pv <= p.price * 1.5; }
        else if (p.priceMode === 'min') { okPrice = pv >= p.price * 0.95; nearPrice = pv >= p.price * 0.6; }
        else {
          var rp = pv / p.price;
          okPrice = (rp >= 0.8 && rp <= 1.25);
          nearPrice = (rp >= 0.5 && rp <= 1.8);
        }
        if (okPrice) { sc += 14; why.push({ ok: true, t: nfmt(pv) + '억' }); }
        else if (nearPrice) { sc += 6; why.push({ ok: false, t: nfmt(pv) + '억' }); }
        else sc -= 8;
      } else sc -= 3;
    }

    if (p.temp) {
      var tv = factOf(a, ['온도대', '온도']) + ' ' + String(a.scale_info || '') + ' ' + String(a.name || '') + ' ' + String(a.notes || '');
      if (p.temp === '냉동' && /냉동/.test(tv)) { sc += 14; why.push({ ok: true, t: '냉동' }); }
      else if (p.temp === '냉장' && /냉장|냉동/.test(tv)) { sc += 12; why.push({ ok: true, t: '냉장' }); }
      else if (p.temp === '신선' && /신선|냉장|냉동/.test(tv)) { sc += 12; why.push({ ok: true, t: '신선·저온' }); }
      else if (p.temp === '상온' && /상온/.test(tv)) { sc += 12; why.push({ ok: true, t: '상온' }); }
      else sc -= 6;
    }

    if (p.tokens.length) {
      var hit = 0;
      for (var t = 0; t < p.tokens.length; t++) {
        if (hay.indexOf(String(p.tokens[t]).toLowerCase()) >= 0) hit++;
      }
      if (hit) { sc += Math.min(18, hit * 6); why.push({ ok: true, t: '키워드 ' + hit + '/' + p.tokens.length }); }
      else sc -= 4;
    }

    if (String(a.im_url || '').match(/^https?:/)) sc += 2;

    return { score: sc, pct: Math.max(0, Math.min(100, Math.round(sc))), why: why };
  }

  /* 후보 기준선 — 강한 조건(섹터·지역·권역)이 있으면 60, 없으면 40 */
  function thresholdFor(p) {
    return (p.sector || p.region || p.zone) ? 60 : 40;
  }

  function runQuery(q, loose) {
    var p = parseQuery(q);
    var list = assets();
    if (!list.length) return { parsed: p, results: [] };
    var all = [];
    for (var i = 0; i < list.length; i++) {
      var r = scoreAsset(list[i], p);
      if (r.score >= 20) all.push({ a: list[i], score: r.score, pct: r.pct, why: r.why });
    }
    all.sort(function (x, y) {
      if (y.score !== x.score) return y.score - x.score;
      return String(x.a.name).localeCompare(String(y.a.name), 'ko');
    });
    var th = loose ? 20 : thresholdFor(p);
    var out = all.filter(function (x) { return x.score >= th; });
    if (out.length < 4 && !loose) out = all.filter(function (x) { return x.score >= 35; }).slice(0, 40);
    return { parsed: p, results: out, total: all.length, threshold: th };
  }

  /* ───────────────────────── 화면 ───────────────────────── */

  function renderShell() {
    var host = $('#matchView');
    if (!host) return;
    var all = assets();
    var html = '';
    html += '<div class="mt-wrap">';
    html += '<div class="mt-hero">';
    html += '<div class="mt-hero-top"><h1>🤖 AI 매물 매칭</h1>' +
      '<span class="mt-db">전체 DB <b>' + nfmt(all.length) + '</b>건 · API 키 없이 브라우저 내장 엔진</span></div>';
    html += '<p class="mt-sub">문장으로 조건을 적으면 지역·권역 · 섹터 · 거래유형 · 면적(평) · 가격 · 온도대를 읽어 <b>부합도 순</b>으로 추천합니다.</p>';
    html += '<form id="mtForm" class="mt-form" autocomplete="off">';
    html += '<span class="mt-ico" aria-hidden="true">⌕</span>';
    html += '<input id="mtQ" type="search" placeholder="예) 용인 15,000평 임차 물류센터 / GBD 3,000평 사옥 매입 / 부산 호텔 컨버전" aria-label="자연어 조건 검색">';
    html += '<button type="submit" class="btn btn-solid mt-go">매칭</button>';
    html += '</form>';
    html += '<div class="mt-examples">' + [
      '용인 15,000평 임차 물류센터',
      'GBD 3,000평 사옥 매입',
      '부산 호텔 컨버전',
      '수도권 냉동 5,000평',
      '3,000억 이하 오피스 매각',
      '경·공매 토지 100억'
    ].map(function (x) { return '<button type="button" class="mt-ex" data-mt-ex="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>';
    html += '<div class="mt-tools"><button type="button" class="btn btn-outline" id="mtTrBtn">📋 TR 임차의뢰 등록</button>' +
      '<span class="mt-hint">화주·임차인은 희망 조건을 TR로 접수하면 담당자가 후보를 골라 회신합니다.</span></div>';
    html += '</div>';

    html += '<div id="mtParsed" class="mt-parsed hidden"></div>';
    html += '<div id="mtResult" class="mt-result"><p class="mt-empty">문장을 입력하고 <b>매칭</b>을 눌러 주세요. (예: ‘이천 10,000평 상온 물류센터 임차’)</p></div>';

    html += '<div class="mt-cta">';
    html += '<div class="mt-cta-l">';
    html += '<strong>더 깊은 AI 분석 · 교차 검토가 필요하신가요?</strong>';
    html += '<p>본인 <b>피클(Pickle)</b>로 로그인해 직접 물어보세요 — 조건 해석, 후보 비교, 수지·IRR 교차 검토까지 대화로 진행됩니다.</p>';
    html += '<ul class="mt-cta-li"><li>“이 후보 3개를 임대료·공실·WALE 기준으로 비교해 줘”</li>' +
      '<li>“용인 물류 후보 중 2027년 입주 가능한 곳만 남겨 줘”</li></ul>';
    html += '</div>';
    html += '<div class="mt-cta-r">';
    html += '<a class="mt-pickle" href="' + PICKLE_URL + '" target="_blank" rel="noopener noreferrer" id="mtPickle">🥒 피클(Pickle)로 로그인 · 물어보기 ↗</a>';
    html += '<span class="mt-cta-note">권준오 상무의 피클 초대 링크 · pickle.com</span>';
    html += '</div></div>';
    html += '</div>';

    host.innerHTML = html;
    host.dataset.count = String(all.length);
    S.built = true;

    $('#mtForm').addEventListener('submit', function (e) {
      e.preventDefault();
      run($('#mtQ').value);
    });
    host.addEventListener('click', function (e) {
      var ex = e.target.closest('[data-mt-ex]');
      if (ex) { $('#mtQ').value = ex.getAttribute('data-mt-ex'); run($('#mtQ').value); return; }
      var tr = e.target.closest('#mtTrBtn');
      if (tr) { openTR({}); return; }
      var pk = e.target.closest('#mtPickle');
      if (pk && window.naiMap && window.naiMap.log) window.naiMap.log('pickle_invite', 'ai-match CTA');
      var go = e.target.closest('[data-mt-open]');
      if (go) { var id = go.getAttribute('data-mt-open'); window.naiShowView('map'); if (window.naiMap) window.naiMap.select(id); return; }
      var vl = e.target.closest('[data-mt-val]');
      if (vl) {
        var a = assets().filter(function (x) { return x.id === vl.getAttribute('data-mt-val'); })[0];
        if (!a) return;
        window.naiShowView('valuation');
        setTimeout(function () { if (window.NAI_VAL && window.NAI_VAL.openForAsset) window.NAI_VAL.openForAsset(a); }, 60);
        return;
      }
      var tr2 = e.target.closest('[data-mt-tr]');
      if (tr2) {
        var id2 = tr2.getAttribute('data-mt-tr');
        var as2 = assets().filter(function (x) { return x.id === id2; })[0] || {};
        openTR({
          region: S.parsed && S.parsed.region ? S.parsed.region : (as2.region || ''),
          sector: S.parsed && S.parsed.sector ? S.parsed.sector : (as2.sector || ''),
          area: S.parsed && S.parsed.area ? String(S.parsed.area) : '',
          memo: 'AI 매칭 후보 참고: ' + (as2.name || ''),
          source: 'ai-match'
        });
        return;
      }
      var more = e.target.closest('#mtMore');
      if (more) { S.shown = Math.min(S.results.length, S.shown + S.page); renderResults(); return; }
      var loose = e.target.closest('#mtLoose');
      if (loose) { run(S.q, !S.loose); return; }
    });
  }

  function openTR(prefill) {
    if (window.NAI_TR) window.NAI_TR.open(prefill);
    else toast('TR 모듈을 불러오지 못했습니다. 새로고침해 주세요.', true);
  }

  function chip(label, val, ok) {
    return '<span class="mt-chip' + (ok === false ? ' off' : '') + '"><b>' + esc(label) + '</b> ' + esc(val) + '</span>';
  }

  function renderParsed(p) {
    var host = $('#mtParsed');
    if (!host) return;
    var bits = [];
    if (p.sector) bits.push(chip('섹터', sectorMeta(p.sector).label));
    if (p.zone) bits.push(chip('권역', p.zone));
    if (p.region) bits.push(chip('지역', p.city || p.region));
    if (p.deal) bits.push(chip('거래', { auction: '경·공매', sale: '매각·매입', lease: '임차', dev: '개발·컨버전' }[p.deal] || p.deal));
    if (p.area) bits.push(chip('면적', nfmt(p.area) + '평'));
    if (p.price) bits.push(chip('가격', nfmt(p.price) + '억' + (p.priceMode === 'max' ? ' 이하' : (p.priceMode === 'min' ? ' 이상' : ''))));
    if (p.temp) bits.push(chip('온도', p.temp));
    if (p.tokens.length) bits.push(chip('키워드', p.tokens.join(' · ')));
    host.classList.remove('hidden');
    host.innerHTML = '<span class="mt-ptitle">해석된 조건</span>' + (bits.length ? bits.join('') :
      '<span class="mt-chip off">조건을 읽지 못했습니다 — 지역·섹터·면적을 넣어 보세요</span>');
  }

  function renderResults() {
    var host = $('#mtResult');
    if (!host) return;
    if (!S.results.length) {
      host.innerHTML = '<p class="mt-empty">조건에 맞는 물건이 없습니다. 지역을 넓히거나 면적·가격 조건을 빼고 다시 시도해 보세요.</p>';
      return;
    }
    var shown = Math.min(S.results.length, S.shown || S.page);
    var hiddenN = Math.max(0, (S.total || 0) - S.results.length);
    var html = '<div class="mt-rhead"><span><b>' + nfmt(S.results.length) + '건</b> 부합도 순' +
      (S.parsed && S.parsed.raw ? ' · “' + esc(S.parsed.raw) + '”' : '') +
      (hiddenN ? ' <button type="button" class="mini-btn mt-loose" id="mtLoose">' +
        (S.loose ? '기준 높이기 (상위 60%↑)' : '인근·낮은 부합도 ' + nfmt(hiddenN) + '건 더 보기') + '</button>' : '') +
      '</span>' +
      '<span class="mt-rtime">' + nfmt(assets().length) + '건 전체 대조</span></div>';
    html += '<div class="mt-list">';
    for (var i = 0; i < shown; i++) {
      var o = S.results[i];
      var a = o.a;
      var sm = sectorMeta(a.sector);
      var pv = priceOf(a);
      var av = areaOf(a);
      html += '<article class="mt-card">';
      html += '<div class="mt-rank">' + (i + 1) + '</div>';
      html += '<div class="mt-score" style="--sc:' + (o.pct != null ? o.pct : o.score) + '"><span>' + (o.pct != null ? o.pct : o.score) + '</span><em>%</em></div>';
      html += '<div class="mt-main">';
      html += '<div class="mt-name-row"><span class="mt-dot" style="background:' + (sm.color || '#64748b') + '"></span>' +
        '<strong class="mt-name">' + esc(a.name) + '</strong>' +
        '<span class="mt-tag" style="color:' + (sm.color || '#64748b') + '">' + esc(sm.label || a.sector || '') + '</span>' +
        (String(a.status_group || '') ? '<span class="mt-status">' + esc(a.status_group) + '</span>' : '') + '</div>';
      html += '<div class="mt-meta">' + esc([a.region, av ? nfmt(av) + '평' : '', pv ? nfmt(pv) + '억' : (a.price_info || ''), a.owner_amc].filter(Boolean).join(' · ')) + '</div>';
      html += '<div class="mt-why">' + o.why.map(function (w) {
        return '<span class="mt-why-i' + (w.ok ? '' : ' partial') + '">' + (w.ok ? '✓ ' : '△ ') + esc(w.t) + '</span>';
      }).join('') + '</div>';
      html += '<div class="mt-addr">' + esc(a.address || '') + '</div>';
      html += '</div>';
      html += '<div class="mt-acts">' +
        '<button type="button" class="mini-btn" data-mt-open="' + esc(a.id) + '">지도·상세</button>' +
        '<button type="button" class="mini-btn" data-mt-val="' + esc(a.id) + '">📊 밸류에이션</button>' +
        '<button type="button" class="mini-btn" data-mt-tr="' + esc(a.id) + '">📋 TR</button>' +
        '</div>';
      html += '</article>';
    }
    html += '</div>';
    if (S.results.length > shown) {
      html += '<div class="mt-more"><button type="button" class="btn btn-outline" id="mtMore">더 보기 (+' +
        Math.min(S.page, S.results.length - shown) + '건) — ' + nfmt(shown) + '/' + nfmt(S.results.length) + '</button></div>';
    }
    host.innerHTML = html;
  }

  function run(q, loose) {
    q = String(q || '').trim();
    if (!q) { toast('조건을 입력하세요. 예) 용인 15,000평 임차 물류센터', true); return; }
    if (!S.built) renderShell();
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var res = runQuery(q, !!loose);
    var ms = Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - t0);
    S.q = q; S.parsed = res.parsed; S.results = res.results; S.total = res.total || res.results.length;
    S.loose = !!loose; S.shown = S.page; S.ranAt = Date.now();
    renderParsed(res.parsed);
    renderResults();
    var head = $('#mtResult .mt-rtime');
    if (head) head.textContent = nfmt(assets().length) + '건 전체 대조 · ' + ms + 'ms';
    if (window.naiMap && window.naiMap.log) window.naiMap.log('ai_match', q.slice(0, 80) + ' · ' + res.results.length + '건');
  }

  function show() {
    var host = $('#matchView');
    if (!host) return;
    if (!S.built || host.dataset.count !== String(assets().length)) {
      renderShell();
      if (S.q && S.results.length) { renderParsed(S.parsed); renderResults(); }
    }
  }

  window.NAI_MATCH = { show: show, run: run, parse: parseQuery, score: scoreAsset, query: runQuery, areaOf: areaOf, priceOf: priceOf };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { /* lazy */ });
})();
