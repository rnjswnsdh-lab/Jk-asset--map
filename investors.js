/* =========================================================================
   NAI Korea 통합 앱 — 🤝 SI·화주 풀 (investors 탭)
   - 별도 시트(investors) + Apps Script type=investors GET/POST
   - 권역·구분 필터, 검색, 다중 선택, 티저 메일 발송 바, 관리자 편집
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var PREF_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':pool:pref:v1';
  var CACHE_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':pool:cache:v1';

  var OFFICE_REGIONS = ['CBD', 'GBD', 'YBD', '강남·서초·수서', '판교·분당', '서부·마곡·구로'];
  var SHIPPER_REGIONS = ['수도권 동남', '수도권 남부', '수도권 서부', '수도권 동부', '충청', '지방·전국', '전국·미확인'];
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
    '전국·미확인': '권역 미확인(전국 단위 3PL 등)'
  };

  var state = {
    rows: [],
    loaded: false,
    role: '',
    kind: 'all',            // all | office | shipper
    region: 'ALL',
    q: '',
    onlyEmail: false,
    sel: {},
    busy: false
  };

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
  function savePref() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ kind: state.kind, region: state.region, onlyEmail: state.onlyEmail }));
    } catch (e) { /* noop */ }
  }
  function loadPref() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      if (p) {
        state.kind = p.kind || 'all';
        state.region = p.region || 'ALL';
        state.onlyEmail = !!p.onlyEmail;
      }
    } catch (e) { /* noop */ }
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

  function allRegions() {
    var seen = {}, list = [];
    (state.kind === 'shipper' ? SHIPPER_REGIONS : state.kind === 'office' ? OFFICE_REGIONS : OFFICE_REGIONS.concat(SHIPPER_REGIONS))
      .forEach(function (r) { if (!seen[r]) { seen[r] = 1; list.push(r); } });
    return list;
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
      state.role = j.role === 'readonly' ? 'readonly' : 'admin';
      state.rows = (j.investors || []).map(function (r) {
        var o = Object.assign({}, r);
        o.kind = (o.kind === 'office' || o.kind === 'office_si') ? 'office' : 'shipper';
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
    $('#poolList').innerHTML = '<div class="pool-empty">' + esc(msg || 'SI·화주 데이터를 불러올 수 없습니다.') + '</div>';
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
  function renderChips() {
    var kc = $('#poolKindChips');
    if (kc) {
      var kinds = [
        { k: 'all', label: '전체', icon: '📋' },
        { k: 'office', label: '오피스 SI', icon: '🏢' },
        { k: 'shipper', label: '물류 화주', icon: '🚚' }
      ];
      kc.innerHTML = kinds.map(function (x) {
        var n = x.k === 'all' ? state.rows.length : state.rows.filter(function (r) { return r.kind === x.k; }).length;
        var on = state.kind === x.k;
        return '<button type="button" class="chip ' + (on ? 'is-on' : 'is-off') + '" data-kind="' + x.k + '" aria-pressed="' + on + '">' +
          '<span>' + x.icon + ' ' + esc(x.label) + '</span><span class="cnt">' + n + '</span></button>';
      }).join('');
    }
    var rc = $('#poolRegionChips');
    if (!rc) return;
    var list = [];
    var officeOn = state.kind !== 'shipper', shipperOn = state.kind !== 'office';
    if (officeOn) list.push('<span class="seg-label">오피스</span>');
    (officeOn ? OFFICE_REGIONS : []).forEach(function (r) { list.push(regionChip(r)); });
    if (shipperOn) list.push('<span class="seg-label">물류</span>');
    (shipperOn ? SHIPPER_REGIONS : []).forEach(function (r) { list.push(regionChip(r)); });
    rc.innerHTML = list.join('');
    function regionChip(r) {
      var n = state.rows.filter(function (x) { return x.region === r && (state.kind === 'all' || x.kind === state.kind); }).length;
      var on = state.region === r;
      return '<button type="button" class="chip ' + (on ? 'is-on' : 'is-off') + '" data-region="' + esc(r) + '" title="' + esc(REGION_NOTE[r] || '') + '" aria-pressed="' + on + '">' +
        '<span>' + esc(r) + '</span><span class="cnt">' + n + '</span></button>';
    }
  }

  function filtered() {
    var q = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return state.rows.filter(function (r) {
      if (state.kind !== 'all' && r.kind !== state.kind) return false;
      if (state.region !== 'ALL' && r.region !== state.region) return false;
      if (state.onlyEmail && !r.email) return false;
      if (q.length) {
        var hay = [r.company, r.industry, r.role, r.case_info, r.contact, r.title, r.email, r.phone, r.region, r.notes, r.expansion, r.temp, r.source, r.year, r.amount]
          .join(' ').toLowerCase();
        for (var i = 0; i < q.length; i++) if (hay.indexOf(q[i]) === -1) return false;
      }
      return true;
    });
  }

  /* ─────────────── 목록 ─────────────── */
  function render() {
    var rows = filtered();
    var host = $('#poolList');
    var selCount = Object.keys(state.sel).filter(function (k) { return state.sel[k]; }).length;
    var withEmail = rows.filter(function (r) { return r.email; }).length;
    $('#poolResultCount').textContent = rows.length + '건 · 이메일 ' + withEmail + '건';
    $('#poolMeta').textContent = '전체 ' + state.rows.length + '건 (오피스 SI ' +
      state.rows.filter(function (r) { return r.kind === 'office'; }).length + ' · 물류 화주 ' +
      state.rows.filter(function (r) { return r.kind === 'shipper'; }).length + ') · 2026-11-22 기준';
    if (!rows.length) {
      host.innerHTML = '<div class="pool-empty">조건에 맞는 대상이 없습니다.<br>필터·검색어를 조정해 보세요.</div>';
      updateCompose();
      return;
    }
    var html = rows.map(function (r) {
      var on = !!state.sel[r.id];
      var isOff = r.kind === 'office';
      return '<div class="pool-row' + (on ? ' is-sel' : '') + '" data-id="' + esc(r.id) + '" role="listitem">' +
        '<label class="pr-check"><input type="checkbox" data-check="' + esc(r.id) + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(r.company) + ' 선택"></label>' +
        '<div class="pr-main">' +
          '<div class="pr-top">' +
            '<span class="pr-kind ' + (isOff ? 'k-office' : 'k-ship') + '">' + (isOff ? '🏢 오피스 SI' : '🚚 물류 화주') + '</span>' +
            '<span class="pr-region">' + esc(r.region || '-') + '</span>' +
            (r.role ? '<span class="pr-role">' + esc(r.role) + '</span>' : '') +
            (r.year ? '<span class="pr-year">' + esc(r.year) + '</span>' : '') +
            (r.amount ? '<span class="pr-amount">' + esc(r.amount) + '억</span>' : '') +
          '</div>' +
          '<div class="pr-name">' + esc(r.company) + (r.industry ? ' <span class="pr-industry">' + esc(r.industry) + '</span>' : '') + '</div>' +
          (r.case_info ? '<div class="pr-case">' + esc(r.case_info) + '</div>' : '') +
          (isOff
            ? (r.expansion ? '<div class="pr-sub">확장·수요: ' + esc(r.expansion) + '</div>' : '')
            : ('<div class="pr-sub">' + [r.temp ? '온도 ' + r.temp : '', r.centers ? '확인 센터 ' + r.centers + '곳' : '', r.expansion ? '확장 ' + r.expansion : ''].filter(Boolean).join(' · ') + '</div>')) +
          '<div class="pr-contact">' +
            (r.contact ? '<span class="pc-name">👤 ' + esc(r.contact) + (r.title ? ' <span class="pc-title">' + esc(r.title) + '</span>' : '') + '</span>' : '') +
            (r.email ? '<a class="pc-mail" href="mailto:' + esc(r.email.split(',')[0].trim()) + '">✉️ ' + esc(r.email) + '</a>' : '<span class="pc-none">이메일 없음</span>') +
            (r.phone ? '<a class="pc-tel" href="tel:' + esc(r.phone.replace(/[^0-9+]/g, '')) + '">☎ ' + esc(r.phone) + '</a>' : '') +
          '</div>' +
        '</div>' +
        (canEdit() ? '<div class="pr-actions"><button type="button" class="mini-btn" data-edit="' + esc(r.id) + '">✏️</button>' +
          '<button type="button" class="mini-btn danger" data-del="' + esc(r.id) + '">🗑</button></div>' : '') +
        '</div>';
    }).join('');
    host.innerHTML = html;
    updateCompose(rows, selCount);
  }

  function selectedRows() {
    return state.rows.filter(function (r) { return state.sel[r.id]; });
  }

  function updateCompose(rows, selCount) {
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

  /* ─────────────── 관리자 편집 ─────────────── */
  function fieldRow(label, key, val, opts) {
    opts = opts || {};
    var v = esc(val || '');
    if (opts.textarea) {
      return '<label class="mf"><span>' + esc(label) + '</span><textarea data-k="' + key + '" rows="' + (opts.rows || 3) + '">' + v + '</textarea></label>';
    }
    if (opts.options) {
      return '<label class="mf"><span>' + esc(label) + '</span><select data-k="' + key + '">' +
        opts.options.map(function (o) { return '<option value="' + esc(o) + '"' + (String(val) === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
        '</select></label>';
    }
    return '<label class="mf"><span>' + esc(label) + '</span><input data-k="' + key + '" type="text" value="' + v + '"></label>';
  }

  function openEditor(row) {
    var isNew = !row;
    row = row || { id: '', kind: 'office', region: 'CBD', company: '', industry: '', role: '', case_info: '', amount: '', year: '', contact: '', title: '', email: '', phone: '', temp: '', centers: '', expansion: '', notes: '', source: '' };
    var kindOpts = ['office', 'shipper'];
    var regionOpts = OFFICE_REGIONS.concat(SHIPPER_REGIONS);
    var html =
      '<div class="modal-card mf-card">' +
      '<div class="modal-head"><h3>' + (isNew ? '대상 추가' : '대상 수정') + '</h3><button type="button" class="icon-btn" data-close="1" aria-label="닫기">×</button></div>' +
      '<div class="mf-grid">' +
        fieldRow('구분', 'kind', row.kind, { options: kindOpts }) +
        fieldRow('권역', 'region', row.region, { options: regionOpts }) +
        fieldRow('기업명', 'company', row.company) +
        fieldRow('업종', 'industry', row.industry) +
        fieldRow('성격·역할', 'role', row.role) +
        fieldRow('거래·수요 사례', 'case_info', row.case_info, { textarea: true, rows: 3 }) +
        fieldRow('금액(억)', 'amount', row.amount) +
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
      if (!out.id) out.id = 'inv-' + (out.kind === 'shipper' ? 'shp' : 'off') + '-' + Date.now().toString(36);
      if (!out.company) { toast('기업명을 입력하세요.', true); return; }
      if (out.kind === 'shipper' && OFFICE_REGIONS.indexOf(out.region) >= 0 && out.region !== 'CBD') out.region = '수도권 동남';
      out.updated_at = new Date().toISOString().slice(0, 10);
      api(null, { action: 'upsert', investors: [out] }).then(function (j) {
        if (j && j.ok) {
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

  /* ─────────────── 탭 전환 ─────────────── */
  function showView(view) {
    var pool = view === 'pool';
    document.body.classList.toggle('view-pool', pool);
    $('#poolView').classList.toggle('hidden', !pool);
    $$('.vt-btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    var body = document.querySelector('.app-body');
    if (body) body.classList.toggle('hidden', pool);
    if (pool) load();
    if (pool) syncRoleFromApp();
    try { history.replaceState(null, '', pool ? '#pool' : location.pathname + location.search); } catch (e) { /* noop */ }
  }

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
      if (state.region !== 'ALL' && allRegions().indexOf(state.region) < 0) state.region = 'ALL';
      savePref(); renderChips(); render();
    });
    $('#poolRegionChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-region]');
      if (!b) return;
      var r = b.getAttribute('data-region');
      state.region = (state.region === r) ? 'ALL' : r;
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
    $('#poolOnlyEmail').checked = state.onlyEmail;
    renderChips();
    setInterval(function () {
      if (document.body.classList.contains('view-pool')) syncRoleFromApp();
    }, 1500);
    if ((location.hash || '') === '#pool') showView('pool');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
