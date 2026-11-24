/* =========================================================================
   Open AI Asset Bridge — trmap.js (📋 TR 임차의뢰 지도 레이어, 2026-11-24)
   -------------------------------------------------------------------------
   접수된 TR(임차 의뢰)를 '희망 권역' 좌표에 수요 핀으로 띄웁니다.
   · 관리자 : 비공개 시트 lois 의 TR 접수(request_type=TR / asset_id TR-) 전체
   · 그 외  : 이 브라우저에서 제출한 TR 내역
   · 지도 탭 좌측 목록·검색·섹터 필터에서 'TR 임차수요' 로 함께 조회됩니다.
   레이어는 기본 OFF 이며, 지도 우측 도구의 [📋 TR 수요] 버튼으로 켜고 끕니다.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var MINE_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':hub:mine:v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* 권역·지역 대표 좌표 (핀은 '권역 중심' 표시이며 개별 물건 위치가 아닙니다) */
  var COORDS = {
    'CBD': [37.5700, 126.9820], '광화문': [37.5716, 126.9769], '종로': [37.5704, 126.9920],
    '을지로': [37.5660, 126.9910], '중구': [37.5636, 126.9975], '명동': [37.5636, 126.9850],
    'GBD': [37.4980, 127.0380], '강남': [37.4979, 127.0276], '역삼': [37.5006, 127.0364],
    '삼성': [37.5088, 127.0631], '서초': [37.4837, 127.0324], '교대': [37.4934, 127.0141],
    'YBD': [37.5215, 126.9240], '여의도': [37.5219, 126.9245], '영등포': [37.5170, 126.8950],
    '마포': [37.5563, 126.9236], '공덕': [37.5441, 126.9515], '상암': [37.5796, 126.8897],
    '성수': [37.5445, 127.0557], '성동': [37.5633, 127.0369], '왕십리': [37.5613, 127.0371],
    '마곡': [37.5601, 126.8253], '강서': [37.5509, 126.8495], '문래': [37.5175, 126.8950],
    '구로': [37.4954, 126.8874], '가산': [37.4810, 126.8827], '금천': [37.4569, 126.8956],
    '판교': [37.3947, 127.1112], '분당': [37.3595, 127.1052], '성남': [37.4199, 127.1265],
    '용인': [37.2411, 127.1776], '수지': [37.3224, 127.0976], '기흥': [37.2804, 127.1147],
    '수원': [37.2636, 127.0286], '화성': [37.1995, 126.8312], '동탄': [37.2000, 127.0950],
    '평택': [36.9921, 127.1129], '안성': [37.0078, 127.2797], '오산': [37.1522, 127.0706],
    '이천': [37.2720, 127.4350], '여주': [37.2985, 127.6370], '광주(경기)': [37.4294, 127.2551],
    '김포': [37.6153, 126.7157], '파주': [37.7599, 126.7800], '고양': [37.6584, 126.8320],
    '일산': [37.6584, 126.7700], '부천': [37.5034, 126.7660], '안양': [37.3943, 126.9568],
    '시흥': [37.3800, 126.8030], '군포': [37.3616, 126.9352], '의왕': [37.3449, 126.9686],
    '광명': [37.4786, 126.8646], '과천': [37.4292, 126.9876], '하남': [37.5393, 127.2148],
    '남양주': [37.6360, 127.2165], '구리': [37.5943, 127.1296], '의정부': [37.7381, 127.0338],
    '양주': [37.7853, 127.0456], '포천': [37.8949, 127.2003], '연천': [38.0967, 127.0749],
    '천안': [36.8151, 127.1139], '아산': [36.7898, 127.0019], '청주': [36.6424, 127.4890],
    '충주': [36.9910, 127.9259], '세종': [36.4800, 127.2890], '대전': [36.3504, 127.3845],
    '논산': [36.1872, 127.0988], '당진': [36.8897, 126.6459], '서산': [36.7849, 126.4503],
    '인천': [37.4563, 126.7052], '송도': [37.3825, 126.6565], '남동': [37.4470, 126.7319],
    '부산': [35.1796, 129.0756], '해운대': [35.1631, 129.1636], '부산진': [35.1629, 129.0532],
    '김해': [35.2342, 128.8894], '양산': [35.3350, 129.0370], '창원': [35.2280, 128.6811],
    '울산': [35.5384, 129.3114], '대구': [35.8714, 128.6014], '구미': [36.1195, 128.3446],
    '포항': [36.0190, 129.3435], '경주': [35.8562, 129.2247], '광주': [35.1595, 126.8526],
    '전주': [35.8242, 127.1480], '익산': [35.9483, 126.9576], '군산': [35.9676, 126.7368],
    '목포': [34.8118, 126.3922], '여수': [34.7604, 127.6622], '순천': [34.9506, 127.4872],
    '원주': [37.3422, 127.9202], '춘천': [37.8813, 127.7300], '강릉': [37.7519, 128.8761],
    '제주': [33.4996, 126.5312], '서귀포': [33.2541, 126.5600]
  };
  var PROVINCE = {
    '서울': [37.5665, 126.9780], '경기': [37.4138, 127.5183], '인천': [37.4563, 126.7052],
    '부산': [35.1796, 129.0756], '대구': [35.8714, 128.6014], '대전': [36.3504, 127.3845],
    '세종': [36.4800, 127.2890], '광주·전남': [35.1595, 126.8526], '광주': [35.1595, 126.8526],
    '충남': [36.5184, 126.8000], '충북': [36.8000, 127.7000], '경남': [35.3000, 128.4000],
    '경북': [36.3000, 128.7000], '전북': [35.7000, 127.1000], '전남': [34.9000, 126.9000],
    '울산': [35.5384, 129.3114], '강원': [37.7000, 128.2000], '제주': [33.4996, 126.5312],
    '전국': [36.5000, 127.8000]
  };

  var S = { items: [], on: false, loaded: false, loading: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }

  function resolveCoord(text) {
    var t = String(text || '');
    var keys = Object.keys(COORDS).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) if (t.indexOf(keys[i]) >= 0) return COORDS[keys[i]];
    var pk = Object.keys(PROVINCE).sort(function (a, b) { return b.length - a.length; });
    for (var j = 0; j < pk.length; j++) if (t.indexOf(pk[j]) >= 0) return PROVINCE[pk[j]];
    return null;
  }

  function regionOf(row) {
    var memo = String(row.memo || '');
    var m = memo.match(/지역\s*[·]?\s*권역?\s*=\s*([^|]+)/) || memo.match(/지역\s*=\s*([^|]+)/);
    if (m && m[1] && m[1].trim() && m[1].trim() !== '미지정') return m[1].trim();
    var nm = String(row.asset_name || '');
    var m2 = nm.match(/\]\s*([^·|]+)/);
    if (m2 && m2[1].trim()) return m2[1].trim();
    if (row.region) return String(row.region);
    return '';
  }

  function isTr(row) {
    var t = String(row.request_type || '');
    if (t) return /TR/.test(t);
    var memo = String(row.memo || '');
    if (/^\[(?:유형=)?TR/.test(memo) || memo.indexOf('[TR') === 0) return true;
    return /^TR-/.test(String(row.asset_id || ''));
  }

  function toAsset(row, i) {
    var rgn = regionOf(row);
    var c = resolveCoord(rgn) || resolveCoord(String(row.asset_name || '')) || null;
    var area = String(row.area_py || '').replace(/[^0-9.,]/g, '');
    var memo = String(row.memo || '');
    var spec = (memo.match(/스펙=([^|]+)/) || [])[1] || (memo.match(/상세 스펙[^=]*=([^|]+)/) || [])[1] || '';
    var rent = String(row.rent || row.price || '');
    var timeline = String(row.timeline || '');
    return {
      id: 'TRQ-' + (row.id || i),
      sector: 'tr',
      sub_type: 'TR 임차의뢰',
      name: String(row.asset_name || ('[TR] ' + (rgn || '권역 미정'))),
      address: rgn ? (rgn + ' (희망 권역 중심 표시)') : '권역 미지정',
      region: rgn || '',
      lat: c ? c[0] : null,
      lng: c ? c[1] : null,
      coord_precision: c ? '권역 중심(추정)' : '좌표 없음',
      owner_amc: String(row.company || ''),
      fund_vehicle: '',
      scale_info: area ? area + '평' : '',
      price_info: rent,
      status: String(row.status || '접수'),
      status_group: '임차수요',
      tenants: String(row.name || '') + (row.title ? ' ' + row.title : ''),
      maturity_schedule: timeline,
      notes: memo,
      source: 'TR 임차의뢰(웹 접수)',
      updated_at: String(row.timestamp || row.at || '').slice(0, 10),
      im_url: '', im_label: '',
      facts: [
        { label: 'TR 구분', value: '임차의뢰' },
        { label: '희망 권역', value: rgn || '미지정' },
        { label: '희망 면적', value: area ? area + '평' : '미지정' },
        { label: '임대료·예산', value: rent || '미지정' },
        { label: '입주 시기', value: timeline || '미지정' },
        { label: '스펙', value: spec || '미기재' },
        { label: '담당', value: [row.company, row.name, row.title].filter(Boolean).join(' ') || '-' },
        { label: '접수일', value: String(row.timestamp || row.at || '').replace('T', ' ').slice(0, 16) }
      ],
      links: [],
      _tr: true
    };
  }

  function apiGet(type) {
    var base = CFG.SYNC_URL;
    if (!base) return Promise.reject(new Error('no_sync'));
    var url = base + (base.indexOf('?') < 0 ? '?' : '&') + 'type=' + type + '&token=' + encodeURIComponent(token());
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }

  function localRows() {
    try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]'); } catch (e) { return []; }
  }

  function load(force) {
    if (S.loading) return S.loading;
    if (S.loaded && !force) return Promise.resolve(S.items);
    S.loading = true;
    var done = function (rows) {
      S.items = rows.filter(isTr).map(toAsset);
      S.loaded = true;
      S.loading = false;
      updateButton();
      return S.items;
    };
    if (!isAdmin()) return Promise.resolve(done(localRows()));
    return apiGet('requests').then(function (j) {
      if (j && j.ok && j.items) return done(j.items);
      return apiGet('lois').then(function (j2) {
        return done((j2 && j2.ok && j2.items) ? j2.items : []);
      });
    }).catch(function () {
      return done(localRows());
    });
  }

  /** app.js buildAssets() 에서 호출 — 레이어가 켜져 있을 때만 수요 핀을 합칩니다 */
  function items() { return S.on ? S.items : []; }

  function updateButton() {
    var b = $('#btnTrLayer');
    if (!b) return;
    b.textContent = '📋 TR 수요' + (S.items.length ? ' ' + S.items.length : '');
    b.classList.toggle('on', S.on);
    b.setAttribute('aria-pressed', String(S.on));
    b.title = S.on ? 'TR 임차의뢰 수요 핀을 지도에 표시 중 — 눌러서 끄기' : 'TR 임차의뢰(임차수요)를 희망 권역에 지도 표시';
  }

  function apply() {
    if (window.naiMap && window.naiMap.reload) window.naiMap.reload();
    updateButton();
    var btnSec = $('[data-sector="tr"]');
    if (btnSec) btnSec.classList.toggle('is-off', !S.on);
  }

  function toggle() {
    if (!S.on) {
      load(true).then(function (list) {
        S.on = true;
        apply();
        if (!list.length) {
          var el = $('#toast');
          if (el) { el.textContent = '표시할 TR 임차의뢰가 없습니다. 홈 › 딜·참여 등록 허브에서 TR을 등록해 보세요.'; el.className = 'toast'; setTimeout(function () { el.classList.add('hidden'); }, 3400); }
        }
      });
    } else {
      S.on = false;
      apply();
    }
  }

  function refresh() { S.loaded = false; return load(true).then(function () { if (S.on) apply(); }); }

  function mount() {
    var tools = document.querySelector('.map-tools');
    if (!tools || $('#btnTrLayer')) return;
    var b = document.createElement('button');
    b.id = 'btnTrLayer';
    b.type = 'button';
    b.className = 'map-btn tr-layer';
    b.textContent = '📋 TR 수요';
    b.addEventListener('click', toggle);
    tools.appendChild(b);
    load(true).then(updateButton);
  }

  window.NAI_TR_LAYER = {
    items: items, all: function () { return S.items; }, load: load, refresh: refresh,
    toggle: toggle, isOn: function () { return S.on; }, regionOf: regionOf, resolveCoord: resolveCoord
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  setTimeout(mount, 1500);
})();
