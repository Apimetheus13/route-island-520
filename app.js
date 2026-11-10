/* 路線島 — 純前端，無外部相依。 */
(function () {
  'use strict';

  var CONFIG = {
    dataUrl: 'data/stations.json',
    emptyUrl: 'data/empty.json',
    defaultWarnMinutes: 30,   // 關門提醒門檻（分鐘），stations.json 的 meta.closeWarningMinutes 會覆蓋
    rowHeight: 96,            // 站數多時 renderChain 會自動縮小
    denseRowHeight: 74,            // 島鏈每站垂直間距（px）
    chainPad: 56,
    xPattern: [0.5, 0.27, 0.68, 0.36, 0.72, 0.3, 0.62, 0.28, 0.55] // 島的橫向位置（容器寬度比例）
  };

  var params = new URLSearchParams(location.search);
  var forcedState = params.get('state');          // loading | empty | error
  var forcedErrorPending = forcedState === 'error'; // 只讓第一次載入失敗，重試會正常載入

  var $ = function (id) { return document.getElementById(id); };
  var statusArea = $('statusArea'), content = $('content'), chain = $('chain'), list = $('stationList');
  var sheet = $('sheet'), backdrop = $('sheetBackdrop'), toggle = $('warnToggle');

  var state = { stations: [], meta: {}, warnMinutes: CONFIG.defaultWarnMinutes, warnOn: false, openId: null, opener: null, savedY: 0, pace: 20 };

  // ---------- 工具 ----------
  function toMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    return m ? (+m[1]) * 60 + (+m[2]) : NaN;
  }
  function fmtTime(hhmm) {
    var t = toMin(hhmm);
    if (isNaN(t)) return '—';
    var day = Math.floor(t / 1440), r = t % 1440;
    var s = String(Math.floor(r / 60)).padStart(2, '0') + ':' + String(r % 60).padStart(2, '0');
    var base = state.meta && state.meta.startDate ? new Date(state.meta.startDate + 'T00:00:00') : null;
    if (base && !isNaN(base)) { base.setDate(base.getDate() + day); return (base.getMonth() + 1) + '/' + base.getDate() + ' ' + s; }
    return day > 0 ? '隔日 ' + s : s;
  }
  function fmtKm(n) { return (Math.round(n * 10) / 10) + ' 公里'; }
  function minToHHMM(m) { m = Math.round(m); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); }
  // 預估抵達：資料有 eta 就用；否則依所選平均速度（含休息）由出發時間推算
  function etaOf(s) {
    if (s.eta) return s.eta;
    var start = toMin(state.meta.startTime || '00:00');
    if (isNaN(start) || !state.pace) return '';
    return minToHHMM(start + s.km / state.pace * 60);
  }
  // 要在關門前抵達所需的最低平均速度（含休息）
  function needSpeed(s) {
    var h = (toMin(s.close) - toMin(state.meta.startTime || '00:00')) / 60;
    return s.km > 0 && h > 0 ? Math.round(s.km / h * 10) / 10 : null;
  }
  var TYPE_LABEL = { checkpoint: '官方檢查站', store: '超商', meal: '用餐', backup: '備援', other: '其他停靠點' };
  function tagsOf(s) { return Array.isArray(s.tags) ? s.tags : []; }
  function typeClass(s) {
    var t = tagsOf(s);
    return t.indexOf('checkpoint') >= 0 ? 't-cp' : t.indexOf('backup') >= 0 ? 't-backup' : t.indexOf('meal') >= 0 ? 't-meal' : t.indexOf('store') >= 0 ? 't-store' : 't-other';
  }
  function tagChips(s) {
    var wrap = el('span', 'chips');
    tagsOf(s).forEach(function (t) { wrap.appendChild(el('span', 'chip c-' + t, TYPE_LABEL[t] || t)); });
    return wrap;
  }
  function safeUrl(u) { return /^https:\/\/www\.google\.com\/maps\//.test(u || '') ? u : null; }
  function slack(s) { return toMin(s.close) - toMin(etaOf(s)); }
  function isTight(s) { var d = slack(s); return !isNaN(d) && d < state.warnMinutes; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function safeDataPath(p) { return p && /^[\w\-\/]+\.json$/.test(p) && p.indexOf('..') < 0 ? p : null; }

  // ---------- 資料 ----------
  function validate(json) {
    if (!json || !Array.isArray(json.stations)) throw new Error('資料格式不正確：缺少 stations 陣列');
    json.stations.forEach(function (s, i) {
      if (!s || typeof s.name !== 'string' || typeof s.km !== 'number') throw new Error('第 ' + (i + 1) + ' 站資料不完整');
    });
    return json;
  }

  function load() {
    renderLoading();
    if (forcedState === 'loading') return; // 測試用：停在載入中
    var url = forcedState === 'empty' ? CONFIG.emptyUrl : (safeDataPath(params.get('data')) || CONFIG.dataUrl);
    var p;
    if (forcedErrorPending) {
      forcedErrorPending = false;
      p = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('模擬讀取失敗（?state=error）')); }, 400); });
    } else {
      p = fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('讀取失敗（HTTP ' + r.status + '）');
        return r.json();
      }).then(validate);
    }
    p.then(onData, renderError);
  }

  function onData(json) {
    var meta = json.meta || {};
    state.meta = meta;
    state.stations = json.stations.slice();
    setupPace(meta);
    renderSources(json.sources || []);
    if (typeof meta.closeWarningMinutes === 'number') state.warnMinutes = meta.closeWarningMinutes;
    $('legendMin').textContent = state.warnMinutes;
    if (meta.isDemo !== false) {
      $('demoBanner').hidden = false;
      if (meta.note) $('demoNote').textContent = meta.note;
    }
    if (!state.stations.length) return renderEmpty();
    statusArea.innerHTML = '';
    content.hidden = false;
    renderAll();
  }

  // ---------- 狀態畫面 ----------
  function renderLoading() {
    content.hidden = true;
    statusArea.innerHTML = '';
    var box = el('div', 'state'); box.setAttribute('data-state', 'loading'); box.setAttribute('role', 'status');
    box.appendChild(el('div', 'spinner'));
    box.appendChild(el('h2', null, '載入站點資料中…'));
    box.appendChild(el('div', 'skeleton')); box.appendChild(el('div', 'skeleton'));
    statusArea.appendChild(box);
  }
  function renderEmpty() {
    content.hidden = true;
    statusArea.innerHTML = '';
    var box = el('div', 'state'); box.setAttribute('data-state', 'empty');
    box.appendChild(el('div', 'state-icon', '🏝️'));
    box.appendChild(el('h2', null, '目前沒有站點資料'));
    box.appendChild(el('p', null, '資料檔裡還沒有任何休息站。請在 data/stations.json 加入站點後重新整理。'));
    var b = el('button', 'btn', '重新整理'); b.type = 'button';
    b.addEventListener('click', function () { forcedState = null; load(); });
    box.appendChild(b);
    statusArea.appendChild(box);
  }
  function renderError(err) {
    content.hidden = true;
    statusArea.innerHTML = '';
    var box = el('div', 'state'); box.setAttribute('data-state', 'error'); box.setAttribute('role', 'alert');
    box.appendChild(el('div', 'state-icon', '⚠️'));
    box.appendChild(el('h2', null, '站點資料讀取失敗'));
    box.appendChild(el('p', null, (err && err.message) || '發生未知錯誤'));
    var b = el('button', 'btn', '重試'); b.type = 'button'; b.id = 'retryBtn';
    b.addEventListener('click', load);
    box.appendChild(b);
    statusArea.appendChild(box);
    b.focus({ preventScroll: true });
  }

  // ---------- 主畫面 ----------
  function renderAll() { renderChain(); renderList(); $('legend').hidden = !state.warnOn; }

  function renderChain() {
    var st = state.stations, n = st.length;
    var w = chain.clientWidth || 340;
    var rh = n > 12 ? CONFIG.denseRowHeight : CONFIG.rowHeight;
    var h = CONFIG.chainPad * 2 + (n - 1) * rh;
    chain.style.height = h + 'px';
    chain.innerHTML = '';
    var pts = st.map(function (s, i) {
      var fx = CONFIG.xPattern[i % CONFIG.xPattern.length];
      var x = Math.min(Math.max(fx * w, 60), w - 60);
      return { x: x, y: CONFIG.chainPad + i * rh };
    });
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('aria-hidden', 'true');
    chain.appendChild(svg);
    for (var i = 1; i < n; i++) {
      var a = pts[i - 1], b = pts[i];
      var tight = state.warnOn && isTight(st[i]);
      var path = document.createElementNS(NS, 'path');
      var mx = (a.x + b.x) / 2 + (i % 2 ? 18 : -18);
      path.setAttribute('d', 'M' + a.x + ' ' + a.y + ' Q' + mx + ' ' + ((a.y + b.y) / 2) + ' ' + b.x + ' ' + b.y);
      path.setAttribute('class', 'seg' + (tight ? ' tight' : ''));
      path.setAttribute('data-seg', st[i].id);
      svg.appendChild(path);
      var lab = el('span', 'seg-label' + (tight ? ' tight' : ''), fmtKm(st[i].km - st[i - 1].km));
      lab.style.left = ((a.x + b.x) / 2 + (i % 2 ? 9 : -9)) + 'px';
      lab.style.top = ((a.y + b.y) / 2) + 'px';
      lab.setAttribute('data-seg-label', st[i].id);
      chain.appendChild(lab);
    }
    st.forEach(function (s, i) {
      var tight = state.warnOn && isTight(s);
      var btn = el('button', 'island ' + typeClass(s) + (tight ? ' tight' : '') + (state.openId === s.id ? ' active' : ''));
      btn.type = 'button';
      btn.style.left = pts[i].x + 'px';
      btn.style.top = pts[i].y + 'px';
      btn.setAttribute('data-id', s.id);
      btn.setAttribute('aria-label', s.name + '，累積 ' + fmtKm(s.km) + (tight ? '，關門時間緊' : '') + '，開啟站點卡片');
      btn.appendChild(el('span', 'i-name', s.short || s.name));
      btn.appendChild(el('span', 'i-km', fmtKm(s.km)));
      btn.addEventListener('click', function () { openSheet(s.id, btn); });
      chain.appendChild(btn);
    });
    var cn = el('span', 'compass n', '▲ 北'), cs = el('span', 'compass s', '▼ 南');
    chain.appendChild(cn); chain.appendChild(cs);
  }

  function renderList() {
    list.innerHTML = '';
    state.stations.forEach(function (s, i) {
      var tight = state.warnOn && isTight(s);
      var li = el('li');
      var btn = el('button', 'row ' + typeClass(s) + (tight ? ' tight' : ''));
      btn.type = 'button';
      btn.setAttribute('data-id', s.id);
      btn.appendChild(el('span', 'row-badge', String(s.no || i + 1)));
      var main = el('span', 'row-main');
      var name = el('span', 'row-name', s.name);
      if (tight) name.appendChild(el('span', 'tag-warn', '時間緊'));
      main.appendChild(name);
      main.appendChild(tagChips(s));
      main.appendChild(el('span', 'row-meta', '累積 ' + fmtKm(s.km) + (i > 0 ? '・距上一站 ' + fmtKm(s.km - state.stations[i - 1].km) : '・起點')));
      btn.appendChild(main);
      var side = el('span', 'row-side');
      side.appendChild(el('b', null, '預估 ' + fmtTime(etaOf(s))));
      if (s.close) side.appendChild(document.createTextNode('關門 ' + fmtTime(s.close)));
      btn.appendChild(side);
      btn.addEventListener('click', function () { openSheet(s.id, btn); });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  // ---------- 站點卡片（島與清單共用） ----------
  function fillSheet(s) {
    var i = state.stations.indexOf(s);
    $('sheetTitle').textContent = s.name;
    $('fKm').textContent = fmtKm(s.km);
    $('fGap').textContent = i > 0 ? fmtKm(s.km - state.stations[i - 1].km) : '起點';
    $('fEta').textContent = fmtTime(etaOf(s)) + (s.eta ? '' : '（以 ' + state.pace + ' km/h 推算）');
    $('fClose').textContent = s.close ? fmtTime(s.close) : '無（非官方檢查站）';
    var tg = $('fTags'); tg.innerHTML = ''; tg.appendChild(tagChips(s));
    if (s.cp) tg.appendChild(el('span', 'chip c-cpno', s.cp));
    $('fAddr').textContent = s.addr || (s.lat ? '未查證（導航使用 OpenStreetMap 座標）' : '未查證（僅提供名稱搜尋連結）');
    $('fHours').textContent = s.hours || (tagsOf(s).indexOf('store') >= 0 ? '未查證' : '—');
    $('fAmen').textContent = s.amenities && s.amenities.length ? s.amenities.join('、') : '—';
    $('fAmenRow').hidden = tagsOf(s).indexOf('store') < 0;
    $('fHoursRow').hidden = tagsOf(s).indexOf('store') < 0;
    var g = safeUrl(s.gmap), nv = safeUrl(s.nav);
    $('fMap').hidden = !g; if (g) $('fMap').href = g;
    $('fNav').hidden = !nv; if (nv) $('fNav').href = nv;
    var ns = s.close ? needSpeed(s) : null;
    $('fNeedRow').hidden = !ns;
    $('fNeed').textContent = ns ? ns + ' km/h（含休息）' : '—';
    var note = $('fNote');
    note.textContent = s.note || '';
    note.hidden = !s.note;
    note.classList.toggle('conflict', !!s.conflict);
    var uv = $('fUnverified');
    uv.textContent = s.unverified && s.unverified.length ? '未查證：' + s.unverified.join('、') : '';
    uv.hidden = !uv.textContent;
    $('fSource').textContent = '位置／地址來源：' + (s.src || '未查證') + (s.close ? '。關門時間：主辦單位網站（2026-11-10 擷取）' : '') + '。里程為我的路線規劃值。';

    var warn = $('sheetWarn');
    var d = slack(s);
    if (state.warnOn && isTight(s)) {
      warn.hidden = false;
      warn.textContent = d < 0
        ? '關門提醒：以目前選的平均速度，預估抵達已晚於關門時間。'
        : '關門提醒：預估抵達時間距關門只剩 ' + d + ' 分鐘（門檻 ' + state.warnMinutes + ' 分鐘），請留意配速。';
    } else warn.hidden = true;
    sheet.setAttribute('data-station', s.id);
  }

  function openSheet(id, opener) {
    var s = state.stations.find(function (x) { return x.id === id; });
    if (!s) return;
    var already = !sheet.hidden;
    state.openId = id;
    if (!already) {
      state.opener = { inList: opener.classList.contains('row'), id: id };
      state.savedY = window.scrollY;
    }
    fillSheet(s);
    markActive();
    if (already) return;
    document.documentElement.classList.add('locked');
    backdrop.hidden = false; sheet.hidden = false;
    requestAnimationFrame(function () { backdrop.classList.add('open'); sheet.classList.add('open'); });
    $('sheetClose').focus({ preventScroll: true });
  }

  function closeSheet() {
    if (sheet.hidden) return;
    sheet.classList.remove('open'); backdrop.classList.remove('open');
    sheet.hidden = true; backdrop.hidden = true;
    document.documentElement.classList.remove('locked');
    window.scrollTo(0, state.savedY);
    state.openId = null;
    markActive();
    var o = state.opener && (state.opener.inList ? list : chain).querySelector('[data-id="' + state.opener.id + '"]');
    if (o) o.focus({ preventScroll: true });
    window.scrollTo(0, state.savedY);
  }

  function markActive() {
    Array.prototype.forEach.call(chain.querySelectorAll('.island'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-id') === state.openId);
    });
  }

  // ---------- 配速選擇 ----------
  function setupPace(meta) {
    var box = $('paceOpts');
    var opts = Array.isArray(meta.paceOptions) && meta.paceOptions.length ? meta.paceOptions : [18, 20, 22, 24];
    var saved = NaN;
    try { saved = parseFloat(localStorage.getItem('routeIsland.pace')); } catch (e) {}
    state.pace = opts.indexOf(saved) >= 0 ? saved : (meta.defaultPace || opts[0]);
    box.innerHTML = '';
    opts.forEach(function (v) {
      var b = el('button', 'pace-btn', v + ' km/h'); b.type = 'button';
      b.setAttribute('data-pace', v);
      b.setAttribute('aria-pressed', String(v === state.pace));
      b.addEventListener('click', function () {
        state.pace = v;
        try { localStorage.setItem('routeIsland.pace', String(v)); } catch (e) {}
        Array.prototype.forEach.call(box.children, function (c) { c.setAttribute('aria-pressed', String(+c.getAttribute('data-pace') === v)); });
        updatePaceSummary();
        if (state.stations.length) renderAll();
      });
      box.appendChild(b);
    });
    updatePaceSummary();
  }
  function updatePaceSummary() {
    var last = state.stations[state.stations.length - 1];
    if (!last) return;
    var hrs = last.km / state.pace;
    var worst = null;
    state.stations.forEach(function (x) { var v = x.close ? needSpeed(x) : null; if (v && (!worst || v > worst.v)) worst = { v: v, s: x }; });
    if (worst && $('minSpeed')) { $('minSpeed').textContent = worst.v + ' km/h'; $('minSpeedAt').textContent = worst.s.short || worst.s.name; }
    var limit = state.meta.timeLimitHours;
    $('paceSummary').textContent = '以平均 ' + state.pace + ' km/h（含休息）估算，' + last.km + ' 公里約需 ' +
      (Math.round(hrs * 10) / 10) + ' 小時，預估 ' + fmtTime(etaOf(last)) + ' 抵達' +
      (limit ? (hrs <= limit ? '，在 ' + limit + ' 小時時限內。' : '，超過 ' + limit + ' 小時時限。') : '。');
  }
  function renderSources(src) {
    var ul = $('sourceList'); if (!ul) return;
    ul.innerHTML = '';
    src.forEach(function (x) {
      if (!x || !/^https:\/\//.test(x.url || '')) return;
      var li = el('li');
      if (x.kind) li.appendChild(el('span', 'src-kind', x.kind));
      var a = el('a', null, x.label || x.url); a.href = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.appendChild(a);
      ul.appendChild(li);
    });
    if (state.meta.retrieved) $('retrieved').textContent = state.meta.retrieved;
  }

  // ---------- 事件 ----------
  $('sheetClose').addEventListener('click', closeSheet);
  backdrop.addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) {
    if (sheet.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key === 'Tab') { // 焦點留在卡片內
      var f = sheet.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  toggle.addEventListener('click', function () {
    state.warnOn = !state.warnOn;
    toggle.setAttribute('aria-checked', String(state.warnOn));
    try { localStorage.setItem('routeIsland.warnOn', state.warnOn ? '1' : '0'); } catch (e) {}
    if (state.stations.length) {
      renderAll(); // 觸發元素以 id 記錄，重繪後仍找得回來
      var s = state.stations.find(function (x) { return x.id === state.openId; });
      if (s && !sheet.hidden) fillSheet(s);
    }
  });
  try { if (localStorage.getItem('routeIsland.warnOn') === '1') { state.warnOn = true; toggle.setAttribute('aria-checked', 'true'); } } catch (e) {}

  var rT;
  window.addEventListener('resize', function () {
    clearTimeout(rT);
    rT = setTimeout(function () { if (state.stations.length && !content.hidden) renderChain(); }, 120);
  });

  // 測試掛勾
  window.__routeIsland = { state: state, config: CONFIG, isTight: isTight, reload: load };

  load();
})();
