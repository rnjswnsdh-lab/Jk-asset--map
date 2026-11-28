/* =========================================================================
   Open AI Asset Bridge — ai.js  (✨ AI 심층분석 연동, 2026-11-28)
   -------------------------------------------------------------------------
   · 메인: ✨ AI 심층분석 (Pickle)  — 물건 상세·AI 매물 매칭에서 피클로 바로 진입
       config.js 의 PICKLE_MODE 한 줄로 '초대 링크' ↔ '일반 진입' 전환
       (PICKLE_INVITE_URL · PICKLE_DEFAULT_URL · PICKLE_MODE)
   · 보조: Gemini로 분석 · Claude로 검토
       물건(또는 AI 매칭 후보) 스펙을 구조화한 프롬프트를 클립보드에 복사하고
       gemini.google.com/app · claude.ai/new 를 새 창으로 엽니다.
       (정적 사이트라 API 키를 둘 수 없어 '복사 + 새 창' 방식 — 붙여넣기만 하면 됩니다)
   · 피클 버튼도 같은 프롬프트를 복사해 대화창에 붙여넣을 수 있게 했습니다.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ─────────────── 진입 URL — 초대 링크 우선, 소모 후 일반 진입 ─────────────── */
  var INVITE_URL = CFG.PICKLE_INVITE_URL || 'https://pickle.com/i/2X6HQCBL47MN';
  var DEFAULT_URL = CFG.PICKLE_DEFAULT_URL || 'https://pickle.com/app';
  var MODE = String(CFG.PICKLE_MODE || 'invite').toLowerCase() === 'default' ? 'default' : 'invite';

  function pickleUrl() { return MODE === 'default' ? DEFAULT_URL : INVITE_URL; }
  function pickleNote() {
    return MODE === 'default'
      ? '피클에서 무료로 시작 · pickle.com (초대 없이 진입)'
      : '권준오 상무의 피클 초대 링크 · pickle.com';
  }

  /* ─────────────── 보조 AI 창 ─────────────── */
  var PROVIDERS = {
    gemini: { name: 'Gemini', url: 'https://gemini.google.com/app', win: 'oaabGemini' },
    claude: { name: 'Claude', url: 'https://claude.ai/new', win: 'oaabClaude' }
  };

  var TOAST_COPIED = '물건 분석 프롬프트를 복사했습니다. 열린 창에 붙여넣기(Ctrl+V) 하세요.';
  var TOAST_COPIED_PICKLE = '물건 분석 프롬프트를 복사했습니다. 피클 대화창에 붙여넣기(Ctrl+V) 하세요.';

  var toastTimer = null;
  function toast(msg, isErr) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 3200);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function txt(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  /* ─────────────── 클립보드 복사 (https 아닐 때도 동작하는 폴백 포함) ─────────────── */
  function legacyCopy(t) {
    try {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  function copy(t) {
    if (!t) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return legacyCopy(t); });
    }
    return Promise.resolve(legacyCopy(t));
  }

  /* ─────────────── 섹터 라벨 ─────────────── */
  function sectorLabel(k) {
    var s = (CFG.SECTORS || {})[k];
    if (!s) return txt(k);
    return txt(typeof s === 'string' ? s : (s.label || k));
  }

  /* 구분(sub_type)이 진행상태 값이면 섹터 줄에서 빼고 '진행상태'에만 둡니다 */
  function subTypeLabel(a) {
    var st = txt(a && a.sub_type);
    if (!st) return '';
    if ((CFG.STATUS_GROUPS || {})[st]) return '';
    if (st === txt(a.status) || st === txt(a.status_group)) return '';
    if (/^(예정|진행|진행중|매각중|임대중|보류|철회|완료)$/.test(st)) return '';
    return st;
  }

  /* ─────────────── 물건 상세 프롬프트 ─────────────── */
  var AUCTION_LABELS = ['경매구분', '감정가', '최저입찰가', '할인율', '유찰횟수', '입찰일·방식', '진행기관', '물건용도'];

  function factLines(a, limit) {
    var out = [];
    (a.facts || []).forEach(function (f) {
      var l = txt(f && f.label), v = txt(f && f.value);
      if (!l || !v || l === '공시·공공 데이터') return;
      if (out.length >= (limit || 10)) return;
      out.push(l + ': ' + v);
    });
    return out;
  }

  function detailPrompt(a) {
    if (!a) return '';
    var L = [];
    L.push('[OAAB 물건 심층분석 요청]');
    L.push('');
    L.push('■ 물건 개요');
    if (txt(a.name)) L.push('- 자산명: ' + txt(a.name));
    if (txt(a.address)) L.push('- 주소: ' + txt(a.address));
    if (txt(a.region)) L.push('- 권역: ' + txt(a.region));
    var sec = sectorLabel(a.sector) + (subTypeLabel(a) ? ' · ' + subTypeLabel(a) : '');
    if (txt(sec)) L.push('- 섹터: ' + txt(sec));
    if (txt(a.scale_info)) L.push('- 규모: ' + txt(a.scale_info));
    if (txt(a.price_info)) L.push('- 예상가·호가: ' + txt(a.price_info));
    var st = txt(a.status) || txt(a.status_group);
    if (st) L.push('- 진행상태: ' + st);
    if (txt(a.owner_amc)) L.push('- 운용사·소유주: ' + txt(a.owner_amc));
    if (txt(a.fund_vehicle)) L.push('- 펀드·리츠: ' + txt(a.fund_vehicle));
    if (txt(a.tenants)) L.push('- 임차인·운영: ' + txt(a.tenants));
    if (txt(a.maturity_schedule)) L.push('- 만기·일정: ' + txt(a.maturity_schedule));
    if (a.lat && a.lng) L.push('- 위치: ' + a.lat + ', ' + a.lng);
    var fx = factLines(a, 10);
    if (fx.length) { L.push('- 주요 스펙: ' + fx.join(' / ')); }
    if (txt(a.notes)) L.push('- 메모: ' + txt(a.notes));
    if (txt(a.source)) L.push('- 출처: ' + txt(a.source));

    L.push('');
    L.push('■ 요청 사항');
    L.push('1) 시장 포지션 — 같은 권역·섹터의 최근 2~3년 거래 사례와 비교해 평당 가격이 적정한지 평가해 주세요.');
    L.push('2) 수익성 — 임대료·공실률·WALE·OPEX 가정을 명시해 NOI, Cap Rate, 5년 보유 IRR을 추정하고 금리 ±100bp 민감도를 표로 보여 주세요.');
    L.push('3) 리스크 — 매수자 관점의 핵심 리스크 3가지와 실사에서 반드시 확인할 항목(권리관계·인허가·구조안전·환경·임차인 신용)을 정리해 주세요.');
    L.push('4) 대안 — 협상 포인트(가격·조건)와 대안 시나리오(임대 리스·리모델링·용도전환·개발)를 비교해 주세요.');
    L.push('5) 결론 — 3줄 요약과 함께 "이 가격에 매수할 만한가"에 대한 판단과 근거를 제시해 주세요.');
    L.push('');
    L.push('※ 확인된 사실과 추정을 구분해 표시하고, 추정 수치는 가정을 밝혀 주세요. (출처: OAAB 자산 DB · ' + today() + ')');
    return L.join('\n');
  }

  /* ─────────────── AI 매물 매칭 프롬프트 (조건 + 상위 후보) ─────────────── */
  var DEAL_LABEL = { sale: '매각·매입', lease: '임차·임대', dev: '개발', auction: '경·공매' };

  function parsedBits(p) {
    if (!p) return [];
    var bits = [];
    if (txt(p.raw)) bits.push('입력 문장 "' + txt(p.raw) + '"');
    if (p.sector) bits.push('섹터 ' + sectorLabel(p.sector));
    var where = p.city || p.zone || p.region;
    if (where) bits.push('지역 ' + where);
    if (p.deal) bits.push('거래유형 ' + (DEAL_LABEL[p.deal] || p.deal));
    if (p.area) bits.push('면적 ' + Number(p.area).toLocaleString('ko-KR') + '평');
    if (p.price) bits.push('가격 ' + (p.priceMode === 'max' ? '이하 ' : p.priceMode === 'min' ? '이상 ' : '약 ') +
      Number(p.price).toLocaleString('ko-KR') + '억');
    if (p.temp) bits.push('온도 ' + p.temp);
    return bits;
  }

  function matchCtx() {
    var m = window.NAI_MATCH;
    if (!m || !m.context) return null;
    try { return m.context(); } catch (e) { return null; }
  }

  function matchPrompt() {
    var c = matchCtx();
    if (!c) return '';
    var L = [];
    L.push('[OAAB AI 매물 매칭 — 후보 심층검토 요청]');
    L.push('');
    L.push('■ 검색 조건');
    var bits = parsedBits(c.parsed);
    if (bits.length) L.push('- ' + bits.join(' · '));
    else if (txt(c.q)) L.push('- 입력 문장 "' + txt(c.q) + '"');

    var rs = (c.results || []).slice(0, 5);
    L.push('');
    if (rs.length) {
      L.push('■ 상위 후보 ' + rs.length + '건 (부합도 순)');
      rs.forEach(function (o, i) {
        var a = (o && o.a) || {};
        var line = (i + 1) + '. ' + (o.pct != null ? o.pct : o.score) + '% · ' + (txt(a.name) || '이름 미상') +
          ' · ' + sectorLabel(a.sector) +
          (txt(a.region) ? ' · ' + txt(a.region) : '');
        L.push(line);
        var meta = [];
        if (txt(a.address)) meta.push(txt(a.address));
        if (txt(a.scale_info)) meta.push('규모 ' + txt(a.scale_info));
        if (txt(a.price_info)) meta.push('가격 ' + txt(a.price_info));
        var st = txt(a.status) || txt(a.status_group);
        if (st) meta.push('상태 ' + st);
        if (meta.length) L.push('   - ' + meta.join(' / '));
      });
    } else {
      L.push('■ 상위 후보');
      L.push('- 아직 매칭 결과가 없습니다. 위 조건에 맞는 국내 상업용 부동산 유형과 조달 방법을 제안해 주세요.');
    }

    L.push('');
    L.push('■ 요청 사항');
    L.push('1) 후보별 조건 부합성을 다시 검증하고, 순위를 바꿔야 할 후보가 있으면 이유와 함께 지적해 주세요.');
    L.push('2) 상위 3건을 임대료·공실·입주 시점·교통·규모 효율 기준으로 비교표로 정리해 주세요.');
    L.push('3) 조건을 조금 넓히면(권역·면적·가격) 추가로 검토할 만한 대안 유형을 제안해 주세요.');
    L.push('4) 최종 추천 1건과 그 이유, 그리고 계약 전 확인할 항목을 정리해 주세요.');
    L.push('');
    L.push('※ 확인된 사실과 추정을 구분해 표시해 주세요. (출처: OAAB AI 매물 매칭 · ' + today() + ')');
    return L.join('\n');
  }

  function today() {
    var d = new Date();
    var z = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }

  /* ─────────────── 현재 화면 기준 프롬프트 ─────────────── */
  function currentAsset() {
    var st = window.naiMap && window.naiMap.state;
    if (!st || !st.selectedId || !st.index) return null;
    return st.index[st.selectedId] || null;
  }

  function textFor(scope) {
    if (scope === 'match') return matchPrompt();
    var a = currentAsset();
    return a ? detailPrompt(a) : '';
  }

  /* ─────────────── 실행 ─────────────── */
  function openWith(key, text, scope) {
    var p = PROVIDERS[key];
    if (!p) return;
    /* 팝업 차단을 피하려면 창 열기를 클릭 제스처 안에서 먼저(동기) 처리합니다. */
    var win = null;
    try { win = window.open(p.url, p.win || '_blank'); } catch (e) { win = null; }
    try { if (win) win.opener = null; } catch (e2) { /* noop */ }

    copy(text).then(function (ok) {
      if (ok) toast(TOAST_COPIED);
      else toast('프롬프트 복사가 차단되었습니다 — 주소창 옆 자물쇠에서 클립보드 권한을 허용한 뒤 다시 눌러 주세요.', true);
      if (!win) toast('새 창이 차단되었습니다 — ' + p.name + '을(를) 직접 열어 붙여넣기(Ctrl+V) 해 주세요.', true);
    });
    logAI(key, scope);
  }

  function copyPickle(text, scope) {
    copy(text).then(function (ok) {
      toast(ok ? TOAST_COPIED_PICKLE : '프롬프트 복사가 차단되었습니다 — 피클 대화창에서 물건명으로 다시 물어보세요.', !ok);
    });
    logAI('pickle', scope);
  }

  function logAI(key, scope) {
    try {
      if (!(window.naiMap && window.naiMap.log)) return;
      var a = scope === 'match' ? null : currentAsset();
      var what = key === 'pickle' ? 'pickle_invite' : 'ai_analysis';
      window.naiMap.log(what, key + (a ? '|id=' + String(a.id || '') + '|name=' + String(a.name || '') : '|' + String(scope || 'detail')));
    } catch (e) { /* noop */ }
  }

  /* ─────────────── 화면 조각 ─────────────── */
  /** 물건 상세 패널용 CTA — 메인(Pickle) + 보조(Gemini·Claude) */
  function detailCta() {
    var h = '';
    h += '<div class="ai-cta">';
    h += '<div class="ai-cta-row">';
    h += '<a class="ai-btn-main" href="' + esc(pickleUrl()) + '" target="_blank" rel="noopener noreferrer" data-ai-pickle="detail"' +
      ' title="피클(Pickle)에서 이 물건을 대화로 심층 분석 — 스펙 프롬프트가 함께 복사됩니다">' +
      '<span class="ai-btn-txt">✨ AI 심층분석 <span class="ai-btn-sub">(Pickle)</span></span>' +
      '<span class="ai-arrow" aria-hidden="true">↗</span></a>';
    h += '<button type="button" class="ai-btn-alt" data-ai="gemini" data-ai-scope="detail"' +
      ' title="이 물건 스펙을 프롬프트로 복사하고 Gemini를 새 창으로 엽니다">Gemini로 분석</button>';
    h += '<button type="button" class="ai-btn-alt" data-ai="claude" data-ai-scope="detail"' +
      ' title="이 물건 스펙을 프롬프트로 복사하고 Claude를 새 창으로 엽니다">Claude로 검토</button>';
    h += '</div>';
    h += '<p class="ai-cta-note">Gemini·Claude는 물건 스펙을 정리한 프롬프트가 함께 복사됩니다 — 열린 창에 붙여넣기(Ctrl+V).</p>';
    h += '</div>';
    return h;
  }

  /** AI 매물 매칭 화면용 CTA — 조건·상위 후보를 프롬프트로 */
  function matchCtaHtml() {
    var h = '';
    h += '<div class="mt-cta-r">';
    h += '<a class="mt-pickle" href="' + esc(pickleUrl()) + '" target="_blank" rel="noopener noreferrer" id="mtPickle" data-ai-pickle="match"' +
      ' title="피클(Pickle)에서 이 조건·후보를 대화로 심층 검토 — 스펙 프롬프트가 함께 복사됩니다">' +
      '✨ AI 심층분석 <span class="mt-pickle-sub">(Pickle)</span> ↗</a>';
    h += '<div class="mt-ai-alt">';
    h += '<button type="button" class="ai-btn-alt" data-ai="gemini" data-ai-scope="match">Gemini로 분석</button>';
    h += '<button type="button" class="ai-btn-alt" data-ai="claude" data-ai-scope="match">Claude로 검토</button>';
    h += '</div>';
    h += '<span class="mt-cta-note">' + esc(pickleNote()) + '</span>';
    h += '</div>';
    return h;
  }

  /* ─────────────── 위임 클릭 (상세 패널·AI 매칭 공통) ─────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var alt = t.closest('[data-ai]');
    if (alt) {
      var key = alt.getAttribute('data-ai');
      var scope = alt.getAttribute('data-ai-scope') || 'detail';
      var body = textFor(scope);
      e.preventDefault();
      if (!body) { toast('분석할 물건이 없습니다. 물건을 먼저 선택해 주세요.', true); return; }
      openWith(key, body, scope);
      return;
    }

    /* 피클 버튼은 링크 그대로 새 창으로 열고, 프롬프트만 조용히 복사합니다. */
    var pk = t.closest('[data-ai-pickle]');
    if (pk) {
      var sc = pk.getAttribute('data-ai-pickle') || 'detail';
      var ptext = textFor(sc);
      if (ptext) copyPickle(ptext, sc);
    }
  });

  window.NAI_AI = {
    pickleUrl: pickleUrl,
    pickleNote: pickleNote,
    mode: function () { return MODE; },
    detailPrompt: detailPrompt,
    matchPrompt: matchPrompt,
    promptFor: function (a) { return detailPrompt(a); },
    copy: copy,
    detailCta: detailCta,
    matchCtaHtml: matchCtaHtml
  };
})();
