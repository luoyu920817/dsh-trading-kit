/**
 * 探针页 HTML 常量（spike-tdx-embed tasks 1.3/1.4；design D-2/D-6）。
 * 形态定案 = 内联 TS 模板字符串（评审 Issue 7）：随既有 entry 的模块图经
 * tsdown 编译进 lib/**，无拷贝步骤；`package.json#files` 已含 `lib`。
 *
 * 语法上限 = 现网基线页已证级别（ES2017 + Fetch + Promise，design Context
 * 「已证下限」）：内联脚本 MUST NOT 使用 ES module / 可选链 / 空值合并 /
 * async / await / 模板字符串；页面离线自包含——无任何 `http(s)://` 外链、
 * 不发起任何网络请求（fetch 仅作为 typeof 特性探测对象出现，不调用）。
 *
 * 服务端注入（D-2）：`__PROBE_STATE_JSON__` 占位符由 src/routes/probe.ts 的
 * `injectProbeState` 按请求替换为 JSON 序列化 + 转义后的
 * `window.__PROBE__ = { auth, status, port, basePath, injectedAt }`；拒绝态
 * 不设枚举取值（handler 首行即 401/403 结束，页面不渲染）。
 *
 * 点击联动探测（D-6，写法上限 6 种，MUST NOT 扩写）：普通 onclick、
 * element.click()、手动 dispatchEvent(MouseEvent)、window.open、postMessage、
 * location.hash 变更。页面侧只记录「写法 + 调用返回值/isTrusted」；TDX 侧
 * 是否切换标的 = 人工核对项（该维度未获确认不得记「可行」）。
 */
import { parseProbeParams } from './params.ts'

/** `window.__PROBE__` 注入占位符（handler 全量替换，页面模板中恰出现一次）。 */
export const PROBE_STATE_PLACEHOLDER = '__PROBE_STATE_JSON__'

/**
 * 探针页标记（构建产物断言用；test/probe 以该串断言 lib/** 内探针页存在）。
 */
export const PROBE_PAGE_MARKER = 'dsh-trader-kit-probe-page'

export const PROBE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-trader-kit 探针页</title>
<!-- ${PROBE_PAGE_MARKER}: 离线自包含单文件探针页（spike-tdx-embed）。无外链、无网络请求、无框架。 -->
<style>
  body { font-family: sans-serif; margin: 12px; background: #ffffff; color: #222222; }
  h1 { font-size: 18px; margin: 4px 0 10px; }
  h2 { font-size: 15px; margin: 16px 0 6px; border-bottom: 1px solid #dddddd; padding-bottom: 4px; }
  pre { background: #f5f5f5; border: 1px solid #dddddd; padding: 8px; white-space: pre-wrap; word-break: break-all; font-size: 12px; margin: 4px 0; }
  button { margin: 2px 4px 2px 0; padding: 4px 8px; font-size: 13px; }
  input { padding: 4px; width: 220px; font-size: 13px; }
  ol { padding-left: 20px; }
  li { margin: 2px 0; font-size: 12px; }
  .muted { color: #777777; font-size: 12px; }
</style>
</head>
<body>
<h1>dsh-trader-kit · TDX 内嵌浏览器探针页</h1>

<h2>服务端注入状态（由服务端注入，非页面自证）</h2>
<pre id="probe-state">loading...</pre>

<h2>自检输出</h2>
<pre id="probe-selfcheck">loading...</pre>
<p class="muted">本行可见 = 页面脚本执行成功，即本页所用语法（ES2017 + Fetch + Promise 基线内）在当前内核可解析；API 可用性见上方「typeof」探测，不做语法 eval 探测。</p>

<h2>传参形态（优先级 hash → query → path 段；原样记录、不静默修正、非法不回退）</h2>
<pre id="probe-params">loading...</pre>

<h2>输入框（验证切换标的不丢输入）</h2>
<p>
  <input id="probe-input" type="text" value="" placeholder="随便输入内容，再切换 hash 验证不丢失">
  <span id="probe-input-echo" class="muted"></span>
</p>

<h2>hashchange 时间线（变化计数 + 时间 + 解析结果）</h2>
<ol id="probe-hash-log"></ol>

<h2>点击联动测试（6 种写法；TDX 侧是否切换标的 = 人工核对项）</h2>
<p class="muted">页面侧记录每次「写法 + 调用返回值 / isTrusted」；TDX 侧响应（是否切标的）由 owner 目视确认后记入报告，未获确认该维度记 UNKNOWN。</p>
<p>
  <button type="button" data-probe-way="1" onclick="probeLinkWay(1)">写法1 · 普通 onclick</button>
  <button type="button" data-probe-way="2" id="probe-way-2">写法2 · element.click()</button>
  <button type="button" id="probe-way-2-target">写法2 目标元素</button>
  <button type="button" data-probe-way="3" id="probe-way-3">写法3 · dispatchEvent</button>
  <button type="button" id="probe-way-3-target">写法3 目标元素</button>
  <button type="button" data-probe-way="4" id="probe-way-4">写法4 · window.open</button>
  <button type="button" data-probe-way="5" id="probe-way-5">写法5 · postMessage</button>
  <button type="button" data-probe-way="6" id="probe-way-6">写法6 · location.hash</button>
</p>
<ol id="probe-link-log"></ol>

<script>
window.__PROBE__ = ${PROBE_STATE_PLACEHOLDER};
</script>
<script>
(function () {
  'use strict';

  // 传参解析与 test/probe 单测同一实现：src/client/probe/params.ts 运行时序列化内联于此。
  var parseProbeParams = ${parseProbeParams};

  var state = window.__PROBE__ || null;
  var routePath = (state && state.basePath ? state.basePath : '/dsh-trader-kit') + '/probe';
  var input = document.getElementById('probe-input');

  function byId(id) { return document.getElementById(id); }
  function textOf(value) { return value === null || value === undefined ? '(缺)' : String(value); }

  function currentParams() {
    return parseProbeParams(location.hash, location.search, location.pathname, routePath);
  }

  function renderState() {
    var lines = [];
    if (state) {
      lines.push('window.__PROBE__ = ' + JSON.stringify(state));
      lines.push('auth: ' + textOf(state.auth) + '（cookie=A 层两步登录 / diagnostic-token=B 层插件自有诊断 token）');
    } else {
      lines.push('window.__PROBE__ 未注入——本响应可能不是探针路由 handler 产生');
    }
    lines.push('注：本块由服务端按请求注入，非页面自证（cookie 为 HttpOnly，页面 JS 读不到认证态）。');
    byId('probe-state').textContent = lines.join('\\n');
  }

  function probeFeature(name) {
    try {
      var parts = name.split('.');
      var cursor = window;
      var i;
      for (i = 0; i < parts.length; i++) {
        if (cursor === null || cursor === undefined) { return 'undefined'; }
        cursor = cursor[parts[i]];
      }
      return typeof cursor;
    } catch (e) {
      return '探测异常: ' + e;
    }
  }

  function renderSelfCheck() {
    var lines = [];
    lines.push('href: ' + location.href);
    lines.push('host: ' + location.host + '  port: ' + location.port);
    lines.push('pathname: ' + location.pathname);
    lines.push('search: ' + textOf(location.search));
    lines.push('hash: ' + textOf(location.hash));
    lines.push('userAgent: ' + navigator.userAgent);
    lines.push('页面加载时间戳(boot): ' + new Date().toISOString());
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      lines.push('performance.now(脚本执行时刻): ' + String(performance.now()));
    }
    lines.push('document.readyState: ' + document.readyState);
    lines.push('内核特性探测（typeof）:');
    var names = ['Promise', 'fetch', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'URLSearchParams', 'JSON', 'Object.assign', 'Array.prototype.includes', 'performance.now', 'navigator.sendBeacon'];
    var i;
    for (i = 0; i < names.length; i++) {
      lines.push('  ' + names[i] + ' = ' + probeFeature(names[i]));
    }
    byId('probe-selfcheck').textContent = lines.join('\\n');
  }

  function describeParams(p) {
    var lines = [];
    lines.push('hash 原值: ' + (p.hashRaw === '' ? '（缺）' : p.hashRaw));
    lines.push('query 原值(code): ' + (p.queryRaw === '' ? '（缺）' : p.queryRaw));
    lines.push('path 段原值: ' + (p.pathRaw === '' ? '（缺）' : p.pathRaw));
    lines.push('非空形态（按优先级）: ' + (p.presentForms.length === 0 ? '（无）' : p.presentForms.join(' → ')));
    if (p.resolvedForm === null || p.resolvedValue === null) {
      lines.push('取值: 显式空态——三类传参均缺失，不显示任何推测标的');
    } else if (p.valid) {
      lines.push('取值: ' + p.resolvedValue + '（取自「' + p.resolvedForm + '」，合法 6 位，前导零保留）');
    } else {
      lines.push('取值: ' + p.resolvedValue + '（取自「' + p.resolvedForm + '」，非法——非 6 位数字，原样记录不猜测补全）');
    }
    return lines.join('\\n');
  }

  function renderParams() {
    byId('probe-params').textContent = describeParams(currentParams());
  }

  function renderInputEcho() {
    byId('probe-input-echo').textContent = '当前输入框内容(' + input.value.length + ' 字符): ' + input.value;
  }

  function addLog(listId, text) {
    var li = document.createElement('li');
    li.textContent = '[' + new Date().toISOString() + '] ' + text;
    byId(listId).appendChild(li);
  }

  var hashChangeCount = 0;
  window.addEventListener('hashchange', function (ev) {
    hashChangeCount += 1;
    var oldUrl = typeof ev.oldURL === 'string' ? ev.oldURL : '(不可用)';
    var newUrl = typeof ev.newURL === 'string' ? ev.newURL : '(不可用)';
    var p = currentParams();
    var resolved = p.resolvedValue === null ? '(空态)' : p.resolvedValue + (p.valid ? '(合法)' : '(非法)');
    addLog('probe-hash-log', 'hashchange #' + hashChangeCount + ' | ' + oldUrl + ' → ' + newUrl + ' | 解析结果: ' + resolved + ' | 输入框快照: "' + input.value + '"');
    renderParams();
  });

  // ── 点击联动探测（D-6：恰好 6 种写法，MUST NOT 扩写）──────────────────

  function logWay(n, detail) {
    addLog('probe-link-log', '写法' + n + ' | ' + detail);
  }

  // 写法 1：普通 onclick（HTML 内联属性；handler 为全局函数）。
  window.probeLinkWay = function (n) {
    logWay(n, 'onclick 内联属性已触发，页面侧调用正常');
  };

  // 写法 2：element.click()（程序化点击目标元素；isTrusted=false 属预期证据）。
  document.getElementById('probe-way-2').addEventListener('click', function () {
    document.getElementById('probe-way-2-target').click();
  });
  document.getElementById('probe-way-2-target').addEventListener('click', function (ev) {
    logWay(2, 'element.click() 派发 click 事件, isTrusted=' + ev.isTrusted);
  });

  // 写法 3：手动 dispatchEvent(new MouseEvent(...))。
  document.getElementById('probe-way-3').addEventListener('click', function () {
    var ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('probe-way-3-target').dispatchEvent(ev);
  });
  document.getElementById('probe-way-3-target').addEventListener('click', function (ev) {
    logWay(3, 'dispatchEvent(MouseEvent) 已派发, isTrusted=' + ev.isTrusted);
  });

  // 写法 4：window.open（记录返回值；返回 null = 被拦截或未响应）。
  document.getElementById('probe-way-4').addEventListener('click', function () {
    var result;
    try {
      var opened = window.open(location.href.split('#')[0] + '#probe-way-4', '_blank');
      result = opened ? '返回 Window 对象（未被拦截）' : '返回 null（被拦截或未响应）';
    } catch (e) {
      result = '调用异常: ' + e;
    }
    logWay(4, 'window.open ' + result);
  });

  // 写法 5：postMessage（页面内回环探测；同时记录 TDX 侧主动发来的 message）。
  window.addEventListener('message', function (ev) {
    var data = '(不可序列化)';
    try { data = JSON.stringify(ev.data); } catch (e) { /* 保留占位 */ }
    logWay(5, '收到 message 事件, origin=' + ev.origin + ', data=' + data);
  });
  document.getElementById('probe-way-5').addEventListener('click', function () {
    var result;
    try {
      var target = location.origin ? location.origin : '*';
      window.postMessage({ from: 'dsh-trader-kit-probe', way: 5, at: new Date().toISOString() }, target);
      result = '已发送（等待 message 回环记录）';
    } catch (e) {
      result = '调用异常: ' + e;
    }
    logWay(5, 'postMessage ' + result);
  });

  // 写法 6：location.hash 变更（取输入框内容为值；hashchange 时间线记录该变化）。
  document.getElementById('probe-way-6').addEventListener('click', function () {
    var value = input.value !== '' ? input.value : 'probe-way-6';
    logWay(6, 'location.hash 置为 "#' + value + '"（变化见 hashchange 时间线）');
    location.hash = '#' + value;
  });

  // ── 启动渲染 ─────────────────────────────────────────────────────────
  renderState();
  renderSelfCheck();
  renderParams();
  renderInputEcho();
  input.addEventListener('input', renderInputEcho);
  addLog('probe-hash-log', '页面 boot（加载时间戳见自检输出）；hashchange 计数从 0 起。若该行重现且计数归零 = 页面发生了重载（P1 传参判据的反证）');
})();
</script>
</body>
</html>
`
