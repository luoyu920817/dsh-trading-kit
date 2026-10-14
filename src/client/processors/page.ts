/** 独立管理页面；只使用公开 DTO 和 Cookie 认证 API，没有后台定时任务。 */
export const WORKFLOW_PAGE_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>关键词工作流管理</title><style>
* { box-sizing: border-box; } [hidden] { display: none !important; } body { margin: 12px auto; padding: 0 14px; max-width: 1100px; background: #111; color: #ddd; color-scheme: dark; font: 14px/1.6 sans-serif; }
section { border: 1px solid #444; padding: 10px; margin: 8px 0; border-radius: 6px; } h1 { font-size: 20px; margin: 0 0 6px; } h2 { font-size: 17px; margin: 0 0 4px; } body > p { margin: 0 0 8px; } section > p { margin: 6px 0; }
button,input,select { font: inherit; margin: 4px; padding: 4px 8px; color: #ddd; background: #222; border: 1px solid #555; border-radius: 4px; }
button { cursor: pointer; } button:disabled { color: #777; cursor: default; } label { display: inline-block; } pre { white-space: pre-wrap; overflow-wrap: anywhere; }
#message { color: #e8c26a; } .run { display: block; width: 100%; text-align: left; } .muted { color: #999; } .workflow { border-top: 1px solid #333; padding: 6px 0; }
.keyword-layout { display: grid; grid-template-columns: 140px minmax(0,1fr); gap: 12px; margin-top: 10px; } .keyword-rail { border-right: 1px solid #333; padding-right: 12px; } .keyword-rail button { display: block; width: 100%; text-align: left; margin: 4px 0; padding: 7px 10px; } button.selected { border-color: #769fef; background: #233550; color: #fff; } .keyword-heading { display: flex; align-items: center; gap: 12px; } .keyword-heading h2 { margin: 0; font-size: 18px; } #keyword-mapping { margin: 4px 0; } #keyword-aliases { font-size: 12px; margin: 4px 0; } .badge { padding: 2px 8px; border-radius: 12px; background: #283c32; color: #add8b5; font-size: 12px; } .keyword-tabs { border-bottom: 1px solid #444; margin: 10px 0; } .keyword-card { border: 1px solid #333; border-radius: 8px; padding: 12px; margin: 8px 0; } .keyword-card > p { margin: 6px 0; } details { margin-top: 6px; } summary { cursor: pointer; color: #aaa; } #run-summary,#result-summary { overflow-wrap: anywhere; } #keyword-main { min-width: 0; } @media (max-width: 600px) { .keyword-layout { grid-template-columns: 1fr; gap: 10px; } .keyword-rail { display: flex; overflow-x: auto; gap: 6px; border-right: 0; border-bottom: 1px solid #333; padding: 0 0 10px; } .keyword-rail button { width: auto; flex: 0 0 auto; } }
</style></head><body><h1 id="page-title">关键词工作流管理</h1><p id="page-description" class="muted">查看运行、日志和结果；更改开关与重扫均需手动操作。关闭页面后后台运行继续。</p>
<button id="refresh" type="button">刷新</button><span id="message" role="status" aria-live="polite"></span>
<nav id="settings-tabs" class="keyword-tabs" hidden aria-label="设置分类"><button id="settings-basic-tab" type="button">基本设置</button><button id="settings-keywords-tab" type="button">关键词工作流</button></nav>
<section id="basic-section" hidden><h2>当前基础配置</h2><p class="muted">标的、模式目录可分别调整，保存为相对数据根目录的路径；切换页面会舍弃未保存修改。其他基础配置沿宿主配置文件。</p><p id="basic-status" role="status">读取中</p><div id="basic-content" hidden><div class="keyword-card"><h2>数据目录</h2><p>数据根目录</p><p id="basic-root" style="overflow-wrap:anywhere"></p><div id="basic-directories"></div><label for="basic-stock-path">标的目录（相对路径）</label><div><input id="basic-stock-path" style="width:min(100%,360px)" maxlength="1024" disabled><button id="basic-stock-choose" type="button" disabled>选择标的文件夹</button></div><label for="basic-patterns-path">模式目录（相对路径）</label><div><input id="basic-patterns-path" style="width:min(100%,360px)" maxlength="1024" disabled><button id="basic-patterns-choose" type="button" disabled>选择模式文件夹</button></div><p id="basic-editing-status" role="status"></p><p class="muted">保存并应用会重新加载插件，正在运行的工作流会取消并清理。此操作不会移动目录或迁移文件；模式目录仍预留未接入。</p><button id="basic-save" type="button" disabled>保存并应用</button></div><div class="keyword-card"><h2>执行与预算</h2><div id="basic-processing"></div></div><div class="keyword-card"><h2>数据连接</h2><p id="basic-tqlocal"></p></div></div></section>
<section id="service-section"><h2>运行摘要</h2><p id="health-summary" role="status">读取中</p><details><summary>高级诊断与预算明细</summary><pre id="health">读取中</pre></details></section>
<section id="settings-section"><h2>关键词</h2><p class="muted">选择关键词，查看已登记任务，或调整对应工作流。</p><div id="keyword-layout" class="keyword-layout"><nav id="keyword-nav" class="keyword-rail" aria-label="关键词"></nav><div id="keyword-main"><p id="keyword-empty" class="muted">读取关键词中</p><p id="keyword-status" role="status"></p><div id="keyword-selected" hidden><header class="keyword-heading"><h2 id="keyword-title"></h2><span id="keyword-badge" class="badge"></span></header><p id="keyword-mapping" class="muted"></p><p id="keyword-aliases" class="muted"></p><div class="keyword-tabs"><button id="keyword-config-tab" type="button">触发与执行设置</button><button id="keyword-history-tab" type="button">任务记录</button></div><div id="keyword-config" class="keyword-card"><h2>启用状态</h2><p>保存仍会登记任务；只有本开关和自动执行同时开启，且模型配置具备，任务才运行。</p><label><input id="keyword-enabled" type="checkbox">允许此关键词工作流执行</label><button id="keyword-save" type="button" disabled>保存配置</button><p id="keyword-parameters" class="muted"></p><details><summary>映射与版本明细</summary><pre id="keyword-advanced"></pre></details></div><div id="execution-config" class="keyword-card"><h2>所有关键词共用的执行设置</h2><p id="execution-status" role="status">读取执行配置中</p><label><input id="execution-enabled" type="checkbox" disabled>自动执行已登记任务</label><div><label for="execution-provider">模型服务标识</label><input id="execution-provider" disabled></div><div><label for="execution-model">模型名称</label><input id="execution-model" disabled></div><div><label for="execution-cwd">工作目录（现有绝对目录）</label><input id="execution-cwd" disabled></div><p class="muted">以下设置适用于所有关键词。服务标识和模型名称请沿用 DSH 模型设置。切换关键词或页面会舍弃未保存修改。保存会重新加载插件，正在运行的工作流会取消并清理；开启自动执行后，已有等待任务可能开始执行。</p><button id="execution-save" type="button" disabled>保存执行配置</button></div><div id="keyword-history" hidden></div></div></div></div><div id="workflows"></div><p class="muted">执行设置对应宿主配置 review.processing；修改后需显式保存。</p><button id="reload" type="button">重新加载配置</button></section>
<div id="run-workspace"><section id="runs-section"><h2>任务记录</h2><div id="run-filters"><label>工作流<select id="filter-workflow"><option value="">全部</option></select></label>
<label>状态<select id="filter-state"><option value="">全部</option><option value="queued">排队</option><option value="waiting">等待</option><option value="preparing">准备中</option><option value="running">运行中</option><option value="retryWaiting">等待重试</option><option value="succeeded">完成</option><option value="failed">失败</option><option value="canceled">已取消</option></select></label>
<label>代码<input id="filter-code" maxlength="6" placeholder="六位代码"></label><label>市场<select id="filter-market"><option value="">全部</option><option value="sh">沪</option><option value="sz">深</option><option value="bj">北</option></select></label>
<label>交易日<input id="filter-date" type="date"></label><button id="filter" type="button">应用筛选</button></div><div id="runs"></div><button id="runs-next" type="button" disabled>下一页（50条）</button></section>
<section id="detail-section"><h2>选中运行</h2><p id="run-summary">请选择运行记录</p><details><summary>运行高级明细</summary><pre id="run-detail"></pre></details><div id="run-actions"><label>取消原因<input id="cancel-reason" maxlength="512" value="用户在管理页面取消"></label>
<button id="cancel" type="button" disabled>取消运行</button><button id="retry" type="button" disabled>重新运行</button></div><h2>结果</h2><p id="result-summary"></p><details><summary>结果明细</summary><pre id="result"></pre></details><h2>事件日志</h2><pre id="events"></pre><button id="events-next" type="button" disabled>下一页日志（100条）</button></section></div>
<section id="rescan-section"><h2>历史卡片重扫</h2><p class="muted">明确选择起止日期，单次范围最多31个自然日；翻页沿用该范围。</p><label>起日<input id="rescan-from" type="date"></label><label>止日<input id="rescan-to" type="date"></label>
<button id="rescan" type="button">开始重扫</button><button id="rescan-next" type="button" disabled>继续下一页</button><pre id="rescan-status"></pre></section>
<script>
(function () {
  'use strict';
  var api = '/dsh-trader-kit/review/api/processors';
  var mode = 'all';
  var settingsTab = 'basic';
  var keyword = null;
  var keywordTab = 'history';
  var keywordRemoved = false;
  var settingsStale = false;
  var active = document.hidden !== true;
  var epoch = 0;
  var sequences = {};
  var controllers = {};
  var registry = null;
  var selected = null;
  var selectedId = null;
  var runCursor = null;
  var runRows = [];
  var eventSequence = 0;
  var eventMore = false;
  var scanCursor = null;
  var scanRange = null;
  var mutating = false;
  var basic = null;
  var basicApplied = false;
  var basicStale = false;
  var health = null;
  var execution = null;
  var executionApplied = false;
  var executionStale = false;
  var stateLabels = { queued: '排队', waiting: '待执行', preparing: '准备中', running: '运行中', retryWaiting: '等待重试', succeeded: '完成', failed: '失败', canceled: '已取消' };
  var waitingLabels = { workflowDisabled: '自动执行关闭或工作流未启用', capability: '宿主或模型能力不可用', budget: '今日Agent额度已用完', hostCapacity: '等待执行槽位', sourceNeedsReview: '原卡片暂不可核验', storage: '存储暂不可用' };

  /** 业务逻辑: 查询页面控件。关键判断: 固定ID来自本页。异常处理: 缺节点交浏览器暴露。参数: id。返回: DOM。 */
  function el(id) { return document.getElementById(id); }
  /** 业务逻辑: 依hash选择任务、设置或完整视图。关键判断: 未知hash回退完整页；只改变可见区域，不提交操作。异常处理: 保留全部控件避免初始化缺节点。参数: 无。返回: 无。 */
  function configureView() {
    var hash = window.location && window.location.hash;
    mode = hash === '#runs' ? 'runs' : hash === '#settings' ? 'settings' : 'all';
    el('settings-tabs').hidden = mode !== 'settings';
    el('basic-section').hidden = mode !== 'settings' || settingsTab !== 'basic';
    el('service-section').hidden = mode === 'settings' && settingsTab === 'basic';
    el('settings-section').hidden = mode === 'runs' || mode === 'settings' && settingsTab !== 'keywords';
    el('settings-basic-tab').className = settingsTab === 'basic' ? 'selected' : '';
    el('settings-keywords-tab').className = settingsTab === 'keywords' ? 'selected' : '';
    ['runs-section', 'detail-section'].forEach(function (id) { el(mode === 'settings' ? 'keyword-history' : 'run-workspace').appendChild(el(id)); });
    el('keyword-layout').hidden = mode !== 'settings'; el('workflows').hidden = mode === 'settings';
    el('run-filters').hidden = mode === 'settings'; el('run-actions').hidden = mode === 'settings';
    el('rescan-section').hidden = mode === 'settings';
    updateKeywordView();
    el('page-title').textContent = mode === 'settings' ? '交易工作流设置' : mode === 'runs' ? '关键词任务' : '关键词工作流管理';
    el('page-description').textContent = mode === 'settings' ? '查看基础配置，或选择关键词管理对应工作流与执行历史。' : mode === 'runs' ? '查看运行、日志和结果。取消、重跑和历史重扫需明确点击；关闭页面后后台运行继续。' : '查看运行、日志和结果；更改开关与重扫均需手动操作。关闭页面后后台运行继续。';
  }
  /** 业务逻辑: 核验关键词的当前注册映射。关键判断: id与别名均需仍登记，移除后不猜测替代项。异常处理: 未选择返回null。参数: 无。返回: 公开工作流。 */
  function keywordWorkflow() {
    if (!keyword || !registry) return null;
    return registry.workflows.filter(function (workflow) { return workflow.id === keyword.workflowId && workflow.mentions.indexOf(keyword.mention) >= 0; })[0] || null;
  }
  /** 业务逻辑: 当前历史是否允许只读请求。关键判断: 设置页需选中映射且位于历史tab。异常处理: 无映射关闭读取。参数: 无。返回: 布尔。 */
  function historyVisible() { return mode !== 'settings' || settingsTab === 'keywords' && keywordTab === 'history' && !settingsStale && keywordWorkflow() !== null; }
  /** 业务逻辑: 核验历史响应仍属发起时映射。关键判断: 无映射或tab已隐藏拒绝，别名同workflow共享。异常处理: 空映射返回false。参数: workflowId。返回: 是否可呈现。 */
  function sameHistoryWorkflow(workflowId) { var workflow = keywordWorkflow(); return mode !== 'settings' || historyVisible() && workflow !== null && workflow.id === workflowId; }
  /** 业务逻辑: 更新关键词页二级区域。关键判断: 配置与历史互斥，无选中项不显示详情。异常处理: 空表或移除提供文字状态。参数: 无。返回: 无。 */
  function updateKeywordView() {
    var workflow = keywordWorkflow();
    el('keyword-selected').hidden = !workflow;
    el('keyword-empty').hidden = !!workflow;
    el('keyword-empty').textContent = keywordRemoved ? '选中的关键词已移除，请选择其他关键词或刷新注册表。' : registry && registry.workflows.length ? '请选择左侧关键词。' : '暂无关键词，请检查已登记的工作流配置。';
    el('keyword-status').textContent = settingsStale ? '关键词配置读取失败或版本已变化，请刷新后再试。' : '';
    el('execution-config').hidden = keywordTab !== 'config'; el('keyword-config').hidden = keywordTab !== 'config'; el('keyword-history').hidden = keywordTab !== 'history';
    el('keyword-config-tab').className = keywordTab === 'config' ? 'selected' : '';
    el('keyword-history-tab').className = keywordTab === 'history' ? 'selected' : '';
    el('runs-section').hidden = !historyVisible(); el('detail-section').hidden = !historyVisible();
    el('keyword-history-tab').disabled = !workflow; el('keyword-config-tab').disabled = !workflow;
    if (workflow) {
      el('keyword-title').textContent = '@' + keyword.mention;
      el('keyword-mapping').textContent = workflow.label + ' · ' + workflow.id;
      el('keyword-badge').textContent = workflow.enabled ? '允许执行' : '执行已停用';
      el('keyword-aliases').textContent = workflow.mentions.map(function (name) { return '@' + name; }).join('、') + ' 映射同一工作流，共享配置与执行历史。切换关键词或页签会舍弃未保存的开关修改。';
      el('keyword-enabled').checked = workflow.enabled;
      el('keyword-parameters').textContent = workflow.id === 'expectation' ? '当前预期工作流没有专用参数；此页仅编辑启用状态。' : '此页可编辑启用状态；工作流专用参数沿已登记配置。';
      el('keyword-advanced').textContent = pretty({ workflowId: workflow.id, workflowLabel: workflow.label, mentions: workflow.mentions, definitionRevision: workflow.definitionRevision, settingsRevision: registry.settingsRevision });
    }
    updateActions();
  }
  /** 业务逻辑: 清除跨关键词与tab的运行状态。关键判断: 先作废HTTP与写操作身份，旧收尾不解除新锁。异常处理: 不取消后台运行。参数: 无。返回: 无。 */
  function resetKeywordRequests() {
    stop(); selected = null; selectedId = null; runCursor = null; runRows = []; eventSequence = 0; eventMore = false;
    ['runs', 'run-detail', 'result', 'events', 'result-summary'].forEach(function (id) { el(id).textContent = ''; });
    el('run-summary').textContent = '请选择运行记录'; el('runs-next').disabled = true; el('events-next').disabled = true;
    active = document.hidden !== true; message('');
  }
  /** 业务逻辑: 选择登记关键词并沿当前二级tab显示。关键判断: 点击只读；历史固定映射且从第一页开始。异常处理: 失效关键词提示。参数: workflowId/mention。返回: 无。 */
  function chooseKeyword(workflowId, mention) {
    if (mode !== 'settings' || settingsTab !== 'keywords') return;
    resetKeywordRequests(); keyword = { workflowId: workflowId, mention: mention }; keywordRemoved = false;
    clearExecution(); renderKeywordNavigation(); updateKeywordView(); if (active && historyVisible()) loadRuns(false); if (active && keywordTab === 'config') loadExecution();
  }
  /** 业务逻辑: 切换二级配置或历史。关键判断: 无映射不读取，切换不写配置。异常处理: 隐藏页只更新区域。参数: tab。返回: 无。 */
  function chooseKeywordTab(tab) {
    if (mode !== 'settings' || settingsTab !== 'keywords' || keywordTab === tab) return;
    if (!keywordWorkflow()) { keywordTab = tab; updateKeywordView(); return; }
    resetKeywordRequests(); clearExecution(); keywordTab = tab; updateKeywordView(); if (active && historyVisible()) loadRuns(false); if (active && tab === 'config' && keywordWorkflow()) loadExecution();
  }
  /** 业务逻辑: 从公开aliases构建关键词导航。关键判断: 各别名以workflowId共享设置与历史，不暴露options。异常处理: 空表显示空状态。参数: 无。返回: 无。 */
  function renderKeywordNavigation() {
    var nav = el('keyword-nav'); nav.textContent = '';
    if (!registry) return;
    registry.workflows.forEach(function (workflow) { workflow.mentions.forEach(function (mention) {
      var button = document.createElement('button'); button.type = 'button'; button.textContent = '@' + mention;
      button.className = keyword && keyword.workflowId === workflow.id && keyword.mention === mention ? 'selected' : '';
      button.setAttribute('aria-pressed', button.className ? 'true' : 'false');
      /** 业务逻辑: 点击关键词导航。关键判断: 仅登记映射。异常处理: 当前注册表再次核验。参数: 无。返回: 无。 */
      button.addEventListener('click', function () { chooseKeyword(workflow.id, mention); }); nav.appendChild(button);
    }); });
  }
  /** 业务逻辑: 用纯文本输出提示。关键判断: 不解析HTML。异常处理: 空提示清除。参数: text。返回: 无。 */
  function message(text) { el('message').textContent = text || ''; }
  /** 业务逻辑: 序列化公开结构。关键判断: 不请求私有记录。异常处理: 缺值为空。参数: value。返回: 可读文本。 */
  function pretty(value) { return value === null || value === undefined ? '' : JSON.stringify(value, null, 2); }
  /** 业务逻辑: 清除旧基础配置，避免失败后把旧值当现值。关键判断: 所有内容纯文本。异常处理: 空数据等待刷新。参数: status。返回: 无。 */
  function clearBasic(status) { basic = null; basicApplied = false; basicStale = false; el('basic-content').hidden = true; el('basic-status').textContent = status; ['basic-root', 'basic-directories', 'basic-processing', 'basic-tqlocal', 'basic-editing-status'].forEach(function (id) { el(id).textContent = ''; }); ['stock', 'patterns'].forEach(function (id) { el('basic-' + id + '-path').value = ''; }); updateActions(); }
  /** 业务逻辑: 读取当前生效配置的白名单DTO。关键判断: 只在基本页读取，不探测或创建目录，不提交设置。异常处理: 当前请求失败清旧值，陈旧响应静默。参数: 无。返回: 无。 */
  function loadBasic() {
    clearBasic('读取中');
    request('/dsh-trader-kit/review/api/basic-settings', 'GET', null, 'basic').then(function (data) {
      basic = data;
      el('basic-root').textContent = data.dataRoot || '未配置';
      data.directories.forEach(function (directory) { var row = document.createElement('p'); row.style = 'overflow-wrap:anywhere'; row.textContent = directory.label + ' · ' + directory.relativePath + '（' + (directory.status === 'reserved' ? '预留未接入' : data.dataRoot ? '已配置，未探测目录是否存在' : '未配置数据根目录') + '）'; el('basic-directories').appendChild(row); if (directory.id === 'stock' || directory.id === 'patterns') el('basic-' + directory.id + '-path').value = directory.relativePath; });
      var processing = data.processing;
      [['自动执行', processing.enabled ? '开启' : '关闭'], ['Provider', processing.provider], ['模型', processing.model], ['Agent工作目录', processing.cwd], ['并发上限', processing.maxConcurrency], ['每日Agent激活上限', processing.agentAttemptLimit], ['最大输出Token', processing.maxTokens], ['超时（毫秒）', processing.timeoutMs]].forEach(function (item) { var row = document.createElement('p'); row.textContent = item[0] + ' · ' + (item[1] === null || item[1] === undefined || item[1] === '' ? '未配置' : String(item[1])); el('basic-processing').appendChild(row); });
      el('basic-tqlocal').textContent = 'TQ-Local基础信息兜底 · ' + (data.tqLocalEnabled ? '开启（仅只读白名单）' : '关闭');
      el('basic-status').textContent = '当前生效配置；相对目录以数据根目录为基准。'; el('basic-content').hidden = false;
      el('basic-editing-status').textContent = !data.dataRoot ? '未配置数据根目录，无法调整业务目录。' : !data.editing || !data.editing.available || !data.editing.revision ? data.editing && data.editing.unavailableReason || '宿主目录编辑能力或配置版本不可用。' : '可选择数据根目录内的现有文件夹，或输入相对路径；显式保存后应用。'; updateActions();
    }).catch(function (error) { if (error && error.name === 'AbortError') return; clearBasic('基础配置读取失败，请手动刷新。'); report(error); });
  }
  /** 业务逻辑: 切换基础配置与关键词工作流。关键判断: 作废旧读取与写收尾，基础页无工作流历史请求。异常处理: 隐藏页等待手动刷新。参数: tab。返回: 无。 */
  function chooseSettingsTab(tab) { if (mode !== 'settings' || settingsTab === tab) return; resetKeywordRequests(); clearBasic('读取中'); clearExecution(); settingsTab = tab; configureView(); if (active) refresh(); }
  /** 业务逻辑: 核验基本目录编辑能力。关键判断: 当前视图、根目录、宿主编辑器与CAS版本齐全，保存后须刷新。异常处理: 缺能力只读显示。参数: 无。返回: 是否可编辑。 */
  function basicEditable() { return mode === 'settings' && settingsTab === 'basic' && basic && basic.dataRoot && basic.editing && basic.editing.available && basic.editing.revision && !basicApplied && !basicStale; }
  /** 业务逻辑: 用户点击后请求宿主文件夹选择器。关键判断: 只修改对应草稿，取消不覆盖；不保存或移动资产。异常处理: 拒绝目录保留草稿。参数: directory。返回: 无。 */
  function chooseBasicDirectory(directory) { if (!basicEditable()) return; mutate('/basic-settings/choose-directory', { directory: directory }, function (result) { if (result.directory !== directory || result.relativePath !== null && typeof result.relativePath !== 'string') { message('文件夹选择响应无效，请重新选择'); return; } if (result.relativePath === null) { message('已取消选择，保留原路径'); return; } el('basic-' + directory + '-path').value = result.relativePath; message('已选择文件夹，点击保存并应用后生效'); }); }
  /** 业务逻辑: 显式保存两项相对路径并应用宿主配置。关键判断: 带读取时CAS版本，不自动回读旧运行时或重发。异常处理: 失败保留草稿，冲突须刷新；重新加载时连接中断只报告。参数: 无。返回: 无。 */
  function saveBasicDirectories() { if (!basicEditable()) return; mutate('/basic-settings/save', { revision: basic.editing.revision, directories: { stock: el('basic-stock-path').value, patterns: el('basic-patterns-path').value } }, function (result) { if (result.saved !== true) { message('未确认配置保存成功，请刷新核验'); return; } basicApplied = true; message('已保存并应用，请刷新页面查看当前配置'); }); }
  /** 业务逻辑: 显示上海时间便于对照复盘。关键判断: 固定Asia/Shanghai；无时间返回未提供。异常处理: 非法日期保留原文本。参数: value。返回: 本地时间。 */
  function localTime(value) { if (!value) return '未提供'; var date = new Date(value); if (!Number.isFinite(date.getTime())) return value; return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date); }
  /** 业务逻辑: 清除独立执行草稿。关键判断: 切换后不沿用旧CAS版本。异常处理: 未配置状态待重新读取。参数: 无。返回: 无。 */
  function clearExecution() { execution = null; executionApplied = false; executionStale = false; el('execution-enabled').checked = false; ['provider', 'model', 'cwd'].forEach(function (id) { el('execution-' + id).value = ''; }); el('execution-status').textContent = '读取执行配置中'; updateActions(); }
  /** 业务逻辑: 核验执行编辑能力。关键判断: 配置tab、独立版本和未保存状态齐备。异常处理: 旧宿主DTO只读。参数: 无。返回: 是否可写。 */
  function executionEditable() { return mode === 'settings' && settingsTab === 'keywords' && keywordTab === 'config' && execution && execution.executionEditing && execution.executionEditing.available && execution.executionEditing.revision && !executionApplied && !executionStale; }
  /** 业务逻辑: 同源读取执行配置，不重复请求任务。关键判断: 独立execution通道与页面epoch。异常处理: 失败清草稿并禁止保存。参数: 无。返回: 无。 */
  function loadExecution() { clearExecution(); request('/dsh-trader-kit/review/api/basic-settings', 'GET', null, 'execution').then(function (data) { execution = data; var processing = data.processing || {}; el('execution-enabled').checked = processing.enabled === true; ['provider', 'model', 'cwd'].forEach(function (id) { el('execution-' + id).value = processing[id] || ''; }); var missing = []; [['provider', '模型服务标识'], ['model', '模型名称'], ['cwd', '工作目录']].forEach(function (item) { if (!processing[item[0]]) missing.push(item[1]); }); var editing = data.executionEditing; el('execution-status').textContent = (processing.enabled ? '自动执行已开启。' : '自动执行未开启，已登记任务等待执行。') + (missing.length ? missing.join('、') + '未配置。' : '模型与工作目录已填写，实际可用性需执行验证。') + (!editing || !editing.available || !editing.revision ? editing && editing.unavailableReason || '宿主执行配置编辑能力不可用。' : '可显式保存执行配置。'); updateActions(); }).catch(function (error) { if (error && error.name === 'AbortError') return; clearExecution(); el('execution-status').textContent = '执行配置读取失败，请手动刷新。'; report(error); }); }
  /** 业务逻辑: 用户显式保存四项执行配置。关键判断: 使用独立CAS，不写目录、预算或调用模型。异常处理: 冲突禁写等待刷新，插件重载断线须核验。参数: 无。返回: 无。 */
  function saveExecution() { if (!executionEditable()) return; mutate('/basic-settings/save-execution', { revision: execution.executionEditing.revision, processing: { enabled: el('execution-enabled').checked, provider: el('execution-provider').value, model: el('execution-model').value, cwd: el('execution-cwd').value } }, function (result) { if (result.saved !== true) { message('未确认执行配置保存成功，请刷新核验'); return; } executionApplied = true; message('已保存执行配置并重新加载插件，正在运行的任务会取消并清理；开启后已有等待任务可能开始执行，请刷新确认当前状态。'); }); }
  /** 业务逻辑: 构造有界单值查询。关键判断: 空值省略且全部编码。异常处理: 无查询返回原路径。参数: path和params。返回: 同源路径。 */
  function url(path, params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (key) { var value = params[key]; if (value !== '' && value !== null && value !== undefined) parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value))); });
    return api + path + (parts.length ? '?' + parts.join('&') : '');
  }
  /**
   * 发送一次有版本栅栏的管理请求。
   * 业务逻辑: 同功能通道只保留最新请求，使用Cookie与JSON API。
   * 关键判断: 旧视图和隐藏页面响应不能渲染；不使用写键、不自动重发。
   * 异常处理: 认证失败、冲突和网络异常交调用方显式呈现。
   * 参数: path,method,data,lane。返回: 当前响应Promise，陈旧请求以错误终止。
   */
  function request(path, method, data, lane) {
    if (!active) return Promise.reject(new Error('页面已停止请求，请显示页面后手动刷新'));
    var basicApi = '/dsh-trader-kit/review/api/basic-settings';
    var endpoint = path === basicApi || path.indexOf(basicApi + '/') === 0 ? path.slice('/dsh-trader-kit/review/api'.length) : path.slice(api.length).split('?')[0];
    var basicRead = endpoint === '/basic-settings' && method === 'GET';
    var basicWrite = ['/basic-settings/choose-directory', '/basic-settings/save'].indexOf(endpoint) >= 0 && method === 'POST';
    var executionRequest = mode === 'settings' && settingsTab === 'keywords' && keywordTab === 'config' && (basicRead || endpoint === '/basic-settings/save-execution' && method === 'POST');
    var historyRead = method === 'GET' && historyVisible() && ['/tasks', '/task', '/events'].indexOf(endpoint) >= 0;
    if (!executionRequest && ((basicRead || basicWrite) && !(mode === 'settings' && settingsTab === 'basic') || mode === 'settings' && settingsTab === 'basic' && !basicRead && !basicWrite || (mode === 'runs' && (path.indexOf(basicApi) === 0 || endpoint === '/settings' || endpoint === '/reload')) || (mode === 'settings' && settingsTab === 'keywords' && ['/health', '/registry', '/settings', '/reload'].indexOf(endpoint) < 0 && !historyRead))) return Promise.reject(new Error('当前视图不提供此操作'));
    if (controllers[lane]) controllers[lane].abort();
    var controller = new AbortController(); controllers[lane] = controller;
    var view = epoch;
    var sequence = (sequences[lane] || 0) + 1; sequences[lane] = sequence;
    var options = { method: method, credentials: 'same-origin', signal: controller.signal };
    if (method === 'POST') { options.headers = { 'Content-Type': 'application/json' }; options.body = JSON.stringify(data); }
    return fetch(path, options).then(function (response) {
      return response.json().then(function (body) {
        if (!active || view !== epoch || sequence !== sequences[lane]) { var stale = new Error('过期响应'); stale.name = 'AbortError'; throw stale; }
        if (response.status === 409) throw new Error('记录版本已变化，请刷新后重新操作');
        if (response.status === 401 || response.status === 403) throw new Error('关键词管理认证不可用，请先完成宿主登录');
        if (response.status !== 200) throw new Error(body.message || '管理请求失败');
        return body;
      });
    }).catch(function (error) {
      if (!active || view !== epoch || sequence !== sequences[lane]) { var stale = new Error('过期请求'); stale.name = 'AbortError'; throw stale; }
      throw error;
    });
  }
  /** 业务逻辑: 展示当前请求错误。关键判断: 中断静默，关闭页面不更新。异常处理: 无错误内容用通用提示。参数: error。返回: 无。 */
  function report(error) { if (active && (!error || error.name !== 'AbortError')) message(error && error.message || '管理请求失败'); }
  /** 业务逻辑: 读取健康和能力预算。关键判断: GET不唤醒工作流。异常处理: 失败显示管理提示。参数: 无。返回: 无。 */
  function loadHealth() { request(url('/health'), 'GET', null, 'health').then(function (data) {
    health = data; el('health').textContent = pretty(data);
    var capabilities = data.capabilities || {};
    var parts = [data.enabled ? '自动执行已开启' : '自动执行关闭：任务会登记并等待'];
    parts.push(capabilities.jobs && capabilities.agentFactory ? '执行接口可用；模型配置请在触发与执行设置中查看' : '宿主或模型能力不可用，请检查 Jobs 与 provider/model/cwd 配置');
    if (data.agentAttemptLimit !== undefined) parts.push('今日Agent激活 ' + data.agentAttemptsToday + ' / ' + data.agentAttemptLimit);
    if (data.waitingCounts) { var waiting = Object.keys(data.waitingCounts).reduce(function (count, key) { return count + data.waitingCounts[key]; }, 0); parts.push('待执行任务 ' + waiting + ' 条'); }
    if (data.storageError) parts.push('存储不可用：' + (data.storageError.message || data.storageError));
    el('health-summary').textContent = parts.join('；');
    runRows.forEach(function (run, index) { var button = el('runs').children[index]; if (button) button.textContent = runTitle(run) + (run.result && run.result.summary ? ' · ' + run.result.summary : ''); });
    if (selected) el('run-summary').textContent = runTitle(selected);
  }).catch(report); }
  /** 业务逻辑: 根据当前DTO更新运行操作。关键判断: 未选中或写请求进行中禁用。异常处理: 刷新冲突后须重新取得DTO。参数: 无。返回: 无。 */
  function updateActions() {
    var terminal = selected && ['succeeded', 'failed', 'canceled'].indexOf(selected.executionState) >= 0;
    el('cancel').disabled = mode === 'settings' || mutating || !selected || terminal;
    el('retry').disabled = mode === 'settings' || mutating || !selected || !(terminal || selected.executionState === 'waiting');
    el('keyword-save').disabled = !active || mutating || settingsStale || !keywordWorkflow();
    el('reload').disabled = !active || mutating;
    ['stock', 'patterns'].forEach(function (id) { el('basic-' + id + '-path').disabled = !active || mutating || !basicEditable(); el('basic-' + id + '-choose').disabled = !active || mutating || !basicEditable(); });
    el('basic-save').disabled = !active || mutating || !basicEditable();
    ['enabled', 'provider', 'model', 'cwd', 'save'].forEach(function (id) { el('execution-' + id).disabled = !active || mutating || !executionEditable(); });
  }
  /** 业务逻辑: 重建公开工作流与开关。关键判断: 以registry版本CAS，不在读时修改配置。异常处理: 缺注册表显示不可用。参数: data。返回: 无。 */
  function renderRegistry(data) {
    var hadKeyword = keyword !== null;
    registry = data;
    settingsStale = false;
    if (hadKeyword && !keywordWorkflow()) { resetKeywordRequests(); keyword = null; keywordRemoved = true; }
    if (!keyword && !keywordRemoved) {
      var first = data.workflows.filter(function (workflow) { return workflow.mentions.length > 0; })[0];
      if (first) keyword = { workflowId: first.id, mention: first.mentions[0] };
    }
    var wrap = el('workflows'); wrap.textContent = '';
    var select = el('filter-workflow'); var previous = select.value; select.textContent = '';
    var all = document.createElement('option'); all.value = ''; all.textContent = '全部'; select.appendChild(all);
    data.workflows.forEach(function (workflow) {
      if (mode === 'all') {
      var row = document.createElement('div'); row.className = 'workflow';
      var label = document.createElement('span'); label.textContent = workflow.label + ' ' + workflow.mentions.map(function (name) { return '@' + name; }).join('、'); row.appendChild(label);
      var toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = workflow.enabled; toggle.setAttribute('aria-label', workflow.label + '启用'); row.appendChild(toggle);
      var save = document.createElement('button'); save.type = 'button'; save.textContent = '保存开关'; row.appendChild(save);
      /** 业务逻辑: 显式保存单工作流开关。关键判断: 带当前settingsRevision。异常处理: 409不重发。参数: 无。返回: 无。 */
      save.addEventListener('click', function () { if (mutating) return; mutate('/settings', { settingsRevision: registry.settingsRevision, workflows: [{ workflowId: workflow.id, enabled: toggle.checked }] }, renderRegistry); });
      wrap.appendChild(row);
      }
      var option = document.createElement('option'); option.value = workflow.id; option.textContent = workflow.label; select.appendChild(option);
    });
    select.value = previous;
    renderKeywordNavigation(); updateKeywordView();
  }
  /** 业务逻辑: 读取注册表并沿当前历史tab刷新。关键判断: 不刷新配置或模型；失败封闭旧映射请求与展示。异常处理: 陈旧请求静默，当前失败须手动刷新。参数: 无。返回: 无。 */
  function loadRegistry() { request(url('/registry'), 'GET', null, 'registry').then(function (data) { renderRegistry(data); if (mode === 'settings' && historyVisible()) loadRuns(false); if (mode === 'settings' && keywordTab === 'config' && keywordWorkflow()) loadExecution(); }).catch(function (error) { if (error && error.name === 'AbortError') return; settingsStale = true; if (mode === 'settings') resetKeywordRequests(); updateKeywordView(); report(error); }); }
  /** 业务逻辑: 收集当前筛选。关键判断: 每页固定50条且纯单值字段。异常处理: 输入合法性由API再校验。参数: cursor。返回: 查询。 */
  function filters(cursor) { return mode === 'settings' ? { workflowId: keywordWorkflow().id, limit: 50, cursor: cursor } : { workflowId: el('filter-workflow').value, state: el('filter-state').value, code: el('filter-code').value, market: el('filter-market').value, tradeDate: el('filter-date').value, limit: 50, cursor: cursor }; }
  /** 业务逻辑: 显示运行摘要。关键判断: 使用公开标签和状态。异常处理: 缺标签回退workflowId。参数: run。返回: 单行文本。 */
  function runTitle(run) { var source = run.source || {}; var reason = run.waitingReason === 'workflowDisabled' ? health ? health.enabled === true ? '此关键词工作流已停用' : '自动执行未开启' : '自动执行或此工作流未开启' : waitingLabels[run.waitingReason] || run.waitingReason; return (run.workflowLabel || run.workflowId) + ' · ' + (stateLabels[run.executionState] || run.executionState) + (reason ? '（' + reason + '）' : '') + ' · ' + (source.market || '') + (source.code || '来源未提供') + ' · 交易日 ' + (source.tradeDate || '未提供') + ' · 登记于 ' + localTime(run.createdAt || run.updatedAt); }
  /** 业务逻辑: 读取筛选后的运行页。关键判断: 分页替换当前页，不累计无界DOM。异常处理: 失败保留现有列表。参数: next是否沿游标。返回: 无。 */
  function loadRuns(next) {
    if (!historyVisible() || !active) return;
    if (next && !runCursor) return;
    var workflowId = mode === 'settings' ? keywordWorkflow().id : null;
    request(url('/tasks', filters(next ? runCursor : null)), 'GET', null, 'runs').then(function (data) {
      if (!sameHistoryWorkflow(workflowId)) return;
      var wrap = el('runs'); wrap.textContent = ''; runRows = [];
      if (mode === 'settings' && data.tasks.some(function (run) { return run.workflowId !== workflowId; })) { message('历史记录工作流不匹配，请刷新后再试'); runCursor = null; el('runs-next').disabled = true; return; }
      runRows = data.tasks;
      data.tasks.forEach(function (run) {
        var button = document.createElement('button'); button.className = 'run'; button.textContent = runTitle(run) + (run.result && run.result.summary ? ' · ' + run.result.summary : '');
        /** 业务逻辑: 选择运行并读取最新详情。关键判断: 不执行运行。异常处理: 读取交各通道提示。参数: 无。返回: 无。 */
        button.addEventListener('click', function () { selectRun(run.runId); }); wrap.appendChild(button);
      });
      if (!data.tasks.length) wrap.textContent = '没有匹配的运行记录';
      runCursor = data.nextCursor; el('runs-next').disabled = !runCursor;
    }).catch(function (error) { if (error && error.name === 'AbortError') return; el('runs').textContent = '执行历史读取失败，请手动刷新。'; runCursor = null; el('runs-next').disabled = true; report(error); });
  }
  /** 业务逻辑: 展示最新运行与结果。关键判断: result纯文本；展示actual job/session公开引用。异常处理: 无结果显示待产出。参数: run。返回: 无。 */
  function renderSelected(run) {
    selected = run;
    el('run-summary').textContent = runTitle(run);
    el('run-detail').textContent = pretty(run);
    el('result-summary').textContent = run.result ? run.result.summary || '结果已保存' : '暂无结果';
    el('result').textContent = run.result ? pretty(run.result) : '暂无结果';
    updateActions();
  }
  /** 业务逻辑: 选择运行并重置日志游标。关键判断: 各请求以ID再次防旧选择污染。异常处理: 失败不开放操作。参数: runId。返回: 无。 */
  function selectRun(runId) {
    if (!historyVisible()) return;
    var workflowId = mode === 'settings' ? keywordWorkflow().id : null;
    selectedId = runId; selected = null; updateActions();
    el('run-summary').textContent = '读取中'; el('run-detail').textContent = ''; el('result').textContent = ''; el('result-summary').textContent = ''; el('events').textContent = '';
    eventSequence = 0; eventMore = false; el('events-next').disabled = true;
    request(url('/task', { runId: runId }), 'GET', null, 'detail').then(function (run) {
      if (selectedId !== runId || !sameHistoryWorkflow(workflowId)) return;
      if (!run || run.runId !== runId || mode === 'settings' && run.workflowId !== workflowId) { selected = null; el('run-summary').textContent = '运行详情工作流不匹配'; message('运行详情工作流不匹配，请刷新后再试'); updateActions(); return; }
      renderSelected(run); loadEvents(false);
    }).catch(report);
  }
  /** 业务逻辑: 读取公开日志下一页。关键判断: 一次100项按nextSequence前进，替换当前日志页。异常处理: 失败不前移游标。参数: next。返回: 无。 */
  function loadEvents(next) {
    if (!historyVisible()) return;
    var workflowId = mode === 'settings' ? keywordWorkflow().id : null;
    if (!selectedId || !selected || selected.runId !== selectedId || mode === 'settings' && selected.workflowId !== workflowId || (next && !eventMore)) return;
    var runId = selectedId;
    request(url('/events', { runId: runId, afterSequence: next ? eventSequence : 0, limit: 100 }), 'GET', null, 'events').then(function (data) {
      if (selectedId !== runId || !sameHistoryWorkflow(workflowId) || !selected || selected.runId !== runId || mode === 'settings' && selected.workflowId !== workflowId) return;
      el('events').textContent = data.events.map(function (event) { return (event.occurredAt || '') + ' ' + (event.code || '') + ' ' + (event.message || ''); }).join('\\n') + (data.omittedEventCount ? '\\n已保留日志之外的事件数：' + data.omittedEventCount : '');
      eventSequence = data.nextSequence; eventMore = data.hasMore; el('events-next').disabled = !eventMore;
    }).catch(report);
  }
  /**
   * 提交一次显式管理操作。
   * 业务逻辑: 使用已展示DTO的版本参数，通过同源Cookie提交。
   * 关键判断: 禁止并发写和409盲重发；旧视图收尾不能解除新操作锁；隐藏或关页不会调用后台取消接口。
   * 异常处理: 写失败保留提示，冲突使选中记录失效须刷新。
   * 参数: path,data,onSuccess。返回: 无。
   */
  function mutate(path, data, onSuccess) {
    var executionOperation = path === '/basic-settings/save-execution';
    if (executionOperation && !executionEditable()) return;
    var basicOperation = path === '/basic-settings/choose-directory' || path === '/basic-settings/save';
    if (basicOperation && !basicEditable()) return;
    if (mode === 'settings' && settingsTab !== 'keywords' && !basicOperation && !executionOperation) return;
    if ((mode === 'runs' && (basicOperation || path === '/settings' || path === '/reload')) || (mode === 'settings' && !basicOperation && path !== '/settings' && path !== '/reload' && !executionOperation)) return;
    if (!active || mutating) return;
    var view = epoch;
    var owner = selectedId;
    var runOperation = path === '/cancel' || path === '/retry';
    mutating = true; updateActions(); message('操作中');
    request(basicOperation || executionOperation ? '/dsh-trader-kit/review/api' + path : url(path), 'POST', data, 'mutation').then(function (value) {
      if (view !== epoch) return;
      message('操作完成');
      if (runOperation && owner !== selectedId) return;
      var lane = runOperation ? 'detail' : path === '/settings' || path === '/reload' ? 'registry' : null;
      if (lane) { if (controllers[lane]) controllers[lane].abort(); sequences[lane] = (sequences[lane] || 0) + 1; }
      if (onSuccess) onSuccess(value);
    }).catch(function (error) {
      if (view !== epoch) return;
      if (runOperation && owner === selectedId && error && error.message.indexOf('记录版本已变化') >= 0) selected = null;
      if ((path === '/settings' || path === '/reload') && error && error.message.indexOf('记录版本已变化') >= 0) { settingsStale = true; updateKeywordView(); el('keyword-badge').textContent = '配置版本已变化，刷新后保存'; }
      if (basicOperation && error && error.message.indexOf('记录版本已变化') >= 0) { basicStale = true; el('basic-editing-status').textContent = '配置版本已变化，请刷新后重新调整目录。'; }
      if (executionOperation && error && error.message.indexOf('记录版本已变化') >= 0) { executionStale = true; el('execution-status').textContent = '配置版本已变化，请刷新后重新填写执行设置。'; }
      report(error);
    }).then(function () { if (view !== epoch) return; mutating = false; updateActions(); });
  }
  /** 业务逻辑: 显式刷新当前读视图。关键判断: 只发GET，无自动重扫或重试。异常处理: 各通道独立提示。参数: 无。返回: 无。 */
  function refresh() { if (!active || mutating && mode === 'settings') return; message(''); if (mode === 'settings' && settingsTab === 'basic') { loadBasic(); return; } loadHealth(); loadRegistry(); if (mode !== 'settings') { loadRuns(false); if (selectedId) selectRun(selectedId); } }
  /** 业务逻辑: 解析真实公历日期。关键判断: 不接受自动归一化日期。异常处理: 无效返回NaN。参数: value。返回: UTC毫秒。 */
  function dateValue(value) { var time = Date.parse(value + 'T00:00:00Z'); return /^\\d{4}-\\d{2}-\\d{2}$/.test(value) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN; }
  /** 业务逻辑: 执行用户明确范围的重扫。关键判断: 最多31自然日，翻页不得更换范围。异常处理: 非法范围或游标变更只提示。参数: next。返回: 无。 */
  function rescan(next) {
    if (mode === 'settings') return;
    var from = el('rescan-from').value; var to = el('rescan-to').value;
    var days = (dateValue(to) - dateValue(from)) / 86400000;
    if (!Number.isFinite(days) || days < 0 || days > 30) { message('请明确选择不超过31个自然日的起止日期'); return; }
    if (next && (!scanCursor || !scanRange || scanRange.from !== from || scanRange.to !== to)) { message('日期范围已变化，请重新开始重扫'); return; }
    var data = { dateFrom: from, dateTo: to };
    if (next) data.cursor = scanCursor;
    mutate('/rescan', data, function (result) { scanRange = { from: from, to: to }; scanCursor = result.nextCursor; el('rescan-next').disabled = !scanCursor; el('rescan-status').textContent = pretty(result); });
  }
  /** 业务逻辑: 停止本页请求并作废旧视图。关键判断: 仅中断HTTP，不取消后台运行。异常处理: 已结束请求忽略。参数: 无。返回: 无。 */
  function stop() { active = false; epoch += 1; mutating = false; updateActions(); Object.keys(controllers).forEach(function (lane) { controllers[lane].abort(); }); }
  /** 业务逻辑: 隐藏时停止，显示后等待手动刷新。关键判断: 不恢复轮询。异常处理: 无。参数: 无。返回: 无。 */
  function visibility() { if (document.hidden) stop(); else active = true; }
  el('refresh').addEventListener('click', refresh);
  /** 业务逻辑: 打开基础配置。关键判断: 只读。异常处理: 请求失败显式提示。参数: 无。返回: 无。 */
  el('settings-basic-tab').addEventListener('click', function () { chooseSettingsTab('basic'); });
  /** 业务逻辑: 选择标的目录草稿。关键判断: 显式点击才打开宿主选择器。异常处理: 沿请求提示。参数: 无。返回: 无。 */
  el('basic-stock-choose').addEventListener('click', function () { chooseBasicDirectory('stock'); });
  /** 业务逻辑: 选择模式目录草稿。关键判断: 只修改对应路径。异常处理: 取消保留草稿。参数: 无。返回: 无。 */
  el('basic-patterns-choose').addEventListener('click', function () { chooseBasicDirectory('patterns'); });
  el('basic-save').addEventListener('click', saveBasicDirectories);
  el('execution-save').addEventListener('click', saveExecution);
  /** 业务逻辑: 打开关键词工作流。关键判断: 仅用户选择才读取注册表。异常处理: 沿注册表提示。参数: 无。返回: 无。 */
  el('settings-keywords-tab').addEventListener('click', function () { chooseSettingsTab('keywords'); });
  /** 业务逻辑: 应用用户筛选。关键判断: 从首游标开始。异常处理: API显示非法输入。参数: 无。返回: 无。 */
  el('filter').addEventListener('click', function () { runCursor = null; loadRuns(false); });
  /** 业务逻辑: 下一页运行。关键判断: 有游标才读取。异常处理: 失败保留列表。参数: 无。返回: 无。 */
  el('runs-next').addEventListener('click', function () { loadRuns(true); });
  /** 业务逻辑: 下一页日志。关键判断: 沿当前run游标。异常处理: 失败不推进。参数: 无。返回: 无。 */
  el('events-next').addEventListener('click', function () { loadEvents(true); });
  /** 业务逻辑: 显式取消选中运行。关键判断: 使用展示版本与必填原因。异常处理: 缺原因拒绝，409须刷新。参数: 无。返回: 无。 */
  el('cancel').addEventListener('click', function () { if (!selected || mutating) return; var reason = el('cancel-reason').value; if (!reason.trim()) { message('请填写取消原因'); return; } mutate('/cancel', { runId: selected.runId, recordVersion: selected.recordVersion, reason: reason }, renderSelected); });
  /** 业务逻辑: 显式重试选中运行。关键判断: 带recordVersion和expectedInputRevision。异常处理: 冲突不重发。参数: 无。返回: 无。 */
  el('retry').addEventListener('click', function () {
    if (!selected || mutating) return;
    mutate('/retry', { runId: selected.runId, recordVersion: selected.recordVersion, expectedInputRevision: selected.inputRevision }, function (registered) {
      selectRun(registered.runId);
      loadRuns(false);
    });
  });
  /** 业务逻辑: 显式重新加载配置。关键判断: 非读取自动触发。异常处理: 服务拒绝显示提示。参数: 无。返回: 无。 */
  el('reload').addEventListener('click', function () { mutate('/reload', {}, renderRegistry); });
  /** 业务逻辑: 开始指定日期重扫。关键判断: 不沿用旧游标。异常处理: 范围非法只提示。参数: 无。返回: 无。 */
  el('rescan').addEventListener('click', function () { rescan(false); });
  /** 业务逻辑: 继续指定范围重扫。关键判断: 保持原范围。异常处理: 变更后需重新开始。参数: 无。返回: 无。 */
  el('rescan-next').addEventListener('click', function () { rescan(true); });
  window.addEventListener('pagehide', stop);
  /** 业务逻辑: 恢复页面操作能力。关键判断: 不自动读取或执行。异常处理: 隐藏页仍停止。参数: 无。返回: 无。 */
  window.addEventListener('pageshow', function () { active = document.hidden !== true; });
  document.addEventListener('visibilitychange', visibility);
  /** 业务逻辑: 打开所选关键词配置。关键判断: 不提交配置。异常处理: 无映射忽略。参数: 无。返回: 无。 */
  el('keyword-config-tab').addEventListener('click', function () { chooseKeywordTab('config'); });
  /** 业务逻辑: 打开所选关键词历史。关键判断: 固定当前workflowId只读。异常处理: 无映射不请求。参数: 无。返回: 无。 */
  el('keyword-history-tab').addEventListener('click', function () { chooseKeywordTab('history'); });
  /** 业务逻辑: 只保存当前关键词映射的工作流开关。关键判断: CAS版本、当前登记身份与显式点击缺一不可。异常处理: 版本冲突后禁用保存，须刷新。参数: 无。返回: 无。 */
  el('keyword-save').addEventListener('click', function () { var workflow = keywordWorkflow(); if (mode !== 'settings' || settingsTab !== 'keywords' || !workflow || settingsStale) return; mutate('/settings', { settingsRevision: registry.settingsRevision, workflows: [{ workflowId: workflow.id, enabled: el('keyword-enabled').checked }] }, renderRegistry); });
  /** 业务逻辑: hash切换后只读取当前视图。关键判断: 先作废旧请求与选中身份，禁止迟到结果跨视图更新或触发模型。异常处理: 隐藏页等待手动刷新。参数: 无。返回: 无。 */
  window.addEventListener('hashchange', function () { resetKeywordRequests(); clearBasic('读取中'); clearExecution(); settingsTab = 'basic'; keywordTab = 'history'; scanCursor = null; scanRange = null; configureView(); updateActions(); refresh(); });
  configureView();
  refresh();
})();
</script></body></html>`
