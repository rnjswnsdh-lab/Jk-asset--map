/* =========================================================================
   Open AI Asset Bridge — tft.js  (🤝 공유 그룹 · TFT 필터, 2026-11-27)
   -------------------------------------------------------------------------
   · 그룹(파트너·TFT)은 config.js 의 SHARE_GROUPS 에서 읽습니다.
     예) 물류센터 TFT → sectors: ['logistics'], types: ['PR','매각','공개']
   · 그룹을 켜면 같은 필터가 물건 지도·홈 매각 목록·PR 접수 공유에 함께 적용됩니다.
     (화면마다 따로 하드코딩하지 않습니다)
   · 실제 메일 발송·수신자 지정은 하지 않습니다. 구조와 필터만 제공합니다.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':tft:v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  function groups() { return (CFG.SHARE_GROUPS || []).filter(function (g) { return g && g.key; }); }
  function get() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function set(k) { try { localStorage.setItem(KEY, k || ''); } catch (e) { /* noop */ } }

  var active = get();
  function group() {
    if (!active) return null;
    return groups().filter(function (g) { return g.key === active; })[0] || null;
  }
  function sectors() { var g = group(); return g ? (g.sectors || []) : null; }

  /** 자산이 현재 그룹 대상인지 */
  function matchAsset(a) {
    var s = sectors();
    if (!s) return true;
    return !!(a && s.indexOf(a.sector) >= 0);
  }
  function filterAssets(list) {
    if (!sectors()) return list || [];
    return (list || []).filter(matchAsset);
  }

  /** 접수 행의 섹터 — memo 의 '섹터=물류센터' 값을 config 라벨로 되돌립니다 */
  function sectorOfRequest(row) {
    var memo = String((row && row.memo) || '');
    var m = memo.match(/섹터=([^|]+)/);
    var label = m ? m[1].trim() : '';
    if (!label) {
      var t = String((row && row.asset_name) || '');
      var hit = null;
      Object.keys(CFG.SECTORS || {}).forEach(function (k) {
        var l = String((CFG.SECTORS[k] || {}).label || '');
        if (l && t.indexOf(l) >= 0) hit = k;
      });
      return hit || '';
    }
    var found = '';
    Object.keys(CFG.SECTORS || {}).forEach(function (k) {
      var l = String((CFG.SECTORS[k] || {}).label || '');
      if (l && (label.indexOf(l) >= 0 || l.indexOf(label) >= 0)) found = k;
    });
    return found;
  }
  function matchRequest(row) {
    var s = sectors();
    if (!s) return true;
    var k = sectorOfRequest(row);
    return !!(k && s.indexOf(k) >= 0);
  }
  /** 이 접수 행을 공유할 수 있는 그룹 목록 */
  function groupsForRequest(row) {
    return groups().filter(function (g) {
      var k = sectorOfRequest(row);
      return !!(k && (g.sectors || []).indexOf(k) >= 0 && (g.types || []).indexOf('PR') >= 0);
    });
  }

  /* ── 지도 필터에 그룹 적용 ── */
  function applyToMap() {
    var api = window.naiMap;
    if (!api || !api.state) return;
    var s = sectors();
    var f = api.state.filters;
    if (!f) return;
    if (s) {
      Object.keys(api.state.filters.sectors).forEach(function (k) { /* noop */ });
      (window.NAI_MAP_CONFIG.SECTORS ? Object.keys(window.NAI_MAP_CONFIG.SECTORS) : []).forEach(function (k) {
        f.sectors[k] = (s.indexOf(k) >= 0);
      });
      f.dealType = 'ALL';
    } else {
      (window.NAI_MAP_CONFIG.SECTORS ? Object.keys(window.NAI_MAP_CONFIG.SECTORS) : []).forEach(function (k) {
        f.sectors[k] = true;
      });
    }
    if (api.applyGroupFilter) api.applyGroupFilter();
  }

  function assets() {
    var st = window.naiMap && window.naiMap.state;
    return (st && st.assets) ? st.assets : [];
  }
  /** 그룹 범위 안의 '공개·공고·입찰 공개' 성격 건 */
  function publicItems() {
    var g = group();
    if (!g) return [];
    return filterAssets(assets().filter(function (a) {
      var s = [a.status, a.status_group, a.sub_type, a.notes].join(' ');
      return /공개|공고|입찰/.test(s);
    }));
  }
  /** 그룹 범위 안의 매각 진행 건 */
  function saleItems() {
    if (!group()) return [];
    var api = window.naiMap;
    return filterAssets(assets().filter(function (a) {
      return api && api.tradeState && api.tradeState(a) === 'sale';
    }));
  }

  function modalList(title, list) {
    var host = $('#tftModal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'tftModal';
      host.className = 'tft-modal hidden';
      document.body.appendChild(host);
    }
    host.classList.remove('hidden');
    host.innerHTML = '<div class="tftm-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="tftm-head"><b>' + esc(title) + '</b><span>' + list.length + '건</span>' +
      '<button type="button" class="tr-x" data-tft-modal-close aria-label="닫기">×</button></div>' +
      '<div class="tftm-body">' + (list.length ? list.map(function (a) {
        return '<button type="button" class="hs-item" data-tft-open="' + esc(a.id) + '">' +
          '<span class="hsi-main"><strong>' + esc(a.name) + '</strong>' +
          '<span class="hsi-sub">' + esc([(CFG.SECTORS[a.sector] || {}).label || a.sector, a.region, a.status || ''].filter(Boolean).join(' · ')) + '</span></span>' +
          '<span class="hsi-right">' + esc(a.price_info || '') + '</span></button>';
      }).join('') : '<p class="hs-empty">해당 건이 없습니다.</p>') + '</div></div>';
  }

  function bannerHTML() {
    var g = group();
    var host = $('#tftBanner');
    if (!host) return;
    if (!g) { host.innerHTML = ''; host.classList.add('hidden'); return; }
    host.classList.remove('hidden');
    var names = (g.sectors || []).map(function (k) {
      var S = CFG.SECTORS || {};
      return (S[k] && (S[k].icon || '') + (S[k].label || k)) || k;
    }).join(' · ');
    host.innerHTML = '<b>🤝 ' + esc(g.name) + '</b> 적용 중 — <span>' + esc(names) + ' 건만 표시</span>' +
      ' <span class="tft-types">' + esc((g.types || []).join(' · ')) + '</span>' +
      ' <button type="button" class="mini-btn" data-tft-list="sale">매각 ' + saleItems().length + '</button>' +
      ' <button type="button" class="mini-btn" data-tft-list="public">공개·입찰 ' + publicItems().length + '</button>' +
      ' <button type="button" class="mini-btn" data-tft-off>해제</button>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function chipsHTML() {
    var host = $('#tftFilters');
    if (!host) return;
    var list = groups();
    if (!list.length) { host.innerHTML = ''; host.classList.add('hidden'); return; }
    host.classList.remove('hidden');
    host.innerHTML = '<div class="tft-row"><span class="tft-k">공유 그룹</span>' +
      list.map(function (g) {
        var on = active === g.key;
        return '<button type="button" class="tft-chip' + (on ? ' is-on' : '') + '" data-tft="' + esc(g.key) + '" aria-pressed="' + on + '">' +
          '🤝 ' + esc(g.name) + ' <em>' + esc((g.sectors || []).join('·')) + '</em></button>';
      }).join('') + '</div>';
  }

  function refresh() {
    chipsHTML();
    bannerHTML();
    applyToMap();
    if (window.NAI_HOME && window.NAI_HOME.refresh) { try { window.NAI_HOME.refresh(); } catch (e) { /* noop */ } }
  }

  function toggle(k) {
    active = (active === k) ? '' : k;
    set(active);
    refresh();
    if (window.naiToast) window.naiToast(active ? (group().name + ' 필터를 켰습니다.') : '공유 그룹 필터를 해제했습니다.');
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tft]');
      if (b) { toggle(b.getAttribute('data-tft')); return; }
      var off = e.target.closest('[data-tft-off]');
      if (off) { active = ''; set(''); refresh(); return; }
      var ls = e.target.closest('[data-tft-list]');
      if (ls) {
        var g = group();
        if (!g) return;
        if (ls.getAttribute('data-tft-list') === 'sale') modalList(g.name + ' · 매각 진행', saleItems());
        else modalList(g.name + ' · 공개·입찰', publicItems());
        return;
      }
      var op = e.target.closest('[data-tft-open]');
      if (op) {
        var id = op.getAttribute('data-tft-open');
        var m = $('#tftModal'); if (m) m.classList.add('hidden');
        if (window.naiShowView) window.naiShowView('map');
        setTimeout(function () { if (window.naiMap) window.naiMap.select(id); }, 80);
        return;
      }
      if (e.target.closest('[data-tft-modal-close]') || e.target.id === 'tftModal') {
        var mm = $('#tftModal'); if (mm) mm.classList.add('hidden');
      }
    });
  }

  window.NAI_TFT = {
    groups: groups,
    activeKey: function () { return active; },
    group: group,
    isActive: function () { return !!sectors(); },
    filterAssets: filterAssets,
    matchAsset: matchAsset,
    matchRequest: matchRequest,
    groupsForRequest: groupsForRequest,
    sectorOfRequest: sectorOfRequest,
    publicItems: publicItems,
    saleItems: saleItems,
    refresh: refresh,
    toggle: toggle,
    applyToMap: applyToMap
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { bind(); refresh(); });
  else { bind(); refresh(); }
})();
