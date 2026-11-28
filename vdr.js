/* =========================================================================
   Open AI Asset Bridge — vdr.js  (🏢 자문사 VDR · 입찰 워크룸, 2026-11-24)
   ─ JK Value CA·블라인드·VDR·LOI 게이트 추가 (2026-11-28)
   -------------------------------------------------------------------------
   운영 주체 법인: **JK Value** (OAAB 법인). 자산운용사·매도자와 투자자 사이의
   매각자문사로서 딜 데이터를 받아 블라인드로 소개하고, CA 체결 후 상세자료를
   열어 주고, LOI 제출까지 한 흐름으로 연결합니다.

     ① 🔐 정보 공개 3단계 게이트
        Pre-CA  : 블라인드 자산소개서(권역·섹터·규모 밴드·예상가 밴드·주관사·단계)만
        Post-CA : 렌트롤·OPEX·CAPEX·IM·밸류에이션 열람 (열람자 워터마크·로그 기록)
        Post-LOI: 실사자료(VDR) 열람 요청
     ② 전자 CA : 투자자 기관명·담당자·연락처·이메일 + 약관 동의 전자서명 →
        JK Value 승인 게이트 → 승인 시 상세자료 개방
     ③ 📝 LOI 제출 : 제안 매입가·자금조달 구조·인수 조건·유효기간·서명
     ④ 🤖 AI 쇼트리스트 : 접수 후보를 가격 · 자금조달 확실성 · 조건 적합도로 점수화
        (운영자 전용 — 참여자에게는 본인 제출분만 표시)

   저장 — Apps Script Hub.gs 의 시트 vdr_rooms / vdr_docs / vdr_bids
          (+ vdr_cas / jkv_logs / jkv_req — docs/JKV_서버_패치.md 참고)
     GET  ?type=vdr_rooms | vdr_docs&room=<id> | vdr_bids&room=<id> | vdr_cas&room=<id>
     POST {action:'vdr_room_save'|'vdr_doc_save'|'vdr_doc_delete'|'vdr_bid_submit'
                  |'vdr_bid_status'|'vdr_ca_submit'|'vdr_ca_status'|'jkv_log'|'jkv_req_save'}
   서버 API 가 없으면 같은 브라우저(localStorage)로 동작하고 화면에 "로컬 모드"로
   표시합니다(자문사·참여자가 다른 기기면 공유되지 않음).
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var PREFIX = CFG.STORAGE_PREFIX || 'nai-map';
  var TOKEN_KEY = PREFIX + ':token:v1';
  var LS_KEY = PREFIX + ':vdr:v1';
  var JKV_KEY = PREFIX + ':jkv:v1';
  var MYCA_KEY = PREFIX + ':jkv:myca:v1';
  var ROOMMETA_KEY = PREFIX + ':jkv:rooms:v1';
  var BLIND_FIELDS = ['asset_id','sector','sub_market','gfa_pyeong','site_pyeong','occupancy_pct','built_year',
    'wale_years','tenant_profile','deal_type','timeline','ltv_band','special_note','advisor','tm_url','im_url'];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var DOC_KINDS = [
    { k: 'RFP', label: 'RFP · 매각 조건', icon: '📄', cols: ['항목', '내용'], hint: '한 줄에 "항목 | 내용" 형식으로 입력합니다.' },
    { k: 'RENTROLL', label: '렌트롤 (Rent Roll)', icon: '🏢', cols: ['층·구역', '임차인', '면적(평)', '임대료(원/평·월)', '만기', '비고'], hint: '한 줄에 "층 | 임차인 | 면적 | 임대료 | 만기 | 비고" 형식입니다.' },
    { k: 'OPEX', label: 'OPEX (운영비)', icon: '🧾', cols: ['항목', '금액(억/년)', '비고'], hint: '한 줄에 "항목 | 금액 | 비고" 형식입니다.' },
    { k: 'CAPEX', label: 'CAPEX (투자비)', icon: '🏗️', cols: ['항목', '금액(억)', '시기', '비고'], hint: '한 줄에 "항목 | 금액 | 시기 | 비고" 형식입니다.' }
  ];
  var STAGES = ['자료 배포', 'LOI 접수', '실사', '최종 입찰', '우선협상', '종결'];
  var FUNDING = ['확약(Commitment)', '조건부(Conditional)', '미확보'];
  var CA_SCOPES = [
    '블라인드 자산소개서(Teaser)',
    'IM(Information Memorandum) 원문',
    '렌트롤·OPEX·CAPEX 상세',
    '밸류에이션 모델·수익 분석',
    '실사자료(VDR 전체)'
  ];
  var CA_STATUS = { none: 'CA 미제출', 심사중: 'JK Value 검토중', 승인: 'CA 승인', 반려: 'CA 반려' };

  var S = {
    rooms: [], docsByRoom: {}, bidsByRoom: {}, casByRoom: {}, reqsByRoom: {}, logs: [],
    roomId: '', tab: 'blind', loaded: false, loading: false, mode: 'server', err: '',
    weights: { price: 40, funding: 30, terms: 30 }, asInvestor: false
  };

  /* ─────────────────────────── 공통 유틸 ─────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function n0(v) { var x = Number(v); return isFinite(x) ? x.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '-'; }
  function num(v, d) { var x = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(x) ? x : (d === undefined ? 0 : d); }
  function today() { var d = new Date(); return d.toISOString().slice(0, 10); }
  function nowISO() { return new Date().toISOString(); }
  function fmtDT(v) {
    if (!v) return '-';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }
  function isOperator() { var r = role(); return r === 'admin' || r === 'internal'; }
  /* 운영자도 '투자자 시점 미리보기'를 켜면 블라인드·CA 게이트를 그대로 체험합니다. */
  function operatorView() { return isOperator() && !S.asInvestor; }
  function me() { return (window.naiMap && window.naiMap.me) ? window.naiMap.me() : null; }

  function hash36(str) {
    var h = 5381, i;
    for (i = 0; i < String(str).length; i++) h = ((h << 5) + h + String(str).charCodeAt(i)) | 0;
    return Math.abs(h).toString(36).toUpperCase().slice(0, 4);
  }
  function sigHash(str) {
    var h1 = 0x811c9dc5, h2 = 0x1000193, i, c;
    for (i = 0; i < String(str).length; i++) {
      c = String(str).charCodeAt(i);
      h1 = ((h1 ^ c) * 16777619) >>> 0;
      h2 = ((h2 + c * 31) * 2654435761) >>> 0;
    }
    return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
  }

  function toast(msg, err) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 3400);
  }

  /* ─────────────────────────── 저장 계층 ─────────────────────────── */
  function lsAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function lsSave(obj) { try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch (e) { /* noop */ } }

  function jkvAll() {
    var db;
    try { db = JSON.parse(localStorage.getItem(JKV_KEY) || '{}') || {}; } catch (e) { db = {}; }
    db.cas = db.cas || []; db.logs = db.logs || []; db.reqs = db.reqs || [];
    return db;
  }
  function jkvSave(obj) { try { localStorage.setItem(JKV_KEY, JSON.stringify(obj)); } catch (e) { /* noop */ } }

  function myRefAll() {
    try { return JSON.parse(localStorage.getItem(MYCA_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function myRefSave(roomId, ref) {
    var all = myRefAll();
    all[roomId] = ref;
    try { localStorage.setItem(MYCA_KEY, JSON.stringify(all)); } catch (e) { /* noop */ }
  }
  function myRef(roomId) { return myRefAll()[roomId] || null; }

  /* 블라인드 표기 메타 — 서버 vdr_rooms 시트에 아직 없는 컬럼을 브라우저에 보존합니다.
     (시트에 컬럼을 추가하면 서버값이 우선하고, 없으면 이 값으로 보완) */
  function roomMetaAll() {
    try { return JSON.parse(localStorage.getItem(ROOMMETA_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveRoomMeta(room) {
    var all = roomMetaAll(), meta = all[room.id] || {};
    BLIND_FIELDS.forEach(function (k) { if (room[k] !== undefined && room[k] !== '') meta[k] = room[k]; });
    all[room.id] = meta;
    try { localStorage.setItem(ROOMMETA_KEY, JSON.stringify(all)); } catch (e) { /* noop */ }
  }
  function applyRoomMeta(rooms) {
    var all = roomMetaAll();
    (rooms || []).forEach(function (r) {
      var m = all[r.id];
      if (!m) return;
      BLIND_FIELDS.forEach(function (k) { if ((r[k] === undefined || r[k] === '') && m[k] !== undefined) r[k] = m[k]; });
    });
    return rooms;
  }

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

  function docRows(text) {
    return String(text || '').split(/\n+/).map(function (line) {
      var cells = line.split('|').map(function (c) { return c.trim(); });
      return cells.some(Boolean) ? cells : null;
    }).filter(Boolean);
  }
  function rowsToText(rows) {
    return (rows || []).map(function (r) { return (Array.isArray(r) ? r : [r]).join(' | '); }).join('\n');
  }

  /* ─────────────────────────── 신원 · 권한 ─────────────────────────── */
  function myIdentity() {
    var m = me() || {};
    return {
      company: String(m.company || '').trim(),
      name: String(m.name || m.bidder || '').trim(),
      email: String(m.email || '').trim(),
      title: String(m.title || '').trim()
    };
  }
  function viewerLabel(roomId) {
    var it = myIdentity();
    if (operatorView()) {
      return { company: it.company || 'JK Value', name: it.name || '운영자', email: it.email };
    }
    var c = caFor(roomId);
    if (c) return { company: c.company || it.company || '-', name: c.name || it.name || '-', email: c.email || it.email || '' };
    return { company: it.company || '미인증 방문자', name: it.name || '-', email: it.email };
  }

  /* ─────────────────────────── CA 상태 ─────────────────────────── */
  function caList(roomId) {
    var list = (S.casByRoom[roomId] || []).slice();
    var local = (jkvAll().cas || []).filter(function (c) { return c.room_id === roomId; });
    local.forEach(function (l) {
      var hit = false;
      for (var i = 0; i < list.length; i++) if (list[i].id === l.id) { list[i] = l; hit = true; break; }
      if (!hit) list.push(l);
    });
    return list.sort(function (a, b) { return String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')); });
  }
  function caFor(roomId) {
    var list = caList(roomId);
    var ref = myRef(roomId);
    var i;
    if (ref && ref.id) {
      for (i = 0; i < list.length; i++) if (list[i].id === ref.id) return list[i];
    }
    var id = myIdentity();
    var hit = null;
    for (i = 0; i < list.length; i++) {
      var c = list[i];
      if (id.email && c.email && String(c.email).toLowerCase() === id.email.toLowerCase()) { hit = c; break; }
      if (!hit && id.name && c.name === id.name && (!id.company || c.company === id.company)) hit = c;
    }
    return hit || (ref && ref.draft ? ref.draft : null);
  }
  function caStatus(roomId) {
    if (operatorView()) return '승인';
    var c = caFor(roomId);
    if (!c) return 'none';
    return c.status === '승인' ? '승인' : (c.status === '반려' ? '반려' : '심사중');
  }
  function hasAccess(roomId) { return caStatus(roomId) === '승인'; }
  function hasPending(roomId) { return caStatus(roomId) === '심사중'; }

  function myBids(roomId) {
    var all = (S.bidsByRoom[roomId] || []).slice();
    if (operatorView()) return all;
    var ref = myRef(roomId), id = myIdentity();
    return all.filter(function (b) {
      if (ref && ref.bid_ids && ref.bid_ids.indexOf(b.id) >= 0) return true;
      if (id.email && b.email && String(b.email).toLowerCase() === id.email.toLowerCase()) return true;
      return !!(id.name && b.bidder === id.name && (!id.company || b.company === id.company));
    });
  }
  function myLoi(roomId) {
    return myBids(roomId).filter(function (b) { return String(b.kind || 'LOI').toUpperCase() !== 'BID'; });
  }
  function hasDd(roomId) { return operatorView() || (hasAccess(roomId) && myLoi(roomId).length > 0); }

  /* ─────────────────────────── 블라인드 산출 ─────────────────────────── */
  function linkedAsset(room) {
    var st = window.naiMap && window.naiMap.state;
    if (!st) return null;
    if (room && room.asset_id && st.index && st.index[room.asset_id]) return st.index[room.asset_id];
    var nm = String((room && room.asset_name) || '').replace(/\(.*?\)/g, '').trim();
    if (!nm) return null;
    var list = st.list || [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a && a.name && (String(a.name).indexOf(nm) >= 0 || nm.indexOf(String(a.name)) >= 0)) return a;
    }
    return null;
  }
  function sectorLabelOf(room, a) {
    var key = (room && room.sector) || (a && a.sector) || '';
    if (!key) return '상업용 부동산';
    var s = (CFG.SECTORS || {})[key];
    return s ? s.label : key;
  }
  function blindCode(room) { return 'JV-' + hash36((room && room.id) || (room && room.name) || 'room'); }
  function parsePyeong(txt) {
    var s = String(txt || '');
    var m = s.match(/([0-9][0-9,.]*)\s*평/);
    if (m) return num(m[1].replace(/,/g, ''));
    m = s.match(/([0-9][0-9,.]*)\s*(㎡|m2|제곱미터)/);
    if (m) return num(m[1].replace(/,/g, '')) / 3.3058;
    m = s.match(/([0-9][0-9,.]*)/);
    if (m) { var v = num(m[1].replace(/,/g, '')); return v > 3000 ? v / 3.3058 : v; }
    return 0;
  }
  function scaleBand(p) {
    if (!p) return 'CA 체결 후 공개';
    if (p < 5000) return '5,000평 미만';
    if (p < 10000) return '5,000~1만평';
    if (p < 20000) return '1만~2만평';
    if (p < 30000) return '2만~3만평';
    if (p < 50000) return '3만~5만평';
    return '5만평 이상';
  }
  function priceBand(eok) {
    var x = num(eok);
    if (!x) return 'CA 체결 후 공개';
    if (x < 300) return '300억 미만';
    if (x < 1000) return '300억~1,000억';
    if (x < 3000) return '1,000억~3,000억';
    if (x < 5000) return '3,000억~5,000억';
    if (x < 10000) return '5,000억~1조';
    return '1조 이상';
  }
  function occBand(pct) {
    var x = num(pct);
    if (!x) return 'CA 체결 후 공개';
    if (x >= 95) return '95% 이상 (사실상 만실)';
    if (x >= 90) return '90~95%';
    if (x >= 80) return '80~90%';
    if (x >= 70) return '70~80%';
    return '70% 미만';
  }
  function regionOf(room, a) {
    if (room && room.sub_market) return room.sub_market;
    var addr = (a && a.address) || '';
    var city = (addr.match(/^(서울|부산|인천|대구|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/) || [])[0] || '';
    var gu = (addr.match(/([가-힣]{1,6}(구|군|시))/g) || []);
    var hit = gu.filter(function (g) { return /구$/.test(g); })[0] || gu[0] || '';
    if (city || hit) return [city, hit].filter(Boolean).join(' ');
    return (room && room.region) || (a && a.region) || '수도권';
  }
  function roomPyeong(room, a) {
    if (room && room.gfa_pyeong) return num(room.gfa_pyeong);
    return parsePyeong((a && (a.scale_info || a.gfa)) || '');
  }
  function dealTypeOf(room) { return (room && room.deal_type) || '에셋딜 · 지분 협의 가능'; }
  function timelineOf(room) {
    if (room && room.timeline) return room.timeline;
    var parts = [];
    if (room && room.loi_deadline) parts.push('LOI ' + room.loi_deadline);
    if (room && room.bid_deadline) parts.push('입찰 ' + room.bid_deadline);
    return parts.join(' · ') || 'CA 체결 후 자료 배포 일정 안내';
  }

  /* ─────────────────────────── 데이터 로드 ─────────────────────────── */
  function localRooms() {
    var db = lsAll();
    return { rooms: db.rooms || [], docs: db.docs || [], bids: db.bids || [] };
  }

  function loadRooms(force) {
    if (S.loading) return S.loading;
    if (S.loaded && !force) return Promise.resolve(S.rooms);
    S.loading = true;
    return apiGet('type=vdr_rooms').then(function (j) {
      if (j && j.ok && j.items) {
        S.rooms = applyRoomMeta(j.items);
        S.mode = 'server';
        S.loaded = true; S.loading = false;
        return S.rooms;
      }
      throw new Error('no_api');
    }).catch(function () {
      var db = localRooms();
      S.rooms = applyRoomMeta(db.rooms);
      S.mode = 'local';
      S.loaded = true; S.loading = false;
      return S.rooms;
    });
  }

  function loadRoomData(roomId, force) {
    if (!roomId) return Promise.resolve();
    if (S.docsByRoom[roomId] && !force) return Promise.resolve();
    if (S.mode === 'local') {
      var db = localRooms();
      S.docsByRoom[roomId] = (db.docs || []).filter(function (d) { return d.room_id === roomId; });
      S.bidsByRoom[roomId] = (db.bids || []).filter(function (b) { return b.room_id === roomId; });
      var jd = jkvAll();
      S.casByRoom[roomId] = jd.cas.filter(function (c) { return c.room_id === roomId; });
      S.reqsByRoom[roomId] = jd.reqs.filter(function (r) { return r.room_id === roomId; });
      S.logs = jd.logs;
      return Promise.resolve();
    }
    return Promise.all([
      apiGet('type=vdr_docs&room=' + encodeURIComponent(roomId)).catch(function () { return null; }),
      apiGet('type=vdr_bids&room=' + encodeURIComponent(roomId)).catch(function () { return null; }),
      apiGet('type=vdr_cas&room=' + encodeURIComponent(roomId)).catch(function () { return null; })
    ]).then(function (res) {
      S.docsByRoom[roomId] = ((res[0] && res[0].items) || []);
      S.bidsByRoom[roomId] = ((res[1] && res[1].items) || []);
      S.casByRoom[roomId] = ((res[2] && res[2].items) || []);
      var jd = jkvAll();
      S.reqsByRoom[roomId] = jd.reqs.filter(function (r) { return r.room_id === roomId; });
      S.logs = jd.logs;
    });
  }

  function persistDoc(doc) {
    if (S.mode === 'local') {
      var db = lsAll();
      db.docs = db.docs || [];
      var i = -1;
      db.docs.forEach(function (d, idx) { if (d.id === doc.id) i = idx; });
      if (i >= 0) db.docs[i] = doc; else db.docs.push(doc);
      lsSave(db);
      S.docsByRoom[doc.room_id] = db.docs.filter(function (d) { return d.room_id === doc.room_id; });
      return Promise.resolve({ ok: true, local: true });
    }
    return apiPost({ action: 'vdr_doc_save', doc: doc });
  }
  function persistRoom(room) {
    if (S.mode === 'local') {
      var db = lsAll();
      db.rooms = db.rooms || [];
      var i = -1;
      db.rooms.forEach(function (r, idx) { if (r.id === room.id) i = idx; });
      if (i >= 0) db.rooms[i] = room; else db.rooms.push(room);
      lsSave(db);
      S.rooms = db.rooms;
      return Promise.resolve({ ok: true, local: true });
    }
    return apiPost({ action: 'vdr_room_save', room: room });
  }
  function persistBid(bid) {
    if (S.mode === 'local') {
      var db = lsAll();
      db.bids = db.bids || [];
      db.bids.push(bid);
      lsSave(db);
      S.bidsByRoom[bid.room_id] = db.bids.filter(function (b) { return b.room_id === bid.room_id; });
      return Promise.resolve({ ok: true, local: true });
    }
    return apiPost({ action: 'vdr_bid_submit', bid: bid });
  }
  /** CA·로그·요청은 서버 시트가 아직 없을 수 있어 실패해도 로컬에 반드시 남깁니다. */
  function persistCA(ca) {
    var db = jkvAll();
    var i = -1;
    db.cas.forEach(function (c, idx) { if (c.id === ca.id) i = idx; });
    if (i >= 0) db.cas[i] = ca; else db.cas.push(ca);
    jkvSave(db);
    var list = (S.casByRoom[ca.room_id] || []).slice();
    var hit = false;
    for (var k = 0; k < list.length; k++) if (list[k].id === ca.id) { list[k] = ca; hit = true; break; }
    if (!hit) list.unshift(ca);
    S.casByRoom[ca.room_id] = list;
    if (S.mode === 'local') return Promise.resolve({ ok: true, local: true });
    return apiPost({ action: 'vdr_ca_submit', ca: ca })
      .then(function (j) { return (j && j.ok) ? j : { ok: true, local: true }; })
      .catch(function () { return { ok: true, local: true }; });
  }
  function persistLog(roomId, action, detail) {
    var v = viewerLabel(roomId);
    var rec = {
      id: 'jkvl-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 900 + 100),
      room_id: roomId, company: v.company, name: v.name, email: v.email,
      action: action, detail: detail || '', at: nowISO(), role: role()
    };
    var db = jkvAll();
    db.logs.push(rec);
    if (db.logs.length > 500) db.logs = db.logs.slice(-500);
    jkvSave(db);
    S.logs = db.logs;
    if (S.mode === 'server') apiPost({ action: 'jkv_log', log: rec }).catch(function () { /* noop */ });
    return rec;
  }
  function persistReq(roomId, kind, memo) {
    var v = viewerLabel(roomId);
    var rec = {
      id: 'jkvr-' + Date.now().toString(36), room_id: roomId, kind: kind || 'IM·티저',
      company: v.company, name: v.name, email: v.email, memo: memo || '',
      status: '요청 접수', at: nowISO()
    };
    var db = jkvAll();
    db.reqs.push(rec);
    jkvSave(db);
    var list = (S.reqsByRoom[roomId] || []).slice();
    list.push(rec);
    S.reqsByRoom[roomId] = list;
    if (S.mode === 'server') apiPost({ action: 'jkv_req_save', req: rec }).catch(function () { /* noop */ });
    return rec;
  }

  /* ─────────────────────────── 룸 선택 · 병합 ─────────────────────────── */
  function selectedRoom() {
    for (var i = 0; i < S.rooms.length; i++) if (S.rooms[i].id === S.roomId) return S.rooms[i];
    return S.rooms[0] || null;
  }
  function docOf(roomId, kind) {
    var list = S.docsByRoom[roomId] || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].kind).toUpperCase() === kind) return list[i];
    return null;
  }
  function bidsOf(roomId) { return (S.bidsByRoom[roomId] || []).slice(); }

  function mergeDocLocal(doc) {
    var list = (S.docsByRoom[doc.room_id] || []).slice();
    var hit = false;
    for (var i = 0; i < list.length; i++) if (list[i].id === doc.id) { list[i] = doc; hit = true; break; }
    if (!hit) list.push(doc);
    S.docsByRoom[doc.room_id] = list;
  }
  function mergeBidLocal(bid) {
    var list = (S.bidsByRoom[bid.room_id] || []).slice();
    var hit = false;
    for (var i = 0; i < list.length; i++) if (list[i].id === bid.id) { list[i] = bid; hit = true; break; }
    if (!hit) list.push(bid);
    S.bidsByRoom[bid.room_id] = list;
  }
  function mergeRoomLocal(room) {
    var hit = false;
    for (var i = 0; i < S.rooms.length; i++) if (S.rooms[i].id === room.id) { S.rooms[i] = room; hit = true; break; }
    if (!hit) S.rooms.push(room);
  }

  /* ─────────────────────────── AI 쇼트리스트 (운영자 전용) ─────────────────────────── */
  function scoreBids(roomId) {
    var bids = bidsOf(roomId);
    if (!bids.length) return null;
    var w = S.weights;
    var total = num(w.price) + num(w.funding) + num(w.terms) || 100;
    var maxPrice = 0;
    bids.forEach(function (b) { maxPrice = Math.max(maxPrice, num(b.price_eok)); });
    var guide = num((selectedRoom() || {}).price_guide_eok);
    var base = Math.max(maxPrice, guide, 1);

    var scored = bids.map(function (b) {
      var p = num(b.price_eok);
      var pricePts = Math.max(0, Math.min(1, p / base)) * num(w.price);
      if (guide > 0 && p < guide) pricePts *= 0.9;
      var priceRatio = base > 0 ? p / base : 0;

      var fBase = String(b.funding || '').indexOf('확약') === 0 ? 1 : (String(b.funding || '').indexOf('조건부') === 0 ? 0.68 : 0.3);
      var ltv = num(b.ltv_pct);
      var ltvAdj = ltv > 0 ? (ltv <= 65 ? 0.1 : (ltv <= 75 ? 0 : -0.12)) : 0;
      var fundPts = Math.max(0, Math.min(1, fBase + ltvAdj)) * num(w.funding);

      var accept = String(b.accept || '');
      var aPts = /전부|전체|수용/.test(accept) && !/일부|이의/.test(accept) ? 0.44 : (/일부/.test(accept) ? 0.26 : 0.1);
      var dd = num(b.dd_days);
      var ddPts = dd <= 0 ? 0.2 : (dd <= 14 ? 0.3 : (dd <= 30 ? 0.22 : (dd <= 45 ? 0.14 : 0.06)));
      var closeMonths = num(b.close_months);
      var tPts = closeMonths <= 0 ? 0.26 : (closeMonths <= 2 ? 0.26 : (closeMonths <= 3 ? 0.2 : (closeMonths <= 6 ? 0.13 : 0.06)));
      var termsPts = Math.min(1, aPts + ddPts + tPts) * num(w.terms);

      var totalPts = pricePts + fundPts + termsPts;
      var score = Math.round(totalPts / total * 100);
      var grade = score >= 80 ? 'A' : (score >= 65 ? 'B' : (score >= 50 ? 'C' : 'D'));
      return {
        bid: b, score: score, grade: grade,
        price: p, pricePts: pricePts, fundPts: fundPts, termsPts: termsPts, priceRatio: priceRatio,
        priceScore: Math.round(pricePts / (num(w.price) || 1) * 100),
        fundScore: Math.round(fundPts / (num(w.funding) || 1) * 100),
        termsScore: Math.round(termsPts / (num(w.terms) || 1) * 100)
      };
    }).sort(function (a, b) { return b.score - a.score; });

    scored.forEach(function (x, i) { x.rank = i + 1; });
    return scored;
  }

  function reasonsFor(x) {
    var out = [];
    var b = x.bid;
    if (x.rank === 1) out.push('최고 종합점수');
    if (num(b.price_eok) >= num((selectedRoom() || {}).price_guide_eok) && num((selectedRoom() || {}).price_guide_eok) > 0) out.push('가이드가 이상');
    if (String(b.funding || '').indexOf('확약') === 0) out.push('자금조달 확약');
    else if (String(b.funding || '').indexOf('조건부') === 0) out.push('자금조달 조건부');
    else out.push('자금조달 미확보');
    if (num(b.ltv_pct) > 75) out.push('LTV 높음(' + n0(b.ltv_pct) + '%)');
    if (num(b.dd_days) > 0) out.push('실사 ' + n0(b.dd_days) + '일');
    if (num(b.close_months) > 0) out.push('인수 ' + n0(b.close_months) + '개월');
    if (/일부|이의/.test(String(b.accept || ''))) out.push('조건 협의 필요');
    return out;
  }

  function shortlistHTML(roomId) {
    var scored = scoreBids(roomId);
    var room = selectedRoom() || {};
    if (!scored) {
      return '<div class="vdr-empty">아직 접수된 LOI·입찰이 없습니다. <b>📝 LOI 제출</b>에서 후보를 등록하면 즉시 쇼트리스트가 생성됩니다.</div>';
    }
    var w = S.weights;
    var top = scored[0];
    var h = '<div class="vdr-ai">';
    h += '<div class="vdr-ai-head"><div><b>🤖 AI 쇼트리스트</b>' +
      '<span>가격 ' + n0(w.price) + ' · 자금조달 확실성 ' + n0(w.funding) + ' · 조건 적합도 ' + n0(w.terms) + ' 가중 채점 (브라우저 내 계산)</span></div>' +
      '<span class="vdr-ai-count">접수 ' + scored.length + '건</span></div>';
    h += '<div class="vdr-ai-weights">' +
      ['price', 'funding', 'terms'].map(function (k) {
        var lb = k === 'price' ? '가격' : (k === 'funding' ? '자금조달' : '조건');
        return '<label>' + lb + ' <input type="number" min="0" max="100" step="5" data-vdr-w="' + k + '" value="' + n0(w[k]) + '"></label>';
      }).join('') + '<button type="button" class="mini-btn" data-vdr="wreset">가중치 초기화</button></div>';

    h += '<div class="vdr-rec"><span class="vdr-rec-badge">추천 1순위</span>' +
      '<b>' + esc(top.bid.company || top.bid.bidder || '-') + '</b>' +
      '<em>' + n0(top.price) + '억 · ' + esc(top.bid.funding || '-') + ' · 종합 ' + top.score + '점(' + top.grade + ')</em>' +
      '<p>' + esc(reasonsFor(top).join(' · ')) + '</p></div>';

    h += '<div class="vdr-table-wrap"><table class="vdr-table vdr-rank"><thead><tr>' +
      '<th>순위</th><th>후보</th><th>제시가</th><th>가이드 대비</th><th>자금조달</th><th>LTV</th>' +
      '<th>조건</th><th>가격점</th><th>자금점</th><th>조건점</th><th>종합</th><th>등급</th></tr></thead><tbody>';
    scored.forEach(function (x) {
      var b = x.bid;
      var guidePct = (room.price_guide_eok && num(room.price_guide_eok) > 0) ? (x.price / num(room.price_guide_eok) * 100) : 0;
      h += '<tr' + (x.rank === 1 ? ' class="top"' : '') + '>' +
        '<td class="ctr"><b>' + x.rank + '</b></td>' +
        '<td><b>' + esc(b.company || '-') + '</b><span class="vdr-sub">' + esc([b.bidder, b.title].filter(Boolean).join(' ')) + '</span></td>' +
        '<td class="num"><b>' + n0(x.price) + '억</b><span class="vdr-sub">' + esc(b.kind || 'LOI') + '</span></td>' +
        '<td class="num">' + (guidePct ? guidePct.toFixed(1) + '%' : '-') + '</td>' +
        '<td>' + esc(b.funding || '-') + '</td>' +
        '<td class="num">' + (b.ltv_pct ? n0(b.ltv_pct) + '%' : '-') + '</td>' +
        '<td class="vdr-terms">' + esc([b.accept, (b.dd_days ? '실사 ' + b.dd_days + '일' : ''), (b.close_months ? b.close_months + '개월' : '')].filter(Boolean).join(' · ')) + '</td>' +
        '<td class="num">' + x.priceScore + '</td><td class="num">' + x.fundScore + '</td><td class="num">' + x.termsScore + '</td>' +
        '<td class="num total"><b>' + x.score + '</b></td>' +
        '<td class="ctr"><span class="vdr-grade g' + x.grade + '">' + x.grade + '</span></td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="vdr-note">점수는 <b>가격(최고가·가이드 대비) · 자금조달 확실성(확약/조건부/미확보 + LTV) · 조건 적합도(조건 수용도·실사기간·인수시점)</b>를 가중 합산한 참고 지표입니다. ' +
      '법률·회계 검토나 평판·이해관계 충돌은 반영되지 않으므로 최종 판단은 담당자가 합니다.</p>';
    h += '</div>';
    return h;
  }

  /* ─────────────────────────── 워터마크 · 배지 ─────────────────────────── */
  function wmText(roomId) {
    var v = viewerLabel(roomId);
    return v.company + ' · ' + v.name + ' · ' + fmtDT(nowISO());
  }
  function wmHTML(roomId) {
    var t = wmText(roomId);
    var rows = [];
    for (var i = 0; i < 6; i++) {
      rows.push('<span>' + esc(t) + '</span>');
    }
    return '<div class="jkv-wm" aria-hidden="true">' + rows.join('') + '</div>';
  }
  function wmBadge(roomId) {
    var v = viewerLabel(roomId);
    return '<div class="jkv-wm-badge">🔖 열람자 워터마크 · <b>' + esc(v.company) + '</b> ' + esc(v.name) +
      '<span>적용 ' + fmtDT(nowISO()) + ' · 모든 열람은 로그로 기록됩니다</span></div>';
  }

  /* ─────────────────────────── 룸 목록 ─────────────────────────── */
  function roomListHTML() {
    if (!S.rooms.length) {
      return '<div class="vdr-empty">등록된 딜룸이 없습니다.' + (isOperator() ? '<br><b>＋ 새 딜룸</b>으로 매각·입찰 건을 만들거나 <b>예시 딜룸</b>을 넣어 화면을 확인해 보세요.' : '<br>JK Value 가 딜룸을 열면 여기에 표시됩니다.') + '</div>';
    }
    return S.rooms.map(function (r) {
      var on = r.id === S.roomId;
      var bids = (S.bidsByRoom[r.id] || []);
      var ok = hasAccess(r.id);
      var title = ok ? (r.name || '딜룸') : ('블라인드 ' + blindCode(r) + ' · ' + sectorLabelOf(r, linkedAsset(r)) + ' 매각');
      var sub = ok ? (r.asset_name || '') : (regionOf(r, linkedAsset(r)) + ' · ' + scaleBand(roomPyeong(r, linkedAsset(r))));
      var price = ok ? (r.price_guide_eok ? '가이드 ' + n0(r.price_guide_eok) + '억 · ' : '') : ('예상 ' + priceBand(r.price_guide_eok) + ' · ');
      return '<button type="button" class="vdr-room' + (on ? ' on' : '') + '" data-vdr-room="' + esc(r.id) + '">' +
        '<span class="vr-stage">' + esc(r.stage || '자료 배포') + '</span>' +
        '<strong>' + esc(title) + '</strong>' +
        '<span class="vr-asset">' + esc(sub) + '</span>' +
        '<span class="vr-meta">' + esc(price) + 'LOI ' + esc(r.loi_deadline || '미정') + '</span>' +
        '<span class="vr-n">' + (ok ? '접수 ' + bids.length + '건' : '🔒 CA 체결 전') + '</span></button>';
    }).join('');
  }

  /* ─────────────────────────── 블라인드 자산소개서 ─────────────────────────── */
  function teaserRows(room, a) {
    var p = roomPyeong(room, a);
    var rows = [
      ['자산 유형', sectorLabelOf(room, a)],
      ['소재 권역', regionOf(room, a)],
      ['규모 (연면적)', scaleBand(p)],
      ['대지면적', room.site_pyeong ? scaleBand(num(room.site_pyeong)) : 'CA 체결 후 공개'],
      ['준공', room.built_year ? String(room.built_year) + '년' : 'CA 체결 후 공개'],
      ['임대율', occBand(room.occupancy_pct)],
      ['주요 임차인', room.tenant_profile || 'CA 체결 후 공개'],
      ['WALE', room.wale_years ? n0(room.wale_years) + '년' : 'CA 체결 후 공개'],
      ['거래 구조', dealTypeOf(room)],
      ['예상 거래가', priceBand(room.price_guide_eok)],
      ['자금조달 가정', room.ltv_band || 'CA 체결 후 공개'],
      ['진행 단계', room.stage || '자료 배포'],
      ['예상 일정', timelineOf(room)],
      ['주관', room.advisor || 'JK Value (매각자문)'],
      ['특이사항', room.special_note || 'CA 체결 후 공개'],
      ['자료 공개 단계', hasAccess(room.id) ? 'CA 체결 완료 — 상세자료 열람 가능' : '블라인드 자산소개서(Pre-CA)']
    ];
    return rows;
  }

  function blindTabHTML(room) {
    var a = linkedAsset(room);
    var ok = hasAccess(room.id);
    var rows = teaserRows(room, a);
    var h = '<div class="jkv-teaser-wrap">';
    if (!S.asInvestor && isOperator()) {
      h += '<div class="jkv-op-note">🛠️ <b>운영자 시점</b>입니다. 오른쪽 <b>투자자 시점 미리보기</b>를 켜면 CA 체결 전 투자자에게 보이는 화면(마스킹·잠금)을 그대로 확인할 수 있습니다.</div>';
    }
    h += wmBadge(room.id);
    h += '<div class="jkv-teaser">' + wmHTML(room.id);
    h += '<div class="jkv-teaser-head"><div>' +
      '<span class="jkv-brand">JK VALUE</span>' +
      '<h4>블라인드 자산소개서 <span>Teaser · Pre-CA</span></h4>' +
      '<p>' + esc(ok ? 'CA 체결 완료 — 아래 상세자료 열람이 열려 있습니다.' : 'CA 체결 전 공개 범위입니다. 자산 식별정보와 상세 자료는 CA 승인 후 제공됩니다.') + '</p>' +
      '</div><div class="jkv-code"><b>' + esc(blindCode(room)) + '</b><span>Blind ID</span></div></div>';
    h += '<div class="jkv-grid">' + rows.map(function (r) {
      return '<div class="jkv-cell"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>';
    }).join('') + '</div>';

    if (!ok) {
      h += '<div class="jkv-locked">' +
        '<div class="jkv-locked-head"><b>🔒 CA 체결 후 공개</b><span>JK Value · 매각자문사/운용사 앞 전자 CA 승인 시 열람</span></div>' +
        '<ul>' +
        '<li>렌트롤(Rent Roll) — 임차인·면적·임대료·만기</li>' +
        '<li>OPEX · CAPEX 상세와 연간 수지</li>' +
        '<li>IM(Information Memorandum) 원문 · 티저 파일</li>' +
        '<li>밸류에이션 모델 · 시장 환경 분석</li>' +
        '<li>물건 상세 주소 · 자산명</li>' +
        '</ul>' +
        '<div class="jkv-cta"><button type="button" class="btn jkv-btn-primary" data-vdr="ca-new">🔐 전자 CA 제출하고 상세자료 열람</button>' +
        '<button type="button" class="mini-btn" data-vdr="ca-terms">CA 표준 조항 보기</button></div>' +
        '<p class="jkv-note">CA 제출 → JK Value 검토·승인 → 상세자료 열람(열람자 회사명·이름·시각 워터마크 및 로그 기록) → LOI 제출 순으로 진행됩니다.</p>' +
        '</div>';
    } else {
      h += '<div class="jkv-open"><b>✅ CA 체결 완료</b><span>' +
        esc((caFor(room.id) || {}).id || 'JK Value 승인') + ' · 상세자료·밸류에이션·LOI 제출이 열려 있습니다.</span>' +
        '<button type="button" class="btn jkv-btn-primary" data-vdr-tab="docs">📁 상세자료 열람</button>' +
        '<button type="button" class="mini-btn" data-vdr-tab="loi">📝 LOI 제출</button></div>';
    }
    h += '<p class="jkv-source">* 자료 기준 : JK Value 플랫폼 등록 정보 · 매도인(자산운용사) 제공 자료 · CA 체결 전에는 밴드·권역 단위로만 표시</p>';
    h += '</div></div>';
    return h;
  }

  /* ─────────────────────────── 자료 관리 (게이트) ─────────────────────────── */
  function lockedDocHTML(kind, d) {
    var rows = d ? (d.rows || docRows(d.text)) : [];
    return '<section class="vdr-doc jkv-locked-doc"><div class="vdr-doc-head"><h4>' + kind.icon + ' ' + esc(kind.label) +
      '<span>' + (d ? rows.length + '행 등록됨' : '미등록') + '</span></h4></div>' +
      '<div class="jkv-doc-lock"><b>🔒 CA 승인 후 열람</b>' +
      '<span>JK Value · 매각자문사/운용사 앞 CA 체결 후 공개 — ' + esc(kind.label) + '</span>' +
      '<button type="button" class="mini-btn" data-vdr="ca-new">CA 제출</button></div></section>';
  }

  function docCardHTML(kind) {
    var room = selectedRoom();
    if (!room) return '';
    var d = docOf(room.id, kind.k);
    if (!hasAccess(room.id)) return lockedDocHTML(kind, d);
    var rows = d ? (d.rows || docRows(d.text)) : [];
    var body;
    if (!d) {
      body = '<p class="vdr-doc-empty">아직 등록되지 않았습니다.' + ((isAdmin() && operatorView()) ? ' <button type="button" class="mini-btn" data-vdr-doc-edit="' + kind.k + '">＋ 등록</button>' : '') + '</p>';
    } else if (!rows.length) {
      body = '<p class="vdr-doc-empty">내용이 비어 있습니다.' + ((isAdmin() && operatorView()) ? ' <button type="button" class="mini-btn" data-vdr-doc-edit="' + kind.k + '">✏️ 편집</button>' : '') + '</p>';
    } else {
      body = '<div class="vdr-table-wrap"><table class="vdr-table"><thead><tr>' +
        kind.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr>' + kind.cols.map(function (c, i) {
            return '<td' + (i === 0 ? ' class="b"' : '') + '>' + esc(r[i] || '') + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
      if (d.note) body += '<p class="vdr-note">' + esc(d.note) + '</p>';
    }
    return '<section class="vdr-doc"><div class="vdr-doc-head"><h4>' + kind.icon + ' ' + esc(kind.label) +
      '<span>' + (rows.length ? rows.length + '행' : '미등록') + '</span></h4>' +
      ((isAdmin() && operatorView()) && d ? '<button type="button" class="mini-btn" data-vdr-doc-edit="' + kind.k + '">✏️ 편집</button>' : '') +
      '</div>' + body + '</section>';
  }

  function imCardHTML(room) {
    var ok = hasAccess(room.id);
    var hasTm = !!(room.tm_url), hasIm = !!(room.im_url);
    if (!ok) {
      return '<section class="vdr-doc jkv-locked-doc"><div class="vdr-doc-head"><h4>📘 티저 · IM(Information Memorandum) <span>' +
        (hasTm || hasIm ? '보유' : '제작·배포 예정') + '</span></h4></div>' +
        '<div class="jkv-doc-lock"><b>🔒 CA 승인 후 열람·요청</b>' +
        '<span>IM 원문과 티저 파일은 CA 체결 후 열람자 워터마크가 삽입된 사본으로 제공됩니다.</span>' +
        '<button type="button" class="mini-btn" data-vdr="ca-new">CA 제출</button></div></section>';
    }
    var h = '<section class="vdr-doc"><div class="vdr-doc-head"><h4>📘 티저 · IM(Information Memorandum) <span>' +
      (hasTm || hasIm ? '열람 가능' : '파일 미등록 · 요청 가능') + '</span></h4></div><div class="jkv-im-body">';
    if (hasTm) h += '<a class="jkv-file" href="' + esc(room.tm_url) + '" target="_blank" rel="noopener noreferrer" data-vdr-log="티저 열람">📄 티저(Teaser) 열람 ↗</a>';
    if (hasIm) h += '<a class="jkv-file" href="' + esc(room.im_url) + '" target="_blank" rel="noopener noreferrer" data-vdr-log="IM 열람">📘 IM 원문 열람 ↗</a>';
    if (!hasTm && !hasIm) h += '<p class="vdr-doc-empty">등록된 파일이 없습니다. 아래 <b>IM·티저 열람 요청</b>을 보내면 JK Value가 워터마크 사본을 발송합니다.</p>';
    h += '<div class="jkv-im-actions">' +
      '<button type="button" class="btn jkv-btn-primary" data-vdr="im-request">📩 IM·티저 열람 요청</button>' +
      '<button type="button" class="mini-btn" data-vdr="val-open">📊 OAAB 밸류에이션으로 검토</button>' +
      '</div>';
    h += '<p class="jkv-note">발송 파일에는 열람자 회사명·이름·발송일 워터마크가 들어가며, 열람 시각이 로그로 기록됩니다.</p>';
    h += '</div></section>';
    return h;
  }

  function docsTabHTML() {
    var room = selectedRoom();
    var h = '<div class="vdr-docs">';
    if (!hasAccess(room.id)) {
      h += '<div class="jkv-banner-lock">🔒 <b>CA 체결 전</b>입니다. 자료 항목과 보유 여부만 표시되며, 내용은 JK Value 승인 후 열립니다.</div>';
    } else {
      h += wmBadge(room.id);
    }
    h += '<div class="jkv-docs-wrap' + (hasAccess(room.id) ? ' has-wm' : '') + '">';
    if (hasAccess(room.id)) h += wmHTML(room.id);
    h += imCardHTML(room);
    DOC_KINDS.forEach(function (k) { h += docCardHTML(k); });
    if (hasDd(room.id)) {
      h += '<section class="vdr-doc jkv-dd"><div class="vdr-doc-head"><h4>🗂️ 실사자료 (VDR 전체) <span>Post-LOI</span></h4></div>' +
        '<div class="jkv-dd-body"><p>LOI 제출 이후 실사 단계에서 계약서 초안·건축물대장·감정평가·환경·권리분석 자료가 추가 제공됩니다.</p>' +
        '<button type="button" class="mini-btn" data-vdr="dd-request">🗂️ 실사자료 목록 요청</button></div></section>';
    }
    h += '</div></div>';
    return h;
  }

  /* ─────────────────────────── CA · 열람 탭 ─────────────────────────── */
  function stepHTML(n, title, desc, state) {
    return '<li class="jkv-step ' + state + '"><span class="jkv-step-no">' + n + '</span><div><b>' + esc(title) + '</b><span>' + esc(desc) + '</span></div></li>';
  }

  function caTabHTML(room) {
    var c = caFor(room.id);
    var op = operatorView();
    var st = c ? (c.status === '승인' ? '승인' : (c.status === '반려' ? '반려' : '심사중')) : 'none';
    var mine = caList(room.id);
    var h = '<div class="jkv-ca">';
    h += '<div class="jkv-status jkv-st-' + (st === '승인' ? 'ok' : (st === '심사중' ? 'wait' : (st === '반려' ? 'no' : 'none'))) + '">' +
      '<div><span class="jkv-status-k">현재 CA 상태</span><b>' + esc(CA_STATUS[st] || st) + (op ? ' · 운영자 전체 열람' : '') + '</b></div>' +
      (c ? '<div class="jkv-status-meta"><span>' + esc(c.company || '') + ' · ' + esc(c.name || '') + '</span>' +
        '<span>CA ID ' + esc(c.id) + '</span><span>제출 ' + fmtDT(c.submitted_at) + (c.approved_at ? ' · 승인 ' + fmtDT(c.approved_at) : '') + '</span></div>' : '') +
      '</div>';

    h += '<ol class="jkv-steps">' +
      stepHTML(1, '블라인드 자산소개서 열람', '권역·섹터·규모 밴드·예상가 밴드까지 공개', 'done') +
      stepHTML(2, '전자 CA 제출', 'JK Value · 매각자문사/운용사 앞 비밀유지각서 전자서명', (st === 'none' ? 'now' : 'done')) +
      stepHTML(3, 'JK Value 검토·승인', '기관 실체·투자 적격성 확인 후 승인', (st === '심사중' ? 'now' : (st === '승인' ? 'done' : ''))) +
      stepHTML(4, '상세자료 열람', '렌트롤·OPEX·CAPEX·IM·밸류에이션 (워터마크·로그)', (st === '승인' ? 'now' : '')) +
      stepHTML(5, 'LOI 제출', '제안 매입가·자금조달 구조·인수 조건', (myLoi(room.id).length ? 'done' : '')) +
      '</ol>';

    if (op) {
      h += '<div class="jkv-wait">🛠️ <b>운영자 계정</b>은 CA 상태와 무관하게 전체 자료를 열람합니다. 투자자 CA는 아래 <b>CA 접수·승인 관리</b>에서 승인·반려합니다.</div>';
    }
    if (st === 'none' || st === '반려') {
      h += '<div class="jkv-ca-cta"><button type="button" class="btn jkv-btn-primary" data-vdr="ca-new">🔐 전자 CA 작성·제출</button>' +
        '<button type="button" class="mini-btn" data-vdr="ca-terms">표준 조항 전문 보기</button></div>' +
        (st === '반려' && c && c.reason ? '<p class="jkv-reject">반려 사유 : ' + esc(c.reason) + '</p>' : '');
    } else if (st === '심사중') {
      h += '<div class="jkv-wait">⏳ <b>JK Value 검토중</b>입니다. 승인되면 이 화면과 VDR 자료가 자동으로 열립니다. 문의 : JK Value 자문팀 (jk@naikorea.com)</div>';
    } else {
      h += '<div class="jkv-approved">✅ <b>CA 승인 완료</b> — 상세자료 열람 권한이 부여되었습니다.' + wmBadge(room.id) + '</div>';
    }
    if (op && st === '승인') { /* 이미 승인 표시 */ }

    /* 표준 조항 요약 */
    h += '<section class="jkv-terms"><h4>📜 전자 CA 핵심 조항 (요약)</h4><ol>' +
      '<li><b>목적 외 사용 금지</b> — 제공 자료는 해당 자산의 투자 검토 목적으로만 사용하며, 매수·임차 검토 외 활용 및 상품·보고서 재가공을 금지합니다.</li>' +
      '<li><b>제3자 제공 금지</b> — 자문사·대리인·금융기관 등 필요 최소 인원에게만 동일 의무를 부과해 공유하며, 그 명단을 JK Value에 통지합니다.</li>' +
      '<li><b>매도인·임차인 직접 접촉 금지</b> — JK Value를 통하지 않은 매도인·자산운용사·임차인·PM 접촉을 금지합니다.</li>' +
      '<li><b>파기·반환</b> — 검토 종료·요청 시 5영업일 내 반환 또는 파기하고 파기확인서를 제출합니다.</li>' +
      '<li><b>손해배상·위약벌</b> — 위반 시 실제 손해배상 외에 위약벌(표준 10억원 또는 거래가액의 1%, 높은 금액)을 부담합니다.</li>' +
      '<li><b>열람 로그·워터마크</b> — 열람자 회사명·이름·시각을 워터마크로 표시하고 모든 열람·다운로드 이력을 기록합니다.</li>' +
      '<li><b>비밀유지 기간</b> — CA 체결일로부터 3년(자료별 별도 정함이 있으면 그 기간)입니다.</li>' +
      '</ol><button type="button" class="mini-btn" data-vdr="ca-terms">전문 보기</button></section>';

    /* 운영자 : 접수·승인 관리 */
    if (operatorView()) {
      h += '<section class="jkv-admin"><div class="jkv-admin-head"><h4>🛠️ CA 접수·승인 관리 <span>JK Value 운영자</span></h4>' +
        '<span class="jkv-count">접수 ' + mine.length + '건</span></div>';
      if (!mine.length) {
        h += '<p class="vdr-doc-empty">접수된 CA가 없습니다. 투자자가 CA를 제출하면 여기에서 승인·반려합니다.</p>';
      } else {
        h += '<div class="vdr-table-wrap"><table class="vdr-table"><thead><tr><th>제출일시</th><th>기관·담당자</th><th>연락처</th><th>자료 범위</th><th>상태</th><th>처리</th></tr></thead><tbody>';
        mine.forEach(function (x) {
          h += '<tr><td class="nowrap">' + fmtDT(x.submitted_at) + '<span class="vdr-sub">' + esc(x.id) + '</span></td>' +
            '<td><b>' + esc(x.company || '-') + '</b><span class="vdr-sub">' + esc([x.name, x.title].filter(Boolean).join(' · ')) + '</span></td>' +
            '<td>' + esc(x.phone || '-') + '<span class="vdr-sub">' + esc(x.email || '') + '</span></td>' +
            '<td class="vdr-terms">' + esc((x.scopes || []).join(' · ')) + '</td>' +
            '<td>' + esc(x.status || '심사중') + '</td>' +
            '<td class="nowrap">' + (x.status === '승인' ? '<span class="jkv-ok">승인됨</span> ' +
              '<button type="button" class="mini-btn" data-vdr-ca-revoke="' + esc(x.id) + '">승인 취소</button>' :
              '<button type="button" class="mini-btn" data-vdr-ca-ok="' + esc(x.id) + '">승인</button> ' +
              '<button type="button" class="mini-btn" data-vdr-ca-no="' + esc(x.id) + '">반려</button>') + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }
      var reqs = S.reqsByRoom[room.id] || [];
      h += '<div class="jkv-reqs"><h5>📩 IM·티저·실사자료 요청 ' + reqs.length + '건</h5>';
      h += reqs.length ? '<ul>' + reqs.map(function (r) {
        return '<li><b>' + esc(r.kind) + '</b> · ' + esc(r.company || '') + ' ' + esc(r.name || '') + ' <span>' + fmtDT(r.at) + '</span></li>';
      }).join('') + '</ul>' : '<p class="vdr-doc-empty">요청 없음</p>';
      h += '</div></section>';
    }

    /* 열람 로그 */
    var logs = (S.logs || []).filter(function (l) { return l.room_id === room.id; });
    var shown = operatorView() ? logs : logs.filter(function (l) {
      var v = viewerLabel(room.id);
      return (v.email && l.email === v.email) || (v.name && l.name === v.name && l.company === v.company);
    });
    h += '<section class="jkv-logs"><h4>🕘 열람 로그 <span>' + shown.length + '건' + (operatorView() ? ' (전체)' : ' (본인)') + '</span></h4>';
    h += shown.length ? '<div class="vdr-table-wrap"><table class="vdr-table"><thead><tr><th>시각</th><th>열람자</th><th>행위</th><th>내용</th></tr></thead><tbody>' +
      shown.slice().reverse().slice(0, 30).map(function (l) {
        return '<tr><td class="nowrap">' + fmtDT(l.at) + '</td><td>' + esc(l.company || '') + ' <span class="vdr-sub">' + esc(l.name || '') + '</span></td>' +
          '<td>' + esc(l.action) + '</td><td class="vdr-terms">' + esc(l.detail || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="vdr-doc-empty">기록 없음</p>';
    h += '<p class="vdr-note">본 브라우저에 기록되는 로그입니다. 서버 시트 연동 시 전 기기 로그가 함께 표시됩니다(docs/JKV_서버_패치.md).</p></section>';
    h += '</div>';
    return h;
  }

  /* ─────────────────────────── LOI 탭 ─────────────────────────── */
  function loiTabHTML(room) {
    var ok = hasAccess(room.id);
    var mine = myBids(room.id);
    var h = '<div class="jkv-loi">';
    if (!ok) {
      h += '<div class="jkv-gate-box"><b>🔒 LOI 제출은 CA 체결 후 가능합니다</b>' +
        '<p>JK Value · 매각자문사/운용사 앞 전자 CA를 제출하고 승인을 받으면 제안 매입가·자금조달 구조·인수 조건을 담은 LOI를 플랫폼에서 바로 제출할 수 있습니다.</p>' +
        '<button type="button" class="btn jkv-btn-primary" data-vdr="ca-new">🔐 전자 CA 제출</button></div>';
      h += '<p class="jkv-note">CA 체결 전에는 LOI 양식(제안 항목)만 확인할 수 있으며, 제출은 승인 후 열립니다.</p>';
      h += '<section class="jkv-terms"><h4>📝 LOI 필수 기재 항목</h4><ol>' +
        '<li>매수 주체 — 법인명·SPC 설립 여부·최종 투자자</li>' +
        '<li>제안 매입가 — 총액(억원), 평당가, VAT·비용 부담 범위</li>' +
        '<li>자금조달 구조 — 자기자본·선순위·후순위, LTV, 금리, 확약/조건부</li>' +
        '<li>인수 조건 — 임대차 승계, 명도, 잔금일, 조건부 조항</li>' +
        '<li>실사·계약·잔금 일정, LOI 유효기간</li>' +
        '<li>자문·중개 수수료 부담 주체</li>' +
        '<li>담당자·연락처와 전자서명</li></ol></section>';
      h += '</div>';
      return h;
    }
    h += '<div class="vdr-bid-actions"><button type="button" class="btn jkv-btn-primary" data-vdr="loi-new">📝 LOI 제출</button>' +
      '<span class="vdr-hint">' + (operatorView() ? '운영자는 제출된 LOI 전체를 조회합니다. AI 쇼트리스트에서 비교할 수 있습니다.' : '제출한 LOI는 JK Value만 전체를 조회하며, 참여자는 본인 제출분만 확인됩니다.') + '</span></div>';
    if (!mine.length) {
      h += '<div class="vdr-empty">아직 제출한 LOI가 없습니다.' + (operatorView() ? ' <button type="button" class="mini-btn" data-vdr="bid-seed">＋ 샘플 후보 3건(검증용)</button>' : '') + '</div>';
    } else {
      h += '<div class="vdr-table-wrap"><table class="vdr-table"><thead><tr>' +
        '<th>제출일시</th><th>구분</th><th>매수 주체</th><th>제안가(억)</th><th>자금조달</th><th>LTV</th><th>인수 조건</th><th>유효기간</th><th>상태</th></tr></thead><tbody>';
      mine.forEach(function (b) {
        h += '<tr class="' + (b._sample ? 'vdr-sample' : '') + '">' +
          '<td class="nowrap">' + esc(fmtDT(b.timestamp || b.submitted_at || '')) + '</td>' +
          '<td>' + esc(b.kind || 'LOI') + (b._sample ? ' <span class="vdr-smp">샘플</span>' : '') + '</td>' +
          '<td><b>' + esc(b.company || '-') + '</b><span class="vdr-sub">' + esc([b.bidder, b.title, b.phone].filter(Boolean).join(' · ')) + '</span></td>' +
          '<td class="num b">' + n0(b.price_eok) + '</td>' +
          '<td>' + esc(b.funding || '-') + '</td>' +
          '<td class="num">' + (b.ltv_pct ? n0(b.ltv_pct) + '%' : '-') + '</td>' +
          '<td class="vdr-terms">' + esc([b.accept, (b.dd_days ? '실사 ' + b.dd_days + '일' : ''), (b.close_months ? b.close_months + '개월' : '')].filter(Boolean).join(' · ')) +
          (b.conditions ? '<span class="vdr-sub">' + esc(b.conditions) + '</span>' : '') +
          (b.memo ? '<span class="vdr-sub">' + esc(b.memo) + '</span>' : '') + '</td>' +
          '<td>' + esc(b.valid_until || '-') + '</td>' +
          '<td>' + esc(b.status || '접수') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '<p class="jkv-note">LOI는 법적 구속력이 없는 투자의향서이며, 우선협상대상자 선정 후 SPA·실사로 이어집니다. 제출 시각·금액·조건은 수정 이력과 함께 보관됩니다.</p>';
    h += '</div>';
    return h;
  }

  /* ─────────────────────────── 렌더 ─────────────────────────── */
  function tabList(room) {
    var tabs = [['blind', '📄 블라인드 티저'], ['docs', '📁 자료 관리'], ['ca', '🔐 CA·열람'], ['loi', '📝 LOI']];
    if (operatorView()) tabs.push(['ai', '🤖 AI 쇼트리스트']);
    return tabs;
  }

  function render() {
    var host = $('#vdrView');
    if (!host) return;
    var room = selectedRoom();
    if (room && !S.roomId) S.roomId = room.id;
    if (S.tab === 'bids') S.tab = 'loi';
    var h = '<div class="vdr-shell">';
    h += '<div class="vdr-top"><div><h2><span class="jkv-logo">JK VALUE</span> CA · VDR · LOI 워크룸</h2>' +
      '<p>' + (isOperator()
        ? '자산운용사·매도자의 딜 데이터를 <b>블라인드 → 전자 CA → 상세자료 → LOI</b> 흐름으로 통제해 배포합니다. CA 체결 전에는 자산소개서 수준만, 승인 후에는 렌트롤·비용·IM·밸류에이션을 워터마크·로그와 함께 엽니다.'
        : 'JK Value가 주관하는 매각 건의 <b>블라인드 자산소개서</b>를 보고, 전자 CA를 제출해 상세자료를 열람한 뒤 <b>LOI</b>까지 제출합니다.') + '</p>' +
      (S.mode === 'local' ? '<p class="vdr-offline">⚠️ 서버 VDR API 미연결 → <b>이 브라우저(로컬) 모드</b>로 동작 중입니다. 자문사·참여자가 다른 기기면 공유되지 않습니다.</p>' : '') +
      '</div><div class="vdr-top-actions">' +
      (isOperator() ? '<button type="button" class="btn btn-ghost" data-vdr="as-inv" aria-pressed="' + (S.asInvestor ? 'true' : 'false') + '">' + (S.asInvestor ? '🛠️ 운영자 시점으로' : '👁️ 투자자 시점 미리보기') + '</button>' : '') +
      (isAdmin() ? '<button type="button" class="btn btn-primary" data-vdr="room-new">＋ 새 딜룸</button>' : '') +
      '<button type="button" class="btn btn-ghost" data-vdr="reload">↻ 새로고침</button></div></div>';

    h += '<div class="vdr-grid"><aside class="vdr-rooms">' + roomListHTML() + '</aside><main class="vdr-main">';
    if (!room) {
      h += '<div class="vdr-empty big">딜룸을 선택하거나 새로 만들어 주세요.</div>';
    } else {
      var ok = hasAccess(room.id);
      var st = caStatus(room.id);
      var chipTxt = operatorView() ? '운영자 · 전체 열람' : (CA_STATUS[st] || st);
      h += '<div class="vdr-room-head"><div><span class="vdr-stage">' + esc(room.stage || '자료 배포') + '</span>' +
        '<span class="jkv-chip jkv-chip-' + (ok ? 'ok' : (st === '심사중' ? 'wait' : 'none')) + '">' + esc(chipTxt) + '</span>' +
        '<h3>' + esc(ok ? room.name : ('블라인드 ' + blindCode(room) + ' · ' + sectorLabelOf(room, linkedAsset(room)) + ' 매각')) + '</h3>' +
        '<p>' + esc(ok ? [room.asset_name, room.region, sectorLabelOf(room, linkedAsset(room))].filter(Boolean).join(' · ') : [regionOf(room, linkedAsset(room)), scaleBand(roomPyeong(room, linkedAsset(room))), '예상 ' + priceBand(room.price_guide_eok)].join(' · ')) + '</p></div>' +
        '<div class="vdr-room-kpis">' +
        '<span><b>' + (ok ? (room.price_guide_eok ? n0(room.price_guide_eok) + '억' : '-') : priceBand(room.price_guide_eok)) + '</b>' + (ok ? '가이드가' : '예상가 밴드') + '</span>' +
        '<span><b>' + esc(room.loi_deadline || '-') + '</b>LOI 마감</span>' +
        '<span><b>' + esc(room.bid_deadline || '-') + '</b>입찰 마감</span>' +
        '<span><b>' + (ok ? bidsOf(room.id).length + '건' : '—') + '</b>접수</span></div></div>';
      if (isAdmin() && operatorView()) h += '<div class="jkv-room-tools"><button type="button" class="mini-btn" data-vdr="room-edit">✏️ 딜룸·블라인드 정보</button>' +
        '<span>섹터·규모·임대율·권역 등 블라인드 표기 항목을 채우면 Pre-CA 화면이 완성됩니다.</span></div>';
      if (ok && room.description) h += '<p class="vdr-desc">' + esc(room.description) + '</p>';
      h += '<div class="vdr-tabs" role="tablist">' +
        tabList(room).map(function (t) {
          return '<button type="button" class="vdr-tab' + (S.tab === t[0] ? ' on' : '') + '" data-vdr-tab="' + t[0] + '">' + t[1] + '</button>';
        }).join('') + '</div>';
      if (S.tab === 'blind') h += blindTabHTML(room);
      else if (S.tab === 'docs') h += docsTabHTML();
      else if (S.tab === 'ca') h += caTabHTML(room);
      else if (S.tab === 'loi') h += loiTabHTML(room);
      else if (S.tab === 'ai' && operatorView()) h += shortlistHTML(room.id);
      else h += blindTabHTML(room);
    }
    h += '</main></div></div>';
    host.innerHTML = h;
    bind();
  }

  /* ─────────────────────────── 모달 ─────────────────────────── */
  function modalShell(title, body, wide) {
    var m = $('#vdrModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'vdrModal';
      m.className = 'vdr-modal hidden';
      document.body.appendChild(m);
    }
    m.innerHTML = '<div class="vdr-card' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="vdr-card-head"><strong>' + esc(title) + '</strong><button type="button" class="tr-x" data-vdr="close">×</button></div>' +
      '<div class="vdr-card-body">' + body + '</div></div>';
    m.classList.remove('hidden');
    m.onclick = function (e) {
      if (e.target === m || e.target.closest('[data-vdr="close"]')) m.classList.add('hidden');
    };
    return m;
  }
  function closeModal() { var m = $('#vdrModal'); if (m) { m.classList.add('hidden'); m.innerHTML = ''; } }

  function openRoomEditor(room) {
    var r = room || {};
    var body = '<div class="tr-grid">' +
      '<label class="tr-f wide"><span>딜룸 이름 <b>*</b></span><input name="name" value="' + esc(r.name || '') + '" placeholder="예) 종로플레이스 매각 · 2026 4Q 입찰"></label>' +
      '<label class="tr-f wide"><span>대상 물건 <b>*</b></span><input name="asset_name" value="' + esc(r.asset_name || '') + '" placeholder="예) 종로플레이스 (종로구 창경궁로 120)"></label>' +
      '<label class="tr-f"><span>진행 단계</span><select name="stage">' + STAGES.map(function (s) {
        return '<option' + (s === r.stage ? ' selected' : '') + '>' + s + '</option>';
      }).join('') + '</select></label>' +
      '<label class="tr-f"><span>섹터</span><select name="sector">' + ['', 'office', 'logistics', 'datacenter', 'hotel', 'retail', 'living', 'land', 'senior', 'golf'].map(function (k) {
        var lb = k ? (((CFG.SECTORS || {})[k] || {}).label || k) : '자동(물건 DB 연동)';
        return '<option value="' + k + '"' + (k === (r.sector || '') ? ' selected' : '') + '>' + esc(lb) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="tr-f"><span>가이드가(억)</span><input name="price_guide_eok" type="number" step="1" value="' + esc(r.price_guide_eok || '') + '"></label>' +
      '<label class="tr-f"><span>연면적(평)</span><input name="gfa_pyeong" type="number" step="1" value="' + esc(r.gfa_pyeong || '') + '" placeholder="예) 13835"></label>' +
      '<label class="tr-f"><span>임대율(%)</span><input name="occupancy_pct" type="number" step="0.1" value="' + esc(r.occupancy_pct || '') + '" placeholder="예) 96.2"></label>' +
      '<label class="tr-f"><span>준공연도</span><input name="built_year" type="number" step="1" value="' + esc(r.built_year || '') + '" placeholder="예) 1998"></label>' +
      '<label class="tr-f"><span>대지면적(평)</span><input name="site_pyeong" type="number" step="1" value="' + esc(r.site_pyeong || '') + '"></label>' +
      '<label class="tr-f"><span>WALE(년)</span><input name="wale_years" type="number" step="0.1" value="' + esc(r.wale_years || '') + '" placeholder="예) 4.1"></label>' +
      '<label class="tr-f"><span>자금조달 가정</span><input name="ltv_band" value="' + esc(r.ltv_band || '') + '" placeholder="예) LTV 60~65% · 금리 4%대"></label>' +
      '<label class="tr-f"><span>특이사항(공개 정보)</span><input name="special_note" value="' + esc(r.special_note || '') + '" placeholder="예) 용도변경 인허가 검토 가능"></label>' +
      '<label class="tr-f"><span>소재 권역(블라인드 표기)</span><input name="sub_market" value="' + esc(r.sub_market || '') + '" placeholder="예) 서울 종로구"></label>' +
      '<label class="tr-f"><span>주요 임차인 업종</span><input name="tenant_profile" value="' + esc(r.tenant_profile || '') + '" placeholder="예) 금융·공공·법무 (복수)"></label>' +
      '<label class="tr-f"><span>거래 구조</span><input name="deal_type" value="' + esc(r.deal_type || '') + '" placeholder="예) 에셋딜 단일 / 지분 협의"></label>' +
      '<label class="tr-f"><span>진행 일정 메모</span><input name="timeline" value="' + esc(r.timeline || '') + '" placeholder="예) 12월 티저 → 1월 LOI"></label>' +
      '<label class="tr-f"><span>LOI 마감</span><input name="loi_deadline" type="date" value="' + esc(r.loi_deadline || '') + '"></label>' +
      '<label class="tr-f"><span>입찰 마감</span><input name="bid_deadline" type="date" value="' + esc(r.bid_deadline || '') + '"></label>' +
      '<label class="tr-f"><span>주관 (블라인드 표기)</span><input name="advisor" value="' + esc(r.advisor || '') + '" placeholder="비우면 JK Value (매각자문)"></label>' +
      '<label class="tr-f wide"><span>티저 파일 링크 (선택)</span><input name="tm_url" value="' + esc(r.tm_url || '') + '" placeholder="https://... CA 승인 후 열람"></label>' +
      '<label class="tr-f wide"><span>IM 파일 링크 (선택)</span><input name="im_url" value="' + esc(r.im_url || '') + '" placeholder="https://... CA 승인 후 열람"></label>' +
      '<label class="tr-f wide"><span>설명(운영자 메모)</span><textarea name="description" rows="2" placeholder="매각 구조·특이사항">' + esc(r.description || '') + '</textarea></label>' +
      '</div><div class="tr-actions"><button type="button" class="btn btn-ghost" data-vdr="close">취소</button>' +
      '<button type="button" class="btn btn-primary" data-vdr="room-save">저장</button></div>';
    var m = modalShell(room ? '✏️ 딜룸 수정' : '＋ 새 딜룸', body, true);
    m.querySelector('[data-vdr="room-save"]').addEventListener('click', function () {
      var v = function (k) { var el = m.querySelector('[name="' + k + '"]'); return el ? el.value.trim() : ''; };
      var nm = v('name');
      if (!nm) { toast('딜룸 이름을 입력하세요.', true); return; }
      var obj = {
        id: r.id || ('vdr-' + Date.now().toString(36)),
        asset_id: r.asset_id || '',
        name: nm, asset_name: v('asset_name'), stage: v('stage') || '자료 배포', sector: v('sector'),
        price_guide_eok: v('price_guide_eok'), gfa_pyeong: v('gfa_pyeong'), occupancy_pct: v('occupancy_pct'),
        built_year: v('built_year'), site_pyeong: v('site_pyeong'), wale_years: v('wale_years'),
        ltv_band: v('ltv_band'), special_note: v('special_note'),
        sub_market: v('sub_market'), tenant_profile: v('tenant_profile'),
        deal_type: v('deal_type'), timeline: v('timeline'), advisor: v('advisor'),
        loi_deadline: v('loi_deadline'), bid_deadline: v('bid_deadline'), tm_url: v('tm_url'), im_url: v('im_url'),
        description: v('description'), created_at: r.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      saveRoomMeta(obj);
      persistRoom(obj).then(function (j) {
        if (!j || !j.ok) { toast('저장 실패: ' + ((j && j.error) || ''), true); return; }
        S.roomId = obj.id;
        S.loaded = true;
        mergeRoomLocal(obj);
        closeModal(); render(); toast('딜룸을 저장했습니다.');
        setTimeout(function () {
          loadRooms(true).then(function () { mergeRoomLocal(obj); return loadRoomData(obj.id, true); }).then(function () { render(); });
        }, 1600);
      }).catch(function () { toast('저장 실패(네트워크)', true); });
    });
  }

  function openDocEditor(kindKey) {
    var room = selectedRoom();
    if (!room) return;
    var kind = DOC_KINDS.filter(function (k) { return k.k === kindKey; })[0];
    var d = docOf(room.id, kindKey);
    var text = d ? (d.text || rowsToText(d.rows)) : '';
    var body = '<p class="vdr-note">' + esc(kind.hint) + ' 빈 줄은 무시됩니다.</p>' +
      '<label class="tr-f wide"><span>' + esc(kind.label) + ' (한 줄 = 한 행, “|” 구분)</span>' +
      '<textarea name="text" rows="12" class="vdr-code" placeholder="' + esc(kind.cols.join(' | ')) + '">' + esc(text) + '</textarea></label>' +
      '<label class="tr-f wide"><span>비고</span><input name="note" value="' + esc((d && d.note) || '') + '"></label>' +
      '<div class="tr-actions"><button type="button" class="btn btn-ghost" data-vdr="close">취소</button>' +
      '<button type="button" class="btn btn-primary" data-vdr="doc-save">저장</button></div>';
    var m = modalShell(kind.icon + ' ' + kind.label + ' — ' + room.name, body, true);
    m.querySelector('[data-vdr="doc-save"]').addEventListener('click', function () {
      var t = m.querySelector('[name="text"]').value;
      var rows = docRows(t);
      var doc = {
        id: (d && d.id) || ('vd-' + Date.now().toString(36)),
        room_id: room.id, kind: kindKey, label: kind.label,
        rows: rows, text: rowsToText(rows), note: m.querySelector('[name="note"]').value,
        updated_at: new Date().toISOString()
      };
      persistDoc(doc).then(function (j) {
        if (!j || !j.ok) { toast('저장 실패: ' + ((j && j.error) || ''), true); return; }
        closeModal();
        mergeDocLocal(doc); render(); toast(kind.label + ' 을(를) 저장했습니다.');
        setTimeout(function () { loadRoomData(room.id, true).then(function () { mergeDocLocal(doc); render(); }); }, 1600);
      }).catch(function () { toast('저장 실패(네트워크)', true); });
    });
  }

  /* ── 전자 CA 작성·제출 ── */
  function openCaForm() {
    var room = selectedRoom();
    if (!room) return;
    var it = myIdentity();
    var body = '<p class="rfp-note">' + esc(room.name) + ' — JK Value · 매각자문사/운용사 앞 전자 비밀유지각서(CA)입니다. ' +
      '제출 후 JK Value 검토·승인 시 상세자료 열람이 열립니다.</p>' +
      '<div class="tr-grid">' +
      '<label class="tr-f"><span>투자자 기관명 <b>*</b></span><input name="company" value="' + esc(it.company) + '" placeholder="예) ○○자산운용 / ○○리츠"></label>' +
      '<label class="tr-f"><span>담당자 성명 <b>*</b></span><input name="name" value="' + esc(it.name) + '"></label>' +
      '<label class="tr-f"><span>직책</span><input name="title" value="' + esc(it.title) + '" placeholder="예) 투자본부 이사"></label>' +
      '<label class="tr-f"><span>연락처 <b>*</b></span><input name="phone" type="tel" placeholder="010-0000-0000"></label>' +
      '<label class="tr-f wide"><span>이메일 <b>*</b></span><input name="email" type="email" value="' + esc(it.email) + '" placeholder="name@company.com">' +
      '</label>' +
      '<label class="tr-f"><span>제출자 구분</span><select name="party"><option>투자자(매수 예정)</option><option>투자자 대리인(자문사)</option><option>금융기관(FI)</option></select></label>' +
      '<label class="tr-f"><span>자산 확인</span><input value="' + esc(room.name) + ' · ' + esc(blindCode(room)) + '" readonly></label>' +
      '</div>' +
      '<div class="jkv-scope"><b>자료 열람 범위 (CA 목적)</b>' +
      CA_SCOPES.map(function (s, i) {
        return '<label><input type="checkbox" name="scope" value="' + esc(s) + '"' + (i === 0 || i === 1 || i === 2 ? ' checked' : '') + '> ' + esc(s) + '</label>';
      }).join('') + '</div>' +
      '<label class="jkv-agree"><input type="checkbox" name="agree"> 위 CA 표준 조항(목적 외 사용 금지·제3자 제공 금지·매도인 직접 접촉 금지·파기·손해배상·열람 로그)에 동의합니다. <b>*</b></label>' +
      '<label class="jkv-agree"><input type="checkbox" name="esign"> 본인은 전자서명으로 이 CA를 체결하며, 아래 성명이 서명으로 기록되는 것에 동의합니다. <b>*</b></label>' +
      '<label class="tr-f wide"><span>전자서명 (성명 입력) <b>*</b></span><input name="signature" placeholder="성명을 그대로 입력하세요"></label>' +
      '<p class="jkv-note">전자서명법 제3조·전자문서법 제4조에 따른 전자서명으로 기록되며, 서명 시각·접속기기·서명해시가 함께 저장됩니다. 서명 후에는 수정할 수 없습니다.</p>' +
      '<div class="tr-actions"><button type="button" class="btn btn-ghost" data-vdr="close">취소</button>' +
      '<button type="button" class="btn btn-primary" data-vdr="ca-save">CA 제출</button></div>';
    var m = modalShell('🔐 전자 CA 제출 — ' + room.name, body, true);

    m.querySelector('[data-vdr="ca-save"]').addEventListener('click', function () {
      var v = function (k) { var el = m.querySelector('[name="' + k + '"]'); return el ? String(el.value || '').trim() : ''; };
      var scopes = $$('input[name="scope"]:checked', m).map(function (x) { return x.value; });
      if (!v('company')) { toast('투자자 기관명을 입력하세요.', true); return; }
      if (!v('name')) { toast('담당자 성명을 입력하세요.', true); return; }
      if (String(v('phone')).replace(/[^0-9]/g, '').length < 7) { toast('연락처를 정확히 입력하세요.', true); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('email'))) { toast('이메일을 정확히 입력하세요.', true); return; }
      if (!scopes.length) { toast('자료 열람 범위를 1개 이상 선택하세요.', true); return; }
      var agree = m.querySelector('[name="agree"]'), esign = m.querySelector('[name="esign"]');
      if (!agree.checked || !esign.checked) { toast('CA 조항과 전자서명에 동의해 주세요.', true); return; }
      if (v('signature') !== v('name')) { toast('전자서명은 담당자 성명과 같게 입력하세요.', true); return; }
      var ts = nowISO();
      var ca = {
        id: 'CA-' + hash36(room.id + v('email') + ts) + '-' + String(Date.now()).slice(-5),
        room_id: room.id, room_name: room.name, asset_name: room.asset_name || '',
        company: v('company'), name: v('name'), title: v('title'), phone: v('phone'), email: v('email'),
        party: v('party'), scopes: scopes, status: '심사중', submitted_at: ts, approved_at: '',
        signature: v('signature'), signature_hash: sigHash(v('name') + '|' + v('email') + '|' + room.id + '|' + ts),
        ua: String(navigator.userAgent || '').slice(0, 120), by: role()
      };
      persistCA(ca).then(function (j) {
        var ref = myRef(room.id) || { bid_ids: [] };
        ref.id = ca.id; ref.company = ca.company; ref.name = ca.name; ref.email = ca.email;
        ref.bid_ids = ref.bid_ids || [];
        myRefSave(room.id, ref);
        persistLog(room.id, 'CA 제출', ca.id + ' · ' + ca.company);
        closeModal();
        S.tab = 'ca';
        render();
        toast((j && j.local)
          ? 'CA를 접수했습니다. (로컬 보관 — 서버 시트 연동 시 자동 공유)'
          : 'CA를 제출했습니다. JK Value 검토 후 승인됩니다.');
        if (S.mode === 'server' && !(j && j.local)) {
          setTimeout(function () { loadRoomData(room.id, true).then(render); }, 1600);
        }
      }).catch(function () { toast('CA 제출 실패(네트워크)', true); });
    });
  }

  /* ── CA 전문 ── */
  function openCaTerms() {
    var room = selectedRoom() || {};
    var body = '<div class="jkv-terms-full">' +
      '<p><b>JK VALUE 전자 비밀유지각서(Confidentiality Agreement) 표준안</b><br>' +
      '본 각서는 ' + esc(room.asset_name || room.name || '대상 자산') + '의 매각 검토와 관련하여 JK Value 및 매각자문사·자산운용사(이하 "공개자")가 제공하는 자료의 취급을 정합니다.</p>' +
      '<h4>제1조 (목적)</h4><p>수령자는 제공 자료를 해당 자산의 매수·투자 검토 목적으로만 사용하며, 그 외 목적으로 복제·배포·활용하지 않습니다.</p>' +
      '<h4>제2조 (비밀정보의 범위)</h4><p>렌트롤, 임대차계약, OPEX·CAPEX, 재무모델, IM·티저 원문, 매도인·임차인 정보, 거래 조건, 협상 경과 등 서면·전자 형태로 제공된 일체의 정보가 이에 해당합니다.</p>' +
      '<h4>제3조 (제3자 제공 금지)</h4><p>수령자는 공개자의 사전 서면 동의 없이 비밀정보를 제3자에게 제공하지 않습니다. 다만 자문사·회계·법률·금융기관 등 검토에 필요한 최소 인원에게는 동일한 비밀유지 의무를 부과한 경우에 한해 제공할 수 있으며, 그 명단을 JK Value에 통지합니다.</p>' +
      '<h4>제4조 (매도인·임차인 직접 접촉 금지)</h4><p>수령자는 JK Value를 통하지 않고 매도인·자산운용사·임차인·운영사(PM)에 직접 접촉하거나 거래 조건을 별도로 협의하지 않습니다.</p>' +
      '<h4>제5조 (비밀유지 기간)</h4><p>본 각서의 효력은 체결일로부터 3년간 유지됩니다. 자료별로 별도의 보존 기간이 정해진 경우 그 기간을 따릅니다.</p>' +
      '<h4>제6조 (반환·파기)</h4><p>검토 종료 또는 공개자의 요청이 있으면 5영업일 내에 제공 자료를 반환하거나 복구 불가능한 방법으로 파기하고, 파기확인서를 제출합니다.</p>' +
      '<h4>제7조 (손해배상·위약벌)</h4><p>수령자가 본 각서를 위반한 경우 실제 발생한 손해를 배상하며, 이와 별도로 위약벌로 10억원 또는 해당 거래가액의 1% 중 높은 금액을 지급합니다. 위약벌은 손해배상액의 예정이 아니며, 법원은 민법 제398조 제2항에 따라 이를 감액할 수 있습니다.</p>' +
      '<h4>제8조 (열람 로그·워터마크)</h4><p>플랫폼은 열람자 회사명·성명·시각을 워터마크로 표시하고, 자료 열람·다운로드 이력을 기록·보관합니다. 수령자는 이를 임의로 제거하거나 우회하지 않습니다.</p>' +
      '<h4>제9조 (개인정보)</h4><p>담당자 개인정보는 CA 체결·이행·분쟁 대응 목적으로 처리하며 목적 달성 시 파기합니다.</p>' +
      '<h4>제10조 (준거법·관할)</h4><p>본 각서는 대한민국 법률에 따르며, 분쟁은 서울중앙지방법원을 전속 관할로 합니다.</p>' +
      '<p class="jkv-note">본 화면은 표준안 요약이며, 실제 체결 문서는 딜별 특약(비밀유지 예외, 공개 제한, 금지행위 범위)을 추가해 확정합니다.</p>' +
      '</div><div class="tr-actions"><button type="button" class="btn btn-ghost" data-vdr="close">닫기</button>' +
      '<button type="button" class="btn btn-primary" data-vdr="ca-new">🔐 CA 작성</button></div>';
    modalShell('📜 CA 표준 조항 (전문)', body, true);
  }

  /* ── IM·티저 요청 ── */
  function openImRequest(kind) {
    var room = selectedRoom();
    if (!room) return;
    if (!hasAccess(room.id)) { toast('CA 승인 후 요청할 수 있습니다.', true); return; }
    var body = '<p class="rfp-note">요청 즉시 JK Value에 접수되며, 워터마크가 삽입된 사본을 이메일로 발송합니다.</p>' +
      '<div class="tr-grid">' +
      '<label class="tr-f wide"><span>요청 자료</span><input value="' + esc(kind || 'IM·티저 열람') + '" readonly></label>' +
      '<label class="tr-f wide"><span>요청 사유·추가 요청</span><textarea name="memo" rows="3" placeholder="예) 렌트롤 엑셀 원본과 최근 3년 OPEX 실적 함께 요청"></textarea></label>' +
      '</div><div class="tr-actions"><button type="button" class="btn btn-ghost" data-vdr="close">취소</button>' +
      '<button type="button" class="btn btn-primary" data-vdr="req-save">요청 보내기</button></div>';
    var m = modalShell('📩 자료 요청 — ' + room.name, body, false);
    m.querySelector('[data-vdr="req-save"]').addEventListener('click', function () {
      var memo = m.querySelector('[name="memo"]').value;
      persistReq(room.id, kind || 'IM·티저 열람', memo);
      persistLog(room.id, '자료 요청', (kind || 'IM·티저') + (memo ? ' · ' + memo : ''));
      closeModal(); render(); toast('요청을 접수했습니다. JK Value가 확인 후 발송합니다.');
    });
  }

  /* ── LOI 제출 ── */
  function openLoiForm() {
    var room = selectedRoom();
    if (!room) return;
    if (!hasAccess(room.id)) { toast('CA 승인 후 LOI를 제출할 수 있습니다.', true); return; }
    var ca = caFor(room.id);
    var it = myIdentity();
    var body = '<p class="rfp-note">' + esc(room.name) + ' — LOI(투자의향서)는 법적 구속력이 없으며, 우선협상대상자 선정 후 실사·SPA로 이어집니다.</p>' +
      '<div class="tr-grid">' +
      '<label class="tr-f"><span>매수 주체(법인/SPC) <b>*</b></span><input name="company" value="' + esc((ca && ca.company) || it.company) + '"></label>' +
      '<label class="tr-f"><span>담당자 <b>*</b></span><input name="bidder" value="' + esc((ca && ca.name) || it.name) + '"></label>' +
      '<label class="tr-f"><span>직책</span><input name="title" value="' + esc((ca && ca.title) || it.title) + '"></label>' +
      '<label class="tr-f"><span>연락처 <b>*</b></span><input name="phone" type="tel" value="' + esc((ca && ca.phone) || '') + '"></label>' +
      '<label class="tr-f wide"><span>이메일</span><input name="email" type="email" value="' + esc((ca && ca.email) || it.email) + '"></label>' +
      '<label class="tr-f"><span>제안 매입가(억원) <b>*</b></span><input name="price_eok" type="number" step="1" placeholder="예) 3500"></label>' +
      '<label class="tr-f"><span>자기자본(억원)</span><input name="equity_eok" type="number" step="1" placeholder="예) 1200"></label>' +
      '<label class="tr-f"><span>선순위 대출(억원)</span><input name="debt_eok" type="number" step="1" placeholder="예) 2300"></label>' +
      '<label class="tr-f"><span>LTV(%)</span><input name="ltv_pct" type="number" step="1" placeholder="예) 65"></label>' +
      '<label class="tr-f"><span>대출 금리(%)</span><input name="rate_pct" type="number" step="0.1" placeholder="예) 4.6"></label>' +
      '<label class="tr-f"><span>자금조달 확실성</span><select name="funding">' + FUNDING.map(function (f) { return '<option>' + f + '</option>'; }).join('') + '</select></label>' +
      '<label class="tr-f"><span>매각 조건 수용</span><select name="accept"><option>전부 수용</option><option>일부 협의</option><option>이의 있음</option></select></label>' +
      '<label class="tr-f"><span>실사 희망(일)</span><input name="dd_days" type="number" step="1" placeholder="예) 21"></label>' +
      '<label class="tr-f"><span>잔금까지(개월)</span><input name="close_months" type="number" step="1" placeholder="예) 3"></label>' +
      '<label class="tr-f"><span>LOI 유효기간</span><input name="valid_days" type="number" step="1" value="14" placeholder="14"></label>' +
      '<label class="tr-f"><span>수수료 부담</span><select name="fee_bearer"><option>매수자 부담</option><option>매도자 부담</option><option>별도 협의</option></select></label>' +
      '<label class="tr-f wide"><span>인수 조건·특약</span><textarea name="conditions" rows="2" placeholder="예) 임대차 승계, 명도 완료 후 잔금, PF 확약서 제출"></textarea></label>' +
      '<label class="tr-f wide"><span>비고</span><textarea name="memo" rows="2" placeholder="예) 코어 전략, 5년 보유, 리츠 편입 검토"></textarea></label>' +
      '</div>' +
      '<label class="jkv-agree"><input type="checkbox" name="confirm"> 제출 내용이 사실이며, JK Value의 검토·비교 목적에 사용되는 데 동의합니다. <b>*</b></label>' +
      '<p class="jkv-note">CA ID ' + esc((ca && ca.id) || '-') + ' · 제출 시각과 함께 기록됩니다.</p>' +
      '<div class="tr-actions"><button type="button" class="btn btn-ghost" data-vdr="close">취소</button>' +
      '<button type="button" class="btn btn-primary" data-vdr="loi-save">LOI 제출</button></div>';
    var m = modalShell('📝 LOI 제출 — ' + room.name, body, true);
    m.querySelector('[data-vdr="loi-save"]').addEventListener('click', function () {
      var v = function (k) { var el = m.querySelector('[name="' + k + '"]'); return el ? String(el.value || '').trim() : ''; };
      if (!(num(v('price_eok')) > 0)) { toast('제안 매입가를 입력하세요.', true); return; }
      if (!v('company')) { toast('매수 주체를 입력하세요.', true); return; }
      if (!v('bidder')) { toast('담당자를 입력하세요.', true); return; }
      if (String(v('phone')).replace(/[^0-9]/g, '').length < 7) { toast('연락처를 정확히 입력하세요.', true); return; }
      if (!m.querySelector('[name="confirm"]').checked) { toast('제출 확인에 동의해 주세요.', true); return; }
      var days = num(v('valid_days')) || 14;
      var validUntil = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      var bid = {
        id: 'bid-' + Date.now().toString(36), room_id: room.id, room_name: room.name,
        kind: 'LOI', price_eok: v('price_eok'), equity_eok: v('equity_eok'), debt_eok: v('debt_eok'),
        funding: v('funding'), ltv_pct: v('ltv_pct'), rate_pct: v('rate_pct'), accept: v('accept'),
        dd_days: v('dd_days'), close_months: v('close_months'), valid_until: validUntil,
        fee_bearer: v('fee_bearer'), conditions: v('conditions'),
        company: v('company'), bidder: v('bidder'), title: v('title'), phone: v('phone'), email: v('email'),
        memo: v('memo'), ca_id: (caFor(room.id) || {}).id || '', status: '접수', timestamp: nowISO()
      };
      persistBid(bid).then(function (j) {
        if (!j || !j.ok) { toast('제출 실패: ' + ((j && j.error) || ''), true); return; }
        var ref = myRef(room.id) || { bid_ids: [] };
        ref.bid_ids = ref.bid_ids || [];
        ref.bid_ids.push(bid.id);
        ref.company = ref.company || bid.company; ref.name = ref.name || bid.bidder; ref.email = ref.email || bid.email;
        myRefSave(room.id, ref);
        persistLog(room.id, 'LOI 제출', n0(bid.price_eok) + '억 · ' + bid.funding);
        closeModal();
        S.tab = 'loi';
        mergeBidLocal(bid); render();
        toast('LOI를 제출했습니다. JK Value 검토 후 연락드립니다.');
        setTimeout(function () { loadRoomData(room.id, true).then(function () { mergeBidLocal(bid); render(); }); }, 1600);
      }).catch(function () { toast('제출 실패(네트워크)', true); });
    });
  }

  /** 검증용 샘플 후보 3건 — 화면에서 '샘플'로 표시 */
  function seedBids() {
    var room = selectedRoom();
    if (!room) return;
    var g = num(room.price_guide_eok) || 3000;
    var samples = [
      { company: '[샘플] 한빛자산운용', bidder: '김한빛', title: '투자본부 이사', phone: '010-0000-0001', kind: 'BID', price_eok: Math.round(g * 1.03), funding: '확약(Commitment)', ltv_pct: 62, accept: '전부 수용', dd_days: 14, close_months: 2 },
      { company: '[샘플] 서강리츠', bidder: '이서강', title: '팀장', phone: '010-0000-0002', kind: 'BID', price_eok: Math.round(g * 0.98), funding: '조건부(Conditional)', ltv_pct: 70, accept: '일부 협의', dd_days: 30, close_months: 3 },
      { company: '[샘플] 대성인베스트', bidder: '박대성', title: '상무', phone: '010-0000-0003', kind: 'LOI', price_eok: Math.round(g * 0.92), funding: '미확보', ltv_pct: 80, accept: '이의 있음', dd_days: 45, close_months: 6 }
    ];
    var jobs = samples.map(function (b, i) {
      var bid = {};
      for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) bid[k] = b[k];
      bid.id = 'bidsmp-' + room.id + '-' + i;
      bid.room_id = room.id; bid.room_name = room.name;
      bid.status = '샘플'; bid.timestamp = nowISO(); bid._sample = true;
      bid.memo = '검증용 샘플 후보(실제 접수 아님)';
      return persistBid(bid);
    });
    Promise.all(jobs).then(function () {
      loadRoomData(room.id, true).then(function () { render(); toast('샘플 후보 3건을 넣었습니다. (검증 후 삭제 대상)'); });
    }).catch(function () { toast('샘플 입력 실패', true); });
  }

  /* ─────────────────────────── 이벤트 ─────────────────────────── */
  function decideCA(id, status) {
    var room = selectedRoom();
    if (!room) return;
    var list = caList(room.id);
    var c = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) c = list[i];
    if (!c) return;
    c.status = status;
    c.approved_at = status === '승인' ? nowISO() : '';
    c.decided_by = (me() && me().name) || 'JK Value';
    if (status === '반려') c.reason = c.reason || '기관 실체·투자 적격성 확인 필요';
    if (status === '심사중') c.reason = 'JK Value 승인 취소 — 재검토';
    persistCA(c).then(function () {
      persistLog(room.id, 'CA ' + status, c.company + ' ' + c.name);
      render();
      toast('CA를 ' + status + ' 처리했습니다.');
    });
  }

  function bind() {
    var host = $('#vdrView');
    if (!host) return;
    host.onclick = function (e) {
      var rm = e.target.closest('[data-vdr-room]');
      if (rm) {
        S.roomId = rm.getAttribute('data-vdr-room');
        S.tab = 'blind';
        loadRoomData(S.roomId, false).then(function () { render(); });
        return;
      }
      var tb = e.target.closest('[data-vdr-tab]');
      if (tb) {
        S.tab = tb.getAttribute('data-vdr-tab');
        var room = selectedRoom();
        if (room && (S.tab === 'docs' || S.tab === 'loi') && hasAccess(room.id)) {
          persistLog(room.id, S.tab === 'docs' ? '상세자료 열람' : 'LOI 화면 열람', S.tab === 'docs' ? '렌트롤·OPEX·CAPEX·IM' : '');
        }
        render();
        return;
      }
      var de = e.target.closest('[data-vdr-doc-edit]');
      if (de) { openDocEditor(de.getAttribute('data-vdr-doc-edit')); return; }
      var lg = e.target.closest('[data-vdr-log]');
      if (lg) {
        var rr = selectedRoom();
        if (rr) persistLog(rr.id, lg.getAttribute('data-vdr-log'), '');
        return;
      }
      var okBtn = e.target.closest('[data-vdr-ca-ok]');
      if (okBtn) { decideCA(okBtn.getAttribute('data-vdr-ca-ok'), '승인'); return; }
      var noBtn = e.target.closest('[data-vdr-ca-no]');
      if (noBtn) { decideCA(noBtn.getAttribute('data-vdr-ca-no'), '반려'); return; }
      var rvBtn = e.target.closest('[data-vdr-ca-revoke]');
      if (rvBtn) { decideCA(rvBtn.getAttribute('data-vdr-ca-revoke'), '심사중'); return; }
      var b = e.target.closest('[data-vdr]');
      if (!b) return;
      var act = b.getAttribute('data-vdr');
      if (act === 'room-new') openRoomEditor(null);
      else if (act === 'room-edit') openRoomEditor(selectedRoom());
      else if (act === 'reload') { S.loaded = false; loadRooms(true).then(function () { return loadRoomData(S.roomId, true); }).then(render); }
      else if (act === 'bid-new' || act === 'loi-new') openLoiForm();
      else if (act === 'bid-seed') seedBids();
      else if (act === 'ca-new') openCaForm();
      else if (act === 'ca-terms') openCaTerms();
      else if (act === 'im-request') openImRequest('IM·티저 열람');
      else if (act === 'dd-request') openImRequest('실사자료 목록');
      else if (act === 'val-open') {
        var r2 = selectedRoom();
        var a = linkedAsset(r2);
        if (a && window.NAI_VAL && window.NAI_VAL.openForAsset) { window.naiShowView('valuation'); window.NAI_VAL.openForAsset(a); }
        else toast('연결된 물건 DB가 없습니다. CA 승인 후 JK Value가 밸류에이션 자료를 제공합니다.', true);
      }
      else if (act === 'as-inv') { S.asInvestor = !S.asInvestor; S.tab = 'blind'; render(); }
      else if (act === 'wreset') { S.weights = { price: 40, funding: 30, terms: 30 }; render(); }
      else if (act === 'close') closeModal();
    };
    $$('[data-vdr-w]', host).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var k = inp.getAttribute('data-vdr-w');
        S.weights[k] = num(inp.value, 0);
        render();
      });
    });
  }

  /* ─────────────────────────── 진입 ─────────────────────────── */
  function show() {
    var host = $('#vdrView');
    if (!host) return;
    if (!S.loaded) host.innerHTML = '<div class="vdr-shell"><p class="vdr-empty big">딜룸을 불러오는 중…</p></div>';
    loadRooms(false).then(function (rooms) {
      if (!S.roomId && rooms.length) S.roomId = rooms[0].id;
      return loadRoomData(S.roomId, false);
    }).then(render).catch(function () { render(); });
  }

  function openForAsset(assetId) {
    var st = window.naiMap && window.naiMap.state;
    var a = st && st.index ? st.index[assetId] : null;
    loadRooms(true).then(function (rooms) {
      var hit = null;
      rooms.forEach(function (r) {
        if (hit) return;
        if (r.asset_id && String(r.asset_id) === String(assetId)) hit = r;
        if (!hit && a && String(r.asset_name || '').indexOf(String(a.name || '')) >= 0) hit = r;
      });
      if (hit) S.roomId = hit.id;
      else if (isAdmin() && a) {
        openRoomEditor({
          name: a.name + ' 매각 · JK Value', asset_name: a.name + (a.address ? ' (' + a.address + ')' : ''),
          asset_id: assetId,
          price_guide_eok: String(a.price_info || '').replace(/[^0-9.]/g, ''), stage: '자료 배포'
        });
        return;
      }
      if (window.naiShowView) window.naiShowView('vdr');
      S.loaded = true;
      S.tab = 'blind';
      loadRoomData(S.roomId, true).then(render);
    });
  }

  window.NAI_VDR = {
    show: show,
    openForAsset: openForAsset,
    state: S,
    scoreBids: function () { return scoreBids(S.roomId); },
    caStatus: function (roomId) { return caStatus(roomId || S.roomId); }
  };
})();
