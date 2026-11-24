/* =========================================================================
   Open AI Asset Bridge (가칭) — tr.js  (📋 TR 임차의뢰 접수, 2026-11-24)
   -------------------------------------------------------------------------
   외부 화주사 · 임차인이 인증 후 웹에서 직접 임차 의뢰(Tenant Request)를
   남기는 모달입니다. 홈(빠른 실행)과 🤖 AI 매물 매칭 화면에서 엽니다.

   저장 위치 — 기존 Apps Script(v6 · Home.gs)의  POST {action:'submit_loi'}
   · 비공개 시트 `lois`(인수·임차의향서)에  deal_type='임차' 로 적재
   · asset_id 를 'TR-…' 로 시작해 관리자 탭 · 홈 접수내역에서 TR 만 분리 조회
   · 담당자·연락처 검증은 서버(respSubmit_)가 그대로 수행합니다.
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
  function me() { return (window.naiMap && window.naiMap.me) ? window.naiMap.me() : null; }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }

  function toast(msg, err) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3200);
  }

  /* 물건 DB 에 실제로 존재하는 권역 목록 (+ 기본 권역) */
  function regionList() {
    var set = {};
    var st = window.naiMap && window.naiMap.state;
    (st && st.assets ? st.assets : []).forEach(function (a) {
      var r = String(a.region || '').trim();
      if (r) set[r] = (set[r] || 0) + 1;
    });
    ['서울', '경기', '인천', '부산', '대구', '대전', '세종', '광주·전남', '충남', '충북',
      '경남', '경북', '전북', '울산', '강원', '제주', 'CBD', 'GBD', 'BBD', 'YBD'].forEach(function (r) {
      if (!set[r]) set[r] = 0;
    });
    return Object.keys(set).sort(function (a, b) { return set[b] - set[a]; });
  }

  var SECTOR_OPTS = [
    { v: 'office', l: '오피스 · 사옥' },
    { v: 'logistics', l: '물류센터 (상온·저온)' },
    { v: 'datacenter', l: '데이터센터' },
    { v: 'hotel', l: '호텔' },
    { v: 'retail', l: '리테일 · 상업시설' },
    { v: 'living', l: '멀티패밀리 · 임대주택' },
    { v: 'land', l: '토지 · 개발부지' }
  ];
  var DEAL_OPTS = [
    { v: '임차', l: '임차 (리스)' },
    { v: '매입', l: '매입 (인수)' }
  ];

  function field(label, name, opts) {
    opts = opts || {};
    var input;
    if (opts.type === 'select') {
      input = '<select name="' + name + '">' + (opts.options || []).map(function (o) {
        return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(opts.value) ? ' selected' : '') + '>' + esc(o.l) + '</option>';
      }).join('') + '</select>';
    } else if (opts.type === 'textarea') {
      input = '<textarea name="' + name + '" rows="' + (opts.rows || 3) + '" placeholder="' + esc(opts.ph || '') + '">' + esc(opts.value || '') + '</textarea>';
    } else {
      input = '<input name="' + name + '" type="' + (opts.type || 'text') + '" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.ph || '') + '"' +
        (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') + '>';
    }
    return '<label class="tr-f' + (opts.wide ? ' wide' : '') + '"><span>' + esc(label) + (opts.req ? ' <b>*</b>' : '') + '</span>' + input +
      (opts.hint ? '<em>' + opts.hint + '</em>' : '') + '</label>';
  }

  function buildBody(prefill) {
    prefill = prefill || {};
    var regions = [{ v: '', l: '선택 안 함' }].concat(regionList().map(function (r) { return { v: r, l: r }; }));
    var html = '';
    html += '<div class="tr-head">';
    html += '<div><h3>📋 TR 임차의뢰 등록</h3>';
    html += '<p>희망 조건을 남겨 주시면 NAI Korea 가 보유 물건 · NAI 매각·LM 물건 · 외부 매물 중에서 부합하는 후보를 찾아 회신드립니다. (Tenant Request)</p></div>';
    html += '<button type="button" class="tr-x" data-tr="close" aria-label="닫기">×</button>';
    html += '</div>';
    html += '<div class="tr-scroll">';
    html += '<div class="tr-sec"><h4>① 희망 조건</h4><div class="tr-grid">';
    html += field('희망 지역 · 권역', 'region', { type: 'select', options: regions, value: prefill.region || '' });
    html += field('섹터', 'sector', { type: 'select', options: SECTOR_OPTS, value: prefill.sector || 'logistics' });
    html += field('거래 구분', 'deal', { type: 'select', options: DEAL_OPTS, value: prefill.deal || '임차' });
    html += field('희망 면적(평)', 'area', { ph: '예) 15,000', inputmode: 'numeric', value: prefill.area || '' });
    html += field('희망 임대료 · 예산', 'rent', { ph: '임차: 평당 월 3.3만원 / 매입: 1,200억원', wide: true, value: prefill.rent || '' });
    html += field('입주 희망 시기', 'timeline', { ph: '예) 2027년 상반기 / 6개월 내', value: prefill.timeline || '' });
    html += field('상세 스펙 (온도·층고·하중·도크 등)', 'spec', {
      type: 'textarea', wide: true, ph: '예) 냉동 -25℃ 5,000평 + 상온 10,000평, 층고 10m 이상, 도크 40대, 하중 1.5t/㎡',
      value: prefill.spec || ''
    });
    html += '</div></div>';
    html += '<div class="tr-sec"><h4>② 연락처</h4><div class="tr-grid">';
    html += field('회사', 'company', { req: true, ph: '예) ㈜OO물류', value: (me() && me().company) || '' });
    html += field('성명', 'name', { req: true, ph: '예) 홍길동', value: (me() && me().name) || '' });
    html += field('직책', 'title', { ph: '예) 물류기획팀 팀장', value: prefill.title || '' });
    html += field('연락처', 'phone', { req: true, type: 'tel', ph: '010-0000-0000', inputmode: 'tel' });
    html += field('이메일', 'email', { type: 'email', ph: 'name@company.com', wide: true });
    html += field('메모', 'memo', { type: 'textarea', wide: true, rows: 2, ph: '후보 물건 조건 · 기타 요청사항', value: prefill.memo || '' });
    html += '</div></div>';
    html += '<p class="tr-note">접수 내용은 NAI Korea 비공개 시트(lois)에 <b>TR 임차의뢰</b>로 기록되며, 담당자만 확인합니다. ' +
      '허위·중복 접수는 별도 안내 없이 정리될 수 있습니다.</p>';
    html += '<div class="tr-err hidden" id="trErr"></div>';
    html += '</div>';
    html += '<div class="tr-actions">';
    html += '<button type="button" class="btn btn-outline" data-tr="close">취소</button>';
    html += '<button type="button" class="btn btn-primary" data-tr="submit" id="trSubmit">TR 접수하기</button>';
    html += '</div>';
    return html;
  }

  function open(prefill) {
    if (!getToken()) { toast('접속(인증) 후 TR 을 접수할 수 있습니다.', true); return; }
    var host = $('#trModal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'trModal';
      host.className = 'tr-modal hidden';
      document.body.appendChild(host);
    }
    host.innerHTML = '<div class="tr-card" role="dialog" aria-modal="true" aria-label="TR 임차의뢰 등록">' + buildBody(prefill) + '</div>';
    host.classList.remove('hidden');
    host.setAttribute('data-src', (prefill && prefill.source) || 'web');
    setTimeout(function () {
      var first = host.querySelector('[name="area"]');
      if (first) first.focus();
    }, 60);

    host.onclick = function (e) {
      if (e.target === host) close();
      var b = e.target.closest('[data-tr]');
      if (!b) return;
      var act = b.getAttribute('data-tr');
      if (act === 'close') close();
      if (act === 'submit') submit(host);
    };
    document.addEventListener('keydown', escHandler);
  }

  function escHandler(e) {
    if (e.key === 'Escape') close();
  }

  function close() {
    var host = $('#trModal');
    if (host) { host.classList.add('hidden'); host.innerHTML = ''; }
    document.removeEventListener('keydown', escHandler);
  }

  function val(host, name) {
    var el = host.querySelector('[name="' + name + '"]');
    return el ? String(el.value || '').trim() : '';
  }

  function err(host, msg) {
    var el = $('#trErr', host);
    if (el) { el.textContent = msg; el.classList.toggle('hidden', !msg); }
    else toast(msg, true);
  }

  function sectorLabel(v) {
    var hit = SECTOR_OPTS.filter(function (o) { return o.v === v; })[0];
    return hit ? hit.l.split(' ')[0] : v;
  }

  function submit(host) {
    var company = val(host, 'company');
    var name = val(host, 'name');
    var phone = val(host, 'phone');
    var region = val(host, 'region');
    var sector = val(host, 'sector');
    var email = val(host, 'email');
    if (!company) { err(host, '회사명을 입력하세요.'); return; }
    if (!name) { err(host, '성명을 입력하세요.'); return; }
    if (String(phone).replace(/[^0-9]/g, '').length < 7) { err(host, '연락처를 정확히 입력하세요.'); return; }
    if (email && email.indexOf('@') < 0) { err(host, '이메일 형식을 확인하세요.'); return; }

    var area = val(host, 'area');
    var spec = val(host, 'spec');
    var memo = val(host, 'memo');
    var deal = val(host, 'deal') || '임차';
    var timeline = val(host, 'timeline');
    var rent = val(host, 'rent');

    var title = '[TR] ' + (region || '전국') + ' · ' + sectorLabel(sector) + (area ? ' · ' + area + '평' : '');
    var body = '[TR 임차의뢰]' +
      ' | 지역=' + (region || '미지정') +
      ' | 섹터=' + sectorLabel(sector) +
      ' | 거래=' + deal +
      ' | 면적=' + (area ? area + '평' : '미지정') +
      ' | 임대료·예산=' + (rent || '미지정') +
      ' | 입주시기=' + (timeline || '미지정') +
      (spec ? ' | 스펙=' + spec : '') +
      (memo ? ' | 메모=' + memo : '') +
      ' | 접수경로=웹 ' + (host.getAttribute('data-src') || 'web');

    var btn = $('#trSubmit', host);
    if (btn) { btn.disabled = true; btn.textContent = '접수 중…'; }
    err(host, '');

    var base = CFG.SYNC_URL;
    if (!base) { if (btn) { btn.disabled = false; btn.textContent = 'TR 접수하기'; } err(host, '서버 주소가 설정되지 않았습니다.'); return; }

    var payload = {
      token: getToken(),
      action: 'submit_loi',
      loi: {
        asset_id: 'TR-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36),
        asset_name: title,
        deal_type: deal === '매입' ? '매입' : '임차',
        price: rent,
        area_py: area,
        rent: rent,
        timeline: timeline,
        company: company,
        name: name,
        title: val(host, 'title'),
        phone: phone,
        email: email,
        memo: body
      }
    };

    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (btn) { btn.disabled = false; btn.textContent = 'TR 접수하기'; }
      if (!j || !j.ok) {
        err(host, '접수 실패: ' + ((j && j.error) ? j.error : '알 수 없는 오류'));
        return;
      }
      close();
      toast('TR 임차의뢰를 접수했습니다. 담당자가 후보를 검토해 회신드립니다.');
      if (window.naiMap && window.naiMap.log) {
        window.naiMap.log('tr_submit', title + ' · ' + company + ' · ' + role());
      }
      var el = $('#toast');
      if (el) el.classList.add('ok');
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'TR 접수하기'; }
      err(host, '네트워크 오류로 접수하지 못했습니다. 잠시 후 다시 시도하세요.');
    });
  }

  window.NAI_TR = { open: open, close: close };
})();
