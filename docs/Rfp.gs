/* =====================================================================
   Rfp.gs — RFP·딜 룸·마켓 API (v2, 2026-11-28)
   ---------------------------------------------------------------------
   Hub.gs 의 doGet / doPost 에 아래 두 줄을 넣어 연결합니다.

     // doGet 안, type 분기 시작 부분
     if (type === 'rfp') return rfpGet_(token);

     // doPost 안, action 분기 시작 부분
     if (/^rfp_/.test(body.action)) return rfpPost_(body, token);

   ⚠️ 세션 훅: rfpAppSession_() 의 hubSession_/requireSession_ 을 실제 Hub.gs 함수명으로
      바꿔 주세요(앱 접속 토큰 → {role,name,company}).
   ===================================================================== */

var RFP_SS_ID = '15Uj21xebFdcnvlRK9dZYCFq7fsD70YCXmWepSzOtPX4';

/* 컬렉션 → 시트 탭 */
var RFP_TAB = {
  works: 'rfp_works', docs: 'rfp_docs', rfps: 'rfp', submissions: 'rfp_submissions',
  scores: 'rfp_scores', codes: 'rfp_codes', access: 'rfp_access', ca: 'rfp_ca',
  marketing: 'rfp_marketing', notices: 'rfp_notices', buyers: 'rfp_buyers', bidSubs: 'rfp_bid_subs',
  lenders: 'rfp_lenders', loiconf: 'rfp_loi_conf', advisors: 'rfp_advisors',
  /* 2026-11-28 파이프라인 */
  advisor_contacts: 'rfp_advisor_contacts', ca_deal: 'rfp_ca_deal', participants: 'rfp_participants',
  ca_parties: 'rfp_ca_parties', evaluations: 'rfp_evaluations', selection: 'rfp_selection',
  history: 'rfp_history', requests: 'rfp_requests', performance: 'rfp_performance',
  locations: 'rfp_locations', lists: 'rfp_lists', submits: 'rfp_submits',
  fin_offers: 'rfp_fin_offers', fin_requests: 'rfp_fin_requests', market_posts: 'rfp_market_posts',
  services: 'rfp_services', advisor_checks: 'rfp_advisor_checks'
};

/* 헤더: id·rfp_id 는 검색용, 원본은 json */
var RFP_HEAD = ['id', 'rfp_id', 'updated_at', 'json'];

function rfpSS_() { return SpreadsheetApp.openById(RFP_SS_ID); }

function rfpSetup() {
  var ss = rfpSS_();
  Object.keys(RFP_TAB).forEach(function (k) {
    var name = RFP_TAB[k];
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (!sh.getRange(1, 1).getValue()) {
      sh.getRange(1, 1, 1, RFP_HEAD.length).setValues([RFP_HEAD]);
      sh.setFrozenRows(1);
    }
  });
  var sess = ss.getSheetByName('rfp_sessions');
  if (!sess) sess = ss.insertSheet('rfp_sessions');
  if (!sess.getRange(1, 1).getValue()) {
    sess.getRange(1, 1, 1, 8).setValues([['token', 'code', 'holder', 'holder_type', 'holder_id', 'rfp_id', 'issued_at', 'expires_at']]);
    sess.setFrozenRows(1);
  }
  return 'ok';
}

/* ── 공통 ─────────────────────────────────────────────────────────── */
function rfpKey_(item) { return String(item.id || item.code || item.token || ''); }

function rfpRows_(key) {
  var sh = rfpSS_().getSheetByName(RFP_TAB[key]);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, RFP_HEAD.length).getValues();
  var out = [];
  vals.forEach(function (r) {
    var s = String(r[3] || '');
    if (!s) return;
    try { var o = JSON.parse(s); if (o && typeof o === 'object') out.push(o); } catch (e) { }
  });
  return out;
}

function rfpWrite_(key, item) {
  var sh = rfpSS_().getSheetByName(RFP_TAB[key]);
  if (!sh) throw new Error('missing_tab:' + RFP_TAB[key]);
  var id = rfpKey_(item);
  var row = [id, item.rfp_id || '', new Date(), JSON.stringify(item)];
  var last = sh.getLastRow();
  var ids = last < 2 ? [] : sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); });
  var at = ids.indexOf(String(id));
  if (at >= 0) sh.getRange(at + 2, 1, 1, RFP_HEAD.length).setValues([row]);
  else sh.appendRow(row);
}

function rfpDelete_(key, id) {
  var sh = rfpSS_().getSheetByName(RFP_TAB[key]);
  if (!sh || sh.getLastRow() < 2) return;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(id)) sh.deleteRow(i + 2);
}

/* ── 세션 ─────────────────────────────────────────────────────────── */
function rfpAppSession_(token) {
  if (typeof hubSession_ === 'function') return hubSession_(token);
  if (typeof requireSession_ === 'function') return requireSession_(token);
  return null;
}
function rfpCodeSession_(token) {
  var t = String(token || '');
  if (t.indexOf('RFPC:') !== 0) return null;
  var sh = rfpSS_().getSheetByName('rfp_sessions');
  if (!sh || sh.getLastRow() < 2) return null;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) !== t) continue;
    var exp = rows[i][7] ? new Date(rows[i][7]) : null;
    if (exp && exp.getTime() < Date.now()) return null;
    return { role: 'code', code: rows[i][1], holder: rows[i][2], holder_type: rows[i][3],
      holder_id: rows[i][4], rfp_id: rows[i][5], expires_at: rows[i][7] };
  }
  return null;
}
function rfpSession_(token) {
  var c = rfpCodeSession_(token);
  if (c) return c;
  var s = rfpAppSession_(token) || {};
  return { role: s.role || 'external', holder: s.name || '', company: s.company || '', holder_type: '', holder_id: '', rfp_id: '' };
}
function rfpIsStaff_(s) { return s.role === 'admin' || s.role === 'internal'; }

function rfpCodeLogin_(code) {
  var want = String(code || '').trim().toUpperCase();
  var hit = null;
  rfpRows_('codes').forEach(function (c) { if (String(c.code).toUpperCase() === want) hit = c; });
  if (!hit) return { ok: false, error: 'code_not_found' };
  if (String(hit.status || '') === '종료') return { ok: false, error: 'code_closed' };
  if (hit.expires_at) {
    var d = new Date(hit.expires_at);
    if (!isNaN(d.getTime()) && d.getTime() < new Date(new Date().toDateString()).getTime()) return { ok: false, error: 'code_expired' };
  }
  var token = 'RFPC:' + Utilities.getUuid();
  var sh = rfpSS_().getSheetByName('rfp_sessions');
  sh.appendRow([token, hit.code, hit.holder, hit.holder_type, hit.holder_id || '', hit.rfp_id || '', new Date(), hit.expires_at]);
  return { ok: true, token: token, holder: hit.holder, holder_type: hit.holder_type,
    holder_id: hit.holder_id || '', rfp_id: hit.rfp_id || '', expires_at: hit.expires_at };
}

/* ── 참여자·CA 판정(서버 판정 — 프런트와 같은 규칙) ───────────────── */
function rfpPartyOf_(s, participants) {
  if (!s || !s.rfp_id) return null;
  for (var i = 0; i < participants.length; i++) {
    var p = participants[i];
    if (String(p.rfp_id) !== String(s.rfp_id)) continue;
    if (s.holder_id && String(p.ref_id) === String(s.holder_id)) return p;
    if (String(p.company) === String(s.holder)) return p;
  }
  return null;
}
function rfpCaOpen_(s, participants, caList) {
  var p = rfpPartyOf_(s, participants);
  if (!p) return false;
  for (var i = 0; i < caList.length; i++) {
    var c = caList[i];
    if (String(c.rfp_id) === String(s.rfp_id) && String(c.participant_id) === String(p.id) && c.status === 'CA 접수') return true;
  }
  return false;
}
function rfpMaterialAcl_(doc) {
  var a = doc && doc.access;
  if (a === '기본 개방' || a === '요청 시 개방' || a === '비공개') return a;
  return ['im', 'rentroll', 'opex'].indexOf((doc || {}).kind) >= 0 ? '기본 개방' : '요청 시 개방';
}
function rfpApproved_(rfpId, participantId, docId, requests) {
  for (var i = 0; i < requests.length; i++) {
    var r = requests[i];
    if (String(r.rfp_id) === String(rfpId) && String(r.participant_id) === String(participantId) &&
      String(r.doc_id || '') === String(docId) && r.status === '승인') return true;
  }
  return false;
}
/* 자료 본문 제거 — 권한 없으면 목록·메타만 */
function rfpStripDoc_(d) {
  var o = {};
  Object.keys(d).forEach(function (k) {
    if (['dataUrl', 'text', 'rows', 'summary'].indexOf(k) >= 0) return;
    o[k] = d[k];
  });
  o.locked = true;
  return o;
}

/* ── 읽기 ─────────────────────────────────────────────────────────── */
function rfpGet_(token) {
  var s = rfpSession_(token);
  var all = {};
  Object.keys(RFP_TAB).forEach(function (k) { all[k] = rfpRows_(k); });

  if (rfpIsStaff_(s)) return { ok: true, data: all };
  if (!s.holder_type) return { ok: true, data: {} };

  var out = {};
  var rfpId = String(s.rfp_id || '');
  var mine = function (x) { return String(x.rfp_id || '') === rfpId; };
  out.participants = all.participants.filter(mine);
  var party = rfpPartyOf_(s, out.participants);
  var caOpen = rfpCaOpen_(s, out.participants, all.ca_parties);
  out.ca_parties = all.ca_parties.filter(function (c) { return mine(c) && party && String(c.participant_id) === String(party.id); });
  out.ca_deal = all.ca_deal.filter(mine);

  out.rfps = all.rfps.filter(function (r) {
    if (String(r.id) === rfpId) return true;
    if (s.holder_type === '자문사') return (r.invites || []).some(function (i) { return String(i.advisor_id) === String(s.holder_id); });
    return false;
  });
  var rfpIds = out.rfps.map(function (r) { return String(r.id); });
  var assetIds = out.rfps.map(function (r) { return String(r.asset_id); });

  out.docs = all.docs.filter(function (d) {
    if (assetIds.indexOf(String(d.asset_id)) < 0) return false;
    if (d.kind === 'ca') return true;                       /* CA 양식은 항상 내려줌 */
    var acl = rfpMaterialAcl_(d);
    if (acl === '비공개') return false;
    if (!caOpen) return false;                              /* 목록도 서버에는 남기되 본문 제거 */
    if (acl === '기본 개방') return true;
    return rfpApproved_(rfpId, party ? party.id : '', d.id, all.requests);
  });
  if (!caOpen) {
    /* CA 미제출 — 자료 이름·존재만, 내용은 절대 내려보내지 않음 */
    var metaDocs = all.docs.filter(function (d) { return assetIds.indexOf(String(d.asset_id)) >= 0; })
      .map(function (d) { return { id: d.id, asset_id: d.asset_id, kind: d.kind, label: d.label, name: d.name, size: d.size, at: d.at, month: d.month, locked: true }; });
    out.docs = metaDocs;
  } else {
    out.docs = out.docs.map(function (d) { return d; });
  }

  out.advisors = s.holder_type === '자문사' ? all.advisors.filter(function (a) { return String(a.id) === String(s.holder_id); }) : [];
  out.codes = all.codes.filter(function (c) { return String(c.code) === String(s.code); });
  out.access = all.access.filter(function (a) { return String(a.code) === String(s.code); });
  out.requests = all.requests.filter(function (r) { return mine(r) && party && String(r.participant_id) === String(party.id); });
  out.submits = all.submits.filter(function (x) { return mine(x) && party && String(x.participant_id) === String(party.id); });
  out.submissions = s.holder_type === '자문사' ? all.submissions.filter(function (x) {
    return rfpIds.indexOf(String(x.rfp_id)) >= 0 && String(x.advisor_id) === String(s.holder_id);
  }) : [];
  out.performance = s.holder_type === '자문사' ? all.performance.filter(function (p) {
    return rfpIds.indexOf(String(p.rfp_id)) >= 0 && String(p.advisor_id) === String(s.holder_id);
  }) : [];
  out.lists = [];            /* 굿/숏리스트는 운영자 전용 */
  out.evaluations = [];      /* 평가표·의견 비공개 */
  out.selection = [];        /* 선정 결과는 운영자 전용(참여자에게는 알림 문구로만) */
  out.history = all.history.filter(function (h) { return mine(h) && String(h.by) === String(s.holder); });
  out.advisor_checks = all.advisor_checks.filter(function (x) { return String(x.company) === String(s.holder); });
  out.fin_offers = all.fin_offers.filter(function (o) { return mine(o); });
  out.fin_requests = all.fin_requests.filter(function (o) { return mine(o) && String(o.company) === String(s.holder); });
  out.market_posts = all.market_posts.filter(function (p) { return mine(p) && String(p.company) === String(s.holder); });
  out.services = all.services.filter(function (x) { return mine(x) || String(x.vendor) === String(s.holder); });
  out.lenders = [];          /* 실체 진위 대장은 운영자 전용 */
  out.buyers = [];
  out.bidSubs = [];
  out.scores = [];
  out.ca = [];
  out.marketing = [];
  out.notices = [];
  out.works = []; /* 물건 작업대는 운영자 전용 */
  out.locations = [];
  return { ok: true, data: out };
}

/* ── 쓰기 ─────────────────────────────────────────────────────────── */
function rfpPost_(body, token) {
  var s = rfpSession_(token);
  var action = String(body.action || '');
  if (action === 'rfp_code_login') return rfpCodeLogin_(body.code);
  if (action === 'rfp_access_log') {
    var a = body.item || {};
    rfpWrite_('access', { id: 'acc-' + Utilities.getUuid(), at: new Date(), code: s.code || '', holder: s.holder || '',
      holder_type: s.holder_type || '', rfp_id: s.rfp_id || a.rfp_id || '', doc_id: a.doc_id || '', doc_label: a.doc_label || '', action: a.action || '열람' });
    return { ok: true };
  }
  var entity = String(body.entity || '');
  var item = body.item || {};
  if (!RFP_TAB[entity]) return { ok: false, error: 'unknown_entity' };
  var isStaff = rfpIsStaff_(s);
  if (!isStaff && !s.holder_type) return { ok: false, error: 'forbidden' };

  if (!isStaff) {
    var ps = rfpRows_('participants'), cas = rfpRows_('ca_parties');
    var party = rfpPartyOf_(s, ps);
    var ok = false;
    if (entity === 'ca_parties') {
      ok = !!party && String(item.participant_id) === String(party.id);
      if (!ok && !party) { item.rfp_id = s.rfp_id; }
    } else if (entity === 'submits' || entity === 'requests') {
      ok = !!party && (String(item.participant_id) === String(party.id) || !item.participant_id);
      if (ok && !item.participant_id) item.participant_id = party.id;
    } else if (entity === 'performance') {
      var selected = rfpRows_('rfps').some(function (r) { return String(r.id) === String(s.rfp_id) && String(r.selected_advisor_id) === String(s.holder_id); });
      ok = selected;
    } else if (entity === 'access') {
      ok = true;
    } else {
      ok = false;
    }
    if (!ok) return { ok: false, error: 'forbidden' };
    if (entity !== 'requests' && String(item.rfp_id || s.rfp_id) !== String(s.rfp_id) && entity !== 'ca_parties') return { ok: false, error: 'forbidden_rfp' };
  }

  /* LOC 「수용」은 금융기관 인증완료만 통과 (실체 진위확인 게이트) */
  if (entity === 'submits' && String(item.kind) === 'LOC' && String(item.status) === '수용') {
    var lenders = rfpRows_('lenders');
    var l = lenders.filter(function (x) { return String(x.name) === String(item.company); })[0];
    if (!l || String(l.status) !== '인증') return { ok: false, error: 'lender_not_verified' };
  }

  if (action === 'rfp_delete') { rfpDelete_(entity, item.id); return { ok: true }; }
  item.updated_at = new Date().toISOString();
  rfpWrite_(entity, item);
  if (entity === 'submissions') {
    var rfp = rfpRows_('rfps').filter(function (r) { return String(r.id) === String(item.rfp_id); })[0];
    if (rfp && ['초안', '배포'].indexOf(String(rfp.status)) >= 0) { rfp.status = '접수'; rfpWrite_('rfps', rfp); }
  }
  return { ok: true };
}
