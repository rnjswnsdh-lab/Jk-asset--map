# 📑 RFP 모듈 — Apps Script 서버 패치 명세 (2026-11-27)

> **상태: 미배포.** 이 작업 시점에 Apps Script(`Hub.gs` 계열)는 다른 작업이 동시에 수정 중이어서
> 서버를 건드리지 않았습니다. 프런트(`rfp.js`·`portal.js`·`rfpcore.js`)는 서버 API 가 없으면
> 자동으로 **로컬(localStorage) 모드**로 동작하고 화면에 `💾 로컬 저장` 배지를 표시합니다.
> 아래 코드를 붙여 넣고 배포하면 프런트가 자동으로 `☁ 서버 동기화` 로 전환됩니다(코드 수정 불필요).

---

## 0. 무엇이 오가는가 (프런트가 기대하는 규격)

| 요청 | 응답 |
| --- | --- |
| `GET  ?type=rfp&token=…` | `{ ok:true, data:{ works:[], docs:[], rfps:[], advisors:[], submissions:[], scores:[], codes:[], access:[], ca:[], marketing:[], notices:[], buyers:[], bidSubs:[], lenders:[], loiconf:[] } }` |
| `POST { action:'rfp_save', entity:'rfps', item:{…}, token }` | `{ ok:true }` |
| `POST { action:'rfp_delete', entity:'rfps', item:{ id }, token }` | `{ ok:true }` |
| `POST { action:'rfp_code_login', code:'ADV-XXXXXX', token }` | `{ ok:true, token:'RFPC:…', holder, holder_type, rfp_id, expires_at }` |

- `entity` 는 위 `data` 의 키 이름과 같습니다.
- 응답 `data` 는 **요청 토큰의 권한으로 걸러진 것**이어야 합니다(아래 3절). 프런트도 한 번 더 거르지만
  그건 보조 수단이며, 서버가 원본을 다 내려보내면 안 됩니다.
- `rfp_code_login` 이 돌려준 토큰을 프런트가 이후 모든 RFP 요청의 `token` 으로 씁니다
  (`rfpcore.js` 의 `API_TOKEN`). 코드 로그아웃 시 프런트가 토큰을 버립니다.

---

## 1. 시트 탭과 헤더

> **2026-11-27 현재: 아래 18개 탭과 헤더를 시트에 이미 만들어 두었습니다.**
> (`rfp_lender_checks` 는 **추가 제안**입니다 — 실체 진위확인 감사 로그용, 아직 시트에 없음)
> (`rfp`, `rfp_docs`, `rfp_items`, `rfp_invites`, `rfp_submissions`, `rfp_scores`, `rfp_codes`,
> `rfp_access`, `rfp_ca`, `rfp_marketing`, `rfp_notices`, `rfp_buyers`, `rfp_bid_subs`,
> `rfp_lenders`, `rfp_loi_conf`, `rfp_advisors`, `rfp_sessions`, `rfp_works`)
> 기존 탭(`assets`·`lois`·`investors`·`vdr_rooms`·`admin` 등)은 건드리지 않았습니다.
> 서버 코드가 배포되기 전이라 아직 비어 있고, 앱은 로컬 모드로 동작합니다.

`rfpSetup()` 은 다른 환경(복제 시트 등)에서 한 번 실행하면 아래 탭이 없을 때만 만듭니다(기존 데이터 보존).
각 행은 `json` 컬럼에 원본 객체를 JSON 으로 보관하고, 앞쪽 컬럼은 사람이 시트에서 보기·검색하기 위한 사본입니다.

| 탭 | 헤더 |
| --- | --- |
| `rfp` | `id, asset_id, asset_name, client, title, issue_date, due_date, status, guide_eok, selected_advisor_id, updated_at, json` |
| `rfp_docs` | `id, asset_id, kind, name, month, size, mime, at, updated_at, json` |
| `rfp_items` | `rfp_id, kind, key, label, weight, sort, json` — `kind` = `criteria`(평가 항목) / `docs`(요구 서류) |
| `rfp_invites` | `rfp_id, advisor_id, company, code, at, expires_at, viewed_at` |
| `rfp_submissions` | `id, rfp_id, advisor_id, advisor_company, version, status, fee_success, fee_fixed, price_expect, period_months, at, updated_at, json` |
| `rfp_scores` | `id, rfp_id, advisor_id, total, by, updated_at, json` |
| `rfp_codes` | `code, rfp_id, holder_type, holder, holder_id, scope, issued_at, expires_at, status, updated_at, json` |
| `rfp_access` | `at, code, holder, holder_type, rfp_id, doc_id, doc_label, action` |
| `rfp_ca` | `id, rfp_id, buyer, request_at, signed_at, status, scope, updated_at, json` |
| `rfp_marketing` | `id, rfp_id, pool, company, contact, email, tm_ver, sent_at, response, updated_at, json` |
| `rfp_notices` | `id, rfp_id, title, open_at, close_at, status, updated_at, json` |
| `rfp_buyers` | `id, name, corp_no, ceo, contact, email, phone, status, verified_at, updated_at, json` |
| `rfp_bid_subs` | `id, notice_id, rfp_id, buyer_id, kind, version, status, amount_eok, at, updated_at, json` |
| `rfp_lenders` | `id, name, dept, manager, email, phone, status, verified_at, updated_at, json` — `json` 에 실체 진위확인(`vf` 3단계·`history`·`declared`·`next_review_at`)이 들어갑니다. 사람이 보기용 확장 열 제안: `biz_no, ceo, opened_at, org_tel, verified_by, next_review_at, step1_result, step2_tax, step3_domain, reject_reason` |
| `rfp_lender_checks` *(제안)* | `id, lender_id, lender_name, step, result, by, at, source_url, evidence, memo, json` — 실체 진위확인 감사 로그(append-only). 여러 기기 동시 작업 시 `json.history` 덮어쓰기를 막습니다 |
| `rfp_loi_conf` | `id, sub_id, rfp_id, lender_id, result, amount_eok, ltv, at, json` |
| `rfp_works` | `id, asset_id, name, address, sector, at` |
| `rfp_sessions` | `token, code, holder, holder_type, rfp_id, issued_at, expires_at` (코드 로그인 세션) |

> 파일 원본(`dataUrl`/`text`)은 `rfp_docs.json` 안에 들어갑니다. 900KB 초과 파일은 프런트가
> 이름·메타만 보관하므로 시트 셀 한도(50,000자) 문제가 생기면 **Drive 업로드 후 `drive_url` 로
> 바꾸는 것을 권장**합니다(아래 5절 참고).

---

## 2. 새 파일 `Rfp.gs`

```javascript
/* =====================================================================
   Rfp.gs — RFP 발주·자문사 포털 API (2026-11-27)
   Hub.gs 의 doGet/doPost 에서 아래 두 줄을 추가해 연결합니다.

     // doGet  안, type 분기 시작 부분
     if (type === 'rfp') return rfpGet_(token);

     // doPost 안, action 분기 시작 부분
     if (/^rfp_/.test(body.action)) return rfpPost_(body, token);
   ===================================================================== */

var RFP_SHEETS = {
  works:       ['id','asset_id','name','address','sector','at'],
  docs:        ['id','asset_id','kind','name','month','size','mime','at','updated_at','json'],
  rfps:        ['id','asset_id','asset_name','client','title','issue_date','due_date','status','guide_eok','selected_advisor_id','updated_at','json'],
  items:       ['rfp_id','kind','key','label','weight','sort','json'],
  invites:     ['rfp_id','advisor_id','company','code','at','expires_at','viewed_at'],
  submissions: ['id','rfp_id','advisor_id','advisor_company','version','status','fee_success','fee_fixed','price_expect','period_months','at','updated_at','json'],
  scores:      ['id','rfp_id','advisor_id','total','by','updated_at','json'],
  codes:       ['code','rfp_id','holder_type','holder','holder_id','scope','issued_at','expires_at','status','updated_at','json'],
  access:      ['at','code','holder','holder_type','rfp_id','doc_id','doc_label','action'],
  ca:          ['id','rfp_id','buyer','request_at','signed_at','status','scope','updated_at','json'],
  marketing:   ['id','rfp_id','pool','company','contact','email','tm_ver','sent_at','response','updated_at','json'],
  notices:     ['id','rfp_id','title','open_at','close_at','status','updated_at','json'],
  buyers:      ['id','name','corp_no','ceo','contact','email','phone','status','verified_at','updated_at','json'],
  bidSubs:     ['id','notice_id','rfp_id','buyer_id','kind','version','status','amount_eok','at','updated_at','json'],
  lenders:     ['id','name','dept','manager','email','phone','status','verified_at','updated_at','json','biz_no','ceo','opened_at','org_tel','verified_by','next_review_at','step1_result','step2_tax','step3_domain','reject_reason'],
  lenderChecks:['id','lender_id','lender_name','step','result','by','at','source_url','evidence','memo','json'],
  loiconf:     ['id','sub_id','rfp_id','lender_id','result','amount_eok','ltv','at','json'],
  advisors:    ['id','company','name','email','phone','at','updated_at','json']
};

var RFP_TAB_NAME = {
  works:'rfp_works', docs:'rfp_docs', rfps:'rfp', items:'rfp_items', invites:'rfp_invites',
  submissions:'rfp_submissions', scores:'rfp_scores', codes:'rfp_codes', access:'rfp_access',
  ca:'rfp_ca', marketing:'rfp_marketing', notices:'rfp_notices', buyers:'rfp_buyers',
  bidSubs:'rfp_bid_subs', lenders:'rfp_lenders', loiconf:'rfp_loi_conf', advisors:'rfp_advisors',
  lenderChecks:'rfp_lender_checks'
};

function rfpSetup() {
  var ss = SpreadsheetApp.openById('15Uj21xebFdcnvlRK9dZYCFq7fsD70YCXmWepSzOtPX4');
  Object.keys(RFP_SHEETS).forEach(function (k) {
    var name = RFP_TAB_NAME[k];
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var head = RFP_SHEETS[k];
    var cur = sh.getRange(1, 1, 1, head.length).getValues()[0];
    if (!cur[0]) {
      sh.getRange(1, 1, 1, head.length).setValues([head]);
      sh.setFrozenRows(1);
    }
  });
  var sess = ss.getSheetByName('rfp_sessions');
  if (!sess) sess = ss.insertSheet('rfp_sessions');
  if (!sess.getRange(1, 1).getValue()) {
    sess.getRange(1, 1, 1, 7).setValues([['token','code','holder','holder_type','rfp_id','issued_at','expires_at']]);
    sess.setFrozenRows(1);
  }
  return 'ok';
}

/* ── 공통 ─────────────────────────────────────────────────────────── */
function rfpSS_() { return SpreadsheetApp.openById('15Uj21xebFdcnvlRK9dZYCFq7fsD70YCXmWepSzOtPX4'); }

function rfpRows_(key) {
  var sh = rfpSS_().getSheetByName(RFP_TAB_NAME[key]);
  if (!sh) return [];
  var head = RFP_SHEETS[key];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  return vals.map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    if (o.json) { try { var j = JSON.parse(o.json); if (j && typeof j === 'object') return j; } catch (e) {} }
    return o;
  }).filter(function (o) { return o && o.id; });
}

function rfpWrite_(key, item) {
  var sh = rfpSS_().getSheetByName(RFP_TAB_NAME[key]);
  if (!sh) throw new Error('missing_tab:' + RFP_TAB_NAME[key]);
  var head = RFP_SHEETS[key];
  var row = head.map(function (h) {
    if (h === 'json') return JSON.stringify(item);
    if (h === 'scope') return [].concat(item.scope || []).join(',');
    return item[h] === undefined || item[h] === null ? '' : item[h];
  });
  var id = item.id || item.code || item.token;
  var last = sh.getLastRow();
  var ids = last < 2 ? [] : sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); });
  var at = ids.indexOf(String(id));
  if (at >= 0) sh.getRange(at + 2, 1, 1, head.length).setValues([row]);
  else sh.appendRow(row);
}

function rfpDelete_(key, id) {
  var sh = rfpSS_().getSheetByName(RFP_TAB_NAME[key]);
  if (!sh) return;
  var last = sh.getLastRow();
  if (last < 2) return;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(id)) sh.deleteRow(i + 2);
}

/* ── 세션 ─────────────────────────────────────────────────────────── */
/* ⚠️ 기존 Hub.gs 의 앱 세션 검증 함수명으로 바꿔 주세요.
   예: var s = hubSession_(token);  →  s = { role:'admin'|'internal'|'logi'|'external', name, company } */
function rfpAppSession_(token) {
  if (typeof hubSession_ === 'function') return hubSession_(token);
  if (typeof requireSession_ === 'function') return requireSession_(token);
  throw new Error('rfp_session_hook_missing'); // Hub.gs 함수명에 맞춰 위 두 줄을 수정
}

function rfpCodeSession_(token) {
  var t = String(token || '');
  if (t.indexOf('RFPC:') !== 0) return null;
  var sh = rfpSS_().getSheetByName('rfp_sessions');
  if (!sh || sh.getLastRow() < 2) return null;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === t) {
      var exp = rows[i][6] ? new Date(rows[i][6]) : null;
      if (exp && exp.getTime() < Date.now()) return null;
      return { role: 'code', code: rows[i][1], holder: rows[i][2], holder_type: rows[i][3], rfp_id: rows[i][4], expires_at: rows[i][6] };
    }
  }
  return null;
}

function rfpSession_(token) {
  var c = rfpCodeSession_(token);
  if (c) return c;
  var s = rfpAppSession_(token) || {};
  return { role: s.role || 'external', holder: s.name || '', holder_type: '', rfp_id: '' };
}

function rfpCodeLogin_(code) {
  var want = String(code || '').trim().toUpperCase();
  var codes = rfpRows_('codes');
  var hit = null;
  codes.forEach(function (c) { if (String(c.code).toUpperCase() === want) hit = c; });
  if (!hit) return { ok: false, error: 'code_not_found' };
  if (String(hit.status || '') === '종료') return { ok: false, error: 'code_closed' };
  if (hit.expires_at) {
    var d = new Date(hit.expires_at);
    if (!isNaN(d.getTime()) && d.getTime() < new Date(new Date().toDateString()).getTime()) return { ok: false, error: 'code_expired' };
  }
  var token = 'RFPC:' + Utilities.getUuid();
  rfpWrite_('sessions', { token: token, code: hit.code, holder: hit.holder, holder_type: hit.holder_type,
    rfp_id: hit.rfp_id, issued_at: new Date(), expires_at: hit.expires_at });
  return { ok: true, token: token, holder: hit.holder, holder_type: hit.holder_type, rfp_id: hit.rfp_id, expires_at: hit.expires_at };
}

/* ── 읽기 ─────────────────────────────────────────────────────────── */
function rfpGet_(token) {
  var s = rfpSession_(token);
  var keys = ['works','docs','rfps','advisors','submissions','scores','codes','access','ca','marketing','notices','buyers','bidSubs','lenders','loiconf'];
  var all = {};
  keys.forEach(function (k) { all[k] = rfpRows_(k); });

  var out = {};
  if (s.role === 'admin' || s.role === 'internal') return { ok: true, data: all };

  /* 코드 세션 — 대상 구분별 가시 범위 */
  var myRfp = String(s.rfp_id || '');
  var inRfp = function (x) { return String(x.rfp_id || '') === myRfp; };
  var codeRec = null;
  all.codes.forEach(function (c) { if (String(c.code) === String(s.code)) codeRec = c; });
  var scope = (codeRec && codeRec.scope) || [];

  out.works = all.works.filter(function (w) { return true; });
  out.rfps = all.rfps.filter(function (r) {
    if (String(r.id) === myRfp) return true;
    if (s.holder_type !== '자문사') return false;
    return (r.invites || []).some(function (i) { return String(i.advisor_id) === String(codeRec && codeRec.holder_id); });
  });
  var rfpIds = out.rfps.map(function (r) { return String(r.id); });
  out.docs = all.docs.filter(function (d) {
    if (scope.length && scope.indexOf(d.kind) < 0) return false;
    return out.rfps.some(function (r) { return String(r.asset_id) === String(d.asset_id); });
  });
  out.advisors = (s.holder_type === '자문사') ? all.advisors.filter(function (a) { return String(a.id) === String(codeRec && codeRec.holder_id); }) : [];
  if (s.holder_type === '자문사') {
    out.submissions = all.submissions.filter(function (x) { return rfpIds.indexOf(String(x.rfp_id)) >= 0 && String(x.advisor_id) === String(codeRec && codeRec.holder_id); });
    out.ca = all.ca.filter(inRfp);
    out.marketing = all.marketing.filter(inRfp);
    out.notices = all.notices.filter(inRfp);
    out.buyers = all.buyers;                       // CA·입찰 상대 확인용
    out.bidSubs = all.bidSubs.filter(inRfp);
    out.lenders = all.lenders;
    out.loiconf = all.loiconf.filter(inRfp);
    out.codes = all.codes.filter(function (c) { return String(c.code) === String(s.code); });
    out.access = all.access.filter(function (a) { return String(a.code) === String(s.code); });
  } else if (s.holder_type === '매수자') {
    var myBuyer = all.buyers.filter(function (b) { return String(b.name) === String(s.holder); })[0];
    out.submissions = []; out.scores = []; out.marketing = []; out.ca = [];
    out.buyers = myBuyer ? [myBuyer] : [];
    out.bidSubs = all.bidSubs.filter(function (x) { return myBuyer && String(x.buyer_id) === String(myBuyer.id); });
    out.notices = all.notices.filter(inRfp);
    out.lenders = []; out.loiconf = [];
    out.codes = []; out.access = all.access.filter(function (a) { return String(a.code) === String(s.code); });
  } else if (s.holder_type === '금융기관') {
    var myLender = all.lenders.filter(function (l) { return String(l.name) === String(s.holder); })[0];
    out.submissions = []; out.scores = []; out.marketing = []; out.ca = []; out.buyers = [];
    out.bidSubs = all.bidSubs.filter(function (x) { return String(x.kind) === 'LOI' || String(x.kind) === 'LOC'; });
    out.lenders = myLender ? [myLender] : [];
    out.loiconf = all.loiconf.filter(function (c) { return myLender && String(c.lender_id) === String(myLender.id); });
    out.notices = all.notices.filter(inRfp);
    out.codes = []; out.access = all.access.filter(function (a) { return String(a.code) === String(s.code); });
  } else {
    return { ok: false, error: 'forbidden' };
  }
  out.scores = s.holder_type === '자문사' ? [] : out.scores;  /* 타 자문사 점수는 절대 비공개 */
  return { ok: true, data: out };
}

/* ── 쓰기 ─────────────────────────────────────────────────────────── */
function rfpPost_(body, token) {
  var s = rfpSession_(token);
  var action = String(body.action || '');
  if (action === 'rfp_code_login') return rfpCodeLogin_(body.code);
  if (action === 'rfp_access_log') {
    var a = body.item || {};
    rfpWrite_('access', { at: new Date(), code: s.code || '', holder: s.holder || '', holder_type: s.holder_type || '',
      rfp_id: s.rfp_id || a.rfp_id || '', doc_id: a.doc_id || '', doc_label: a.doc_label || '', action: a.action || '열람' });
    return { ok: true };
  }
  var entity = String(body.entity || '');
  var item = body.item || {};
  if (!RFP_SHEETS[entity]) return { ok: false, error: 'unknown_entity' };

  var isStaff = (s.role === 'admin' || s.role === 'internal');
  if (!isStaff) {
    /* 코드 세션의 쓰기 범위 */
    if (s.holder_type === '자문사') {
      var okAdv = (entity === 'submissions' && String(item.advisor_id) === String(s.code) ) ||
        (entity === 'submissions') ||
        ['ca','marketing','notices','bidSubs','access'].indexOf(entity) >= 0;
      if (entity === 'submissions' && String(s.rfp_id) !== String(item.rfp_id)) okAdv = false;
      if (['rfps','codes','buyers','lenders','loiconf','works','docs','advisors','scores'].indexOf(entity) >= 0) okAdv = false;
      if (!okAdv) return { ok: false, error: 'forbidden' };
    } else if (s.holder_type === '매수자') {
      if (entity !== 'bidSubs') return { ok: false, error: 'forbidden' };
      var myB = rfpRows_('buyers').filter(function (b) { return String(b.name) === String(s.holder); })[0];
      if (!myB || String(item.buyer_id) !== String(myB.id)) return { ok: false, error: 'forbidden' };
    } else if (s.holder_type === '금융기관') {
      if (entity !== 'loiconf') return { ok: false, error: 'forbidden' };
      var myL = rfpRows_('lenders').filter(function (l) { return String(l.name) === String(s.holder); })[0];
      if (!myL || String(item.lender_id) !== String(myL.id)) return { ok: false, error: 'forbidden' };
    } else {
      return { ok: false, error: 'forbidden' };
    }
  }

  if (action === 'rfp_delete') { rfpDelete_(entity, item.id); return { ok: true }; }
  rfpWrite_(entity, item);
  /* 제안 제출 시 RFP 상태 전환 */
  if (entity === 'submissions') {
    var rfp = rfpRows_('rfps').filter(function (r) { return String(r.id) === String(item.rfp_id); })[0];
    if (rfp && ['작성','배포'].indexOf(String(rfp.status)) >= 0) { rfp.status = '제안 접수'; rfpWrite_('rfps', rfp); }
  }
  return { ok: true };
}
```

---

## 3. 서버가 반드시 지켜야 하는 권한 규칙

1. **자문사끼리 제안서 비공개** — `rfp_submissions` 는 요청 코드의 `holder_id` 와 같은 행만 내려보냅니다.
   `rfp_scores`(평가 점수·순위)는 자문사·매수자·금융기관에게 **아예 내려보내지 않습니다**.
2. **매수자** — CA(`rfp_ca`)에 적힌 `scope` 밖의 자료는 `rfp_docs` 에서 제외, 다른 매수자의
   `rfp_bid_subs`·연락처는 제외.
3. **금융기관** — 자기 `lender_id` 의 `rfp_loi_conf` 만. LOI/LOC 검증 기록은 `rfp_loi_conf` +
   `rfp_bid_subs.verify*` 로 남기고, 누가(기관·담당)·언제 를 서버가 채웁니다.
4. **코드 만료** — `expires_at` 이 지난 코드는 `rfp_code_login` 과 `rfpGet_` 에서 모두 거부.
5. **파일** — `docs.json` 에는 `dataUrl`/`text` 가 들어 있습니다. 시트 셀 50,000자 한도를 넘는
   파일은 Drive 에 올리고 `drive_url` 로 대체하세요(프런트는 `dataUrl` 이 없으면 `text` 로
   CSV 를 재생성합니다).

---

## 4. 배포 순서

1. 편집기에서 `Rfp.gs` 새 파일 추가 → 위 코드 붙여넣기.
2. `rfpAppSession_()` 의 `hubSession_`/`requireSession_` 을 **실제 Hub.gs 세션 함수명**으로 교체.
3. `Hub.gs` 의 `doGet`/`doPost` 에 2절 첫머리의 두 줄 추가.
4. 편집기에서 `rfpSetup()` 실행 → 탭 17개 + `rfp_sessions` 생성 확인.
5. 웹앱 **새 버전으로 배포**(기존 배포 URL 유지).
6. 앱에서 `📑 RFP` → 새로고침(`↻`) → 배지가 `☁ 서버 동기화` 로 바뀌는지 확인.
7. 확인 항목:
   - 자문사 코드로 로그인했을 때 `GET ?type=rfp` 응답에 **다른 자문사의 submissions 가 없는지**.
   - 매수자 코드에서 `rfp_docs` 가 CA scope 대로만 오는지.
   - 금융기관 코드에서 `loiconf` 가 자기 것만 오는지.

---

## 5. 남은 결정(사용자)

- 자문사·매수자·금융기관 **계정 체계**: 지금은 승인 코드(무계정) 방식입니다. 기업별 상시 계정이
  필요하면 코드 → 계정 매핑 테이블과 로그인 화면이 추가로 필요합니다.
- **파일 저장 위치**: 시트 셀 vs Google Drive. VDR 급 자료(렌트롤 원본·IM)는 Drive 가 맞습니다.
- **금융기관 인증 방식**: 2026-11-27부터 **실체 진위확인 3단계**(제도권 여부·사업자등록/법인등기·담당자 콜백)로
  바뀌었습니다. 절차·데이터·연동 지점은 `docs/금융기관_실체진위확인_설계.md` 참고.
  남은 결정: (1) 국세청·금융위 API 자동 호출 도입 여부(키는 스크립트 속성에), (2) 등기부 원본의
  Drive 보관·권한, (3) 재확인 주기(현재 12개월)와 경고 시점(현재 60일).
- **RFP 표준 양식 확정**: 지금 기본값은 기획 문서의 항목(수수료·매각가·기간·실적·접근력·인력·일정·
  추가 서비스)입니다. NAI Korea 표준 배포 문구가 있으면 `rfpcore.js` 의 `DEFAULT_DOCS`·
  `newRfp()` 문구만 바꾸면 됩니다.
