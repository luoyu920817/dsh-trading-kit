/**
 * 复盘页 HTML 常量（change 4 review-page tasks 4.1–4.8；design D-2 内联定案①）。
 * 形态定案 = 内联 TS 模板字符串：随 entry 模块图经 tsdown 编译进 lib/**，无拷贝
 * 步骤；`package.json#files` 已含 `lib`（构建断言见 test/routes-review/review-build.test.ts）。
 *
 * 语法上限（spike 实测内核 = Chromium 81 级，docs/spikes/tdx-embed.md）：ES2017 +
 * Fetch + Promise 的保守子集——内联脚本 MUST NOT 使用 ES module / 可选链（?.）/
 * 空值合并（??）/ 模板字符串 / async / await；用 var/function/then 链。
 * 离线自包含：无任何 http(s):// 外链字面（owner 2026-10-05：treeid 联动按钮移除——
 * 页面本身运行在 TDX 内；spike 决策①通道保留备用）；
 * 网络请求仅同源 /review/api/*（本地段与网络段独立 fetch，首屏 MUST NOT await 网络段）。
 *
 * 服务端注入（D-3）：`__REVIEW_STATE_JSON__` 占位符由 src/routes/review.ts 的
 * `injectReviewState` 按请求替换为 `window.__REVIEW__ = { writable, basePath,
 * routePath, injectedAt }`；`writable === false`（C 层签字只读分支）时 B3 降级为
 * 禁用态 + 提示 DSH 侧写卡（spike 决策第 3 条：A 层在 TDX 内未验证存活）。
 *
 * 四区块（spec「四区块布局」）：B1 标的头部（代码+名称分层+行情四格+标签+涨停原因——
 * 四格 owner 2026-10-05 裁决自参考页迁移，数据 = S9 快照）、
 * B2 日期（自绘月历组件：预填最近期交易日，可改选/清除——owner 2026-10-05 裁决
 * 弃用原生 date 输入与「待确认」朗读文案；右侧 =「整理」按钮——owner 2026-10-07
 * 裁决自 B3 工具框移入：登记当前标的整理意图并复制固定指令，agent 由 DSH 会话
 * 发送触发，页面不直接点火）、B3 输入（回车保存 + 图片草稿缩略图预览）、
 * B4 当日卡片（时间倒序+纯文本转义+复制 block 引用+warnings 展示）。
 */
import { parseReviewParams } from './params.ts'
import { parseImageEmbeds } from '../../review/image-refs.ts'
import { imageDraftError, insertImageEmbed, imagePreviewItems, selectDraftImages, cardImageDate, imageReadIsCurrent, imageDraftBytes } from './image-draft.ts'

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
  /* 暗色交易风格（owner 2026-10-05 指示：参考 同花顺涨跌停原因.html 布局——
     黑底、暗卡、红名、代码 chip、橙色标签；兼容 Chromium 81：不用 flex gap
     （84+），以 margin 间隔；不用 84+ 之后的任何 CSS/JS 特性。） */
  * { font-size: 13px; margin: 0; padding: 0; box-sizing: border-box; }
  body { background-color: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; padding: 14px; max-width: 100%; overflow-x: hidden; }
  .rv-container { max-width: 800px; margin: 0 auto; }
  h1 { font-size: 15px; margin: 0 0 10px; color: #e6e6e6; font-weight: 600; }
  section { background: #111111; border: 1px solid #333333; border-radius: 8px; padding: 10px 12px; margin: 0 0 12px; max-width: 100%; overflow-wrap: anywhere; }
  #rv-b1 { border-left: 4px solid #c50e29; }
  #rv-code-line { display: flex; flex-wrap: wrap; align-items: center; }
  #rv-code { font-size: 14px; font-weight: 600; color: #e6e6e6; background: #242424; border: 1px solid #3a3a3a; padding: 3px 9px; border-radius: 999px; font-family: "SF Mono", "Fira Code", "Consolas", monospace; margin-right: 10px; }
  #rv-name { color: #ff4d4f; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; margin-right: 10px; }
  .muted { color: #8a8a8a; font-size: 12px; }
  #rv-concepts { margin-top: 8px; }
  #rv-limit { margin-top: 6px; }
  .warnbox { background: #2a2410; border: 1px solid #7a6520; color: #e8d48a; padding: 5px 8px; margin: 4px 0; font-size: 12px; overflow-wrap: anywhere; border-radius: 4px; }
  .tagline { margin-top: 8px; }
  .tag { display: inline-block; background: #333333; color: #ffa500; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin: 0 6px 4px 0; }
  /* 行情四格（owner 2026-10-05 裁决：自参考页 同花顺涨跌停原因.html 迁移——现价着色/
     流通市值/总市值/流通股本；grid 固定一行四列（owner 同日追授：窄面板不折叠——
     2×2 单列过宽）；数据 = S9 行情快照。） */
  .quote-grid { display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 10px; row-gap: 10px; }
  .quote-cell { min-width: 0; padding-left: 12px; border-left: 1px solid #262626; }
  .quote-cell:first-child { padding-left: 0; border-left: none; }
  .quote-label { color: #666666; font-size: 11px; text-align: left; padding-bottom: 4px; border-bottom: 1px solid #2a2a2a; white-space: nowrap; }
  .quote-value { padding-top: 5px; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qp-value { color: #e6e6e6; font-size: 13px; font-weight: 600; white-space: nowrap; }
  .qp-value.up { color: #ff4d4f; }
  .qp-value.down { color: #4dabf7; }
  /* 自绘月历（owner 2026-10-05 裁决：弃用原生 date 输入——其上下微调控件不可用
     且观感不符；月面板 = 选择器，不打标有卡日期。flex/grid 在 Chromium 81 可用，
     仅 gap（84+）禁用，以 margin 间隔。） */
  #rv-date-wrap { position: relative; display: inline-block; vertical-align: middle; }
  #rv-date { padding: 4px 24px 4px 10px; font-size: 13px; width: 132px; background: #1a1a1a; color: #e6e6e6; border: 1px solid #3a3a3a; border-radius: 4px; cursor: pointer; font-family: inherit; }
  #rv-date:focus { outline: none; border-color: #c50e29; }
  #rv-date-icon { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); color: #8a8a8a; font-size: 11px; pointer-events: none; }
  /* 交易日行（owner 2026-10-07：整理按钮自 B3 工具框移到交易日右侧；行内流排布，
     不用 flex gap——Chromium 81 兼容） */
  #rv-b2 #rv-organize { vertical-align: middle; margin-left: 6px; }
  #rv-b2 #rv-trade-state { margin-left: 6px; }
  /* 输入区草稿预览（owner 2026-10-07：只渲染已插入图片的缩略图，正文文本不重复渲染） */
  #rv-image-draft { margin-top: 6px; }
  #rv-image-draft .review-image { display: inline-block; max-height: 96px; margin: 0 6px 6px 0; }
  #rv-cal { position: absolute; left: 0; top: calc(100% + 6px); z-index: 60; width: 252px; background: #1a1a1a; border: 1px solid #3a3a3a; border-radius: 8px; padding: 10px; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.6); }
  .rv-cal-head { display: flex; align-items: center; margin-bottom: 6px; }
  .rv-cal-head button { background: transparent; color: #cccccc; border: 1px solid #3a3a3a; border-radius: 4px; width: 24px; height: 24px; padding: 0; font-size: 13px; line-height: 1; cursor: pointer; margin: 0 2px; }
  .rv-cal-head button:hover { background: #2a2a2a; color: #ffffff; }
  #rv-cal-label { flex: 1; text-align: center; color: #e6e6e6; }
  .rv-cal-week, .rv-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
  .rv-cal-week span { text-align: center; color: #777777; font-size: 11px; padding: 3px 0; }
  .rv-cal-day { text-align: center; padding: 5px 0; color: #dddddd; cursor: pointer; border-radius: 4px; }
  .rv-cal-day:hover { background: #2a2a2a; }
  .rv-cal-out { color: #555555; }
  .rv-cal-today { color: #ff7a45; }
  .rv-cal-day.rv-cal-sel, .rv-cal-day.rv-cal-sel:hover { background: #c50e29; color: #ffffff; font-weight: 600; }
  .rv-cal-foot { margin-top: 8px; text-align: right; }
  .rv-cal-foot button { background: transparent; border: none; color: #8a8a8a; font-size: 12px; cursor: pointer; padding: 2px 0; }
  .rv-cal-foot button:hover { color: #e6e6e6; }
  textarea { width: 100%; min-height: 84px; font-size: 13px; padding: 6px; resize: vertical; background: #1a1a1a; color: #e6e6e6; border: 1px solid #3a3a3a; border-radius: 4px; line-height: 1.6; }
  textarea:focus { outline: none; border-color: #c50e29; }
  button { padding: 5px 14px; font-size: 13px; background: #c50e29; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  button:disabled { background: #3a3a3a; color: #777777; cursor: not-allowed; }
  button#rv-reserve, button.copy-btn { background: #333333; color: #ffa500; font-size: 12px; padding: 3px 8px; }
  .card-action { background: #333333; color: #cccccc; font-size: 12px; padding: 2px 8px; margin-left: 6px; }
  .card-action:hover { color: #ffffff; }
  .card-action.primary { background: #c50e29; color: #ffffff; }
  .card-action.danger { background: #c50e29; color: #ffffff; }
  .card-edit-bar { margin-top: 6px; }
  .card-edit-bar .card-action { margin-left: 0; margin-right: 6px; }
  .card { background: #1a1a1a; border: 1px solid #333333; border-radius: 8px; padding: 8px; margin: 0 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; color: #e6e6e6; line-height: 1.6; }
  .card-head { font-size: 12px; color: #666666; padding-bottom: 4px; border-bottom: 1px solid #262626; margin-bottom: 6px; }
  .card-head span { margin-right: 10px; }
  a { color: #4dabf7; overflow-wrap: anywhere; }
  .limit-body { color: #cccccc; line-height: 1.6; margin-top: 6px; }
  .review-image { display: block; max-width: 100%; max-height: 180px; cursor: zoom-in; margin: 6px 0; }
  #rv-image-dialog { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 100; background: rgba(0,0,0,.9); padding: 20px; overflow: auto; }
  #rv-image-dialog img { display: block; max-width: 100%; margin: 12px auto; }
  ::-webkit-scrollbar { height: 0; width: 0; }
</style>
</head>
<body>
<div class="rv-container">

<section id="rv-b1">
  <div id="rv-code-line">
    <span id="rv-code">—</span>
    <span id="rv-name" class="muted"></span>
  </div>
  <div id="rv-quote" class="quote-grid">
    <div class="quote-cell"><div class="quote-label">现价</div><div class="quote-value"><span id="rv-qp-price" class="qp-value">--</span></div></div>
    <div class="quote-cell"><div class="quote-label">流通市值</div><div class="quote-value"><span id="rv-qp-ltsz" class="qp-value">--</span></div></div>
    <div class="quote-cell"><div class="quote-label">总市值</div><div class="quote-value"><span id="rv-qp-zsz" class="qp-value">--</span></div></div>
    <div class="quote-cell"><div class="quote-label">流通股本</div><div class="quote-value"><span id="rv-qp-ltgb" class="qp-value">--</span></div></div>
  </div>
  <div id="rv-concepts" class="muted"></div>
  <div id="rv-limit" class="muted"></div>
  <div id="rv-owner-confirm" class="warnbox" style="display:none"></div>
  <div id="rv-owner-actions" style="display:none"><button type="button" id="rv-confirm-owner"></button></div>
</section>

<section id="rv-b2">
  <label for="rv-date">交易日</label>
  <div id="rv-date-wrap">
    <input type="text" id="rv-date" readonly placeholder="选择日期">
    <span id="rv-date-icon">▾</span>
    <div id="rv-cal" style="display:none">
      <div class="rv-cal-head">
        <button type="button" id="rv-cal-py" title="上一年">«</button>
        <button type="button" id="rv-cal-pm" title="上一月">‹</button>
        <span id="rv-cal-label">—</span>
        <button type="button" id="rv-cal-nm" title="下一月">›</button>
        <button type="button" id="rv-cal-ny" title="下一年">»</button>
      </div>
      <div class="rv-cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
      <div id="rv-cal-grid" class="rv-cal-grid"></div>
      <div class="rv-cal-foot"><button type="button" id="rv-cal-clear">清除（回到自动归属）</button></div>
    </div>
  </div>
  <button type="button" id="rv-organize" disabled title="登记当前标的的整理意图并复制指令——到 DSH 会话粘贴发送">整理</button>
  <span id="rv-trade-state" class="muted"></span>
</section>

<section id="rv-b3">
  <textarea id="rv-input" placeholder="盘面观察 / 操作思路…（Enter 保存，Shift+Enter 换行）"></textarea>
  <div id="rv-image-draft"></div>
  <button type="button" id="rv-image-pick">添加图片</button>
  <div><span id="rv-status" class="muted"></span></div>
  <div id="rv-readonly-hint" class="warnbox" style="display:none">写卡不可用：A 层认证未生效——请在 DSH 会话侧写卡，或先经登录 URL 完成两步登录。</div>
</section>

<section id="rv-b4">
  <div id="rv-warnings"></div>
  <div id="rv-cards"></div>
  <div id="rv-empty" class="muted"></div>
</section>

<div id="rv-image-dialog" style="display:none" role="dialog" aria-label="图片原图"><button type="button" id="rv-image-close">关闭原图</button><img id="rv-image-original" alt="复盘图片原图"></div>
<script>
window.__REVIEW__ = ${REVIEW_STATE_PLACEHOLDER};
</script>
<script>
(function () {
  'use strict';

  // 传参解析与 test/routes-review 单测同一实现：src/client/review/params.ts 运行时序列化内联于此。
  var parseReviewParams = ${parseReviewParams};
  var parseImageEmbeds = ${parseImageEmbeds};
  var imageDraftError = ${imageDraftError};
  var insertImageEmbed = ${insertImageEmbed};
  var imagePreviewItems = ${imagePreviewItems};
  var selectDraftImages = ${selectDraftImages};
  var cardImageDate = ${cardImageDate};
  var imageReadIsCurrent = ${imageReadIsCurrent};
  var imageDraftBytes = ${imageDraftBytes};

  var state = window.__REVIEW__ || {};
  var basePath = typeof state.basePath === 'string' && state.basePath !== '' ? state.basePath : '/dsh-trader-kit';
  var routePath = basePath + '/review';
  var writable = state.writable !== false; // 注入缺失时按可写处理（正常分支恒注入）

  // ── 页面状态（交互态五态：idle / loading / submitting / error / empty）──────
  var mode = 'idle';
  var currentCode = null;        // 归一后的当前标的（null = 无有效标的）
  var currentRaw = null;         // 原始取值（排障展示）
  var currentMarket = null;      // 显式市场前缀（sh|sz|bj|null）——同码不同品种区分（owner 2026-10-06）
  var currentAnchor = null;      // 锚点领域档 {name, role}（stock 档案区 档案解析；owner 2026-10-06）
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
  var enrichRenderedFor = null;  // 最近一次 enrich 渲染所属标的（B1 清空保留判定——owner 2026-10-05）
  var draftImages = { items: [], reserved: 0, active: true, generation: 0, owner: null };
  var editImageDrafts = [];
  var imageSequence = 0;
  var imageContextGeneration = 0;
  var composing = false;         // 输入法组合期

  function byId(id) { return document.getElementById(id); }
  function trim(v) { return v.replace(/^\\s+|\\s+$/g, ''); }

  // ── 形态判定（owner 2026-10-06 两轮裁决）：
  // ① 外部指数态 = 显式沪市 + 000xxx（中证指数段，与深市股票同码不同品种）——
  //    行情经 S10 腾讯源展示，不写卡（存储按代码定位，与同码股票冲突）。
  // ② 锚点领域态 = 88xxxx（通达信自制指标）与 999999（上证指数显示码，无同码股票）——
  //    「复盘日志评论的领域归类」：名称/角色来自 stock 档案区 锚点档案，允许写卡；
  //    行情尝试 S10（880 显式不可得、999999 经别名有真行情），S7/S5/S8 enrich 跳过。──
  // 指数页（含自制指标/显示码/显式沪市中证指数段）：一律可写「关键判断」卡；
  // 差异仅在取数面（enrich 跳过）与行情来源（S10）。
  function isIndexPage() {
    if (currentCode === null) return false;
    if (/^88/.test(currentCode)) return true;
    if (currentCode === '999999') return true;
    if (currentMarket === 'sh' && /^000/.test(currentCode)) return true;
    if (currentMarket === 'sh' && /^5/.test(currentCode)) return true; // 沪市基金/ETF（锚点族）
    return false;
  }

  function isTdxAnchor() { // 兼容既有名（档案名/角色消费处）
    return isIndexPage();
  }

  // 代码标识（owner 2026-10-06「整体添加代码标识添加一个沪深」）：显示与写卡标识 =
  // sh|sz|bj 前缀 + 6 位（显式 URL 前缀优先，否则按代码段推断——与 src/review/ident.ts 同规则）。
  function inferMarket(code) {
    if (/^88\d{4}$/.test(code)) return 'sh';
    var h = code.charAt(0);
    if (h === '6' || h === '9' || h === '5') return 'sh';
    if (h === '0' || h === '1' || h === '2' || h === '3') return 'sz';
    if (h === '4' || h === '8') return 'bj';
    return 'sz';
  }

  function currentQualified() {
    if (currentCode === null) return null;
    var m = currentMarket !== null ? currentMarket : inferMarket(currentCode);
    return m + currentCode;
  }

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
    // owner 2026-10-06：独立保存按钮移除——提交由回车承载，防重由 mode 门禁（submit 首行检查）。
    if (next === 'submitting') { setStatus('保存中…'); return; }
    if (next === 'loading') { setStatus('加载中…'); return; }
    if (next === 'error') setStatus(message || '出错');
    else setStatus('');
  }

  // ── B1 渲染 ─────────────────────────────────────────────────────────────
  function updateNameLine() {
    var el = byId('rv-name');
    if (isTdxAnchor() && currentAnchor !== null && currentAnchor.name) {
      el.textContent = currentAnchor.name; // 锚点领域名（stock 档案区 档案）优先
      return;
    }
    var effective = null;
    if (nameLocal !== null && nameLocal.value !== null && nameLocal.value !== '') {
      // 层①命中：网络段（层②）MUST NOT 覆盖（§12.4）。
      effective = nameLocal.value;
    } else if (enrichName !== null && enrichName.name) {
      // 层②补位：仅当本地段为 code-only。来源标注（T2-S8 等）保留在 API 响应，
      // 页面不展示（owner 2026-10-05：「这是什么」——简化显示）。
      effective = enrichName.name;
    }
    if (currentCode === null) { el.textContent = ''; return; }
    el.textContent = effective !== null ? effective : '名称未获取';
  }

  function renderB1() {
    var codeEl = byId('rv-code');
    if (currentCode !== null) codeEl.textContent = currentQualified();
    else if (currentRaw !== null && currentRaw !== '') codeEl.textContent = '收到「' + currentRaw + '」';
    else codeEl.textContent = '—';
    // owner 2026-10-05：页面本身运行在 TDX 内，跳转 TDX 的联动链接移除
    //（spike 决策①的 treeid 通道保留在文档与后续场景：页面外联动时再启用）。
    // 标签/涨停原因 = enrich 段渲染内容：同一标的的本地段静默回读（保存/编辑/删除后）
    // MUST NOT 清空不补（owner 2026-10-05 反馈）；仅标的切换（renderedFor 不一致）才清空。
    if (enrichRenderedFor !== currentCode) {
      byId('rv-concepts').textContent = '';
      byId('rv-limit').textContent = '';
    }
    byId('rv-organize').disabled = !writable || currentCode === null; // 指数/锚点页可整理（关键判断载体）
    updateNameLine();
  }

  // ── 行情四格（owner 2026-10-05 裁决：自参考页迁移；数据 = /api/enrich 的 quote 段。
  // 换算口径：≥1 亿 → 亿（两位小数），<1 亿 → 万；股本带「股」。占位 -- 不冒充数值。）──
  function fmtMoney(v) {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    var yi = v / 1e8;
    if (Math.abs(yi) >= 1) return yi.toFixed(2) + '亿';
    return (v / 1e4).toFixed(0) + '万';
  }

  function fmtShares(v) {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    var yi = v / 1e8;
    if (Math.abs(yi) >= 1) return yi.toFixed(2) + '亿股';
    return (v / 1e4).toFixed(0) + '万股';
  }

  function renderQuote(q) {
    var priceEl = byId('rv-qp-price');
    if (q === null || q === undefined || q.available !== true) {
      priceEl.className = 'qp-value';
      priceEl.textContent = '--';
      byId('rv-qp-ltsz').textContent = '--';
      byId('rv-qp-zsz').textContent = '--';
      byId('rv-qp-ltgb').textContent = '--';
      return;
    }
    var pct = q.pct;
    priceEl.className = 'qp-value ' + (pct !== null && pct > 0 ? 'up' : (pct !== null && pct < 0 ? 'down' : ''));
    priceEl.textContent = (q.price !== null && q.price !== undefined ? q.price.toFixed(2) : '--')
      + (pct !== null && pct !== undefined ? '  ' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%' : '');
    byId('rv-qp-ltsz').textContent = fmtMoney(q.ltsz);
    byId('rv-qp-zsz').textContent = fmtMoney(q.zsz);
    byId('rv-qp-ltgb').textContent = fmtShares(q.ltgb);
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
  function renderTradeState() {
    var el = byId('rv-trade-state');
    if (currentCode === null) { el.textContent = ''; return; }
    // owner 2026-10-05：状态行去冗余保持干净——输入框已展示日期，不再朗读
    // 来源/待确认状态；仅交易日不可得（休市/盘前）时保留一行短提示。
    var td = lastLocal !== null ? lastLocal.tradeDate : null;
    var explicit = lastLocal !== null && lastLocal.dateSource === 'requested' && lastLocal.date;
    if (explicit || (td !== null && td !== undefined && td.value !== null && td.value !== undefined)) {
      el.textContent = '';
      return;
    }
    el.textContent = '交易日不可得（休市/盘前）——可在上方日历选择最近交易日';
    // owner 2026-10-05：确认勾选框移除——页面预填 T0 解析出的最近期交易日，
    // 保存即显式提交该日期（归属证据 = 数据源会话集合比对，非系统日历猜测）。
  }

  // ── 自绘月历（owner 2026-10-05 裁决：替换原生日历输入——深色月面板、
  // 年/月跳转、周一为首列、选中高亮；「清除」= 清空显式选择，回到服务端
  // 自动归属日。仅为日期选择器，不涉及有卡日期数据。）─────────────────────
  var calOpen = false;
  var calView = null; // 面板当前展示 {y, m}（m: 0-11）

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function parseYmd(v) {
    var m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(v === null || v === undefined ? '' : v);
    if (m === null) return null;
    return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
  }

  function isoOf(y, m, d) {
    return String(y) + '-' + pad2(m + 1) + '-' + pad2(d);
  }

  function calRender() {
    byId('rv-cal-label').textContent = String(calView.y) + ' 年 ' + pad2(calView.m + 1) + ' 月';
    var grid = byId('rv-cal-grid');
    grid.textContent = '';
    var selIso = parseYmd(byId('rv-date').value) !== null ? byId('rv-date').value : null;
    var now = new Date();
    var nowIso = isoOf(now.getFullYear(), now.getMonth(), now.getDate());
    var startDow = (new Date(calView.y, calView.m, 1).getDay() + 6) % 7; // 周一首列
    for (var i = 0; i < 42; i++) {
      var d = new Date(calView.y, calView.m, 1 - startDow + i);
      var iso = isoOf(d.getFullYear(), d.getMonth(), d.getDate());
      var cell = document.createElement('span');
      cell.className = 'rv-cal-day' + (d.getMonth() !== calView.m ? ' rv-cal-out' : '');
      cell.textContent = String(d.getDate());
      if (iso === selIso) cell.className += ' rv-cal-sel';
      if (iso === nowIso) cell.className += ' rv-cal-today';
      (function (isoDate) {
        cell.addEventListener('click', function () {
          setDateValue(isoDate);
          calSetOpen(false);
        });
      })(iso);
      grid.appendChild(cell);
    }
  }

  function calSetOpen(open) {
    if (open === calOpen) return;
    if (open) {
      var cur = parseYmd(byId('rv-date').value);
      if (cur !== null) calView = { y: cur.y, m: cur.m };
      else { var now = new Date(); calView = { y: now.getFullYear(), m: now.getMonth() }; }
      calRender();
      byId('rv-cal').style.display = '';
    } else {
      byId('rv-cal').style.display = 'none';
    }
    calOpen = open;
  }

  function setDateValue(v) {
    byId('rv-date').value = v;
    applyDateChange();
  }

  /**
   * 切换交易日。业务逻辑: 更新日期并回读本地和网络段。
   * 关键判断: 日期改变使在途图片读取失效。异常处理: 空日期进入待定状态。
   * 参数: 无，读取日期框。返回: 无。
   */
  function applyDateChange() {
    imageContextGeneration += 1;
    var v = byId('rv-date').value;
    datePicked = v !== '';
    currentDate = datePicked ? v : null;
    if (pendingOwner === null) hideOwnerConfirm();
    loadLocal(false);
    loadEnrich(); // 切日期同步重跑网络段：B1 标签/涨停原因按新日期补位，MUST NOT 清空不补（2026-10-05）
  }

  function wireCalendar() {
    byId('rv-date').addEventListener('click', function () { calSetOpen(!calOpen); });
    byId('rv-cal-py').addEventListener('click', function () { calView.y -= 1; calRender(); });
    byId('rv-cal-pm').addEventListener('click', function () {
      calView.m -= 1;
      if (calView.m < 0) { calView.m = 11; calView.y -= 1; }
      calRender();
    });
    byId('rv-cal-nm').addEventListener('click', function () {
      calView.m += 1;
      if (calView.m > 11) { calView.m = 0; calView.y += 1; }
      calRender();
    });
    byId('rv-cal-ny').addEventListener('click', function () { calView.y += 1; calRender(); });
    byId('rv-cal-clear').addEventListener('click', function () {
      setDateValue('');
      calSetOpen(false);
    });
    document.addEventListener('click', function (ev) {
      if (!calOpen) return;
      var node = ev.target;
      while (node !== null && node !== undefined && node !== document) {
        if (node === byId('rv-date-wrap')) return; // 面板内/字段上的点击不收起
        node = node.parentNode;
      }
      calSetOpen(false);
    });
    document.addEventListener('keydown', function (ev) {
      if (calOpen && (ev.key === 'Escape' || ev.keyCode === 27)) calSetOpen(false);
    });
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
    b.className = 'copy-btn';
    b.type = 'button';
    b.textContent = '复制引用';
    b.addEventListener('click', function () {
      copyText('^' + anchor, function (ok) {
        setStatus(ok ? '已复制 ^' + anchor : '复制失败（可手动选择锚点文本）');
      });
    });
    return b;
  }

  // ── B4 卡片动作（owner 2026-10-05 追授：编辑 = 行内 textarea 保存经 /api/card/update；
  // 删除 = 两段确认后经 /api/card/delete；锚点文本不再展示——数据文件与复制引用保留）──
  function postCardApi(pathSuffix, payload, done) {
    if (currentMarket !== null) payload.market = currentMarket; // 显式市场参与锚点定位（owner 2026-10-08 P0）
    fetch(basePath + '/review/api/card' + pathSuffix, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-write-key': (window.__REVIEW__ && window.__REVIEW__.writeKey) || '' },
      body: JSON.stringify(payload),
    }).then(function (resp) {
      return resp.json().then(function (b) { return { status: resp.status, body: b }; });
    }).then(done, function (e) {
      done({ status: 0, body: { message: String(e) } });
    });
  }

  function makeActionBtn(text) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'card-action';
    b.textContent = text;
    return b;
  }


  /**
   * 释放草稿预览。业务逻辑: 撤销所有BlobURL并使在途读取失效。
   * 关键判断: 取消或保存成功才清空。异常处理: 无附件时安全空操作。
   * 参数: draft为附件草稿。返回: 无。
   */
  function clearImageDraft(draft) {
    draft.generation += 1;
    for (var i = 0; i < draft.items.length; i++) URL.revokeObjectURL(draft.items[i].url);
    draft.items = [];
    draft.reserved = 0;
    draft.owner = null;
  }

  /**
   * 在页内查看原图。业务逻辑: 使用同源或BlobURL打开原图弹层。
   * 关键判断: src仅由校验后的图片提供。异常处理: 图片加载失败仍可关闭。
   * 参数: src为图片地址。返回: 无。
   */
  function showImageOriginal(src) {
    byId('rv-image-original').src = src;
    byId('rv-image-dialog').style.display = '';
  }

  /**
   * 渲染图片正文。业务逻辑: 文本分段使用text节点，已确认图片展示缩略图。
   * 关键判断: 未确认嵌入保持原文；缺失文件显示占位；历史图片删除需要二次确认。
   * 异常处理: 图片加载错误降级占位，不解析正文HTML。
   * 参数: wrap为容器，body为正文，images为可信元数据，card/date/code为固定归属。
   * 返回: 无。
   */
  function renderImageBody(wrap, body, images, card, date, code) {
    wrap.textContent = '';
    var refs = parseImageEmbeds(body);
    var offset = 0;
    for (var i = 0; i < refs.length; i++) {
      var ref = refs[i];
      wrap.appendChild(document.createTextNode(body.slice(offset, ref.start)));
      var item = null;
      for (var j = 0; j < images.length; j++) if (images[j].relativePath === ref.relativePath) item = images[j];
      if (!item) wrap.appendChild(document.createTextNode(body.slice(ref.start, ref.end)));
      else {
        var group = document.createElement('span');
        if (item.available === false) group.textContent = '[图片缺失：' + ref.relativePath + ']';
        else {
          var img = document.createElement('img');
          img.className = 'review-image';
          img.alt = ref.relativePath;
          // market 随当前上下文携带（owner 2026-10-08 P0）：同码跨市场文档定位以显式市场过滤。
          img.src = (!card && item.url) || basePath + '/review/api/card/image?code=' + encodeURIComponent(code) + '&tradeDate=' + encodeURIComponent(date) + (currentMarket !== null ? '&market=' + encodeURIComponent(currentMarket) : '') + '&relativePath=' + encodeURIComponent(ref.relativePath);
          img.addEventListener('click', function (ev) { showImageOriginal(ev.currentTarget.src); });
          img.addEventListener('error', function (ev) { var el = ev.currentTarget; el.parentNode.replaceChild(document.createTextNode('[图片不可用：' + el.alt + ']'), el); });
          group.appendChild(img);
        }
        if (card && writable && card.anchor) group.appendChild(makeImageDeleteButton(card, ref.relativePath));
        wrap.appendChild(group);
      }
      offset = ref.end;
    }
    wrap.appendChild(document.createTextNode(body.slice(offset)));
  }

  /**
   * 创建附件删除按钮。业务逻辑: 首次点击提示影响，二次点击删除引用和原文件。
   * 关键判断: 仅历史元数据确认的路径提供此动作。异常处理: 失败重置按钮且保留页面。
   * 参数: card为历史卡片，relativePath为附件路径。返回: 删除按钮。
   */
  function makeImageDeleteButton(card, relativePath) {
    var b = makeActionBtn('删除图片');
    var armed = false;
    b.addEventListener('click', function () {
      if (!armed) { armed = true; b.textContent = '确认删除图片及原文件（会影响其他笔记引用）'; return; }
      b.disabled = true;
      postCardApi('/image/delete', { anchor: card.anchor, relativePath: relativePath }, function (r) {
        if (r.status === 200 && r.body && r.body.status === 'updated') { renderWarnings(r.body.warnings); setStatus(r.body.warnings && r.body.warnings.length ? '图片引用已删除，原文件清理有告警' : '已删除图片及原文件'); loadLocal(true); }
        else { armed = false; b.disabled = false; b.textContent = '删除图片'; setStatus('图片删除失败：' + describeError(r.body)); }
      });
    });
    return b;
  }

  /**
   * 接收剪贴板与选图附件。业务逻辑: 校验并预留容量，读取base64后在光标处插入引用。
   * 关键判断: 切换归属或取消后忽略旧读取；在读取完成前禁止提交。
   * 异常处理: 文件读取失败释放预留量并提示；草稿保留供重试。
   * 参数: ta为编辑框，draft为图片草稿，preview为预览容器，files为用户文件。
   * 返回: 无，附件只留在内存。
   */
  function addImageFiles(ta, draft, preview, files) {
    if (!writable || mode === 'submitting' || mode === 'loading' || !draft.active || ta.disabled) return;
    if (currentCode === null || !currentDate || pendingOwner !== null) { setStatus('请先选择标的和交易日并确认草稿归属'); return; }
    var owner = currentQualified() + ' @ ' + currentDate;
    if (draft === draftImages && draft.owner !== null && draft.owner !== owner) {
      pendingOwner = { from: draft.owner, to: owner }; showOwnerConfirm(); setStatus('请先确认图片草稿归属'); return;
    }
    var context = imageContextGeneration;
    var generation = draft.generation;
    for (var i = 0; i < files.length; i++) {
      var total = imageDraftBytes(ta.value, draft.items, draft.reserved, parseImageEmbeds);
      var file = files[i];
      var error = imageDraftError(file.type, file.size, total);
      if (error) { setStatus(error); continue; }
      draft.reserved += file.size;
      (function (image) {
        var ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[image.type];
        imageSequence += 1;
        var relativePath = 'files/review-' + newRequestId() + '-' + imageSequence + '.' + ext;
        var reader = new FileReader();
        reader.onload = function () {
          if (!draft.active || draft.generation !== generation) return;
          draft.reserved -= image.size;
          if (!imageReadIsCurrent(context, imageContextGeneration, generation, draft.generation, draft.active) || owner !== currentQualified() + ' @ ' + currentDate) return;
          var data = String(reader.result);
          if (draft === draftImages && draft.owner === null) draft.owner = currentQualified() + ' @ ' + currentDate;
          draft.items.push({ relativePath: relativePath, dataBase64: data.slice(data.indexOf(',') + 1), size: image.size, url: URL.createObjectURL(image) });
          var inserted = insertImageEmbed(ta.value, ta.selectionStart, ta.selectionEnd, relativePath);
          ta.value = inserted.body;
          ta.selectionStart = ta.selectionEnd = inserted.cursor;
          if (ta === byId('rv-input') && draftOwnerCode === null) draftOwnerCode = currentCode;
          renderDraftPreview(preview, ta.value, draft);
          ta.focus();
        };
        reader.onerror = function () {
          if (draft.generation !== generation || !draft.active) return;
          draft.reserved -= image.size;
          if (context === imageContextGeneration) setStatus('图片读取失败，请重新选择');
        };
        reader.readAsDataURL(image);
      })(file);
    }
  }

  /**
   * 渲染输入区草稿缩略图。
   * 业务逻辑: 只呈现正文当前引用的草稿图片（owner 2026-10-07：输入框已显示原文，
   * 镜像渲染整段文本是噪声，预览只留图片缩略图）。
   * 关键判断: 无引用时容器清空即零占位；缩略图点击复用页内原图弹层。
   * 异常处理: 缩略图加载失败移除该节点，不留破图占位。
   * 参数: preview为预览容器，body为正文，draft为图片草稿。返回: 无。
   */
  function renderDraftPreview(preview, body, draft) {
    preview.textContent = '';
    var items = imagePreviewItems(body, draft.items, parseImageEmbeds);
    for (var i = 0; i < items.length; i++) {
      var img = document.createElement('img');
      img.className = 'review-image';
      img.alt = items[i].relativePath;
      img.src = items[i].url;
      img.addEventListener('click', function (ev) { showImageOriginal(ev.currentTarget.src); });
      img.addEventListener('error', function (ev) {
        var el = ev.currentTarget;
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      preview.appendChild(img);
    }
  }

  /**
   * 接线图片编辑器。业务逻辑: 文件选择和截图粘贴共用读取流程，正文变化刷新预览。
   * 关键判断: 只拦截含图片的粘贴；不改变普通文本粘贴和Enter行为。
   * 异常处理: 不可写时禁用选择；取消由上层使草稿失效。
   * 参数: ta编辑框，draft附件状态，preview预览节点，pick选图按钮。
   * 返回: 无。
   */
  function wireImageEditor(ta, draft, preview, pick) {
    var chooser = document.createElement('input');
    chooser.type = 'file'; chooser.accept = 'image/png,image/jpeg,image/webp,image/gif'; chooser.multiple = true;
    pick.disabled = !writable;
    pick.addEventListener('click', function () { chooser.click(); });
    chooser.addEventListener('change', function () { addImageFiles(ta, draft, preview, chooser.files || []); chooser.value = ''; });
    ta.addEventListener('paste', function (ev) {
      var items = ev.clipboardData && ev.clipboardData.items;
      var files = [];
      if (!items) return;
      for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) { var file = items[i].getAsFile(); if (file) files.push(file); }
      if (!files.length) return;
      ev.preventDefault(); addImageFiles(ta, draft, preview, files);
    });
    ta.addEventListener('input', function () {
      // 未引用附件仍保留在内存中，正文撤销恢复时可继续保存；取消或成功保存才释放。
      // 预览只渲染仍被引用的图片缩略图（owner 2026-10-07：正文文本不再镜像渲染）。
      renderDraftPreview(preview, ta.value, draft);
    });
  }

  /**
   * 编辑历史卡片。业务逻辑: 内联正文与图片草稿保存，取消恢复历史正文。
   * 关键判断: 失败保留附件及正文；读取完成后才能提交；在途提交冻结正文、选图与取消。异常处理: 服务端错误显示并保留编辑态。
   * 参数: card原卡片、div容器、bodyEl历史正文。返回: 无。
   */
  function enterCardEdit(card, div, bodyEl) {
    if (div.__rvEditing === true) return;
    div.__rvEditing = true;
    var ta = document.createElement('textarea');
    ta.value = card.body || '';
    var bar = document.createElement('div');
    bar.className = 'card-edit-bar';
    var save = makeActionBtn('保存编辑');
    save.className = 'card-action primary';
    var cancel = makeActionBtn('取消');
    var imagePick = makeActionBtn('添加图片');
    var preview = document.createElement('div');
    var editDraft = { items: [], reserved: 0, active: true, generation: 0 };
    editImageDrafts.push(editDraft);
    bar.appendChild(imagePick);
    bar.appendChild(preview);
    var imageHint = document.createElement('div');
    imageHint.className = 'muted';
    imageHint.textContent = '保存时移除图片引用会同时删除原文件，影响其他笔记引用。';
    bar.appendChild(imageHint);
    wireImageEditor(ta, editDraft, preview, imagePick);
    bar.appendChild(save);
    bar.appendChild(cancel);
    bodyEl.style.display = 'none';
    div.insertBefore(ta, bodyEl);
    div.insertBefore(bar, bodyEl);
    cancel.addEventListener('click', function () {
      editDraft.active = false;
      clearImageDraft(editDraft);
      div.__rvEditing = false;
      div.removeChild(ta);
      div.removeChild(bar);
      bodyEl.style.display = '';
    });
    save.addEventListener('click', function () {
      if (editDraft.reserved) { setStatus('图片正在读取，请稍后保存'); return; }
      var next = ta.value;
      if (imageDraftBytes(next, editDraft.items, 0, parseImageEmbeds) > 20 * 1024 * 1024) { setStatus('本次图片总量最大 20MiB，请减少图片引用'); return; }
      if (trim(next) === '') { setStatus('编辑内容为空——如需删除请用「删除」按钮'); return; }
      save.disabled = true;
      ta.disabled = true;
      imagePick.disabled = true;
      cancel.disabled = true;
      postCardApi('/update', { anchor: card.anchor, body: next, images: selectDraftImages(next, editDraft.items, parseImageEmbeds) }, function (r) {
        if (r.status === 200 && r.body && r.body.status === 'updated') {
          editDraft.active = false;
          clearImageDraft(editDraft);
          setStatus('已保存编辑');
          loadLocal(true); // 静默回读：退出编辑态并渲染新正文（warnings 一并刷新）
        } else {
          save.disabled = false;
          ta.disabled = false;
          imagePick.disabled = !writable;
          cancel.disabled = false;
          setStatus('编辑保存失败：' + describeError(r.body));
        }
      });
    });
  }

  function makeDeleteButton(card) {
    var b = makeActionBtn('删除');
    var armed = false;
    var timer = null;
    b.addEventListener('click', function () {
      if (!armed) {
        // 两段确认：首次点击进「确认删除」态，超时自动还原（破坏性动作 MUST NOT 单击直删）。
        armed = true;
        b.className = 'card-action danger';
        b.textContent = card.images && card.images.length ? '确认删除卡片及图片原文件（影响其他笔记引用）' : '确认删除';
        timer = setTimeout(function () {
          armed = false;
          b.className = 'card-action';
          b.textContent = '删除';
        }, 4000);
        return;
      }
      if (timer !== null) { clearTimeout(timer); timer = null; }
      b.disabled = true;
      postCardApi('/delete', { anchor: card.anchor }, function (r) {
        if (r.status === 200 && r.body && r.body.status === 'deleted') {
          setStatus('已删除卡片');
          loadLocal(true);
        } else {
          armed = false;
          b.disabled = false;
          b.className = 'card-action';
          b.textContent = '删除';
          setStatus('删除失败：' + describeError(r.body));
        }
      });
    });
    return b;
  }

  /**
   * 构造历史卡片。业务逻辑: 显示安全文本与元数据确认的图片。
   * 关键判断: 图片归属日期/代码在渲染时固定。异常处理: 无元数据按文本呈现。
   * 参数: card为回读卡片。返回: 卡片DOM。
   */
  function makeCardNode(card) {
    var div = document.createElement('div');
    div.className = 'card';
    var head = document.createElement('div');
    head.className = 'card-head';
    var meta = document.createElement('span');
    // owner 2026-10-05：锚点 id 文本（^card-…）不再展示——数据文件与「复制引用」通道保留
    meta.textContent = card.writtenAt || '';
    head.appendChild(meta);
    if (card.anchor) head.appendChild(makeCopyButton(card.anchor));
    var bodyEl = document.createElement('div');
    bodyEl.className = 'card-body';
    bodyEl.textContent = card.body || ''; // 纯文本转义：textContent（标签字符不被解析）
    var cardDate = cardImageDate(card.anchor || '', currentDate);
    renderImageBody(bodyEl, card.body || '', card.images || [], card, cardDate, currentQualified());
    if (!trim(card.body || '')) bodyEl.textContent = '（卡片正文为空）';
    div.appendChild(head);
    div.appendChild(bodyEl);
    if (writable && card.anchor) {
      var editBtn = makeActionBtn('编辑');
      editBtn.addEventListener('click', function () { enterCardEdit(card, div, bodyEl); });
      head.appendChild(editBtn);
      head.appendChild(makeDeleteButton(card));
    }
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

  /**
   * 渲染卡片列表。业务逻辑: 释放旧编辑预览后倒序展示历史。
   * 关键判断: 回读不保留失效DOM的附件。异常处理: 空列表显示空态。
   * 参数: cards为回读卡片。返回: 无。
   */
  function renderCards(cards) {
    for (var d = 0; d < editImageDrafts.length; d++) { editImageDrafts[d].active = false; clearImageDraft(editImageDrafts[d]); }
    editImageDrafts = [];
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
    // owner 2026-10-06 修订：指数（含同码冲突家族 000001 等）与锚点同为「关键判断
    // 载体」——一律走正常本地流（卡片可写/可读/可编辑），行情经 S10、enrich 跳过。
    currentAnchor = null; // 复位（锚点/指数档案名由下方响应重建）
    if (!silent) setMode('loading');
    fetchJson(apiUrl('/review/api/local', { code: currentCode, date: currentDate, market: currentMarket })).then(function (r) {
      if (r.status !== 200) {
        if (!silent) setMode('error', '本地段加载失败：HTTP ' + r.status + ' ' + describeError(r.body));
        return;
      }
      lastLocal = r.body;
      nameLocal = r.body.name || null;
      // 锚点领域档（owner 2026-10-06）：名称/角色来自 stock 档案区 档案——领域归类展示。
      currentAnchor = r.body.anchor !== null && r.body.anchor !== undefined
        && r.body.anchor.name !== null && r.body.anchor.name !== undefined
        ? { name: r.body.anchor.name, role: r.body.anchor.role, isAnchor: r.body.anchor.isAnchor === true }
        : null;
      if (!datePicked && r.body.date !== null && r.body.date !== undefined) {
        currentDate = r.body.date;
        if (byId('rv-date').value === '') byId('rv-date').value = r.body.date;
      }
      renderB1();
      renderTradeState();
      renderAnchorRole();
      renderWarnings(r.body.warnings);
      renderCards(r.body.cards);
      if (!silent) setMode('idle');
      if (r.body.error) setStatus(r.body.message || '');
      if (isTdxAnchor()) loadIndexQuote(); // 锚点行情（880 显式消息 / 999999 真行情）
    }, function (e) {
      if (!silent) setMode('error', '本地段加载失败：' + String(e));
    });
  }

  // ── 指数态行情（owner 2026-10-06 追授：/api/index-quote 同源取数，S10 腾讯指数
  // 源；名称行与现价格由该响应填充，市值/股本对指数不适用保持 '--'）────────────
  function loadIndexQuote() {
    var code = currentCode;
    fetchJson(apiUrl('/review/api/index-quote', { code: code })).then(function (r) {
      if (currentCode !== code || (!isIndexPage() && !isTdxAnchor())) return; // 已切走——丢弃
      if (r.status !== 200) {
        byId('rv-limit').textContent = '指数行情：不可用（HTTP ' + r.status + '）';
        return;
      }
      var q = r.body;
      // 交易日定位（owner 2026-10-06：指数/锚点态与股票页同一 T0 事实源——日期框回填）。
      if (!datePicked && q.tradeDate && q.tradeDate.value) {
        currentDate = q.tradeDate.value;
        if (byId('rv-date').value === '') byId('rv-date').value = q.tradeDate.value;
      }
      if (q.available === true) {
        // 名称优先级：档案名（local 段已填）> S10 行情名 > 层③（名称未获取）。
        var hasProfileName = isTdxAnchor() && currentAnchor !== null && currentAnchor.name;
        if (!hasProfileName) byId('rv-name').textContent = q.name || '指数';
        var priceEl = byId('rv-qp-price');
        priceEl.className = 'qp-value ' + (q.pct !== null && q.pct > 0 ? 'up' : (q.pct !== null && q.pct < 0 ? 'down' : ''));
        priceEl.textContent = (q.price !== null ? q.price.toFixed(2) : '--') + (q.pct !== null && q.pct !== undefined ? '  ' + (q.pct > 0 ? '+' : '') + q.pct.toFixed(2) + '%' : '');
        if (isTdxAnchor()) byId('rv-limit').textContent = '标签/涨停原因：指数不适用';
      } else {
        byId('rv-limit').textContent = '指数行情：不可用（' + (q.detail || (q.errors || []).join('/')) + '）';
      }
    }, function () { /* 传输失败静默：页面保持占位态 */ });
  }

  /** 锚点角色 chip（owner 2026-10-06：领域归类可视化——「情绪周期」「赚钱效应」等）。 */
  function renderAnchorRole() {
    var el = byId('rv-concepts');
    el.textContent = '';
    if (!isTdxAnchor() || currentAnchor === null) return;
    var tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = currentAnchor.role || (currentAnchor.isAnchor ? '锚点' : '板块指数');
    el.appendChild(tag);
  }

  // ── 网络段（/api/enrich；异步补位、可中断、不阻塞输入）────────────────────
  function setEnrichPending() {
    byId('rv-limit').textContent = '涨停原因：加载中…';
    byId('rv-concepts').textContent = '标签：加载中…';
    renderQuote(null); // 行情四格复位占位——新快照到达前 MUST NOT 残留旧标的数值
  }

  function renderEnrichUnavailable(msg) {
    enrichRenderedFor = currentCode; // 不可用态也归属当前标的（本地回读不清空不补）
    byId('rv-limit').textContent = '涨停原因：不可用（' + msg + '）——可能为休市日/盘前，请在 B2 显式选择最近交易日重试';
    byId('rv-concepts').textContent = '';
    var none = document.createElement('span');
    none.className = 'muted';
    none.textContent = '标签：不可用（' + msg + '）';
    byId('rv-concepts').appendChild(none);
  }

  function updateTradeStateFromEnrich(td) {
    if (lastLocal === null || td === null || td === undefined) return;
    if (lastLocal.dateSource !== 'requested' && (lastLocal.tradeDate === null || lastLocal.tradeDate === undefined)) {
      lastLocal.tradeDate = td;
      renderTradeState();
    }
  }

  /**
   * 渲染涨停原因折叠盒。
   * 业务逻辑: 最新信息归属日等于当前交易日时默认展开，点击可切换展开/收起。
   * 关键判断: 归属日必须非空且与 currentDate 相等；不同日期或交易日未定时收起。
   * 异常处理: 响应或正文缺失时只显示不可用提示，不绑定折叠事件。
   * 参数: lr 为最新涨停信息，包含正文 text 和归属日 businessDate。
   * 返回: 无；更新涨停原因区块。
   */
  function renderLimitBox(lr) {
    var box = byId('rv-limit');
    box.textContent = '';
    var head = document.createElement('div');
    head.style.cursor = 'pointer';
    var body = document.createElement('div');
    body.className = 'limit-body';
    if (lr === null || lr === undefined || !lr.text) {
      head.textContent = '涨停原因：不可用（响应缺失）';
      box.appendChild(head);
      return;
    }
    var expanded = !!lr.businessDate && lr.businessDate === currentDate;
    head.textContent = '涨停原因（点击' + (expanded ? '收起' : '展开') + '）' + (expanded ? '▴ ' : '▾ ') + (lr.businessDate ? '［' + lr.businessDate + '］' : '');
    body.textContent = lr.text;
    body.style.display = expanded ? '' : 'none';
    head.addEventListener('click', function () {
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      head.textContent = '涨停原因（点击' + (open ? '展开' : '收起') + '）' + (open ? '▾' : '▴') + (lr.businessDate ? '［' + lr.businessDate + '］' : '');
    });
    box.appendChild(head);
    box.appendChild(body);
  }

  function renderEnrich(data) {
    enrichRenderedFor = currentCode; // 渲染归属当前标的（后续本地回读不清空——owner 2026-10-05）
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
    renderQuote(data.quote); // 行情四格（S9 快照；不可得 → 逐格 '--' 占位）
    var c = data.concepts;
    var conceptsEl = byId('rv-concepts');
    conceptsEl.textContent = '';
    if (c !== null && c !== undefined && c.available === true && c.labels.length > 0) {
      for (var ti = 0; ti < c.labels.length; ti++) {
        var chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = c.labels[ti];
        conceptsEl.appendChild(chip);
      }
    } else {
      var none = document.createElement('span');
      none.className = 'muted';
      none.textContent = c !== null && c !== undefined && c.available === true
        ? '（无概念条目）'
        : '不可用' + (c && c.detail ? '（' + c.detail + '）' : '') + '——可能为休市日，稍后自动补位';
      conceptsEl.appendChild(none);
    }
    var lr = data.limitReason;
    renderLimitBox(lr !== null && lr !== undefined ? lr : { text: null });
  }

  function loadEnrich() {
    if (currentCode === null || isIndexPage() || isTdxAnchor()) return; // 指数/锚点态不取数（错配与无谓预算）
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
  /**
   * 切换标的上下文。业务逻辑: 复位展示与日期，重新加载数据。
   * 关键判断: 市场或标的切换使在途图片读取失效；既有草稿需显式确认归属。
   * 异常处理: 中断失败忽略，旧网络响应由代际守卫丢弃。
   * 参数: code归一代码、raw原值、market显式市场。返回: 无。
   */
  function switchContext(code, raw, market) {
    imageContextGeneration += 1;
    currentCode = code;
    currentRaw = raw;
    currentMarket = market === undefined ? null : market;
    enrichGen += 1;
    if (enrichController !== null) {
      try { enrichController.abort(); } catch (e) { /* 忽略 */ }
    }
    nameLocal = null;
    enrichName = null;
    lastLocal = null;
    enrichRenderedFor = null; // 标的切换：enrich 渲染归属作废，B1 清空重取
    currentAnchor = null;     // 标的切换：锚点领域档复位
    datePicked = false;
    currentDate = null;
    byId('rv-date').value = '';
    byId('rv-warnings').textContent = '';
    setMode('idle');
    loadLocal(false);
    loadEnrich();
  }

  function onNavTargetChange(code, raw, market) {
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
    switchContext(code, raw, market);
  }

  function currentParams() {
    return parseReviewParams(location.hash, location.search, location.pathname, routePath);
  }

  function applyParams() {
    var p = currentParams();
    var code = p.valid ? p.code : null;
    if (code !== null && code === currentCode && p.market === currentMarket) return; // 同标的同市场：不重载
    onNavTargetChange(code, p.raw, p.market);
  }

  // ── 提交（B3；clientRequestId 幂等 + 防重 + 失败保留输入）─────────────────
  function newRequestId() {
    return 'rv-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000000));
  }

  /**
   * 保存新卡片与附件。业务逻辑: 最终正文引用决定上传附件，失败保留同一请求标识。
   * 关键判断: 图片读取中不提交，纯图片正文可写。异常处理: 网络/业务失败保留草稿。
   * 参数: 无，读取当前草稿。返回: 无。
   */
  function submit() {
    if (!writable) return;
    if (mode === 'submitting' || mode === 'loading') return; // 提交中防重
    var inputEl = byId('rv-input');
    if (draftImages.reserved) { setStatus('图片正在读取，请稍后保存'); return; }
    if (draftImages.items.length && draftImages.owner !== currentQualified() + ' @ ' + currentDate) {
      if (pendingOwner === null) pendingOwner = { from: draftImages.owner, to: currentQualified() + ' @ ' + currentDate };
      showOwnerConfirm();
    }
    var text = inputEl.value;
    if (imageDraftBytes(text, draftImages.items, 0, parseImageEmbeds) > 20 * 1024 * 1024) { setStatus('本次图片总量最大 20MiB，请减少图片引用'); return; }
    if (trim(text) === '') { setMode('error', '内容为空——请先输入'); return; }
    if (pendingOwner !== null) {
      setMode('error', '未提交内容属于 ' + pendingOwner.from + '——请先点击「确认归属到 ' + pendingOwner.to + '」再保存');
      return;
    }
    if (pendingRequestId === null) pendingRequestId = newRequestId();
    var payload = {
      code: currentCode,
      body: text,
      clientRequestId: pendingRequestId,
      tradeDate: currentDate,
      images: selectDraftImages(text, draftImages.items, parseImageEmbeds),
    };
    if (currentMarket !== null) payload.market = currentMarket; // 显式市场（URL 前缀）优先于推断
    if (lastLocal !== null && lastLocal.name !== null && lastLocal.name !== undefined
        && lastLocal.name.nameSource === 'frontmatter-history' && lastLocal.name.value) {
      payload.name = lastLocal.name.value; // 仅透传本地已知名称用于首建文档命名段
    }
    if (isTdxAnchor() && currentAnchor !== null && currentAnchor.name) {
      payload.name = currentAnchor.name; // 锚点领域名（如 微盘股）→ <代码>_<领域>_<日期>.md
    }
    setMode('submitting');
    fetch(basePath + '/review/api/card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-write-key': (window.__REVIEW__ && window.__REVIEW__.writeKey) || '' },
      body: JSON.stringify(payload),
    }).then(function (resp) {
      return resp.json().then(function (b) { return { status: resp.status, body: b }; });
    }).then(function (r) {
      if (r.status === 200 && r.body && r.body.status === 'created') {
        clearImageDraft(draftImages);
        byId('rv-image-draft').textContent = '';
        inputEl.value = '';
        draftOwnerCode = null;
        pendingRequestId = null;
        setMode('idle');
        if (r.body.anchor) prependCard({ anchor: r.body.anchor, writtenAt: r.body.writtenAt || '', body: text });
        if (payload.images.length) loadLocal(true);
        renderWarnings(r.body.warnings);
        setStatus('已保存 ^' + r.body.anchor);
        return;
      }
      if (r.status === 200 && r.body && r.body.status === 'duplicate') {
        clearImageDraft(draftImages);
        byId('rv-image-draft').textContent = '';
        inputEl.value = '';
        draftOwnerCode = null;
        pendingRequestId = null;
        setMode('idle');
        loadLocal(true);
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
  wireImageEditor(inputEl, draftImages, byId('rv-image-draft'), byId('rv-image-pick'));
  byId('rv-image-close').addEventListener('click', function () { byId('rv-image-dialog').style.display = 'none'; byId('rv-image-original').removeAttribute('src'); });
  inputEl.addEventListener('input', function () {
    if (draftOwnerCode === null && currentCode !== null && trim(inputEl.value) !== '') {
      draftOwnerCode = currentCode; // 首次输入固化来源标的
    }
    if (mode === 'error') setMode('idle');
  });
  inputEl.addEventListener('compositionstart', function () { composing = true; });
  inputEl.addEventListener('compositionend', function () { composing = false; });
  inputEl.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.keyCode !== 10) return;
    // 输入法组合期 MUST 忽略（isComposing / composition 标记双保险——交由输入法确认组合）。
    if (composing || ev.isComposing === true) return;
    if (ev.shiftKey) return; // Shift+Enter = 换行（默认行为，不拦截）
    // owner 2026-10-06：回车即保存（独立保存按钮移除）；Ctrl/Cmd+Enter 仍兼容保存。
    ev.preventDefault();
    submit();
  });
  byId('rv-date').addEventListener('change', applyDateChange);
  wireCalendar();
  // ── 交易日行「整理」按钮（owner 2026-10-06 追授；2026-10-07 自 B3 工具框移到
  // 交易日右侧）：登记意图 + 复制固定指令——agent 由 DSH 会话发送触发
  //（页面与 agent 无通道是既定边界；指令模板在服务端）。────────────────────
  byId('rv-organize').addEventListener('click', function () {
    if (!writable || currentCode === null || isIndexPage()) return;
    var btn = byId('rv-organize');
    btn.disabled = true;
    fetch(basePath + '/review/api/organize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-write-key': (window.__REVIEW__ && window.__REVIEW__.writeKey) || '' },
      body: JSON.stringify({ code: currentCode, date: currentDate }),
    }).then(function (resp) {
      return resp.json().then(function (b) { return { status: resp.status, body: b }; });
    }).then(function (r) {
      if (r.status === 200 && r.body && r.body.status === 'registered') {
        copyText(r.body.prompt, function (ok) {
          setStatus(ok ? '整理指令已复制——请到 DSH 会话粘贴发送'
            : '复制失败——请在 DSH 会话手动发送「整理 ' + currentCode + '」');
        });
      } else {
        setStatus('整理登记失败：' + describeError(r.body));
      }
      btn.disabled = !writable || currentCode === null;
    }, function (e) {
      setStatus('整理登记失败：' + String(e));
      btn.disabled = !writable || currentCode === null;
    });
  });
  byId('rv-confirm-owner').addEventListener('click', function () {
    // 一次显式确认：归属切到新标的；确认后保存即可提交（服务端仍按 clientRequestId 幂等）。
    pendingOwner = null;
    if (draftImages.items.length) draftImages.owner = currentQualified() + ' @ ' + currentDate;
    hideOwnerConfirm();
    if (mode === 'error') setMode('idle');
  });
  window.addEventListener('hashchange', applyParams);

  // writable=false（A 层未生效）：仅保存禁用；输入框保持可编辑（草稿保留，
  // owner 2026-10-05 反馈「输入框无法点击进入」——TDX 免登录读态下仍可先写）。
  if (!writable) {
    byId('rv-organize').disabled = true; // 回车提交由 submit() 的 writable 门禁静默拒绝
    byId('rv-readonly-hint').style.display = '';
  }

  // 启动：传参优先级 hash → query → path 段（parseReviewParams）；非法/缺失 = 显式空态。
  var initial = currentParams();
  if (initial.valid) {
    currentCode = initial.code;
    currentRaw = initial.raw;
    currentMarket = initial.market;
  } else {
    currentCode = null;
    currentRaw = initial.raw;
  }
  loadLocal(false);
  loadEnrich();
})();
</script>
</div>
</body>
</html>
`
