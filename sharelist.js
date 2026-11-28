/* =========================================================================
   Open AI Asset Bridge — sharelist.js  (📤 화주 공개 목록 · 물류센터 TFT, 2026-11-27)
   -------------------------------------------------------------------------
   · 물류센터 TFT 계정이 '화주에게 공개할 물건'을 그 자리에서 관리합니다.
     비공개로 둔 물건은 외부 공유 대상에서 빠지고, TFT 화면에서만 관리 목록에 남습니다.
     지도·목록의 노출 자체는 서버 토큰 범위를 그대로 따릅니다(비물류 자산은 여기에도 없음).
   · 저장은 브라우저(localStorage)입니다. 서버(Apps Script)는 건드리지 않습니다.
     시트에 쓸 수 있게 되면 share_list 탭(asset_id·화주·공개여부·공개일·메모)으로 옮기면 됩니다.
   · 실제 메일·외부 전송은 하지 않습니다(수신자·발송 정책 미확정).
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NAI_MAP_CONFIG || {};
  var KEY = (CFG.STORAGE_PREFIX || 'nai-map') + ':sharelist:v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function toast(msg, err) {
    if (window.naiToast) { window.naiToast(msg, err); return; }
    try { var el = $('#toast'); if (el) { el.textContent = msg; el.className = 'toast' + (err ? ' err' : ''); } } catch (e) { /* noop */ }
  }
  function role() { return (window.naiMap && window.naiMap.role) ? window.naiMap.role() : 'external'; }
  function canManage() { var r = role(); return r === 'logi' || r === 'admin'; }

  function read() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '{}'); return (v && typeof v === 'object') ? v : {}; } catch (e) { return {}; }
  }
  function write(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); return true; } catch (e) { return false; }
  }
  function today() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* 물류센터 범위 — TFT 자동 범위(로지스틱스)와 같은 기준 */
  function allAssets() {
    var st = window.naiMap && window.naiMap.state;
    var list = (st && st.assets) ? st.assets.slice() : [];
    return list.filter(function (a) { return a && a.sector === 'logistics' && !a._tr; });
  }

  var F = { q: '', status: 'ALL', pub: 'ALL' };

  function rowOf(a, map) {
    var r = map[a.id] || {};
    var pub = !!r.pub;
    return '<tr data-id="' + esc(a.id) + '">' +
      '<td class="sl-name"><strong>' + esc(a.name) + '</strong>' +
        '<span>' + esc([a.region, a.sub_type, a.scale_info].filter(Boolean).join(' · ')) + '</span></td>' +
      '<td>' + esc(a.status || a.status_group || '') + '</td>' +
      '<td><button type="button" class="sl-pub' + (pub ? ' is-on' : '') + '" data-sl-pub="' + esc(a.id) + '" aria-pressed="' + pub + '">' +
        (pub ? '공개' : '비공개') + '</button></td>' +
      '<td><input class="sl-in" data-sl-field="shipper" data-id="' + esc(a.id) + '" value="' + esc(r.shipper || '') + '" placeholder="화주 기업"></td>' +
      '<td><input class="sl-in sl-date" type="date" data-sl-field="date" data-id="' + esc(a.id) + '" value="' + esc(r.date || '') + '"></td>' +
      '<td><input class="sl-in" data-sl-field="memo" data-id="' + esc(a.id) + '" value="' + esc(r.memo || '') + '" placeholder="메모"></td>' +
      '</tr>';
  }

  function visibleList(map) {
    return allAssets().filter(function (a) {
      if (F.q) {
        var hay = [a.name, a.address, a.region, a.sub_type, a.status, a.owner_amc, (map[a.id] || {}).shipper]
          .join(' ').toLowerCase();
        if (hay.indexOf(F.q.toLowerCase()) < 0) return false;
      }
      if (F.status !== 'ALL' && String(a.status_group || '') !== F.status) return false;
      var pub = !!(map[a.id] || {}).pub;
      if (F.pub === 'PUB' && !pub) return false;
      if (F.pub === 'PRIV' && pub) return false;
      return true;
    });
  }

  function render() {
    var host = $('#shareListModal');
    if (!host) return;
    var map = read();
    var list = visibleList(map);
    var pubCount = Object.keys(map).filter(function (k) { return map[k] && map[k].pub; }).length;
    var statuses = {};
    allAssets().forEach(function (a) { if (a.status_group) statuses[a.status_group] = (statuses[a.status_group] || 0) + 1; });

    host.innerHTML = '<div class="sl-card" role="dialog" aria-modal="true" aria-label="화주 공개 목록">' +
      '<div class="sl-head"><div><b>📤 화주 공개 목록</b>' +
        '<span class="sl-sub">물류센터 ' + allAssets().length + '건 · 공개 ' + pubCount + '건 · 저장은 이 브라우저에 됩니다</span></div>' +
        '<button type="button" class="sl-x" data-sl-close aria-label="닫기">×</button></div>' +
      '<div class="sl-tools">' +
        '<input id="slSearch" type="search" placeholder="물건명·주소·화주 검색" value="' + esc(F.q) + '">' +
        '<select id="slStatus"><option value="ALL">전체 상태</option>' +
          Object.keys(statuses).map(function (s) {
            return '<option value="' + esc(s) + '"' + (F.status === s ? ' selected' : '') + '>' + esc(s) + ' (' + statuses[s] + ')</option>';
          }).join('') + '</select>' +
        '<select id="slPub">' +
          '<option value="ALL"' + (F.pub === 'ALL' ? ' selected' : '') + '>공개·비공개 전체</option>' +
          '<option value="PUB"' + (F.pub === 'PUB' ? ' selected' : '') + '>공개만</option>' +
          '<option value="PRIV"' + (F.pub === 'PRIV' ? ' selected' : '') + '>비공개만</option>' +
        '</select>' +
        '<button type="button" class="sl-btn" data-sl-csv>CSV 내보내기</button>' +
        '<span class="sl-count">' + list.length + '건</span>' +
      '</div>' +
      '<div class="sl-body"><table class="sl-table"><thead><tr>' +
        '<th>물건</th><th>상태</th><th>공개</th><th>공개 대상 화주</th><th>공개일</th><th>메모</th>' +
      '</tr></thead><tbody>' +
        (list.length ? list.slice(0, 300).map(function (a) { return rowOf(a, map); }).join('') :
          '<tr><td colspan="6" class="sl-empty">조건에 맞는 물류센터 물건이 없습니다.</td></tr>') +
      '</tbody></table>' +
      (list.length > 300 ? '<p class="sl-more">전체 ' + list.length + '건 중 300건 표시 — 검색으로 좁혀 주세요.</p>' : '') +
      '</div></div>';

    var s = $('#slSearch');
    if (s) s.addEventListener('input', function (e) { F.q = e.target.value; render(); });
    var st = $('#slStatus');
    if (st) st.addEventListener('change', function (e) { F.status = e.target.value; render(); });
    var pb = $('#slPub');
    if (pb) pb.addEventListener('change', function (e) { F.pub = e.target.value; render(); });
  }

  function togglePub(id) {
    var map = read();
    var r = map[id] || {};
    r.pub = !r.pub;
    if (r.pub && !r.date) r.date = today();
    map[id] = r;
    write(map);
    render();
  }

  function setField(id, field, value) {
    var map = read();
    var r = map[id] || {};
    r[field] = value;
    map[id] = r;
    write(map);
  }

  function csv() {
    var map = read();
    var rows = [['asset_id', '물건명', '섹터', '상태', '공개여부', '공개대상화주', '공개일', '메모']];
    /* 화면에 보이는 행만 내보냅니다 — 공개/비공개·상태·검색 필터를 그대로 따릅니다.
       (예: '공개만'으로 보고 내보내면 비공개 물건의 화주명은 파일에 들어가지 않습니다.) */
    var list = visibleList(map);
    list.forEach(function (a) {
      var r = map[a.id] || {};
      rows.push([a.id, a.name, '물류센터', a.status || a.status_group || '', r.pub ? '공개' : '비공개',
        r.shipper || '', r.date || '', r.memo || '']);
    });
    var hidden = allAssets().length - list.length;
    var text = rows.map(function (r) {
      return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    try {
      var blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '화주공개목록_' + today() + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      toast(list.length + '건을 내려받았습니다.' + (hidden ? ' (화면 필터로 ' + hidden + '건 제외)' : ''));
    } catch (e) { toast('CSV를 만들지 못했습니다.', true); }
  }

  function open() {
    if (!canManage()) { toast('물류센터 TFT 또는 관리자만 쓸 수 있습니다.', true); return; }
    var host = $('#shareListModal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'shareListModal';
      host.className = 'sl-modal hidden';
      document.body.appendChild(host);
    }
    host.classList.remove('hidden');
    render();
  }
  function close() { var h = $('#shareListModal'); if (h) h.classList.add('hidden'); }

  function bind() {
    document.addEventListener('click', function (e) {
      var op = e.target.closest('[data-sharelist-open]');
      if (op) { open(); return; }
      if (e.target.closest('[data-sl-close]') || e.target.id === 'shareListModal') { close(); return; }
      if (e.target.closest('[data-sl-csv]')) { csv(); return; }
      var pub = e.target.closest('[data-sl-pub]');
      if (pub) { togglePub(pub.getAttribute('data-sl-pub')); return; }
    });
    document.addEventListener('change', function (e) {
      var f = e.target.closest('[data-sl-field]');
      if (!f) return;
      setField(f.getAttribute('data-id'), f.getAttribute('data-sl-field'), f.value);
    });
  }

  window.NAI_SHARELIST = { open: open, close: close, count: function () { return allAssets().length; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
