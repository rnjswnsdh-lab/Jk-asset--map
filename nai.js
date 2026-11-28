/* =========================================================================
   Open AI Asset Bridge — 🏢 NAI 매각·LM 탭 (2026-11-24 신설)
   -------------------------------------------------------------------------
   · assets 시트에서 source 가 'NAI 매각·LM' 으로 시작하는 물건만 모아 보여 줍니다.
     (지도 탭의 '물건 구분 → 🏢 NAI 매각·LM' 칩과 같은 기준)
   · 매각 IM/Flyer·LM Flyer 로 확보한 물건 + 월요회의·팀장회의 자료를 연결합니다.
   · 🔒 팀장회의·월간회의 기록은 이 화면에 넣지 않습니다 (2026-11-27 분리).
     매각·임대 목록에 회의록이 섞이지 않도록, 회의록은 별도 행정 탭(adminhq.js, `admin` 시트)에서만 봅니다.
     물건 카드의 🔒 '팀장회의 N' 배지에 쓰는 색인(window.NAI_TEAM)은 adminhq.js가 만듭니다.
     이 파일에는 팀장회의 내용이 한 줄도 들어 있지 않습니다.
   ========================================================================= */
(function () {
  'use strict';

  var TAG = 'NAI 매각·LM';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var CFG = window.NAI_MAP_CONFIG || {};
  var SYNC_URL = CFG.SYNC_URL || '';

  var S = {
    q: '', kind: 'ALL', sector: 'ALL', sort: 'kind', mode: 'sale', lm: 'ALL',
    open: {}
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }
  function assets() {
    var st = window.naiMap && window.naiMap.state;
    return (st && st.assets) ? st.assets : [];
  }
  function token() {
    try { return localStorage.getItem((CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1') || ''; } catch (e) { return ''; }
  }
  function apiGet(qs) {
    if (!SYNC_URL) return Promise.reject(new Error('no_sync'));
    var u = SYNC_URL + (SYNC_URL.indexOf('?') < 0 ? '?' : '&') + qs + '&token=' + encodeURIComponent(token());
    return fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function toast(msg, err) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.background = err ? '#b3262c' : '';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.add('hidden'); el.style.background = ''; }, 3000);
  }

  function isNai(a) { return !!a && String(a.source || '').indexOf(TAG) === 0; }
  function fact(a, label) {
    var fs = (a && a.facts) || [];
    for (var i = 0; i < fs.length; i++) if (String(fs[i].label) === label) return String(fs[i].value || '');
    return '';
  }
  /** 임대(LM) 물건의 진행상태 — 매각과 달리 임차인 모집/임대 진행/임대 완료로 표시 */
  function lmStatus(a) {
    var s = String((a && a.status) || '') + ' ' + fact(a, 'NAI 상태') + ' ' + fact(a, '임대');
    if (/임대\s*완료|만실|계약\s*완료|100%/.test(s)) return '임대 완료';
    if (/보류|철회|중단|중지/.test(s)) return '임대 보류';
    if (/임대\s*진행|임대\s*중|협의\s*중|계약\s*진행|오퍼/.test(s)) return '임대 진행 중';
    return '임차인 모집 중';
  }
  function isLm(a) { var k = naiKind(a); return k === 'LM' || k === '매각·LM'; }
  function isSale(a) { var k = naiKind(a); return k === '매각' || k === '매각·LM' || k === '개발'; }
  function naiKind(a) {
    var k = String(fact(a, 'NAI 구분') || '');
    if (!k) return '매각';
    if (/참고/.test(k)) return '참고';
    if (/개발|투자제안/.test(k)) return '개발';
    var hasLm = /LM|임대|임차/.test(k);
    var hasSale = /매각|매도/.test(k);
    if (hasLm && hasSale) return '매각·LM';
    if (hasLm) return 'LM';
    return '매각';
  }
  var SECTOR_LABEL = {
    hotel: '호텔', logistics: '물류', office: '오피스', datacenter: '데이터센터',
    retail: '리테일', living: '리빙', land: '토지·개발', shipper: '화주'
  };
  function sectorLabel(k) { return SECTOR_LABEL[k] || k || '기타'; }

  /* ───────────── 필터 ───────────── */
  function list() {
    var q = S.q.trim().toLowerCase();
    return assets().filter(isNai).filter(function (a) {
      if (S.mode === 'lm') { if (!isLm(a)) return false; }
      else { if (naiKind(a) === 'LM') return false; }
      if (S.mode === 'lm') {
        if (S.lm !== 'ALL' && lmStatus(a) !== S.lm) return false;
      } else if (S.kind !== 'ALL' && naiKind(a) !== S.kind) return false;
      if (S.sector !== 'ALL' && a.sector !== S.sector) return false;
      if (!q) return true;
      var hay = [a.name, a.address, a.owner_amc, a.tenants, a.notes, a.scale_info, a.price_info, a.sub_type, a.region]
        .concat((a.facts || []).map(function (f) { return f.label + ' ' + f.value; })).join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    }).sort(function (x, y) {
      if (S.sort === 'kind') {
        var order = { '매각': 1, '매각·LM': 2, 'LM': 3, '개발': 4, '참고': 9 };
        var d = (order[naiKind(x)] || 5) - (order[naiKind(y)] || 5);
        if (d) return d;
      }
      if (S.sort === 'price') {
        var px = parseFloat(String(x.price_info || '').replace(/[^\d.]/g, '')) || 0;
        var py = parseFloat(String(y.price_info || '').replace(/[^\d.]/g, '')) || 0;
        if (px !== py) return py - px;
      }
      return String(x.name || '').localeCompare(String(y.name || ''), 'ko');
    });
  }

  /* ───────────── 렌더 ───────────── */
  function headerHTML(all) {
    var sale = all.filter(function (a) { var k = naiKind(a); return k === '매각' || k === '매각·LM' || k === '개발'; }).length;
    var lm = all.filter(function (a) { var k = naiKind(a); return k === 'LM' || k === '매각·LM'; }).length;
    var ref = all.filter(function (a) { return naiKind(a) === '참고'; }).length;
    var lmMode = S.mode === 'lm';
    var hire = all.filter(function (a) { return isLm(a) && lmStatus(a) === '임차인 모집 중'; }).length;
    return '<div class="nai-head"><div class="nai-title"><h2>' + (lmMode ? '🔑 NAI 임대(LM)' : '🏷️ NAI 매각') + '</h2>' +
      '<p>' + (lmMode
        ? 'NAI Korea 가 임대(LM)를 맡은 물건입니다. 임대면적·임대료·입주 시점을 그대로 담았고, 진행상태는 <b>임차인 모집 중 · 임대 진행 중 · 임대 완료</b>로 구분합니다.'
        : 'NAI Korea 가 실제로 매각을 주관하는 물건입니다. 매각안내문(IM)·Flyer 로 확보한 스펙과 가격을 그대로 담았고, 물건을 누르면 섹터별 밸류에이션 계산기가 열립니다.') + '</p>' +
      '<p class="nai-meta">' + (lmMode
        ? 'LM ' + lm + '건 — 임차인 모집 중 ' + hire + '건 · 임대 진행 중 ' + all.filter(function (a) { return isLm(a) && lmStatus(a) === '임대 진행 중'; }).length + '건 · 임대 완료 ' + all.filter(function (a) { return isLm(a) && lmStatus(a) === '임대 완료'; }).length + '건'
        : '매각·개발 ' + sale + '건' + (ref ? ' · 참고 ' + ref + '건' : '')) +
      ' · 자료 2026-11-24 동기화</p></div>' +
      '<div class="nai-tools">' +
      '<button type="button" class="btn btn-ghost" id="naiSwitch">' + (lmMode ? '🏷️ 매각 탭으로' : '🔑 임대(LM) 탭으로') + '</button>' +
      '<label class="nai-search"><span aria-hidden="true">⌕</span><input id="naiSearch" type="search" data-enter="search" placeholder="물건명 · 주소 · 매도인 검색" value="' + esc(S.q) + '"></label>' +
      '<button type="button" class="btn btn-ghost" id="naiRefresh">↻ 새로고침</button>' +
      '</div></div>';
  }

  function chipsHTML() {
    if (S.mode === 'lm') {
      var lmKinds = [['ALL', '전체'], ['임차인 모집 중', '임차인 모집 중'], ['임대 진행 중', '임대 진행 중'], ['임대 완료', '임대 완료'], ['임대 보류', '임대 보류']];
      var lmSectors = ['ALL'].concat(Object.keys(SECTOR_LABEL).filter(function (k) {
        return assets().some(function (a) { return isNai(a) && isLm(a) && a.sector === k; });
      }));
      return '<div class="nai-filters">' +
        '<div class="chip-wrap">' + lmKinds.map(function (k) {
          return '<button type="button" class="pf-chip lm-chip' + (S.lm === k[0] ? ' on' : '') + '" data-nai-lm="' + k[0] + '">' + k[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="chip-wrap">' + lmSectors.map(function (k) {
          return '<button type="button" class="pf-chip' + (S.sector === k ? ' on' : '') + '" data-nai-sector="' + k + '">' + (k === 'ALL' ? '섹터 전체' : sectorLabel(k)) + '</button>';
        }).join('') + '</div>' +
        '<span class="nai-sort">정렬 <button type="button" class="mini-btn' + (S.sort === 'kind' ? ' on' : '') + '" data-nai-sort="kind">구분</button>' +
        '<button type="button" class="mini-btn' + (S.sort === 'price' ? ' on' : '') + '" data-nai-sort="price">가격</button>' +
        '<button type="button" class="mini-btn' + (S.sort === 'name' ? ' on' : '') + '" data-nai-sort="name">이름</button></span></div>';
    }
    var kinds = [['ALL', '전체'], ['매각', '매각'], ['개발', '개발'], ['참고', '참고자료']];
    var sectors = ['ALL'].concat(Object.keys(SECTOR_LABEL).filter(function (k) {
      return assets().some(function (a) { return isNai(a) && a.sector === k; });
    }));
    return '<div class="nai-filters">' +
      '<div class="chip-wrap">' + kinds.map(function (k) {
        return '<button type="button" class="pf-chip' + (S.kind === k[0] ? ' on' : '') + '" data-nai-kind="' + k[0] + '">' + k[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="chip-wrap">' + sectors.map(function (k) {
        return '<button type="button" class="pf-chip' + (S.sector === k ? ' on' : '') + '" data-nai-sector="' + k + '">' + (k === 'ALL' ? '섹터 전체' : sectorLabel(k)) + '</button>';
      }).join('') + '</div>' +
      '<span class="nai-sort">정렬 <button type="button" class="mini-btn' + (S.sort === 'kind' ? ' on' : '') + '" data-nai-sort="kind">구분</button>' +
      '<button type="button" class="mini-btn' + (S.sort === 'price' ? ' on' : '') + '" data-nai-sort="price">가격</button>' +
      '<button type="button" class="mini-btn' + (S.sort === 'name' ? ' on' : '') + '" data-nai-sort="name">이름</button></span>' +
      '</div>';
  }

  function cardHTML(a) {
    var kind = naiKind(a);
    var tcount = (window.NAI_TEAM && window.NAI_TEAM.byAsset[a.id]) || 0;
    var facts = (a.facts || []).filter(function (f) {
      return ['NAI 구분', 'NAI 상태'].indexOf(String(f.label)) < 0 && String(f.label).indexOf('§') !== 0;
    });
    var key = ['규모', '희망매각가', '가격', '임대조건', '투자 구조', '매각가', '임차·운영', '도입', ' 컨버전 규모', '재분석 결론', '공시지가', '개별공시지가', '부지', '개발', '모집 규모'];
    var picks = [];
    key.forEach(function (lbl) {
      var v = fact(a, lbl);
      if (v && picks.length < 4) picks.push([lbl, v]);
    });
    var rows = picks.map(function (r) {
      return '<div class="nc-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>';
    }).join('');
    var dual = isLm(a) && /매각/.test(String(a.status || ''));   /* 매각·임대 병행 (예: 수연타워) */
    var lmBadge = isLm(a) ? '<span class="nc-lm lm-' + esc(dual ? '매각·임대 병행' : lmStatus(a).replace(/\s/g, '')) + '">' + esc(dual ? '🏷️ 매각·임대 병행' : lmStatus(a)) + '</span>' : '';
    return '<article class="nai-card' + (kind === '참고' ? ' is-ref' : '') + (isLm(a) ? ' is-lm' : '') + '" data-nai-card="' + esc(a.id) + '">' +
      '<div class="nc-top"><span class="nc-kind ' + esc(kind.replace('·', '')) + '">' + esc(kind) + '</span>' + lmBadge +
      '<span class="nc-sector">' + esc(sectorLabel(a.sector)) + '</span>' +
      (tcount ? '<span class="nc-team" title="팀장회의에서 다룬 물건">🔒 팀장회의 ' + tcount + '</span>' : '') +
      '</div>' +
      '<h3 class="nc-name">' + esc(a.name) + '</h3>' +
      '<p class="nc-addr">' + esc(a.address || '') + '</p>' +
      '<div class="nc-rows">' + rows + '</div>' +
      '<p class="nc-state">' + esc(isLm(a) ? (dual ? (a.status || '임대 중 · 매각 중') : lmStatus(a) + (a.status ? ' · ' + a.status : '')) : (a.status || '')) + '</p>' +
      '<div class="nc-foot">' + esc(a.owner_amc || '') + '</div>' +
      '<div class="nc-acts">' +
      '<button type="button" class="mini-btn act" data-nai-val="' + esc(a.id) + '">📊 밸류에이션</button>' +
      '<button type="button" class="mini-btn act" data-nai-im="' + esc(a.id) + '">📘 IM 프리뷰</button>' +
      '<button type="button" class="mini-btn act" data-nai-map="' + esc(a.id) + '">🗺 지도</button>' +
      '<button type="button" class="mini-btn act" data-nai-open="' + esc(a.id) + '">상세</button>' +
      '</div></article>';
  }

  function render() {
    var host = $('#naiView');
    if (!host) return;
    var all = assets().filter(isNai);
    var items = list();
    var html = '<div class="nai-shell">' + headerHTML(all) + chipsHTML();
    if (!all.length) {
      html += '<div class="empty-state">NAI 매각·LM 물건을 불러오는 중입니다. 데이터가 없으면 <b>↻ 새로고침</b>을 눌러 주세요.</div>';
    } else if (!items.length) {
      html += '<div class="empty-state">조건에 맞는 물건이 없습니다.</div>';
    } else {
      html += '<div class="nai-count">' + items.length + '건</div><div class="nai-grid">' + items.map(cardHTML).join('') + '</div>';
    }
    html += '</div>';
    host.innerHTML = html;
    bind();
  }

  function bind() {
    var host = $('#naiView');
    if (!host) return;
    var q = $('#naiSearch');
    if (q) {
      var t = null;
      /* 검색어 반영 — 입력하면 180ms 뒤, Enter 면 바로 (한글 조합 중 Enter 는 건너뜀) */
      function commitQuery(blur) {
        clearTimeout(t);
        t = null;
        S.q = q.value;
        render();
        var n = $('#naiSearch');
        if (n) {
          try { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } catch (e1) { /* noop */ }
          if (blur) n.blur();
        }
      }
      q.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () { commitQuery(false); }, 180);
      });
      q.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        e.stopPropagation();
        commitQuery(window.innerWidth <= 900);
      });
    }
    var rf = $('#naiRefresh');
    if (rf) rf.addEventListener('click', function () { if (window.naiMap && window.naiMap.reload) window.naiMap.reload(); render(); });
    var sw = $('#naiSwitch');
    if (sw) sw.addEventListener('click', function () { setMode(S.mode === 'lm' ? 'sale' : 'lm'); });
    host.addEventListener('click', function (e) {
      var k = e.target.closest('[data-nai-kind]');
      if (k) { S.kind = k.getAttribute('data-nai-kind'); render(); return; }
      var lmc = e.target.closest('[data-nai-lm]');
      if (lmc) { S.lm = lmc.getAttribute('data-nai-lm'); render(); return; }
      var sc = e.target.closest('[data-nai-sector]');
      if (sc) { S.sector = sc.getAttribute('data-nai-sector'); render(); return; }
      var so = e.target.closest('[data-nai-sort]');
      if (so) { S.sort = so.getAttribute('data-nai-sort'); render(); return; }
      var val = e.target.closest('[data-nai-val]');
      if (val) { openVal(val.getAttribute('data-nai-val')); return; }
      var im = e.target.closest('[data-nai-im]');
      if (im) { openIm(im.getAttribute('data-nai-im')); return; }
      var mp = e.target.closest('[data-nai-map]');
      if (mp) { gotoMap(mp.getAttribute('data-nai-map')); return; }
      var op = e.target.closest('[data-nai-open]');
      if (op) { gotoDetail(op.getAttribute('data-nai-open')); return; }
      var card = e.target.closest('[data-nai-card]');
      if (card) { gotoDetail(card.getAttribute('data-nai-card')); }
    });
    var modal = $('#poolModal');
    if (modal && !modal._naiBound) {
      modal._naiBound = true;
      modal.addEventListener('click', function (e) {
        if (e.target === modal || e.target.closest('[data-close-modal]')) modal.classList.add('hidden');
      });
    }
  }

  function byId(id) { return assets().filter(function (a) { return a.id === id; })[0] || null; }
  function openVal(id) {
    var a = byId(id);
    if (!a) return;
    if (window.NAI_VAL && window.NAI_VAL.openForAsset) window.NAI_VAL.openForAsset(a);
  }
  function openIm(id) {
    var a = byId(id);
    if (!a) return;
    if (window.NAI_HOME && window.NAI_HOME.brief) window.NAI_HOME.brief(a.id, 'IM');
    else toast('IM 미리보기를 불러오지 못했습니다.', true);
  }
  function gotoMap(id) {
    if (window.naiShowView) window.naiShowView('map');
    if (window.naiMap && window.naiMap.select) window.naiMap.select(id);
  }
  function gotoDetail(id) { gotoMap(id); }

  function setMode(mode) {
    S.mode = (mode === 'lm') ? 'lm' : 'sale';
    S.kind = 'ALL';
    S.lm = 'ALL';
    render();
  }

  function show(mode) {
    if (mode === 'lm' || mode === 'sale') S.mode = mode;
    render();
  }

  /** 권한 변경 시 호출 — 매각·임대 화면만 다시 그린다(회의록은 별도 행정 탭 소관) */
  function reset() {
    var host = $('#naiView');
    if (host && !host.classList.contains('hidden')) render();
  }

  window.NAI_NAI = { show: show, setMode: setMode, reset: reset, state: S, isNai: isNai, lmStatus: lmStatus, team: function () { return (window.NAI_TEAM && window.NAI_TEAM.items) || []; } };

})();
