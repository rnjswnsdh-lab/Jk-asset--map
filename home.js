/* =========================================================================
   Open AI Asset Bridge — home.js  (🏠 딜 브릿지 홈, 2026-11-23)
   - 로그인 후 첫 화면: 매각 물건 D-Day · 아티클 · 공지 · 물건검색 ·
     물건등록(TM/IM/직접) · 인수·임차의향서 · 대출요청/조건제시 · TM/IM 제작
   - 데이터: 비공개 시트(assets/articles/notices/lois/loans/doc_requests/asset_proposals)
   - 서버 API는 Apps Script v6 (Home.gs) — 모든 제출물은 권한·신원과 함께 서버에서 기록됩니다.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var BOOT = { homeOpened: false, articles: [], notices: [], loaded: false, subs: {}, artShown: 0, artQ: '', homeSector: 'office' };
  var ART_INIT = 20, ART_STEP = 30;   /* 아티클: 첫 표시 20건 · 더 보기 +30건 */

  /* ─── 거래 상태 · 표기 정리 (2026-11-27) ─── */
  function tradeStateOf(a) {
    if (window.naiMap && window.naiMap.tradeState) return window.naiMap.tradeState(a);
    return '';
  }
  /** 출처·본문에 남은 NAI 흔적 정리 — 실제 매각·임대 실행 표기(NAI 매각/임대 탭·딜 데이터)는 그대로 둡니다 */
  function noNai(s) {
    return String(s == null ? '' : s)
      .replace(/NAI\s*Korea\s*리서치/g, '리서치')
      .replace(/NAI\s*Korea\s*(Research|MarketReview)/gi, '마켓 리포트')
      .replace(/NAIKorea/gi, 'Asset Bridge')
      .replace(/NAI\s*Korea/gi, '당사')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function me() { return (window.naiMap && window.naiMap.me) ? window.naiMap.me() : null; }
  function isAdmin() { return role() === 'admin'; }
  function isLogi() { return role() === 'logi'; }

  function toast(msg, err) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3000);
  }

  function apiGet(type) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var url = base + (base.indexOf('?') < 0 ? '?' : '&') + 'type=' + encodeURIComponent(type) + '&token=' + encodeURIComponent(getToken());
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function apiPost(payload) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var body = Object.assign({ token: getToken() }, payload);
    return fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  /* ─────────────────── 물건 데이터 헬퍼 ─────────────────── */
  function assets() {
    var st = window.naiMap && window.naiMap.state;
    return (st && st.assets) ? st.assets : [];
  }
  function fact(a, prefix) {
    if (!a || !a.facts) return '';
    for (var i = 0; i < a.facts.length; i++) {
      if (String(a.facts[i].label || '').indexOf(prefix) === 0) return String(a.facts[i].value || '');
    }
    return '';
  }
  function isAuction(a) {
    if (!a) return false;
    if (a.deal_type === 'auction') return true;
    if (/^auc-/i.test(String(a.id || ''))) return true;
    if (a.status_group === '경·공매') return true;
    if (a.facts) { for (var i = 0; i < a.facts.length; i++) { if (String(a.facts[i].label || '') === '경매구분') return true; } }
    return false;
  }
  function parseEok(s) {
    var m = String(s == null ? '' : s).match(/([\d,]+(?:\.\d+)?)\s*억/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  }
  function fmtEok(v) {
    if (v == null || !isFinite(v)) return '';
    var s = Math.round(v * 10) / 10;
    return s.toLocaleString('ko-KR') + '억원';
  }
  function eokText(a) {
    var v = parseEok(a && a.price_info);
    return v ? fmtEok(v) : '';
  }
  /* ─────────── 금액 성격 라벨 · 매각·임대 단계 배지 (2026-11-28) ───────────
     보도·기사·내부 검토에서 온 금액을 '팩트'처럼 보이지 않게 성격 라벨을 붙입니다.
     · 서버가 price_type 을 주면 그것을 우선 사용하고, 없으면 기존 price_info 문구에서 판정
     · 단계는 기존 status/facts 값에서 짧은 라벨로 줄여 표시 (새 단계 체계를 만들지 않음)
     · 매각·임대 카드는 renderDealStrip() 한 곳에서 그리므로 여기만 고치면 양쪽에 반영됩니다. */
  var PRICE_TAG = {
    '실거래': 'deal', '계약(환산)': 'deal', '매입가': 'deal', '우협가': 'deal',
    '예상': 'est', '추정': 'est', '평당': 'est',
    '호가': 'ask', '최저입찰': 'low', '감정가': 'low',
    '보도 기준': 'src', '자료 기준': 'src', '합계 기준': 'src', '우선주': 'src',
    '미공개': 'none'
  };
  function priceTagHTML(label) {
    if (!label) return '';
    return '<em class="ptag pt-' + (PRICE_TAG[label] || 'src') + '">' + esc(label) + '</em>';
  }
  /** 문구에서 첫 '억/조' 금액만 추출 — '평당 3,875만원' 같은 단가는 건너뛰고 범위는 유지 */
  function amountInText(s) {
    var str = String(s || '');
    var re = /(?:약\s*)?(\d[\d,]*(?:\.\d+)?)\s*(조\s*\d[\d,]*(?:\.\d+)?\s*억|조|억)\s*원?/g, m;
    while ((m = re.exec(str))) {
      if (str.slice(Math.max(0, m.index - 6), m.index).indexOf('평당') >= 0) continue;
      var txt = String(m[0]).replace(/\s+/g, '');
      var rng = str.slice(Math.max(0, m.index - 14), m.index).match(/(\d[\d,]*(?:\.\d+)?)\s*[~\-]\s*$/);
      if (rng) txt = rng[1] + '~' + txt;
      return txt;
    }
    return '';
  }
  /** 금액 성격 판정 순서 — 앞쪽 표기가 우선 (예: '최저 3,300억원 (감정 3,800억원)') */
  var SALE_PRICE_RULES = [
    [/^최저/, '최저입찰'],
    [/^예상/, '예상'],
    [/^(추정|적정)|시나리오\s*범위/, '추정'],
    [/^(희망매각가|희망가|호가)|^asking/i, '호가'],
    [/^감정/, '감정가'],
    [/^(매입|취득)|장부\s*취득원가|(^|\s)인수(\s|원|가|$)/, '매입가'],
    [/^(매매계약|거래가|실거래|계약가)|확정금액\s*미보도/, '계약(환산)'],
    [/합계[\s\S]*개별가\s*미공개/, '합계 기준'],
    [/우협/, '우협가'],
    [/우선주|종류주/, '우선주'],
    [/보도/, '보도 기준']
  ];
  function salePriceMeta(a) {
    var raw = String((a && a.price_info) || '').trim();
    var forced = a && a.price_type ? String(a.price_type) : '';
    if (!raw) return { label: '미공개', value: '가격 비공개', full: '가격 정보 없음' };
    if (/(가격|매각가|입찰가)\s*미공개/.test(raw) && raw.indexOf('확정금액') < 0)
      return { label: '미공개', value: '가격 비공개', full: raw };
    var amt = amountInText(raw);
    if (!amt) {
      var pp = raw.match(/^평당\s*([\d,]+\s*만원대?)/);
      if (pp) return { label: '평당', value: '평당 ' + pp[1].replace(/\s+/g, ''), full: raw };
      return { label: '미공개', value: '가격 비공개', full: raw };
    }
    var label = forced;
    if (!label) {
      for (var i = 0; i < SALE_PRICE_RULES.length; i++) {
        if (SALE_PRICE_RULES[i][0].test(raw)) { label = SALE_PRICE_RULES[i][1]; break; }
      }
    }
    return { label: label || '자료 기준', value: amt, full: raw };
  }

  /* 2026 3Q 서울 오피스 명목임대료 (원/평·월, 임대면적 기준) — 마켓 리포트 값 */
  var MKT_RENT = { CBD: 118108, GBD: 118700, YBD: 99500, '서울': 103785 };
/** 카드 폭에 맞게 '1억원' → '1억', '1,300만원' → '1,300만' */
  function shortAmt(s) {
    return String(s).replace(/\s+/g, '').replace(/(억|만)원$/, '$1');
  }
  function manWon(n) {
    n = Number(n) || 0;
    if (n >= 10000) return (Math.round(n / 1000) / 10) + '만';
    return n.toLocaleString('ko-KR');
  }
  function officeZone(a) {
    var z = String(fact(a, '권역') || '').toUpperCase(), m = z.match(/CBD|GBD|YBD/);
    if (m) return m[0];
    var ad = String(a.address || '') + ' ' + String(a.region || '');
    if (/중구|종로/.test(ad)) return 'CBD';
    if (/강남|서초/.test(ad)) return 'GBD';
    if (/영등포|여의도|마포/.test(ad)) return 'YBD';
    return '';
  }
  function areaPyTotal(a) {
    var s = String(a.scale_info || ''), m;
    m = s.match(/연면적\s*([\d,\.]+)\s*㎡\s*\(([\d,\.]+)\s*(?:py|평)/);
    if (m) return Number(m[2].replace(/,/g, ''));
    m = s.match(/연면적\s*([\d,\.]+)\s*평/);
    if (m) return Number(m[1].replace(/,/g, ''));
    return null;
  }
  /** Leasing Flyer '임대가능 층' 표에서 평당 월임대료 — 면적·보증금 구조가 맞는 행만 채택 */
  function flyerRents(a) {
    var PY = 3.305785, total = areaPyTotal(a), out = [];
    (a.facts || []).forEach(function (f) {
      var L = String(f.label || ''), v = String(f.value || '');
      if (L.indexOf('임대가능') !== 0 || !/\d/.test(v)) return;
      var parts = v.split(/\s*·\s*/);
      if (parts.length < 2) return;
      var floor = parts[0].trim().replace(/\s+/g, '');
      var body = parts.slice(1).join(' · ');
      var toks = body.match(/\(?\s*[\d,]+(?:\.\d+)?\s*\)?/g);
      if (!toks || toks.length < 3) return;
      var nums = toks.map(function (x) { return Number(String(x).replace(/[^\d.]/g, '')); });
      var dep = nums[nums.length - 3], rent = nums[nums.length - 2];
      var areas = nums.slice(0, Math.max(1, nums.length - 3));
      if (!(rent > 0) || !(dep > 0)) return;
      var first = areas[0], second = areas.length > 1 ? areas[1] : null, cand = [];
      if (second) {
        if (Math.abs(second - first / PY) / Math.max(first / PY, 1) < 0.06) cand.push(second);
        else if (Math.abs(second - first * PY) / Math.max(first * PY, 1) < 0.06) cand.push(first);
      }
      cand.push(first); cand.push(first / PY);
      for (var i = 0; i < cand.length; i++) {
        var apy = cand[i];
        if (!(apy > 0)) continue;
        if (total && (apy < total * 0.02 || apy > total * 1.02)) continue;
        var per = rent / apy;
        if (per >= 30000 && per <= 300000) { out.push({ floor: floor, per: per }); return; }
      }
    });
    if (!out.length) return null;
    var lo = Math.min.apply(null, out.map(function (x) { return x.per; }));
    var hi = Math.max.apply(null, out.map(function (x) { return x.per; }));
    return {
      text: (hi - lo < 1000) ? '월 ' + manWon(lo) + '원/평' : '월 ' + manWon(lo) + '~' + manWon(hi) + '원/평',
      basis: 'Leasing Flyer 임대가능 층(' + out.map(function (x) { return x.floor; }).join('·') + ') 평당 환산'
    };
  }
  /** 임대 카드 금액 — ① DB 명시 임대료 ② Flyer 층별 표 ③ 오피스 권역 평균 추정 ④ 매각 호가 등 */
  function leaseRentMeta(a) {
    var raw = String((a && a.price_info) || '').trim();
    var forced = a && a.price_type ? String(a.price_type) : '';
    var m = raw.match(/월\s*임대료?\s*평당\s*([\d,]+)\s*원/);
    if (m) return { label: forced || '호가', value: '월 ' + manWon(m[1].replace(/,/g, '')) + '원/평', full: raw };
    var dep = raw.match(/보증금\s*(약?\s*\d[\d,]*(?:\.\d+)?\s*(?:억원?|만원))/);
    var mon = raw.match(/월\s*(?:임대료|세)?\s*(약?\s*\d[\d,]*(?:\.\d+)?\s*(?:억원?|만원))/);
    if (mon) {
      return {
        label: forced || '호가',
        value: (dep ? '보증금 ' + shortAmt(dep[1]) + ' · ' : '') + '월 ' + shortAmt(mon[1]),
        full: raw
      };
    }
    var fr = flyerRents(a);
    if (fr) return { label: '호가', value: fr.text, full: raw || fr.basis, basis: fr.basis };
    if (a.sector === 'office') {
      var z = officeZone(a), base = (z && MKT_RENT[z]) ? MKT_RENT[z] : MKT_RENT['서울'];
      return {
        label: '추정', value: '월 ' + manWon(base) + '원/평', full: raw || '',
        basis: '2026 3Q ' + (z || '서울') + ' 오피스 평균 임대료 ' + base.toLocaleString('ko-KR') + '원/평(임대면적) — 건물별 실임대료 아님, Flyer 확인 필요'
      };
    }
    var alt = salePriceMeta(a);
    if (alt.label !== '미공개' && alt.label !== '자료 기준') return alt;
    if (/(임대료|보증금|조건)[^·/]{0,24}(협의|제안)|협의\s*(가능|단계)/.test(raw)) return { label: '미공개', value: '임대료 협의', full: raw };
    return { label: '미공개', value: '임대료 비공개', full: raw || '임대료 정보 없음' };
  }

  /* 단계 라벨 — 기존 status·facts 문구를 짧게 (파이프라인 진행 순서로 판정) */
  var STAGE_SALE = [
    [/매매\s*계약|양도\s*계약|계약\s*체결/, '매매계약'],
    [/클로징/, '클로징'],
    [/우협|우선협상/, '우협 선정'],
    [/RFP/, 'RFP'],
    [/입찰|LOI|오퍼/, '입찰·LOI'],
    [/자문사\s*선정/, '자문사 선정'],
    [/IM|티저|Teaser|매각안내문|매각자료|매각제안서|플라이어|Flyer|물건홍보|마케팅/, '마케팅'],
    [/전속/, '전속 매도'],
    [/유동화|우선주|투자자\s*모집/, '유동화'],
    [/매각\s*추진|매각진행중|매각\s*진행|매도/, '매각 추진'],
    [/협의/, '조건 협의']
  ];
  var STAGE_LEASE = [
    [/계약\s*체결|계약\s*완료/, '계약 체결'],
    [/LOI|오퍼/, 'LOI 접수'],
    [/(가격|조건|임대료)\s*협의/, '조건 협의'],
    [/마스터리스|책임임대차/, '마스터리스'],
    [/임차인\s*모집|물건홍보|플라이어|Flyer|임대\s*진행|임대\s*중|임대\s*홍보/, '임차인 모집'],
    [/검토/, '임대 검토']
  ];
  function stageOf(a, kind) {
    var cands = [], i, j;
    if (kind === 'sale') {
      cands.push(String(a.status || ''));
      ['진행상황', '진행단계', 'NAI 상태', '단계', '매수인·투자자(예상)'].forEach(function (L) {
        cands.push(String(fact(a, L) || ''));
      });
    } else {
      cands.push(String(fact(a, 'NAI 상태') || ''));
      cands.push(String(a.status || ''));
      cands.push(String(a.status_group || ''));
    }
    var table = (kind === 'sale') ? STAGE_SALE : STAGE_LEASE;
    for (i = 0; i < cands.length; i++) {
      if (!cands[i]) continue;
      for (j = 0; j < table.length; j++) {
        if (table[j][0].test(cands[i])) {
          var lab = table[j][1];
          if (lab === 'RFP') lab = /자문/.test(cands[i]) ? '자문 RFP' : 'RFP 발송';
          return { label: lab, basis: (i === 0 ? '' : cands[i]) };
        }
      }
    }
    return { label: '', basis: '' };
  }
  function cardTitle(a, kind, st, pm) {
    var t = [];
    if (st && st.label) t.push('단계: ' + st.label + (st.basis ? ' (근거: ' + st.basis + ')' : ''));
    if (pm) t.push((kind === 'lease' ? '임대료' : '금액') + ': ' + (pm.label && pm.label !== '미공개' ? pm.label + ' ' : '') + (pm.full || pm.value));
    if (pm && pm.basis) t.push('근거: ' + pm.basis);
    return t.join(' / ');
  }

  function sectorLabel(k) {
    var S = CFG.SECTORS || {};
    return (S[k] && S[k].label) || k || '기타';
  }
  function sectorColor(k) {
    var S = CFG.SECTORS || {};
    return (S[k] && S[k].color) || '#64748b';
  }
  function todayStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function daysUntil(str) {
    var m = String(str || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 23, m[5] ? Number(m[5]) : 59, 0);
    if (isNaN(d.getTime())) return null;
    var now = new Date();
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((a - b) / 86400000);
  }
  function ddayBadge(asset) {
    var bid = fact(asset, '입찰일') || asset.maturity_schedule || '';
    if (/수의계약/.test(bid) || /수의계약/.test(String(asset.status || ''))) {
      return { cls: 'nego', label: '수의계약', sub: '직전 최저가 하한' };
    }
    var n = daysUntil(bid);
    if (n === null) return { cls: 'soon', label: '입찰', sub: bid };
    if (n < 0) return { cls: 'past', label: '마감', sub: Math.abs(n) + '일 전' };
    if (n === 0) return { cls: 'today', label: 'D-Day', sub: '오늘 마감' };
    if (n <= 3) return { cls: 'urgent', label: 'D-' + n, sub: bid };
    if (n <= 7) return { cls: 'soon', label: 'D-' + n, sub: bid };
    return { cls: 'later', label: 'D-' + n, sub: bid };
  }
  function isOnSale(a) {
    var g = String(a.status_group || '');
    var s = String(a.status || '');
    if (isAuction(a)) return true;
    if (g === '거래진행중' || g === '만기·매각예정') return true;
    return /매각|매물|입찰|공매|경매|매도/.test(s);
  }

  /* ─────────────────── 홈 렌더 (2026-11-27 재배치) ───────────────────
     순서: 히어로·KPI → 물건검색 → 오늘 아티클 → 공지 → 업무신청 → 매각중 물건 → 진행중인 deal 참여
     · KPI 박스를 누르면 해당 조건의 물건 리스트가 바로 열립니다.
     · 접수 내역은 업무신청 아래 글자 버튼으로만 접근합니다(별도 섹션 제거). */
  function renderShell() {
    var host = $('#homeView');
    if (!host) return;
    var st = window.naiMap && window.naiMap.state;
    var all = assets();
    var auc = all.filter(isAuction);
    var liveAuc = auc.filter(function (a) { var d = daysUntil(fact(a, '입찰일')); return d !== null && d >= 0; });
    var nego = auc.filter(function (a) { return /수의계약/.test(fact(a, '입찰일') + String(a.status || '')); });
    var saleN = all.filter(function (a) { return tradeStateOf(a) === 'sale'; }).length;
    var leaseN = all.filter(function (a) { return tradeStateOf(a) === 'lease'; }).length;
    var meNow = me();

    var html = '';
    html += '<div class="home-hero">';
    html += '<div class="hh-left">';
    html += '<p class="hh-kicker">딜 브릿지</p>';
    html += '<h1 class="hh-title">오늘의 <b>딜 브릿지</b></h1>';
    html += '<button type="button" class="hh-report" data-home="report">' +
      '<span class="hr-i">📊</span>' +
      '<span class="hr-t"><b>2026 3Q 통합 마켓 리포트</b><em>공실률 2계열 · NOC 2계열 · 2026 거래 35건 12.59조 · 4Q 전망</em></span>' +
      '<span class="hr-go">바로 보기 →</span></button>';
    html += '<p class="hh-meta">' + (st && st.meta && st.meta.source ? esc(st.meta.source) : '비공개 시트 연동') +
      ' · 기준 ' + esc(todayStr()) + (meNow && meNow.name ? ' · ' + esc(meNow.name) : '') + '</p>';
    html += '</div>';
    /* KPI — 누르면 조건에 해당하는 물건 리스트가 모달로 열립니다 (2026-11-27) */
    html += '<div class="hh-kpis">';
    html += kpi('물건 DB', (all.length || 0).toLocaleString('ko-KR') + '건', '전 섹터 · 누르면 리스트', 'all');
    html += kpi('매각중', (saleN || 0).toLocaleString('ko-KR') + '건', '매각 진행 자산', 'sale');
    html += kpi('임대중', (leaseN || 0).toLocaleString('ko-KR') + '건', '임차인 모집·임대 진행', 'lease');
    html += kpi('경·공매', (auc.length || 0).toLocaleString('ko-KR') + '건', '입찰임박 ' + liveAuc.length + ' · 수의계약 ' + nego.length, 'auc');
    html += '</div></div>';

    html += '<div class="home-grid">';

    /* ① 물건검색 — 업무 신청 위 (2026-11-27) */
    html += '<section class="home-card hc-search" id="hcSearch">';
    html += '<div class="hc-head"><h2>🔍 물건검색</h2><span class="hc-hint">결과를 누르면 지도·상세로 이동합니다</span></div>';
    html += '<div class="hs-form">';
    html += '<input id="hsQ" type="search" data-enter="search" placeholder="건물명 · 주소 · 운용사 · 임차인 검색" autocomplete="off">';
    html += '<select id="hsSector"><option value="ALL">전체 섹터</option></select>';
    html += '<select id="hsDeal"><option value="ALL">일반+경공매</option><option value="general">일반 자산</option><option value="auction">경·공매</option><option value="sale">매각중</option><option value="lease">임대중</option></select>';
    html += '<select id="hsRegion"><option value="ALL">전체 권역</option></select>';
    html += '<select id="hsPrice"><option value="ALL">가격 전체</option><option value="0-300">300억 미만</option><option value="300-1000">300~1,000억</option><option value="1000-3000">1,000~3,000억</option><option value="3000-">3,000억 이상</option><option value="none">가격 미상</option></select>';
    html += '<button type="button" class="btn btn-solid" data-home="do-search">검색</button>';
    html += '</div>';
    html += '<div id="hsResult" class="hs-result"><p class="hs-empty">조건을 선택하고 <b>검색</b>을 누르세요. (전체 ' + all.length.toLocaleString('ko-KR') + '건)</p></div>';
    html += '</section>';

    /* ② 오늘의 아티클 · 공지 — 업무신청 바로 윗줄, 글자 위주 (2026-11-27) */
    html += '<section class="home-card hc-today" id="hcToday">';
    html += '<div class="today-row" id="hrArt"><span class="tr-k">📰 오늘 아티클</span><span class="tr-v">불러오는 중…</span></div>';
    html += '<div class="today-row noti" id="hrNoti"><span class="tr-k">📢 공지</span><span class="tr-v">불러오는 중…</span></div>';
    html += '<div class="today-more">' +
      '<button type="button" class="mini-btn" data-home="art-all">아티클 전체 보기</button>' +
      (isAdmin() ? '<button type="button" class="mini-btn" data-home="noti-new">＋ 공지 등록</button>' : '') +
      (isAdmin() ? '<button type="button" class="mini-btn" data-home="art-new">＋ 아티클 등록</button>' : '') + '</div>';
    html += '</section>';

    /* ③ 업무 신청 — TR · LM · 매입 · 매각 + 대출·금융주선(자격증명) + 자문사 딜 참여 */
    html += '<section class="home-card hc-apply" id="hcApply">';
    html += '<div class="hc-head"><h2>🧾 업무 신청 <span class="hc-tag">바로 접수</span></h2>' +
      '<span class="hc-hint">버튼을 누르면 해당 신청서가 바로 열립니다</span></div>';
    html += '<div class="apply-grid">';
    html += applyBtn('tr', '📋', 'TR 신청', '임차의뢰 · 희망 조건 접수', '화주·임차인');
    html += applyBtn('lease', '🔑', 'LM 신청', '임대 물건·공실 등록', '임대 자문');
    if (!isLogi()) html += applyBtn('buy', '🎯', '매입 신청', '사옥·투자 매입 의향', '예산·권역 조건');
    html += applyBtn('sale', '🏷️', '매각 신청', '매물 등록 · 매각 자문', '검토 → 입찰');
    html += applyBtn('finance', '🏦', '대출신청·금융주선', '금리·LTV·트랑슈 조건 제시', '자격증명 필수');
    html += applyBtn('advisor', '🧾', '자문사 딜 참여', '매각·매입·임대·금융 자문 참여', '자격·실적 확인');
    html += '</div>';
    html += '<div class="hc-foot"><button type="button" class="mini-btn" data-home="hub-list">📥 접수 내역 보기</button> ' +
      '<button type="button" class="mini-btn" data-home="advise">🧾 자문사별 진행현황판</button></div>';
    html += '</section>';

    /* ④ 매각중인 물건 · D-Day */
    html += '<section class="home-card hc-deals" id="hcDeals">';
    html += '<div class="hc-head"><h2>🔥 매각중·임대중 물건 <span class="hc-tag">오피스 · 데이터센터 · 진행 중만</span></h2>' +
      '<div class="hc-tools"><button type="button" class="mini-btn" data-home="more-auction">경·공매 전체</button>' +
      '<button type="button" class="mini-btn" data-home="more-sale">매각중 전체</button>' +
      '<button type="button" class="mini-btn" data-home="more-lease">임대중 전체</button></div></div>';
    html += '<div id="dealStrip" class="deal-strip"></div>';
    html += '</section>';

    /* ⑤ 진행중인 deal 참여 — 중복 항목(물건검색·물건등록·TM·IM·3Q리포트·대출) 정리 */
    html += '<section class="home-card hc-quick">';
    html += '<div class="hc-head"><h2>⚡ 진행중인 deal 참여</h2><span class="hc-hint">지금 진행 중인 딜에 바로 참여하거나 의향을 남깁니다</span></div>';
    html += '<div class="quick-grid">';
    html += tile('🤖', 'AI 매물 매칭', '문장으로 조건 검색', 'match');
    html += tile('📝', '인수·임차의향서', '매입·임차 조건 제출', 'loi');
    html += tile('📝', '딜·참여 등록', '매각·매입·임대·TR·호텔·금융·자문 7종', 'hub');
    if (!isLogi()) html += tile('🏢', '자문사 VDR', 'RFP·렌트롤·LOI·AI 쇼트리스트', 'vdr'); /* 물류TF 는 VDR·FI·SI 접근 없음 */
    html += '</div></section>';

    html += '</div>'; /* home-grid */
    host.innerHTML = html;
    host.dataset.count = String(all.length);

    /* 섹터·권역 옵션 채우기 */
    var secSel = $('#hsSector');
    if (secSel) {
      var S = CFG.SECTORS || {};
      Object.keys(S).forEach(function (k) {
        var n = all.filter(function (a) { return a.sector === k; }).length;
        if (!n) return;
        var o = document.createElement('option');
        o.value = k; o.textContent = (S[k].label || k) + ' (' + n + ')';
        secSel.appendChild(o);
      });
    }
    var regSel = $('#hsRegion');
    if (regSel) {
      var regs = {};
      all.forEach(function (a) { if (a.region) regs[a.region] = (regs[a.region] || 0) + 1; });
      Object.keys(regs).sort(function (a, b) { return regs[b] - regs[a]; }).forEach(function (r) {
        var o = document.createElement('option');
        o.value = r; o.textContent = r + ' (' + regs[r] + ')';
        regSel.appendChild(o);
      });
    }

    renderDealStrip();
    renderToday();
  }

  function kpi(label, value, sub, key) {
    return '<button type="button" class="kpi kpi-' + (key || 'x') + '"' + (key ? ' data-home="kpi" data-kpi="' + key + '"' : '') + '>' +
      '<span class="kpi-k">' + esc(label) + '</span>' +
      '<strong class="kpi-v">' + esc(value) + '</strong><span class="kpi-s">' + esc(sub) + '</span></button>';
  }
  function tile(icon, title, sub, act) {
    return '<button type="button" class="qtile" data-home="' + act + '"><span class="qti">' + icon + '</span>' +
      '<span class="qtt">' + esc(title) + '</span><span class="qts">' + esc(sub) + '</span></button>';
  }
  /** 업무 신청 카드 — 업무 유형(hub.js TYPES code)을 그대로 엽니다 */
  function applyBtn(code, icon, title, sub, tag) {
    return '<button type="button" class="apply-btn v-' + code + '" data-home="apply" data-type="' + code + '">' +
      '<span class="ab-i" aria-hidden="true">' + icon + '</span>' +
      '<span class="ab-t"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span>' +
      (tag ? '<em>' + esc(tag) + '</em>' : '') + '</span>' +
      '<span class="ab-go" aria-hidden="true">신청 →</span></button>';
  }
  function subBox(label, kind, icon) {
    var n = BOOT.subs[kind] == null ? '—' : BOOT.subs[kind];
    return '<button type="button" class="subbox" data-home="subs" data-kind="' + kind + '">' +
      '<span class="sb-i">' + icon + '</span><span class="sb-k">' + esc(label) + '</span>' +
      '<strong class="sb-v" data-sub-count="' + kind + '">' + esc(String(n)) + '</strong></button>';
  }

  /* ── 매각중·임대중 물건 스트립 — 홈은 '진행 중'만, 섹터는 오피스·데이터센터 중심 (2026-11-27) ── */
  function homeSector() { return BOOT.homeSector || 'office'; }
  function inHomeSector(a) {
    /* 공유 그룹(TFT)이 켜져 있으면 그 그룹의 섹터만 (예: 물류센터 TFT → logistics) */
    if (window.NAI_TFT && window.NAI_TFT.isActive && window.NAI_TFT.isActive()) {
      return window.NAI_TFT.matchAsset(a);
    }
    var k = homeSector();
    if (k === 'ALL') return true;
    if (k === 'office') return a.sector === 'office';
    if (k === 'datacenter') return a.sector === 'datacenter';
    return true;
  }
  function renderDealStrip() {
    var host = $('#dealStrip');
    if (!host) return;
    var all = assets();
    var auc = all.filter(function (a) { return isAuction(a) && inHomeSector(a); });
    var scored = auc.map(function (a) {
      var n = daysUntil(fact(a, '입찰일'));
      return { a: a, n: (n === null ? 9999 : (n < 0 ? 10000 - Math.abs(n) : n)) };
    }).sort(function (x, y) { return x.n - y.n; }).slice(0, 12);

    var sale = all.filter(function (a) { return tradeStateOf(a) === 'sale' && inHomeSector(a); })
      .sort(function (a, b) { return (parseEok(b.price_info) || 0) - (parseEok(a.price_info) || 0); })
      .slice(0, 10);
    var lease = all.filter(function (a) { return tradeStateOf(a) === 'lease' && inHomeSector(a); })
      .sort(function (a, b) { return (parseEok(b.price_info) || 0) - (parseEok(a.price_info) || 0); })
      .slice(0, 10);

    var html = '<div class="strip-chips">' +
      (window.NAI_TFT && window.NAI_TFT.isActive()
        ? '<span class="strip-tft">🤝 ' + esc((window.NAI_TFT.group() || {}).name || 'TFT') + ' 적용 중</span>'
        : [['office', '🏢 오피스'], ['datacenter', '🖥️ 데이터센터'], ['ALL', '전체 섹터']].map(function (it) {
          return '<button type="button" class="mini-btn' + (homeSector() === it[0] ? ' is-on' : '') + '" data-home="home-sector" data-sector="' + it[0] + '">' + it[1] + '</button>';
        }).join('')) +
      '<span class="strip-note">진행 중인 매각·임대·경공매만 표시 (검토·예정·종결 제외)</span></div>';
    if (scored.length) {
      html += '<h3 class="strip-h">🏛️ 경·공매 · 입찰임박</h3><div class="cards-row">';
      scored.forEach(function (o) {
        var a = o.a, b = ddayBadge(a);
        var minBid = parseEok(fact(a, '최저입찰가')) || parseEok(a.price_info);
        html += '<button type="button" class="deal-card" data-home="open-asset" data-id="' + esc(a.id) + '">' +
          '<span class="dc-badge ' + b.cls + '">' + esc(b.label) + '</span>' +
          '<span class="dc-sector" style="color:' + sectorColor(a.sector) + '">' + esc(sectorLabel(a.sector)) + '</span>' +
          '<strong class="dc-name">' + esc(a.name) + '</strong>' +
          '<span class="dc-addr">' + esc(a.address || '') + '</span>' +
          '<span class="dc-price">' + (minBid ? '최저 ' + fmtEok(minBid) : esc(a.price_info || '가격 미상')) + '</span>' +
          '<span class="dc-date">' + esc(b.sub || '') + '</span></button>';
      });
      html += '</div>';
    }
    if (sale.length) {
      html += '<h3 class="strip-h">🏷️ 매각 진행 · 매각중</h3><div class="cards-row">';
      sale.forEach(function (a) {
        var pm = salePriceMeta(a), st = stageOf(a, 'sale');
        html += '<button type="button" class="deal-card" data-home="open-asset" data-id="' + esc(a.id) + '" title="' + esc(cardTitle(a, 'sale', st, pm)) + '">' +
          '<span class="dc-top"><span class="dc-badge t-sale">🏷️ 매각중</span>' +
          (st.label ? '<span class="dc-stage">' + esc(st.label) + '</span>' : '') + '</span>' +
          '<span class="dc-sector" style="color:' + sectorColor(a.sector) + '">' + esc(sectorLabel(a.sector)) + '</span>' +
          '<strong class="dc-name">' + esc(a.name) + '</strong>' +
          '<span class="dc-addr">' + esc(a.address || '') + '</span>' +
          '<span class="dc-price">' + priceTagHTML(pm.label) + '<b>' + esc(pm.value) + '</b></span>' +
          '<span class="dc-date">' + esc(a.status || '') + '</span></button>';
      });
      html += '</div>';
    }
    if (lease.length) {
      html += '<h3 class="strip-h">🔑 임대 진행 · 임대중</h3><div class="cards-row">';
      lease.forEach(function (a) {
        var rm = leaseRentMeta(a), st = stageOf(a, 'lease');
        html += '<button type="button" class="deal-card" data-home="open-asset" data-id="' + esc(a.id) + '" title="' + esc(cardTitle(a, 'lease', st, rm)) + '">' +
          '<span class="dc-top"><span class="dc-badge t-lease">🔑 임대중</span>' +
          (st.label ? '<span class="dc-stage">' + esc(st.label) + '</span>' : '') + '</span>' +
          '<span class="dc-sector" style="color:' + sectorColor(a.sector) + '">' + esc(sectorLabel(a.sector)) + '</span>' +
          '<strong class="dc-name">' + esc(a.name) + '</strong>' +
          '<span class="dc-addr">' + esc(a.address || '') + '</span>' +
          '<span class="dc-price">' + priceTagHTML(rm.label) + '<b>' + esc(rm.value) + '</b></span>' +
          '<span class="dc-date">' + esc(a.status || '') + '</span></button>';
      });
      html += '</div>';
    }
    if (!html) html = '<p class="hs-empty">표시할 물건이 없습니다.</p>';
    host.innerHTML = html;
  }

  /* ── 아티클 ── (2026-11-26: 최신순 정렬 · 내부 스크롤 · 더 보기 · 전체 검색) */
  function dayNum(a) {
    var s = String((a && a.date) || '');
    var m = s.match(/(\d{4})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})/);
    if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
    var t = Date.parse(s);
    if (!isNaN(t)) { var d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
    return 0;
  }
  function epNum(a) {   /* 회차·ID 끝자리 숫자 (trend-2026-11-23-656 → 656) */
    var m = String((a && a.id) || '').match(/-(\d{1,4})\s*$/);
    return m ? Number(m[1]) : -1;
  }
  function isDaily(a) {
    if (/-daily$/i.test(String((a && a.id) || ''))) return true;
    return /데일리\s*딜\s*브리핑/.test(String((a && a.title) || ''));
  }
  /* 날짜 내림차순 → 같은 날짜는 데일리 브리핑 먼저 → 회차/ID 내림차순 */
  function sortArticles(list) {
    return (list || []).slice().sort(function (x, y) {
      var d = dayNum(y) - dayNum(x);
      if (d) return d;
      var xd = isDaily(x) ? 1 : 0, yd = isDaily(y) ? 1 : 0;
      if (xd !== yd) return yd - xd;
      var e = epNum(y) - epNum(x);
      if (e) return e;
      return String(y.id || '').localeCompare(String(x.id || ''));
    });
  }
  function artItemHTML(a, idx, sumLen, act) {
    return '<button type="button" class="art-item" data-home="' + (act || 'open-article') + '" data-idx="' + idx + '">' +
      '<span class="ai-date">' + esc(a.date || '') + (isDaily(a) ? '<em class="ai-badge">데일리</em>' : '') + '</span>' +
      '<span class="ai-title">' + esc(noNai(a.title || '(제목 없음)')) + '</span>' +
      '<span class="ai-sum">' + esc(noNai(a.summary || '')).slice(0, sumLen || 140) + '</span></button>';
  }
  function artShownCount() {
    return Math.min(Math.max(BOOT.artShown || ART_INIT, ART_INIT), BOOT.articles.length);
  }
  function renderArticles(keepScroll) {
    var host = $('#artList');
    if (!host) return;
    if (!BOOT.loaded) { host.innerHTML = '<p class="hs-empty">불러오는 중…</p>'; renderArtFoot(); return; }
    var all = BOOT.articles;
    if (!all.length) {
      host.innerHTML = '<p class="hs-empty">아직 등록된 아티클이 없습니다.<br>매일 오전 8시에 전일 부동산 딜 아티클이 올라옵니다.</p>';
      renderArtFoot();
      return;
    }
    var prevH = keepScroll ? host.scrollHeight : 0;
    host.innerHTML = all.slice(0, artShownCount()).map(function (a, i) { return artItemHTML(a, i, 140); }).join('');
    host.scrollTop = prevH;   /* 더 보기: 새로 붙은 첫 건이 스크롤 위쪽에 오도록 */
    renderArtFoot();
  }
  function renderArtFoot() {
    var foot = $('#artFoot');
    if (!foot) return;
    if (!BOOT.loaded || !BOOT.articles.length) { foot.innerHTML = ''; return; }
    var total = BOOT.articles.length, shown = artShownCount(), rest = total - shown;
    var h = '<span class="art-count">' + total.toLocaleString('ko-KR') + '건 · 최신순' + (rest > 0 ? ' · ' + shown + '건 표시' : '') + '</span>' +
      '<span class="art-btns">';
    if (rest > 0) h += '<button type="button" class="mini-btn" data-home="art-more">더 보기 (+' + Math.min(ART_STEP, rest) + '건)</button>';
    h += '<button type="button" class="mini-btn art-all-btn" data-home="art-all">🔎 전체 아티클 보기 (검색)</button>';
    foot.innerHTML = h + '</span>';
  }

  /* 전체 아티클 — 검색 + 스크롤 (열기는 정렬된 BOOT.articles 인덱스 그대로) */
  function openArticleList() {
    if (!BOOT.loaded) { toast('아티클을 불러오는 중입니다. 잠시 후 다시 눌러주세요.'); return; }
    var body = '<div class="art-search"><input id="artQ" type="search" autocomplete="off" data-enter="search" ' +
      'placeholder="제목 · 요약 · 날짜 · 태그 검색 (예: 물류, 11/26)" value="' + esc(BOOT.artQ || '') + '">' +
      '<span class="art-qcount" id="artQCount"></span></div>' +
      '<div class="art-all-list" id="artAllList"><p class="hs-empty">불러오는 중…</p></div>';
    openModal('📰 전체 아티클 — 최신순', body, { wide: true, onMount: function (m) {
      m.classList.add('art-modal');
      renderArtAll();
      var q = m.querySelector('#artQ');
      if (q) {
        q.addEventListener('input', function () { BOOT.artQ = q.value; renderArtAll(); });
        q.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (e.isComposing || e.keyCode === 229) return;
          BOOT.artQ = q.value; renderArtAll();
        });
        setTimeout(function () { try { q.focus(); } catch (err) { /* noop */ } }, 80);
      }
    } });
  }
  function renderArtAll() {
    var host = $('#artAllList');
    if (!host) return;
    var q = String(BOOT.artQ || '').trim().toLowerCase();
    var rows = [];
    BOOT.articles.forEach(function (a, i) {
      if (q) {
        var hay = [a.date, a.title, a.summary, a.tags, a.source].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return;
      }
      rows.push({ a: a, i: i });
    });
    var cnt = $('#artQCount');
    if (cnt) cnt.textContent = rows.length.toLocaleString('ko-KR') + '건';
    if (!rows.length) { host.innerHTML = '<p class="hs-empty">검색 결과가 없습니다. 다른 키워드로 찾아보세요.</p>'; return; }
    host.innerHTML = rows.map(function (r) { return artItemHTML(r.a, r.i, 160, 'art-open-list'); }).join('');
    host.scrollTop = 0;
  }

  /* ── 공지 ── */
  function renderNotices() {
    var host = $('#notiList');
    if (!host) return;
    if (!BOOT.loaded) { host.innerHTML = '<p class="hs-empty">불러오는 중…</p>'; return; }
    var list = BOOT.notices.slice(0, 6);
    if (!list.length) { host.innerHTML = '<p class="hs-empty">등록된 공지가 없습니다.</p>'; return; }
    host.innerHTML = list.map(function (n, i) {
      return '<button type="button" class="noti-item" data-home="open-notice" data-idx="' + i + '">' +
        (String(n.pinned || '').toUpperCase() === 'Y' ? '<span class="ni-pin">📌</span>' : '') +
        '<span class="ni-title">' + esc(n.title || '(제목 없음)') + '</span>' +
        '<span class="ni-date">' + esc(n.date || '') + '</span></button>';
    }).join('');
  }

  /* ── 업무신청 윗줄: 오늘 아티클 · 공지 (글자 위주 · 2026-11-27) ── */
  function renderToday() {
    renderTodayArticles();
    renderTodayNotices();
  }
  function renderTodayArticles() {
    var host = $('#hrArt');
    if (!host) return;
    var v = host.querySelector('.tr-v');
    if (!v) return;
    if (!BOOT.loaded) { v.innerHTML = '<span class="tr-empty">불러오는 중…</span>'; return; }
    var today = todayStr();
    var todayList = BOOT.articles.filter(function (a) { return String(a.date || '').slice(0, 10) === today; });
    var fallback = false;
    var list = todayList;
    if (!list.length) { list = BOOT.articles.slice(0, 1); fallback = true; }
    if (!list.length) { v.innerHTML = '<span class="tr-empty">오늘 올라온 아티클이 없습니다.</span>'; return; }
    v.innerHTML = list.slice(0, 4).map(function (a) {
      var idx = BOOT.articles.indexOf(a);
      return '<button type="button" class="tr-art" data-home="open-article" data-idx="' + idx + '" title="' + esc(noNai(a.title || '')) + '">' +
        '<span class="ta-t">' + esc(noNai(a.title || '(제목 없음)')) + '</span>' +
        (fallback ? '<em class="ta-d">최근 ' + esc(a.date || '') + '</em>' : (isDaily(a) ? '<em class="ta-d">데일리</em>' : '')) +
        '</button>';
    }).join('<span class="tr-dot">·</span>');
  }
  function renderTodayNotices() {
    var host = $('#hrNoti');
    if (!host) return;
    var v = host.querySelector('.tr-v');
    if (!v) return;
    if (!BOOT.loaded) { v.innerHTML = '<span class="tr-empty">불러오는 중…</span>'; return; }
    var list = BOOT.notices.slice(0, 3);
    if (!list.length) { v.innerHTML = '<span class="tr-empty">등록된 공지가 없습니다.</span>'; return; }
    v.innerHTML = list.map(function (n, i) {
      return '<button type="button" class="tr-noti" data-home="open-notice" data-idx="' + i + '">' +
        (String(n.pinned || '').toUpperCase() === 'Y' ? '📌 ' : '') + esc(noNai(n.title || '(제목 없음)')) + '</button>';
    }).join('<span class="tr-dot">·</span>');
  }

  /* ── KPI 박스 → 해당 조건 물건 리스트 모달 + 엑셀 다운로드 (2026-11-27) ── */
  var KPL = { kind: 'all', sector: 'office' };
  function kpiListItems(noSector) {
    var all = assets();
    var list;
    if (KPL.kind === 'sale') list = all.filter(function (a) { return tradeStateOf(a) === 'sale'; });
    else if (KPL.kind === 'lease') list = all.filter(function (a) { return tradeStateOf(a) === 'lease'; });
    else if (KPL.kind === 'auc') list = all.filter(isAuction);
    else list = all.slice();
    if (!noSector && KPL.sector !== 'ALL') list = list.filter(function (a) { return a.sector === KPL.sector; });
    return list.sort(function (a, b) { return (parseEok(b.price_info) || 0) - (parseEok(a.price_info) || 0); });
  }
  function kpiListTitle() {
    if (KPL.kind === 'sale') return '🏷️ 매각중인 물건';
    if (KPL.kind === 'lease') return '🔑 임대중인 물건';
    if (KPL.kind === 'auc') return '🏛️ 경·공매 물건';
    return '📦 물건 DB 전체';
  }
  function kpiListBody() {
    var list = kpiListItems();
    var total = list.length;
    var CAP = 120;
    var rows = list.slice(0, CAP).map(function (a) {
      var b = isAuction(a) ? ddayBadge(a) : null;
      var ts = tradeStateOf(a);
      var st = ts ? stageOf(a, ts) : null;
      var meta = (ts === 'sale') ? salePriceMeta(a) : (ts === 'lease' ? leaseRentMeta(a) : null);
      return '<button type="button" class="hs-item" data-home="open-asset" data-id="' + esc(a.id) + '" title="' + esc(cardTitle(a, ts || 'sale', st, meta)) + '">' +
        '<span class="hsi-sector" style="background:' + sectorColor(a.sector) + '"></span>' +
        '<span class="hsi-main"><strong>' + esc(a.name) +
        (ts ? ' <span class="trade-badge mini t-' + ts + '">' + (ts === 'sale' ? '🏷️ 매각중' : '🔑 임대중') + (st && st.label ? ' · ' + esc(st.label) : '') + '</span>' : '') + '</strong>' +
        '<span class="hsi-sub">' + esc([sectorLabel(a.sector), a.region, a.status || ''].filter(Boolean).join(' · ')) + '</span></span>' +
        '<span class="hsi-right">' + (meta ? priceTagHTML(meta.label) + esc(meta.value) : esc(eokText(a) || a.price_info || '')) +
        (b ? ' <span class="dc-badge ' + b.cls + ' mini">' + esc(b.label) + '</span>' : '') + '</span></button>';
    }).join('');
    var sec = [['office', '🏢 오피스'], ['datacenter', '🖥️ 데이터센터'], ['ALL', '전체 섹터']];
    var head = '<div class="kp-list-head">' + sec.map(function (it) {
      return '<button type="button" class="mini-btn' + (KPL.sector === it[0] ? ' is-on' : '') + '" data-home="kpi-sector" data-sector="' + it[0] + '">' + it[1] + '</button>';
    }).join('') +
      '<span class="kpl-count"><b>' + total.toLocaleString('ko-KR') + '건</b>' +
      (total > CAP ? ' · 상위 ' + CAP + '건 표시' : '') +
      (KPL.sector === 'ALL' ? '' : ' <em class="kpl-all">(전체 섹터 ' + kpiListItems(true).length.toLocaleString('ko-KR') + '건)</em>') + '</span>' +
      '<span class="kpl-spacer"></span>' +
      '<button type="button" class="btn btn-ghost mini" data-home="kpi-xlsx">📥 엑셀 다운로드</button>' +
      '<button type="button" class="btn btn-solid mini" data-home="kpi-map" data-kpi-deal="' + esc(KPL.kind === 'all' ? '' : KPL.kind) + '">🗺️ 지도에서 보기</button></div>';
    return head + '<div class="hs-list">' + (rows || '<p class="hs-empty">해당하는 물건이 없습니다.</p>') + '</div>';
  }
  function renderKpiList() {
    var host = $('#kpiListBody');
    if (host) host.innerHTML = kpiListBody();
  }
  function openKpiList(kind, sector) {
    KPL.kind = kind || 'all';
    KPL.sector = sector || (kind === 'sale' || kind === 'lease' ? 'office' : 'ALL');
    openModal(kpiListTitle(), '<div id="kpiListBody">' + kpiListBody() + '</div>', { wide: true });
  }
  /** 현재 KPI 필터 목록 → 엑셀(xlsx) 다운로드 (SheetJS 없으면 CSV) — 시트 원본에 쓰지 않습니다 */
  function downloadKpiList() {
    var list = kpiListItems();
    if (!list.length) { toast('다운로드할 물건이 없습니다.', true); return; }
    var secLabel = KPL.sector === 'office' ? '오피스' : (KPL.sector === 'datacenter' ? '데이터센터' : '전체섹터');
    var kindLabel = KPL.kind === 'sale' ? '매각중' : (KPL.kind === 'lease' ? '임대중' : (KPL.kind === 'auc' ? '경공매' : '물건DB전체'));
    var stamp = todayStr().replace(/-/g, '');
    var base = 'AssetBridge_' + kindLabel + '_' + secLabel + '_' + stamp;
    var rows = list.map(function (a) {
      var ts = tradeStateOf(a);
      return {
        'ID': a.id || '', '물건명': a.name || '', '섹터': sectorLabel(a.sector), '구분': a.sub_type || '',
        '지역': a.region || '', '주소': a.address || '', '규모': a.scale_info || '', '가격·규모(억)': a.price_info || '',
        '진행상태': displayStatusOf(a), '상태그룹': a.status_group || '',
        '거래상태': ts === 'sale' ? '매각중' : (ts === 'lease' ? '임대중' : ''),
        '운용사/소유주': a.owner_amc || '', '임차인': a.tenants || '', '만기·일정': a.maturity_schedule || '',
        '출처': a.source || '', '기준일': a.updated_at || ''
      };
    });
    var fname = base;
    try {
      if (window.XLSX && XLSX.utils && XLSX.writeFile) {
        var ws = XLSX.utils.json_to_sheet(rows);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '물건');
        XLSX.writeFile(wb, fname + '.xlsx');
        toast(rows.length + '건을 엑셀(.xlsx)로 저장했습니다.');
        return;
      }
    } catch (e) { /* 아래 CSV로 대체 */ }
    var heads = Object.keys(rows[0]);
    var esc2 = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var csv = '\ufeff' + heads.join(',') + '\n' + rows.map(function (r) { return heads.map(function (h) { return esc2(r[h]); }).join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a2 = document.createElement('a');
    a2.href = url; a2.download = fname + '.csv';
    document.body.appendChild(a2); a2.click();
    setTimeout(function () { URL.revokeObjectURL(url); a2.remove(); }, 500);
    toast(rows.length + '건을 CSV로 저장했습니다.');
  }
  function displayStatusOf(a) {
    if (window.naiMap && window.naiMap.displayStatus) return window.naiMap.displayStatus(a);
    return a.status_group || a.status || '';
  }

  /* ── 관리자: 접수 내역 카운트 ── */
  function renderSubs() {
    ['lois', 'loans', 'doc_requests', 'proposals'].forEach(function (k) {
      apiGet(k).then(function (j) {
        if (j && j.ok) {
          BOOT.subs[k] = j.count;
          var el = $('[data-sub-count="' + k + '"]');
          if (el) el.textContent = String(j.count);
        }
      }).catch(function () { /* noop */ });
    });
  }

  function loadContent(force) {
    if (BOOT.loaded && !force) return Promise.resolve();
    return Promise.all([
      apiGet('articles').catch(function () { return null; }),
      apiGet('notices').catch(function () { return null; })
    ]).then(function (res) {
      BOOT.articles = ((res[0] && res[0].items) || []).filter(function (a) {
        /* 🔒 팀장회의·월요회의 자료는 NAI 탭에서만 본다 (관리자에게만 내려오는 비공개 글) */
        var t = String(a.tags || '');
        if (t.indexOf('팀장회의') >= 0 || t.indexOf('월요회의') >= 0) return false;
        if (String(a.status || '') === '비공개') return false;
        return true;
      });
      BOOT.articles = sortArticles(BOOT.articles);   /* 시트 행 순서와 무관하게 최신순 */
      if (!BOOT.artShown) BOOT.artShown = ART_INIT;
      BOOT.notices = (res[1] && res[1].items) || [];
      BOOT.loaded = true;
      renderToday();
      renderArticles();
      renderNotices();
    });
  }

  /* ─────────────────── 모달 ─────────────────── */
  var modalEl = null;
  function openModal(title, bodyHTML, opts) {
    closeModal();
    opts = opts || {};
    modalEl = document.createElement('div');
    modalEl.className = 'home-modal' + (opts.wide ? ' wide' : '') + (opts.deck ? ' deck' : '');
    modalEl.innerHTML = '<div class="hm-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="hm-head"><strong>' + esc(title) + '</strong><button type="button" class="hm-close" aria-label="닫기">×</button></div>' +
      '<div class="hm-body">' + bodyHTML + '</div></div>';
    document.body.appendChild(modalEl);
    modalEl.addEventListener('click', function (e) {
      if (e.target === modalEl || e.target.closest('.hm-close')) closeModal();
    });
    if (opts.onMount) opts.onMount(modalEl);
    return modalEl;
  }
  function closeModal() {
    if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    modalEl = null;
  }

  /* 물건 선택 (datalist) */
  function assetPickerHTML(idPrefix, selectedId) {
    var list = assets().map(function (a) {
      return '<option value="' + esc(a.name) + '">' + esc((a.address || '') + ' · ' + sectorLabel(a.sector)) + '</option>';
    }).join('');
    var sel = '';
    if (selectedId) {
      var a = assets().filter(function (x) { return x.id === selectedId; })[0];
      if (a) sel = a.name;
    }
    return '<label class="fm wide"><span>대상 물건 *</span>' +
      '<input id="' + idPrefix + 'Asset" list="' + idPrefix + 'AssetList" value="' + esc(sel) + '" placeholder="물건명을 입력하거나 목록에서 선택 (직접 입력 가능)">' +
      '<datalist id="' + idPrefix + 'AssetList">' + list + '</datalist>' +
      '<input type="hidden" id="' + idPrefix + 'AssetId" value="' + esc(selectedId || '') + '"></label>';
  }
  function resolveAsset(nameVal) {
    var n = String(nameVal || '').trim();
    if (!n) return { id: '', name: '' };
    var hit = assets().filter(function (a) { return a.name === n; })[0];
    return hit ? { id: hit.id, name: hit.name } : { id: '', name: n };
  }

  function formRow(label, id, opts) {
    opts = opts || {};
    var wide = opts.wide ? ' wide' : '';
    var input;
    if (opts.type === 'select') {
      input = '<select id="' + id + '">' + (opts.options || '') + '</select>';
    } else if (opts.type === 'textarea') {
      input = '<textarea id="' + id + '" rows="3" placeholder="' + esc(opts.ph || '') + '"></textarea>';
    } else {
      input = '<input id="' + id + '" type="' + (opts.type || 'text') + '" placeholder="' + esc(opts.ph || '') + '"' +
        (opts.value != null ? ' value="' + esc(opts.value) + '"' : '') + '>';
    }
    return '<label class="fm' + wide + '"><span>' + esc(label) + '</span>' + input + '</label>';
  }
  function val(id) { var el = $('#' + id); return el ? String(el.value || '').trim() : ''; }
  function sectorOptions(sel) {
    var S = CFG.SECTORS || {};
    return Object.keys(S).map(function (k) {
      return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(S[k].label || k) + '</option>';
    }).join('');
  }

  /* ─────────────────── 물건등록 ─────────────────── */
  function openRegister(mode) {
    mode = mode || '직접';
    var body = '';
    body += '<div class="reg-modes" role="tablist">';
    ['TM', 'IM', '직접'].forEach(function (m) {
      body += '<button type="button" class="reg-mode' + (m === mode ? ' is-active' : '') + '" data-reg-mode="' + m + '">' +
        (m === 'TM' ? '📄 TM 기반' : m === 'IM' ? '📘 IM 기반' : '✏️ 직접 입력') + '</button>';
    });
    body += '</div>';
    body += '<p class="fm-note" id="regNote">' + regNote(mode) + '</p>';
    body += '<div class="fm-grid">';
    body += formRow('물건명 *', 'rgName', { wide: true, ph: '예) 서울 중구 OO타워' });
    body += formRow('섹터', 'rgSector', { type: 'select', options: sectorOptions('office') });
    body += formRow('구분', 'rgSubType', { ph: '예) 매각 검토 / 신축·개발' });
    body += formRow('주소', 'rgAddr', { wide: true, ph: '예) 서울 중구 청진동 70' });
    body += formRow('위도', 'rgLat', { ph: '37.5...' });
    body += formRow('경도', 'rgLng', { ph: '126.9...' });
    body += formRow('가격', 'rgPrice', { ph: '예) 희망 1,200억원' });
    body += formRow('규모·면적', 'rgScale', { ph: '예) 연면적 12,000평 / 대지 3,000평' });
    body += formRow('운용사·소유주', 'rgOwner', { ph: '' });
    body += formRow('진행상태', 'rgStatus', { ph: '예) 매각 검토' });
    body += formRow('비고', 'rgNotes', { wide: true, type: 'textarea', ph: '임차·수익·특이사항' });
    body += '</div>';
    body += '<div class="fm-actions"><button type="button" class="btn btn-solid" data-home="reg-submit">' + (isAdmin() ? '등록 (시트 즉시 반영)' : '등록 제안 보내기') + '</button>' +
      '<span class="fm-hint">' + (isAdmin() ? '관리자 등록은 <b>assets</b>에 즉시 반영됩니다.' : '내부·외부 등록은 <b>제안</b>으로 접수되어 관리자 승인 후 assets에 반영됩니다.') + '</span></div>';
    body += '<div class="fm-err hidden" id="rgErr"></div>';

    openModal('➕ 물건등록', body, {
      wide: true,
      onMount: function (root) {
        $$('[data-reg-mode]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            $$('[data-reg-mode]', root).forEach(function (x) { x.classList.remove('is-active'); });
            b.classList.add('is-active');
            var m = b.getAttribute('data-reg-mode');
            root.setAttribute('data-mode', m);
            var note = $('#regNote', root);
            if (note) note.textContent = regNote(m);
          });
        });
        root.setAttribute('data-mode', mode);
      }
    });
  }
  function regNote(mode) {
    if (mode === 'TM') return '📄 TM 기반: 티저(TM)에 담기는 항목(개요·위치·규모·가격·임차) 중심으로 입력합니다. 등록 후 상세 패널에서 TM을 바로 만들 수 있습니다.';
    if (mode === 'IM') return '📘 IM 기반: IM에 필요한 수익·임차·만기·투자 포인트까지 염두에 두고 입력합니다. 등록 후 IM 브리프를 바로 만들 수 있습니다.';
    return '✏️ 직접 입력: 필요한 항목만 빠르게 등록합니다.';
  }
  function submitRegister() {
    var name = val('rgName');
    if (!name) { regErr('물건명을 입력하세요.'); return; }
    var payload = {
      mode: ($('.home-modal') && $('.home-modal').getAttribute('data-mode')) || '직접',
      name: name,
      sector: val('rgSector'),
      sub_type: val('rgSubType'),
      address: val('rgAddr'),
      lat: val('rgLat'),
      lng: val('rgLng'),
      price_info: val('rgPrice'),
      scale_info: val('rgScale'),
      owner_amc: val('rgOwner'),
      status: val('rgStatus') || '매각 검토',
      notes: val('rgNotes')
    };
    apiPost({ action: 'submit_asset', proposal: payload }).then(function (j) {
      if (!j || !j.ok) { regErr('등록 실패: ' + ((j && j.error) || '알 수 없는 오류')); return; }
      closeModal();
      if (j.mode === 'assets') {
        toast('물건을 시트에 등록했습니다.');
        if (window.naiMap && window.naiMap.sync && window.naiMap.sync.connect) {
          window.naiMap.sync.connect(getToken()).then(function () { renderShell(); }).catch(function () { /* noop */ });
        }
      } else {
        toast('물건 등록 제안을 접수했습니다. (관리자 승인 후 반영)');
        if (isAdmin()) renderSubs();
      }
    }).catch(function () { regErr('네트워크 오류로 등록하지 못했습니다.'); });
  }
  function regErr(msg) {
    var el = $('#rgErr');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
    else toast(msg, true);
  }

  /* ─────────────────── 의향서 ─────────────────── */
  function openLOI(assetId) {
    var body = '';
    body += '<div class="fm-grid">';
    body += assetPickerHTML('loi', assetId);
    body += formRow('구분', 'loiDeal', { type: 'select', options: '<option value="매입">매입 (인수의향)</option><option value="임차">임차 (임차의향)</option>' });
    body += formRow('희망 가격', 'loiPrice', { ph: '예) 1,000억원' });
    body += formRow('희망 임차면적', 'loiArea', { ph: '예) 5,000평 / 3개층' });
    body += formRow('희망 임대료', 'loiRent', { ph: '예) 평당 월 3.5만원' });
    body += formRow('희망 시기', 'loiTime', { ph: '예) 2027년 상반기' });
    body += formRow('회사 *', 'loiCompany', { ph: '' });
    body += formRow('성명 *', 'loiName', { ph: '' });
    body += formRow('직책', 'loiTitle', { ph: '' });
    body += formRow('연락처 *', 'loiPhone', { ph: '010-0000-0000' });
    body += formRow('이메일', 'loiEmail', { type: 'email', ph: 'name@company.com' });
    body += formRow('메모', 'loiMemo', { wide: true, type: 'textarea', ph: '조건·전제·기타' });
    body += '</div>';
    body += '<div class="fm-actions"><button type="button" class="btn btn-solid" data-home="loi-submit">의향서 제출</button>' +
      '<span class="fm-hint">제출 내용은 비공개 시트 <b>lois</b>에 접수되며 담당자가 확인합니다.</span></div>';
    body += '<div class="fm-err hidden" id="loiErr"></div>';
    openModal('📝 인수·임차의향서', body, { wide: true });
  }
  function submitLOI() {
    var pick = resolveAsset(val('loiAsset'));
    if (!pick.id && !pick.name) { formErr('loiErr', '대상 물건을 선택하거나 입력하세요.'); return; }
    if (!val('loiCompany')) { formErr('loiErr', '회사명을 입력하세요.'); return; }
    if (!val('loiName')) { formErr('loiErr', '성명을 입력하세요.'); return; }
    if (!val('loiPhone')) { formErr('loiErr', '연락처를 입력하세요.'); return; }
    apiPost({
      action: 'submit_loi',
      loi: {
        asset_id: pick.id, asset_name: pick.name,
        deal_type: val('loiDeal'), price: val('loiPrice'), area_py: val('loiArea'),
        rent: val('loiRent'), timeline: val('loiTime'),
        company: val('loiCompany'), name: val('loiName'), title: val('loiTitle'),
        phone: val('loiPhone'), email: val('loiEmail'), memo: val('loiMemo')
      }
    }).then(function (j) {
      if (!j || !j.ok) { formErr('loiErr', '제출 실패: ' + ((j && j.error) || '오류')); return; }
      closeModal();
      toast('의향서를 접수했습니다.');
      if (isAdmin()) renderSubs();
    }).catch(function () { formErr('loiErr', '네트워크 오류로 제출하지 못했습니다.'); });
  }

  /* ─────────────────── 대출요청/조건제시 ─────────────────── */
  function openLoan(assetId) {
    var body = '';
    body += '<div class="fm-grid">';
    body += assetPickerHTML('ln', assetId);
    body += formRow('구분', 'lnKind', { type: 'select', options: '<option value="대출요청">대출요청 (차주 측)</option><option value="대출조건 제시">대출조건 제시 (대주 측)</option>' });
    body += formRow('금액', 'lnAmount', { ph: '예) 600억원' });
    body += formRow('LTV', 'lnLtv', { ph: '예) 60%' });
    body += formRow('금리', 'lnRate', { ph: '예) 4.5% (고정/변동)' });
    body += formRow('만기', 'lnMat', { ph: '예) 5년 (1년 연장옵션)' });
    body += formRow('트랑슈', 'lnTranche', { type: 'select', options: '<option value="선순위">선순위</option><option value="중순위">중순위</option><option value="후순위">후순위</option><option value="해당없음">해당없음</option>' });
    body += formRow('회사 *', 'lnCompany', { ph: '' });
    body += formRow('성명 *', 'lnName', { ph: '' });
    body += formRow('직책', 'lnTitle', { ph: '' });
    body += formRow('연락처 *', 'lnPhone', { ph: '010-0000-0000' });
    body += formRow('이메일', 'lnEmail', { type: 'email', ph: 'name@company.com' });
    body += formRow('메모', 'lnMemo', { wide: true, type: 'textarea', ph: '담보·전제·기타' });
    body += '</div>';
    body += '<div class="fm-actions"><button type="button" class="btn btn-solid" data-home="loan-submit">제출</button>' +
      '<span class="fm-hint">비공개 시트 <b>loans</b>에 접수됩니다.</span></div>';
    body += '<div class="fm-err hidden" id="lnErr"></div>';
    openModal('💰 대출요청 · 대출조건 제시', body, { wide: true });
  }
  function submitLoan() {
    var pick = resolveAsset(val('lnAsset'));
    if (!pick.id && !pick.name) { formErr('lnErr', '대상 물건을 선택하거나 입력하세요.'); return; }
    if (!val('lnCompany') || !val('lnName') || !val('lnPhone')) { formErr('lnErr', '회사·성명·연락처를 입력하세요.'); return; }
    apiPost({
      action: 'submit_loan',
      loan: {
        asset_id: pick.id, asset_name: pick.name, kind: val('lnKind'),
        amount: val('lnAmount'), ltv: val('lnLtv'), rate: val('lnRate'),
        maturity: val('lnMat'), tranche: val('lnTranche'),
        company: val('lnCompany'), name: val('lnName'), title: val('lnTitle'),
        phone: val('lnPhone'), email: val('lnEmail'), memo: val('lnMemo')
      }
    }).then(function (j) {
      if (!j || !j.ok) { formErr('lnErr', '제출 실패: ' + ((j && j.error) || '오류')); return; }
      closeModal();
      toast('대출 조건을 접수했습니다.');
      if (isAdmin()) renderSubs();
    }).catch(function () { formErr('lnErr', '네트워크 오류로 제출하지 못했습니다.'); });
  }
  function formErr(id, msg) {
    var el = $('#' + id);
    if (el) { el.textContent = msg; el.classList.remove('hidden'); } else toast(msg, true);
  }

  /* ─────────────────── TM / IM 브리프 (인쇄·PDF 저장) ─────────────────── */
  function naipHeader() {
    return '<div class="naip-brand"><span class="naip-logo">NAI<span>KOREA</span></span>' +
      '<span class="naip-conf">CONFIDENTIAL · 내부 검토용</span></div>';
  }

  /* ══════════ IM 슬라이드 프리뷰 (16:9) — 2026-11-24 ══════════
     와이즈파크 매각안내문(41p)의 구성(표지 · Executive Summary · 입지/교통 · 건축개요 ·
     임차/운영실적 · 수지/밸류에이션 · 매각구조 · Contact)을 그대로 따릅니다.
     값은 assets 시트 + facts 에서만 가져오므로 없는 항목은 '-'로 표시합니다. */
  function nval(v) { var n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function pickNum(s) {
    var m = String(s || '').match(/([\d,]+(?:\.\d+)?)/);
    return m ? Number(String(m[1]).replace(/,/g, '')) : 0;
  }
  /* 가격 문구에서 금액만 뽑되, 공사비·개발비처럼 가격이 아닌 금액은 제외 */
  function priceEokOf(a) {
    var t = String((a && a.price_info) || '');
    if (!t) return 0;
    var m = t.match(/([0-9][0-9,.]*)\s*억/);
    if (!m) return 0;
    var i = t.indexOf(m[0]);
    var pre = t.slice(Math.max(0, i - 10), i);
    if (/공사비|개발비|도급|공사|가정/.test(pre)) return 0;
    var n = Number(String(m[1]).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  }
  function factsOf(a) { return (a.facts || []).filter(function (f) { return String(f.label || '') !== '§DISC'; }); }
  function factBy(a, re) {
    var fs = factsOf(a);
    for (var i = 0; i < fs.length; i++) if (re.test(String(fs[i].label))) return fs[i].value;
    return '';
  }
  function engineOfAsset(a) {
    var txt = String(a.sub_type || '') + ' ' + String(a.name || '') + ' ' + String(a.scale_info || '');
    if (/골프/.test(txt)) return 'golf';
    if (/리조트|콘도/.test(txt)) return 'resort';
    if (a.sector === 'hotel') return 'hotel';
    if (a.sector === 'datacenter') return 'datacenter';
    return '';
  }
  function valSnapshot(a) {
    var eng = engineOfAsset(a);
    if (!eng || !window.NAI_VALSEC || !window.NAI_VALSEC.has(eng)) return null;
    try {
      var inp = window.NAI_VALSEC.defaults(eng, a);
      var r = window.NAI_VALSEC.calc(eng, inp);
      return { eng: eng, inp: inp, r: r, label: window.NAI_VALSEC.engine(eng).label };
    } catch (e) { return null; }
  }
  function n0s(v) { return (v === null || v === undefined || !isFinite(v)) ? '-' : Math.round(v).toLocaleString('ko-KR'); }
  function n1s(v) { return (v === null || v === undefined || !isFinite(v)) ? '-' : (Math.round(v * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function p1s(v) { return (v === null || !isFinite(v)) ? '-' : (Math.round(v * 10) / 10).toFixed(1) + '%'; }
  function p2s(v) { return (v === null || !isFinite(v)) ? '-' : (Math.round(v * 100) / 100).toFixed(2) + '%'; }

  function slide(title, no, inner, cls) {
    return '<section class="im-slide' + (cls ? ' ' + cls : '') + '">' +
      '<div class="ims-head"><span class="ims-logo">NAI<span>KOREA</span></span>' +
      '<span class="ims-no">' + (no || '') + '</span></div>' +
      '<div class="ims-body">' + inner + '</div>' +
      '<div class="ims-foot"><span>' + esc(title || '') + '</span><span>CONFIDENTIAL · ' + esc(todayStr()) + '</span></div></section>';
  }

  /** 실제 원문 IM/티저 링크 여부 — assets.im_url(클라우드 Drive) */
  function realImOf(a) {
    var u = String((a && a.im_url) || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }
  function hasImLabel(a) { return !!(a && String(a.im_label || '').trim()); }

  /** IM 상단 '실제 원문' 안내 — 링크가 있으면 열람, 없으면 원문 보유 표기 + 열람 요청 */
  /** 실제 원문 IM/티저 링크 — 직원(관리자·내부)만 열람, 외부는 요청 흐름 (2026-11-27) */
  function canImDoc() {
    return !!(window.naiMap && window.naiMap.canIm && window.naiMap.canIm());
  }
  function realImBanner(a) {
    var u = realImOf(a);
    if (u && canImDoc()) {
      return '<div class="im-real"><div><b>📘 실제 IM·티저 원문이 있습니다</b>' +
        '<span>' + esc(a.im_label || 'NAI 양식 원문 자료') + '</span></div>' +
        '<a class="btn btn-primary" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">원문 열람 ↗</a></div>';
    }
    if (hasImLabel(a) || u) {
      return '<div class="im-real ghost"><div><b>📘 이 물건은 원문 IM/티저를 보유하고 있습니다</b>' +
        '<span>' + esc(a.im_label || 'IM 원문 자료') + ' — 원문은 비공개 자료로, NDA·CA 체결 후 담당자 확인을 거쳐 제공됩니다.</span></div>' +
        '<button type="button" class="btn btn-ghost" data-home="im-source" data-id="' + esc(a.id) + '">📩 원문 열람 요청</button></div>';
    }
    return '<div class="im-real none"><div><b>이 물건은 원문 IM 링크가 등록되어 있지 않습니다</b>' +
      '<span>아래는 assets 시트의 확인된 값만으로 만든 <b>자동 생성 프리뷰</b>입니다. 제출용 IM 은 NAI 양식으로 별도 제작됩니다.</span></div></div>';
  }

  /** 값이 있는 항목만 표로 — 빈 칸·'-' 행이 남지 않게 */
  function kvTable(pairs, cls) {
    var rows = pairs.filter(function (r) { return r && r[1] !== undefined && r[1] !== null && String(r[1]).trim() !== '' && String(r[1]).trim() !== '-'; });
    if (!rows.length) return '';
    return '<table class="ims-table' + (cls ? ' ' + cls : '') + '"><tbody>' +
      rows.map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') +
      '</tbody></table>';
  }
  function kpiBox(label, value, sub) {
    if (value === undefined || value === null || String(value).trim() === '' || String(value).trim() === '-') return '';
    return '<div class="im-kpi"><span>' + esc(label) + '</span><b>' + value + '</b>' + (sub ? '<em>' + esc(sub) + '</em>' : '') + '</div>';
  }
  function emptyLine(msg) { return '<p class="ims-note im-empty-line">' + esc(msg) + '</p>'; }

  function imDeckHTML(a) {
    var fs = factsOf(a);
    var snap = valSnapshot(a);
    var priceEok = priceEokOf(a);
    var valNum = snap ? (snap.r.noi !== undefined ? snap.r.noi : (snap.r.ebit || 0)) : 0;

    /* 핵심 포인트: 실제 fact 만 사용 (없으면 확인된 사실만) */
    var highlightFacts = [];
    [/^(투자 구조|수익 구조)/, /^(컨버전 규모|업사이드)/, /^(관광 수요|수요 기반)/, /^(재분석 결론|검토 결론)/,
      /^(매각 조건)/, /^(개발)/, /^(임차·운영|운영 구조)/, /^(특화)/, /^(입지)/].forEach(function (re) {
      if (highlightFacts.length >= 4) return;
      var v = factBy(a, re);
      if (v) highlightFacts.push([String(fs.filter(function (f) { return re.test(String(f.label)); })[0].label), v]);
    });

    var specLabels = /^(소재지|용도지역|대지면적|건축면적|연면적|규모|건폐율|용적률|사용승인일|주차|승강기|구조|구성|층별|부지|모집 규모|임대 토지|임대 건물|개발비|밀도|건축 개요)/;
    var specs = fs.filter(function (f) { return specLabels.test(String(f.label)); }).slice(0, 10);
    var locFacts = fs.filter(function (f) { return /^(입지|교통|접근성|관광|상권|주변|개발 호재|거래사례|역세권)/.test(String(f.label)); }).slice(0, 5);
    var opsFacts = fs.filter(function (f) { return /^(임대차 구조|임대 조건|임대조건|보증금|비용 부담|중도해지|임차인|임차인 주주|임차인 실적|호텔 운영|호텔 실적|호텔 최고월|전대|운영사|책임임대차|임대율|가용 시점|사용 기간|완공|공실)/.test(String(f.label)); }).slice(0, 8);

    var imBadge = realImOf(a) ? 'REAL IM 보유' : (hasImLabel(a) ? 'IM 원문 보유' : 'AUTO PREVIEW');
    var html = '<div class="im-deck">';

    /* ① 표지 */
    html += slide('COVER', '', 
      '<div class="ims-cover">' +
      '<p class="ims-kicker">INFORMATION MEMORANDUM · ' + esc(imBadge) + '</p>' +
      '<h1>' + esc(a.name) + '</h1>' +
      '<p class="ims-loc">' + esc([sectorLabel(a.sector), a.region, a.address].filter(Boolean).join(' · ')) + '</p>' +
      '<div class="ims-cover-meta">' +
      '<span>' + esc(a.price_info || '가격 미공개(제안 방식)') + '</span>' +
      (a.owner_amc ? '<span>' + esc(a.owner_amc) + '</span>' : '') +
      (a.scale_info ? '<span>' + esc(a.scale_info) + '</span>' : '') +
      '</div>' +
      '<p class="ims-draft">NAI Korea 매각자문 · ' + esc(todayStr()) + '</p></div>', 'cover');

    /* ② Deal Summary — 항상 채워지는 값만 */
    html += slide('01 Deal Summary', '02',
      '<h2 class="ims-h2">Deal Summary</h2>' +
      '<div class="im-kpi-grid">' +
      kpiBox('거래 구분', a.sub_type || (a.status || ''), sectorLabel(a.sector)) +
      kpiBox('가격', priceEok ? fmtEokShort(priceEok) : '제안 방식', a.price_info) +
      kpiBox('규모', a.scale_info || factBy(a, /^연면적/) || '', a.region) +
      kpiBox('진행상태', displayStatusFor(a), a.owner_amc) +
      kpiBox('임차·운영', (a.tenants || factBy(a, /^임차인/) || '').slice(0, 40), a.maturity_schedule) +
      '</div>' +
      (highlightFacts.length ? '<div class="im-points">' + highlightFacts.map(function (h) {
        return '<div class="im-point"><span>' + esc(h[0]) + '</span><p>' + esc(h[1]) + '</p></div>';
      }).join('') + '</div>'
        : emptyLine('핵심 투자 포인트는 원문 IM·담당자 브리프에서 확인하세요. (자동 프리뷰는 확인된 수치만 표시합니다.)')));

    /* ③ 입지 */
    var locInner = '<div class="im-2col">' +
      '<div class="im-mapbox"><span class="im-pin">📍</span>' +
      '<b>' + esc(a.address || '주소 미등록') + '</b>' +
      '<em>' + esc([a.region, sectorLabel(a.sector)].filter(Boolean).join(' · ')) + '</em>' +
      '<i>' + esc((a.lat && a.lng) ? ('좌표 ' + a.lat + ', ' + a.lng) : '좌표 미확정') + '</i></div>' +
      '<div>' + (locFacts.length ? locFacts.map(function (f) {
        return '<div class="im-loc"><span>' + esc(f.label) + '</span><p>' + esc(f.value) + '</p></div>';
      }).join('') : emptyLine('입지·교통 상세는 원문 IM 참조. (주소·권역은 DB 확인값입니다.)')) + '</div></div>';
    html += slide('02 Location', '03', '<h2 class="ims-h2">입지 · 교통</h2>' + locInner);

    /* ④ 건축·시설 */
    var specRows = specs.length ? specs : [
      ['규모', a.scale_info || ''], ['주소', a.address || ''], ['섹터', sectorLabel(a.sector)]
    ];
    html += slide('03 Property', '04',
      '<h2 class="ims-h2">건축 · 시설 개요</h2>' + kvTable(specRows.map(function (f) { return [f.label, f.value]; })) +
      (specs.length ? '' : emptyLine('세부 건축 개요는 원문 IM·등기·건축물대장 확인값으로 보완됩니다.')));

    /* ⑤ 임대·운영 */
    var opsRows = [];
    if (a.tenants) opsRows.push(['임차인·운영', a.tenants]);
    if (a.maturity_schedule) opsRows.push(['만기·일정', a.maturity_schedule]);
    opsFacts.forEach(function (f) { opsRows.push([f.label, f.value]); });
    html += slide('04 Lease & Operation', '05',
      '<h2 class="ims-h2">임대 · 운영 현황</h2>' +
      (opsRows.length ? kvTable(opsRows) : emptyLine('임대차·운영 자료는 원문 IM(렌트롤)에서 확인합니다.')));

    /* ⑥ 수지 */
    var valInner;
    if (snap) {
      var r = snap.r;
      var hasPrice = nval(snap.inp.price_eok) > 0;
      valInner = '<div class="im-kpi-grid">' +
        kpiBox(hasPrice ? '총투자비' : 'CAPEX(가정)', n1s(r.total) + '억', hasPrice ? '매입가+부대비용' : '매입가 미공개') +
        kpiBox('Y1 NOI', n1s(r.noi !== undefined ? r.noi : r.ebit) + '억', '연 순영업이익') +
        kpiBox('수익률', hasPrice ? (r.entryCap !== undefined ? p2s(r.entryCap) : p1s(r.yield)) : '-', 'Going-in Cap') +
        kpiBox('Levered IRR', (hasPrice && isFinite(r.levIrr)) ? p2s(r.levIrr * 100) : '-', '보유기간 기준') +
        '</div>' +
        ((r.lines || []).length ? '<table class="ims-table"><tbody>' + (r.lines || []).slice(0, 6).map(function (l) {
          return '<tr><th>' + esc(l[0]) + '</th><td class="' + (l[1] < 0 ? 'neg' : '') + '">' + (l[1] < 0 ? '(' + n1s(Math.abs(l[1])) + ')' : n1s(l[1])) + '</td></tr>';
        }).join('') + '</tbody></table>' : '') +
        '<p class="ims-note">' + esc(snap.label) + ' 엔진 기본가정 기준' +
        (hasPrice ? '' : ' — 매입가가 공개되지 않아 IRR·수익률은 비웁니다(매수자 제안가 입력 시 계산)') +
        '. <b>📊 밸류에이션</b> 탭에서 OCC·ADR·공사비·금리·밸류애드를 바꿔 실시간 재계산할 수 있습니다.</p>';
    } else {
      valInner = '<div class="im-kpi-grid">' +
        kpiBox('가격', priceEok ? fmtEokShort(priceEok) : '제안 방식', a.price_info) +
        kpiBox('규모', a.scale_info || '', '') +
        '</div>' +
        emptyLine('이 물건은 섹터 수지 기본값이 아직 없습니다. 📊 밸류에이션 탭에서 렌트롤·OPEX 를 넣어 산출하거나, IM 원문의 수지표를 확인하세요.');
    }
    html += slide('05 Valuation', '06', '<h2 class="ims-h2">수지 · 밸류에이션</h2>' + valInner);

    /* ⑦ 매각 포인트 */
    var points = [];
    if (locFacts.length) points.push(['입지', locFacts[0].value]);
    if (opsRows.length) points.push(['임차·운영', opsRows[0][1]]);
    if (snap && isFinite(snap.r.levIrr)) points.push(['수익 구조', 'Levered IRR ' + p2s(snap.r.levIrr * 100) + (nval(snap.inp.price_eok) > 0 ? '' : ' (매입가 미확정)')]);
    if (specs.length) points.push(['규모·시설', specs[0].value]);
    html += slide('06 Sale Points', '07',
      '<h2 class="ims-h2">매각 포인트 · 밸류애드</h2>' +
      (points.length ? '<div class="im-points">' + points.map(function (p) {
        return '<div class="im-point"><span>' + esc(p[0]) + '</span><p>' + esc(p[1]) + '</p></div>';
      }).join('') + '</div>' : '') +
      '<table class="ims-table im-va-table"><tbody>' +
      '<tr><th>임대료 상향</th><td>명목 임대료 인상·리뉴얼로 NOI 확대</td></tr>' +
      '<tr><th>공실 해소</th><td>공실 임대·용도 전환으로 수입 회수</td></tr>' +
      '<tr><th>CAPEX 리포지셔닝</th><td>리모델링·설비 교체 후 Exit Cap 개선</td></tr>' +
      '</tbody></table>' +
      '<p class="ims-note">📊 <b>밸류에이션 탭 › 밸류애드 시뮬레이터</b>에서 임대료 상향률·공실 해소·CAPEX·Exit Cap 을 직접 조정해 As-Is 대비 IRR·자산가치 변화를 즉시 비교할 수 있습니다.</p>');

    /* ⑧ 일정 */
    var bidDate = fact(a, '입찰일') || fact(a, '입찰일·방식');
    html += slide('07 Process', '08',
      '<h2 class="ims-h2">매각 일정</h2>' +
      '<div class="ims-steps im-steps-h">' +
      [['NDA 체결', '자료 열람 전'], ['IM·자료 제공', hasImLabel(a) || realImOf(a) ? '원문 보유' : '제작 예정'],
       ['현장 실사', '일정 협의'], ['가격 제안', bidDate || '일정 협의'], ['우선협상·계약', '제안 후']]
        .map(function (s, i) {
          return '<div class="ims-step"><span>' + (i + 1) + '</span><b>' + esc(s[0]) + '</b><em>' + esc(s[1]) + '</em></div>';
        }).join('') + '</div>' +
      kvTable([['진행상태', a.status || a.status_group], ['입찰·마감', bidDate], ['매도인·자문', a.owner_amc], ['최종 갱신', a.updated_at]]));

    /* ⑨ Contact */
    html += slide('Contact', '09',
      '<h2 class="ims-h2">Contact</h2>' +
      '<div class="ims-contact"><div><b>NAI Korea</b><p>서울시 강남구 테헤란로 516 정헌빌딩 10층</p>' +
      '<p>TEL 02-508-1180 · FAX 02-508-1184</p><p>www.naikorea.com</p></div>' +
      '<div><b>담당</b><p>권준오 상무 · 010-7731-4316 · jk@naikorea.com</p>' +
      '<p>본 자료는 잠재 매수자 검토용이며, 매도인·매각자문사의 서면 동의 없이 복사·배포할 수 없습니다.</p></div></div>' +
      '<p class="ims-note">자동 생성 프리뷰 · ' + esc(todayStr()) + ' — 제출용 IM 은 NAI 양식 .pptx/.pdf 로 제작됩니다.</p>');

    html += '</div>';
    return html;
  }

  function fmtEokShort(v) { return (v >= 10000 ? (v / 10000).toFixed(2) + '조' : Math.round(v).toLocaleString('ko-KR') + '억'); }
  function displayStatusFor(a) {
    if (!a) return '';
    if (window.naiMap && window.naiMap.displayStatus) { try { return window.naiMap.displayStatus(a); } catch (e) { /* noop */ } }
    return a.status || a.status_group || '';
  }

  function briefHTML(a, kind) {
    var isTM = kind === 'TM';
    var title = isTM ? 'TEASER MEMORANDUM' : 'INFORMATION MEMORANDUM';
    var facts = (a.facts || []).filter(function (f) { return String(f.label || '') !== '§DISC'; });
    var rows = [
      ['섹터', sectorLabel(a.sector)],
      ['구분', a.sub_type],
      ['진행상태', a.status || a.status_group],
      ['운용사/소유주', a.owner_amc],
      ['펀드/리츠', a.fund_vehicle],
      ['규모', a.scale_info],
      ['가격', a.price_info],
      ['임차인/운영', a.tenants],
      ['만기/일정', a.maturity_schedule],
      ['주소', a.address],
      ['최종 갱신', a.updated_at]
    ].filter(function (r) { return r[1] && String(r[1]).trim() !== ''; });

    var aucRows = [];
    if (isAuction(a)) {
      aucRows = [
        ['감정가', fact(a, '감정가')], ['최저입찰가', fact(a, '최저입찰가')],
        ['할인율', fact(a, '할인율')], ['유찰횟수', fact(a, '유찰횟수')],
        ['입찰일·방식', fact(a, '입찰일')], ['진행기관', fact(a, '진행기관')]
      ].filter(function (r) { return r[1]; });
    }

    var html = '';
    html += '<div class="naip-cover">' + naipHeader() +
      '<div class="naip-cover-mid"><p class="naip-kicker">' + (isTM ? 'TEASER' : 'INVESTMENT BRIEF') + '</p>' +
      '<h1>' + esc(a.name) + '</h1>' +
      '<p class="naip-loc">' + esc([sectorLabel(a.sector), a.region, a.address].filter(Boolean).join(' · ')) + '</p>' +
      '<p class="naip-deal">' + esc(a.price_info || '') + '</p></div>' +
      '<div class="naip-cover-foot"><span>' + title + '</span><span>' + esc(todayStr()) + '</span></div></div>';

    html += '<section class="naip-sec"><h2>01. Deal Overview</h2><table class="naip-tb">';
    rows.forEach(function (r) { html += '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; });
    html += '</table></section>';

    if (aucRows.length) {
      html += '<section class="naip-sec"><h2>02. 경·공매 핵심 지표</h2><table class="naip-tb">';
      aucRows.forEach(function (r) { html += '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; });
      html += '</table></section>';
    }

    html += '<section class="naip-sec"><h2>' + (aucRows.length ? '03' : '02') + '. 위치 · 스펙</h2>' +
      '<table class="naip-tb"><tr><th>주소</th><td>' + esc(a.address || '-') + '</td></tr>' +
      '<tr><th>좌표</th><td>' + esc((a.lat && a.lng) ? (a.lat + ', ' + a.lng) : '좌표 미확정') + '</td></tr>' +
      '<tr><th>규모</th><td>' + esc(a.scale_info || '-') + '</td></tr></table>' +
      (facts.length ? '<table class="naip-tb">' + facts.slice(0, 10).map(function (f) {
        return '<tr><th>' + esc(f.label) + '</th><td>' + esc(f.value) + '</td></tr>';
      }).join('') + '</table>' : '') + '</section>';

    if (!isTM) {
      html += '<section class="naip-sec"><h2>03. 임차 · 수익 구조</h2>' +
        '<table class="naip-tb"><tr><th>주요 임차인</th><td>' + esc(a.tenants || '확인 필요') + '</td></tr>' +
        '<tr><th>만기·일정</th><td>' + esc(a.maturity_schedule || '확인 필요') + '</td></tr>' +
        '<tr><th>가격</th><td>' + esc(a.price_info || '-') + '</td></tr></table>' +
        '<p class="naip-note">렌트롤·OPEX·CAPEX 기반 수익성은 웹앱 <b>📊 밸류에이션</b> 탭에서 산출합니다.</p></section>';
    }

    html += '<section class="naip-sec"><h2>' + (isTM ? '03' : '04') + '. 투자 포인트 · Next Step</h2><ul class="naip-li">' +
      '<li>' + esc(sectorLabel(a.sector)) + ' · ' + esc(a.region || '권역 미정') + ' — ' + esc(a.status || a.status_group || '상태 확인 중') + '</li>' +
      '<li>가격: ' + esc(a.price_info || '협의') + ' / 규모: ' + esc(a.scale_info || '확인 필요') + '</li>' +
      '<li>NAI Korea 담당자와 조건 협의 후 NDA → 상세 자료(IM·렌트롤) 제공</li>' +
      '</ul>' +
      '<p class="naip-note">본 문서는 웹앱 <b>Open AI Asset Bridge</b>에서 자동 생성된 ' + (isTM ? 'TM' : 'IM') + ' 브리프입니다. 제출용 최종본은 NAI Korea 양식(.pptx/PDF)으로 별도 제작됩니다.</p></section>';
    html += '<div class="naip-foot">NAI Korea · Open AI Asset Bridge · ' + esc(todayStr()) + ' · ' + (isTM ? 'TM' : 'IM') + ' Brief</div>';
    return html;
  }

  function openBrief(assetId, kind) {
    var a = assets().filter(function (x) { return x.id === assetId; })[0];
    if (!a) { toast('물건을 찾을 수 없습니다.', true); return; }
    var isTM = kind === 'TM';
    var body = '<div class="brief-bar"><span>' + (isTM ? '📄 TM' : '📘 IM') + (isTM ? ' 브리프 미리보기' : ' 매각안내문 프리뷰 · 16:9') + '</span>' +
      '<span class="bb-right">' +
      '<button type="button" class="btn btn-solid" data-home="brief-print">🖨 인쇄 / PDF 저장</button>' +
      (isTM ? '' : '<button type="button" class="btn btn-ghost" data-home="brief-pptx" data-id="' + esc(a.id) + '">📊 .pptx 제작 요청</button>' +
        '<button type="button" class="btn btn-ghost" data-home="brief-pdf" data-id="' + esc(a.id) + '">📄 .pdf 제작 요청</button>') +
      '<button type="button" class="btn btn-ghost" data-home="brief-request" data-id="' + esc(a.id) + '" data-kind="' + kind + '">제작 요청</button></span></div>' +
      '<div class="im-request-note">ℹ️ <b>제작 요청</b>은 접수 후 담당자가 확인해 <b>NAI 양식 .pptx/.pdf</b>로 제작해 전달합니다(통상 1~2영업일). ' +
      '아래 미리보기는 그 제작을 위한 <b>자동 초안</b>이며 최종 제출본이 아닙니다.</div>' +
      (isTM ? '' : realImBanner(a)) +
      (isTM ? '<div class="brief-sheet" id="briefSheet">' + briefHTML(a, kind) + '</div>'
        : '<div class="im-deck-wrap" id="briefSheet">' + imDeckHTML(a) + '</div>');
    openModal((isTM ? '📄 TM' : '📘 IM') + ' — ' + a.name, body, { wide: true, deck: !isTM });
  }

  /** 제작 요청 — 접수 사실과 이후 절차를 화면에 명확히 남깁니다 */
  function requestDoc2(assetId, kind, fmt) {
    var a = assets().filter(function (x) { return x.id === assetId; })[0];
    if (!a) { toast('물건을 찾을 수 없습니다.', true); return; }
    var fmtLabel = fmt || (kind === 'TM' ? 'TM' : 'IM');
    apiPost({
      action: 'request_doc', doc_type: kind === 'TM' ? 'TM' : 'IM', asset_id: a.id, asset_name: a.name,
      requester: (me() && me().name) || '', company: (me() && me().company) || '',
      note: fmtLabel + ' 제작 요청 — 자동 프리뷰 기준, NAI 양식 제작 후 전달'
    }).then(function (j) {
      if (j && j.ok) {
        var bar = $('.brief-bar');
        if (bar && !$('.bb-ok', bar)) {
          var el = document.createElement('span');
          el.className = 'bb-ok';
          el.textContent = '✅ 접수됨 · ' + (j.status || '요청접수');
          bar.appendChild(el);
        }
        var note = $('.im-request-note');
        if (note) {
          note.className = 'im-request-note ok';
          note.innerHTML = '✅ <b>제작 요청이 접수되었습니다</b> — 담당자가 확인 후 <b>NAI 양식 ' +
            (kind === 'TM' ? 'TM(티저)' : 'IM') + ' .pptx/.pdf</b>를 제작해 이메일·링크로 전달합니다(통상 1~2영업일).';
        }
        toast(fmtLabel + ' 제작 요청을 접수했습니다. NAI 양식으로 제작해 전달드립니다.');
        if (isAdmin()) renderSubs();
      } else toast('요청 접수에 실패했습니다: ' + ((j && j.error) || ''), true);
    }).catch(function () { toast('네트워크 오류로 요청하지 못했습니다.', true); });
  }

  /** 원문 IM 열람 요청 (원문은 비공개 — 링크·사본 전달 절차) */
  function requestImSource(assetId) {
    var a = assets().filter(function (x) { return x.id === assetId; })[0];
    if (!a) return;
    apiPost({
      action: 'request_doc', doc_type: 'IM', asset_id: a.id, asset_name: a.name,
      requester: (me() && me().name) || '', company: (me() && me().company) || '',
      note: '원문 IM 열람 요청 — 보유자료: ' + String(a.im_label || '')
    }).then(function (j) {
      if (j && j.ok) toast('원문 IM 열람 요청을 접수했습니다. 담당자가 확인 후 전달드립니다.');
      else toast('요청 접수에 실패했습니다.', true);
    }).catch(function () { toast('네트워크 오류', true); });
  }

  /* ─────────────────── 아티클/공지 읽기 ─────────────────── */
  function openArticle(idx, fromList) {
    var a = BOOT.articles[idx];
    if (!a) return;
    var body = (fromList ? '<div class="read-top"><button type="button" class="mini-btn" data-home="art-list">← 아티클 목록</button></div>' : '') +
      '<div class="read-meta">' + esc(a.date || '') + (a.source ? ' · ' + esc(noNai(a.source)) : '') + '</div>' +
      '<h2 class="read-title">' + esc(noNai(a.title || '')) + '</h2>' +
      (a.summary ? '<p class="read-sum">' + esc(noNai(a.summary)) + '</p>' : '') +
      '<div class="read-body">' + articleBody(noNai(a.body || '')) + '</div>' +
      (function () {
        var links = [];
        (a.tags || '').split(',').forEach(function (t) { if (t.trim()) links.push('<span class="rd-tag">#' + esc(t.trim()) + '</span>'); });
        return links.length ? '<div class="rd-tags">' + links.join('') + '</div>' : '';
      })() +
      (isAdmin() ? '<div class="read-tools"><button type="button" class="mini-btn" data-home="art-edit" data-id="' + esc(a.id || '') + '">✏️ 수정</button>' +
        '<button type="button" class="mini-btn danger" data-home="art-del" data-id="' + esc(a.id || '') + '">🗑 삭제</button></div>' : '');
    openModal('📰 ' + noNai(a.title || '아티클'), body, { wide: true });
  }
  function articleBody(text) {
    var t = String(text || '');
    if (!t.trim()) return '<p class="hs-empty">본문이 비어 있습니다.</p>';
    if (/^\s*</.test(t)) return t; /* HTML 본문이면 그대로 */
    return t.split(/\n{2,}/).map(function (p) {
      return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function openNotice(idx) {
    var n = BOOT.notices[idx];
    if (!n) return;
    var body = '<div class="read-meta">' + esc(n.date || '') + (n.category ? ' · ' + esc(n.category) : '') + '</div>' +
      '<h2 class="read-title">' + esc(n.title || '') + '</h2>' +
      '<div class="read-body">' + articleBody(n.body || '') + '</div>' +
      (isAdmin() ? '<div class="read-tools"><button type="button" class="mini-btn" data-home="noti-edit" data-id="' + esc(n.id || '') + '">✏️ 수정</button>' +
        '<button type="button" class="mini-btn danger" data-home="noti-del" data-id="' + esc(n.id || '') + '">🗑 삭제</button></div>' : '');
    openModal('📢 ' + (n.title || '공지'), body, { wide: true });
  }

  function openArticleEditor(item) {
    var t = item || {};
    var body = '<div class="fm-grid">' +
      formRow('제목 *', 'edTitle', { wide: true, value: t.title || '' }) +
      formRow('날짜', 'edDate', { value: t.date || todayStr() }) +
      formRow('상태', 'edStatus', { type: 'select', options: '<option value="공개">공개</option><option value="비공개">비공개</option>' }) +
      formRow('요약', 'edSummary', { wide: true, type: 'textarea', value: t.summary || '' }) +
      formRow('본문', 'edBody', { wide: true, type: 'textarea', value: t.body || '' }) +
      formRow('태그', 'edTags', { wide: true, value: t.tags || '', ph: '쉼표로 구분 (오피스,물류)' }) +
      formRow('출처', 'edSource', { wide: true, value: t.source || '', ph: '예) 매일경제 2026-11-22' }) +
      '</div>' +
      '<div class="fm-actions"><button type="button" class="btn btn-solid" data-home="art-save" data-id="' + esc(t.id || '') + '">저장</button></div>' +
      '<div class="fm-err hidden" id="edErr"></div>';
    openModal(t.id ? '✏️ 아티클 수정' : '＋ 아티클 등록', body, { wide: true });
    var sel = $('#edStatus');
    if (sel) sel.value = (t.status || '공개');
  }
  function saveArticle(id) {
    var title = val('edTitle');
    if (!title) { formErr('edErr', '제목을 입력하세요.'); return; }
    apiPost({
      action: 'article_save',
      item: {
        id: id || undefined, title: title, date: val('edDate'), status: val('edStatus'),
        summary: val('edSummary'), body: val('edBody'), tags: val('edTags'), source: val('edSource')
      }
    }).then(function (j) {
      if (!j || !j.ok) { formErr('edErr', '저장 실패: ' + ((j && j.error) || '')); return; }
      closeModal();
      toast('아티클을 저장했습니다.');
      loadContent(true);
    }).catch(function () { formErr('edErr', '네트워크 오류'); });
  }
  function openNoticeEditor(item) {
    var t = item || {};
    var body = '<div class="fm-grid">' +
      formRow('제목 *', 'ntTitle', { wide: true, value: t.title || '' }) +
      formRow('날짜', 'ntDate', { value: t.date || todayStr() }) +
      formRow('분류', 'ntCat', { value: t.category || '', ph: '예) 오픈 안내 / 업데이트' }) +
      formRow('상단 고정', 'ntPin', { type: 'select', options: '<option value="N">아니오</option><option value="Y">예 (상단 고정)</option>' }) +
      formRow('본문', 'ntBody', { wide: true, type: 'textarea', value: t.body || '' }) +
      '</div>' +
      '<div class="fm-actions"><button type="button" class="btn btn-solid" data-home="noti-save" data-id="' + esc(t.id || '') + '">저장</button></div>' +
      '<div class="fm-err hidden" id="ntErr"></div>';
    openModal(t.id ? '✏️ 공지 수정' : '＋ 공지 등록', body, { wide: true });
    var p = $('#ntPin'); if (p) p.value = (String(t.pinned || 'N').toUpperCase() === 'Y' ? 'Y' : 'N');
  }
  function saveNotice(id) {
    var title = val('ntTitle');
    if (!title) { formErr('ntErr', '제목을 입력하세요.'); return; }
    apiPost({
      action: 'notice_save',
      item: { id: id || undefined, title: title, date: val('ntDate'), category: val('ntCat'), pinned: val('ntPin'), body: val('ntBody') }
    }).then(function (j) {
      if (!j || !j.ok) { formErr('ntErr', '저장 실패: ' + ((j && j.error) || '')); return; }
      closeModal();
      toast('공지를 저장했습니다.');
      loadContent(true);
    }).catch(function () { formErr('ntErr', '네트워크 오류'); });
  }
  function deleteContent(kind, id) {
    if (!id) return;
    if (!window.confirm((kind === 'article' ? '아티클' : '공지') + '을(를) 삭제할까요?')) return;
    apiPost({ action: kind === 'article' ? 'article_delete' : 'notice_delete', id: id }).then(function (j) {
      if (j && j.ok) { closeModal(); toast('삭제했습니다.'); loadContent(true); }
      else toast('삭제 실패', true);
    }).catch(function () { toast('삭제 실패(네트워크)', true); });
  }

  /* ─────────────────── 접수 내역 (관리자) ─────────────────── */
  function openSubs(kind) {
    var LABEL = { lois: '📝 인수·임차의향서', loans: '💰 대출요청·조건제시', doc_requests: '📄 TM·IM 제작요청', proposals: '➕ 물건 등록제안' };
    var COLS = {
      lois: [['timestamp', '일시'], ['asset_name', '물건'], ['deal_type', '구분'], ['price', '가격'], ['area_py', '면적'], ['rent', '임대료'], ['timeline', '시기'], ['company', '회사'], ['name', '성명'], ['phone', '연락처'], ['role', '권한'], ['status', '상태']],
      loans: [['timestamp', '일시'], ['asset_name', '물건'], ['kind', '구분'], ['amount', '금액'], ['ltv', 'LTV'], ['rate', '금리'], ['maturity', '만기'], ['tranche', '트랑슈'], ['company', '회사'], ['name', '성명'], ['phone', '연락처'], ['role', '권한'], ['status', '상태']],
      doc_requests: [['timestamp', '일시'], ['asset_name', '물건'], ['doc_type', '양식'], ['requester', '요청자'], ['company', '회사'], ['role', '권한'], ['status', '상태']],
      proposals: [['timestamp', '일시'], ['mode', '방식'], ['name', '물건'], ['sector', '섹터'], ['address', '주소'], ['price_info', '가격'], ['scale_info', '규모'], ['contact_name', '제안자'], ['contact_company', '회사'], ['role', '권한'], ['status', '상태']]
    };
    var cols = COLS[kind];
    apiGet(kind).then(function (j) {
      if (!j || !j.ok) { toast('조회 실패: ' + ((j && j.error) || ''), true); return; }
      BOOT.subs[kind] = j.count;
      var el = $('[data-sub-count="' + kind + '"]'); if (el) el.textContent = String(j.count);
      var html = '';
      if (!j.items.length) html = '<p class="hs-empty">접수된 내역이 없습니다.</p>';
      else {
        html += '<div class="subs-table-wrap"><table class="subs-table"><thead><tr>' +
          cols.map(function (c) { return '<th>' + esc(c[1]) + '</th>'; }).join('') +
          (kind === 'proposals' ? '<th>처리</th>' : '') + '</tr></thead><tbody>';
        j.items.forEach(function (it) {
          html += '<tr>' + cols.map(function (c) {
            var v = it[c[0]] || '';
            if (c[0] === 'timestamp') v = String(v).replace('T', ' ').slice(0, 16);
            return '<td>' + esc(v) + '</td>';
          }).join('') +
            (kind === 'proposals' ? '<td>' + (it.status === '제안접수' ?
              '<button type="button" class="mini-btn" data-home="prop-approve" data-id="' + esc(it.id) + '">승인 → assets</button> ' +
              '<button type="button" class="mini-btn danger" data-home="prop-reject" data-id="' + esc(it.id) + '">반려</button>' : esc(it.status)) + '</td>' : '') +
            '</tr>';
        });
        html += '</tbody></table></div>';
      }
      openModal(LABEL[kind] + ' 접수 내역 (' + j.count + '건)', html, { wide: true });
    }).catch(function () { toast('조회 실패(네트워크)', true); });
  }
  function proposalAction(id, reject) {
    if (!id) return;
    apiPost({ action: 'proposal_approve', id: id, reject: !!reject }).then(function (j) {
      if (!j || !j.ok) { toast('처리 실패: ' + ((j && j.error) || ''), true); return; }
      toast(reject ? '제안을 반려했습니다.' : '승인하여 assets에 반영했습니다.');
      closeModal();
      renderSubs();
      if (!reject && window.naiMap && window.naiMap.sync && window.naiMap.sync.connect) {
        window.naiMap.sync.connect(getToken()).then(function () { renderShell(); }).catch(function () { /* noop */ });
      }
    }).catch(function () { toast('처리 실패(네트워크)', true); });
  }

  /* ─────────────────── 검색 ─────────────────── */
  function doSearch() {
    var host = $('#hsResult');
    if (!host) return;
    var q = val('hsQ').toLowerCase();
    var sector = val('hsSector');
    var deal = val('hsDeal');
    var region = val('hsRegion');
    var price = val('hsPrice');
    var list = assets().filter(function (a) {
      if (sector !== 'ALL' && a.sector !== sector) return false;
      if (deal === 'auction' && !isAuction(a)) return false;
      if (deal === 'general' && isAuction(a)) return false;
      if (deal === 'sale' && tradeStateOf(a) !== 'sale') return false;
      if (deal === 'lease' && tradeStateOf(a) !== 'lease') return false;
      if (region !== 'ALL' && a.region !== region) return false;
      if (price !== 'ALL') {
        var v = parseEok(a.price_info);
        if (price === 'none') { if (v !== null) return false; }
        else {
          var m = price.split('-');
          var lo = Number(m[0]) || 0;
          var hi = m[1] === '' ? Infinity : (Number(m[1]) || Infinity);
          if (v === null || v < lo || v >= hi) return false;
        }
      }
      if (q) {
        var hay = [a.name, a.address, a.owner_amc, a.tenants, a.notes, a.price_info, a.scale_info, a.sub_type, a.status]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var total = list.length;
    list = list.slice(0, 40);
    if (!total) { host.innerHTML = '<p class="hs-empty">조건에 맞는 물건이 없습니다.</p>'; return; }
    host.innerHTML = '<div class="hs-count">' + total.toLocaleString('ko-KR') + '건' + (total > list.length ? ' 중 상위 ' + list.length + '건' : '') + '</div>' +
      '<div class="hs-list">' + list.map(function (a) {
        var b = isAuction(a) ? ddayBadge(a) : null;
        return '<button type="button" class="hs-item" data-home="open-asset" data-id="' + esc(a.id) + '">' +
          '<span class="hsi-sector" style="background:' + sectorColor(a.sector) + '"></span>' +
          '<span class="hsi-main"><strong>' + esc(a.name) + '</strong>' +
          '<span class="hsi-sub">' + esc([sectorLabel(a.sector), a.region, a.address].filter(Boolean).join(' · ')) + '</span></span>' +
          '<span class="hsi-right">' + esc(eokText(a) || a.price_info || '') +
          (b ? ' <span class="dc-badge ' + b.cls + ' mini">' + esc(b.label) + '</span>' : '') + '</span></button>';
      }).join('') + '</div>';
  }

  /* ─────────────────── 이벤트 ─────────────────── */
  function bind() {
    var host = document;   /* 모달은 body 에 붙으므로 문서 단위로 위임합니다 */
    if (!$('#homeView')) return;
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-home]');
      if (!btn) return;
      var act = btn.getAttribute('data-home');
      if (act === 'open-asset') {
        var id = btn.getAttribute('data-id');
        if (window.naiShowView) window.naiShowView('map');
        setTimeout(function () { if (window.naiMap) window.naiMap.select(id); }, 60);
        return;
      }
      if (act === 'do-search') { doSearch(); return; }
      if (act === 'kpi') { openKpiList(btn.getAttribute('data-kpi')); return; }
      if (act === 'kpi-sector') { KPL.sector = btn.getAttribute('data-sector') || 'ALL'; renderKpiList(); return; }
      if (act === 'kpi-xlsx') { downloadKpiList(); return; }
      if (act === 'home-sector') {
        BOOT.homeSector = btn.getAttribute('data-sector') || 'office';
        renderDealStrip();
        return;
      }
      if (act === 'kpi-map') {
        var dk = btn.getAttribute('data-kpi-deal') || '';
        closeModal();
        if (window.naiShowView) window.naiShowView('map');
        setTimeout(function () { if (window.naiMap && window.naiMap.setDealType) window.naiMap.setDealType(dk); }, 120);
        return;
      }
      if (act === 'more-auction' || act === 'more-sale' || act === 'more-lease') {
        var target = act === 'more-auction' ? 'auction' : (act === 'more-lease' ? 'lease' : 'general');
        if (window.naiShowView) window.naiShowView('map');
        setTimeout(function () {
          if (window.naiMap && window.naiMap.setDealType) {
            window.naiMap.setDealType(target === 'general' ? 'sale' : (target === 'lease' ? 'lease' : 'auc'));
            return;
          }
          var f = $('#dealTypeFilters');
          if (f) { var b = f.querySelector('[data-deal="' + target + '"]'); if (b) b.click(); }
        }, 120);
        return;
      }
      if (act === 'search') { var s = $('#hcSearch'); if (s) { s.scrollIntoView({ behavior: 'smooth', block: 'center' }); var q = $('#hsQ'); if (q) q.focus(); } return; }
      if (act === 'register') { openRegister('직접'); return; }
      if (act === 'advise') { closeModal(); if (window.naiShowView) window.naiShowView('advise'); return; }
      if (act === 'apply') { openHub(btn.getAttribute('data-type') || 'tr'); return; }
      if (act === 'match') { if (window.naiShowView) window.naiShowView('match'); return; }
      if (act === 'tr') { openHub('tr'); return; }
      if (act === 'loi') { openLOI(''); return; }
      if (act === 'vdr') { closeModal(); if (window.naiShowView) window.naiShowView('vdr'); return; }
      if (act === 'loan') { openLoan(''); return; }
      if (act === 'tm' || act === 'im') {
        openDocPick(act.toUpperCase());
        return;
      }
      if (act === 'reg-submit') { submitRegister(); return; }
      if (act === 'loi-submit') { submitLOI(); return; }
      if (act === 'loan-submit') { submitLoan(); return; }
      if (act === 'brief-print') { printBrief(); return; }
      if (act === 'brief-pptx') { requestDoc2(btn.getAttribute('data-id'), 'IM', 'IM .pptx'); return; }
      if (act === 'brief-pdf') { requestDoc2(btn.getAttribute('data-id'), 'IM', 'IM .pdf'); return; }
      if (act === 'brief-request') { requestDoc2(btn.getAttribute('data-id'), btn.getAttribute('data-kind'), btn.getAttribute('data-kind') === 'TM' ? 'TM' : 'IM'); return; }
      if (act === 'im-source') { requestImSource(btn.getAttribute('data-id')); return; }
      if (act === 'report') { if (window.NAI_REPORT) window.NAI_REPORT.open(); return; }
      if (act === 'hub') { openHub('sale'); return; }
      if (act === 'hub-tr') { openHub('tr'); return; }
      if (act === 'hub-list') { if (window.NAI_HUB) { closeModal(); window.NAI_HUB.openList(); } return; }
      if (act === 'open-article') { openArticle(Number(btn.getAttribute('data-idx'))); return; }
      if (act === 'art-open-list') { openArticle(Number(btn.getAttribute('data-idx')), true); return; }
      if (act === 'art-list') { openArticleList(); return; }
      if (act === 'art-all') { openArticleList(); return; }
      if (act === 'art-more') {
        BOOT.artShown = artShownCount() + ART_STEP;
        renderArticles(true);
        return;
      }
      if (act === 'open-notice') { openNotice(Number(btn.getAttribute('data-idx'))); return; }
      if (act === 'art-new') { openArticleEditor(null); return; }
      if (act === 'art-edit') { openArticleEditor(BOOT.articles.filter(function (x) { return x.id === btn.getAttribute('data-id'); })[0]); return; }
      if (act === 'art-del') { deleteContent('article', btn.getAttribute('data-id')); return; }
      if (act === 'art-save') { saveArticle(btn.getAttribute('data-id') || ''); return; }
      if (act === 'noti-new') { openNoticeEditor(null); return; }
      if (act === 'noti-edit') { openNoticeEditor(BOOT.notices.filter(function (x) { return x.id === btn.getAttribute('data-id'); })[0]); return; }
      if (act === 'noti-del') { deleteContent('notice', btn.getAttribute('data-id')); return; }
      if (act === 'noti-save') { saveNotice(btn.getAttribute('data-id') || ''); return; }
      if (act === 'subs') { openSubs(btn.getAttribute('data-kind')); return; }
      if (act === 'prop-approve') { proposalAction(btn.getAttribute('data-id'), false); return; }
      if (act === 'prop-reject') { proposalAction(btn.getAttribute('data-id'), true); return; }
    });
    /* Enter 로 검색 — 한글 조합 중 Enter 는 글자 확정용이라 건너뜁니다 (2026-11-27) */
    host.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      if (e.target && e.target.id === 'hsQ') { e.preventDefault(); doSearch(); }
    });
  }

  function openHub(code) {
    closeModal();
    if (window.NAI_HUB) window.NAI_HUB.open(code || 'sale');
    else if (window.NAI_TR) window.NAI_TR.open();
  }

  function openDocPick(kind) {
    var body = '<p class="fm-note">' + (kind === 'TM' ? '📄 TM(티저)' : '📘 IM(투자설명)') + ' 브리프를 만들 물건을 선택하세요. 미리보기가 열리면 동시에 제작 요청이 기록됩니다.</p>' +
      '<div class="fm-grid">' + assetPickerHTML('dp', '') + '</div>' +
      '<div class="fm-actions"><button type="button" class="btn btn-solid" data-home="doc-pick-go" data-kind="' + kind + '">브리프 미리보기</button>' +
      '<span class="fm-hint">최종 제출용 .pptx는 NAI Korea 양식으로 별도 제작됩니다.</span></div>';
    openModal((kind === 'TM' ? '📄 TM' : '📘 IM') + ' 제작 — 물건 선택', body);
    var m = $('.home-modal');
    if (m) {
      m.addEventListener('click', function (e) {
        var b = e.target.closest('[data-home="doc-pick-go"]');
        if (!b) return;
        var pick = resolveAsset(val('dpAsset'));
        if (!pick.id) { toast('목록에서 물건을 선택하세요. (직접 입력은 지원되지 않습니다)', true); return; }
        closeModal();
        openBrief(pick.id, b.getAttribute('data-kind'));
      });
    }
  }

  function requestDoc(id, kind) {
    var a = assets().filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    apiPost({
      action: 'request_doc', doc_type: kind, asset_id: a.id, asset_name: a.name,
      requester: (me() && me().name) || '', company: (me() && me().company) || '', note: '버튼으로 재요청'
    }).then(function (j) {
      if (j && j.ok) toast(kind + ' 제작 요청을 접수했습니다.');
      else toast('요청 실패: ' + ((j && j.error) || ''), true);
    }).catch(function () { toast('요청 실패(네트워크)', true); });
  }

  function printBrief() {
    var sheet = $('#briefSheet');
    if (!sheet) return;
    document.body.classList.add('printing-brief');
    window.print();
    setTimeout(function () { document.body.classList.remove('printing-brief'); }, 800);
  }

  /* ─────────────────── 상세 패널 TM/IM 버튼 처리 ─────────────────── */
  function bindDetail() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act="tm"],[data-act="im"]');
      if (!b) return;
      var st = window.naiMap && window.naiMap.state;
      if (!st || !st.selectedId) return;
      openBrief(st.selectedId, b.getAttribute('data-act') === 'tm' ? 'TM' : 'IM');
    });
  }

  /* ─────────────────── 공개 인터페이스 ─────────────────── */
  function show() {
    var host = $('#homeView');
    if (!host) return;
    if (!host.dataset.ready) { renderShell(); host.dataset.ready = '1'; }
    else if (host.dataset.count !== String(assets().length)) { renderShell(); }
    else { renderDealStrip(); }
    loadContent(false);
  }
  function autoOpen() {
    if (BOOT.homeOpened) return;
    BOOT.homeOpened = true;
    if (window.naiShowView) window.naiShowView('home');
    show();
  }
  function refresh() {
    var host = $('#homeView');
    if (host) { host.dataset.ready = ''; renderShell(); }
  }

  window.NAI_HOME = { show: show, autoOpen: autoOpen, refresh: refresh, brief: openBrief, openLOI: openLOI, openLoan: openLoan, openRegister: openRegister };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { bind(); bindDetail(); });
  } else { bind(); bindDetail(); }
})();
