/* =========================================================================
   Open AI Asset Bridge — crm.js (🗒 미팅·의향 히스토리, 2026-11-24)
   -------------------------------------------------------------------------
   SI / 물류센터 화주 / FI 각 기업·투자자별로 NAI 내부의 미팅·의향 기록을
   시간순으로 누적합니다. 내부용(CM팀)·관리자에게만 보입니다.

   기록 항목 : 작성자명(브라우저에 저장해 재입력 없음) · 의향/단계 · 메모 · 일시(서버 자동)
   저장      : Apps Script Hub.gs `crm_logs` 시트  (GET ?type=crm / POST crm_save)
               — 서버 미배포 시 이 브라우저(localStorage)에만 저장되고 화면에 '로컬' 표시
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var AUTHOR_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':crm:author';
  var LS_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':crm:v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var STAGES = ['단순 미팅', '매입 검토', '임차 검토', '투자 검토', '개발/SI 참여', '자료 요청', '조건 협의', '보류', '종결'];

  var S = { items: [], loaded: false, loading: false, mode: 'server', err: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function me() { return (window.naiMap && window.naiMap.me) ? window.naiMap.me() : null; }
  function visible() { var r = role(); return r === 'admin' || r === 'internal' || r === 'logi'; }
  function authorStored() { try { return localStorage.getItem(AUTHOR_KEY) || ''; } catch (e) { return ''; } }
  function authorSet(v) { try { localStorage.setItem(AUTHOR_KEY, v); } catch (e) { /* noop */ } }

  function toast(msg, err) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3200);
  }

  function lsAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function lsSave(list) { try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 500))); } catch (e) { /* noop */ } }

  function apiGet(qs) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    return fetch(base + (base.indexOf('?') < 0 ? '?' : '&') + qs + '&token=' + encodeURIComponent(token()),
      { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function apiPost(payload) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var body = {};
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k];
    body.token = token();
    return fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function load(force) {
    if (!visible()) return Promise.resolve([]);
    if (S.loading) return S.loading;
    if (S.loaded && !force) return Promise.resolve(S.items);
    S.loading = true;
    return apiGet('type=crm').then(function (j) {
      if (j && j.ok && j.items) {
        S.items = j.items; S.mode = 'server'; S.loaded = true; S.loading = false;
      } else {
        S.items = lsAll(); S.mode = 'local'; S.loaded = true; S.loading = false;
      }
      return S.items;
    }).catch(function () {
      S.items = lsAll(); S.mode = 'local'; S.loaded = true; S.loading = false;
      return S.items;
    });
  }

  function forTarget(id) {
    return S.items.filter(function (x) { return String(x.target_id) === String(id); })
      .sort(function (a, b) { return String(b.timestamp || '').localeCompare(String(a.timestamp || '')); });
  }

  function dateText(ts) {
    var s = String(ts || '').replace('T', ' ');
    return s.slice(0, 16);
  }

  /* ─────────────────────────── 인라인(카드) ─────────────────────────── */
  function inline(row, kind) {
    if (!visible() || !row) return '';
    var list = forTarget(row.id);
    var head = '<div class="crm-h"><b>🗒 미팅·의향</b><span class="crm-n">' + (list.length ? list.length + '건' : '기록 없음') + '</span>' +
      '<button type="button" class="mini-btn crm-add" data-crm-add="' + esc(row.id) + '" data-crm-kind="' + esc(kind) + '" data-crm-company="' + esc(row.company || '') + '">＋ 기록</button></div>';
    var body = '';
    if (list.length) {
      body = '<ul class="crm-list">' + list.slice(0, 2).map(function (x) {
        return '<li><span class="crm-stage s-' + esc(String(x.stage || '').replace(/\s/g, '')) + '">' + esc(x.stage || '-') + '</span>' +
          '<span class="crm-memo">' + esc(String(x.note || '').slice(0, 90)) + '</span>' +
          '<em>' + esc(x.author || '') + ' · ' + esc(dateText(x.timestamp)) + '</em></li>';
      }).join('') + '</ul>' +
        (list.length > 2 ? '<button type="button" class="crm-more" data-crm-all="' + esc(row.id) + '">+ ' + (list.length - 2) + '건 더 보기</button>' : '');
    }
    return '<div class="crm-in" data-crm-for="' + esc(row.id) + '" data-crm-kind="' + esc(kind || '') + '">' + head + body + '</div>';
  }

  /* ─────────────────────────── 상세(모달 본문) ─────────────────────────── */
  function detail(row, kind) {
    if (!visible() || !row) return '';
    var list = forTarget(row.id);
    return '<div class="dc-sec crm-detail" data-crm-for="' + esc(row.id) + '" data-crm-kind="' + esc(kind || '') + '">' +
      '<h4>🗒 미팅·의향 히스토리 <span class="crm-n">' + list.length + '건</span>' +
      '<button type="button" class="mini-btn crm-add" data-crm-add="' + esc(row.id) + '" data-crm-kind="' + esc(kind) + '" data-crm-company="' + esc(row.company || '') + '">＋ 기록 추가</button></h4>' +
      (list.length ? '<ol class="crm-time">' + list.map(function (x) {
        return '<li><div class="crm-tl-head"><span class="crm-stage s-' + esc(String(x.stage || '').replace(/\s/g, '')) + '">' + esc(x.stage || '-') + '</span>' +
          '<b>' + esc(x.author || '작성자 미기재') + '</b><em>' + esc(dateText(x.timestamp)) + '</em>' +
          (x.role ? '<span class="crm-role">' + esc(x.role === 'admin' ? '관리자' : (x.role === 'internal' ? '내부용' : x.role)) + '</span>' : '') + '</div>' +
          '<p>' + esc(x.note || '') + '</p></li>';
      }).join('') + '</ol>'
        : '<p class="crm-empty">아직 기록이 없습니다. 상담·미팅 후 의향과 단계를 남겨 두면 다음 담당자가 이어받기 쉽습니다.</p>') +
      (S.mode === 'local' ? '<p class="crm-local">⚠️ 서버 CRM API 미연결 — 이 브라우저에만 저장됩니다.</p>' : '') +
      '</div>';
  }

  /* ─────────────────────────── 입력 모달 ─────────────────────────── */
  function openForm(targetId, kind, company) {
    if (!visible()) { toast('내부용·관리자만 기록할 수 있습니다.', true); return; }
    var host = $('#crmModal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'crmModal';
      host.className = 'crm-modal hidden';
      document.body.appendChild(host);
    }
    var last = authorStored() || ((me() && me().name) || '');
    host.innerHTML = '<div class="crm-card" role="dialog" aria-modal="true" aria-label="미팅·의향 기록">' +
      '<div class="crm-card-head"><strong>🗒 미팅·의향 기록</strong><button type="button" class="tr-x" data-crm-close="1">×</button></div>' +
      '<div class="crm-card-body">' +
      '<p class="crm-target">' + esc(company || '') + ' <span>' + esc(kind || '') + '</span></p>' +
      '<div class="tr-grid">' +
      '<label class="tr-f"><span>작성자명 <b>*</b></span><input name="author" value="' + esc(last) + '" placeholder="예) 홍길동"></label>' +
      '<label class="tr-f"><span>의향 · 단계 <b>*</b></span><select name="stage">' +
      STAGES.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label class="tr-f wide"><span>메모 <b>*</b></span><textarea name="note" rows="4" placeholder="예) 11/24 미팅 — 사옥 이전 검토, GBD 3,000평·예산 800억. IM 요청."></textarea></label>' +
      '</div>' +
      '<div class="tr-actions"><button type="button" class="btn btn-ghost" data-crm-close="1">취소</button></div>' +
      '<div class="tr-actions"><button type="button" class="btn btn-primary" data-crm-save="1">저장</button></div>' +
      '</div></div>';
    host.classList.remove('hidden');
    host.onclick = function (e) {
      if (e.target === host || e.target.closest('[data-crm-close]')) { host.classList.add('hidden'); }
      if (e.target.closest('[data-crm-save]')) save(host, targetId, kind, company);
    };
    setTimeout(function () { var a = host.querySelector('[name="author"]'); if (a && !a.value) a.focus(); }, 60);
  }

  function save(host, targetId, kind, company) {
    var author = host.querySelector('[name="author"]').value.trim();
    var stage = host.querySelector('[name="stage"]').value;
    var note = host.querySelector('[name="note"]').value.trim();
    if (!author) { toast('작성자명을 입력하세요.', true); return; }
    if (!note) { toast('메모 내용을 입력하세요.', true); return; }
    authorSet(author);
    var entry = {
      id: 'crm-' + Date.now().toString(36), target_id: targetId, target_company: company || '',
      kind: kind || '', stage: stage, author: author, note: note,
      timestamp: new Date().toISOString(), role: role()
    };
    var btn = host.querySelector('[data-crm-save]');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }

    function localSave() {
      var list = lsAll();
      list.unshift(entry);
      lsSave(list);
      S.items = list; S.mode = 'local'; S.loaded = true;
      host.classList.add('hidden');
      refreshTargets(targetId);
      toast('기록을 저장했습니다. (이 브라우저)');
    }

    apiPost({ action: 'crm_save', crm: entry }).then(function (j) {
      if (btn) { btn.disabled = false; btn.textContent = '저장'; }
      if (j && j.ok) {
        host.classList.add('hidden');
        entry.timestamp = j.timestamp || entry.timestamp;
        entry.role = role();
        S.items = [entry].concat(S.items);
        S.mode = 'server';
        refreshTargets(targetId);
        toast('미팅·의향 기록을 저장했습니다.');
      } else {
        localSave();
      }
    }).catch(function () { if (btn) { btn.disabled = false; btn.textContent = '저장'; } localSave(); });
  }

  /** 저장 직후 해당 카드/상세의 CRM 영역만 다시 그립니다 */
  function refreshTargets(targetId) {
    var els = document.querySelectorAll('[data-crm-for="' + targetId + '"]');
    Array.prototype.forEach.call(els, function (el) {
      var isDetail = el.classList.contains('crm-detail');
      var row = findRow(targetId);
      if (!row) return;
      var kind = el.getAttribute('data-crm-kind') || '';
      var tmp = document.createElement('div');
      tmp.innerHTML = isDetail ? detail(row, kind) : inline(row, kind);
      if (tmp.firstChild) el.parentNode.replaceChild(tmp.firstChild, el);
    });
  }

  function findRow(id) {
    var st = window.naiMap && window.naiMap.state;
    if (window.NAI_POOL_ROWS) {
      var hit = window.NAI_POOL_ROWS.filter(function (r) { return String(r.id) === String(id); })[0];
      if (hit) return hit;
    }
    if (st && st.assets) {
      var a = st.assets.filter(function (x) { return String(x.id) === String(id); })[0];
      if (a) return { id: a.id, company: a.name, kind: 'asset' };
    }
    return null;
  }

  /** '전체 보기' — 해당 대상의 모든 기록을 모달로 */
  function openAll(targetId) {
    var row = findRow(targetId) || { id: targetId, company: '' };
    var host = $('#crmModal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'crmModal';
      host.className = 'crm-modal hidden';
      document.body.appendChild(host);
    }
    host.innerHTML = '<div class="crm-card wide" role="dialog" aria-modal="true">' +
      '<div class="crm-card-head"><strong>🗒 ' + esc(row.company || '') + ' — 미팅·의향 전체</strong>' +
      '<button type="button" class="tr-x" data-crm-close="1">×</button></div>' +
      '<div class="crm-card-body">' + detail(row, '') + '</div></div>';
    host.classList.remove('hidden');
    host.onclick = function (e) {
      if (e.target === host || e.target.closest('[data-crm-close]')) host.classList.add('hidden');
      var add = e.target.closest('[data-crm-add]');
      if (add) openForm(add.getAttribute('data-crm-add'), add.getAttribute('data-crm-kind'), add.getAttribute('data-crm-company'));
    };
  }

  /* ─────────────────────────── 이벤트 ─────────────────────────── */
  document.addEventListener('click', function (e) {
    var add = e.target.closest('[data-crm-add]');
    if (add) {
      e.preventDefault(); e.stopPropagation();
      openForm(add.getAttribute('data-crm-add'), add.getAttribute('data-crm-kind'), add.getAttribute('data-crm-company'));
      return;
    }
    var all = e.target.closest('[data-crm-all]');
    if (all) {
      e.preventDefault(); e.stopPropagation();
      openAll(all.getAttribute('data-crm-all'));
    }
  }, true);

  window.NAI_CRM = {
    visible: visible, load: load, inline: inline, detail: detail, openForm: openForm,
    openAll: openAll, items: function () { return S.items; }, refresh: function () { return load(true); }
  };

  /* 권한 확인 후 미리 로드 */
  function boot() { if (visible()) load(false); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(boot, 2000);
})();
