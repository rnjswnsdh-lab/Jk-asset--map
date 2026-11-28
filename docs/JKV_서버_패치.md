# 🔐 JK Value CA · 블라인드 · VDR · LOI — Apps Script 서버 패치 명세 (2026-11-28)

> **상태: 미배포(프런트 선배포).** 이 작업에서는 Apps Script(`Hub.gs` 계열)를 직접 수정하지 않았습니다.
> 프런트(`vdr.js`)는 서버 API가 없으면 자동으로 **로컬(localStorage) 모드**로 동작하고, CA·열람 로그·자료 요청은
> 브라우저에 보관한 뒤 화면에 그대로 표시합니다. 아래 코드를 붙여 넣고 배포하면 프런트 수정 없이
> **전 기기 공유(CA 접수 → JK Value 승인 → 투자자 열람)** 로 전환됩니다.

---

## 0. 무엇이 오가는가 (프런트가 기대하는 규격)

| 요청 | 응답 |
| --- | --- |
| `GET ?type=vdr_cas&room=<room_id>&token=…` | `{ ok:true, items:[ {CA…}, … ] }` — **권한별 필터 필수**(아래 3절) |
| `POST { action:'vdr_ca_submit', ca:{…}, token }` | `{ ok:true }` |
| `POST { action:'vdr_ca_status', ca_id, status, approved_at, decided_by, reason, token }` | `{ ok:true }` |
| `POST { action:'jkv_log', log:{…}, token }` | `{ ok:true }` (append-only) |
| `POST { action:'jkv_req_save', req:{…}, token }` | `{ ok:true }` |
| `GET ?type=jkv_req&room=<room_id>&token=…` *(선택)* | `{ ok:true, items:[…] }` |

- 프런트는 `vdr_cas` 조회가 실패해도 화면이 깨지지 않고, CA 제출은 **서버 저장 실패 시 로컬로 남긴 뒤** `{ok:true}`로 처리합니다. 따라서 서버가 늦게 붙어도 데이터가 유실되지 않습니다(중복은 `id` 기준 병합).
- CA 객체 필드

```
id, room_id, room_name, asset_name, company, name, title, phone, email, party,
scopes[], status(심사중|승인|반려), submitted_at, approved_at, reason,
signature, signature_hash, ua, by
```

- 로그 객체 필드 : `id, room_id, company, name, email, action, detail, at, role`
- 요청 객체 필드 : `id, room_id, kind, company, name, email, memo, status, at`

---

## 1. 시트 탭과 헤더

`jkvSetup()` 을 편집기에서 한 번 실행하면 없는 탭만 만듭니다(기존 데이터 보존).

| 탭 | 헤더 |
| --- | --- |
| `vdr_cas` | `id, room_id, company, name, email, phone, status, submitted_at, approved_at, approved_by, json` |
| `jkv_logs` | `id, room_id, company, name, email, action, detail, at, role, json` |
| `jkv_req` | `id, room_id, kind, company, name, email, memo, status, at, json` |
| `vdr_bids` *(확장 권장)* | 기존 헤더 + `equity_eok, debt_eok, rate_pct, valid_until, fee_bearer, conditions, ca_id` — LOI 상세 필드가 시트에 없으면 저장 후 새로고침 시 사라집니다(로컬 모드에서는 유지) |
| `vdr_rooms` *(확장 권장)* | 기존 헤더 + `asset_id, sector, sub_market, gfa_pyeong, site_pyeong, occupancy_pct, built_year, wale_years, tenant_profile, deal_type, timeline, ltv_band, special_note, advisor, tm_url, im_url` |

> **블라인드 표기 메타**는 현재 브라우저(`localStorage` `{prefix}:jkv:rooms:v1`)에도 함께 보존됩니다. 위 컬럼을 시트에 추가하기 전까지 새로고침 후에도 브라우저 단위로 유지되며, 컬럼 추가 후에는 서버값이 우선합니다.
> CA·로그·요청은 서버 실패 시에도 로컬에 남기고 화면에 `로컬 모드`로 표시합니다.

- `vdr_cas.status` 는 사람이 시트에서 바로 고칠 수 있게 앞 컬럼에도 둡니다. 단, 프런트의 승인 버튼은
  `vdr_ca_status` 액션을 호출하므로 가능하면 화면에서 처리하세요(감사 로그가 함께 남습니다).
- `jkv_logs` 는 **append-only** 로만 씁니다(수정·삭제 금지). CA 분쟁 시 열람 이력의 근거가 됩니다.

---

## 2. 새 파일 `Jkv.gs`

```javascript
/* =====================================================================
   Jkv.gs — JK Value CA · 열람 로그 · 자료 요청 API (2026-11-28)
   Hub.gs 의 doGet/doPost 에서 아래 두 줄을 추가해 연결합니다.

     // doGet  안, type 분기 시작 부분
     if (type === 'vdr_cas')  return jkvGetCas_(token, e.parameter.room);
     if (type === 'jkv_req')  return jkvGetReq_(token, e.parameter.room);

     // doPost 안, action 분기 시작 부분
     if (/^(vdr_ca_|jkv_)/.test(body.action)) return jkvPost_(body, token);
   ===================================================================== */

var JKV_SHEET = {
  cas:  { name: 'vdr_cas',  head: ['id','room_id','company','name','email','phone','status','submitted_at','approved_at','approved_by','json'] },
  logs: { name: 'jkv_logs', head: ['id','room_id','company','name','email','action','detail','at','role','json'] },
  req:  { name: 'jkv_req',  head: ['id','room_id','kind','company','name','email','memo','status','at','json'] }
};

function jkvSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(JKV_SHEET).forEach(function (k) {
    var def = JKV_SHEET[k];
    var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
    if (sh.getLastRow() === 0) sh.appendRow(def.head);
  });
}

function jkvSheet_(key) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var def = JKV_SHEET[key];
  var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
  if (sh.getLastRow() === 0) sh.appendRow(def.head);
  return sh;
}

/* 시트 → 객체 배열 */
function jkvRead_(key) {
  var sh = jkvSheet_(key);
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  var head = v[0], out = [];
  for (var r = 1; r < v.length; r++) {
    var o = {};
    head.forEach(function (h, i) { o[h] = v[r][i]; });
    try { if (o.json) o = JSON.parse(o.json); } catch (e) {}
    out.push(o);
  }
  return out;
}

/* 객체 → 행 upsert (id 기준) */
function jkvUpsert_(key, obj) {
  var sh = jkvSheet_(key), def = JKV_SHEET[key];
  var v = sh.getDataRange().getValues();
  var head = v[0], idCol = head.indexOf('id');
  var row = def.head.map(function (h) { return h === 'json' ? JSON.stringify(obj) : (obj[h] === undefined ? '' : obj[h]); });
  for (var r = 1; r < v.length; r++) {
    if (String(v[r][idCol]) === String(obj.id)) { sh.getRange(r + 1, 1, 1, row.length).setValues([row]); return; }
  }
  sh.appendRow(row);
}

function jkvAppend_(key, obj) {
  var sh = jkvSheet_(key), head = JKV_SHEET[key].head;
  sh.appendRow(head.map(function (h) { return h === 'json' ? JSON.stringify(obj) : (obj[h] === undefined ? '' : obj[h]); }));
}

/* ── 권한 : 운영자(관리자·내부 CM)는 전체, 외부는 본인 것만 ── */
function jkvWho_(token) {
  /* Hub.gs 의 기존 세션 판별 함수로 교체하세요.
     예) var s = hubSession_(token);  return { role: s.role, name: s.name, company: s.company, email: s.email }; */
  var s = (typeof hubSession_ === 'function') ? hubSession_(token) : { role: 'external' };
  return { role: s.role || 'external', name: s.name || '', company: s.company || '', email: s.email || '' };
}
function jkvIsOperator_(who) { return who.role === 'admin' || who.role === 'internal'; }
function jkvMine_(who, row) {
  var e1 = String(row.email || '').toLowerCase(), e2 = String(who.email || '').toLowerCase();
  if (e1 && e2 && e1 === e2) return true;
  return !!(row.company && who.company && row.company === who.company && row.name === who.name);
}

function jkvGetCas_(token, room) {
  var who = jkvWho_(token);
  var rows = jkvRead_('cas').filter(function (c) { return !room || String(c.room_id) === String(room); });
  if (!jkvIsOperator_(who)) rows = rows.filter(function (c) { return jkvMine_(who, c); });
  return ContentService.createTextOutput(JSON.stringify({ ok: true, items: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jkvGetReq_(token, room) {
  var who = jkvWho_(token);
  var rows = jkvRead_('req').filter(function (r) { return !room || String(r.room_id) === String(room); });
  if (!jkvIsOperator_(who)) rows = rows.filter(function (r) { return jkvMine_(who, r); });
  return ContentService.createTextOutput(JSON.stringify({ ok: true, items: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jkvPost_(body, token) {
  var who = jkvWho_(token);
  var a = body.action;

  if (a === 'vdr_ca_submit') {
    var ca = body.ca || {};
    if (!ca.id || !ca.room_id || !ca.company || !ca.email) return jkvErr_('invalid_ca');
    if (!jkvIsOperator_(who) && !jkvMine_(who, ca)) return jkvErr_('forbidden');
    var old = null;
    jkvRead_('cas').forEach(function (c) { if (c.id === ca.id) old = c; });
    /* 서명 후 수정 금지 — 기존 CA 가 승인·심사중이면 덮어쓰지 않습니다 */
    if (old && (old.status === '승인' || old.status === '심사중')) return jkvErr_('already_submitted');
    ca.status = ca.status || '심사중';
    jkvUpsert_('cas', ca);
    jkvAppend_('logs', { id: 'log-' + Date.now(), room_id: ca.room_id, company: ca.company, name: ca.name,
      email: ca.email, action: 'CA 제출', detail: ca.id, at: new Date().toISOString(), role: who.role });
    return jkvOk_();
  }

  if (a === 'vdr_ca_status') {
    if (!jkvIsOperator_(who)) return jkvErr_('forbidden');
    var hit = null;
    jkvRead_('cas').forEach(function (c) { if (c.id === body.ca_id) hit = c; });
    if (!hit) return jkvErr_('not_found');
    hit.status = body.status === '승인' ? '승인' : '반려';
    hit.approved_at = body.approved_at || '';
    hit.approved_by = body.decided_by || who.name || 'JK Value';
    if (body.reason) hit.reason = body.reason;
    jkvUpsert_('cas', hit);
    jkvAppend_('logs', { id: 'log-' + Date.now(), room_id: hit.room_id, company: hit.company, name: hit.name,
      email: hit.email, action: 'CA ' + hit.status, detail: hit.id, at: new Date().toISOString(), role: who.role });
    return jkvOk_();
  }

  if (a === 'jkv_log') {
    var lg = body.log || {};
    if (!lg.room_id) return jkvErr_('invalid_log');
    lg.company = lg.company || who.company;
    lg.email = lg.email || who.email;
    jkvAppend_('logs', lg);
    return jkvOk_();
  }

  if (a === 'jkv_req_save') {
    var rq = body.req || {};
    if (!rq.id || !rq.room_id) return jkvErr_('invalid_req');
    rq.company = rq.company || who.company;
    rq.email = rq.email || who.email;
    jkvUpsert_('req', rq);
    return jkvOk_();
  }

  return jkvErr_('unknown_action');
}

function jkvOk_() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}
function jkvErr_(code) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: code })).setMimeType(ContentService.MimeType.JSON);
}
```

---

## 3. 권한·보안 원칙 (서버에서 반드시 지킬 것)

1. **CA 원본은 운영자만 전체 조회.** 외부 토큰에는 `jkvMine_` 로 걸러진 본인 CA만 내려보냅니다. 프런트는 화면만 가리고, 차단은 서버가 해야 합니다.
2. **승인·반려는 운영자 토큰만.** `vdr_ca_status` 는 `admin`·`internal` 외 거부합니다.
3. **승인 전 상세자료 API 차단.** `vdr_docs` 조회도 같은 규칙을 적용해, CA 승인 전 외부 토큰에는 `kind`가 `RFP` 인 행만(또는 빈 배열) 내려보내는 것을 권장합니다. 화면 잠금은 보조 수단입니다.
4. **로그 append-only.** `jkv_logs` 행은 수정·삭제하지 않습니다. 워터마크 문자열(회사·이름·시각)은 로그의 `company·name·at` 과 대조해 위조 여부를 확인합니다.
5. **서명 무결성.** `signature_hash` 는 프런트가 `성명|이메일|room_id|제출시각` 으로 만든 16자리 해시입니다. 계약 효력의 근거는 전자서명(성명 입력·동의 체크·시각·UA) 기록이며, 분쟁 시 이 해시와 로그로 제출 사실을 입증합니다.

---

## 4. 배포 순서

1. Apps Script 편집기에서 `Jkv.gs` 추가 → `Hub.gs` 의 `doGet`·`doPost` 에 2절의 두 줄 삽입.
2. 편집기에서 `jkvSetup()` 1회 실행 → `vdr_cas`·`jkv_logs`·`jkv_req` 탭 생성 확인.
3. 웹앱 재배포(기존 URL 유지).
4. 사이트에서 CA 제출 → 시트 `vdr_cas` 행 생성, 운영자 화면 승인 → 외부 화면 `승인` 전환 확인.
5. 문제 시 프런트는 자동으로 로컬 모드로 되돌아가므로 사이트는 계속 동작합니다.
