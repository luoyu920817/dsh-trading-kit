/**
 * 复盘页 HTML 常量（change 4 review-page tasks 4.1–4.8；design D-2 内联定案①）。
 * 形态定案 = 内联 TS 模板字符串：随 entry 模块图经 tsdown 编译进 lib/**，无拷贝
 * 步骤；`package.json#files` 已含 `lib`（构建断言见 test/routes-review/review-build.test.ts）。
 *
 * 语法上限（spike 实测内核 = Chromium 81 级，docs/spikes/tdx-embed.md）：ES2017 +
 * Fetch + Promise 的保守子集——内联脚本 MUST NOT 使用 ES module / 可选链（?.）/
 * 空值合并（??）/ 模板字符串 / async / await；用 var/function/then 链。
 * 离线自包含：无任何 http(s):// 外链字面（「在 TDX 中打开标的」的 treeid 导航在
 * JS 内以拼接构造——'http' + '://www.treeid/code_<代码>'，spike 决策第 1 条）；
 * 网络请求仅同源 /review/api/*（本地段与网络段独立 fetch，首屏 MUST NOT await 网络段）。
 *
 * 服务端注入（D-3）：`__REVIEW_STATE_JSON__` 占位符由 src/routes/review.ts 的
 * `injectReviewState` 按请求替换为 `window.__REVIEW__ = { writable, basePath,
 * routePath, injectedAt }`；`writable === false`（C 层签字只读分支）时 B3 降级为
 * 禁用态 + 提示 DSH 侧写卡（spike 决策第 3 条：A 层在 TDX 内未验证存活）。
 *
 * 四区块（spec「四区块布局」）：B1 标的头部（代码+名称分层+标签+涨停原因+treeid）、
 * B2 日期（默认归属交易日+待确认显式确认）、B3 输入+保存+预留工具框（disabled +
 * tabindex="-1"）、B4 当日卡片（时间倒序+纯文本转义+复制 block 引用+warnings 展示）。
 */
import { parseReviewParams } from './params.ts'

/** `window.__REVIEW__` 注入占位符（handler 全量替换，页面模板中恰出现一次）。 */
export const REVIEW_STATE_PLACEHOLDER = '__REVIEW_STATE_JSON__'

/** 构建产物断言标记（test/routes-review/review-build.test.ts 以该串断言 lib 内页面存在）。 */
export const REVIEW_PAGE_MARKER = 'dsh-trader-kit-review-page'

export const REVIEW_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-trader-kit 复盘卡片</title>
<!-- ${REVIEW_PAGE_MARKER}: 离线自包含单文件复盘页（review-page）。无外链、无第三方资源；请求仅同源 /review/api/*。 -->
<style>
  * { box-sizing: border-box; }
  body { font-family: sans-serif; margin: 8px; background: #ffffff; color: #222222; font-size: 14px; max-width: 100%; overflow-x: hidden; }
  h1 { font-size: 16px; margin: 2px 0 8px; }
  section { border: 1px solid #dddddd; border-radius: 4px; padding: 8px; margin: 0 0 8px; max-width: 100%; overflow-wrap: anywhere; }
  #rv-code-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
  #rv-code { font-size: 18px; font-weight: bold; word-break: break-all; }
  #rv-name { color: #555555; }
  .muted { color: #777777; font-size: 12px; }
  .warnbox { background: #fff7e0; border: 1px solid #e0c060; padding: 4px 6px; margin: 4px 0; font-size: 12px; overflow-wrap: anywhere; }
  input[type="date"] { padding: 4px; font-size: 14px; max-width: 100%; }
  textarea { width: 100%; min-height: 72px; font-size: 14px; padding: 4px; resize: vertical; }
  button { padding: 4px 10px; font-size: 14px; }
  .card { border-top: 1px solid #eeeeee; padding: 6px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .card-head { font-size: 12px; color: #666666; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
  a { color: #1a4d8f; overflow-wrap: anywhere; }
</style>
</head>
<body>
<h1>复盘卡片</h1>

<section id="rv-b1">
  <div id="rv-code-line">
    <span id="rv-code">—</span>
    <span id="rv-name" class="muted"></span>
    <a id="rv-treeid" href="#" tabindex="-1" style="display:none">在 TDX 中打开标的</a>
  </div>
  <div id="rv-concepts" class="muted"></div>
  <div id="rv-limit" class="muted"></div>
  <div id="rv-owner-confirm" class="warnbox" style="display:none"></div>
  <div id="rv-owner-actions" style="display:none"><button type="button" id="rv-confirm-owner"></button></div>
</section>

<section id="rv-b2">
  <label for="rv-date">交易日</label>
  <input type="date" id="rv-date" value="">
  <span id="rv-trade-state" class="muted"></span>
  <label id="rv-confirm-row" for="rv-confirm-date" style="display:none">
    <input type="checkbox" id="rv-confirm-date"> 确认归属该交易日（待确认态，保存前须勾选）
  </label>
</section>

<section id="rv-b3">
  <textarea id="rv-input" placeholder="盘面观察 / 操作思路…（Ctrl+Enter 保存）"></textarea>
  <div>
    <button type="button" id="rv-save">保存</button>
    <span id="rv-status" class="muted"></span>
  </div>
  <div class="muted">工具框（预留，v1 无业务按钮）：<button type="button" id="rv-reserve" disabled tabindex="-1">预留按钮</button></div>
  <div id="rv-readonly-hint" class="warnbox" style="display:none">写卡不可用：A 层认证未生效——请在 DSH 会话侧写卡，或先经登录 URL 完成两步登录。</div>
</section>

<section id="rv-b4">
  <div id="rv-warnings"></div>
  <div id="rv-cards"></div>
  <div id="rv-empty" class="muted"></div>
</section>

<script>
window.__REVIEW__ = ${REVIEW_STATE_PLACEHOLDER};
</script>
<script>
(function () {
  'use strict';

  // 传参解析与 test/routes-review 单测同一实现：src/client/review/params.ts 运行时序列化内联于此。
  var parseReviewParams = ${parseReviewParams};

  var state = window.__REVIEW__ || {};
  var basePath = typeof state.basePath === 'string' && state.basePath !== '' ? state.basePath : '/dsh-trader-kit';
  var routePath = basePath + '/review';
  var writable = state.writable !== false; // 注入缺失时按可写处理（正常分支恒注入）

  // ── 页面状态（交互态五态：idle / loading / submitting / error / empty）──────
  var mode = 'idle';
  var currentCode = null;        // 归一后的当前标的（null = 无有效标的）
  var currentRaw = null;         // 原始取值（排障展示）
  var currentDate = null;        // 正在查看的交易日（YYYY-MM-DD 或 null）
  var datePicked = false;        // 用户显式选择过日期 = 归属已确认
  var nameLocal = null;          // 本地段名称层 {value, nameSource}
  var enrichName = null;         // 网络段层②补位 {name, source}（仅 code-only 时消费）
  var lastLocal = null;          // 最近一次 /api/local 响应
  var draftOwnerCode = null;     // 输入的来源标的（首次输入时固化，D-11）
  var pendingOwner = null;       // 联动切换未确认 {from, to}
  var pendingRequestId = null;   // 提交意图标识（失败重试复用同一 id）
  var enrichGen = 0;             // 网络段代际（切换即作废在途响应）
  var enrichController = null;   // 网络段 AbortController
  var composing = false;         // 输入法组合期

  function byId(id) { return document.getElementById(id); }
  function trim(v) { return v.replace(/^\\s+|\\s+$/g, ''); }

  function apiUrl(path, params) {
    var url = basePath + path;
    var pairs = [];
    for (var key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key) && params[key] !== null && params[key] !== undefined && params[key] !== '') {
        pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])));
      }
    }
    return pairs.length === 0 ? url : url + '?' + pairs.join('&');
  }

  function fetchJson(url, options) {
    return fetch(url, options).then(function (resp) {
      return resp.json().then(function (body) {
        return { status: resp.status, body: body };
      });
    });
  }

  function setStatus(text) { byId('rv-status').textContent = text || ''; }

  function setMode(next, message) {
    mode = next;
    var save = byId('rv-save');
    if (next === 'submitting') { save.disabled = true; setStatus('保存中…'); return; }
    if (next === 'loading') { save.disabled = true; setStatus('加载中…'); return; }
    save.disabled = !writable;
    if (next === 'error') setStatus(message || '出错');
    else setStatus('');
  }

  // ── B1 渲染 ─────────────────────────────────────────────────────────────
  function updateNameLine() {
    var el = byId('rv-name');
    var effective = null;
    var sourceText = '';
    if (nameLocal !== null && nameLocal.value !== null && nameLocal.value !== '') {
      // 层①命中：网络段（层②）MUST NOT 覆盖（§12.4）。
      effective = nameLocal.value;
      sourceText = nameLocal.nameSource === 'frontmatter-history' ? '本地历史 frontmatter' : '仅代码';
    } else if (enrichName !== null && enrichName.name) {
      // 层②补位：仅当本地段为 code-only。
      effective = enrichName.name;
      sourceText = enrichName.source;
    }
    if (currentCode === null) { el.textContent = ''; return; }
    if (effective !== null) el.textContent = effective + '（' + sourceText + '）';
    else el.textContent = '名称未获取';
  }

  function renderB1() {
    var codeEl = byId('rv-code');
    if (currentCode !== null) codeEl.textContent = currentCode;
    else if (currentRaw !== null && currentRaw !== '') codeEl.textContent = '收到「' + currentRaw + '」';
    else codeEl.textContent = '—';
    var link = byId('rv-treeid');
    if (currentCode !== null) {
      // 正向联动通道（spike 决策①）：treeid 导航；URL 以拼接构造，模板零外链字面。
      link.style.display = '';
      link.setAttribute('href', 'http' + '://www.treeid/code_' + currentCode);
    } else {
      link.style.display = 'none';
      link.setAttribute('href', '#');
    }
    byId('rv-concepts').textContent = '';
    byId('rv-limit').textContent = '';
    updateNameLine();
  }

  function showOwnerConfirm() {
    var box = byId('rv-owner-confirm');
    var actions = byId('rv-owner-actions');
    var btn = byId('rv-confirm-owner');
    box.style.display = '';
    actions.style.display = '';
    box.textContent = '未提交内容属于 ' + pendingOwner.from + '（将写入 ' + pendingOwner.to + '）——确认后方可提交到新标的';
    btn.textContent = '确认归属到 ' + pendingOwner.to;
  }

  function hideOwnerConfirm() {
    byId('rv-owner-confirm').style.display = 'none';
    byId('rv-owner-actions').style.display = 'none';
  }

  // ── B2 渲染 ─────────────────────────────────────────────────────────────
  function needDateConfirm() {
    if (datePicked) return false; // 用户显式选择日期 = 一次显式确认
    var td = lastLocal !== null ? lastLocal.tradeDate : null;
    if (td === null || td === undefined || td.value === null || td.isTradingDay !== true) return true;
    return false;
  }

  function renderTradeState() {
    var el = byId('rv-trade-state');
    if (currentCode === null) { el.textContent = ''; byId('rv-confirm-row').style.display = 'none'; return; }
    var td = lastLocal !== null ? lastLocal.tradeDate : null;
    if (lastLocal !== null && lastLocal.dateSource === 'requested' && lastLocal.date) {
      el.textContent = '查看日期：' + lastLocal.date;
    } else if (td !== null && td !== undefined && td.value !== null && td.value !== undefined) {
      if (td.isTradingDay === true) el.textContent = '归属交易日 ' + td.value + '（来源 ' + td.source + '）';
      else el.textContent = '归属待确认：' + td.value + '（来源 ' + td.source + '）——保存前请勾选确认';
    } else {
      el.textContent = '归属待确认：交易日不可得——请在 B2 显式选择日期';
    }
    var need = needDateConfirm();
    byId('rv-confirm-row').style.display = need ? '' : 'none';
    if (!need) byId('rv-confirm-date').checked = false;
  }

  // ── B4 渲染（时间倒序 + 纯文本转义 + 复制 block 引用）───────────────────
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done(ok);
  }

  function copyText(text, done) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallbackCopy(text, done); });
      return;
    }
    fallbackCopy(text, done);
  }

  function makeCopyButton(anchor) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = '复制引用';
    b.addEventListener('click', function () {
      copyText('^' + anchor, function (ok) {
        setStatus(ok ? '已复制 ^' + anchor : '复制失败（可手动选择锚点文本）');
      });
    });
    return b;
  }

  function makeCardNode(card) {
    var div = document.createElement('div');
    div.className = 'card';
    var head = document.createElement('div');
    head.className = 'card-head';
    var meta = document.createElement('span');
    meta.textContent = (card.writtenAt || '') + '  ^' + (card.anchor || '');
    head.appendChild(meta);
    if (card.anchor) head.appendChild(makeCopyButton(card.anchor));
    var bodyEl = document.createElement('div');
    bodyEl.textContent = card.body || ''; // 纯文本转义：textContent（标签字符不被解析）
    div.appendChild(head);
    div.appendChild(bodyEl);
    return div;
  }

  function renderWarnings(warnings) {
    var wrap = byId('rv-warnings');
    wrap.textContent = '';
    var list = warnings || [];
    for (var i = 0; i < list.length; i++) {
      var box = document.createElement('div');
      box.className = 'warnbox';
      box.textContent = '告警：' + String(list[i]);
      wrap.appendChild(box);
    }
  }

  function emptyCardMessage() {
    if (currentCode === null) {
      var rawText = currentRaw === null || currentRaw === '' ? '（未提供标的）' : currentRaw;
      return '收到「' + rawText + '」——期望 6 位数字（如 600000）；请检查 TDX 联动编码/参数模板。不加载任何标的、不猜测代码、不补全位数。';
    }
    if (currentDate === null || currentDate === '') return '交易日未定——请在 B2 选择日期后回读。';
    return '该日无卡片：' + currentCode + ' @ ' + currentDate + '（不显示其它日期的内容）。';
  }

  function renderCards(cards) {
    var wrap = byId('rv-cards');
    wrap.textContent = '';
    var list = cards || [];
    for (var i = list.length - 1; i >= 0; i--) { // 时间倒序 = 文档序（追加序）的逆序
      wrap.appendChild(makeCardNode(list[i]));
    }
    byId('rv-empty').textContent = list.length === 0 ? emptyCardMessage() : '';
  }

  function prependCard(card) {
    var wrap = byId('rv-cards');
    wrap.insertBefore(makeCardNode(card), wrap.firstChild);
    byId('rv-empty').textContent = '';
  }

  // ── 本地段（/api/local；首屏不等待网络段）──────────────────────────────────
  function loadLocal(silent) {
    if (currentCode === null) {
      setMode('empty');
      renderB1();
      renderTradeState();
      renderWarnings([]);
      renderCards([]);
      return;
    }
    if (!silent) setMode('loading');
    fetchJson(apiUrl('/review/api/local', { code: currentCode, date: currentDate })).then(function (r) {
      if (r.status !== 200) {
        if (!silent) setMode('error', '本地段加载失败：HTTP ' + r.status + ' ' + describeError(r.body));
        return;
      }
      lastLocal = r.body;
      nameLocal = r.body.name || null;
      if (!datePicked && r.body.date !== null && r.body.date !== undefined) {
        currentDate = r.body.date;
        if (byId('rv-date').value === '') byId('rv-date').value = r.body.date;
      }
      renderB1();
      renderTradeState();
      renderWarnings(r.body.warnings);
      renderCards(r.body.cards);
      if (!silent) setMode('idle');
      if (r.body.error) setStatus(r.body.message || '');
    }, function (e) {
      if (!silent) setMode('error', '本地段加载失败：' + String(e));
    });
  }

  // ── 网络段（/api/enrich；异步补位、可中断、不阻塞输入）────────────────────
  function setEnrichPending() {
    byId('rv-limit').textContent = '涨停原因：加载中…';
    byId('rv-concepts').textContent = '标签：加载中…';
  }

  function renderEnrichUnavailable(msg) {
    byId('rv-limit').textContent = '涨停原因：不可用（' + msg + '）';
    byId('rv-concepts').textContent = '标签：不可用（' + msg + '）';
  }

  function updateTradeStateFromEnrich(td) {
    if (lastLocal === null || td === null || td === undefined) return;
    if (lastLocal.dateSource !== 'requested' && (lastLocal.tradeDate === null || lastLocal.tradeDate === undefined)) {
      lastLocal.tradeDate = td;
      renderTradeState();
    }
  }

  function renderEnrich(data) {
    // B2 默认归属日补位（仅当用户未显式选日）。
    if (!datePicked && data.tradeDate !== null && data.tradeDate !== undefined && data.tradeDate.value !== null && byId('rv-date').value === '') {
      currentDate = data.tradeDate.value;
      byId('rv-date').value = data.tradeDate.value;
      loadLocal(true);
    }
    updateTradeStateFromEnrich(data.tradeDate);
    // 名称层②补位：仅当本地段为 code-only（层①命中不覆盖）。
    if (data.name !== null && data.name !== undefined && data.name.available === true && data.name.name) {
      if (nameLocal === null || nameLocal.value === null || nameLocal.value === '') {
        enrichName = { name: data.name.name, source: data.name.nameSource || 'T2-S8' };
      }
    }
    updateNameLine();
    var c = data.concepts;
    if (c !== null && c !== undefined && c.available === true) {
      byId('rv-concepts').textContent = '标签：' + (c.labels.length > 0 ? c.labels.join(' · ') : '（无概念条目）');
    } else {
      byId('rv-concepts').textContent = '标签：不可用' + (c && c.detail ? '（' + c.detail + '）' : '');
    }
    var lr = data.limitReason;
    if (lr !== null && lr !== undefined && lr.text) {
      // 分档文案由服务端 availability 驱动（含「按源业务日 <日期>」标注）。
      byId('rv-limit').textContent = '涨停原因：' + lr.text;
    } else {
      byId('rv-limit').textContent = '涨停原因：不可用（响应缺失）';
    }
  }

  function loadEnrich() {
    if (currentCode === null) return;
    enrichGen += 1; // 代际推进：旧响应到达即丢弃
    if (enrichController !== null) {
      try { enrichController.abort(); } catch (e) { /* 忽略 */ }
    }
    var gen = enrichGen;
    enrichController = new AbortController();
    setEnrichPending();
    fetchJson(apiUrl('/review/api/enrich', { code: currentCode, date: currentDate }), { signal: enrichController.signal }).then(function (r) {
      if (gen !== enrichGen) return; // 已切换标的/日期——结果不写入新标的展示区
      if (r.status !== 200) { renderEnrichUnavailable('HTTP ' + r.status + ' ' + describeError(r.body)); return; }
      renderEnrich(r.body);
    }, function (e) {
      if (gen !== enrichGen) return;
      renderEnrichUnavailable(String(e));
    });
  }

  function describeError(body) {
    if (body === null || body === undefined || typeof body !== 'object') return '';
    var parts = [];
    if (body.error) parts.push(String(body.error));
    if (body.message) parts.push(String(body.message));
    else if (body.detail) parts.push(String(body.detail));
    else if (body.hint) parts.push(String(body.hint));
    return parts.join('：');
  }

  // ── 上下文切换（hash / query / path 段；无刷新）────────────────────────────
  function switchContext(code, raw) {
    currentCode = code;
    currentRaw = raw;
    enrichGen += 1;
    if (enrichController !== null) {
      try { enrichController.abort(); } catch (e) { /* 忽略 */ }
    }
    nameLocal = null;
    enrichName = null;
    lastLocal = null;
    datePicked = false;
    currentDate = null;
    byId('rv-date').value = '';
    byId('rv-confirm-date').checked = false;
    byId('rv-warnings').textContent = '';
    setMode('idle');
    loadLocal(false);
    loadEnrich();
  }

  function onNavTargetChange(code, raw) {
    var inputEl = byId('rv-input');
    var hasDraft = trim(inputEl.value) !== '';
    if (hasDraft && draftOwnerCode !== null && code !== null && draftOwnerCode !== code) {
      // 联动切换保护（D-11）：不静默换归属——确认前提交被拒。
      pendingOwner = { from: draftOwnerCode, to: code };
      showOwnerConfirm();
    } else {
      pendingOwner = null;
      hideOwnerConfirm();
    }
    switchContext(code, raw);
  }

  function currentParams() {
    return parseReviewParams(location.hash, location.search, location.pathname, routePath);
  }

  function applyParams() {
    var p = currentParams();
    var code = p.valid ? p.code : null;
    if (code !== null && code === currentCode) return; // 同标的：不重载
    onNavTargetChange(code, p.raw);
  }

  // ── 提交（B3；clientRequestId 幂等 + 防重 + 失败保留输入）─────────────────
  function newRequestId() {
    return 'rv-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000000));
  }

  function submit() {
    if (!writable) return;
    if (mode === 'submitting' || mode === 'loading') return; // 提交中防重
    var inputEl = byId('rv-input');
    var text = inputEl.value;
    if (trim(text) === '') { setMode('error', '内容为空——请先输入'); return; }
    if (pendingOwner !== null) {
      setMode('error', '未提交内容属于 ' + pendingOwner.from + '——请先点击「确认归属到 ' + pendingOwner.to + '」再保存');
      return;
    }
    if (needDateConfirm() && !byId('rv-confirm-date').checked) {
      setMode('error', '归属待确认——请先勾选「确认归属该交易日」再保存');
      return;
    }
    if (pendingRequestId === null) pendingRequestId = newRequestId();
    var payload = {
      code: currentCode,
      body: text,
      clientRequestId: pendingRequestId,
      tradeDate: currentDate,
    };
    if (lastLocal !== null && lastLocal.name !== null && lastLocal.name !== undefined
        && lastLocal.name.nameSource === 'frontmatter-history' && lastLocal.name.value) {
      payload.name = lastLocal.name.value; // 仅透传本地已知名称用于首建文档命名段
    }
    setMode('submitting');
    fetch(basePath + '/review/api/card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (resp) {
      return resp.json().then(function (b) { return { status: resp.status, body: b }; });
    }).then(function (r) {
      if (r.status === 200 && r.body && r.body.status === 'created') {
        inputEl.value = '';
        draftOwnerCode = null;
        pendingRequestId = null;
        setMode('idle');
        if (r.body.anchor) prependCard({ anchor: r.body.anchor, writtenAt: r.body.writtenAt || '', body: text });
        renderWarnings(r.body.warnings);
        setStatus('已保存 ^' + r.body.anchor);
        return;
      }
      if (r.status === 200 && r.body && r.body.status === 'duplicate') {
        inputEl.value = '';
        draftOwnerCode = null;
        pendingRequestId = null;
        setMode('idle');
        setStatus('该卡片已存在（幂等命中 ^' + r.body.anchor + '）');
        renderWarnings(r.body.warnings);
        return;
      }
      // 失败：输入保留、同 clientRequestId 重试（服务端幂等去重）。
      setMode('error', '保存失败：' + describeError(r.body));
    }, function (e) {
      setMode('error', '保存失败：' + String(e) + '（输入已保留，可重试）');
    });
  }

  // ── 事件接线 ─────────────────────────────────────────────────────────────
  var inputEl = byId('rv-input');
  inputEl.addEventListener('input', function () {
    if (draftOwnerCode === null && currentCode !== null && trim(inputEl.value) !== '') {
      draftOwnerCode = currentCode; // 首次输入固化来源标的
    }
    if (mode === 'error') setMode('idle');
  });
  inputEl.addEventListener('compositionstart', function () { composing = true; });
  inputEl.addEventListener('compositionend', function () { composing = false; });
  inputEl.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'Enter' || ev.keyCode === 10)) {
      // 输入法组合期 MUST 忽略（isComposing / composition 标记双保险）。
      if (composing || ev.isComposing === true) return;
      ev.preventDefault();
      submit();
    }
  });
  byId('rv-save').addEventListener('click', submit);
  byId('rv-date').addEventListener('change', function () {
    var v = byId('rv-date').value;
    datePicked = v !== '';
    currentDate = datePicked ? v : null;
    if (pendingOwner === null) hideOwnerConfirm();
    loadLocal(false);
  });
  byId('rv-confirm-date').addEventListener('change', function () {
    if (byId('rv-confirm-date').checked && mode === 'error') setMode('idle');
  });
  byId('rv-confirm-owner').addEventListener('click', function () {
    // 一次显式确认：归属切到新标的；确认后保存即可提交（服务端仍按 clientRequestId 幂等）。
    pendingOwner = null;
    hideOwnerConfirm();
    if (mode === 'error') setMode('idle');
  });
  window.addEventListener('hashchange', applyParams);

  // writable=false（C 层签字只读分支）：B3 降级为禁用态 + 提示 DSH 侧写卡。
  if (!writable) {
    byId('rv-save').disabled = true;
    inputEl.disabled = true;
    byId('rv-readonly-hint').style.display = '';
  }

  // 启动：传参优先级 hash → query → path 段（parseReviewParams）；非法/缺失 = 显式空态。
  var initial = currentParams();
  if (initial.valid) {
    currentCode = initial.code;
    currentRaw = initial.raw;
  } else {
    currentCode = null;
    currentRaw = initial.raw;
  }
  loadLocal(false);
  loadEnrich();
})();
</script>
</body>
</html>
`
