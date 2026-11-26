# 对齐原生体验实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除评论区初始加载的闪烁与请求风暴（滚动分页 + 增量渲染），单条评论信息密度对齐原生，新增 IP 属地显示

**Architecture:** 改动集中在内容脚本层：新增 UMD 纯逻辑模块 `src/reply-utils.js`（可 node:test 单测），`content.js` 改造加载策略（单页 + IntersectionObserver 触底翻页）与渲染层（全量 `renderAll` 只留给重置场景，数据到达走 `appendNewRoots` / `patchRoot` 子树级更新），渲染函数与 `styles.css` 改双列高密度布局并支持长文折叠。UI 状态延续现有 JS state 体系（Map/Set），DOM 永远可从 state 重建

**Tech Stack:** Manifest V3 / 原生 JavaScript（无框架）/ IntersectionObserver / -webkit-line-clamp / node:test

**Spec:** docs/superpowers/specs/2026-11-26-native-alignment-design.md

## Global Constraints

1. 不新增任何持久化设置项；默认展开回复的产品行为不变（设计 §2.2）
2. `src/theme.js` 逻辑不动；`apiGetFromPage` 优先、`apiGet` 兜底的双通道请求结构不动
3. 一切 UI 状态（树展开/收起、回复输入框、长文展开）存 JS state，不依赖 DOM 存活；`storeGeneration` 代际保护必须保留
4. 每个任务收尾 `node --test test/` 全绿；`test/theme.test.js` 不回归
5. manifest.json 的 content_scripts js 顺序：theme.js → reply-utils.js → content.js；版本号 0.3.0 → 0.4.0 仅在任务 7 执行
6. 验证接口不用裸 curl 下结论（高频直连触发风控 -352），浏览器验证一律走页面上下文
7. 浏览器验证环境：Chrome 开发者模式「加载已解压的扩展程序」指向本 worktree 根目录；每次改码后到 chrome://extensions 点扩展的「重新加载」，再强刷视频页。可用 chrome-devtools MCP 自动化；若无法附着扩展环境则手动操作并截图留证
8. 新增 UI 文案与文档一律中文全角标点；commit 遵循仓库惯例（feat/fix/perf/docs/chore: 中文描述）
9. 计划中的行号按 HEAD 144cf4f 标定，仅供定位；前序任务造成漂移后以函数名/选择器为准

## Review Focus

1. 接口持续出错时滚动自动翻页形成无限重试循环——`canAutoLoadRoots` 在 `error` 非空时必须阻断（任务 1 单测钉住；任务 3 的 observer 仅经该门控放行）
2. 风控截断态下自动重试风暴——`canAutoLoadRoots` 在 `truncated=true` 时阻断，「更多评论」按钮保持可点作手动重试（任务 1 单测钉住；任务 7 回归走查）
3. 未登录/2022-07 前老评论的 `location` 缺失出现占位或报错——`normalizeLocation` 缺失返回 `""`，`renderMeta` 空值不输出 span（任务 1 单测钉住；任务 7 无痕窗口验收）
4. 点赞等局部重绘后长文「已展开」状态丢失——展开集合存 state，`patchRoot` 尾部重同步折叠状态（任务 6 浏览器步骤钉住）
5. 换视频（SPA 路由）后滚动加载与回复队列串到旧视频——`resetRootComments` + 代际保护 + `renderAll` 清空元素缓存（任务 7 浏览器步骤钉住）

---

### Task 1: reply-utils 纯逻辑模块 + 单测

**Files:**
- Create: `src/reply-utils.js`
- Create: `test/reply-utils.test.js`
- Modify: `manifest.json:34-37`（js 数组插入 reply-utils.js）

**Interfaces:**
- Consumes: 无
- Produces: 全局 `window.BtrReplyUtils` 与 `module.exports`，含三个纯函数：
  - `normalizeLocation(rawReply) -> string`：取 `rawReply?.reply_control?.location`，非字符串或缺失返回 `""`
  - `resolveMaxLine(rawReply) -> number`：取 `rawReply?.reply_control?.max_line`，非有限正数返回默认 6
  - `canAutoLoadRoots(cursor) -> boolean`：`cursor` 的 `loading`/`paging`/`isEnd`/`truncated` 任一为真或 `error` 非空字符串时返回 false，否则 true

- [ ] **Step 1: 写失败测试 `test/reply-utils.test.js`**（风格参照 `test/theme.test.js`：node:test + assert/strict）

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeLocation, resolveMaxLine, canAutoLoadRoots } = require("../src/reply-utils.js");

test("normalizeLocation 取 reply_control.location 原值", () => {
  assert.equal(normalizeLocation({ reply_control: { location: "IP属地：广东" } }), "IP属地：广东");
});

test("normalizeLocation 缺失或非字符串返回空串", () => {
  assert.equal(normalizeLocation({}), "");
  assert.equal(normalizeLocation(null), "");
  assert.equal(normalizeLocation({ reply_control: {} }), "");
  assert.equal(normalizeLocation({ reply_control: { location: 42 } }), "");
});

test("resolveMaxLine 取接口值", () => {
  assert.equal(resolveMaxLine({ reply_control: { max_line: 4 } }), 4);
});

test("resolveMaxLine 缺失或非正数回退 6", () => {
  assert.equal(resolveMaxLine({}), 6);
  assert.equal(resolveMaxLine(null), 6);
  assert.equal(resolveMaxLine({ reply_control: { max_line: 0 } }), 6);
});

const IDLE_CURSOR = { loading: false, paging: false, isEnd: false, truncated: false, error: "" };

test("canAutoLoadRoots 空闲且未结束时放行", () => {
  assert.equal(canAutoLoadRoots(IDLE_CURSOR), true);
});

test("canAutoLoadRoots 忙/结束/截断/出错逐一阻断", () => {
  assert.equal(canAutoLoadRoots({ ...IDLE_CURSOR, loading: true }), false);
  assert.equal(canAutoLoadRoots({ ...IDLE_CURSOR, paging: true }), false);
  assert.equal(canAutoLoadRoots({ ...IDLE_CURSOR, isEnd: true }), false);
  assert.equal(canAutoLoadRoots({ ...IDLE_CURSOR, truncated: true }), false);
  assert.equal(canAutoLoadRoots({ ...IDLE_CURSOR, error: "网络错误" }), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/`
Expected: FAIL，报 `Cannot find module '../src/reply-utils.js'`

- [ ] **Step 3: 实现 `src/reply-utils.js`**

UMD 骨架照抄 `src/theme.js:1-10`（factory 返回 API 对象，`module.exports` + `root.BtrReplyUtils` 双挂载，无 document 依赖、无自启动）。三个函数体即 Produces 中一句话语义，默认行数常量 `DEFAULT_MAX_LINE = 6`

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/`
Expected: PASS，reply-utils 与 theme 测试全绿

- [ ] **Step 5: manifest.json 注册脚本**

js 数组改为 `["src/theme.js", "src/reply-utils.js", "src/content.js"]`（顺序即执行顺序，content.js 依赖该全局）

- [ ] **Step 6: Commit**

```bash
git add src/reply-utils.js test/reply-utils.test.js manifest.json
git commit -m "feat: 新增 reply-utils 纯逻辑模块（属地归一化、折叠行数、自动加载门控）"
```

### Task 2: IP 属地显示

**Files:**
- Modify: `src/content.js`（IIFE 顶部、`normalizeReply:195-224`、`renderMeta:294-317`）

**Interfaces:**
- Consumes: `window.BtrReplyUtils.normalizeLocation`（任务 1）
- Produces: `normalizeReply` 返回对象新增字段 `location: string`；`renderMeta` 在时间 span 后输出属地 span

- [ ] **Step 1: content.js IIFE 顶部引入工具**

在常量声明区（`ROOT_PAGE_INTERVAL_MS` 之后）加一行，附注释「依赖 manifest 脚本顺序，reply-utils.js 先于本文件执行」：

```js
const { normalizeLocation, resolveMaxLine, canAutoLoadRoots } = window.BtrReplyUtils;
```

（`resolveMaxLine`/`canAutoLoadRoots` 本任务暂不用，任务 3/6 消费，一次引入避免重复改）

- [ ] **Step 2: normalizeReply 增加 location 字段**

返回对象中 `timeText` 行之后加：`location: normalizeLocation(reply),`

- [ ] **Step 3: renderMeta 渲染属地**

时间 span（`<span>${escapeHtml(reply.timeText)}</span>`）之后插入：

```js
${reply.location ? `<span>${escapeHtml(reply.location)}</span>` : ""}
```

- [ ] **Step 4: 单测回归**

Run: `node --test test/`
Expected: PASS（纯函数已被任务 1 覆盖，本任务只接线）

- [ ] **Step 5: 浏览器冒烟**

按 Global Constraints 7 加载扩展，打开评论数多的视频页：控制台无报错；登录态下根评论与楼中楼的元信息行时间之后出现「IP属地：xx」；用 devtools 检查一条 2022 年前的老评论（或退出登录），确认无该 span、无空占位

- [ ] **Step 6: Commit**

```bash
git add src/content.js
git commit -m "feat: 元信息行显示 IP 属地（登录态可见，缺失静默隐藏）"
```

### Task 3: 滚动分页

**Files:**
- Modify: `src/content.js`（常量区 `:3-6`、`loadRootComments:388-439`、`sleep:352`、`setupPanel:982-1088`）

**Interfaces:**
- Consumes: `canAutoLoadRoots`（任务 1）
- Produces: `loadRootComments()` 语义变更为「每次调用最多加载 1 页」，函数签名不变；`setupPanel` 内新建 IntersectionObserver 观察 `.btr-footer`

- [ ] **Step 1: 清理废弃常量与函数**

删除 `MAX_AUTO_ROOT_PAGES`、`ROOT_PAGE_INTERVAL_MS`；`grep -n "sleep(" src/content.js` 确认 `loadRootComments` 是唯一调用者后连 `sleep` 函数一并删除（若另有调用者则保留函数）

- [ ] **Step 2: loadRootComments 改单页**

去掉 `for` 循环体与循环尾部的 `await sleep(...)`，保留循环体内全部逻辑且顺序不变：busy 守卫（`:389`）→ 置 `paging`/清 `error`/`truncated` → `ensureAid` → 置 `loading` + `render()` → `fetchRootPage` → 去重追加 `state.roots` → 更新 `offset`/`total`/`loaded` → `render()` + `autoLoadReplyPages(incoming)` → `endClaimed` 判定与截断检测（`:424-429`，`break` 改为自然结束）→ catch/finally 不变。改后函数对「更多评论」按钮与 observer 是同一个入口，点一次/触发一次只拉一页

- [ ] **Step 3: setupPanel 挂 IntersectionObserver**

在 `nativeHost.insertBefore(shell, ...)` 之后、事件接线之前：

```js
const footer = shell.querySelector(".btr-footer");
new IntersectionObserver((entries) => {
  if (!entries.some((entry) => entry.isIntersecting)) return;
  if (!canAutoLoadRoots(state.rootCursor)) return;
  loadRootComments();
}, { rootMargin: "300px 0px" }).observe(footer);
```

observer 生命周期与面板一致（面板常驻，换视频不重建），无需显式 disconnect；原生评论区模式下 `.btr-footer` 被 `display:none`（styles.css:397-404），IntersectionObserver 对无布局盒的元素不触发，天然挂起

- [ ] **Step 4: 单测回归**

Run: `node --test test/`
Expected: PASS

- [ ] **Step 5: 浏览器验收（请求数）**

打开评论数 > 200 的视频，devtools Network 过滤 `reply`：
1. 首屏只出现 1 次 `reply/main`，随后 `reply/reply` 次数 ≤ 首页有回复的根评论数
2. 滚动到列表底部前无第 2 次 `reply/main`；距底部约一屏内自动出现第 2 次
3. 点「更多评论」一次只追加一页；评论全部加载完后按钮变「没有更多评论」且滚动不再发请求
4. 状态栏「已加载 X/Y」随滚动增长

- [ ] **Step 6: Commit**

```bash
git add src/content.js
git commit -m "feat: 根评论改滚动分页，首屏 1 页、触底自动加载下一页"
```

### Task 4: 增量渲染

**Files:**
- Modify: `src/content.js`（`render:790-820` 拆分；全部 16 处 `render()` 调用点重映射；`setupPanel` refresh 分支 `:1066-1070`）

**Interfaces:**
- Consumes: `renderRoot(root) -> string`（现有）；`state.roots`、`state.replyStores`
- Produces（后续任务依赖的渲染 API）:
  - `rootElements: Map<string, HTMLElement>`：rootId → 列表中的实元素
  - `renderAll()`：全量重建列表 + 重建 rootElements + renderStatus，用于整体重置
  - `renderStatus()`：只更新 `.btr-status` 文案与「更多评论」按钮 disabled/文案，不触碰列表
  - `appendNewRoots()`：把 state.roots 中未入缓存的根按序 append 进 `.btr-list` 并入缓存
  - `patchRoot(rootId: string)`：子树级更新单条根评论，缓存 miss 时回退 renderAll

- [ ] **Step 1: 拆分 render**

现 `render()` 改名 `renderAll()`，其中状态文案与按钮两行逻辑（`:798-817`）抽成 `renderStatus()` 并由 `renderAll` 尾部调用；`list.innerHTML = ...` 之后重建缓存：逐元素 `rootElements.set(root.id, el)`（用 `renderRoot` 字符串经临时容器 `firstElementChild` 建元素再 append 的方式重写列表构建，使缓存与 DOM 同源）。新增 `appendNewRoots()` 与 `patchRoot(rootId)`

`patchRoot` 机制（锚点替换，保证根评论头像/正文 DOM 不动）：

1. `state.roots` 找根，缓存取实元素，miss 则 `renderAll()` 返回
2. `renderRoot(root)` 全量字符串经 `<template>` 解析为新元素
3. 对锚点选择器列表 `[".btr-reply-tree", ".btr-meta", ".btr-error", ".btr-reply-form", ".btr-actions"]` 逐一处理：旧新都有且 `outerHTML` 相同 → 跳过；都有且不同 → `replaceWith`；仅新有 → 按新元素中的位置插入；仅旧有 → 移除。`.btr-reply-tree`/`.btr-actions` 在根元素与 `.btr-root-main` 两层各查一次（树内还有「加载更多回复」的 `.btr-actions`，随树整体替换，无需单独锚定）
4. 任务 6 会在尾部追加折叠状态同步，此处预留函数收尾单一出口

- [ ] **Step 2: 重映射全部调用点**

`grep -n "render()" src/content.js` 逐处按下表替换（行号为 HEAD 144cf4f 标定）：

| 原调用点 | 新调用 |
| --- | --- |
| loadRootComments 开始置 loading（:399） | `renderStatus()` |
| loadRootComments 页到达追加后（:421） | `appendNewRoots(); renderStatus();` |
| loadRootComments finally（:437） | `renderStatus()` |
| loadReplies 开始/finally 非 silent（:513、:551） | `patchRoot(root.id); renderStatus();` |
| toggleStore（:562） | `patchRoot(root.id)` |
| runAutoReplyQueue 每树完成（:592） | `patchRoot(root.id); renderStatus();` |
| runAutoReplyQueue finally（:596） | `renderStatus()` |
| handleReaction finally（:678） | `const owner = findRootForReply(reply); owner ? patchRoot(owner.id) : renderAll();` |
| submitReply 空内容（:690）与 catch（:719） | 同上按 `findRootForReply(reply)` 定位 patchRoot |
| start-reply 点击（:1036） | 按 `target.dataset.replyId` → `findReplyById` → `findRootForReply` 定位 `patchRoot` |
| cancel-reply 点击（:1041） | 置空前先从 `target.closest(".btr-reply-form").dataset.replyId` 定位所属根再 `patchRoot` |
| sort-roots（:1061） | `renderAll()` |
| setupPanel 初始（:1086） | `renderAll()` |
| 换视频 interval（:1133） | `renderAll()` |

另两处补齐：refresh 分支（:1066-1070）在 `resetRootComments()` 后新增 `renderAll()`（否则重置后旧 DOM 滞留，旧代码靠全量 render 兜底，拆分后必须显式清）；凡调用 `resetRootComments` 的路径（sort-roots、refresh、换视频）之后必须紧跟 `renderAll()`

- [ ] **Step 3: 单测回归**

Run: `node --test test/`
Expected: PASS

- [ ] **Step 4: 浏览器验收（无闪烁 + 元素存活）**

打开评论多的视频，控制台执行探针：

```js
window.__probeAvatar = document.querySelector(".btr-root .btr-avatar");
```

1. 等首屏回复树陆续加载、再滚动追加 2～3 页后执行 `document.querySelector(".btr-root .btr-avatar") === window.__probeAvatar`，Expected: `true`（首条根评论头像元素全程未被销毁重建）
2. 肉眼观察：打开视频到加载稳定，已渲染区域无连续闪烁；新回复树出现时只有那棵树变化
3. 点赞任意评论：仅该条所在子树更新，滚动位置不跳动
4. 展开/收起一棵树、打开/取消回复输入框：均局部更新
5. 点「刷新树形评论」与切换「最新」排序：列表整体清空重建（renderAll 路径），随后滚动加载恢复工作

- [ ] **Step 5: Commit**

```bash
git add src/content.js
git commit -m "perf: 渲染改增量更新，数据到达走追加与子树级 patchRoot，消除全量重建闪烁"
```

### Task 5: 布局结构对齐原生

**Files:**
- Modify: `src/content.js`（`renderAvatar:267-275`、`renderAuthor:282-292`、`renderReplyNode:723-741`、`renderRoot:743-780`）
- Modify: `src/styles.css`（`.btr-root`、`.btr-author-row`、`.btr-message`、`.btr-meta`、`.btr-actions`、`.btr-reply-tree`、`.btr-node*`、640px 断点）

**Interfaces:**
- Consumes: `patchRoot` 的锚点选择器约定（任务 4）——重构后 `.btr-meta`、`.btr-reply-tree` 等锚点类名必须保持不变，否则 patchRoot 失效
- Produces: `renderAvatarColumn(reply) -> string`（头像 + 大会员角标，左列）；`renderAuthorLine(reply, extra) -> string`（用户名 + 等级，右列首行）；根评论 DOM 新结构：

```html
<section class="btr-root">            <!-- flex 行 -->
  <div class="btr-avatar-col">…</div>
  <div class="btr-root-content">      <!-- flex 列，min-width:0 -->
    <div class="btr-root-main">作者行/正文/图片/元信息行/错误/输入框/收起态入口</div>
    <div class="btr-reply-tree">…节点… + 底部「收起相关回复」</div>
  </div>
</section>
```

- [ ] **Step 1: 渲染函数改双列**

1. `renderAuthor` 拆为 `renderAvatarColumn`（沿用 `renderAvatar` 输出，包 `.btr-avatar-col`）与 `renderAuthorLine`（`.btr-author-row` 内只剩用户名 + 等级 + extra）
2. `renderRoot`：按 Produces 的新结构组装；元信息行保持单行 flex（时间、属地、点赞、点踩、回复）；**展开态**的「收起相关回复」按钮移到 `.btr-reply-tree` 底部（原生同位置）；**收起态**的「展开相关回复 X/Y」入口留在 `.btr-root-main` 尾部元信息行之下（保留 `.btr-actions` 类名以兼容 patchRoot 锚点）
3. `renderReplyNode`：同样改「头像列 + 内容列」双列，`.btr-node-line` 与 `--btr-depth` 缩进保留，节点内元信息同规则合行

- [ ] **Step 2: CSS 密度改造**

1. `.btr-root`：`display:flex; gap` 约 12px；`padding: 20px 0` 收到 `12px 0`
2. `.btr-message`/`.btr-meta`/`.btr-pictures` 的 `margin-top: 8px` 收紧到 4～6px；`.btr-reply-tree` 同步收紧
3. `.btr-node` 缩进与 `.btr-node-line` 定位适配双列：竖线对齐父级头像列水平中心（具体偏移浏览器实测定）；层级视觉必须保留
4. 640px 断点内的 `.btr-node` 缩进值同步适配
5. 目标：单行文字根评论总高约 100px（±20% 即 80～120px）

- [ ] **Step 3: 单测回归**

Run: `node --test test/`
Expected: PASS

- [ ] **Step 4: 浏览器验收（高度与视觉）**

1. devtools 选中一条单行文字根评论读 `offsetHeight`，Expected: 80～120
2. 同一视频截图：插件单条评论与原生评论区同高度档对比，观感接近
3. 树形缩进线在双列布局下层级清晰，深层（>4 级）回复不溢出
4. 窗口压到约 400px 宽：元信息行 flex-wrap 换行不破版
5. 暗色主题下边框/竖线颜色正常
6. 交互回归：展开/收起树、点赞、回复输入框、发一条回复（成功后树刷新且新回复可见）

- [ ] **Step 5: Commit**

```bash
git add src/content.js src/styles.css
git commit -m "feat: 布局对齐原生——头像左置双列、元信息合行、收起入口移树底、间距收紧"
```

### Task 6: 长文按 max_line 折叠

**Files:**
- Modify: `src/content.js`（`normalizeReply`、`state:8-34`、`resetRootComments:332-350`、换视频重置块 `:1124-1131`、`renderRoot`/`renderReplyNode` 正文处、`patchRoot` 收尾、`setupPanel` 点击接线）
- Modify: `src/styles.css`（`.btr-message`、新增 `.btr-message--expanded`、`.btr-clamp-toggle`）

**Interfaces:**
- Consumes: `resolveMaxLine`（任务 1）；`patchRoot`（任务 4，收尾处追加同步调用）
- Produces:
  - `normalizeReply` 新增字段 `maxLine: number`
  - `state.expandedMessages: Set<string>`（已展开全文的 reply id）
  - `syncMessageClamps(container: HTMLElement)`：对容器内每条 `.btr-message` 依据实际溢出与 Set 状态同步折叠类名和按钮可见性/文案
  - 新 data-action：`expand-message`（携带 `data-reply-id`）

- [ ] **Step 1: state 与归一化**

1. `state` 增加 `expandedMessages: new Set()`；`resetRootComments` 与换视频重置块中 `state.expandedMessages.clear()`
2. `normalizeReply` 返回对象加 `maxLine: resolveMaxLine(reply),`

- [ ] **Step 2: 渲染折叠结构**

`renderRoot`/`renderReplyNode` 中正文 div 改为：

```html
<div class="btr-message" data-reply-id="${reply.id}" style="--btr-max-line:${reply.maxLine}">…</div>
<button class="btr-clamp-toggle" type="button" data-action="expand-message" data-reply-id="${reply.id}" hidden>展开</button>
```

展开态由 `syncMessageClamps` 加 `.btr-message--expanded` 类并把按钮文案设「收起」

- [ ] **Step 3: CSS**

```css
.btr-message { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--btr-max-line, 6); overflow: hidden; }
.btr-message--expanded { display: block; -webkit-line-clamp: unset; overflow: visible; }
```

`.btr-clamp-toggle` 并入现有 `.btr-button, .btr-link-button` 选择器组获得同款样式，另加 `margin-top: 2px`

- [ ] **Step 4: syncMessageClamps 与调用点**

实现：遍历 `container.querySelectorAll(".btr-message")`，按 `data-reply-id` 查 Set——已展开：加 `--expanded` 类、按钮取消 hidden、文案「收起」；未展开：移除类，渲染后比较 `scrollHeight > clientHeight + 1`，溢出则显示按钮文案「展开」，否则 `hidden = true`。调用点：`renderAll` 尾部（container = `.btr-list`）、`appendNewRoots` 尾部（仅新元素）、`patchRoot` 锚点替换完成后（container = 该根元素）

- [ ] **Step 5: 点击接线**

`setupPanel` 点击处理器新增分支：`expand-message` → 按 `data-reply-id` 在 `state.expandedMessages` 中 toggle → `findReplyById` + `findRootForReply` 定位所属根 → `patchRoot(root.id)`

- [ ] **Step 6: 单测回归**

Run: `node --test test/`
Expected: PASS

- [ ] **Step 7: 浏览器验收（折叠）**

1. 找一条超 6 行的长评论：默认折叠为 6 行且显示「展开」；短评论无按钮
2. 点「展开」全文 + 按钮变「收起」，点「收起」还原
3. 展开一条长文后点赞同棵树内另一条评论（触发 patchRoot）：展开状态保持
4. 展开后切换排序再切回：状态清空属预期（整体重置）
5. 楼中楼内的长回复同样生效

- [ ] **Step 8: Commit**

```bash
git add src/content.js src/styles.css
git commit -m "feat: 长评论按接口 max_line 折叠，展开状态存 state 不随重绘丢失"
```

### Task 7: 集成验收 + 发布收尾

**Files:**
- Modify: `manifest.json:5`（version）
- Modify: `README.md`、`STORE_LISTING.md`（功能文案）

**Interfaces:**
- Consumes: 任务 1-6 全部产出
- Produces: 可发布状态

- [ ] **Step 1: 单测全绿**

Run: `node --test test/`
Expected: PASS，无跳过

- [ ] **Step 2: 浏览器全量回归（设计 §7 验收清单）**

用评论数 > 500 的视频逐项走查并留证（截图或 devtools 记录）：
1. 请求数：首屏 1 次 `reply/main`；滚动触底才翻页；截断提示出现时 observer 不再自动发请求，点「更多评论」可手动重试
2. 无闪烁：探针法（任务 4 Step 4）复验首条头像元素全程存活
3. 高度：单行根评论 80～120px，与原生截图对比
4. IP 属地：登录态显示；无痕窗口（未登录）静默不显示、控制台无报错
5. 长文折叠：折叠/展开/局部重绘状态保持（任务 6 Step 7 复验）
6. 回归清单：主题三态切换、切换到原评论区再切回（切回后滚动加载仍工作）、最热/最新排序、点赞/点踩互斥、发回复成功且新回复可见、换视频（SPA 点击推荐位）后列表清空重载且请求指向新 aid、刷新按钮
7. Review Focus 3/5 专项：无痕窗口验属地静默；换视频后 Network 确认新请求 `oid` 为新视频

- [ ] **Step 3: 版本号与文案**

1. `manifest.json` version：`0.3.0` → `0.4.0`
2. README.md 与 STORE_LISTING.md 功能清单补四条：IP 属地显示（登录用户）、滚动按需加载、信息密度对齐原生、长评论智能折叠；文案中文全角标点

- [ ] **Step 4: Commit**

```bash
git add manifest.json README.md STORE_LISTING.md
git commit -m "chore: v0.4.0 集成验收，更新商店与 README 文案"
```
