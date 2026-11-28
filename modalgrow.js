/* =========================================================================
   Open AI Asset Bridge — modalgrow.js  (공통 창 확대 유틸, 2026-11-28)
   - 더블클릭 또는 우측 상단 ⤢ 버튼으로 확대/원복 토글
   - 마켓 리포트(.rp-card) · 접수 내역(.hm-card) · 접수 목록(.tr-card) · 관리자 TR 목록 공용
   - 확대 시 폭뿐 아니라 글자·행 높이도 함께 키웁니다(style.css 의 .mg-max 규칙).
   사용: OAAB_GROW.attach(el, { head: '.rp-head', mode: 'card' | 'panel' })
   ========================================================================= */
(function () {
  'use strict';

  var ICON_MAX = '⤢';
  var ICON_MIN = '⤡';
  var TITLE_MAX = '확대 (더블클릭으로도 전환)';
  var TITLE_MIN = '원래 크기로 (더블클릭으로도 전환)';

  function btnHTML() {
    return '<button type="button" class="mg-btn" data-mg-toggle="1" aria-pressed="false" ' +
      'title="' + TITLE_MAX + '" aria-label="창 확대">' + ICON_MAX + '</button>';
  }

  function syncButtons(el, on) {
    var bs = el.querySelectorAll('[data-mg-toggle]');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (b.classList.contains('mg-fab')) { b.textContent = ICON_MIN + ' 축소'; }
      else { b.textContent = on ? ICON_MIN : ICON_MAX; }
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.title = on ? TITLE_MIN : TITLE_MAX;
      b.setAttribute('aria-label', on ? '창 원복' : '창 확대');
    }
  }

  function isPanel(el) {
    return el.classList.contains('mg-panel');
  }

  function toggle(el) {
    if (!el) return;
    var on = !el.classList.contains('mg-max');
    var host = el.parentElement;
    var panel = isPanel(el);

    el.classList.toggle('mg-max', on);

    if (!panel && host) host.classList.toggle('mg-host', on);

    if (panel) {
      var fab = el.querySelector('.mg-fab');
      if (on && !fab) {
        fab = document.createElement('button');
        fab.type = 'button';
        fab.className = 'mg-btn mg-fab';
        fab.setAttribute('data-mg-toggle', '1');
        el.appendChild(fab);

        /* ESC 로도 원복 */
        el._mgEsc = function (e) {
          if (e.key === 'Escape' && el.classList.contains('mg-max')) toggle(el);
        };
        document.addEventListener('keydown', el._mgEsc);
      } else if (!on && fab) {
        if (fab.parentNode) fab.parentNode.removeChild(fab);
        if (el._mgEsc) { document.removeEventListener('keydown', el._mgEsc); el._mgEsc = null; }
      }
      document.documentElement.classList.toggle('mg-panel-lock', on);
    }

    syncButtons(el, on);

    /* 확대하면 맨 위부터 다시 읽도록 본문 스크롤을 올립니다 */
    var body = el.querySelector('.rp-body, .hm-body, .tr-scroll, .modal-body, .ad-tablewrap');
    if (body && on) { try { body.scrollTop = 0; } catch (e) { /* noop */ } }
  }

  function attach(el, opts) {
    opts = opts || {};
    if (!el) return null;
    if (opts.mode === 'panel') el.classList.add('mg-panel');
    el.classList.add('mg-target');
    if (el._mgBound) return el;
    el._mgBound = 1;

    var head = opts.head ? el.querySelector(opts.head) : null;
    if (head && !head.querySelector('[data-mg-toggle]')) {
      var closeBtn = head.querySelector('.rp-close, .hm-close, .tr-x, [data-close-modal]');
      if (closeBtn) closeBtn.insertAdjacentHTML('beforebegin', btnHTML());
      else head.insertAdjacentHTML('beforeend', btnHTML());
    }

    el.addEventListener('dblclick', function (e) {
      if (e.target.closest('input, textarea, select, a, label, iframe')) return;
      /* 표 안에서 더블클릭하면 단어 선택이 되므로 선택만 해제합니다 */
      try { var s = window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); } catch (e2) { /* noop */ }
      toggle(el);
    });
    return el;
  }

  /* 버튼 클릭 — 위임 처리 (동적으로 다시 그린 창도 그대로 동작) */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-mg-toggle]');
    if (!b) return;
    var t = b.closest('.mg-target');
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    toggle(t);
  }, true);

  window.OAAB_GROW = { attach: attach, toggle: toggle, button: btnHTML };
})();
