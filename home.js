/* =========================================================================
   Open AI Asset Bridge (가칭) — home.js  (🏠 딜 브릿지 홈, 2026-11-23)
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

  var BOOT = { homeOpened: false, articles: [], notices: [], loaded: false, subs: {} };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function me() { return (window.naiMap && window.naiMap.me) ? window.naiMap.me() : null; }
  function isAdmin() { return role() === 'admin'; }

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

  /* ─────────────────── 홈 렌더 ─────────────────── */
  function renderShell() {
    var host = $('#homeView');
    if (!host) return;
    var st = window.naiMap && window.naiMap.state;
    var all = assets();
    var auc = all.filter(isAuction);
    var liveAuc = auc.filter(function (a) { var d = daysUntil(fact(a, '입찰일')); return d !== null && d >= 0; });
    var nego = auc.filter(function (a) { return /수의계약/.test(fact(a, '입찰일') + String(a.status || '')); });
    var sale = all.filter(function (a) { return !isAuction(a) && isOnSale(a); });
    var meNow = me();

    var html = '';
    html += '<div class="home-hero">';
    html += '<div class="hh-left">';
    html += '<p class="hh-kicker">NAI Korea · 딜 브릿지</p>';
    html += '<h1 class="hh-title">오늘의 <b>딜 브릿지</b></h1>';
    html += '<p class="hh-sub">매각 물건 · 입찰 D-Day · 아티클 · 물건등록 · 의향서/대출 · TM·IM 제작을 한 화면에서.</p>';
    html += '<p class="hh-meta">' + (st && st.meta && st.meta.source ? esc(st.meta.source) : '비공개 시트 연동') +
      ' · 기준 ' + esc(todayStr()) + (meNow && meNow.name ? ' · ' + esc(meNow.name) : '') + '</p>';
    html += '</div>';
    html += '<div class="hh-kpis">';
    html += kpi('물건 DB', (all.length || 0).toLocaleString('ko-KR') + '건', '전 섹터', '');
    html += kpi('매각중', (sale.length || 0).toLocaleString('ko-KR') + '건', '일반 매각·검토', 'sale');
    html += kpi('경·공매', (auc.length || 0).toLocaleString('ko-KR') + '건', '입찰임박 ' + liveAuc.length + ' · 수의계약 ' + nego.length, 'auc');
    html += kpi('아티클', (BOOT.articles.length ? BOOT.articles.length + '건' : '—'), '매일 08:00 업데이트', 'art');
    html += '</div></div>';

    html += '<div class="home-grid">';

    /* ① 매각중인 물건 · D-Day */
    html += '<section class="home-card hc-deals" id="hcDeals">';
    html += '<div class="hc-head"><h2>🔥 매각중인 물건 <span class="hc-tag">입찰 D-Day · 수의계약</span></h2>' +
      '<div class="hc-tools"><button type="button" class="mini-btn" data-home="more-auction">경·공매 전체</button>' +
      '<button type="button" class="mini-btn" data-home="more-sale">매각 물건 전체</button></div></div>';
    html += '<div id="dealStrip" class="deal-strip"></div>';
    html += '</section>';

    /* ② 빠른 실행 타일 */
    html += '<section class="home-card hc-quick">';
    html += '<div class="hc-head"><h2>⚡ 바로 하기</h2></div>';
    html += '<div class="quick-grid">';
    html += tile('🔍', '물건검색', '섹터·권역·가격·키워드', 'search');
    html += tile('🤖', 'AI 매물 매칭', '문장으로 조건 검색', 'match');
    html += tile('➕', '물건등록', 'TM / IM / 직접 입력', 'register');
    html += tile('📝', '인수·임차의향서', '매입·임차 조건 제출', 'loi');
    html += tile('📋', 'TR 임차의뢰', '화주·임차인 희망조건 접수', 'tr');
    html += tile('💰', '대출요청·조건제시', '금액·LTV·금리·만기', 'loan');
    html += tile('📄', 'TM 제작', 'NAI 양식 티저·브리프', 'tm');
    html += tile('📘', 'IM 제작', 'NAI 양식 IM 브리프', 'im');
    html += '</div></section>';

    /* ③ 물건검색 */
    html += '<section class="home-card hc-search" id="hcSearch">';
    html += '<div class="hc-head"><h2>🔍 물건검색</h2><span class="hc-hint">결과를 누르면 지도·상세로 이동합니다</span></div>';
    html += '<div class="hs-form">';
    html += '<input id="hsQ" type="search" placeholder="건물명 · 주소 · 운용사 · 임차인 검색" autocomplete="off">';
    html += '<select id="hsSector"><option value="ALL">전체 섹터</option></select>';
    html += '<select id="hsDeal"><option value="ALL">일반+경공매</option><option value="general">일반 자산</option><option value="auction">경·공매</option></select>';
    html += '<select id="hsRegion"><option value="ALL">전체 권역</option></select>';
    html += '<select id="hsPrice"><option value="ALL">가격 전체</option><option value="0-300">300억 미만</option><option value="300-1000">300~1,000억</option><option value="1000-3000">1,000~3,000억</option><option value="3000-">3,000억 이상</option><option value="none">가격 미상</option></select>';
    html += '<button type="button" class="btn btn-solid" data-home="do-search">검색</button>';
    html += '</div>';
    html += '<div id="hsResult" class="hs-result"><p class="hs-empty">조건을 선택하고 <b>검색</b>을 누르세요. (전체 ' + all.length.toLocaleString('ko-KR') + '건)</p></div>';
    html += '</section>';

    /* ④ 아티클 */
    html += '<section class="home-card hc-articles" id="hcArticles">';
    html += '<div class="hc-head"><h2>📰 아티클</h2><span class="hc-hint">매일 오전 8시 · 전일 딜/후속 진척</span></div>';
    html += '<div id="artList" class="art-list"><p class="hs-empty">불러오는 중…</p></div>';
    if (isAdmin()) html += '<div class="hc-foot"><button type="button" class="mini-btn" data-home="art-new">＋ 아티클 등록</button></div>';
    html += '</section>';

    /* ⑤ 공지사항 */
    html += '<section class="home-card hc-notices" id="hcNotices">';
    html += '<div class="hc-head"><h2>📢 공지사항</h2></div>';
    html += '<div id="notiList" class="noti-list"><p class="hs-empty">불러오는 중…</p></div>';
    if (isAdmin()) html += '<div class="hc-foot"><button type="button" class="mini-btn" data-home="noti-new">＋ 공지 등록</button></div>';
    html += '</section>';

    /* ⑥ 관리자: 접수 내역 */
    if (isAdmin()) {
      html += '<section class="home-card hc-subs" id="hcSubs">';
      html += '<div class="hc-head"><h2>📥 접수 내역</h2><span class="hc-hint">관리자만 조회</span></div>';
      html += '<div class="subs-grid">';
      html += subBox('의향서', 'lois', '📝');
      html += subBox('대출요청·조건', 'loans', '💰');
      html += subBox('TM·IM 제작요청', 'doc_requests', '📄');
      html += subBox('물건 등록제안', 'proposals', '➕');
      html += '</div></section>';
    }

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
    renderArticles();
    renderNotices();
    if (isAdmin()) renderSubs();
  }

  function kpi(label, value, sub, key) {
    return '<div class="kpi kpi-' + (key || 'x') + '"' + (key ? ' data-kpi="' + key + '"' : '') + '><span class="kpi-k">' + esc(label) + '</span>' +
      '<strong class="kpi-v">' + esc(value) + '</strong><span class="kpi-s">' + esc(sub) + '</span></div>';
  }
  function tile(icon, title, sub, act) {
    return '<button type="button" class="qtile" data-home="' + act + '"><span class="qti">' + icon + '</span>' +
      '<span class="qtt">' + esc(title) + '</span><span class="qts">' + esc(sub) + '</span></button>';
  }
  function subBox(label, kind, icon) {
    var n = BOOT.subs[kind] == null ? '—' : BOOT.subs[kind];
    return '<button type="button" class="subbox" data-home="subs" data-kind="' + kind + '">' +
      '<span class="sb-i">' + icon + '</span><span class="sb-k">' + esc(label) + '</span>' +
      '<strong class="sb-v" data-sub-count="' + kind + '">' + esc(String(n)) + '</strong></button>';
  }

  /* ── 매각중 물건 스트립 ── */
  function renderDealStrip() {
    var host = $('#dealStrip');
    if (!host) return;
    var all = assets();
    var auc = all.filter(function (a) { return isAuction(a); });
    var scored = auc.map(function (a) {
      var n = daysUntil(fact(a, '입찰일'));
      return { a: a, n: (n === null ? 9999 : (n < 0 ? 10000 - Math.abs(n) : n)) };
    }).sort(function (x, y) { return x.n - y.n; }).slice(0, 14);

    var sale = all.filter(function (a) { return !isAuction(a) && isOnSale(a); })
      .sort(function (a, b) { return (parseEok(b.price_info) || 0) - (parseEok(a.price_info) || 0); })
      .slice(0, 8);

    var html = '';
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
      html += '<h3 class="strip-h">🏢 일반 매각 · 검토 물건</h3><div class="cards-row">';
      sale.forEach(function (a) {
        html += '<button type="button" class="deal-card" data-home="open-asset" data-id="' + esc(a.id) + '">' +
          '<span class="dc-badge gen">' + esc(a.status_group || '매각') + '</span>' +
          '<span class="dc-sector" style="color:' + sectorColor(a.sector) + '">' + esc(sectorLabel(a.sector)) + '</span>' +
          '<strong class="dc-name">' + esc(a.name) + '</strong>' +
          '<span class="dc-addr">' + esc(a.address || '') + '</span>' +
          '<span class="dc-price">' + esc(eokText(a) || a.price_info || '가격 미상') + '</span>' +
          '<span class="dc-date">' + esc(a.status || '') + '</span></button>';
      });
      html += '</div>';
    }
    if (!html) html = '<p class="hs-empty">표시할 매각 물건이 없습니다.</p>';
    host.innerHTML = html;
  }

  /* ── 아티클 ── */
  function renderArticles() {
    var host = $('#artList');
    if (!host) return;
    if (!BOOT.loaded) { host.innerHTML = '<p class="hs-empty">불러오는 중…</p>'; return; }
    var list = BOOT.articles.slice(0, 8);
    if (!list.length) {
      host.innerHTML = '<p class="hs-empty">아직 등록된 아티클이 없습니다.<br>매일 오전 8시에 전일 부동산 딜 아티클이 올라옵니다.</p>';
      return;
    }
    host.innerHTML = list.map(function (a, i) {
      return '<button type="button" class="art-item" data-home="open-article" data-idx="' + i + '">' +
        '<span class="ai-date">' + esc(a.date || '') + '</span>' +
        '<span class="ai-title">' + esc(a.title || '(제목 없음)') + '</span>' +
        '<span class="ai-sum">' + esc(a.summary || '').slice(0, 140) + '</span></button>';
    }).join('');
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
      BOOT.notices = (res[1] && res[1].items) || [];
      BOOT.loaded = true;
      renderArticles();
      renderNotices();
      var kv = $('[data-kpi="art"] .kpi-v');
      if (kv) kv.textContent = BOOT.articles.length ? BOOT.articles.length + '건' : '—';
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

  function imDeckHTML(a) {
    var fs = factsOf(a);
    var highlights = [];
    [['투자 구조', '수익 구조'], ['컨버전 규모', '업사이드'], ['관광 수요', '수요 기반'], ['입지', '입지'], ['재분석 결론', '검토 결론'], ['매각 조건', '매각 조건'], ['개발', '개발 계획'], ['임차·운영', '운영 구조'], ['특화', '특화'], ['운영', '운영 구조']].forEach(function (p) {
      if (highlights.length >= 3) return;
      var v = factBy(a, new RegExp('^' + p[0]));
      if (v) highlights.push([p[1], v]);
    });
    if (!highlights.length) {
      ['규모', '가격', '진행상태'].forEach(function (l) {
        var v = factBy(a, new RegExp('^' + l));
        if (v) highlights.push([l, v]);
      });
    }
    var specLabels = /^(소재지|용도지역|대지면적|건축면적|연면적|규모|건폐율|용적률|사용승인일|주차|승강기|구조|구성|건축 개요|층별|부지|모집 규모|임대 토지|임대 건물|개발비|밀도)/;
    var specs = fs.filter(function (f) { return specLabels.test(String(f.label)); }).slice(0, 12);
    var opsLabels = /^(임대차 구조|임대 조건|임대조건|보증금|비용 부담|중도해지|임차인|임차인 주주|임차인 실적|호텔 운영|호텔 실적|호텔 최고월|전대|현황|운영사|책임임대차|임대율|가용 시점|사용 기간|완공|공실)/;
    var ops = fs.filter(function (f) { return opsLabels.test(String(f.label)); }).slice(0, 10);
    var snap = valSnapshot(a);

    var html = '<div class="im-deck">';

    /* 1. 표지 */
    html += slide('COVER', '',
      '<div class="ims-cover"><p class="ims-kicker">INFORMATION MEMORANDUM</p>' +
      '<h1>' + esc(a.name) + '</h1>' +
      '<p class="ims-loc">' + esc([sectorLabel(a.sector), a.region, a.address].filter(Boolean).join(' · ')) + '</p>' +
      '<div class="ims-cover-meta">' +
      (a.price_info ? '<span>' + esc(a.price_info) + '</span>' : '') +
      (a.owner_amc ? '<span>' + esc(a.owner_amc) + '</span>' : '') + '</div>' +
      '<p class="ims-draft">2026 · NAI Korea 매각자문</p></div>', 'cover');

    /* 2. 목차 */
    html += slide('Table of Contents', '02',
      '<h2 class="ims-h2">Table of Contents</h2><div class="ims-toc">' +
      ['01 Investment Highlights', '02 Property Overview', '03 Operation &amp; Lease', '04 Valuation', '05 Sale Structure']
        .map(function (t) { return '<div class="toc-row"><span>' + t.split(' ')[0] + '</span><b>' + t.slice(3) + '</b></div>'; }).join('') +
      '</div>');

    /* 3. Executive Summary */
    html += slide('01 Investment Highlights', '03',
      '<h2 class="ims-h2">Investment Highlights</h2><div class="ims-cards">' +
      (highlights.length ? highlights.map(function (h) {
        return '<div class="imsc"><span>' + esc(h[0]) + '</span><p>' + esc(h[1]) + '</p></div>';
      }).join('') : '<div class="imsc"><p>' + esc(a.notes || '자료 업데이트 중입니다.') + '</p></div>') +
      '</div>');

    /* 4. 입지 · 교통 */
    var locFacts = fs.filter(function (f) { return /^(입지|교통|접근성|관광|상권|주변|개발 호재|거래사례)/.test(String(f.label)); }).slice(0, 4);
    html += slide('02 Property Overview — Location', '04',
      '<h2 class="ims-h2">입지 · 교통</h2>' +
      '<div class="ims-two"><div class="ims-maplike"><span>📍</span><b>' + esc(a.address || '-') + '</b>' +
      '<i>' + esc((a.lat && a.lng) ? (a.lat + ', ' + a.lng) : '좌표 미확정') + '</i>' +
      '<em>' + esc(a.region || '') + '</em></div>' +
      '<div class="ims-side">' + (locFacts.length ? locFacts.map(function (f) {
        return '<div class="ims-li"><span>' + esc(f.label) + '</span><p>' + esc(f.value) + '</p></div>';
      }).join('') : '<p class="ims-empty">입지·교통 항목은 상세 스펙에서 확인하세요.</p>') + '</div></div>');

    /* 5. 건축 개요 */
    html += slide('02 Property Overview — Building', '05',
      '<h2 class="ims-h2">건축 개요</h2><table class="ims-table"><tbody>' +
      (specs.length ? specs.map(function (f) { return '<tr><th>' + esc(f.label) + '</th><td>' + esc(f.value) + '</td></tr>'; }).join('')
        : '<tr><th>규모</th><td>' + esc(a.scale_info || '-') + '</td></tr><tr><th>주소</th><td>' + esc(a.address || '-') + '</td></tr>') +
      '</tbody></table>');

    /* 6. 운영 · 임차 */
    html += slide('03 Operation & Lease', '06',
      '<h2 class="ims-h2">운영 · 임차 현황</h2>' +
      '<table class="ims-table"><tbody>' +
      '<tr><th>임차인·운영</th><td>' + esc(a.tenants || factBy(a, /^임차/) || '-') + '</td></tr>' +
      '<tr><th>만기·일정</th><td>' + esc(a.maturity_schedule || '-') + '</td></tr>' +
      (ops.slice(0, 6).map(function (f) { return '<tr><th>' + esc(f.label) + '</th><td>' + esc(f.value) + '</td></tr>'; }).join('')) +
      '</tbody></table>');

    /* 7. 수지 시뮬레이션 */
    var valBody;
    if (snap) {
      var r = snap.r;
      valBody = '<div class="ims-kpis">' +
        '<div class="imsk"><span>총투자비</span><b>' + n1s(r.total) + '억</b></div>' +
        '<div class="imsk"><span>Y1 NOI</span><b>' + n1s(r.noi !== undefined ? r.noi : r.ebit) + '억</b></div>' +
        '<div class="imsk"><span>수익률</span><b>' + (nval(snap.inp.price_eok) > 0 ? (r.entryCap !== undefined ? p2s(r.entryCap) : p1s(r.yield)) : '-') + '</b></div>' +
        '<div class="imsk"><span>Levered IRR</span><b>' + (nval(snap.inp.price_eok) > 0 && isFinite(r.levIrr) ? p2s(r.levIrr * 100) : '-') + '</b></div>' +
        '</div>' +
        '<table class="ims-table"><tbody>' + (r.lines || []).slice(0, 8).map(function (l) {
          return '<tr><th>' + esc(l[0]) + '</th><td class="' + (l[1] < 0 ? 'neg' : '') + '">' + (l[1] < 0 ? '(' + n1s(Math.abs(l[1])) + ')' : n1s(l[1])) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="ims-note">' + esc(snap.label) + ' 엔진 기본가정 기준' +
        (nval(snap.inp.price_eok) > 0 ? '' : ' — 매입가가 공개되지 않아 IRR·수익률은 비워 두었습니다(매수자 제안가를 넣으면 계산)') +
        '. 웹 <b>📊 밸류에이션</b> 탭에서 OCC·ADR·공사비·금리를 바꿔 실시간 재계산됩니다.</p>';
    } else {
      valBody = '<div class="ims-empty">' +
        (a.price_info ? '<p>가격: ' + esc(a.price_info) + '</p>' : '') +
        '<p>이 물건은 아직 섹터 수지 기본값이 없습니다. <b>📊 밸류에이션</b> 탭에서 렌트롤·OPEX 를 넣어 계산하세요.</p></div>';
    }
    html += slide('04 Valuation', '07', '<h2 class="ims-h2">수지 시뮬레이션</h2>' + valBody);

    /* 8. 매각 구조 */
    html += slide('05 Sale Structure', '08',
      '<h2 class="ims-h2">매각 구조 · 진행</h2>' +
      '<div class="ims-two"><div class="ims-side">' +
      '<div class="ims-li"><span>구분</span><p>' + esc(a.sub_type || '-') + '</p></div>' +
      '<div class="ims-li"><span>진행상태</span><p>' + esc(a.status || '-') + '</p></div>' +
      '<div class="ims-li"><span>가격·조건</span><p>' + esc(a.price_info || '-') + '</p></div>' +
      '<div class="ims-li"><span>매도인·자문</span><p>' + esc(a.owner_amc || '-') + '</p></div>' +
      '</div><div class="ims-steps">' +
      ['NDA 체결', 'IM·자료 제공', '현장 실사', '가격 제안', '우선협상·계약'].map(function (s, i) {
        return '<div class="ims-step"><span>' + (i + 1) + '</span>' + esc(s) + '</div>';
      }).join('') + '</div></div>' +
      '<p class="ims-note">' + esc(a.im_label || '') + '</p>');

    /* 9. Contact */
    html += slide('Contact', '09',
      '<h2 class="ims-h2">Contact Point</h2>' +
      '<div class="ims-contact"><div><b>NAI Korea</b><p>서울시 강남구 테헤란로 516 정헌빌딩 10층</p><p>TEL 02-508-1180 · FAX 02-508-1184</p><p>www.naikorea.com</p></div>' +
      '<div><b>담당</b><p>권준오 상무 · 010-7731-4316 · jk@naikorea.com</p><p>본 자료는 잠재 매수자 검토용이며, 매도인·매각자문사의 서면 동의 없이 복사·배포할 수 없습니다.</p></div></div>');

    html += '</div>';
    return html;
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
    var body = '<div class="brief-bar"><span>' + (isTM ? '📄 TM' : '📘 IM') + (isTM ? ' 브리프 미리보기' : ' 매각안내문 프리뷰 · 16:9 슬라이드') + '</span>' +
      '<span class="bb-right">' +
      '<button type="button" class="btn btn-solid" data-home="brief-print">🖨 인쇄 / PDF 저장</button>' +
      (isTM ? '' : '<button type="button" class="btn btn-ghost" data-home="brief-pptx" data-id="' + esc(a.id) + '">📊 .pptx 제작 요청</button>' +
        '<button type="button" class="btn btn-ghost" data-home="brief-pdf" data-id="' + esc(a.id) + '">📄 .pdf 제작 요청</button>') +
      '<button type="button" class="btn btn-ghost" data-home="brief-request" data-id="' + esc(a.id) + '" data-kind="' + kind + '">제작 요청 보내기</button></span></div>' +
      (isTM ? '<div class="brief-sheet" id="briefSheet">' + briefHTML(a, kind) + '</div>'
        : '<div class="im-deck-wrap" id="briefSheet">' + imDeckHTML(a) + '</div>');
    openModal((isTM ? '📄 TM' : '📘 IM') + ' 제작 — ' + a.name, body, { wide: true, deck: !isTM });
    // 요청은 미리보기를 여는 즉시 시트에 기록(브리프 요구: 미리보기 + 요청 동시)
    apiPost({
      action: 'request_doc', doc_type: kind, asset_id: a.id, asset_name: a.name,
      requester: (me() && me().name) || '', company: (me() && me().company) || '',
      note: isTM ? '웹 미리보기에서 생성' : '웹 16:9 IM 슬라이드 프리뷰에서 생성'
    }).then(function (j) {
      if (j && j.ok) {
        var bar = $('.brief-bar');
        if (bar) {
          var s = document.createElement('span');
          s.className = 'bb-ok';
          s.textContent = '제작 요청 접수됨 · ' + (j.status || '');
          bar.appendChild(s);
        }
        if (isAdmin()) renderSubs();
      }
    }).catch(function () { /* noop */ });
  }

  /** .pptx / .pdf 제작 요청 — doc_requests 에 양식별 메모와 함께 기록 */
  function requestExport(assetId, fmt) {
    var a = assets().filter(function (x) { return x.id === assetId; })[0];
    if (!a) { toast('물건을 찾을 수 없습니다.', true); return; }
    apiPost({
      action: 'request_doc', doc_type: 'IM', asset_id: a.id, asset_name: a.name,
      requester: (me() && me().name) || '', company: (me() && me().company) || '',
      note: fmt.toUpperCase() + ' 원본 제작 요청 (IM 슬라이드 프리뷰 기준)'
    }).then(function (j) {
      if (j && j.ok) {
        toast(fmt.toUpperCase() + ' 제작 요청을 접수했습니다. NAI 양식으로 만들어 전달드립니다.');
        if (isAdmin()) renderSubs();
      } else toast('요청 접수에 실패했습니다.', true);
    }).catch(function () { toast('네트워크 오류로 요청하지 못했습니다.', true); });
  }

  /* ─────────────────── 아티클/공지 읽기 ─────────────────── */
  function openArticle(idx) {
    var a = BOOT.articles[idx];
    if (!a) return;
    var body = '<div class="read-meta">' + esc(a.date || '') + (a.source ? ' · ' + esc(a.source) : '') + '</div>' +
      '<h2 class="read-title">' + esc(a.title || '') + '</h2>' +
      (a.summary ? '<p class="read-sum">' + esc(a.summary) + '</p>' : '') +
      '<div class="read-body">' + articleBody(a.body || '') + '</div>' +
      (function () {
        var links = [];
        (a.tags || '').split(',').forEach(function (t) { if (t.trim()) links.push('<span class="rd-tag">#' + esc(t.trim()) + '</span>'); });
        return links.length ? '<div class="rd-tags">' + links.join('') + '</div>' : '';
      })() +
      (isAdmin() ? '<div class="read-tools"><button type="button" class="mini-btn" data-home="art-edit" data-id="' + esc(a.id || '') + '">✏️ 수정</button>' +
        '<button type="button" class="mini-btn danger" data-home="art-del" data-id="' + esc(a.id || '') + '">🗑 삭제</button></div>' : '');
    openModal('📰 ' + (a.title || '아티클'), body, { wide: true });
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
      if (act === 'more-auction' || act === 'more-sale') {
        if (window.naiShowView) window.naiShowView('map');
        setTimeout(function () {
          var f = $('#dealTypeFilters');
          var target = act === 'more-auction' ? 'auction' : 'general';
          if (f) { var b = f.querySelector('[data-deal="' + target + '"]'); if (b) b.click(); }
        }, 120);
        return;
      }
      if (act === 'search') { var s = $('#hcSearch'); if (s) { s.scrollIntoView({ behavior: 'smooth', block: 'center' }); var q = $('#hsQ'); if (q) q.focus(); } return; }
      if (act === 'register') { openRegister('직접'); return; }
      if (act === 'match') { if (window.naiShowView) window.naiShowView('match'); return; }
      if (act === 'tr') { if (window.NAI_TR) window.NAI_TR.open({ source: 'home' }); else toast('TR 모듈을 불러오지 못했습니다.', true); return; }
      if (act === 'loi') { openLOI(''); return; }
      if (act === 'loan') { openLoan(''); return; }
      if (act === 'tm' || act === 'im') {
        openDocPick(act.toUpperCase());
        return;
      }
      if (act === 'reg-submit') { submitRegister(); return; }
      if (act === 'loi-submit') { submitLOI(); return; }
      if (act === 'loan-submit') { submitLoan(); return; }
      if (act === 'brief-print') { printBrief(); return; }
      if (act === 'brief-pptx') { requestExport(btn.getAttribute('data-id'), 'pptx'); return; }
      if (act === 'brief-pdf') { requestExport(btn.getAttribute('data-id'), 'pdf'); return; }
      if (act === 'brief-request') { requestDoc(btn.getAttribute('data-id'), btn.getAttribute('data-kind')); return; }
      if (act === 'open-article') { openArticle(Number(btn.getAttribute('data-idx'))); return; }
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
    /* Enter 로 검색 */
    host.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'hsQ') { e.preventDefault(); doSearch(); }
    });
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
