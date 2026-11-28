/* =========================================================================
   Open AI Asset Bridge — vdr.js  (🏢 자문사 VDR · 입찰 워크룸, 2026-11-24)
   -------------------------------------------------------------------------
   자문사(NAI Korea)가 실제로 쓰는 딜 워크룸입니다.

     ① 자료 관리 : RFP 조건 · 렌트롤(Rent Roll) · OPEX · CAPEX 를 구조화해 등록/열람
     ② 접수·입찰 : 참여자가 의향서(LOI) / 최종 입찰(Bidding) 금액·조건을 제출·조회
     ③ 🤖 AI 쇼트리스트 : 접수 후보를 가격 · 자금조달 확실성 · 조건 적합도로 점수화해
        순위표·추천안을 브라우저 안에서 즉시 생성 (외부 유료 API·키 없음)

   저장 — Apps Script Hub.gs 의 시트 vdr_rooms / vdr_docs / vdr_bids
     GET  ?type=vdr_rooms | vdr_docs&room=<id> | vdr_bids&room=<id>
     POST {action:'vdr_room_save'|'vdr_doc_save'|'vdr_doc_delete'|'vdr_bid_submit'|'vdr_bid_status'}
   서버에 새 API 가 아직 없으면 같은 브라우저(localStorage)로 동작하고, 화면에
   "로컬 모드" 로 명확히 표시합니다(자문사·참여자가 다른 기기면 공유되지 않음).
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var TOKEN_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':token:v1';
  var LS_KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':vdr:v1';
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

  var S = {
    rooms: [], docsByRoom: {}, bidsByRoom: {},
    roomId: '', tab: 'docs', loaded: false, loading: false, mode: 'server', err: '',
    weights: { price: 40, funding: 30, terms: 30 }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function n0(v) { var x = Number(v); return isFinite(x) ? x.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '-'; }
  function num(v, d) { var x = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(x) ? x : (d === undefined ? 0 : d); }
  function today() { var d = new Date(); return d.toISOString().slice(0, 10); }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function isAdmin() { return role() === 'admin'; }
  function me() { return (window.naiMap && window.naiMap.me) ? window.naiMap.me() : null; }

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

  /* ─────────────────────────── 데이터 로드 ─────────────────────────── */
  function localRooms() {
    var db = lsAll();
    return {
      rooms: db.rooms || [],
      docs: db.docs || [],
      bids: db.bids || []
    };
  }

  function loadRooms(force) {
    if (S.loading) return S.loading;
    if (S.loaded && !force) return Promise.resolve(S.rooms);
    S.loading = true;
    return apiGet('type=vdr_rooms').then(function (j) {
      if (j && j.ok && j.items) {
        S.rooms = j.items;
        S.mode = 'server';
        S.loaded = true; S.loading = false;
        return S.rooms;
      }
      throw new Error('no_api');
    }).catch(function () {
      var db = localRooms();
      S.rooms = db.rooms;
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
      return Promise.resolve();
    }
    return Promise.all([
      apiGet('type=vdr_docs&room=' + encodeURIComponent(roomId)).catch(function () { return null; }),
      apiGet('type=vdr_bids&room=' + encodeURIComponent(roomId)).catch(function () { return null; })
    ]).then(function (res) {
      S.docsByRoom[roomId] = ((res[0] && res[0].items) || []);
      S.bidsByRoom[roomId] = ((res[1] && res[1].items) || []);
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

  /* ─────────────────────────── 룸 목록 ─────────────────────────── */
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

  /* 낙관적 갱신 — 서버 목록 조회가 1~2초 늦게 반영되는 동안에도 방금 저장한 항목이 보이도록 */
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

  /* ─────────────────────────── AI 쇼트리스트 ─────────────────────────── */
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
      /* ① 가격 — 최고가·가이드 대비. 가이드 미달은 추가 감점 */
      var pricePts = Math.max(0, Math.min(1, p / base)) * num(w.price);
      if (guide > 0 && p < guide) pricePts *= 0.9;
      var priceRatio = base > 0 ? p / base : 0;

      /* ② 자금조달 확실성 — 확약/조건부/미확보 + LTV */
      var fBase = String(b.funding || '') .indexOf('확약') === 0 ? 1 : (String(b.funding || '').indexOf('조건부') === 0 ? 0.68 : 0.3);
      var ltv = num(b.ltv_pct);
      var ltvAdj = ltv > 0 ? (ltv <= 65 ? 0.1 : (ltv <= 75 ? 0 : -0.12)) : 0;
      var fundPts = Math.max(0, Math.min(1, fBase + ltvAdj)) * num(w.funding);

      /* ③ 조건 적합도 — 조건 수용도 + 실사기간 + 인수 시점 */
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
    if (x.price >= num((selectedRoom() || {}).price_guide_eok) && num((selectedRoom() || {}).price_guide_eok) > 0) out.push('가이드가 이상');
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
      return '<div class="vdr-empty">아직 접수된 LOI·입찰이 없습니다. <b>📝 접수·입찰</b> 탭에서 후보를 등록하면 즉시 쇼트리스트가 생성됩니다.</div>';
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

  /* ─────────────────────────── 렌더 ─────────────────────────── */
  function roomListHTML() {
    if (!S.rooms.length) {
      return '<div class="vdr-empty">등록된 딜룸이 없습니다.' + (isAdmin() ? '<br><b>＋ 새 딜룸</b>으로 매각·입찰 건을 만들거나 <b>예시 딜룸</b>을 넣어 화면을 확인해 보세요.' : '<br>자문사가 딜룸을 열면 여기에 표시됩니다.') + '</div>';
    }
    return S.rooms.map(function (r) {
      var on = r.id === S.roomId;
      var bids = (S.bidsByRoom[r.id] || []);
      return '<button type="button" class="vdr-room' + (on ? ' on' : '') + '" data-vdr-room="' + esc(r.id) + '">' +
        '<span class="vr-stage">' + esc(r.stage || '자료 배포') + '</span>' +
        '<strong>' + esc(r.name || '딜룸') + '</strong>' +
        '<span class="vr-asset">' + esc(r.asset_name || '') + '</span>' +
        '<span class="vr-meta">' + (r.price_guide_eok ? '가이드 ' + n0(r.price_guide_eok) + '억 · ' : '') +
        '입찰 ' + esc(r.bid_deadline || '미정') + '</span>' +
        '<span class="vr-n">접수 ' + bids.length + '건</span></button>';
    }).join('');
  }

  function docCardHTML(kind) {
    var room = selectedRoom();
    if (!room) return '';
    var d = docOf(room.id, kind.k);
    var rows = d ? (d.rows || docRows(d.text)) : [];
    var body;
    if (!d) {
      body = '<p class="vdr-doc-empty">아직 등록되지 않았습니다.' + (isAdmin() ? ' <button type="button" class="mini-btn" data-vdr-doc-edit="' + kind.k + '">＋ 등록</button>' : '') + '</p>';
    } else if (!rows.length) {
      body = '<p class="vdr-doc-empty">내용이 비어 있습니다.' + (isAdmin() ? ' <button type="button" class="mini-btn" data-vdr-doc-edit="' + kind.k + '">✏️ 편집</button>' : '') + '</p>';
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
      (isAdmin() && d ? '<button type="button" class="mini-btn" data-vdr-doc-edit="' + kind.k + '">✏️ 편집</button>' : '') +
      '</div>' + body + '</section>';
  }

  function docsTabHTML() {
    var h = '<div class="vdr-docs">';
    DOC_KINDS.forEach(function (k) { h += docCardHTML(k); });
    h += '</div>';
    return h;
  }

  function bidsTabHTML() {
    var room = selectedRoom();
    if (!room) return '';
    var bids = bidsOf(room.id);
    var h = '<div class="vdr-bids">';
    h += '<div class="vdr-bid-actions">' +
      '<button type="button" class="btn btn-primary" data-vdr="bid-new">📝 LOI / 입찰 제출</button>' +
      '<span class="vdr-hint">제출한 금액·조건은 자문사(관리자)만 전체를 조회합니다. 참여자는 본인 제출분만 확인됩니다.</span></div>';
    if (!bids.length) {
      h += '<div class="vdr-empty">접수된 LOI·입찰이 없습니다.' + (isAdmin() ? ' <b>＋ 샘플 후보 3건</b>을 넣어 AI 쇼트리스트를 바로 확인해 볼 수 있습니다.' : '') +
        (isAdmin() ? ' <button type="button" class="mini-btn" data-vdr="bid-seed">＋ 샘플 후보 3건(검증용)</button>' : '') + '</div>';
    } else {
      h += '<div class="vdr-table-wrap"><table class="vdr-table"><thead><tr>' +
        '<th>제출일시</th><th>구분</th><th>후보</th><th>제시가(억)</th><th>자금조달</th><th>LTV</th><th>조건</th><th>상태</th></tr></thead><tbody>';
      bids.forEach(function (b) {
        h += '<tr class="' + (b._sample ? 'vdr-sample' : '') + '">' +
          '<td class="nowrap">' + esc(String(b.timestamp || b.submitted_at || '').replace('T', ' ').slice(0, 16)) + '</td>' +
          '<td>' + esc(b.kind || 'LOI') + (b._sample ? ' <span class="vdr-smp">샘플</span>' : '') + '</td>' +
          '<td><b>' + esc(b.company || '-') + '</b><span class="vdr-sub">' + esc([b.bidder, b.title, b.phone].filter(Boolean).join(' · ')) + '</span></td>' +
          '<td class="num b">' + n0(b.price_eok) + '</td>' +
          '<td>' + esc(b.funding || '-') + '</td>' +
          '<td class="num">' + (b.ltv_pct ? n0(b.ltv_pct) + '%' : '-') + '</td>' +
          '<td class="vdr-terms">' + esc([b.accept, (b.dd_days ? '실사 ' + b.dd_days + '일' : ''), (b.close_months ? b.close_months + '개월' : '')].filter(Boolean).join(' · ')) +
          (b.memo ? '<span class="vdr-sub">' + esc(b.memo) + '</span>' : '') + '</td>' +
          '<td>' + esc(b.status || '접수') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
  }

  function SS() { return (window.NAI_RFPC && window.NAI_RFPC.session) ? window.NAI_RFPC.session() : null; }
  function isParty() { var s = SS(); return !!(s && s.holder_type); }

  /* 참여자 모드 — 자기가 초청·선정된 딜의 VDR만. 딜 룸(dealroom)이 본문입니다. */
  function renderParty() {
    var host = $('#vdrView');
    if (!host) return;
    var C = window.NAI_RFPC;
    var list = C.visibleRfps(SS());
    if (!list.length) {
      host.innerHTML = '<div class="vdr-shell"><div class="dr-empty"><b>열람할 딜이 없습니다.</b><p>담당자에게 초청·승인 코드를 요청하세요.</p></div></div>';
      return;
    }
    var cur = list.filter(function (r) { return String(r.id) === String(S.roomId).replace('rfp:', '') || String(r.id) === String(S.roomId); })[0] || list[0];
    S.roomId = 'rfp:' + cur.id;
    var room = { id: S.roomId, rfp_id: cur.id, name: cur.title, asset_name: cur.asset_name, asset_id: cur.asset_id };
    var h = '<div class="vdr-shell dr-shell"><div class="dr-mytop"><div class="dr-mytop-title"><b>🏢 내 딜 룸</b><span>' + esc(SS().holder || '') + ' · ' + esc(SS().holder_type) + '</span></div>' +
      '<div class="dr-mydeals">' + list.map(function (r) {
        return '<button type="button" class="dr-mydeal' + (r.id === cur.id ? ' on' : '') + '" data-vdr-room="rfp:' + esc(r.id) + '">' +
          '<b>' + esc(r.title) + '</b><em>' + esc([r.asset_name, C.flowOf(r)].filter(Boolean).join(' · ')) + '</em></button>';
      }).join('') + '</div></div>';
    if (window.NAI_DEALROOM) {
      h += window.NAI_DEALROOM.render(room, { mode: 'party' });
    } else {
      h += '<div class="dr-empty">딜 룸 모듈을 불러오지 못했습니다.</div>';
    }
    h += '</div>';
    host.innerHTML = h;
    bind();
    if (window.NAI_DEALROOM) window.NAI_DEALROOM.bind(host, room, function () { render(); });
  }

  function render() {
    var host = $('#vdrView');
    if (!host) return;
    if (isParty()) { renderParty(); return; }
    var room = selectedRoom();
    if (room && !S.roomId) S.roomId = room.id;
    var h = '<div class="vdr-shell">';
    h += '<div class="vdr-top"><div><h2>🏢 자문사 VDR · 입찰 워크룸</h2>' +
      '<p>RFP·렌트롤·OPEX·CAPEX 를 구조화해 배포하고, LOI·최종 입찰을 접수해 <b>AI 쇼트리스트</b>로 비교합니다. ' +
      '자료와 접수는 비공개 시트에 저장되며 참여자에게는 공개 자료만 보입니다.</p>' +
      (S.mode === 'local' ? '<p class="vdr-offline">⚠️ 서버 VDR API 미연결 → <b>이 브라우저(로컬) 모드</b>로 동작 중입니다. 자문사·참여자가 다른 기기면 공유되지 않습니다.</p>' : '') +
      '</div><div class="vdr-top-actions">' +
      (isAdmin() ? '<button type="button" class="btn btn-primary" data-vdr="room-new">＋ 새 딜룸</button>' : '') +
      '<button type="button" class="btn btn-ghost" data-vdr="reload">↻ 새로고침</button></div></div>';

    h += '<div class="vdr-grid"><aside class="vdr-rooms">' + roomListHTML() + '</aside><main class="vdr-main">';
    if (!room) {
      h += '<div class="vdr-empty big">딜룸을 선택하거나 새로 만들어 주세요.</div>';
    } else {
      h += '<div class="vdr-room-head"><div><span class="vdr-stage">' + esc(room.stage || '자료 배포') + '</span>' +
        '<h3>' + esc(room.name) + '</h3>' +
        '<p>' + esc([room.asset_name, room.region, room.sector].filter(Boolean).join(' · ')) + '</p></div>' +
        '<div class="vdr-room-kpis">' +
        '<span><b>' + (room.price_guide_eok ? n0(room.price_guide_eok) + '억' : '-') + '</b>가이드가</span>' +
        '<span><b>' + esc(room.loi_deadline || '-') + '</b>LOI 마감</span>' +
        '<span><b>' + esc(room.bid_deadline || '-') + '</b>입찰 마감</span>' +
        '<span><b>' + bidsOf(room.id).length + '건</b>접수</span></div></div>';
      if (room.description) h += '<p class="vdr-desc">' + esc(room.description) + '</p>';
      h += '<div class="vdr-tabs" role="tablist">' +
        [['deal', '📑 딜·VDR'], ['docs', '📁 자료 관리'], ['bids', '📝 접수·입찰'], ['ai', '🤖 AI 쇼트리스트']].map(function (t) {
          return '<button type="button" class="vdr-tab' + (S.tab === t[0] ? ' on' : '') + '" data-vdr-tab="' + t[0] + '">' + t[1] + '</button>';
        }).join('') + '</div>';
      if (S.tab === 'deal') {
        if (window.NAI_DEALROOM) h += window.NAI_DEALROOM.render(room, { mode: 'staff' });
        else h += '<div class="dr-empty">딜 룸 모듈을 불러오지 못했습니다.</div>';
      }
      else if (S.tab === 'docs') h += docsTabHTML();
      else if (S.tab === 'bids') h += bidsTabHTML();
      else h += shortlistHTML(room.id);
    }
    h += '</main></div></div>';
    host.innerHTML = h;
    bind();
    if (S.tab === 'deal' && window.NAI_DEALROOM && room) window.NAI_DEALROOM.bind(host, room, function () { render(); });
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
      '<label class="tr-f wide"><span>대상 물건</span><input name="asset_name" value="' + esc(r.asset_name || '') + '" placeholder="예) 종로플레이스 (종로구 창경궁로 120)"></label>' +
      '<label class="tr-f"><span>진행 단계</span><select name="stage">' + STAGES.map(function (s) {
        return '<option' + (s === r.stage ? ' selected' : '') + '>' + s + '</option>';
      }).join('') + '</select></label>' +
      '<label class="tr-f"><span>가이드가(억)</span><input name="price_guide_eok" type="number" step="1" value="' + esc(r.price_guide_eok || '') + '"></label>' +
      '<label class="tr-f"><span>LOI 마감</span><input name="loi_deadline" type="date" value="' + esc(r.loi_deadline || '') + '"></label>' +
      '<label class="tr-f"><span>입찰 마감</span><input name="bid_deadline" type="date" value="' + esc(r.bid_deadline || '') + '"></label>' +
      '<label class="tr-f wide"><span>설명</span><textarea name="description" rows="2" placeholder="매각 구조·특이사항">' + esc(r.description || '') + '</textarea></label>' +
      '</div><div class="tr-actions"><button type="button" class="btn btn-ghost" data-vdr="close">취소</button></div>' +
      '<div class="tr-actions"><button type="button" class="btn btn-primary" data-vdr="room-save">저장</button></div>';
    var m = modalShell(room ? '✏️ 딜룸 수정' : '＋ 새 딜룸', body, true);
    m.querySelector('[data-vdr="room-save"]').addEventListener('click', function () {
      var v = function (k) { var el = m.querySelector('[name="' + k + '"]'); return el ? el.value.trim() : ''; };
      var nm = v('name');
      if (!nm) { toast('딜룸 이름을 입력하세요.', true); return; }
      var obj = {
        id: r.id || ('vdr-' + Date.now().toString(36)),
        name: nm, asset_name: v('asset_name'), stage: v('stage') || '자료 배포',
        price_guide_eok: v('price_guide_eok'), loi_deadline: v('loi_deadline'), bid_deadline: v('bid_deadline'),
        description: v('description'), rfp_id: r.rfp_id || '', asset_id: r.asset_id || '', created_at: r.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
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
      '<div class="tr-actions"><button type="button" class="btn btn-ghost" data-vdr="close">취소</button></div>' +
      '<div class="tr-actions"><button type="button" class="btn btn-primary" data-vdr="doc-save">저장</button></div>';
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

  function openBidForm() {
    var room = selectedRoom();
    if (!room) return;
    var body = '<p class="vdr-note">' + esc(room.name) + ' — 제시가·자금조달·조건을 입력해 주세요. 제출 즉시 AI 쇼트리스트 점수에 반영됩니다.</p>' +
      '<div class="tr-grid">' +
      '<label class="tr-f"><span>구분</span><select name="kind"><option value="LOI">의향서(LOI)</option><option value="BID">최종 입찰(Bidding)</option></select></label>' +
      '<label class="tr-f"><span>제시가(억원) <b>*</b></span><input name="price_eok" type="number" step="1" placeholder="예) 3600"></label>' +
      '<label class="tr-f"><span>자금조달 확실성</span><select name="funding">' + FUNDING.map(function (f) { return '<option>' + f + '</option>'; }).join('') + '</select></label>' +
      '<label class="tr-f"><span>LTV(%)</span><input name="ltv_pct" type="number" step="1" placeholder="예) 65"></label>' +
      '<label class="tr-f"><span>매각 조건 수용</span><select name="accept"><option>전부 수용</option><option>일부 협의</option><option>이의 있음</option></select></label>' +
      '<label class="tr-f"><span>실사 희망(일)</span><input name="dd_days" type="number" step="1" placeholder="예) 21"></label>' +
      '<label class="tr-f"><span>인수 시점(개월)</span><input name="close_months" type="number" step="1" placeholder="예) 3"></label>' +
      '<label class="tr-f"><span>대출 금리(%)</span><input name="rate_pct" type="number" step="0.1" placeholder="예) 4.6"></label>' +
      '<label class="tr-f wide"><span>회사 <b>*</b></span><input name="company" value="' + esc((me() && me().company) || '') + '" placeholder="예) OO자산운용"></label>' +
      '<label class="tr-f"><span>성명 <b>*</b></span><input name="bidder" value="' + esc(role() === 'internal' ? '' : ((me() && me().name) || '')) + '"></label>' +
      '<label class="tr-f"><span>직책</span><input name="title"></label>' +
      '<label class="tr-f"><span>연락처 <b>*</b></span><input name="phone" type="tel" placeholder="010-0000-0000"></label>' +
      '<label class="tr-f wide"><span>이메일</span><input name="email" type="email" placeholder="name@company.com"></label>' +
      '<label class="tr-f wide"><span>조건·메모</span><textarea name="memo" rows="2" placeholder="예) 임대차 승계, PF 60% 확약서 첨부, 잔금 3개월 내"></textarea></label>' +
      '</div>' +
      '<div class="tr-actions"><button type="button" class="btn btn-ghost" data-vdr="close">취소</button></div>' +
      '<div class="tr-actions"><button type="button" class="btn btn-primary" data-vdr="bid-save">제출</button></div>';
    var m = modalShell('📝 LOI / 입찰 제출 — ' + room.name, body, true);
    m.querySelector('[data-vdr="bid-save"]').addEventListener('click', function () {
      var v = function (k) { var el = m.querySelector('[name="' + k + '"]'); return el ? el.value.trim() : ''; };
      if (!(num(v('price_eok')) > 0)) { toast('제시가를 입력하세요.', true); return; }
      if (!v('company')) { toast('회사명을 입력하세요.', true); return; }
      if (!v('bidder')) { toast('성명을 입력하세요.', true); return; }
      if (String(v('phone')).replace(/[^0-9]/g, '').length < 7) { toast('연락처를 정확히 입력하세요.', true); return; }
      var bid = {
        id: 'bid-' + Date.now().toString(36), room_id: room.id, room_name: room.name,
        kind: v('kind'), price_eok: v('price_eok'), funding: v('funding'), ltv_pct: v('ltv_pct'),
        accept: v('accept'), dd_days: v('dd_days'), close_months: v('close_months'), rate_pct: v('rate_pct'),
        company: v('company'), bidder: v('bidder'), title: v('title'), phone: v('phone'), email: v('email'),
        memo: v('memo'), status: '접수', timestamp: new Date().toISOString()
      };
      persistBid(bid).then(function (j) {
        if (!j || !j.ok) { toast('제출 실패: ' + ((j && j.error) || ''), true); return; }
        closeModal();
        S.tab = 'ai';
        mergeBidLocal(bid); render(); toast('LOI/입찰을 제출했습니다. AI 쇼트리스트에 반영되었습니다.');
        setTimeout(function () { loadRoomData(room.id, true).then(function () { mergeBidLocal(bid); render(); }); }, 1600);
      }).catch(function () { toast('제출 실패(네트워크)', true); });
    });
  }

  /** 검증용 샘플 후보 3건 — 화면에서 '샘플'로 표시되며 언제든 삭제 안내 */
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
      bid.status = '샘플'; bid.timestamp = new Date().toISOString(); bid._sample = true;
      bid.memo = '검증용 샘플 후보(실제 접수 아님)';
      return persistBid(bid);
    });
    Promise.all(jobs).then(function () {
      loadRoomData(room.id, true).then(function () { render(); toast('샘플 후보 3건을 넣었습니다. (검증 후 삭제 대상)'); });
    }).catch(function () { toast('샘플 입력 실패', true); });
  }

  /* ─────────────────────────── 이벤트 ─────────────────────────── */
  function bind() {
    var host = $('#vdrView');
    if (!host) return;
    host.onclick = function (e) {
      var rm = e.target.closest('[data-vdr-room]');
      if (rm) {
        S.roomId = rm.getAttribute('data-vdr-room');
        S.tab = 'docs';
        loadRoomData(S.roomId, false).then(function () { render(); });
        return;
      }
      var tb = e.target.closest('[data-vdr-tab]');
      if (tb) { S.tab = tb.getAttribute('data-vdr-tab'); render(); return; }
      var de = e.target.closest('[data-vdr-doc-edit]');
      if (de) { openDocEditor(de.getAttribute('data-vdr-doc-edit')); return; }
      var b = e.target.closest('[data-vdr]');
      if (!b) return;
      var act = b.getAttribute('data-vdr');
      if (act === 'room-new') openRoomEditor(null);
      else if (act === 'reload') { S.loaded = false; loadRooms(true).then(function () { return loadRoomData(S.roomId, true); }).then(render); }
      else if (act === 'bid-new') openBidForm();
      else if (act === 'bid-seed') seedBids();
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
        if (String(r.asset_name || '').indexOf(String(a ? a.name : '')) >= 0) hit = r;
        if (!hit && assetId && String(r.asset_id || '') === assetId) hit = r;
      });
      if (hit) S.roomId = hit.id;
      else if (isAdmin() && a) {
        openRoomEditor({ name: a.name + ' 매각 · VDR', asset_name: a.name + (a.address ? ' (' + a.address + ')' : ''), price_guide_eok: String(a.price_info || '').replace(/[^0-9.]/g, ''), stage: '자료 배포' });
        return;
      }
      if (window.naiShowView) window.naiShowView('vdr');
      S.loaded = true;
      loadRoomData(S.roomId, true).then(render);
    });
  }

  /* RFP(딜) → 그 물건의 VDR 룸을 열거나, 없으면 연결해 만듭니다. */
  function openForRfp(rfpId) {
    var C = window.NAI_RFPC;
    var rfp = C && C.rfpOf ? C.rfpOf(rfpId) : null;
    if (!rfp) return;
    if (isParty()) { S.roomId = 'rfp:' + rfpId; S.loaded = true; render(); return; }
    loadRooms(true).then(function (rooms) {
      var hit = rooms.filter(function (r) { return String(r.rfp_id) === String(rfpId); })[0];
      if (hit) { S.roomId = hit.id; S.tab = 'deal'; S.loaded = true; return loadRoomData(hit.id, true).then(render); }
      if (isAdmin()) {
        var obj = { id: 'vdr-' + Date.now().toString(36), name: rfp.title, asset_name: rfp.asset_name, asset_id: rfp.asset_id, rfp_id: rfpId, stage: '자료 배포', price_guide_eok: rfp.guide_eok || '' };
        return persistRoom(obj).then(function () {
          S.roomId = obj.id; S.tab = 'deal'; S.loaded = true; mergeRoomLocal(obj); render();
        }).catch(function () { render(); });
      }
      S.roomId = 'rfp:' + rfpId; S.tab = 'deal'; render();
    }).catch(function () { S.roomId = 'rfp:' + rfpId; S.tab = 'deal'; render(); });
  }

  window.NAI_VDR = { show: show, openForAsset: openForAsset, openForRfp: openForRfp, state: S, scoreBids: function () { return scoreBids(S.roomId); } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { /* show() 는 탭 진입 시 */ });
})();
