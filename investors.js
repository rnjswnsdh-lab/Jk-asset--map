/* =========================================================================
   Open AI Asset Bridge (가칭) — 🤝 SI·화주 풀 / 🏦 FI 풀 (investors 시트)
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
      title: '🤝 SI·화주 풀',
      kinds: ['office', 'shipper'],
      desc: '오피스 SI · 물류 화주 — 티저 메일 발송 연계',
      searchPlaceholder: '회사 · 업종 · 사례 · 담당자 · 이메일 검색',
      composeTitle: '📧 티저 메일 발송',
      limit: 400
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

  function snapshotMode() {
    modeStore[state.mode] = {
      kind: state.kind, region: state.region, strat: state.strat,
      onlyEmail: state.onlyEmail, fundOnly: state.fundOnly, sel: state.sel
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
    var fow = $('#poolFundOnlyWrap');
    if (fow) fow.classList.toggle('hidden', !fi);
    var sc = $('#poolStratChips');
    if (sc) sc.classList.toggle('hidden', !fi);
    var ct = $('#composeTitle');
    if (ct) ct.textContent = def.composeTitle;
    var sub = $('#poolSubtitle');
    if (sub) sub.textContent = def.desc;
  }

  /* ─────────────── 환경설정 저장 ─────────────── */
  function savePref() {
    try {
      snapshotMode();
      var o = { mode: state.mode, states: {} };
      Object.keys(modeStore).forEach(function (k) {
        var m = modeStore[k];
        if (!m) return;
        o.states[k] = { kind: m.kind, region: m.region, strat: m.strat, onlyEmail: m.onlyEmail, fundOnly: m.fundOnly };
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
          onlyEmail: !!s.onlyEmail, fundOnly: !!s.fundOnly, sel: {}
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

  function canEdit() { return state.role === 'admin'; }

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
        strat: grab(b, '전략'),
        size: grab(b, '규모') || grab(b, '약정'),
        dry: grab(b, '드라이파우더'),
        irr: grab(b, '목표IRR'),
        target: cleanSep(grab(b, '대상')),
        region: cleanSep(grab(b, '지역')),
        term: grab(b, '만기').replace(/\s+/g, ' ').trim(),
        raw: b
      };
      if (f.name || f.lp || f.strat || f.size || f.dry || f.irr || f.term) out.push(f);
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
      state.role = j.role === 'readonly' ? 'readonly' : 'admin';
      state.rows = (j.investors || []).map(function (r) {
        var o = Object.assign({}, r);
        o.kind = normKind(o.kind);
        return o;
      });
      state.loaded = true;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows: state.rows })); } catch (e) { /* noop */ }
      applyRole();
      renderChips();
      render();
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
    if (badge) {
      badge.classList.remove('hidden');
      badge.textContent = canEdit() ? '관리자' : '읽기 전용';
      badge.className = 'role-chip' + (canEdit() ? '' : ' is-readonly');
    }
    var add = $('#poolAddBtn');
    if (add) add.classList.toggle('hidden', !canEdit());
  }

  /** 접속코드를 바꾸면(앱 게이트) 풀 화면 권한도 따라가도록 맞춥니다. */
  function syncRoleFromApp() {
    try {
      var r = window.naiMap && window.naiMap.state && window.naiMap.state.role;
      if (!r) return;
      var norm = r === 'readonly' ? 'readonly' : 'admin';
      if (norm !== state.role) {
        state.role = norm;
        applyRole();
        render();
      }
    } catch (e) { /* noop */ }
  }

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
  }

  function haystack(r) {
    return [r.company, r.industry, r.role, r.case_info, r.contact, r.title, r.email, r.phone,
      r.region, r.notes, r.expansion, r.temp, r.source, r.year, r.amount]
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

  function kindBadge(r) {
    var km = KIND_MAP[r.kind] || KIND_MAP.office;
    return '<span class="pr-kind ' + km.cls + '">' + esc(km.badge) + '</span>';
  }

  function contactHtml(r) {
    return '<div class="pr-contact">' +
      (r.contact ? '<span class="pc-name">👤 ' + esc(r.contact) + (r.title ? ' <span class="pc-title">' + esc(r.title) + '</span>' : '') + '</span>' : '') +
      (r.email ? '<a class="pc-mail" href="mailto:' + esc(r.email.split(',')[0].trim()) + '">✉️ ' + esc(r.email) + '</a>' : '<span class="pc-none">이메일 없음</span>') +
      (r.phone ? '<a class="pc-tel" href="tel:' + esc(r.phone.replace(/[^0-9+]/g, '')) + '">☎ ' + esc(r.phone) + '</a>' : '') +
      '</div>';
  }

  function rowActions(r) {
    return '<div class="pr-actions">' +
      '<button type="button" class="mini-btn" data-open="' + esc(r.id) + '" title="상세 보기">🔎</button>' +
      (canEdit() ? '<button type="button" class="mini-btn" data-edit="' + esc(r.id) + '">✏️</button>' +
        '<button type="button" class="mini-btn danger" data-del="' + esc(r.id) + '">🗑</button>' : '') +
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
          (r.role ? '<span class="pr-role">' + esc(r.role) + '</span>' : '') +
          (r.year ? '<span class="pr-year">' + esc(r.year) + '</span>' : '') +
          (r.amount ? '<span class="pr-amount">' + esc(r.amount) + '억</span>' : '') +
        '</div>' +
        '<div class="pr-name">' + esc(r.company) + (r.industry ? ' <span class="pr-industry">' + esc(r.industry) + '</span>' : '') + '</div>' +
        (r.case_info ? '<div class="pr-case">' + esc(r.case_info) + '</div>' : '') +
        (sub ? '<div class="pr-sub">' + esc(sub) + '</div>' : '') +
        contactHtml(r) +
      '</div>' + rowActions(r) +
      '</div>';
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
    var area = d.note.region || uniqJoin(d.funds.map(function (f) { return f.region; }), 2);
    var term = uniqJoin(d.funds.map(function (f) { return f.term; }), 2);
    if (irr) kv.push('<span class="fk fk-irr"><b>목표IRR</b>' + esc(irr) + '</span>');
    if (dry) kv.push('<span class="fk fk-dry"><b>드라이파우더</b>' + esc(dry) + '</span>');
    if (area) kv.push('<span class="fk fk-area"><b>지역</b>' + esc(area) + '</span>');
    if (term) kv.push('<span class="fk fk-term"><b>만기</b>' + esc(term) + '</span>');

    var fundLine = '';
    var named = d.funds.filter(function (f) { return f.name; });
    if (named.length) {
      fundLine = '<div class="pr-funds">' + named.slice(0, 3).map(function (f) {
        return '<span class="pr-fund">📁 ' + esc(f.name) +
          (f.lp ? ' <span class="pr-lp">LP ' + esc(f.lp) + '</span>' : '') +
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
          (r.industry ? '<span class="pr-role">' + esc(r.industry) + '</span>' : '') +
          tags +
          (r.amount ? '<span class="pr-amount">D/P ' + esc(r.amount) + '억</span>' : '') +
        '</div>' +
        '<div class="pr-name">' + esc(r.company) + (r.role ? ' <span class="pr-industry">' + esc(r.role) + '</span>' : '') + '</div>' +
        fundLine +
        (kv.length ? '<div class="pr-fundkv">' + kv.join('') + '</div>' : '') +
        contactHtml(r) +
      '</div>' + rowActions(r) +
      '</div>';
  }

  function render() {
    var rows = filtered();
    var host = $('#poolList');
    var selCount = selectedRows().length;
    var withEmail = rows.filter(function (r) { return r.email; }).length;
    var fundRows = state.mode === 'fi' ? rows.filter(function (r) { return fiData(r).funds.length; }).length : 0;
    $('#poolResultCount').textContent = rows.length + '건 · 이메일 ' + withEmail + '건' +
      (state.mode === 'fi' ? ' · 펀드정보 ' + fundRows + '건' : '');

    if (state.mode === 'fi') {
      $('#poolMeta').textContent = '블라인드펀드 ' + countByKind('blind_fund') + '건(' + countCompany('blind_fund') + '개사)' +
        ' · 리츠·해외투자사 ' + countByKind('reit_foreign') + '건(' + countCompany('reit_foreign') + '개사)' +
        ' · 연기금·LP ' + countByKind('pension_lp') + '건(' + countCompany('pension_lp') + '개사)' +
        ' — 총 ' + modeRows().length.toLocaleString('ko-KR') + '건 · 2026-11-22 기준';
    } else {
      $('#poolMeta').textContent = '오피스 SI ' + countByKind('office') + '건 · 물류 화주 ' + countByKind('shipper') + '건' +
        ' — 총 ' + modeRows().length.toLocaleString('ko-KR') + '건 · 2026-11-22 기준';
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

    body += '<div class="dc-sec"><h4>담당자</h4>' +
      (r.contact || r.email || r.phone
        ? '<div class="dc-contact">' +
          (r.contact ? '<span class="pc-name">👤 ' + esc(r.contact) + (r.title ? ' <span class="pc-title">' + esc(r.title) + '</span>' : '') + '</span>' : '') +
          (r.email ? '<a class="pc-mail" href="mailto:' + esc(r.email.split(',')[0].trim()) + '">✉️ ' + esc(r.email) + '</a>' : '<span class="pc-none">이메일 없음</span>') +
          (r.phone ? '<a class="pc-tel" href="tel:' + esc(r.phone.replace(/[^0-9+]/g, '')) + '">☎ ' + esc(r.phone) + '</a>' : '') +
          '</div>'
        : '<div class="dc-none">등록된 담당자 없음</div>') +
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
          if (f.strat) rows.push(['전략', f.strat]);
          if (f.size) rows.push(['규모·약정', f.size]);
          if (f.dry) rows.push(['드라이파우더', f.dry]);
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

  function openEditor(row) {
    var isNew = !row;
    row = row || {
      id: '', kind: (state.mode === 'fi' ? 'blind_fund' : 'office'), region: (state.mode === 'fi' ? '전국' : 'CBD'),
      company: '', industry: '', role: '', case_info: '', amount: '', year: '', contact: '', title: '',
      email: '', phone: '', temp: '', centers: '', expansion: '', notes: '', source: ''
    };
    var kindPairs = KINDS.filter(function (x) { return x.k !== 'all'; })
      .map(function (x) { return [x.k, x.label]; });
    var regionOpts = regionsFor('all').concat(['CBD', 'GBD', 'YBD', '강남·서초·수서', '판교·분당', '서부·마곡·구로',
      '수도권 동남', '수도권 남부', '수도권 서부', '수도권 동부', '충청', '지방·전국', '전국·미확인',
      '서울 오피스', '수도권 물류·DC', '전국'])
      .filter(function (x, i, a) { return a.indexOf(x) === i; });
    var html =
      '<div class="modal-card mf-card">' +
      '<div class="modal-head"><h3>' + (isNew ? '대상 추가' : '대상 수정') + '</h3><button type="button" class="icon-btn" data-close="1" aria-label="닫기">×</button></div>' +
      '<p class="mf-hint">펀드 정보는 <code>사례·펀드·전략 상세</code>에 <code>[펀드명] LP:… | 전략:… | 규모:… | 드라이파우더:… | 목표IRR:… | 지역:… | 만기:…</code> 형식으로 넣으면 🏦 FI 풀 카드·상세에 자동으로 표시됩니다.</p>' +
      '<div class="mf-grid">' +
        fieldRow('분류', 'kind', row.kind, { pairs: kindPairs }) +
        fieldRow('권역', 'region', row.region, { pairs: regionOpts.map(function (x) { return [x, x]; }) }) +
        fieldRow('회사·운용사·기관명', 'company', row.company) +
        fieldRow('업종·섹터·전략', 'industry', row.industry) +
        fieldRow('성격·역할', 'role', row.role) +
        fieldRow('사례·펀드·전략 상세', 'case_info', row.case_info, { textarea: true, rows: 4 }) +
        fieldRow('금액·규모(억)', 'amount', row.amount) +
        fieldRow('연도', 'year', row.year) +
        fieldRow('담당자', 'contact', row.contact) +
        fieldRow('부서·직함', 'title', row.title) +
        fieldRow('이메일', 'email', row.email) +
        fieldRow('전화', 'phone', row.phone) +
        fieldRow('온도대(물류)', 'temp', row.temp) +
        fieldRow('확인 센터수', 'centers', row.centers) +
        fieldRow('확장·수요 권역', 'expansion', row.expansion) +
        fieldRow('비고·근거', 'notes', row.notes, { textarea: true, rows: 3 }) +
        fieldRow('출처', 'source', row.source) +
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
    $('#mfSave').onclick = function () {
      var out = { id: row.id || '' };
      $$('#poolModal [data-k]').forEach(function (el) { out[el.getAttribute('data-k')] = el.value.trim(); });
      if (!out.id) {
        var pre = out.kind === 'blind_fund' ? 'bf' : out.kind === 'reit_foreign' ? 'rf'
          : out.kind === 'pension_lp' ? 'lp' : out.kind === 'shipper' ? 'shp' : 'off';
        out.id = 'inv-' + pre + '-' + Date.now().toString(36);
      }
      if (!out.company) { toast('회사·기관명을 입력하세요.', true); return; }
      out.updated_at = new Date().toISOString().slice(0, 10);
      api(null, { action: 'upsert', investors: [out] }).then(function (j) {
        if (j && j.ok) {
          out.kind = normKind(out.kind);
          var i = state.rows.findIndex(function (r) { return r.id === out.id; });
          if (i >= 0) state.rows[i] = out; else state.rows.unshift(out);
          closeEditor();
          renderChips(); render();
          toast('저장했습니다.');
        } else {
          toast('저장 실패: ' + (j && j.error ? j.error : '알 수 없는 오류'), true);
        }
      }).catch(function () { toast('저장 실패(네트워크)', true); });
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

  /* ─────────────── 탭 전환 (지도 / SI·화주 / FI / 밸류에이션) ─────────────── */
  var VIEWS = ['map', 'pool', 'fi', 'valuation'];
  function showView(view) {
    if (VIEWS.indexOf(view) < 0) view = 'map';
    var pool = view === 'pool';
    var fi = view === 'fi';
    var poolLike = pool || fi;
    var val = view === 'valuation';
    if (poolLike) setMode(fi ? 'fi' : 'si');
    document.body.classList.toggle('view-pool', poolLike);
    document.body.classList.toggle('view-val', val);
    $('#poolView').classList.toggle('hidden', !poolLike);
    var vv = $('#valView');
    if (vv) vv.classList.toggle('hidden', !val);
    $$('.vt-btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    var body = document.querySelector('.app-body');
    if (body) body.classList.toggle('hidden', view !== 'map');
    if (poolLike) {
      renderChips(); render();
      load();
      syncRoleFromApp();
    }
    if (val && window.NAI_VAL && window.NAI_VAL.show) window.NAI_VAL.show();
    try {
      history.replaceState(null, '', pool ? '#pool' : (fi ? '#fi' : (val ? '#valuation' : location.pathname + location.search)));
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
    $('#poolOnlyEmail').addEventListener('change', function (e) {
      state.onlyEmail = e.target.checked; savePref(); render();
    });
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
    else if (hash === '#valuation') showView('valuation');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
