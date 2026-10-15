/* 调手感面板（通用组件）  v1.0.0（2026-10-15）
   出处：日程卡片按钮按下反馈的 ?tune=1 面板。用户：「这个调手感面板做的非常非常好……我的其他项目/以后再做新的项目也可以用」。
   设计稿：桌面「手感调试工具_设计稿.md」（★☆ 全做）。项目记忆：project_feel_lab.md。
   手感参数怎么定：方向照一手资料，幅度给偏明显的起点，最终以「用户真机调定」为准（feedback_apple_interaction_reference.md 开头）。

   一个文件、零依赖（二维码要用时才按需加载 qrcode.js——存档「组件_二维码搬设置」里那份）。

   用法：
     const tp = TunePanel({
       project: '日程卡片', version: 'press-v3',          // 每个项目、每个版本的参数分开存
       groups: [{ title: '按钮按下', params: [
         { key: 'max', label: '小按钮放大到', unit: '倍', min: 1.02, max: 1.5, step: .01, default: 1.22, hint: '…' },
         { key: 'glow', label: '光晕', type: 'toggle', default: true },
         { key: 'ease', label: '曲线', type: 'select', options: ['弹跳', '干脆', '平滑'], default: '弹跳' } ] }],
       onChange: (values, key) => {},                    // 参数一变就通知
       curves: [{ label: '松开', resp: 'outR', bounce: 'outB' }],   // 可选：把弹簧画成曲线（resp/bounce 填参数 key）
       playground: el => {},                             // 可选：往「试玩区」放项目自己的示例元素
       secret: '.brand h1',                              // 可选：连点 5 下这个元素也能打开面板（主屏幕网页改不了网址）
       mount: null,                                      // 可选：给一个元素就「嵌在页面里」显示（实验室用），不浮动
       finalName: 'PRESS_DEFAULT',                       // 「定稿」生成代码时用的变量名
       qrSrc: 'qrcode.js'                                // 可选：二维码库的路径
     });
     tp.get('max'); tp.values(); tp.note('上次按下：×1.22'); TunePanel.owns(evt.target); tp.timeScale();

   不带 ?tune=1（也没连点暗门、也没 mount）时**不画任何界面**，但照样返回存在本机的参数——项目永远通过它取值。

   宽屏（≥1000px）浮动时是右侧侧栏：<html> 挂 tp-side 类、--tp-side-w 变量，body 右内边距让出位置；
   项目里 position:fixed 的东西（弹窗遮罩、悬浮按钮）自己用 html.tp-side 让位（见 README）。 */
(function (root) {
  'use strict';

  var ALL = [];                       // 所有面板实例（owns 用）
  var VERSION = '1.0.0';
  var SIDE_W = 372;                   // 宽屏侧栏占的宽度（面板 348 + 两边留白）

  /* ---------- 小工具 ---------- */
  /* 方案编号：别用时间戳——同一毫秒里存两个方案会撞号，点 A 切到的其实是 B（自检 6 次里撞了 4 次） */
  var idSeq = 0;
  function uid() { return Date.now().toString(36) + '-' + (++idSeq) + '-' + Math.random().toString(36).slice(2, 6); }
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function decimals(step) { var s = String(step); var i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function b64url(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(s) {
    var bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 隐私模式：只是存不住 */ } }
  function today() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  /* 设备信息：手感和设备有关，复制出去的参数带上 */
  function device() {
    var ua = navigator.userAgent, os = /iPhone/.test(ua) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '其他';
    var ver = (/OS (\d+)_(\d+)/.exec(ua) || /Android (\d+(\.\d+)?)/.exec(ua) || [])[0] || '';
    var browser = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /Edg/.test(ua) ? 'Edge' : /Safari/.test(ua) ? 'Safari' : /MicroMessenger/.test(ua) ? '微信' : '其他';
    if (/MicroMessenger/.test(ua)) browser = '微信';
    return { os: os, ver: ver.replace(/_/g, '.'), browser: browser, screen: screen.width + '×' + screen.height, dpr: window.devicePixelRatio || 1,
             standalone: !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || !!navigator.standalone };
  }
  /* SwiftUI 式弹簧：response＝感知时长（秒），bounce＝弹性（阻尼比 = 1 − bounce）。返回 0→1 的进度序列（120Hz 采样） */
  function springCurve(resp, bounce) {
    var z = clamp(1 - bounce, .05, 1), w0 = 2 * Math.PI / Math.max(.05, resp), out = [], step = 1 / 120;
    for (var i = 0; i < 1200; i++) {
      var t = i * step, u;
      if (z < 1) { var wd = w0 * Math.sqrt(1 - z * z); u = Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); }
      else u = Math.exp(-w0 * t) * (1 + w0 * t);
      out.push(1 - u);
      if (t > .08 && Math.abs(u) < .002) break;
    }
    out[out.length - 1] = 1;
    return out;
  }

  /* ---------- 样式（只注入一次） ---------- */
  var CSS_DONE = false;
  function injectCss() {
    if (CSS_DONE) return; CSS_DONE = true;
    var css = [
      '.tp{--tp-bg:#fff;--tp-bg2:#f2f4f7;--tp-line:#e3e8ee;--tp-text:#14181d;--tp-text2:#5b6572;--tp-text3:#8a929c;--tp-acc:#2f86f6;--tp-acc-fg:#fff;--tp-warn:#c2410c;',
      '  font:13px/1.45 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--tp-text);-webkit-text-size-adjust:100%;box-sizing:border-box}',
      '.tp *{box-sizing:border-box}',
      '@media (prefers-color-scheme:dark){.tp:not(.tp-light){--tp-bg:#20242b;--tp-bg2:#2a2f37;--tp-line:#363c46;--tp-text:#f2f4f7;--tp-text2:#b3bcc8;--tp-text3:#8b95a3;--tp-acc:#4b9bff;--tp-warn:#fb923c}}',
      '.tp.tp-dark{--tp-bg:#20242b;--tp-bg2:#2a2f37;--tp-line:#363c46;--tp-text:#f2f4f7;--tp-text2:#b3bcc8;--tp-text3:#8b95a3;--tp-acc:#4b9bff;--tp-warn:#fb923c}',
      /* 浮动形态 */
      '.tp-float{position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:2147483000;max-width:520px;margin:0 auto;',
      '  background:var(--tp-bg);border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.28);padding:10px 12px;display:flex;flex-direction:column;max-height:min(70vh,640px)}',
      '.tp-float.tp-top{top:calc(8px + env(safe-area-inset-top));bottom:auto}',
      '.tp-float.tp-glass{background:color-mix(in srgb,var(--tp-bg) 62%,transparent);-webkit-backdrop-filter:saturate(170%) blur(14px);backdrop-filter:saturate(170%) blur(14px)}',
      '.tp-float.tp-fold{left:calc(10px + env(safe-area-inset-left));right:auto;width:auto;max-width:none;margin:0;padding:5px 5px 5px 12px;border-radius:999px;max-height:none}',
      '.tp-float.tp-fold .tp-body,.tp-float.tp-fold .tp-hide-fold{display:none!important}',
      '@media (min-width:1000px){',
      '  html.tp-side body{padding-right:' + SIDE_W + 'px}',
      '  .tp-float.tp-sidebar{left:auto;right:12px;top:12px;bottom:12px;width:348px;max-width:none;margin:0;max-height:none}',
      '  .tp-float.tp-sidebar .tp-dock{display:none}',
      '}',
      '.tp-inline{background:var(--tp-bg);border-radius:16px;padding:12px;box-shadow:0 1px 2px rgba(16,18,40,.06),0 8px 24px -10px rgba(16,18,40,.2)}',
      /* 头部 */
      '.tp-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.tp-title{font-size:15px;font-weight:800;margin-right:auto}',
      '.tp-btn{min-height:36px;min-width:36px;padding:0 11px;border:0;border-radius:10px;background:var(--tp-bg2);color:var(--tp-text);font:inherit;font-weight:700;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
      '.tp-btn:active{filter:brightness(.92)}',
      '.tp-btn[disabled]{opacity:.4}',
      '.tp-btn.tp-pri{background:var(--tp-acc);color:var(--tp-acc-fg)}',
      '.tp-btn.tp-on{background:var(--tp-acc);color:var(--tp-acc-fg)}',
      '.tp-body{overflow-y:auto;overflow-x:hidden;margin-top:8px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;flex:1 1 auto;min-height:0}',
      '.tp-inline .tp-body{overflow:visible}',
      '.tp-warnbar{margin:0 0 8px;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,var(--tp-warn) 12%,transparent);color:var(--tp-warn);font-weight:600}',
      '.tp-readout{margin:0 0 8px;font-weight:700;color:var(--tp-acc);min-height:1.45em}',
      /* 分区 */
      '.tp-sec{border-top:1px solid var(--tp-line);padding:8px 0 4px}',
      '.tp-sec:first-child{border-top:0;padding-top:0}',
      '.tp-sec-h{display:flex;align-items:center;gap:6px;width:100%;min-height:36px;border:0;background:none;padding:0;font:inherit;font-weight:800;font-size:13.5px;color:var(--tp-text);cursor:pointer;text-align:left}',
      '.tp-sec-h::after{content:"▾";margin-left:auto;color:var(--tp-text3);transition:transform .2s}',
      '.tp-sec.tp-closed .tp-sec-h::after{transform:rotate(-90deg)}',
      '.tp-sec.tp-closed .tp-sec-b{display:none}',
      /* 参数行 */
      '.tp-row{padding:6px 0}',
      '.tp-row-top{display:flex;align-items:center;gap:6px;min-height:28px}',
      '.tp-name{font-weight:600;color:var(--tp-text2);min-width:0}',
      '.tp-dot{width:7px;height:7px;border-radius:50%;background:var(--tp-acc);flex:0 0 auto;visibility:hidden}',
      '.tp-row.tp-changed .tp-dot{visibility:visible}',
      '.tp-i{border:0;background:none;color:var(--tp-text3);font:inherit;font-weight:800;min-width:28px;min-height:28px;padding:0;cursor:pointer}',
      '.tp-val{margin-left:auto;width:74px;min-height:30px;border:1px solid var(--tp-line);border-radius:8px;background:var(--tp-bg2);color:var(--tp-text);font:inherit;font-weight:800;text-align:right;padding:0 6px;font-variant-numeric:tabular-nums}',
      '.tp-unit{color:var(--tp-text3);width:2em;flex:0 0 auto}',
      '.tp-reset{border:0;background:none;color:var(--tp-text3);font-size:15px;min-width:30px;min-height:30px;cursor:pointer;visibility:hidden}',
      '.tp-row.tp-changed .tp-reset{visibility:visible}',
      '.tp-row-ctl{display:flex;align-items:center;gap:6px;margin-top:2px}',
      '.tp-range{flex:1 1 auto;min-width:0;width:100%;margin:0;min-height:32px;accent-color:var(--tp-acc)}',
      '.tp-step{min-width:36px;min-height:32px;padding:0;font-size:18px;line-height:1}',
      '.tp-hint{margin:4px 0 0;color:var(--tp-text3);font-size:12px}',
      '.tp-def{color:var(--tp-text3);font-size:12px}',
      '.tp-seg{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}',
      '.tp-switch{margin-left:auto;width:51px;height:31px;border-radius:999px;border:0;background:var(--tp-line);position:relative;cursor:pointer;flex:0 0 auto}',
      '.tp-switch::after{content:"";position:absolute;left:2px;top:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,.25);transition:transform .25s cubic-bezier(.3,1.3,.5,1)}',
      '.tp-switch[aria-checked="true"]{background:#34c759}',
      '.tp-switch[aria-checked="true"]::after{transform:translateX(20px)}',
      /* 方案、盲测、曲线、导出 */
      '.tp-chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}',
      '.tp-chip{display:inline-flex;align-items:center;gap:2px;border-radius:10px;background:var(--tp-bg2)}',
      '.tp-chip .tp-btn{background:transparent}',
      '.tp-chip.tp-active{background:var(--tp-acc)}',
      '.tp-chip.tp-active .tp-btn{color:var(--tp-acc-fg)}',
      '.tp-input{width:100%;min-height:36px;border:1px solid var(--tp-line);border-radius:10px;background:var(--tp-bg2);color:var(--tp-text);font:inherit;padding:0 10px}',
      '.tp-textarea{width:100%;min-height:90px;border:1px solid var(--tp-line);border-radius:10px;background:var(--tp-bg2);color:var(--tp-text);font:12px/1.4 ui-monospace,Consolas,monospace;padding:8px;resize:vertical}',
      '.tp-acts{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}',
      '.tp-note{margin:4px 0;color:var(--tp-text3);font-size:12px}',
      '.tp-curve{width:100%;height:96px;display:block;background:var(--tp-bg2);border-radius:10px;margin-top:4px}',
      '.tp-qr{display:block;margin:6px auto;width:200px;height:200px;image-rendering:pixelated;background:#fff;border-radius:8px}',
      '.tp-card{margin:0 0 8px;padding:10px;border-radius:12px;border:1px solid var(--tp-acc);background:color-mix(in srgb,var(--tp-acc) 8%,transparent)}',
      '.tp-diff{margin:4px 0;padding-left:18px}',
      '.tp-play{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:6px 0}',
      '.tp-blind-q{font-weight:800;margin:4px 0}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'tp-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- 慢动作：所有正在跑的动画（WAAPI、CSS 过渡、CSS 动画都在 document.getAnimations 里）按倍率放慢 ---------- */
  var slow = 1, slowRaf = 0;
  function setSlow(k) {
    slow = k;
    if (slowRaf) cancelAnimationFrame(slowRaf);
    slowRaf = 0;
    var apply = function () {
      if (document.getAnimations) document.getAnimations().forEach(function (a) {
        var t = a.effect && a.effect.target;
        if (t && t.closest && t.closest('.tp')) return;            // 面板自己的不放慢
        if (a.playbackRate !== slow) a.playbackRate = slow;
      });
      if (slow !== 1) slowRaf = requestAnimationFrame(apply);
    };
    apply();
  }

  /* ================= 主体 ================= */
  function TunePanel(o) {
    o = o || {};
    var project = String(o.project || location.pathname), version = String(o.version || 'v1');
    var KEY = (o.storagePrefix || 'tunepanel') + ':' + project + ':' + version;
    var groups = o.groups || [{ title: '参数', params: o.params || [] }];
    var params = []; groups.forEach(function (g) { (g.params || []).forEach(function (p) { params.push(p); }); });
    var byKey = {}; params.forEach(function (p) { p.type = p.type || 'range'; byKey[p.key] = p; });
    var DEF = {}; params.forEach(function (p) { DEF[p.key] = p.default; });

    /* 存档：{values, slots:[{id,name,values}], activeSlot, ui:{fold,top,glass,closed:{组名:1}}} —— 参数改名或删了，旧存档里不认识的、类型不对的一律忽略 */
    var store = load(KEY) || {};
    function valid(p, v) {
      if (p.type === 'toggle') return typeof v === 'boolean';
      if (p.type === 'select') return (p.options || []).indexOf(v) > -1;
      return typeof v === 'number' && isFinite(v);
    }
    function clean(vals) {
      var out = {};
      params.forEach(function (p) {
        var v = vals && vals[p.key];
        out[p.key] = valid(p, v) ? (p.type === 'range' ? clamp(v, p.min, p.max) : v) : DEF[p.key];
      });
      return out;
    }
    var values = clean(store.values);
    var slots = Array.isArray(store.slots) ? store.slots.filter(function (s) { return s && s.name && s.values; }).map(function (s) { return { id: s.id || uid(), name: String(s.name).slice(0, 12), values: clean(s.values) }; }) : [];
    (function () { var seen = {}; slots.forEach(function (s) { if (seen[s.id]) s.id = uid(); seen[s.id] = 1; }); })();   /* 旧存档里撞过号的，读进来时重新编号 */
    var activeSlot = store.activeSlot || null;
    var ui = store.ui || {}; ui.closed = ui.closed || {};
    var hist = [JSON.stringify(values)], histAt = 0;
    var readoutText = '';
    function persist() { save(KEY, { values: values, slots: slots, activeSlot: activeSlot, ui: ui }); }

    var api = {
      get: function (k) { return values[k]; },
      values: function () { var c = {}; for (var k in values) c[k] = values[k]; return c; },
      set: function (k, v, silent) { if (!byKey[k] || !valid(byKey[k], v)) return; values[k] = v; persist(); if (!silent) changed(k); refresh(); },
      note: function (t) { readoutText = String(t || ''); var r = el && el.querySelector('.tp-readout'); if (r) r.textContent = readoutText; },
      open: function () { if (!el) build(); ui.fold = false; applyUi(); },
      close: function () { if (el) { ui.fold = true; applyUi(); } },
      isOpen: function () { return !!el && !ui.fold; },
      owns: function (t) { return !!(el && t && el.contains(t)); },
      timeScale: function () { return slow; },
      defaults: function () { var c = {}; for (var k in DEF) c[k] = DEF[k]; return c; },
      export: exportObj,
      destroy: function () { if (el) el.remove(); el = null; document.documentElement.classList.remove('tp-side'); ALL.splice(ALL.indexOf(api), 1); }
    };
    ALL.push(api);

    function changed(k) { if (o.onChange) { try { o.onChange(api.values(), k); } catch (e) { console.error('[调手感面板] onChange 出错', e); } } }
    var histTimer = 0;
    function pushHist() {
      clearTimeout(histTimer);
      histTimer = setTimeout(function () {
        var s = JSON.stringify(values);
        if (s === hist[histAt]) return;
        hist = hist.slice(0, histAt + 1); hist.push(s); if (hist.length > 80) hist.shift(); histAt = hist.length - 1;
        refreshTools();
      }, 350);
    }
    function setAll(vals, why) {
      values = clean(vals);
      persist(); changed(why || '*'); refresh(); pushHist();
    }
    function exportObj() {
      var diff = {};
      params.forEach(function (p) { if (values[p.key] !== DEF[p.key]) diff[p.key] = [DEF[p.key], values[p.key]]; });
      return { tool: 'TunePanel ' + VERSION, project: project, version: version, time: today(), device: device(), slot: activeSlot ? (slots.filter(function (s) { return s.id === activeSlot; })[0] || {}).name : null, values: api.values(), changedFromDefault: diff };
    }
    function shareLink() {
      var u = new URL(location.href);
      u.searchParams.set('tune', '1');
      u.hash = 'tune=' + b64url(JSON.stringify({ p: project, v: version, values: values }));
      return u.toString();
    }

    /* ---------- 要不要画界面 ---------- */
    var el = null, reduceMq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    var wantQuery = /[?&]tune=1(&|$)/.test(location.search);
    var incoming = null;
    (function () {                                    // 链接带来的参数：先给人看会改哪些，确认才生效
      var m = /[#&]tune=([A-Za-z0-9\-_]+)/.exec(location.hash || '');
      if (!m) return;
      try { var d = JSON.parse(unb64url(m[1])); if (d && d.p === project && d.v === version && d.values) incoming = clean(d.values); } catch (e) { /* 坏链接：忽略 */ }
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* 抹不掉也不影响 */ }
    })();
    if (o.secret) {                                   // 暗门：连点 5 下（2 秒内）
      var taps = [];
      document.addEventListener('click', function (e) {
        if (!e.target.closest || !e.target.closest(o.secret)) return;
        var t = Date.now(); taps = taps.filter(function (x) { return t - x < 2000; }); taps.push(t);
        if (taps.length >= 5) { taps = []; api.open(); }
      }, true);
    }

    /* ---------- 界面 ---------- */
    var rowsEls = [];
    function build() {
      injectCss();
      el = h('div', 'tp ' + (o.mount ? 'tp-inline' : 'tp-float'));
      el.setAttribute('role', 'region'); el.setAttribute('aria-label', '调手感面板');
      var dark = document.documentElement.getAttribute('data-theme');
      if (dark === 'dark') el.classList.add('tp-dark'); else if (dark === 'light') el.classList.add('tp-light');
      /* 头部 */
      var head = h('div', 'tp-head');
      head.appendChild(h('span', 'tp-title', o.title || '调手感'));
      var bUndo = btn('↶', '撤销', undo, 'tp-hide-fold'), bRedo = btn('↷', '重做', redo, 'tp-hide-fold');
      head.appendChild(bUndo); head.appendChild(bRedo);
      if (!o.mount) {
        head.appendChild(btn('半透明', '面板变透明，看得见下面的页面', function () { ui.glass = !ui.glass; applyUi(); }, 'tp-glassbtn tp-hide-fold'));
        head.appendChild(btn('移到上面', '挡住了就换到另一边', function () { ui.top = !ui.top; applyUi(); }, 'tp-dock tp-hide-fold'));
        head.appendChild(btn('收起', '收成角落里的小胶囊', function () { ui.fold = !ui.fold; applyUi(); }, 'tp-foldbtn'));
      }
      el.appendChild(head);
      var body = h('div', 'tp-body');
      el.appendChild(body);
      /* 减弱动态效果提示 */
      var warn = h('p', 'tp-warnbar', '这台设备开了「减弱动态效果」：很多动效本来就会关掉或减弱，调了也看不出差别。测手感前先到 设置 → 辅助功能 → 动态效果 里关掉。');
      warn.hidden = !(reduceMq && reduceMq.matches);
      body.appendChild(warn);
      if (reduceMq && reduceMq.addEventListener) reduceMq.addEventListener('change', function () { warn.hidden = !reduceMq.matches; });
      body.appendChild(h('p', 'tp-readout', readoutText || '实测读数：点点页面上的东西试试'));
      if (incoming) body.appendChild(importCard(incoming, '链接里带来一组参数'));
      /* 参数分组 */
      groups.forEach(function (g) {
        var sec = section(g.title, function (b) { (g.params || []).forEach(function (p) { b.appendChild(row(p)); }); });
        body.appendChild(sec);
      });
      if (o.curves && o.curves.length) body.appendChild(section('弹簧曲线', curvesUi));
      if (o.playground) body.appendChild(section('试玩区', function (b) { var pg = h('div', 'tp-play'); b.appendChild(pg); try { o.playground(pg, api); } catch (e) { console.error(e); } }));
      body.appendChild(section('方案对比', slotsUi));
      body.appendChild(section('盲测', blindUi, true));
      body.appendChild(section('慢动作', slowUi, true));
      body.appendChild(section('导出 / 导入 / 定稿', exportUi));
      (o.mount || document.body).appendChild(el);
      refreshTools();
      applyUi();
    }
    function btn(text, title, fn, cls) {
      var b = h('button', 'tp-btn' + (cls ? ' ' + cls : ''), text);
      b.type = 'button'; if (title) b.title = title; b.setAttribute('aria-label', title || text);
      b.addEventListener('click', fn);
      return b;
    }
    function section(title, fill, closedByDefault) {
      var sec = h('div', 'tp-sec');
      var hd = h('button', 'tp-sec-h', title); hd.type = 'button';
      var key = title;
      if (ui.closed[key] === undefined && closedByDefault) ui.closed[key] = 1;
      if (ui.closed[key]) sec.classList.add('tp-closed');
      hd.addEventListener('click', function () { var c = sec.classList.toggle('tp-closed'); if (c) ui.closed[key] = 1; else ui.closed[key] = 0; persist(); });
      var b = h('div', 'tp-sec-b');
      sec.appendChild(hd); sec.appendChild(b);
      fill(b);
      return sec;
    }
    function fmt(p, v) { return p.type === 'range' ? Number(v).toFixed(decimals(p.step || 1)) : String(v); }
    function row(p) {
      var r = h('div', 'tp-row'); r.dataset.key = p.key;
      var top = h('div', 'tp-row-top');
      top.appendChild(h('span', 'tp-dot'));
      var name = h('span', 'tp-name', p.label || p.key); top.appendChild(name);
      var hint = null;
      if (p.hint) {
        var bi = h('button', 'tp-i', 'ⓘ'); bi.type = 'button'; bi.setAttribute('aria-label', '说明');
        bi.addEventListener('click', function () { hint.hidden = !hint.hidden; });
        top.appendChild(bi);
      }
      var ctl = h('div', 'tp-row-ctl');
      var ref = { p: p, row: r };
      if (p.type === 'range') {
        var val = h('input', 'tp-val'); val.type = 'text'; val.inputMode = 'decimal'; val.setAttribute('aria-label', p.label + '的值');
        val.addEventListener('change', function () {
          var v = parseFloat(val.value);
          if (!isFinite(v)) { val.value = fmt(p, values[p.key]); return; }
          setOne(p, v);
        });
        val.addEventListener('keydown', function (e) { if (e.key === 'Enter') val.blur(); });
        top.appendChild(val); ref.val = val;
        top.appendChild(h('span', 'tp-unit', p.unit || ''));   /* 没单位也占位：数字框才对得齐在同一列 */
        var rg = h('input', 'tp-range'); rg.type = 'range'; rg.min = p.min; rg.max = p.max; rg.step = p.step || 'any';
        rg.setAttribute('aria-label', p.label);
        rg.addEventListener('input', function () { setOne(p, parseFloat(rg.value), true); });
        rg.addEventListener('change', function () { pushHist(); });
        ref.rg = rg;
        var minus = stepper('−', p, -1), plus = stepper('＋', p, 1);
        ctl.appendChild(minus); ctl.appendChild(rg); ctl.appendChild(plus);
      } else if (p.type === 'toggle') {
        var sw = h('button', 'tp-switch'); sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-label', p.label);
        sw.addEventListener('click', function () { setOne(p, !values[p.key]); });
        top.appendChild(sw); ref.sw = sw;
      } else if (p.type === 'select') {
        var seg = h('div', 'tp-seg'); ref.opts = [];
        (p.options || []).forEach(function (op) {
          var b = btn(op, null, function () { setOne(p, op); });
          seg.appendChild(b); ref.opts.push(b);
        });
        ctl.appendChild(seg);
      }
      var rs = h('button', 'tp-reset', '↺'); rs.type = 'button'; rs.title = '恢复这一项的默认值'; rs.setAttribute('aria-label', '恢复默认');
      rs.addEventListener('click', function () { setOne(p, DEF[p.key]); });
      top.appendChild(rs);
      r.appendChild(top);
      if (ctl.childNodes.length) r.appendChild(ctl);
      if (p.hint) { hint = h('p', 'tp-hint', p.hint + '（默认 ' + fmt(p, DEF[p.key]) + (p.unit || '') + '）'); hint.hidden = true; r.appendChild(hint); }
      rowsEls.push(ref);
      paintRow(ref);
      return r;
    }
    function stepper(text, p, dir) {
      var b = btn(text, (dir > 0 ? '加' : '减') + '一格（按住连续）', function () {}, 'tp-step');
      var timer = 0, rep = 0;
      var go = function () { setOne(p, (values[p.key] || 0) + dir * (p.step || 1), true); };
      var stop = function () { clearTimeout(timer); clearInterval(rep); timer = rep = 0; pushHist(); };
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault(); go();
        timer = setTimeout(function () { rep = setInterval(go, 70); }, 380);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { b.addEventListener(t, function () { if (timer || rep) stop(); }); });
      b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); pushHist(); } });
      return b;
    }
    function setOne(p, v, fromDrag) {
      if (p.type === 'range') { var d = decimals(p.step || 1); v = clamp(Math.round(v * Math.pow(10, d)) / Math.pow(10, d), p.min, p.max); }
      values[p.key] = v;
      persist(); changed(p.key);
      rowsEls.forEach(function (ref) { if (ref.p === p) paintRow(ref, fromDrag); });
      paintCurves();
      if (!fromDrag) pushHist();
    }
    function paintRow(ref, fromDrag) {
      var p = ref.p, v = values[p.key];
      ref.row.classList.toggle('tp-changed', v !== DEF[p.key]);
      if (ref.val && document.activeElement !== ref.val) ref.val.value = fmt(p, v);
      if (ref.rg && !fromDrag) ref.rg.value = v;
      if (ref.rg && fromDrag && Number(ref.rg.value) !== v) ref.rg.value = v;
      if (ref.sw) ref.sw.setAttribute('aria-checked', v ? 'true' : 'false');
      if (ref.opts) ref.opts.forEach(function (b) { b.classList.toggle('tp-on', b.textContent === v); });
    }
    function refresh() { rowsEls.forEach(function (ref) { paintRow(ref); }); paintCurves(); paintSlots(); refreshTools(); }
    function undo() { if (histAt > 0) { histAt--; values = clean(JSON.parse(hist[histAt])); persist(); changed('*'); refresh(); } }
    function redo() { if (histAt < hist.length - 1) { histAt++; values = clean(JSON.parse(hist[histAt])); persist(); changed('*'); refresh(); } }
    function refreshTools() {
      if (!el) return;
      var bs = el.querySelectorAll('.tp-head .tp-btn');
      [].forEach.call(bs, function (b) {
        if (b.textContent === '↶') b.disabled = histAt <= 0;
        if (b.textContent === '↷') b.disabled = histAt >= hist.length - 1;
      });
    }
    function applyUi() {
      if (!el || o.mount) return;
      el.classList.toggle('tp-fold', !!ui.fold);
      el.classList.toggle('tp-top', !!ui.top);
      el.classList.toggle('tp-glass', !!ui.glass);
      el.classList.toggle('tp-sidebar', !ui.fold && o.side !== false);
      var fb = el.querySelector('.tp-foldbtn'); if (fb) fb.textContent = ui.fold ? '展开' : '收起';
      var db = el.querySelector('.tp-dock'); if (db) db.textContent = ui.top ? '移到下面' : '移到上面';
      var gb = el.querySelector('.tp-glassbtn'); if (gb) gb.classList.toggle('tp-on', !!ui.glass);
      var side = !ui.fold && o.side !== false;
      document.documentElement.classList.toggle('tp-side', side);
      document.documentElement.style.setProperty('--tp-side-w', side && innerWidth >= 1000 ? SIDE_W + 'px' : '0px');
      persist();
    }
    window.addEventListener('resize', function () { if (el && !o.mount) applyUi(); });

    /* ---------- 弹簧曲线 ---------- */
    var curveEls = [];
    function curvesUi(b) {
      o.curves.forEach(function (c) {
        var wrap = h('div');
        var cap = h('p', 'tp-note');
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'tp-curve'); svg.setAttribute('viewBox', '0 0 300 96'); svg.setAttribute('preserveAspectRatio', 'none');
        wrap.appendChild(cap); wrap.appendChild(svg); b.appendChild(wrap);
        curveEls.push({ c: c, svg: svg, cap: cap });
      });
      paintCurves();
    }
    function paintCurves() {
      curveEls.forEach(function (ce) {
        var resp = values[ce.c.resp], bounce = values[ce.c.bounce];
        if (typeof resp !== 'number' || typeof bounce !== 'number') return;
        var pts = springCurve(resp, bounce), n = pts.length, peak = Math.max.apply(null, pts);
        var T = Math.max(.6, (n - 1) / 120), top = Math.max(1.2, peak + .05);
        var d = pts.map(function (v, i) { var x = (i / 120) / T * 300, y = 90 - (v / top) * 80; return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join(' ');
        var y1 = (90 - 80 / top).toFixed(1);
        ce.svg.innerHTML = '<line x1="0" x2="300" y1="' + y1 + '" y2="' + y1 + '" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="4 4"/>' +
          '<path d="' + d + '" fill="none" stroke="#2f86f6" stroke-width="2.5" stroke-linejoin="round"/>';
        ce.cap.textContent = (ce.c.label || '弹簧') + '：冲过头 ' + Math.max(0, (peak - 1) * 100).toFixed(1) + '%，约 ' + Math.round((n - 1) / 120 * 1000) + ' 毫秒停稳（虚线＝目标位置）';
      });
    }

    /* ---------- 方案对比（A/B/C…） ---------- */
    var slotsBox = null, abLast = [];
    function slotsUi(b) {
      b.appendChild(h('p', 'tp-note', '把当前参数存成一个方案，点名字就切过去；存两个以上就能「AB 来回切」边切边点同一个按钮比。'));
      slotsBox = h('div', 'tp-chips'); b.appendChild(slotsBox);
      var nameIn = h('input', 'tp-input'); nameIn.placeholder = '方案名字（如：Q 一点）'; nameIn.maxLength = 12;
      var acts = h('div', 'tp-acts');
      acts.appendChild(btn('存为新方案', null, function () {
        var name = nameIn.value.trim() || ('方案 ' + String.fromCharCode(65 + slots.length % 26));
        var s = { id: uid(), name: name, values: api.values() };
        slots.push(s); activeSlot = s.id; nameIn.value = ''; persist(); paintSlots();
      }, 'tp-pri'));
      acts.appendChild(btn('覆盖当前方案', '把现在的参数存进正在用的方案', function () {
        var s = slots.filter(function (x) { return x.id === activeSlot; })[0];
        if (s) { s.values = api.values(); persist(); paintSlots(); }
      }));
      acts.appendChild(btn('AB 来回切', '在最近用过的两个方案之间切换', function () {
        if (abLast.length < 2) { var others = slots.filter(function (x) { return x.id !== activeSlot; }); if (!others.length) return; useSlot(others[0].id); return; }
        useSlot(abLast[abLast.length - 2]);
      }));
      b.appendChild(nameIn); b.appendChild(acts);
      paintSlots();
    }
    function useSlot(id) {
      var s = slots.filter(function (x) { return x.id === id; })[0];
      if (!s) return;
      activeSlot = id;
      abLast = abLast.filter(function (x) { return x !== id; }); abLast.push(id); if (abLast.length > 2) abLast.shift();
      setAll(s.values, 'slot');
    }
    function paintSlots() {
      if (!slotsBox) return;
      slotsBox.innerHTML = '';
      if (!slots.length) { slotsBox.appendChild(h('span', 'tp-note', '还没有方案')); return; }
      slots.forEach(function (s) {
        var chip = h('span', 'tp-chip' + (s.id === activeSlot ? ' tp-active' : ''));
        chip.appendChild(btn(s.name, '切到这个方案', function () { useSlot(s.id); }));
        chip.appendChild(btn('✕', '删掉这个方案', function () { slots = slots.filter(function (x) { return x.id !== s.id; }); if (activeSlot === s.id) activeSlot = null; persist(); paintSlots(); }));
        slotsBox.appendChild(chip);
      });
    }

    /* ---------- 盲测：两套方案打乱、不告诉你哪个是哪个，凭感觉选 ---------- */
    function blindUi(b) {
      var box = h('div'); b.appendChild(box);
      var st = null;
      function idle() {
        box.innerHTML = '';
        box.appendChild(h('p', 'tp-note', '先在「方案对比」里存好两个方案。开始后每一轮随机把它们叫做「1」「2」，你来回切着试，选觉得更好的那个；5 轮后告诉你更偏哪个——避免「知道是大的那套就觉得大的好」。'));
        var acts = h('div', 'tp-acts'); box.appendChild(acts);
        acts.appendChild(btn('开始盲测', null, function () {
          if (slots.length < 2) { box.querySelector('.tp-note').textContent = '至少要存两个方案才能盲测。'; return; }
          var pair = activeSlot && slots.length > 2 ? [activeSlot, slots.filter(function (x) { return x.id !== activeSlot; })[0].id] : [slots[0].id, slots[1].id];
          st = { pair: pair, round: 0, wins: {}, back: api.values(), backSlot: activeSlot }; st.wins[pair[0]] = 0; st.wins[pair[1]] = 0;
          next();
        }, 'tp-pri'));
      }
      function next() {
        st.round++;
        st.map = Math.random() < .5 ? [st.pair[0], st.pair[1]] : [st.pair[1], st.pair[0]];
        box.innerHTML = '';
        box.appendChild(h('p', 'tp-blind-q', '第 ' + st.round + ' / 5 轮：先试 1、再试 2，来回比'));
        var acts = h('div', 'tp-acts'); box.appendChild(acts);
        [0, 1].forEach(function (i) {
          acts.appendChild(btn('试 ' + (i + 1), null, function () {
            var s = slots.filter(function (x) { return x.id === st.map[i]; })[0]; values = clean(s.values); changed('blind'); refresh();
            [].forEach.call(acts.children, function (c, j) { c.classList.toggle('tp-on', j === i); });
          }));
        });
        var pick = h('div', 'tp-acts'); box.appendChild(pick);
        [0, 1].forEach(function (i) {
          pick.appendChild(btn((i + 1) + ' 更好', null, function () {
            st.wins[st.map[i]]++;
            if (st.round >= 5) done(); else next();
          }, 'tp-pri'));
        });
        pick.appendChild(btn('结束', null, done));
      }
      function done() {
        var name = function (id) { return (slots.filter(function (x) { return x.id === id; })[0] || {}).name; };
        var a = st.pair[0], b2 = st.pair[1], wa = st.wins[a], wb = st.wins[b2];
        values = clean(st.back); activeSlot = st.backSlot; persist(); changed('blind'); refresh();
        box.innerHTML = '';
        box.appendChild(h('p', 'tp-blind-q', '结果：「' + name(a) + '」' + wa + ' 次，「' + name(b2) + '」' + wb + ' 次' + (wa === wb ? '——分不出高下，差别可能太小' : '——你更偏「' + (wa > wb ? name(a) : name(b2)) + '」')));
        var acts = h('div', 'tp-acts'); box.appendChild(acts);
        if (wa !== wb) acts.appendChild(btn('用「' + (wa > wb ? name(a) : name(b2)) + '」', null, function () { useSlot(wa > wb ? a : b2); idle(); }, 'tp-pri'));
        acts.appendChild(btn('再测一次', null, idle));
        st = null;
      }
      idle();
    }

    /* ---------- 慢动作 ---------- */
    function slowUi(b) {
      b.appendChild(h('p', 'tp-note', '把页面上所有动画放慢，看清楚「鼓起来—弹回去」到底长什么样。调参时记得切回 1×。'));
      var seg = h('div', 'tp-seg'); b.appendChild(seg);
      [[1, '1×'], [.5, '½×'], [.25, '¼×'], [.1, '1/10×']].forEach(function (k) {
        var bb = btn(k[1], null, function () { setSlow(k[0]); [].forEach.call(seg.children, function (c) { c.classList.toggle('tp-on', c === bb); }); });
        if (k[0] === slow) bb.classList.add('tp-on');
        seg.appendChild(bb);
      });
      b.appendChild(h('p', 'tp-note', '只管得到浏览器自己的动画（CSS 过渡 / 动画、WAAPI）；项目里用 requestAnimationFrame 自己算的（如惯性滚动）要乘 tp.timeScale()。'));
    }

    /* ---------- 导出 / 导入 / 定稿 ---------- */
    function exportUi(b) {
      var out = h('textarea', 'tp-textarea'); out.readOnly = true; out.hidden = true;
      var qrImg = h('img', 'tp-qr'); qrImg.alt = '参数链接的二维码'; qrImg.hidden = true;
      var msg = h('p', 'tp-note', '');
      function show(text, note) { out.hidden = false; out.value = text; msg.textContent = note || ''; }
      function copy(text, note) {
        show(text, note);
        var ok = function () { msg.textContent = '已复制 ✓  ' + (note || ''); };
        var fail = function () { out.focus(); out.select(); msg.textContent = '复制不了：已经选中下面这段，手动复制。' + (note || ''); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fail); else fail();
      }
      var acts = h('div', 'tp-acts'); b.appendChild(acts);
      acts.appendChild(btn('复制参数', '带项目名、版本、设备、改了哪些', function () { copy(JSON.stringify(exportObj(), null, 1), '发给我就行'); }, 'tp-pri'));
      acts.appendChild(btn('复制链接', '别人打开这个链接就是这组参数', function () { copy(shareLink(), '打开这个链接会先问要不要用这组参数'); }));
      acts.appendChild(btn('二维码', '手机和电脑之间传', function () {
        var link = shareLink();
        var draw = function () {
          try { var qr = root.qrcode(0, 'L'); qr.addData(link); qr.make(); qrImg.src = qr.createDataURL(5, 2); qrImg.hidden = false; msg.textContent = '另一台设备扫这个码，就打开这组参数'; }
          catch (e) { msg.textContent = '链接太长，生成不了二维码；用「复制链接」。'; }
        };
        if (typeof root.qrcode === 'function') draw();
        else {
          var sc = document.createElement('script'); sc.src = o.qrSrc || 'qrcode.js';
          sc.onload = draw; sc.onerror = function () { msg.textContent = '二维码库没加载到（' + sc.src + '）；用「复制链接」。'; };
          document.head.appendChild(sc);
        }
      }));
      acts.appendChild(btn('定稿', '生成可以直接写进代码的默认值', function () {
        var d = device();
        var code = '/* 用户真机调定 ' + today() + ' · ' + d.os + ' ' + d.ver + ' ' + d.browser + ' ' + d.screen + '@' + d.dpr + 'x · ' + project + ' ' + version + ' */\n' +
          'var ' + (o.finalName || 'TUNE_DEFAULT') + ' = ' + JSON.stringify(api.values(), null, 2) + ';';
        copy(code, '这段可以直接替换代码里的默认值');
      }));
      acts.appendChild(btn('全部恢复默认', null, function () { setAll(DEF, 'reset'); activeSlot = null; persist(); paintSlots(); msg.textContent = '已恢复默认（方案还在）'; }));
      b.appendChild(msg); b.appendChild(qrImg); b.appendChild(out);
      /* 粘贴导入 */
      var inp = h('textarea', 'tp-textarea'); inp.placeholder = '把别人发来的参数（复制参数的那段，或者链接）粘贴到这里';
      var imp = h('div'); b.appendChild(inp);
      var acts2 = h('div', 'tp-acts'); b.appendChild(acts2); b.appendChild(imp);
      acts2.appendChild(btn('导入', null, function () {
        var t = inp.value.trim(), vals = null;
        var m = /[#&]tune=([A-Za-z0-9\-_]+)/.exec(t);
        try {
          if (m) { var d = JSON.parse(unb64url(m[1])); vals = d.values; }
          else { var j = JSON.parse(t); vals = j.values || j; }
        } catch (e) { vals = null; }
        imp.innerHTML = '';
        if (!vals || typeof vals !== 'object') { imp.appendChild(h('p', 'tp-note', '看不懂这段内容：要粘贴「复制参数」或「复制链接」得到的那段。')); return; }
        imp.appendChild(importCard(clean(vals), '粘贴进来的参数'));
      }));
    }
    function importCard(vals, title) {
      var card = h('div', 'tp-card');
      card.appendChild(h('p', 'tp-blind-q', title + '：会改这些'));
      var ul = h('ul', 'tp-diff'), n = 0;
      params.forEach(function (p) {
        if (vals[p.key] === values[p.key]) return;
        n++; ul.appendChild(h('li', '', (p.label || p.key) + '：' + fmt(p, values[p.key]) + ' → ' + fmt(p, vals[p.key]) + (p.unit || '')));
      });
      if (!n) ul.appendChild(h('li', '', '和现在一模一样，不用改'));
      card.appendChild(ul);
      var acts = h('div', 'tp-acts');
      acts.appendChild(btn('用这组', null, function () { setAll(vals, 'import'); card.remove(); }, 'tp-pri'));
      acts.appendChild(btn('不用', null, function () { card.remove(); }));
      card.appendChild(acts);
      return card;
    }

    /* 界面放在最后才画：上面那些 var（rowsEls、curveEls、slotsBox…）要先初始化好，提前画会拿到 undefined */
    if (o.mount || o.activate === 'always' || wantQuery || incoming) build();
    return api;
  }

  TunePanel.owns = function (t) { for (var i = 0; i < ALL.length; i++) if (ALL[i].owns(t)) return true; return false; };
  TunePanel.springCurve = springCurve;
  TunePanel.version = VERSION;
  root.TunePanel = TunePanel;
})(typeof window !== 'undefined' ? window : globalThis);
