/* =========================================================================
   Open AI Asset Bridge — 🤝 SI·화주 풀 / 🏦 FI 풀 (investors 시트)
   - 하나의 비공개 시트(investors) + Apps Script type=investors GET/POST
   - 5개 분류: 오피스 SI / 물류 화주 | 블라인드펀드 / 리츠·해외투자사 / 연기금·LP
   - 상단 탭에서 🤝 SI·화주 풀(kind: office_si, shipper)과
     🏦 FI 풀(kind: blind_fund, reit_foreign, pension_lp)을 분리 표시
   - 탭별 분류 필터·권역 필터·전략 필터(FI)·검색·다중 선택·티저 메일 발송 바
   - FI 카드/상세: 펀드명·LP·전략·규모·드라이파우더·목표 IRR·지역 가이드·만기
     (case_info / notes 의 "[펀드명] LP:… | 전략:… | … " 규격을 파싱)
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var PREF_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':pool:pref:v3';
  var CACHE_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':pool:cache:v3';

  /* 5개 분류 — kind 값은 시트의 실제 값(office_si, shipper, blind_fund, reit_foreign, pension_lp) */
  var KINDS = [
    { k: 'all', label: '전체', icon: '📋', badge: '전체' },
    { k: 'office', label: '오피스 SI', icon: '🏢', badge: '🏢 오피스 SI', cls: 'k-office' },
    { k: 'shipper', label: '물류 화주', icon: '🚚', badge: '🚚 물류 화주', cls: 'k-ship' },
    { k: 'blind_fund', label: '블라인드펀드', icon: '💰', badge: '💰 블라인드펀드', cls: 'k-bf' },
    { k: 'reit_foreign', label: '리츠·해외투자사', icon: '🌐', badge: '🌐 리츠·해외투자사', cls: 'k-rf' },
    { k: 'pension_lp', label: '연기금·LP', icon: '🏛', badge: '🏛 연기금·LP', cls: 'k-lp' }
  ];
  var KIND_MAP = {};
  KINDS.forEach(function (x) { KIND_MAP[x.k] = x; });

  /* 두 개의 탭 = 같은 investors 시트를 쓰되 분류(kind) 범위를 나눕니다. */
  var MODES = {
    si: {
      key: 'si',
      title: '🏢 SI (사옥·전략투자)',
      kinds: ['office'],
      desc: '오피스 사옥·전략적 투자(SI) 기업 — 티저 메일 발송 연계',
      searchPlaceholder: '회사 · 업종 · 사례 · 담당자 · 이메일 검색',
      composeTitle: '📧 티저 메일 발송',
      limit: 400
    },
    ship: {
      key: 'ship',
      title: '🚚 물류센터 화주',
      kinds: ['shipper'],
      desc: '물류센터 화주(사용·임차 수요) — 부족권역·확장 계획·담당자',
      searchPlaceholder: '화주사 · 업종 · 사용센터 · 부족권역 · 담당자 검색',
      composeTitle: '📧 물류센터 제안 메일 발송',
      limit: 500
    },
    fi: {
      key: 'fi',
      title: '🏦 FI 풀',
      kinds: ['blind_fund', 'reit_foreign', 'pension_lp'],
      desc: '블라인드펀드 운용사 · 리츠·해외투자사 · 연기금·LP — 펀드 전략·목표 IRR·드라이파우더·만기',
      searchPlaceholder: '운용사 · 펀드명 · 전략 · LP · 담당자 · 이메일 검색',
      composeTitle: '📧 딜 소개 메일 발송',
      limit: 700
    }
  };

  /* FI 전략(펀드 종류) 필터 — case_info 의 전략: 값과 industry 의 블라인드(...) 를 모아 분류 */
  var STRATS = ['Loan', 'Core', 'Core+', 'Value-add', 'Opportunistic', '개발', '미확인'];
  var STRAT_CLS = {
    'Loan': 'loan', 'Core': 'core', 'Core+': 'corep', 'Value-add': 'va',
    'Opportunistic': 'opp', '개발': 'dev', '미확인': 'na'
  };

  /* 권역 표시 순서 (데이터에 있는 것만 노출, 목록에 없는 값도 자동 추가) */
  var REGION_ORDER = [
    'CBD', 'GBD', 'YBD', '강남·서초·수서', '판교·분당', '서부·마곡·구로',
    '수도권 동남', '수도권 남부', '수도권 서부', '수도권 동부', '충청', '지방·전국', '전국·미확인',
    '서울 오피스', '수도권 물류·DC', '전국'
  ];
  var REGION_NOTE = {
    'CBD': '도심(종로·중구·을지로·명동·서울역)',
    'GBD': '강남(역삼·삼성·논현·신사)',
    'YBD': '여의도·영등포',
    '강남·서초·수서': '서초·수서·문정·송파',
    '판교·분당': '판교·분당·성남',
    '서부·마곡·구로': '마곡·마포·DMC·구로',
    '수도권 동남': '용인·이천·여주',
    '수도권 남부': '오산·평택·화성·안성',
    '수도권 서부': '인천·김포·부천·시흥',
    '수도권 동부': '광주·남양주·하남',
    '충청': '진천·음성·천안',
    '지방·전국': '부산·대구·광주·강원 등',
    '전국·미확인': '권역 미확인(전국 단위 3PL 등)',
    '서울 오피스': '서울 권역 오피스(코어 중심)',
    '수도권 물류·DC': '수도권 물류센터·데이터센터',
    '전국': '지역 제한 없음(전국·대출형 포함)'
  };

  var state = {
    rows: [],
    loaded: false,
    role: '',
    mode: 'si',
    kind: 'all',
    region: 'ALL',
    strat: 'ALL',
    q: '',
    onlyEmail: false,
    fundOnly: false,
    finOnly: false,
    owner: 'ALL',
    siWatch: null,      /* 관리자 전용 — 주요 SI 사옥·펀드 만기 (company 키) */
    siEvent: 'ALL',     /* ALL | EVENT | 2026~2032 */

    sel: {},
    busy: false
  };
  var modeStore = {};   /* si / fi 각각의 필터·선택 상태 */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function toast(msg, isErr) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 2800);
  }

  /* ─────────────── 모드(탭) 상태 ─────────────── */
  function modeDef(m) { return MODES[m] || MODES.si; }
  function modeKinds() { return modeDef(state.mode).kinds; }
  function inMode(r) { return modeKinds().indexOf(r.kind) >= 0; }
  function isFiKind(k) { return MODES.fi.kinds.indexOf(k) >= 0; }
  function isShipMode() { return state.mode === 'ship'; }

  function snapshotMode() {
    modeStore[state.mode] = {
      kind: state.kind, region: state.region, strat: state.strat,
      onlyEmail: state.onlyEmail, fundOnly: state.fundOnly, finOnly: state.finOnly, sel: state.sel
    };
  }
  function setMode(mode) {
    if (!MODES[mode]) mode = 'si';
    if (state.mode !== mode) snapshotMode();
    state.mode = mode;
    var m = modeStore[mode] || {};
    state.kind = m.kind || 'all';
    state.region = m.region || 'ALL';
    state.strat = m.strat || 'ALL';
    state.onlyEmail = !!m.onlyEmail;
    state.fundOnly = !!m.fundOnly;
    state.finOnly = !!m.finOnly;
    state.sel = m.sel || {};
    if (modeKinds().indexOf(state.kind) < 0) state.kind = 'all';
    syncModeDom();
  }

  /** 탭에 따라 제목·안내문·검색 placeholder·전용 필터 표시를 바꿉니다. */
  function syncModeDom() {
    var def = modeDef(state.mode);
    var fi = state.mode === 'fi';
    var t = $('#poolTitle');
    if (t) t.textContent = def.title;
    var s = $('#poolView');
    if (s) s.setAttribute('aria-label', def.title.replace(/^[^\s]+\s/, ''));
    var q = $('#poolSearch');
    if (q) {
      q.placeholder = def.searchPlaceholder;
      if (q.value !== state.q) q.value = state.q;
    }
    var oe = $('#poolOnlyEmail');
    if (oe) oe.checked = state.onlyEmail;
    var fo = $('#poolFundOnly');
    if (fo) fo.checked = state.fundOnly;
    var fno = $('#poolFinOnly');
    if (fno) fno.checked = state.finOnly;
    var fow = $('#poolFundOnlyWrap');
    if (fow) fow.classList.toggle('hidden', !fi);
    var sc = $('#poolStratChips');
    if (sc) sc.classList.toggle('hidden', !fi);
    var ct = $('#composeTitle');
    if (ct) ct.textContent = def.composeTitle;
    var sub = $('#poolSubtitle');
    if (sub) sub.textContent = def.desc;
    syncAddLabel();
  }

  /** 탭별 '＋ 컨택포인트 추가' 버튼 문구 */
  function syncAddLabel() {
    var add = $('#poolAddBtn');
    if (!add) return;
    add.textContent = state.mode === 'ship' ? '＋ 화주 컨택포인트 추가'
      : state.mode === 'fi' ? '＋ FI 대상 추가'
        : '＋ SI 컨택포인트 추가';
    add.title = '담당자(컨택포인트)를 새로 등록합니다';
  }

  /* ─────────────── 환경설정 저장 ─────────────── */
  function savePref() {
    try {
      snapshotMode();
      var o = { mode: state.mode, states: {} };
      Object.keys(modeStore).forEach(function (k) {
        var m = modeStore[k];
        if (!m) return;
        o.states[k] = { kind: m.kind, region: m.region, strat: m.strat, onlyEmail: m.onlyEmail, fundOnly: m.fundOnly, finOnly: m.finOnly };
      });
      localStorage.setItem(PREF_KEY, JSON.stringify(o));
    } catch (e) { /* noop */ }
  }
  function loadPref() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      if (!p || !p.states) return;
      Object.keys(p.states).forEach(function (k) {
        var s = p.states[k] || {};
        modeStore[k] = {
          kind: s.kind || 'all', region: s.region || 'ALL', strat: s.strat || 'ALL',
          onlyEmail: !!s.onlyEmail, fundOnly: !!s.fundOnly, finOnly: !!s.finOnly, sel: {}
        };
      });
    } catch (e) { /* noop */ }
  }

  /** 시트의 kind 값을 분류 키로 정규화 */
  function normKind(k) {
    var s = String(k || '').trim();
    if (s === 'office' || s === 'office_si') return 'office';
    if (s === 'shipper' || s === 'blind_fund' || s === 'reit_foreign' || s === 'pension_lp') return s;
    return 'office';
  }

  function api(params, body) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('SYNC_URL 없음'));
    if (!body) {
      var qs = 'type=investors&token=' + encodeURIComponent(getToken());
      if (params) qs += '&' + params;
      return fetch(base + (base.indexOf('?') < 0 ? '?' : '&') + qs, { cache: 'no-store' })
        .then(function (r) { return r.json(); });
    }
    var payload = Object.assign({ type: 'investors', token: getToken() }, body);
    return fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  /* 컨택포인트 편집: 관리자·내부(CM) 허용, 물류TF는 화주(shipper)만, 외부는 불가 */
  function canEdit() { return state.role === 'admin' || state.role === 'internal' || state.role === 'logi'; }
  function canEditRow(r) {
    if (state.role === 'admin' || state.role === 'internal') return true;
    if (state.role === 'logi') return !r || r.kind === 'shipper';
    return false;
  }
  function canDelete() { return state.role === 'admin'; }
  function isExternal() { return state.role === 'external'; }
  function roleName_() {
    return state.role === 'admin' ? '관리자'
      : state.role === 'logi' ? '물류TF'
        : state.role === 'internal' ? 'CM팀 내부' : '외부 방문자';
  }
  /** 서버가 '권한 없음'류로 거부한 응답인지 — 이 경우 요청 모양을 바꿔도 결과가 같습니다. */
  function isDenied_(e) { return /unauth|forbid|denied|permission|not\s*allowed|권한|거부/i.test(String(e || '')); }

  /** 컨택포인트 저장 — 앱이 기대하는 규격(POST action:'investor_save', type:'investors')으로 보냅니다.
   *  서버가 이 액션을 모르는 경우 다른 모양으로 추측해 보내지 않습니다 — 알 수 없는 upsert 가
   *  다른 시트에 잘못 쓸 수 있기 때문입니다. 실패는 그대로 화면에 알리고 관리자에게 전달하게 합니다. */
  function saveInvestor_(out) {
    return api(null, { action: 'investor_save', investor: out }).catch(function (e) {
      return { ok: false, error: (e && e.message) || 'network' };
    });
  }
  function isLogi_() { return state.role === 'logi' || ((window.naiMap && window.naiMap.role) ? window.naiMap.role() === 'logi' : false); }
  function normRole_(r) {
    var s = String(r || '');
    if (s === 'admin') return 'admin';
    if (s === 'logi') return 'logi';
    if (s === 'internal' || s === 'readonly') return 'internal';
    return 'external';
  }

  /* ─────────────── FI 펀드 메타데이터 파싱 ───────────────
     시트 필드는 v3 기준 19개로 고정되어 있고, 펀드 정보는
       case_info : "[펀드명] LP:… | 전략:… | 규모:… | 드라이파우더:… | 목표IRR:… | 지역:… | 만기:… || [다른 펀드] …"
       notes     : "드라이파우더 합계 6,000억 · 목표IRR: 6.1% (각 보수 차감) · 지역가이드: … · 명함첩 20건"
     형태로 들어 있습니다. 아래는 그 규격을 그대로 읽습니다(없으면 빈 값). */
  function grab(text, key) {
    var m = String(text || '').match(new RegExp(key + '\\s*:\\s*([^|]*)'));
    return m ? m[1].trim() : '';
  }
  function cleanSep(s) {
    return String(s || '').split('/').map(function (x) { return x.trim(); }).filter(Boolean).join(' · ');
  }
  function parseFunds(r) {
    var out = [];
    String(r.case_info || '').split('||').forEach(function (b) {
      b = b.trim();
      if (!b) return;
      var f = {
        name: (b.match(/^\[([^\]]+)\]/) || [null, ''])[1],
        lp: grab(b, 'LP'),
        gp: grab(b, 'GP'),
        strat: grab(b, '전략'),
        size: grab(b, '규모') || grab(b, '약정'),
        dry: grab(b, '드라이파우더'),
        remain: grab(b, '잔여'),
        irr: grab(b, '목표IRR'),
        target: cleanSep(grab(b, '대상')),
        region: cleanSep(grab(b, '지역')),
        term: grab(b, '만기').replace(/\s+/g, ' ').trim(),
        raw: b
      };
      if (f.name || f.lp || f.strat || f.size || f.dry || f.irr || f.term || f.remain) out.push(f);
    });
    return out;
  }
  function parseNote(r) {
    var n = String(r.notes || '');
    return {
      dryTotal: (n.match(/드라이파우더\s*합계\s*([0-9,]+\s*억)/) || [null, ''])[1],
      irr: ((n.match(/목표IRR\s*:\s*([^·|]+)/) || [null, ''])[1] || '').trim(),
      region: cleanSep((n.match(/지역가이드\s*:\s*([^·|]+)/) || [null, ''])[1] || ''),
      raw: n
    };
  }
  function stratTags(r, funds) {
    var raw = [];
    var m = String(r.industry || '').match(/블라인드\s*\(([^)]*)\)/);
    if (m) raw = raw.concat(m[1].split(/[,/]/));
    funds.forEach(function (f) { if (f.strat) raw = raw.concat(f.strat.split(/[,/]/)); });
    /* LP 쪽 원문은 '[국내 부동산 대출형 펀드] GP:… | Loan | 잔여:…' 처럼
       전략 이름이 '전략:' 없이 토큰으로만 들어가 있어 함께 읽습니다. */
    String(r.case_info || '').split(/[|]/).forEach(function (tok) {
      var t = tok.trim();
      if (t && t.length <= 24 && /^(loan|core\+?|core\/core\+|core\+|value-?add|opportunistic|대출|개발)$/i.test(t)) raw.push(t);
    });
    var set = {};
    raw.forEach(function (t0) {
      var t = String(t0 || '').toLowerCase();
      if (!t.trim()) return;
      if (/loan|대출/.test(t)) set.Loan = 1;
      if (/opportun/.test(t)) set.Opportunistic = 1;
      if (/value/.test(t)) set['Value-add'] = 1;
      if (/core\s*\+/.test(t)) set['Core+'] = 1; else if (/core/.test(t)) set.Core = 1;
      if (/개발/.test(t)) set['개발'] = 1;
    });
    var out = STRATS.filter(function (s) { return set[s]; });
    if (!out.length) out.push('미확인');
    return out;
  }
  /** FI 행의 파싱 결과를 한 번만 계산해 붙여 둡니다. */
  function fiData(r) {
    if (r._fi) return r._fi;
    var funds = parseFunds(r);
    var d = { funds: funds, note: parseNote(r), tags: stratTags(r, funds) };
    try { r._fi = d; } catch (e) { /* noop */ }
    return d;
  }
  function uniqJoin(list, max) {
    var out = [], seen = {};
    list.forEach(function (v) {
      v = String(v || '').trim();
      if (!v || seen[v.toLowerCase()]) return;
      seen[v.toLowerCase()] = 1;
      out.push(v);
    });
    if (max && out.length > max) return out.slice(0, max).join(' · ') + ' 외 ' + (out.length - max);
    return out.join(' · ');
  }
  function briefIrr(s) { return String(s || '').replace(/\s*\([^)]*\)/g, '').trim(); }

  /* ─────────────── 📊 5개년 재무현황 (fin_json + 정적 폴백) ───────────────
     1순위: Apps Script(type=investors) 응답의 r.fin_json / r.fin_asof / r.fin_src / r.fin_unit
     2순위: investors_fin.js 의 window.NAI_INV_FIN[inv_id] — 시트 반영분(96개사)의 정적 사본
     두 경로 모두 inv_id 와 재무 수치만 읽고, 연도·지표 배열이 없으면 섹션을 그리지 않습니다. */
  var FIN_METRICS = ['매출액', '영업이익', '당기순이익', '자산', '부채', '자본'];
  /* 원자료 단위 → 억원 환산 제수: 1억 = 1십억×0.1 = 1억×1 = 100백만 = 100,000천원 = 100,000,000원 */
  var FIN_DIVS = [[/십억/, 0.1], [/억/, 1], [/백만/, 100], [/천\s*원/, 100000], [/원/, 100000000]];
  function finDiv(unit) {
    var u = String(unit || '').replace(/\s+/g, '');
    if (!u) return 0;
    for (var i = 0; i < FIN_DIVS.length; i++) if (FIN_DIVS[i][0].test(u)) return FIN_DIVS[i][1];
    return 0;
  }
  function finNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  /** 억원 환산 표기 — 1,234.5 / -593.8 / (단위 미확인 시) 원자료 값 그대로 */
  function finTxt(v, unit) {
    if (v === null || v === undefined) return null;
    var d = finDiv(unit);
    if (!d) return Math.round(v).toLocaleString('ko-KR');
    var n = v / d, a = Math.abs(n);
    var s = a.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return (n < 0 ? '-' : '') + s;
  }
  /** 행의 5개년 재무 — Apps Script 응답 우선, 없으면 정적 사본. 한 번만 계산해 붙여 둡니다. */
  function finInfo(r) {
    if (!r) return null;
    if (r._fin !== undefined) return r._fin;
    var src = r.fin_src || r.finSrc || '', asof = r.fin_asof || r.finAsof || '';
    var unit = r.fin_unit || r.finUnit || '', raw = r.fin_json || r.finJson || r.fin || '';
    var from = raw ? 'api' : '';
    if (!raw && r.id && window.NAI_INV_FIN) {
      var fb = window.NAI_INV_FIN[r.id];
      if (fb) {
        raw = fb.json || fb.fin_json || '';
        src = src || fb.src || '';
        asof = asof || fb.asof || '';
        unit = unit || fb.unit || '';
        from = 'static';
      }
    }
    var obj = raw;
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e0) { obj = null; } }
    var out = null;
    if (obj && typeof obj === 'object' && obj.years && obj.years.length) {
      var years = obj.years.map(function (y) { return String(y); });
      var series = {}, any = false;
      FIN_METRICS.forEach(function (m) {
        var arr = (obj[m] && obj[m].length) ? obj[m] : [];
        series[m] = years.map(function (_, i) { return finNum(arr[i]); });
        if (!any && series[m].some(function (v) { return v !== null; })) any = true;
      });
      if (any) out = { years: years, series: series, src: src, asof: asof, unit: unit, from: from };
    }
    try { r._fin = out; } catch (e1) { /* noop */ }
    return out;
  }
  /** 카드용 📊 재무 배지 — 재무 데이터가 있는 기업에만 */
  function finBadge(r) {
    if (!finInfo(r)) return '';
    return '<span class="pr-fin" title="5개년 재무현황 있음 — 🔎 상세에서 확인">📊 재무</span>';
  }
  /** 상세 패널용 재무 표 (연도별 매출액·영업이익·당기순이익·자산·부채·자본) */
  function finSectionHtml(r) {
    var f = finInfo(r);
    if (!f) return '';
    var unitTxt = f.unit || '';
    var div = finDiv(unitTxt);
    var note = [];
    if (f.asof) note.push(esc(f.asof) + ' 기준');
    note.push(div ? '단위 억원' : (unitTxt ? '단위 ' + esc(unitTxt) : '단위 미확인'));
    if (f.src) note.push('출처 ' + esc(f.src));

    var last = f.years.length - 1;
    var head = '<tr><th scope="col">구분</th>' + f.years.map(function (y, i) {
      return '<th scope="col"' + (i === last ? ' class="is-latest"' : '') + '>' + esc(y) + '</th>';
    }).join('') + '</tr>';
    var body = '';
    FIN_METRICS.forEach(function (m) {
      var arr = f.series[m] || [];
      if (!arr.some(function (v) { return v !== null; })) return;
      body += '<tr><th scope="row">' + esc(m) + '</th>' + arr.map(function (v, i) {
        var cls = [];
        if (i === last) cls.push('is-latest');
        if (v !== null && v < 0) cls.push('neg');
        var t = finTxt(v, f.unit);
        return '<td class="num' + (cls.length ? ' ' + cls.join(' ') : '') + '">' +
          (t === null ? '<span class="fin-na">—</span>' : t) + '</td>';
      }).join('') + '</tr>';
    });
    if (!body) return '';
    return '<div class="dc-sec dc-fin"><h4>📊 재무현황 (5개년)' +
      '<span class="dc-fin-note">' + note.join(' · ') + '</span></h4>' +
      '<div class="fin-wrap"><table class="fin-table" aria-label="' + esc(r.company || '') + ' 5개년 재무현황">' +
      '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      (div ? '<div class="dc-fin-src">원자료 단위 ' + esc(unitTxt) + ' → 억원 환산' +
        (f.from === 'static' ? ' · investors 시트 반영분' : '') + '</div>'
        : '<div class="dc-fin-src">원자료 단위를 알 수 없어 값을 그대로 표시했습니다.</div>') +
      '</div>';
  }

  /* ─────────────── 🏢 사옥 이벤트 (si_watch · 관리자 전용) ─────────────── */
  /** 회사명 비교 키 — (주)·그룹·홀딩스 표기와 공백·기호를 제거 */
  function normCo_(s) {
    return String(s || '').replace(/\(주\)|㈜|주식회사|그룹|홀딩스/g, '').replace(/[^0-9A-Za-z가-힣]/g, '').toLowerCase();
  }

  /** si_watch 는 관리자 로그인일 때만 서버에서 받습니다(비관리자는 요청 자체를 하지 않음). */
  function loadSiWatch_() {
    state.siWatch = {};
    if (state.role !== 'admin') { renderSiEventSel_(); return Promise.resolve(); }
    var base = CFG.SYNC_URL;
    if (!base) return Promise.resolve();
    var url = base + (base.indexOf('?') < 0 ? '?' : '&') + 'type=si_watch&token=' + encodeURIComponent(getToken());
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var map = {};
      if (j && j.ok === true && (j.items || []).length) {
        j.items.forEach(function (x) { var k = normCo_(x.company); if (k) map[k] = x; });
      }
      state.siWatch = map;
      renderSiEventSel_();
    }).catch(function () { state.siWatch = {}; renderSiEventSel_(); });
  }

  function siInfo(r) {
    if (!state.siWatch || !r) return null;
    var k = normCo_(r.company);
    return k ? (state.siWatch[k] || null) : null;
  }

  /** 이벤트 연도 집합 — event_year('2027·2031') + 펀드/임차 만기 연도 */
  function siYears(si) {
    var set = {};
    String((si && si.event_year) || '').split(/[^0-9]/).forEach(function (y) { if (y && y.length === 4) set[y] = 1; });
    [si && si.fund_maturity, si && si.lease_maturity].forEach(function (v) {
      var m = String(v || '').match(/(19|20)\d{2}/);
      if (m) set[m[0]] = 1;
    });
    return Object.keys(set).sort();
  }

  function renderSiEventSel_() {
    var sel = $('#poolSiEvent');
    if (!sel) return;
    var show = state.role === 'admin' && state.mode === 'si';
    sel.classList.toggle('hidden', !show);
    if (!show) return;
    var years = {}, n = 0;
    Object.keys(state.siWatch || {}).forEach(function (k) {
      var si = state.siWatch[k];
      n++;
      siYears(si).forEach(function (y) { years[y] = 1; });
    });
    var h = '<option value="ALL">🏢 사옥 이벤트 전체 (' + n + ')</option>' +
      '<option value="EVENT">사옥 이벤트 있는 기업만</option>';
    Object.keys(years).sort().forEach(function (y) { h += '<option value="' + y + '">' + y + '년 만기·이벤트</option>'; });
    sel.innerHTML = h;
    if (state.siEvent !== 'ALL' && state.siEvent !== 'EVENT' && !years[state.siEvent]) state.siEvent = 'ALL';
    sel.value = state.siEvent;
  }

  /** 카드 배지 — 관리자에게만 표시 */
  function siBadge(r) {
    if (state.role !== 'admin') return '';
    var si = siInfo(r);
    if (!si) return '';
    var yrs = siYears(si);
    var g = String(si.grade || '').trim();
    return '<span class="pr-siox" title="사옥 이벤트 · ' + esc(si.asset || '') + '">' +
      '🏢 사옥 이벤트' + (g ? ' ' + esc(g) : '') + (yrs.length ? ' · ' + esc(yrs.join('/')) : '') + '</span>';
  }

  /** 상세 패널 — 만기·구조·트리거 */
  function siSectionHtml(r) {
    if (state.role !== 'admin') return '';
    var si = siInfo(r);
    if (!si) return '';
    var kv = [
      ['등급', si.grade], ['자산', si.asset], ['소재지', si.location],
      ['연면적', (si.gfa_pyeong ? si.gfa_pyeong + '평' : '') + (si.gfa_sqm ? (si.gfa_pyeong ? ' · ' : '') + si.gfa_sqm + '㎡' : '')],
      ['보유 구조', si.structure], ['운용사', si.manager], ['지분·투자', si.stake_amount],
      ['취득·매각', si.acq_disposal], ['펀드 만기', si.fund_maturity], ['임차 만기', si.lease_maturity],
      ['본사', si.hq], ['동향', si.trend], ['가능성', si.probability], ['이벤트 연도', si.event_year],
      ['NAI 포인트', si.nai_point], ['확신도', si.confidence]
    ].filter(function (x) { return String(x[1] || '').trim(); });
    return '<div class="dc-sec dc-si"><h4>🏢 사옥 이벤트 <span class="dc-si-lock">관리자 전용</span></h4>' +
      '<div class="dc-kv">' + kv.map(function (x) {
        return '<span><b>' + esc(x[0]) + '</b>' + esc(x[1]) + '</span>';
      }).join('') + '</div>' +
      (si.source ? '<div class="dc-fin-src">출처 ' + esc(si.source) + (si.updated_at ? ' · ' + esc(si.updated_at) : '') + '</div>' : '') +
      '</div>';
  }

  /* ─────────────── 불러오기 ─────────────── */
  function load(force) {
    if (state.busy) return Promise.resolve();
    if (!getToken()) { renderNotReady(); return Promise.resolve(); }
    if (state.loaded && !force) return Promise.resolve();
    state.busy = true;
    $('#poolMeta').textContent = '불러오는 중…';
    return api().then(function (j) {
      state.busy = false;
      if (!j || j.ok !== true) {
        if (j && j.error === 'unauthorized') renderNotReady('접속코드가 필요합니다. 상단 🔑 로 접속코드를 입력하세요.');
        else renderNotReady('불러오지 못했습니다' + (j && j.error ? ' (' + j.error + ')' : ''));
        return;
      }
      state.role = normRole_(j.role);
      /* 물류TF — 화주 풀만 사용 */
      if (state.role === 'logi') { try { setMode('ship'); } catch (e0) { /* noop */ } }
      state.rows = (j.investors || []).map(function (r) {
        var o = Object.assign({}, r);
        o.kind = normKind(o.kind);
        return o;
      });
      state.loaded = true;
      window.NAI_POOL_ROWS = state.rows;   /* 🗒 CRM 모듈이 카드 정보를 찾을 수 있게 노출 */
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows: state.rows })); } catch (e) { /* noop */ }
      applyRole();
      renderChips();
      render();
      loadSiWatch_().then(render);
    }).catch(function (e) {
      state.busy = false;
      renderNotReady('오프라인/연결 오류 — ' + (e && e.message ? e.message : '네트워크 오류'));
    });
  }

  function renderNotReady(msg) {
    $('#poolMeta').textContent = '데이터 없음';
    $('#poolList').innerHTML = '<div class="pool-empty">' + esc(msg || '투자자·화주 데이터를 불러올 수 없습니다.') + '</div>';
    $('#poolResultCount').textContent = '0건';
    $('#composeHint').textContent = '선택 0건';
  }

  function applyRole() {
    var badge = $('#poolRole');
    var ext = isExternal();
    if (badge) {
      badge.classList.remove('hidden');
      badge.className = 'role-chip' + ((state.role === 'internal' || state.role === 'logi') ? ' is-internal' : (ext ? ' is-external' : ''));
      badge.textContent = state.role === 'admin' ? '관리자'
        : (state.role === 'internal' ? '내부용 · 전화번호 비공개'
          : (state.role === 'logi' ? '물류TF · 화주만 저장'
            : '외부 방문자 · 연락처 비공개'));
    }
    var add = $('#poolAddBtn');
    if (add) add.classList.toggle('hidden', !canEdit());
    syncAddLabel();
    var compose = $('#poolCompose');
    if (compose) compose.classList.toggle('hidden', ext);
    var oe = $('#poolOnlyEmail');
    if (oe && oe.parentNode) oe.parentNode.classList.toggle('hidden', ext);
    var hint = $('#poolCompose');
    if (hint) hint.setAttribute('aria-hidden', String(ext));
  }

  /** 접속코드를 바꾸거나 외부 세션이 시작되면 앱 게이트 권한을 풀 화면에 맞춥니다.
   *  권한이 바뀌면 이전 권한으로 받아 둔 목록을 버리고 새 권한으로 다시 받아옵니다.
   *  (관리자 → 내부용/외부로 내려갈 때 가려야 할 전화번호·연락처가 화면에 남지 않도록) */
  function syncRoleFromApp() {
    try {
      var r = window.naiMap && window.naiMap.state && window.naiMap.state.role;
      if (!r) return;
      var norm = normRole_(r);
      if (norm !== state.role) {
        state.role = norm;
        state.loaded = false;
        state.rows = [];
        state.sel = {};
        state.siWatch = {};
        state.siEvent = 'ALL';
        try { localStorage.removeItem(CACHE_KEY); } catch (e0) { /* noop */ }
        applyRole();
        renderChips();
        render();
        if (getToken()) load(true);
      }
    } catch (e) { /* noop */ }
  }
  window.NAI_POOL_ROLE_SYNC = function () { syncRoleFromApp(); };
  /** 접속(로그인) 직후: 권한이 같아도 지금 세션의 권한으로 풀 목록을 다시 받아옵니다. */
  window.NAI_POOL_FORCE_RELOAD = function () {
    state.loaded = false;
    state.rows = [];
    state.sel = {};
    state.siWatch = {};
    state.siEvent = 'ALL';
    try { localStorage.removeItem(CACHE_KEY); } catch (e0) { /* noop */ }
    state.role = normRole_((window.naiMap && window.naiMap.state && window.naiMap.state.role) || state.role);
    applyRole();
    renderChips();
    render();
    if (getToken()) load(true);
  };

  /* ─────────────── 필터 ─────────────── */
  function modeRows() {
    return state.rows.filter(inMode);
  }
  function countByKind(k) {
    if (k === 'all') return modeRows().length;
    return state.rows.filter(function (r) { return r.kind === k; }).length;
  }
  function countCompany(kind) {
    var set = {};
    state.rows.forEach(function (r) { if (r.kind === kind && r.company) set[r.company] = 1; });
    return Object.keys(set).length;
  }

  function regionsFor(kind) {
    var set = {}, list = [];
    state.rows.forEach(function (r) {
      if (!inMode(r)) return;
      if (kind !== 'all' && r.kind !== kind) return;
      if (r.region) set[r.region] = 1;
    });
    REGION_ORDER.forEach(function (x) { if (set[x]) { list.push(x); delete set[x]; } });
    Object.keys(set).sort().forEach(function (x) { list.push(x); });
    return list;
  }

  function countRegion(region) {
    return state.rows.filter(function (r) {
      if (!inMode(r)) return false;
      if (state.kind !== 'all' && r.kind !== state.kind) return false;
      return region === 'ALL' ? true : r.region === region;
    }).length;
  }

  function countStrat(s) {
    return state.rows.filter(function (r) {
      if (!inMode(r)) return false;
      if (state.kind !== 'all' && r.kind !== state.kind) return false;
      return fiData(r).tags.indexOf(s) >= 0;
    }).length;
  }

  function renderChips() {
    var def = modeDef(state.mode);
    var kc = $('#poolKindChips');
    if (kc) {
      kc.innerHTML = ['all'].concat(def.kinds).map(function (k) {
        var x = KIND_MAP[k];
        var n = countByKind(k);
        var on = state.kind === k;
        return '<button type="button" class="chip ' + (on ? 'is-on' : 'is-off') + ' kc-' + k + '" data-kind="' + k + '" aria-pressed="' + on + '">' +
          '<span>' + x.icon + ' ' + esc(x.label) + '</span><span class="cnt">' + n + '</span></button>';
      }).join('');
    }

    var sc = $('#poolStratChips');
    if (sc) {
      if (state.mode === 'fi') {
        var html = ['<span class="seg-label">전략</span>'];
        var allOn = state.strat === 'ALL';
        html.push('<button type="button" class="chip s-all ' + (allOn ? 'is-on' : 'is-off') + '" data-strat="ALL" aria-pressed="' + allOn + '">' +
          '<span>전체 전략</span><span class="cnt">' + countRegion('ALL') + '</span></button>');
        STRATS.forEach(function (s) {
          var n = countStrat(s);
          if (!n && s !== '미확인') return;
          var on = state.strat === s;
          html.push('<button type="button" class="chip s-' + STRAT_CLS[s] + ' ' + (on ? 'is-on' : 'is-off') + '" data-strat="' + esc(s) + '" aria-pressed="' + on + '">' +
            '<span>' + esc(s) + '</span><span class="cnt">' + n + '</span></button>');
        });
        sc.innerHTML = html.join('');
      } else {
        sc.innerHTML = '';
      }
    }

    var rc = $('#poolRegionChips');
    if (!rc) return;
    var list = regionsFor(state.kind);
    var rhtml = ['<span class="seg-label">권역</span>',
      '<button type="button" class="chip ' + (state.region === 'ALL' ? 'is-on' : 'is-off') + '" data-region="ALL" aria-pressed="' + (state.region === 'ALL') + '">' +
      '<span>권역 전체</span><span class="cnt">' + countRegion('ALL') + '</span></button>'];
    list.forEach(function (r) {
      var n = countRegion(r);
      var on = state.region === r;
      rhtml.push('<button type="button" class="chip ' + (on ? 'is-on' : 'is-off') + '" data-region="' + esc(r) + '" title="' + esc(REGION_NOTE[r] || '') + '" aria-pressed="' + on + '">' +
        '<span>' + esc(r) + '</span><span class="cnt">' + n + '</span></button>');
    });
    rc.innerHTML = rhtml.join('');
    renderOwnerSel();
    renderSiEventSel_();
  }

  /** NAI 담당자 필터 — 현재 탭의 담당자 목록 */
  function renderOwnerSel() {
    var sel = $('#poolOwnerSel');
    if (!sel) return;
    var counts = {};
    modeRows().forEach(function (r) {
      var o = String(r.owner || '').trim();
      var key = o || '__NONE__';
      counts[key] = (counts[key] || 0) + 1;
    });
    var keys = Object.keys(counts).filter(function (k) { return k !== '__NONE__'; })
      .sort(function (a, b) { return counts[b] - counts[a]; });
    var h = '<option value="ALL">담당자 전체 (' + modeRows().length + ')</option>';
    keys.forEach(function (k) { h += '<option value="' + esc(k) + '">' + esc(k) + ' (' + counts[k] + ')</option>'; });
    if (counts.__NONE__) h += '<option value="__NONE__">담당 미지정 (' + counts.__NONE__ + ')</option>';
    sel.innerHTML = h;
    if (state.owner && (state.owner === 'ALL' || counts[state.owner])) sel.value = state.owner;
    else { state.owner = 'ALL'; sel.value = 'ALL'; }
  }

  /* ─────────────── 📥 엑셀 다운로드 (현재 탭·필터 기준) ─────────────── */
  function kindLabel(k) { var x = KIND_MAP[normKind(k)] || KIND_MAP.office; return x.label; }
  function ymd() {
    var d = new Date();
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
  }
  function exportRows() {
    var rows = filtered();
    var mode = state.mode;
    var m = {
      si: {
        name: 'SI', head: ['분류', '권역', '회사·기관', '업종·섹터', '성격·역할', '담당자', '직함', '이메일', '전화', 'NAI 담당자', '사례·비고', '확장·수요', '금액(억)', '출처'],
        map: function (r) { return [kindLabel(r.kind), r.region, r.company, r.industry, r.role, r.contact, r.title, r.email, r.phone, r.owner, r.case_info || r.notes, r.expansion, r.amount, r.source]; }
      },
      ship: {
        name: '물류화주', head: ['분류', '권역', '화주사', '업종', '담당자', '직함', '이메일', '전화', 'NAI 담당자', '온도대', '확인 센터수', '확장·수요 권역', '비고', '출처'],
        map: function (r) { return [kindLabel(r.kind), r.region, r.company, r.industry, r.contact, r.title, r.email, r.phone, r.owner, r.temp, r.centers, r.expansion, r.notes, r.source]; }
      },
      fi: {
        name: 'FI풀', head: ['분류', '권역', '운용사·기관', '전략·업종', '성격·역할', '담당자', '직함', '이메일', '전화', 'NAI 담당자', '펀드·전략 상세', '금액(억)', '연도', '출처', '비고'],
        map: function (r) { return [kindLabel(r.kind), r.region, r.company, r.industry, r.role, r.contact, r.title, r.email, r.phone, r.owner, r.case_info, r.amount, r.year, r.source, r.notes]; }
      }
    }[mode] || null;
    if (!m) return null;
    return { name: m.name, head: m.head, body: rows.map(m.map), count: rows.length };
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? '"' + s + '"' : s;
  }

  function downloadXlsx() {
    var d = exportRows();
    if (!d) return;
    if (!d.count) { toast('다운로드할 항목이 없습니다. 필터를 조정해 보세요.', true); return; }
    var base = 'NAI_' + d.name + '_' + ymd();
    var note = isExternal() ? '외부 공개본(연락처 비공개)' : (state.role === 'internal' || state.role === 'logi' ? '내부용(전화번호 비공개)' : '관리자용');
    if (window.XLSX && window.XLSX.utils) {
      try {
        var aoa = [d.head].concat(d.body);
        var ws = window.XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = d.head.map(function (h) { return { wch: Math.max(10, Math.min(46, String(h).length * 2 + 8)) }; });
        var wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, d.name.slice(0, 28));
        window.XLSX.writeFile(wb, base + '.xlsx');
        toast(d.count + '건을 엑셀(.xlsx)로 내려받았습니다 · ' + note);
        return;
      } catch (e) { /* 아래 CSV 대체로 */ }
    }
    var lines = [d.head.map(csvCell).join(',')].concat(d.body.map(function (r) { return r.map(csvCell).join(','); }));
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = base + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
    toast(d.count + '건을 CSV(엑셀 호환)로 내려받았습니다 · ' + note);
  }

  function haystack(r) {
    return [r.company, r.industry, r.role, r.case_info, r.contact, r.title, r.email, r.phone,
      r.region, r.notes, r.expansion, r.temp, r.source, r.year, r.amount, r.owner]
      .concat(isFiKind(r.kind) ? fiData(r).tags : [])
      .join(' ').toLowerCase();
  }

  function filtered() {
    var q = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return state.rows.filter(function (r) {
      if (!inMode(r)) return false;
      if (state.kind !== 'all' && r.kind !== state.kind) return false;
      if (state.region !== 'ALL' && r.region !== state.region) return false;
      if (state.onlyEmail && !r.email) return false;
      if (state.finOnly && !finInfo(r)) return false;
      if (state.mode === 'si' && state.role === 'admin' && state.siEvent !== 'ALL') {
        var si = siInfo(r);
        if (!si) return false;
        if (state.siEvent === 'EVENT') { if (!siYears(si).length) return false; }
        else if (siYears(si).indexOf(state.siEvent) < 0) return false;
      }
      if (state.owner && state.owner !== 'ALL') {
        var ow = String(r.owner || '').trim();
        if (state.owner === '__NONE__') { if (ow) return false; }
        else if (ow !== state.owner) return false;
      }
      if (state.mode === 'fi') {
        var d = fiData(r);
        if (state.fundOnly && !d.funds.length) return false;
        if (state.strat !== 'ALL' && d.tags.indexOf(state.strat) < 0) return false;
      }
      if (q.length) {
        var hay = haystack(r);
        for (var i = 0; i < q.length; i++) if (hay.indexOf(q[i]) === -1) return false;
      }
      return true;
    });
  }

  /* ─────────────── 목록 ─────────────── */
  function subLine(r) {
    if (r.kind === 'shipper') {
      return [r.temp ? '온도 ' + r.temp : '', r.centers ? '확인 센터 ' + r.centers + '곳' : '',
        r.expansion ? '확장 ' + r.expansion : ''].filter(Boolean).join(' · ');
    }
    return [r.expansion ? '확장·수요: ' + r.expansion : '', r.notes || ''].filter(Boolean).join(' · ');
  }

  function ownerBadge(r) {
    var o = String((r && r.owner) || '').trim();
    if (!o) return '<span class="pr-owner none" title="NAI 담당자 미지정">👤 담당 미지정</span>';
    return '<span class="pr-owner" title="NAI 담당자">👤 ' + esc(o) + '</span>';
  }

  function kindBadge(r) {
    var km = KIND_MAP[r.kind] || KIND_MAP.office;
    return '<span class="pr-kind ' + km.cls + '">' + esc(km.badge) + '</span>';
  }

  function contactHtml(r) {
    if (isExternal()) {
      return '<div class="pr-contact pr-masked">🔒 담당자 연락처·이메일은 비공개입니다 <span class="pc-title">· 문의: NAI Korea</span></div>';
    }
    var phone = String(r.phone || '');
    var phoneMasked = !phone || phone === '비공개';
    return '<div class="pr-contact">' +
      (r.contact ? '<span class="pc-name">👤 ' + esc(r.contact) + (r.title ? ' <span class="pc-title">' + esc(r.title) + '</span>' : '') + '</span>' : '') +
      (r.email ? '<a class="pc-mail" href="mailto:' + esc(r.email.split(',')[0].trim()) + '">✉️ ' + esc(r.email) + '</a>' : '<span class="pc-none">이메일 없음</span>') +
      (phoneMasked ? '<span class="pc-none">☎ 비공개</span>'
        : '<a class="pc-tel" href="tel:' + esc(phone.replace(/[^0-9+]/g, '')) + '">☎ ' + esc(phone) + '</a>') +
      '</div>';
  }

  function crmInline(r) {
    if (!window.NAI_CRM) return '';
    if (window.NAI_CRM.visible && !window.NAI_CRM.visible()) return '';
    try { return window.NAI_CRM.inline(r, isFiKind(r.kind) ? 'FI' : (r.kind === 'shipper' ? '화주' : 'SI')); } catch (e) { return ''; }
  }

  function rowActions(r) {
    return '<div class="pr-actions">' +
      '<button type="button" class="mini-btn" data-open="' + esc(r.id) + '" title="상세 보기">🔎</button>' +
      (canEditRow(r) ? '<button type="button" class="mini-btn" data-edit="' + esc(r.id) + '" title="컨택포인트·NAI 담당자 수정">✏️</button>' : '') +
      (canDelete() ? '<button type="button" class="mini-btn danger" data-del="' + esc(r.id) + '">🗑</button>' : '') +
      '</div>';
  }

  /** 🤝 SI·화주 카드 */
  function siRowHtml(r) {
    var on = !!state.sel[r.id];
    var sub = subLine(r);
    return '<div class="pool-row' + (on ? ' is-sel' : '') + '" data-id="' + esc(r.id) + '" role="listitem">' +
      '<label class="pr-check"><input type="checkbox" data-check="' + esc(r.id) + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(r.company) + ' 선택"></label>' +
      '<div class="pr-main">' +
        '<div class="pr-top">' + kindBadge(r) +
          '<span class="pr-region">' + esc(r.region || '-') + '</span>' +
          finBadge(r) +
          siBadge(r) +
          (r.role ? '<span class="pr-role">' + esc(r.role) + '</span>' : '') +
          (r.year ? '<span class="pr-year">' + esc(r.year) + '</span>' : '') +
          (r.amount ? '<span class="pr-amount">' + esc(r.amount) + '억</span>' : '') +
          ownerBadge(r) +
        '</div>' +
        '<div class="pr-name">' + esc(r.company) + (r.industry ? ' <span class="pr-industry">' + esc(r.industry) + '</span>' : '') + '</div>' +
        (r.case_info ? '<div class="pr-case">' + esc(r.case_info) + '</div>' : '') +
        (sub ? '<div class="pr-sub">' + esc(sub) + '</div>' : '') +
        contactHtml(r) +
        crmInline(r) +
      '</div>' + rowActions(r) +
      '</div>';
  }

  function fiRowHtmlTail(r) {
    return crmInline(r);
  }

  /** 🏦 FI 카드 — 펀드 메타데이터(전략·IRR·드라이파우더·지역·만기)를 한눈에 */
  function fiRowHtml(r) {
    var on = !!state.sel[r.id];
    var d = fiData(r);
    var tags = d.tags.map(function (t) {
      return '<span class="pr-strat s-' + (STRAT_CLS[t] || 'na') + '">' + esc(t) + '</span>';
    }).join('');

    var kv = [];
    var irr = briefIrr(d.note.irr || uniqJoin(d.funds.map(function (f) { return f.irr; }), 2));
    var dry = d.note.dryTotal || uniqJoin(d.funds.map(function (f) { return f.dry; }), 2);
    var dryLabel = '드라이파우더';
    if (!dry) {
      var remain = uniqJoin(d.funds.map(function (f) { return f.remain; }), 2);
      if (remain) { dry = remain; dryLabel = '잔여 약정'; }
    }
    var area = d.note.region || uniqJoin(d.funds.map(function (f) { return f.region; }), 2);
    var term = uniqJoin(d.funds.map(function (f) { return f.term; }), 2);
    if (irr) kv.push('<span class="fk fk-irr"><b>목표IRR</b>' + esc(irr) + '</span>');
    if (dry) kv.push('<span class="fk fk-dry"><b>' + dryLabel + '</b>' + esc(dry) + '</span>');
    if (area) kv.push('<span class="fk fk-area"><b>지역</b>' + esc(area) + '</span>');
    if (term) kv.push('<span class="fk fk-term"><b>만기</b>' + esc(term) + '</span>');

    var fundLine = '';
    var named = d.funds.filter(function (f) { return f.name; });
    if (named.length) {
      fundLine = '<div class="pr-funds">' + named.slice(0, 3).map(function (f) {
        return '<span class="pr-fund">📁 ' + esc(f.name) +
          (f.lp ? ' <span class="pr-lp">LP ' + esc(f.lp) + '</span>' : '') +
          (f.gp ? ' <span class="pr-lp">GP ' + esc(f.gp) + '</span>' : '') +
          (f.size ? ' <span class="pr-size">' + esc(f.size) + '</span>' : '') + '</span>';
      }).join('') + (named.length > 3 ? '<span class="pr-fund more">+ ' + (named.length - 3) + '개 펀드</span>' : '') + '</div>';
    } else if (d.funds.length) {
      fundLine = '<div class="pr-funds">' + d.funds.slice(0, 2).map(function (f) {
        return '<span class="pr-fund">📁 ' + esc(f.raw.slice(0, 90)) + '</span>';
      }).join('') + '</div>';
    } else {
      fundLine = '<div class="pr-sub">' + esc(r.case_info || '펀드 상세 정보 없음') + '</div>';
    }

    return '<div class="pool-row' + (on ? ' is-sel' : '') + ' fi-row" data-id="' + esc(r.id) + '" role="listitem">' +
      '<label class="pr-check"><input type="checkbox" data-check="' + esc(r.id) + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(r.company) + ' 선택"></label>' +
      '<div class="pr-main">' +
        '<div class="pr-top">' + kindBadge(r) +
          '<span class="pr-region">' + esc(r.region || '-') + '</span>' +
          finBadge(r) +
          (r.industry ? '<span class="pr-role">' + esc(r.industry) + '</span>' : '') +
          tags +
          (r.amount ? '<span class="pr-amount">D/P ' + esc(r.amount) + '억</span>' : '') +
          ownerBadge(r) +
        '</div>' +
        '<div class="pr-name">' + esc(r.company) + (r.role ? ' <span class="pr-industry">' + esc(r.role) + '</span>' : '') + '</div>' +
        fundLine +
        (kv.length ? '<div class="pr-fundkv">' + kv.join('') + '</div>' : '') +
        contactHtml(r) +
        crmInline(r) +
      '</div>' + rowActions(r) +
      '</div>';
  }

  function render() {
    var rows = filtered();
    var host = $('#poolList');
    var selCount = selectedRows().length;
    var withEmail = rows.filter(function (r) { return r.email; }).length;
    var fundRows = state.mode === 'fi' ? rows.filter(function (r) { return fiData(r).funds.length; }).length : 0;
    var finRows = rows.filter(function (r) { return !!finInfo(r); }).length;
    $('#poolResultCount').textContent = rows.length + '건 · 이메일 ' + withEmail + '건' +
      (finRows ? ' · 📊 재무 ' + finRows + '건' : '') +
      (state.mode === 'fi' ? ' · 펀드정보 ' + fundRows + '건' : '');

    if (state.mode === 'fi') {
      $('#poolMeta').textContent = '블라인드펀드 ' + countByKind('blind_fund') + '건(' + countCompany('blind_fund') + '개사)' +
        ' · 리츠·해외투자사 ' + countByKind('reit_foreign') + '건(' + countCompany('reit_foreign') + '개사)' +
        ' · 연기금·LP ' + countByKind('pension_lp') + '건(' + countCompany('pension_lp') + '개사)' +
        ' — 총 ' + modeRows().length.toLocaleString('ko-KR') + '건 · 2026-11-22 기준';
    } else if (state.mode === 'ship') {
      $('#poolMeta').textContent = '물류센터 화주 ' + countByKind('shipper') + '건(' + countCompany('shipper') + '개사)' +
        ' — 사용센터·부족권역·확장계획 기준 · 총 ' + modeRows().length.toLocaleString('ko-KR') + '건';
    } else {
      $('#poolMeta').textContent = '오피스 SI ' + countByKind('office') + '건(' + countCompany('office') + '개사)' +
        ' — 사옥 매입·전략투자 · 총 ' + modeRows().length.toLocaleString('ko-KR') + '건 · 2026-11-22 기준';
    }

    if (!rows.length) {
      host.innerHTML = '<div class="pool-empty">조건에 맞는 대상이 없습니다.<br>필터·검색어를 조정해 보세요.</div>';
      updateCompose(selCount);
      return;
    }
    var limit = modeDef(state.mode).limit || 400;
    var shown = rows.slice(0, limit);
    var html = shown.map(state.mode === 'fi' ? fiRowHtml : siRowHtml).join('');
    if (rows.length > shown.length) {
      html = '<div class="pool-empty" style="padding:8px 4px;font-size:12px">' +
        rows.length + '건 중 ' + shown.length + '건만 표시 — 분류·권역·검색으로 좁히세요 (선택·메일 발송은 필터 결과 전체에 적용)</div>' + html;
    }
    host.innerHTML = html;
    updateCompose(selCount);
  }

  function selectedRows() {
    return state.rows.filter(function (r) { return state.sel[r.id] && inMode(r); });
  }

  function updateCompose(selCount) {
    if (selCount === undefined) selCount = selectedRows().length;
    var sel = selectedRows();
    var mail = sel.filter(function (r) { return r.email; });
    var hint = $('#composeHint');
    if (hint) {
      hint.innerHTML = '선택 <b>' + sel.length + '</b>건 · 이메일 보유 <b>' + mail.length + '</b>건' +
        (sel.length && !mail.length ? ' <span class="warn">— 이메일이 있는 대상을 선택하세요</span>' : '');
    }
    var b1 = $('#btnMailto'), b2 = $('#btnCopyEmails'), b3 = $('#btnCopyRequest');
    [b1, b2, b3].forEach(function (b) { if (b) b.disabled = !mail.length; });
  }

  /* ─────────────── 메일 발송 바 ─────────────── */
  function emailsOf(rows) {
    var out = [], seen = {};
    rows.forEach(function (r) {
      String(r.email || '').split(/[,;]/).forEach(function (e) {
        e = e.trim();
        if (e && e.indexOf('@') > 0 && !seen[e.toLowerCase()]) { seen[e.toLowerCase()] = 1; out.push(e); }
      });
    });
    return out;
  }

  function composeSubject() {
    var s = ($('#mailSubject') && $('#mailSubject').value || '').trim();
    return s || '[NAI Korea] 물건 티저 안내';
  }
  function composeLink() {
    return ($('#mailLink') && $('#mailLink').value || '').trim();
  }
  function composeBody() {
    var msg = ($('#mailBody') && $('#mailBody').value || '').trim();
    var link = composeLink();
    var lines = [];
    if (msg) lines.push(msg);
    if (link) lines.push(link);
    lines.push('');
    lines.push('감사합니다.');
    lines.push('NAI Korea 권준오 상무');
    return lines.join('\n');
  }

  function openMailto() {
    var sel = selectedRows().filter(function (r) { return r.email; });
    var list = emailsOf(sel);
    if (!list.length) { toast('이메일이 있는 대상을 선택하세요.', true); return; }
    var bcc = list.slice(0, 90).join(',');
    if (list.length > 90) toast('메일 앱 한도로 앞 90명만 넣었습니다. 나머지는 목록 복사로 보내세요.', true);
    var url = 'mailto:?bcc=' + encodeURIComponent(bcc) +
      '&subject=' + encodeURIComponent(composeSubject()) +
      '&body=' + encodeURIComponent(composeBody());
    if (url.length > 1900) {
      toast('수신자가 많아 메일 앱 주소가 깁니다. “이메일 목록 복사”를 쓰는 편이 안전합니다.', true);
    }
    window.location.href = url;
  }

  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(okMsg || '복사했습니다.'); }
      catch (e) { toast('복사하지 못했습니다.', true); }
      ta.remove();
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg || '복사했습니다.'); }, fallback);
    } else fallback();
  }

  function copyEmails() {
    var sel = selectedRows().filter(function (r) { return r.email; });
    var list = emailsOf(sel);
    if (!list.length) { toast('이메일이 있는 대상을 선택하세요.', true); return; }
    copyText(list.join('; '), list.length + '개 이메일을 복사했습니다.');
  }

  function copyRequest() {
    var sel = selectedRows().filter(function (r) { return r.email; });
    if (!sel.length) { toast('이메일이 있는 대상을 선택하세요.', true); return; }
    var subject = composeSubject();
    var link = composeLink();
    var msg = ($('#mailBody') && $('#mailBody').value || '').trim();
    var names = sel.map(function (r) { return r.company + '(' + r.email + ')'; });
    var txt = '아래 ' + sel.length + '개사에 [' + subject + ']' + (link ? ' (' + link + ')' : '') + ' 메일 초안 작성해줘' +
      (msg ? '. 메시지: ' + msg : '') + ':\n' + names.join(', ');
    copyText(txt, sel.length + '개사 발송 요청문을 복사했습니다.');
  }

  /* ─────────────── 상세 보기 (읽기) ─────────────── */
  function openDetail(r) {
    if (!r) return;
    var km = KIND_MAP[r.kind] || KIND_MAP.office;
    var fi = isFiKind(r.kind);
    var d = fi ? fiData(r) : null;
    var body = '';

    body += '<div class="dc-meta">' +
      '<span class="pr-kind ' + km.cls + '">' + esc(km.badge) + '</span>' +
      '<span class="pr-region">' + esc(r.region || '-') + '</span>' +
      (r.industry ? '<span class="pr-role">' + esc(r.industry) + '</span>' : '') +
      (r.role ? '<span class="pr-role">' + esc(r.role) + '</span>' : '') +
      (r.year ? '<span class="pr-year">' + esc(r.year) + '</span>' : '') +
      (r.amount ? '<span class="pr-amount">' + (fi ? 'D/P ' : '') + esc(r.amount) + '억</span>' : '') +
      '</div>';

    body += siSectionHtml(r);
    body += finSectionHtml(r);

    var canEdRow = canEditRow(r);
    body += '<div class="dc-sec"><h4>담당자(컨택포인트)' +
      (canEdRow ? ' <button type="button" class="mini-btn dc-edit" data-edit="' + esc(r.id) + '">✏️ 컨택포인트 변경</button>' : '') + '</h4>' +
      (r.contact || r.email || r.phone
        ? '<div class="dc-contact">' +
          (r.contact ? '<span class="pc-name">👤 ' + esc(r.contact) + (r.title ? ' <span class="pc-title">' + esc(r.title) + '</span>' : '') + '</span>' : '') +
          (r.email ? '<a class="pc-mail" href="mailto:' + esc(r.email.split(',')[0].trim()) + '">✉️ ' + esc(r.email) + '</a>' : '<span class="pc-none">이메일 없음</span>') +
          (r.phone ? '<a class="pc-tel" href="tel:' + esc(r.phone.replace(/[^0-9+]/g, '')) + '">☎ ' + esc(r.phone) + '</a>' : '') +
          '</div>'
        : '<div class="dc-none">등록된 담당자 없음' + (canEdRow ? ' — <b>✏️ 컨택포인트 변경</b>을 눌러 추가하세요.' : '') + '</div>') +
      '</div>';

    if (fi) {
      body += '<div class="dc-sec"><h4>펀드 · 전략 ' + (d.funds.length ? '(' + d.funds.length + '건)' : '') + '</h4>';
      if (d.tags.length) {
        body += '<div class="dc-tags">' + d.tags.map(function (t) {
          return '<span class="pr-strat s-' + (STRAT_CLS[t] || 'na') + '">' + esc(t) + '</span>';
        }).join('') + '</div>';
      }
      if (d.funds.length) {
        d.funds.forEach(function (f) {
          var rows = [];
          if (f.lp) rows.push(['LP', f.lp]);
          if (f.gp) rows.push(['GP', f.gp]);
          if (f.strat) rows.push(['전략', f.strat]);
          if (f.size) rows.push(['규모·약정', f.size]);
          if (f.dry) rows.push(['드라이파우더', f.dry]);
          if (f.remain) rows.push(['잔여 약정', f.remain]);
          if (f.irr) rows.push(['목표 IRR', f.irr]);
          if (f.target) rows.push(['투자 대상', f.target]);
          if (f.region) rows.push(['지역 가이드', f.region]);
          if (f.term) rows.push(['만기', f.term]);
          body += '<div class="dc-fund">' +
            '<div class="dc-fund-name">📁 ' + esc(f.name || '펀드 정보') + '</div>' +
            (rows.length
              ? '<div class="dc-kv">' + rows.map(function (kv) {
                return '<span><b>' + esc(kv[0]) + '</b>' + esc(kv[1]) + '</span>';
              }).join('') + '</div>'
              : '<div class="dc-none">' + esc(f.raw) + '</div>') +
            '</div>';
        });
      } else {
        body += '<div class="dc-none">펀드 상세 미확인 — 카드의 업종·비고를 참고하세요.</div>';
      }
      body += '</div>';
    }

    if (r.case_info) {
      body += '<div class="dc-sec"><h4>' + (fi ? '원문(사례·펀드 상세)' : '사례·수요') + '</h4>' +
        '<div class="dc-text">' + esc(r.case_info).replace(/\|\|/g, '<br>').replace(/\s\|\s/g, ' · ') + '</div></div>';
    }
    if (!fi && r.expansion) {
      body += '<div class="dc-sec"><h4>확장·수요 권역</h4><div class="dc-text">' + esc(r.expansion) + '</div></div>';
    }
    if (r.notes) {
      body += '<div class="dc-sec"><h4>비고</h4><div class="dc-text">' + esc(r.notes) + '</div></div>';
    }
    if (r.source) {
      body += '<div class="dc-sec"><h4>출처</h4><div class="dc-text">' + esc(r.source) + (r.updated_at ? ' · ' + esc(r.updated_at) : '') + '</div></div>';
    }
    /* 🗒 미팅·의향 히스토리 (내부용·관리자만) */
    if (window.NAI_CRM) {
      try { body += window.NAI_CRM.detail(r, isFiKind(r.kind) ? 'FI' : (r.kind === 'shipper' ? '화주' : 'SI')); } catch (e) { /* noop */ }
    }

    var selOn = !!state.sel[r.id];
    var html = '<div class="modal-card dc-card" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><h3>' + esc(r.company) + '</h3>' +
      '<button type="button" class="icon-btn" data-close="1" aria-label="닫기">×</button></div>' +
      body +
      '<div class="modal-foot">' +
      '<button type="button" class="btn btn-outline" data-sel="' + esc(r.id) + '">' + (selOn ? '선택 해제' : '메일 대상으로 선택') + '</button>' +
      '<button type="button" class="btn btn-outline" data-close="1">닫기</button>' +
      '<button type="button" class="btn btn-solid" data-mail="' + esc(r.id) + '">✉️ 이 대상에게 메일</button>' +
      '</div></div>';

    var root = $('#poolModal');
    root.innerHTML = '<div class="modal-backdrop" data-close="1"></div>' + html;
    root.classList.remove('hidden');
    root.onclick = function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.getAttribute('data-close')) { closeEditor(); return; }
      var ms = t.getAttribute('data-sel');
      if (ms) {
        state.sel[ms] = !state.sel[ms];
        closeEditor();
        render();
        toast(state.sel[ms] ? '선택했습니다.' : '선택을 해제했습니다.');
        return;
      }
      var mm = t.getAttribute('data-mail');
      if (mm) {
        var row = state.rows.filter(function (x) { return x.id === mm; })[0];
        if (!row || !row.email) { toast('이메일이 없습니다.', true); return; }
        var url = 'mailto:' + encodeURIComponent(row.email.split(',')[0].trim()) +
          '?subject=' + encodeURIComponent(composeSubject()) +
          '&body=' + encodeURIComponent(composeBody());
        window.location.href = url;
        return;
      }
      var edId = t.getAttribute('data-edit');
      if (edId) {
        var er = state.rows.filter(function (x) { return x.id === edId; })[0];
        if (er) openEditor(er);
      }
    };
  }

  /* ─────────────── 관리자 편집 ─────────────── */
  function fieldRow(label, key, val, opts) {
    opts = opts || {};
    var v = esc(val || '');
    if (opts.textarea) {
      return '<label class="mf"><span>' + esc(label) + '</span><textarea data-k="' + key + '" rows="' + (opts.rows || 3) + '">' + v + '</textarea></label>';
    }
    if (opts.pairs) {
      return '<label class="mf"><span>' + esc(label) + '</span><select data-k="' + key + '">' +
        opts.pairs.map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (String(val) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select></label>';
    }
    return '<label class="mf"><span>' + esc(label) + '</span><input data-k="' + key + '" type="text" value="' + v + '"></label>';
  }

  /** NAI 담당자 후보 — 시트에 이미 지정된 이름 + 기본 팀원 */
  var OWNER_BASE = ['권준오 상무'];
  function ownerOptions() {
    var set = {};
    OWNER_BASE.forEach(function (x) { set[x] = 1; });
    state.rows.forEach(function (r) { var o = String(r.owner || '').trim(); if (o) set[o] = 1; });
    return Object.keys(set).sort().map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join('');
  }

  function openEditor(row) {
    var isNew = !row;
    row = row || {
      id: '',
      kind: (state.role === 'logi' ? 'shipper' : (state.mode === 'fi' ? 'blind_fund' : 'office')),
      region: (state.mode === 'fi' ? '전국' : 'CBD'),
      company: '', industry: '', role: '', case_info: '', amount: '', year: '', contact: '', title: '',
      email: '', phone: '', temp: '', centers: '', expansion: '', notes: '', source: '',
      owner: ''
    };
    var kindPairs = KINDS.filter(function (x) { return x.k !== 'all'; })
      .map(function (x) { return [x.k, x.label]; });
    if (state.role === 'logi') kindPairs = kindPairs.filter(function (p) { return p[0] === 'shipper'; });
    var regionOpts = regionsFor('all').concat(['CBD', 'GBD', 'YBD', '강남·서초·수서', '판교·분당', '서부·마곡·구로',
      '수도권 동남', '수도권 남부', '수도권 서부', '수도권 동부', '충청', '지방·전국', '전국·미확인',
      '서울 오피스', '수도권 물류·DC', '전국'])
      .filter(function (x, i, a) { return a.indexOf(x) === i; });
    var html =
      '<div class="modal-card mf-card">' +
      '<div class="modal-head"><h3>' + (isNew ? '컨택포인트 추가' : '컨택포인트 변경') + '</h3><button type="button" class="icon-btn" data-close="1" aria-label="닫기">×</button></div>' +
      '<p class="mf-hint">' + (isNew ? 'SI·화주사 담당자(컨택포인트)를 새로 등록합니다. ' : '기존 담당자 정보를 수정합니다. ') +
        '저장하면 비공개 시트 <code>investors</code>에 반영되고 목록·상세에 바로 표시됩니다.<br>펀드 상세는 <code>[펀드명] LP:… | 전략:… | 규모:… | 목표IRR:… | 지역:… | 만기:…</code> 형식으로 넣으면 🏦 FI 카드에 자동 표시됩니다.</p>' +
      '<div id="mfError" class="mf-err hidden"></div>' +
      '<div class="mf-sec">① 회사·구분</div>' +
      '<div class="mf-grid">' +
        fieldRow('구분', 'kind', row.kind, { pairs: kindPairs }) +
        fieldRow('권역', 'region', row.region, { pairs: regionOpts.map(function (x) { return [x, x]; }) }) +
        '<label class="mf mf-wide"><span>회사·기관명 <b class="mf-req">필수</b></span>' +
          '<input data-k="company" type="text" value="' + esc(row.company || '') + '" placeholder="예) ○○자산운용 · ○○물류"></label>' +
        fieldRow('업종·섹터', 'industry', row.industry) +
        fieldRow('성격·역할', 'role', row.role) +
      '</div>' +
      '<div class="mf-sec">② 컨택포인트(담당자)</div>' +
      '<div class="mf-grid">' +
        fieldRow('담당자명', 'contact', row.contact) +
        fieldRow('부서·직책', 'title', row.title) +
        fieldRow('연락처(전화)', 'phone', row.phone) +
        fieldRow('이메일', 'email', row.email) +
      '</div>' +
      '<div class="mf-sec">③ 관심도·관리 정보</div>' +
      '<div class="mf-grid">' +
        fieldRow('관심도·온도', 'temp', row.temp) +
        fieldRow('확인 센터수', 'centers', row.centers) +
        fieldRow('확장·수요 권역', 'expansion', row.expansion) +
        '<label class="mf"><span>NAI 담당자</span>' +
          '<input data-k="owner" list="mfOwnerList" type="text" value="' + esc(row.owner || '') + '" placeholder="예) 권준오 상무 — 비우면 담당 미지정">' +
          '<datalist id="mfOwnerList">' + ownerOptions() + '</datalist></label>' +
      '</div>' +
      '<div class="mf-sec">④ 상세·근거</div>' +
      '<div class="mf-grid">' +
        fieldRow('사례·펀드·전략 상세', 'case_info', row.case_info, { textarea: true, rows: 3 }) +
        fieldRow('금액·규모(억)', 'amount', row.amount) +
        fieldRow('연도', 'year', row.year) +
        fieldRow('출처', 'source', row.source) +
        '<label class="mf mf-wide"><span>메모·근거</span><textarea data-k="notes" rows="3" placeholder="미팅·통화 내용, 변경 사유 등">' + esc(row.notes || '') + '</textarea></label>' +
      '</div>' +
      '<div class="modal-foot">' +
        '<button type="button" class="btn btn-outline" data-close="1">취소</button>' +
        '<button type="button" class="btn btn-solid" id="mfSave">저장</button>' +
      '</div></div>';
    var root = $('#poolModal');
    root.innerHTML = '<div class="modal-backdrop" data-close="1"></div>' + html;
    root.classList.remove('hidden');
    root.onclick = function (e) {
      if (e.target.getAttribute && e.target.getAttribute('data-close')) { closeEditor(); }
    };
    function changeText(o) {
      return '[' + (isNew ? '컨택포인트 추가' : '컨택포인트 변경') + '] ' + (o.company || '') +
        ' / ' + kindLabel(o.kind) + ' / ' + (o.region || '') +
        '\n담당자: ' + (o.contact || '-') + ' ' + (o.title || '') +
        '\n연락처: ' + (o.phone || '-') + ' / 이메일: ' + (o.email || '-') +
        '\n관심도: ' + (o.temp || '-') + ' / NAI 담당: ' + (o.owner || '-') +
        (o.notes ? '\n메모: ' + o.notes : '') +
        '\n(id: ' + o.id + ') — 변경자: ' + roleName_();
    }
    function showErr(msg, detail) {
      var box = $('#mfError');
      if (!box) { toast(msg, true); return; }
      box.className = 'mf-err';
      var out0 = { id: row.id || '' };
      $$('#poolModal [data-k]').forEach(function (el) { out0[el.getAttribute('data-k')] = el.value.trim(); });
      box.innerHTML = '<b>' + esc(msg) + '</b>' + (detail ? '<br><span>' + esc(detail) + '</span>' : '') +
        (/권한/.test(msg) ? '<br><button type="button" class="mini-btn" id="mfCopy">📋 변경 내용 복사</button>' : '');
      var cp = $('#mfCopy');
      if (cp) cp.onclick = function () { copyText(changeText(out0), '변경 내용을 복사했습니다.'); };
      try { box.scrollIntoView({ block: 'nearest' }); } catch (e0) { /* noop */ }
    }
    $('#mfSave').onclick = function () {
      var out = { id: row.id || '' };
      $$('#poolModal [data-k]').forEach(function (el) { out[el.getAttribute('data-k')] = el.value.trim(); });
      var bad = '';
      if (!out.company) bad = '회사·기관명을 입력하세요.';
      else if (out.email && out.email.indexOf('@') < 1) bad = '이메일 형식(@)을 확인하세요.';
      else if (out.phone && out.phone !== '비공개' && String(out.phone).replace(/[^0-9]/g, '').length < 7) bad = '연락처(전화)를 확인하세요.';
      if (bad) { showErr(bad); return; }
      if (!out.id) {
        var pre = out.kind === 'blind_fund' ? 'bf' : out.kind === 'reit_foreign' ? 'rf'
          : out.kind === 'pension_lp' ? 'lp' : out.kind === 'shipper' ? 'shp' : 'off';
        out.id = 'inv-' + pre + '-' + Date.now().toString(36);
      }
      out.kind = normKind(out.kind);
      out.updated_at = ymd();
      if (!out.source) out.source = '앱 직접 입력 · ' + roleName_();
      var btn = $('#mfSave');
      if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
      saveInvestor_(out).then(function (j) {
        if (btn) { btn.disabled = false; btn.textContent = '저장'; }
        if (j && j.ok) {
          var i = state.rows.findIndex(function (r) { return r.id === out.id; });
          if (i >= 0) state.rows[i] = out; else state.rows.unshift(out);
          try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows: state.rows })); } catch (e1) { /* noop */ }
          closeEditor();
          renderChips(); render();
          toast(isNew ? '컨택포인트를 추가했습니다.' : '컨택포인트를 변경했습니다.');
        } else {
          var e = (j && j.error) ? String(j.error) : '알 수 없는 오류';
          if (isDenied_(e)) {
            showErr('이 접속 권한으로는 서버 저장이 거부되었습니다.',
              '접속 권한이 SI·화주 컨택포인트 저장을 허용하지 않았습니다(서버 응답: ' + e + '). 아래 변경 내용을 복사해 관리자에게 전달하거나, 관리자 코드로 다시 접속해 저장하세요.');
          } else {
            showErr('저장하지 못했습니다.', '서버 응답: ' + e);
          }
        }
      });
    };
  }

  function closeEditor() {
    var root = $('#poolModal');
    if (root) { root.classList.add('hidden'); root.innerHTML = ''; }
  }

  function deleteRow(id) {
    var row = state.rows.find(function (r) { return r.id === id; });
    if (!row) return;
    if (!window.confirm('“' + row.company + '” 항목을 비공개 시트(investors)에서도 삭제할까요?')) return;
    api(null, { action: 'delete', id: id }).then(function (j) {
      if (j && j.ok) {
        state.rows = state.rows.filter(function (r) { return r.id !== id; });
        delete state.sel[id];
        renderChips(); render();
        toast('삭제했습니다.');
      } else toast('삭제 실패: ' + (j && j.error ? j.error : '알 수 없는 오류'), true);
    }).catch(function () { toast('삭제 실패(네트워크)', true); });
  }

  /* ─────────────── 탭 전환 (홈 / 지도 / SI·화주 / FI / 밸류에이션) ─────────────── */
  var VIEWS = ['home', 'map', 'nai', 'lm', 'vdr', 'advise', 'match', 'pool', 'ship', 'fi', 'valuation', 'admin'];
  function showView(view) {
    if (VIEWS.indexOf(view) < 0) view = 'home';
    var home = view === 'home';
    var lmMode = view === 'lm';
    var nai = view === 'nai' || lmMode;
    var vdr = view === 'vdr';
    var adv = view === 'advise';
    var pool = view === 'pool';
    var fi = view === 'fi';
    var poolLike = pool || fi || view === 'ship';
    var val = view === 'valuation';
    var match = view === 'match';
    var adminView = view === 'admin';    /* 관리자 탭은 관리자만 — 아니면 홈으로 되돌립니다 */
    if (adminView) {
      var r0 = (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external';
      if (r0 !== 'admin') {
        if (window.naiToast) window.naiToast('관리자 전용 화면입니다.', true);
        view = 'home'; adminView = false;
        home = true;
      }
    }
    if (poolLike) setMode(view === 'ship' ? 'ship' : (fi ? 'fi' : 'si'));
    document.body.classList.toggle('view-pool', poolLike);
    document.body.classList.toggle('view-val', val);
    document.body.classList.toggle('view-nai', nai);
    document.body.classList.toggle('view-vdr', vdr);
    document.body.classList.toggle('view-advise', adv);
    document.body.classList.toggle('view-match', match);
    document.body.classList.toggle('view-admin', adminView);
    var mv = $('#matchView');
    if (mv) mv.classList.toggle('hidden', !match);
    var av = $('#adminView');
    if (av) av.classList.toggle('hidden', !adminView);
    var hv = $('#homeView');
    if (hv) hv.classList.toggle('hidden', !home);
    var nv = $('#naiView');
    if (nv) nv.classList.toggle('hidden', !nai);
    $('#poolView').classList.toggle('hidden', !poolLike);
    var vv = $('#valView');
    if (vv) vv.classList.toggle('hidden', !val);
    var dv = $('#vdrView');
    if (dv) dv.classList.toggle('hidden', !vdr);
    var advv = $('#adviseView');
    if (advv) advv.classList.toggle('hidden', !adv);
    $$('.vt-btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    var body = document.querySelector('.app-body');
    if (body) body.classList.toggle('hidden', view !== 'map');
    if (view === 'map' && window.naiMap && window.naiMap.onShow) window.naiMap.onShow();
    if (poolLike) {
      renderChips(); render();
      load();
      syncRoleFromApp();
    }
    if (val && window.NAI_VAL && window.NAI_VAL.show) window.NAI_VAL.show();
    if (match && window.NAI_MATCH && window.NAI_MATCH.show) window.NAI_MATCH.show();
    if (adminView && window.NAI_LOGS && window.NAI_LOGS.show) window.NAI_LOGS.show();
    if (home && window.NAI_HOME && window.NAI_HOME.show) window.NAI_HOME.show();
    if (nai && window.NAI_NAI && window.NAI_NAI.show) window.NAI_NAI.show(lmMode ? 'lm' : 'sale');
    if (vdr && window.NAI_VDR && window.NAI_VDR.show) window.NAI_VDR.show();
    if (adv && window.NAI_ADVISE && window.NAI_ADVISE.show) window.NAI_ADVISE.show();
    if (window.naiLog) {
      var VIEW_LABEL = { home: '홈', map: '물건 지도', nai: 'NAI 매각', lm: 'NAI 임대(LM)', vdr: '자문사 VDR', advise: '자문사 딜 프로세싱', match: 'AI 매물 매칭', pool: 'SI (사옥·전략투자)', ship: '물류센터 화주', fi: 'FI 풀', valuation: '밸류에이션', admin: '관리자' };
      window.naiLog('tab', VIEW_LABEL[view] || view);
    }
    try {
      var HASHES = { home: '#home', nai: '#nai', lm: '#lm', vdr: '#vdr', advise: '#advise', match: '#match', admin: '#admin', ship: '#ship', pool: '#pool', fi: '#fi', valuation: '#valuation' };
      history.replaceState(null, '', HASHES[view] || (location.pathname + location.search));
    } catch (e) { /* noop */ }
  }
  window.naiShowView = showView;

  function bind() {
    var tabs = $$('.vt-btn');
    if (!tabs.length) return;
    tabs.forEach(function (b) {
      b.addEventListener('click', function () { showView(b.getAttribute('data-view')); });
    });

    $('#poolKindChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kind]');
      if (!b) return;
      state.kind = b.getAttribute('data-kind');
      if (state.region !== 'ALL' && regionsFor(state.kind).indexOf(state.region) < 0) state.region = 'ALL';
      savePref(); renderChips(); render();
    });
    var sc = $('#poolStratChips');
    if (sc) {
      sc.addEventListener('click', function (e) {
        var b = e.target.closest('[data-strat]');
        if (!b) return;
        var s = b.getAttribute('data-strat');
        state.strat = (s === 'ALL' || state.strat === s) ? 'ALL' : s;
        savePref(); renderChips(); render();
      });
    }
    $('#poolRegionChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-region]');
      if (!b) return;
      var r = b.getAttribute('data-region');
      state.region = (r === 'ALL' || state.region === r) ? 'ALL' : r;
      savePref(); renderChips(); render();
    });
    var q = $('#poolSearch');
    var t = null;
    q.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { state.q = q.value; render(); }, 120);
    });
    /* Enter 로 즉시 검색 — 한글 조합 중 Enter 는 글자 확정용이라 건너뜁니다 (2026-11-27) */
    q.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(t);
      state.q = q.value;
      render();
      if (window.innerWidth <= 900) q.blur();
    });
    $('#poolOnlyEmail').addEventListener('change', function (e) {
      state.onlyEmail = e.target.checked; savePref(); render();
    });
    var fno = $('#poolFinOnly');
    if (fno) {
      fno.addEventListener('change', function (e) {
        state.finOnly = e.target.checked; savePref(); render();
      });
    }
    var fo = $('#poolFundOnly');
    if (fo) {
      fo.addEventListener('change', function (e) {
        state.fundOnly = e.target.checked; savePref(); renderChips(); render();
      });
    }
    $('#poolSelectAll').addEventListener('click', function () {
      filtered().forEach(function (r) { state.sel[r.id] = true; });
      render();
    });
    $('#poolClearSel').addEventListener('click', function () { state.sel = {}; render(); });
    $('#poolRefresh').addEventListener('click', function () { state.loaded = false; load(true); });
    var xb = $('#poolXlsx');
    if (xb) xb.addEventListener('click', downloadXlsx);
    var os = $('#poolOwnerSel');
    if (os) os.addEventListener('change', function () { state.owner = os.value || 'ALL'; render(); });
    var sie = $('#poolSiEvent');
    if (sie) sie.addEventListener('change', function () { state.siEvent = sie.value || 'ALL'; render(); });
    $('#poolAddBtn').addEventListener('click', function () {
      if (!canEdit()) { toast('읽기 전용 모드입니다.', true); return; }
      openEditor(null);
    });
    $('#poolList').addEventListener('click', function (e) {
      var chk = e.target.closest('[data-check]');
      if (chk) {
        state.sel[chk.getAttribute('data-check')] = chk.checked;
        var row = chk.closest('.pool-row');
        if (row) row.classList.toggle('is-sel', chk.checked);
        updateCompose();
        return;
      }
      var op = e.target.closest('[data-open]');
      if (op) {
        openDetail(state.rows.filter(function (r) { return r.id === op.getAttribute('data-open'); })[0]);
        return;
      }
      var ed = e.target.closest('[data-edit]');
      if (ed) {
        var id = ed.getAttribute('data-edit');
        openEditor(state.rows.find(function (r) { return r.id === id; }));
        return;
      }
      var dl = e.target.closest('[data-del]');
      if (dl) { deleteRow(dl.getAttribute('data-del')); return; }
      if (e.target.closest('a')) return;
      var r = e.target.closest('.pool-row');
      if (r && !e.target.closest('label')) {
        var box = r.querySelector('[data-check]');
        if (box) { box.checked = !box.checked; state.sel[box.getAttribute('data-check')] = box.checked; r.classList.toggle('is-sel', box.checked); updateCompose(); }
      }
    });
    $('#btnMailto').addEventListener('click', openMailto);
    $('#btnCopyEmails').addEventListener('click', copyEmails);
    $('#btnCopyRequest').addEventListener('click', copyRequest);
    $('#poolComposeToggle').addEventListener('click', function () {
      var open = $('#poolComposeFields').classList.toggle('hidden');
      this.textContent = open ? '▴ 입력칸 펼치기' : '▾ 입력칸 접기';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeEditor();
    });
  }

  function boot() {
    if (!$('#poolView')) return;
    loadPref();
    bind();
    syncModeDom();
    renderChips();
    setInterval(function () {
      if (document.body.classList.contains('view-pool')) syncRoleFromApp();
    }, 1500);
    var hash = location.hash || '';
    if (hash === '#pool') showView('pool');
    else if (hash === '#fi') showView('fi');
    else if (hash === '#ship') showView('ship');
    else if (hash === '#valuation') showView('valuation');
    else if (hash === '#match') showView('match');
    else if (hash === '#admin') showView('admin');
    else if (hash === '#lm') showView('lm');
    else if (hash === '#vdr') showView('vdr');
    else if (hash === '#nai') showView('nai');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
