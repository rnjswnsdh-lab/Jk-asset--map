/* =========================================================================
   Open AI Asset Bridge — backnav.js  (첫 화면 · 뒤로가기 공통 처리, 2026-11-28)
   -------------------------------------------------------------------------
   증상
   1) 즐겨찾기·새 탭으로 들어오면 홈이 아니라 지도가 먼저 떴습니다.
   2) 접수 내역 같은 창(모달)을 열었다가 브라우저 뒤로가기를 누르면
      창만 닫히는 게 아니라 사이트 자체를 벗어나(빈 탭·이전 페이지) 버렸습니다.

   원인 (수정 전 코드)
   - index.html 기본값이 '지도 선택'이었고, investors.js boot() 는 남은 해시가
     #pool·#fi·#ship·#valuation·#match·#admin·#lm·#vdr·#nai 일 때만 화면을 골랐습니다.
     정작 화면 전환이 남기는 해시(#home·#rfp·#advise·#portal·#adminhq)와
     해시 없는 지도 북마크는 처리하지 않아, 그대로 '지도' 기본값이 보였습니다.
   - 앱 어디에서도 history.pushState 를 쓰지 않았습니다(모두 replaceState).
     그래서 모달을 열어도 히스토리 항목이 쌓이지 않고, 뒤로가기는 곰장
     '이전 페이지(사이트 밖)'로 넘어갔습니다.

   고친 방식
   - 진입 화면: investors.js boot() 가 해시와 무관하게 showView('home') 를 부릅니다.
     (index.html 기본 마크업도 홈이 선택된 상태로 바꿨습니다 — 스크립트 전에 지도가 번뜩이지 않음)
   - 뒤로가기: 이 파일이 '바닥(floor)' 히스토리 항목을 하나 심고, 뒤로가기가
     사이트 밖으로 나가기 전에 가로채서
       · 열려 있는 창(모달)을 위에서부터 하나씩 닫고,
       · 창이 다 닫히면 홈 화면으로 복귀합니다.
     ========================================================================= */
(function () {
  'use strict';
  if (window.OAAB_BACK) return;

  /* 창(모달) 판별 — 앱의 모든 창은 role=dialog + aria-modal=true 로 그립니다. */
  var DIALOG_SEL = '[role="dialog"][aria-modal="true"]';
  /* 창을 닫는 버튼 — 전용 속성을 먼저 찾고(전체화면 ⤢ 버튼과 겹치지 않게), 없으면 공통 × 클래스를 씁니다. */
  var CLOSE_SEL = '[data-hub="close"],[data-vdr="close"],[data-rfp="close"],[data-crm-close],' +
    '[data-sh="close"],[data-sl-close],[data-tft-modal-close],[data-tr="close"],[data-im="cancel"],' +
    '.hm-close,.rp-close,.tr-x:not(.hub-full),.rfp-x,.sl-x,[data-close-modal],[data-close]';

  var guards = 0;               /* 이 페이지에서 우리가 쌓은 히스토리 항목 수 */

  function visible(el) {
    if (!el || !el.getClientRects) return false;
    if (el.closest('.hidden')) return false;
    var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    return el.getClientRects().length > 0;
  }

  /** 지금 보이는 창들 — 접속 게이트(#gate)는 뒤로가기 대상이 아닙니다. */
  function dialogs() {
    var all = document.querySelectorAll(DIALOG_SEL), out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.id === 'gate' || el.closest('#gate')) continue;
      if (visible(el)) out.push(el);
    }
    return out;
  }
  function hasDialog() { return dialogs().length > 0; }

  function homeTab() { return document.querySelector('.vt-btn[data-view="home"]'); }
  function isHome() {
    var b = homeTab();
    if (b && b.classList.contains('is-active')) return true;
    return false;
  }
  function showHome() {
    if (isHome()) return;
    if (window.naiShowView) {
      try { window.naiShowView('home'); return; } catch (e) { /* noop */ }
    }
    var b = homeTab();
    if (b) { try { b.click(); } catch (e2) { /* noop */ } }
  }

  /* ESC 로 닫는 화면이 많아 마지막 수단으로 ESC 키를 보냅니다. */
  function pressEscape() {
    try {
      var ev;
      try { ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }); }
      catch (e1) { ev = document.createEvent('Event'); ev.initEvent('keydown', true, true); ev.key = 'Escape'; ev.keyCode = 27; ev.which = 27; }
      document.dispatchEvent(ev);
    } catch (e2) { /* noop */ }
  }

  /** 그래도 안 닫히는 창은 DOM 에서 직접 치웁니다(스크롤 잠금 클래스도 함께 해제). */
  function hideOverlay(el) {
    var node = el, i;
    for (i = 0; i < 5 && node && node !== document.body; i++) {
      if (node.id) {
        if (node.id === 'modalRoot' || node.id === 'poolModal') node.innerHTML = '';
        else { node.classList.add('hidden'); node.innerHTML = ''; }
        break;
      }
      node = node.parentElement;
    }
    if (!node || node === document.body) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    try {
      document.body.classList.remove('rp-open', 'hub-full');
      if (document.documentElement) document.documentElement.classList.remove('mg-panel-lock');
    } catch (e2) { /* noop */ }
  }

  /** 가장 위(마지막에 그려진) 창 하나를 닫습니다. 닫았으면 true. */
  function closeTopDialog() {
    var list = dialogs();
    if (!list.length) return false;
    var el = list[list.length - 1];
    var btn = el.querySelector(CLOSE_SEL);
    if (!btn && el.parentElement) btn = el.parentElement.querySelector(CLOSE_SEL);
    if (btn) { try { btn.click(); } catch (e) { /* noop */ } }
    if (visible(el)) pressEscape();
    if (visible(el)) hideOverlay(el);
    return true;
  }

  /* ───────────── 뒤로가기 가로채기 ───────────── */

  /** 지금 상태를 보호할 필요가 있을 때만 히스토리 항목을 하나 쌓습니다. */
  function ensureGuard() {
    if (!hasDialog() && isHome()) return;
    if (guards > 0) return;
    try { history.pushState({ oaabGuard: 1 }, '', location.href); guards++; } catch (e) { /* noop */ }
  }

  function onPop() {
    if (guards > 0) guards--;
    var closed = closeTopDialog();
    var still = hasDialog();
    if (closed) {
      /* 창이 다 닫혔으면 홈으로, 남아 있으면 다음 뒤로가기에서 그 다음 창을 닫습니다. */
      if (!still && !isHome()) showHome();
      ensureGuard();
      return;
    }
    if (!isHome()) { showHome(); ensureGuard(); return; }
    /* 이미 홈이고 열린 창도 없습니다 — 한 번 더 누르면 브라우저 기본 동작(이전 페이지)에 맡깁니다. */
  }

  function seedFloor() {
    /* 현재 항목을 '바닥'으로 표시하고 그 위에 한 칸을 쌓습니다.
       → 첫 뒤로가기가 사이트 밖으로 나가지 않고 이 페이지 안에서 끝납니다. */
    try {
      history.replaceState(history.state || { oaabApp: 1 }, '', location.href);
      history.pushState({ oaabApp: 1 }, '', location.href);
      guards = 1;
    } catch (e) { /* file:// 등 — 뒤로가기 보호만 생략 */ }
  }

  function bind() {
    window.addEventListener('popstate', function () { try { onPop(); } catch (e) { /* noop */ } });

    /* 창이 열리거나 화면이 바뀌는 순간을 놓치지 않도록 클릭·키 입력 뒤에 한 번 점검합니다. */
    function later() { setTimeout(function () { try { ensureGuard(); } catch (e) { /* noop */ } }, 0); }
    document.addEventListener('click', later, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') later();
    }, true);

    /* 클릭 없이 열리는 창(자동 안내 등)도 잡습니다. */
    try {
      var mo = new MutationObserver(function () { try { ensureGuard(); } catch (e) { /* noop */ } });
      mo.observe(document.body, { childList: true });
    } catch (e2) { /* noop */ }
  }

  function start() {
    seedFloor();
    bind();
  }

  /* app.js·investors.js 가 먼저 화면을 정리한 뒤(홈) 바닥 항목을 심습니다. */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.OAAB_BACK = {
    dialogs: dialogs, hasDialog: hasDialog, closeTop: closeTopDialog,
    home: showHome, guard: ensureGuard
  };
})();
