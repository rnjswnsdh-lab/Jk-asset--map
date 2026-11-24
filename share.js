/* =========================================================================
   Open AI Asset Bridge — share.js  (📧 파트너 메일 공유, 2026-11-25)
   -------------------------------------------------------------------------
   수요(TR·매입/투자)와 매물을 에스원·알스퀘어 등 파트너에게 **블라인드 기준**으로
   정리해 메일로 넘깁니다. 앱이 직접 보내지 않고, 제목·본문을 만들어 복사하거나
   메일 앱(mailto)으로 열어 주기만 합니다 — 발송은 사용자가 확인 후 직접.

   · 업체 실명은 절대 본문에 넣지 않습니다(블라인드 표기만). 관리자 화면에서도 동일.
   · 담당자 메일 프리셋은 서버(GET ?type=partners, 관리자 전용)에서만 내려받습니다.
     정적 파일에는 주소를 두지 않습니다.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }
  var ME = { name: '권준오', title: '상무', phone: '010-7731-4316', email: 'jk@naikorea.com',
    company: 'NAI Korea', addr: '서울시 강남구 테헤란로 516 정헌빌딩 10층' };

  /* 파트너 기관 — 주소는 서버 프리셋(관리자) 또는 직접 입력 */
  var ORGS = ['에스원', '알스퀘어', '직접 입력'];
  var PRESETS = null;

  var S = { payload: null, org: '에스원', to: '', subject: '', body: '', picked: {} };

  /* ───────────────────────── 프리셋 (관리자 전용) ───────────────────────── */
  function loadPresets() {
    if (PRESETS) return Promise.resolve(PRESETS);
    if (!isAdmin() || !CFG.SYNC_URL) { PRESETS = []; return Promise.resolve(PRESETS); }
    var url = CFG.SYNC_URL + (CFG.SYNC_URL.indexOf('?') < 0 ? '?' : '&') +
      'type=partners&token=' + encodeURIComponent(getToken());
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (j) {
        PRESETS = (j && j.ok && j.items) ? j.items : [];
        return PRESETS;
      }).catch(function () { PRESETS = []; return PRESETS; });
  }

  /* ───────────────────────── 메일 본문 생성 ───────────────────────── */
  function cleanMemo(memo) {
    var s = String(memo || '');
    s = s.replace(/^\[[^\]]*\]\s*/, '');
    s = s.split('|').map(function (p) {
      var t = p.trim();
      if (/^접수경로=/.test(t)) return '';
      if (/^연락처=미확인$/.test(t)) return '';
      return t;
    }).filter(Boolean).join(' · ');
    return s;
  }

  function buildSubject(p) {
    return '[NAI Korea] ' + p.badge + ' — ' + p.headline;
  }

  function buildBody(p) {
    var L = [];
    L.push('안녕하세요, NAI Korea 권준오 상무입니다.');
    L.push('');
    L.push(p.intro || '아래 건으로 확인 중인 수요/매물 조건을 공유드립니다. 부합하는 후보가 있으시면 회신 부탁드립니다.');
    L.push('');
    L.push('■ ' + p.badge + ' — ' + p.headline);
    (p.fields || []).forEach(function (f) {
      if (!f || !f[1]) return;
      L.push('· ' + f[0] + ': ' + f[1]);
    });
    if (p.ask) {
      L.push('');
      L.push('■ 회신 요청');
      L.push(p.ask);
    }
    L.push('');
    L.push('회신 주시면 NAI Korea에서 조건 확인 후 바로 연결드리겠습니다.');
    L.push('');
    L.push('감사합니다.');
    L.push('');
    L.push(ME.company + ' · ' + ME.name + ' ' + ME.title);
    L.push('T. ' + ME.phone + ' · E. ' + ME.email);
    L.push(ME.addr);
    L.push('');
    L.push('※ 본 메일은 확인된 조건만 담았으며, 수요 주체의 업체명은 비공개(블라인드)로 표기했습니다.');
    return L.join('\n');
  }

  function rebuild() {
    S.subject = buildSubject(S.payload);
    S.body = buildBody(S.payload);
    var sj = $('#shSubject'); if (sj && !sj.dataset.touched) sj.value = S.subject;
    var bd = $('#shBody'); if (bd && !bd.dataset.touched) bd.value = S.body;
    var to = $('#shTo'); if (to) to.value = S.to;
    var hint = $('#shBlindHint');
    if (hint) hint.textContent = S.to ? ('수신 ' + S.to) : '수신처를 선택하거나 직접 입력하세요.';
  }

  /* ───────────────────────── 모달 ───────────────────────── */
  function ensureHost() {
    var host = $('#shareModal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'shareModal';
      host.className = 'share-modal hidden';
      document.body.appendChild(host);
    }
    return host;
  }

  function orgChips() {
    return ORGS.map(function (o) {
      return '<button type="button" class="sh-org' + (S.org === o ? ' on' : '') + '" data-sh-org="' + esc(o) + '">' +
        (o === '에스원' ? '🏢 ' : o === '알스퀘어' ? '🏙️ ' : '✎ ') + esc(o) + '</button>';
    }).join('');
  }

  function presetList() {
    if (!isAdmin()) {
      return '<p class="sh-note">수신처 메일 주소를 직접 입력하세요. (담당자 프리셋은 관리자 로그인에서 표시됩니다)</p>';
    }
    if (S.org === '직접 입력') return '<p class="sh-note">주소를 직접 입력하세요. 여러 명은 쉼표(,)로 구분합니다.</p>';
    if (!PRESETS) return '<p class="sh-note">담당자 목록을 불러오는 중…</p>';
    var list = PRESETS.filter(function (p) { return String(p.org) === S.org; });
    if (!list.length) return '<p class="sh-note">등록된 담당자가 없습니다. 주소를 직접 입력하세요.</p>';
    return '<div class="sh-presets">' + list.map(function (p) {
      var on = !!S.picked[p.email];
      return '<label class="sh-preset' + (on ? ' on' : '') + '"><input type="checkbox" data-sh-pick="' + esc(p.email) + '"' +
        (on ? ' checked' : '') + '><span><b>' + esc(p.name) + '</b><em>' + esc(p.email) + '</em></span></label>';
    }).join('') + '</div>';
  }

  function modalHTML() {
    var p = S.payload || {};
    var h = '';
    h += '<div class="sh-card" role="dialog" aria-modal="true" aria-label="파트너 메일 공유">';
    h += '<div class="sh-head"><div><h3>📧 파트너 메일 공유</h3>' +
      '<p>' + esc(p.badge || '') + ' · <b>' + esc(p.headline || '') + '</b> — 업체 실명 없이 조건만 담아 만듭니다.</p></div>' +
      '<button type="button" class="tr-x" data-sh="close" aria-label="닫기">×</button></div>';
    h += '<div class="sh-scroll">';
    h += '<div class="sh-sec"><h4>① 수신 파트너</h4><div class="sh-orgs">' + orgChips() + '</div>' +
      '<div id="shPresets">' + presetList() + '</div>' +
      '<label class="tr-f wide"><span>받는 사람</span><input id="shTo" type="text" value="' + esc(S.to) +
      '" placeholder="name@partner.co.kr (여러 명은 , 로 구분)"></label>' +
      '<p class="sh-note" id="shBlindHint"></p></div>';
    h += '<div class="sh-sec"><h4>② 제목</h4>' +
      '<label class="tr-f wide"><input id="shSubject" type="text" value="' + esc(S.subject) + '"></label></div>';
    h += '<div class="sh-sec"><h4>③ 본문 <em class="sh-blindtag">🔒 실명 제외 · 블라인드 기준</em></h4>' +
      '<label class="tr-f wide"><textarea id="shBody" rows="14">' + esc(S.body) + '</textarea></label></div>';
    h += '</div>';
    h += '<div class="sh-actions">' +
      '<span class="sh-spacer"></span>' +
      '<button type="button" class="btn btn-outline" data-sh="copy">📋 제목+본문 복사</button>' +
      '<button type="button" class="btn btn-outline" data-sh="close">닫기</button>' +
      '<button type="button" class="btn btn-primary" data-sh="mailto">✉️ 메일 앱으로 열기</button>' +
      '</div>';
    h += '</div>';
    return h;
  }

  function render() {
    var host = ensureHost();
    host.innerHTML = modalHTML();
    var legend = $('#shBlindHint');
    if (legend) legend.textContent = S.to ? ('수신 ' + S.to) : '수신처를 선택하거나 직접 입력하세요.';
  }

  function open(payload) {
    S.payload = payload || {};
    S.org = '에스원';
    S.picked = {};
    S.to = '';
    S.subject = buildSubject(S.payload);
    S.body = buildBody(S.payload);
    var host = ensureHost();
    host.classList.remove('hidden');
    render();
    loadPresets().then(function () {
      var host2 = $('#shareModal');
      if (host2 && !host2.classList.contains('hidden') && $('#shPresets')) {
        $('#shPresets').innerHTML = presetList();
      }
    });
  }

  function close() {
    var host = $('#shareModal');
    if (host) { host.classList.add('hidden'); host.innerHTML = ''; }
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function toast(msg, err) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3200);
  }

  function currentSubject() { var el = $('#shSubject'); return el ? el.value : S.subject; }
  function currentBody() { var el = $('#shBody'); return el ? el.value : S.body; }
  function currentTo() { var el = $('#shTo'); return el ? String(el.value || '').trim() : S.to; }

  function copyAll() {
    var text = '제목: ' + currentSubject() + '\n\n' + currentBody();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('제목과 본문을 복사했습니다.'); },
        function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('제목과 본문을 복사했습니다.'); }
    catch (e) { toast('복사하지 못했습니다. 본문을 직접 선택해 주세요.', true); }
    ta.remove();
  }

  function mailto() {
    var to = currentTo();
    if (!to) { toast('받는 사람 메일 주소를 입력하세요.', true); return; }
    var url = 'mailto:' + encodeURIComponent(to) +
      '?subject=' + encodeURIComponent(currentSubject()) +
      '&body=' + encodeURIComponent(currentBody());
    if (url.length > 7500) { toast('본문이 길어 메일 앱으로 열 수 없습니다. 복사 후 메일에 붙여넣어 주세요.', true); return; }
    window.location.href = url;
    toast('메일 앱을 엽니다. 보내기 전에 받는 사람·내용을 확인하세요.');
  }

  function bind() {
    document.removeEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);
    var host = $('#shareModal');
    if (!host || host.dataset.bound === '1') return;
    host.dataset.bound = '1';
    host.addEventListener('click', function (e) {
      if (e.target === host) { close(); return; }
      var o = e.target.closest('[data-sh-org]');
      if (o) {
        S.org = o.getAttribute('data-sh-org');
        S.picked = {};
        S.to = '';
        render();
        return;
      }
      var b = e.target.closest('[data-sh]');
      if (!b) return;
      var act = b.getAttribute('data-sh');
      if (act === 'close') close();
      else if (act === 'copy') copyAll();
      else if (act === 'mailto') mailto();
    });
    host.addEventListener('change', function (e) {
      var p = e.target.closest('[data-sh-pick]');
      if (!p) return;
      var em = p.getAttribute('data-sh-pick');
      if (p.checked) S.picked[em] = 1; else delete S.picked[em];
      var tos = Object.keys(S.picked);
      S.to = tos.join(', ');
      var to = $('#shTo'); if (to) to.value = S.to;
      var hint = $('#shBlindHint'); if (hint) hint.textContent = S.to ? ('수신 ' + S.to) : '수신처를 선택하거나 직접 입력하세요.';
      $$('.sh-preset', host).forEach(function (l) {
        var cb = l.querySelector('[data-sh-pick]');
        l.classList.toggle('on', !!(cb && cb.checked));
      });
    });
    host.addEventListener('input', function (e) {
      if (e.target.id === 'shSubject') e.target.dataset.touched = '1';
      if (e.target.id === 'shBody') e.target.dataset.touched = '1';
    });
  }

  /* ───────────────────────── 호출 지점 ───────────────────────── */
  var SECTOR = { office: '오피스', logistics: '물류센터', datacenter: '데이터센터', hotel: '호텔',
    retail: '리테일', living: '멀티패밀리·임대', land: '토지·개발부지', senior: '시니어 하우징', tr: '수요' };

  /** 목록/접수 행(lois) → 메일. company 는 절대 쓰지 않고 blind_name 만 사용합니다. */
  function openRequest(row) {
    var t = String(row.request_type || 'TR');
    var blind = String(row.blind_name || '').trim() || '비공개 고객사';
    var kind = (t === '매입') ? '매입·투자 의향' : (t === 'TR') ? 'TR 임차의뢰' : t;
    var badge = (t === '매입') ? '매입·투자 수요' : '임차 수요(TR)';
    var fields = [
      ['수요 주체', blind],
      ['희망 권역', row.region || ''],
      ['규모', row.area_py || ''],
      ['예산·임대료', row.price || row.rent || ''],
      ['입주 시기', row.timeline || ''],
      ['주요 조건', cleanMemo(row.memo)]
    ];
    open({
      badge: badge,
      headline: (row.region ? row.region + ' · ' : '') + (row.area_py ? row.area_py : kind),
      intro: '아래 ' + kind + ' 건을 공유드립니다. 부합하는 후보 물건이 있으시면 회신 부탁드립니다.',
      fields: fields,
      ask: (t === '매입')
        ? '· 매물 개요(소재지·연면적·가격·임차 현황)와 자료(티저/IM) 제공 가능 여부를 알려 주세요.'
        : '· 후보 물건의 소재지·면적·층고·도크·임대료와 입주 가능 시기를 알려 주세요.'
    });
  }

  /** 물건(assets) → 메일. 매도인·운용사 실명은 본문에서 제외합니다. */
  function openAsset(a) {
    if (!a) return;
    var fields = [
      ['물건명', a.name || ''],
      ['구분', SECTOR[a.sector] || a.sector || ''],
      ['소재지', a.address || ''],
      ['권역', a.region || ''],
      ['규모', a.scale_info || ''],
      ['가격', a.price_info || ''],
      ['진행 상태', a.status || a.status_group || ''],
      ['임차·운영', a.tenants || '']
    ];
    var nm = String(a.name || '');
    var blind = /^\[(TR|매입)\]/.test(nm) ? true : false;
    open({
      badge: blind ? '수요 건 공유' : '매물 공유',
      headline: (a.address || a.region || nm),
      intro: '아래 물건을 공유드립니다. 관심 있으시면 회신 부탁드립니다.',
      fields: fields,
      ask: '· 관심 여부와 검토 일정, 추가로 필요한 자료(렌트롤·OPEX·실사)를 알려 주세요.'
    });
  }

  window.NAI_SHARE = { open: open, openRequest: openRequest, openAsset: openAsset, close: close };
})();
