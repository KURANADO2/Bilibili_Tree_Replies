(() => {
  const COMMENT_TYPE_VIDEO = 1;
  const ROOT_PAGE_SIZE = 20;
  const REPLY_PAGE_SIZE = 20;
  const MAX_INDENT_DEPTH = 4;

  const state = {
    aid: null,
    bvid: null,
    rootCursor: {
      loaded: false,
      loading: false,
      error: "",
      mode: 3,
      page: 0,
      total: 0,
      isEnd: false,
    },
    roots: [],
    replyStores: new Map(),
    autoReplyQueueRunning: false,
    nativeVisible: false,
    activeReplyId: "",
    pageBridgeReady: false,
    pageBridgeReadyPromise: null,
    pageBridgeSeq: 0,
    pageBridgePending: new Map(),
  };

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function getInitialState() {
    const scripts = [...document.scripts];
    for (const script of scripts) {
      const text = script.textContent || "";
      const match = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+?\});\s*\(function/);
      if (!match) continue;
      try {
        return JSON.parse(match[1]);
      } catch {
        return null;
      }
    }
    return null;
  }

  function getBvidFromUrl() {
    const match = location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
    return match ? match[1] : "";
  }

  function ensurePageBridge() {
    if (state.pageBridgeReadyPromise) return state.pageBridgeReadyPromise;

    state.pageBridgeReadyPromise = new Promise((resolve, reject) => {
      const readyTimeout = window.setTimeout(() => {
        reject(new Error("页面代理加载超时"));
      }, 10000);

      window.addEventListener("message", (event) => {
        if (event.source !== window) return;

        if (event.data?.type === "BTR_PAGE_API_READY") {
          state.pageBridgeReady = true;
          window.clearTimeout(readyTimeout);
          resolve();
          return;
        }

        if (event.data?.type !== "BTR_PAGE_API_RESPONSE") return;
        const pending = state.pageBridgePending.get(event.data.requestId);
        if (!pending) return;
        state.pageBridgePending.delete(event.data.requestId);

        if (event.data.ok) {
          pending.resolve(event.data.data);
        } else {
          pending.reject(new Error(event.data.error || "页面请求失败"));
        }
      });

      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("src/page-proxy.js");
      script.async = false;
      script.onerror = () => reject(new Error("页面代理脚本加载失败"));
      (document.head || document.documentElement).append(script);
      script.remove();
    });

    return state.pageBridgeReadyPromise;
  }

  async function pageApi(type, path, params) {
    await ensurePageBridge();
    const requestId = `btr-${Date.now()}-${++state.pageBridgeSeq}`;

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        state.pageBridgePending.delete(requestId);
        reject(new Error("页面请求超时"));
      }, 15000);

      state.pageBridgePending.set(requestId, {
        resolve: (data) => {
          window.clearTimeout(timeout);
          resolve(data);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          reject(error);
        },
      });

      window.postMessage({
        type,
        requestId,
        path,
        params,
      }, "*");
    });
  }

  async function apiGet(path, params) {
    const response = await chrome.runtime.sendMessage({
      type: "BTR_API_GET",
      path,
      params,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "请求失败");
    }
    return response.data;
  }

  async function apiPost(path, params) {
    return pageApi("BTR_PAGE_API_POST", path, params);
  }

  async function apiGetFromPage(path, params) {
    return pageApi("BTR_PAGE_API_GET", path, params);
  }

  function getCsrf() {
    const match = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/);
    if (!match) throw new Error("需要登录后才能操作评论");
    return decodeURIComponent(match[1]);
  }

  async function ensureAid() {
    if (state.aid) return state.aid;

    const initialState = getInitialState();
    state.aid = initialState?.aid || initialState?.videoData?.aid || null;
    state.bvid = initialState?.bvid || initialState?.videoData?.bvid || getBvidFromUrl();

    if (!state.aid && state.bvid) {
      const data = await apiGet("/x/web-interface/view", { bvid: state.bvid });
      state.aid = data.aid;
    }

    if (!state.aid) {
      throw new Error("无法识别当前视频的 AID");
    }
    return state.aid;
  }

  function normalizeReply(reply) {
    const id = String(reply.rpid_str || reply.rpid);
    const rootId = String(reply.root_str || reply.root || id);
    const parentRaw = reply.parent_str || reply.parent || 0;
    const parentId = parentRaw && String(parentRaw) !== "0" ? String(parentRaw) : null;

    return {
      raw: reply,
      id,
      rootId,
      parentId,
      userId: String(reply.mid || reply.member?.mid || ""),
      userName: reply.member?.uname || "已注销用户",
      avatar: reply.member?.avatar || "",
      level: Number(reply.member?.level_info?.current_level || 0),
      isVip: Boolean(reply.member?.vip?.vipStatus),
      nameColor: reply.member?.vip?.nickname_color || "",
      message: cleanReplyPrefix(reply.content?.message || ""),
      like: Number(reply.like || 0),
      dislike: Number(reply.dislike || reply.hate || 0),
      liked: Number(reply.action || 0) === 1,
      disliked: Number(reply.hate_action || 0) === 1,
      actionError: "",
      ctime: Number(reply.ctime || 0),
      count: Number(reply.count || reply.rcount || 0),
      timeText: reply.reply_control?.time_desc || formatTime(reply.ctime),
      parentName: reply.parent_reply_member?.name || "",
    };
  }

  function formatTime(ctime) {
    if (!ctime) return "";
    const date = new Date(Number(ctime) * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderMessage(message) {
    return escapeHtml(message).replace(/\n/g, "<br>");
  }

  function cleanReplyPrefix(message) {
    return message.replace(/^\s*回复\s*@[^:：\s]+(?:\s*)[:：]\s*/, "");
  }

  function renderAvatar(reply) {
    if (!reply.avatar) return "";
    return `
      <span class="btr-avatar-wrap">
        <img class="btr-avatar" src="${escapeHtml(reply.avatar)}" alt="">
        ${reply.isVip ? `<span class="btr-vip-mark">大</span>` : ""}
      </span>
    `;
  }

  function renderLevel(reply) {
    if (!reply.level) return "";
    return `<span class="btr-level btr-level-${reply.level}">LV${reply.level}</span>`;
  }

  function renderAuthor(reply, extra = "") {
    const style = reply.nameColor ? ` style="color:${escapeHtml(reply.nameColor)}"` : "";
    return `
      <div class="btr-author-row">
        ${renderAvatar(reply)}
        <span class="btr-author"${style}>${escapeHtml(reply.userName)}</span>
        ${renderLevel(reply)}
        ${extra}
      </div>
    `;
  }

  function renderMeta(reply, options = {}) {
    const likeText = reply.like > 0 ? `<span>${reply.like}</span>` : "";
    const dislikeText = reply.dislike > 0 ? `<span>${reply.dislike}</span>` : "";
    const likedClass = reply.liked ? " btr-reaction--active" : "";
    const dislikedClass = reply.disliked ? " btr-reaction--active" : "";
    return `
      <div class="btr-meta">
        <span>${escapeHtml(reply.timeText)}</span>
        <button class="btr-meta-button btr-reaction${likedClass}" type="button" title="点赞" aria-label="点赞" data-action="like-reply" data-reply-id="${reply.id}">
          <svg class="btr-reaction-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.5 20.5H5.2c-1.1 0-2-.9-2-2v-7.1c0-1.1.9-2 2-2h2.3v11.1Zm2-10.8c1.4-1.3 2.4-3.2 2.7-5.3.1-.8.8-1.4 1.6-1.4 1.5 0 2.6 1.3 2.4 2.8l-.4 3h3.1c1.4 0 2.4 1.3 2.1 2.7l-1.4 6.4c-.4 1.6-1.8 2.7-3.4 2.7H9.5V9.7Z" fill="currentColor"></path>
          </svg>
          ${likeText}
        </button>
        <button class="btr-meta-button btr-reaction${dislikedClass}" type="button" title="点踩" aria-label="点踩" data-action="dislike-reply" data-reply-id="${reply.id}">
          <svg class="btr-reaction-icon btr-reaction-icon--down" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.5 20.5H5.2c-1.1 0-2-.9-2-2v-7.1c0-1.1.9-2 2-2h2.3v11.1Zm2-10.8c1.4-1.3 2.4-3.2 2.7-5.3.1-.8.8-1.4 1.6-1.4 1.5 0 2.6 1.3 2.4 2.8l-.4 3h3.1c1.4 0 2.4 1.3 2.1 2.7l-1.4 6.4c-.4 1.6-1.8 2.7-3.4 2.7H9.5V9.7Z" fill="currentColor"></path>
          </svg>
          ${dislikeText}
        </button>
        <button class="btr-meta-button" type="button" data-action="start-reply" data-reply-id="${reply.id}">${options.replyText || "回复"}</button>
      </div>
    `;
  }

  function renderReplyForm(reply) {
    if (state.activeReplyId !== reply.id) return "";
    return `
      <form class="btr-reply-form" data-reply-id="${reply.id}">
        <textarea class="btr-reply-input" name="message" rows="3" placeholder="回复 @${escapeHtml(reply.userName)}"></textarea>
        <div class="btr-reply-form-actions">
          <button class="btr-button btr-button--primary" type="submit">发布</button>
          <button class="btr-button" type="button" data-action="cancel-reply">取消</button>
        </div>
      </form>
    `;
  }

  async function loadRootComments() {
    if (state.rootCursor.loading || state.rootCursor.isEnd) return;
    state.rootCursor.loading = true;
    state.rootCursor.error = "";
    render();

    try {
      const aid = await ensureAid();
      const nextPage = state.rootCursor.page + 1;
      const data = await apiGet("/x/v2/reply", {
        type: COMMENT_TYPE_VIDEO,
        oid: aid,
        pn: nextPage,
        ps: ROOT_PAGE_SIZE,
        sort: state.rootCursor.mode === 3 ? 2 : 0,
      });
      const incoming = (data.replies || []).map(normalizeReply);
      const seen = new Set(state.roots.map((reply) => reply.id));
      incoming.forEach((reply) => {
        if (!seen.has(reply.id)) {
          state.roots.push(reply);
          seen.add(reply.id);
        }
      });

      const page = data.page || {};
      state.rootCursor.page = nextPage;
      state.rootCursor.total = Number(page.count || state.rootCursor.total || state.roots.length);
      state.rootCursor.isEnd = incoming.length === 0 || state.roots.length >= state.rootCursor.total;
      state.rootCursor.loaded = true;
      autoLoadReplyPages(incoming);
    } catch (error) {
      state.rootCursor.error = error.message || String(error);
    } finally {
      state.rootCursor.loading = false;
      render();
    }
  }

  function createReplyStore(root) {
    return {
      root,
      page: 0,
      total: root.count || 0,
      isEnd: root.count === 0,
      loading: false,
      error: "",
      expanded: root.count > 0,
      autoLoaded: false,
      limitedByApi: false,
      nodes: new Map(),
      topLevel: [],
      pendingChildren: new Map(),
    };
  }

  function getReplyStore(root) {
    if (!state.replyStores.has(root.id)) {
      state.replyStores.set(root.id, createReplyStore(root));
    }
    return state.replyStores.get(root.id);
  }

  function insertChildSorted(children, child) {
    if (children.some((node) => node.id === child.id)) return;
    children.push(child);
    children.sort((a, b) => {
      if (a.ctime !== b.ctime) return a.ctime - b.ctime;
      return Number(a.id) - Number(b.id);
    });
  }

  function addNodeToStore(store, reply) {
    if (store.nodes.has(reply.id)) return;

    const node = {
      ...reply,
      children: [],
    };
    store.nodes.set(node.id, node);

    const waiting = store.pendingChildren.get(node.id);
    if (waiting) {
      waiting.forEach((child) => insertChildSorted(node.children, child));
      store.pendingChildren.delete(node.id);
    }

    if (!node.parentId || node.parentId === store.root.id) {
      insertChildSorted(store.topLevel, node);
      return;
    }

    const parent = store.nodes.get(node.parentId);
    if (parent) {
      insertChildSorted(parent.children, node);
      return;
    }

    if (!store.pendingChildren.has(node.parentId)) {
      store.pendingChildren.set(node.parentId, []);
    }
    insertChildSorted(store.pendingChildren.get(node.parentId), node);
  }

  async function loadReplies(root, options = {}) {
    const store = getReplyStore(root);
    if (store.loading || store.isEnd) return;

    store.expanded = true;
    store.loading = true;
    store.error = "";
    if (!options.silent) render();

    try {
      const aid = await ensureAid();
      const nextPage = options.restart ? 1 : store.page + 1;
      if (options.restart) {
        store.page = 0;
        store.isEnd = false;
        store.nodes.clear();
        store.topLevel = [];
        store.pendingChildren.clear();
      }

      const replyParams = {
        type: COMMENT_TYPE_VIDEO,
        oid: aid,
        root: root.id,
        pn: nextPage,
        ps: REPLY_PAGE_SIZE,
      };
      let data;
      try {
        data = await apiGet("/x/v2/reply/reply", replyParams);
      } catch (error) {
        if (!(error.message || "").includes("412")) throw error;
        data = await apiGetFromPage("/x/v2/reply/reply", replyParams);
      }

      const replies = (data.replies || []).map(normalizeReply);
      replies.forEach((reply) => addNodeToStore(store, reply));

      const page = data.page || {};
      store.page = nextPage;
      store.total = Number(page.count || store.total || replies.length);
      store.isEnd = replies.length === 0 || store.nodes.size >= store.total;
    } catch (error) {
      store.error = error.message || String(error);
    } finally {
      store.loading = false;
      if (!options.silent) render();
    }
  }

  function toggleStore(root) {
    const store = getReplyStore(root);
    store.expanded = !store.expanded;
    if (store.expanded && store.nodes.size === 0 && !store.isEnd) {
      loadReplies(root);
      return;
    }
    render();
  }

  async function autoLoadReplyPages(roots) {
    if (state.autoReplyQueueRunning) return;
    state.autoReplyQueueRunning = true;

    try {
      for (const root of roots) {
        const store = getReplyStore(root);
        if (store.autoLoaded || store.loading || store.isEnd || root.count <= 0) continue;
        seedPreviewReplies(root);
        if (store.isEnd) continue;
        store.autoLoaded = true;
        await loadReplies(root, { silent: true });
      }
    } finally {
      state.autoReplyQueueRunning = false;
      render();
    }
  }

  function seedPreviewReplies(root) {
    const previewReplies = root.raw?.replies || [];
    if (!previewReplies.length) return false;

    const store = getReplyStore(root);
    previewReplies.map(normalizeReply).forEach((reply) => addNodeToStore(store, reply));
    store.total = root.count;
    store.isEnd = store.nodes.size >= store.total;
    store.autoLoaded = true;
    return true;
  }

  function findReplyById(id) {
    const root = state.roots.find((item) => item.id === id);
    if (root) return root;

    for (const store of state.replyStores.values()) {
      const node = store.nodes.get(id);
      if (node) return node;
    }

    return null;
  }

  function findRootForReply(reply) {
    const rootId = reply.rootId && reply.rootId !== "0" ? reply.rootId : reply.id;
    return state.roots.find((item) => item.id === rootId) || null;
  }

  async function handleReaction(replyId, kind) {
    const reply = findReplyById(replyId);
    if (!reply) return;

    try {
      reply.actionError = "";
      const aid = await ensureAid();
      const csrf = getCsrf();

      if (kind === "like") {
        const nextLiked = !reply.liked;
        await apiPost("/x/v2/reply/action", {
          type: COMMENT_TYPE_VIDEO,
          oid: aid,
          rpid: reply.id,
          action: nextLiked ? 1 : 0,
          csrf,
          csrf_token: csrf,
          jsonp: "jsonp",
        });
        reply.like = Math.max(0, reply.like + (nextLiked ? 1 : -1));
        reply.liked = nextLiked;
        if (nextLiked && reply.disliked) {
          reply.disliked = false;
          reply.dislike = Math.max(0, reply.dislike - 1);
        }
      } else {
        const nextDisliked = !reply.disliked;
        await apiPost("/x/v2/reply/hate", {
          type: COMMENT_TYPE_VIDEO,
          oid: aid,
          rpid: reply.id,
          action: nextDisliked ? 1 : 0,
          csrf,
          csrf_token: csrf,
          jsonp: "jsonp",
        });
        reply.dislike = Math.max(0, reply.dislike + (nextDisliked ? 1 : -1));
        reply.disliked = nextDisliked;
        if (nextDisliked && reply.liked) {
          reply.liked = false;
          reply.like = Math.max(0, reply.like - 1);
        }
      }
    } catch (error) {
      reply.actionError = error.message || String(error);
    } finally {
      render();
    }
  }

  async function submitReply(form) {
    const reply = findReplyById(form.dataset.replyId);
    if (!reply) return;

    const textarea = form.elements.message;
    const message = textarea.value.trim();
    if (!message) {
      reply.actionError = "回复内容不能为空";
      render();
      return;
    }

    try {
      reply.actionError = "";
      const aid = await ensureAid();
      const csrf = getCsrf();
      const root = findRootForReply(reply) || reply;

      await apiPost("/x/v2/reply/add", {
        type: COMMENT_TYPE_VIDEO,
        oid: aid,
        root: root.id,
        parent: reply.id,
        message,
        plat: 1,
        csrf,
        csrf_token: csrf,
        jsonp: "jsonp",
      });

      state.activeReplyId = "";
      root.count += 1;
      const store = getReplyStore(root);
      store.isEnd = false;
      await loadReplies(root, { restart: true });
    } catch (error) {
      reply.actionError = error.message || String(error);
      render();
    }
  }

  function renderReplyNode(node, depth) {
    const visibleDepth = Math.min(depth, MAX_INDENT_DEPTH);
    const deepClass = depth > MAX_INDENT_DEPTH ? " btr-node--deep" : "";
    const children = node.children.map((child) => renderReplyNode(child, depth + 1)).join("");
    return `
      <article class="btr-node${deepClass}" style="--btr-depth:${visibleDepth}">
        <div class="btr-node-line"></div>
        <div class="btr-node-body">
          ${renderAuthor(node)}
          <div class="btr-message">${renderMessage(node.message)}</div>
          ${renderMeta(node)}
          ${node.actionError ? `<div class="btr-error">${escapeHtml(node.actionError)}</div>` : ""}
          ${renderReplyForm(node)}
        </div>
        ${children}
      </article>
    `;
  }

  function renderRoot(root) {
    const store = getReplyStore(root);
    const replySummary = root.count > 0 ? `${store.nodes.size}/${store.total || root.count}` : "0";
    const tree = store.expanded
      ? `
        <div class="btr-reply-tree">
          ${store.topLevel.map((node) => renderReplyNode(node, 1)).join("")}
          ${store.pendingChildren.size ? `<div class="btr-note">有 ${store.pendingChildren.size} 组回复正在等待父回复加载。</div>` : ""}
          ${store.error ? `<div class="btr-error">${escapeHtml(store.error)}</div>` : ""}
          <div class="btr-actions">
            ${store.loading ? `<span class="btr-muted">正在加载回复...</span>` : ""}
            ${!store.loading && !store.isEnd && !store.limitedByApi ? `<button class="btr-link-button" data-action="load-replies" data-root-id="${root.id}">加载更多回复 ${replySummary}</button>` : ""}
          </div>
        </div>
      `
      : "";

    return `
      <section class="btr-root">
        <div class="btr-root-main">
          ${renderAuthor(root)}
          <div class="btr-message">${renderMessage(root.message)}</div>
          ${renderMeta(root, { replyText: root.count ? `${root.count} 回复` : "回复" })}
          ${root.actionError ? `<div class="btr-error">${escapeHtml(root.actionError)}</div>` : ""}
          ${renderReplyForm(root)}
          ${root.count > 0 ? `
            <div class="btr-actions">
              <button class="btr-link-button" data-action="toggle-root" data-root-id="${root.id}">
                ${store.expanded ? "收起相关回复" : `展开相关回复 ${replySummary}`}
              </button>
            </div>
          ` : ""}
        </div>
        ${tree}
      </section>
    `;
  }

  function render() {
    const panel = document.querySelector(".btr-panel");
    if (!panel) return;

    const list = panel.querySelector(".btr-list");
    const status = panel.querySelector(".btr-status");
    const loadMore = panel.querySelector("[data-action='load-roots']");

    if (state.rootCursor.error) {
      status.textContent = state.rootCursor.error;
      status.classList.add("btr-status--error");
    } else if (state.rootCursor.loading) {
      status.textContent = "正在加载评论...";
      status.classList.remove("btr-status--error");
    } else {
      status.textContent = state.roots.length ? `已加载 ${state.roots.length}/${state.rootCursor.total || "?"} 条评论` : "正在准备评论";
      status.classList.remove("btr-status--error");
    }

    loadMore.disabled = state.rootCursor.loading || state.rootCursor.isEnd;
    loadMore.textContent = state.rootCursor.isEnd ? "没有更多评论" : "更多评论";
    list.innerHTML = state.roots.map(renderRoot).join("");
  }

  const COMMENT_HOST_SELECTORS = [
    "#commentapp",
    "#comment",
    ".reply-wrap",
    ".reply-warp",
    ".reply-container",
    ".reply-list",
    ".comment-container",
    ".comment-list",
    ".comment-m",
    ".bili-comment-container",
    ".bili-comments",
    ".video-comments",
    "bili-comments",
    "bili-comments-v2",
    "bb-comment",
  ];

  function findCommentHost(allowFallback = false) {
    for (const selector of COMMENT_HOST_SELECTORS) {
      const host = document.querySelector(selector);
      if (host) return host;
    }

    if (!allowFallback) return null;
    return document.querySelector(".left-container") || document.querySelector("main") || document.body;
  }

  function findNativeCommentHosts() {
    const shell = document.querySelector(".btr-shell");
    const hosts = new Set();

    document.querySelectorAll("[data-btr-native-comment='true']").forEach((element) => {
      if (!element.isConnected || element === shell || element.closest(".btr-shell") || element.contains(shell)) return;
      hosts.add(element);
    });

    document.querySelectorAll(COMMENT_HOST_SELECTORS.join(",")).forEach((element) => {
      if (!element.isConnected || element === shell || element.closest(".btr-shell") || element.contains(shell)) return;
      hosts.add(element);
    });

    if (shell?.dataset.btrCanHideSiblings === "true") {
      let sibling = shell.nextElementSibling;
      while (sibling) {
        if (!sibling.matches("script, style, link")) hosts.add(sibling);
        sibling = sibling.nextElementSibling;
      }
    }

    return [...hosts];
  }

  function applyNativeVisibility() {
    const shell = document.querySelector(".btr-shell");
    if (shell) {
      shell.dataset.btrNativeVisible = state.nativeVisible ? "true" : "false";
      shell.classList.toggle("btr-shell--native-mode", state.nativeVisible);
    }

    const hosts = findNativeCommentHosts();
    hosts.forEach((element) => {
      if (!element.dataset.btrNativeDisplay || element.dataset.btrNativeDisplay === "none") {
        element.dataset.btrNativeDisplay = "";
      }
      element.classList.toggle("btr-original-hidden", !state.nativeVisible);
      if (state.nativeVisible && element.style.display === "none") {
        element.style.display = element.dataset.btrNativeDisplay || "";
      }
    });

    const toggle = document.querySelector("[data-action='toggle-native']");
    if (toggle) {
      toggle.textContent = state.nativeVisible ? "切换到树形评论" : "切换到原评论区";
      toggle.title = hosts.length === 0 ? "暂未定位到原评论区" : "";
    }
  }

  function setupPanel() {
    if (document.querySelector(".btr-shell")) return;

    const nativeHost = findCommentHost(false);
    const fallbackHost = findCommentHost(true);
    const host = nativeHost?.parentElement || fallbackHost;
    console.info("[Bilibili Tree Replies] mount", {
      nativeHost: nativeHost?.tagName || "",
      nativeClass: nativeHost?.className || "",
      nativeId: nativeHost?.id || "",
    });
    const shell = createElement("section", "btr-shell");
    shell.innerHTML = `
      <div class="btr-panel" aria-label="Bilibili tree replies">
        <header class="btr-header">
          <div>
            <div class="btr-title">评论</div>
            <div class="btr-status">正在准备评论</div>
          </div>
          <div class="btr-header-actions">
            <button class="btr-link-button" type="button" data-action="toggle-native">切换到原评论区</button>
            <button class="btr-link-button" type="button" data-action="refresh">刷新树形评论</button>
          </div>
        </header>
        <main class="btr-list"></main>
        <div class="btr-footer">
          <button class="btr-button" type="button" data-action="load-roots">更多评论</button>
        </div>
      </div>
    `;

    if (nativeHost?.parentElement) {
      nativeHost.dataset.btrNativeComment = "true";
      if (nativeHost.dataset.btrNativeDisplay === "none") {
        nativeHost.dataset.btrNativeDisplay = "";
      }
      shell.dataset.btrCanHideSiblings = "true";
      nativeHost.parentElement.insertBefore(shell, nativeHost);
    } else {
      shell.dataset.btrCanHideSiblings = "false";
      host.prepend(shell);
    }
    applyNativeVisibility();

    shell.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;

      const action = target.dataset.action;
      if (action === "like-reply" || action === "dislike-reply") {
        handleReaction(target.dataset.replyId, action === "like-reply" ? "like" : "dislike");
        return;
      }
      if (action === "start-reply") {
        state.activeReplyId = target.dataset.replyId;
        render();
        return;
      }
      if (action === "cancel-reply") {
        state.activeReplyId = "";
        render();
        return;
      }
      if (action === "toggle-native") {
        state.nativeVisible = !state.nativeVisible;
        applyNativeVisibility();
      }
      if (action === "load-roots") loadRootComments();
      if (action === "refresh") {
        state.rootCursor = {
          loaded: false,
          loading: false,
          error: "",
          mode: 3,
          page: 0,
          total: 0,
          isEnd: false,
        };
        state.roots = [];
        state.replyStores.clear();
        state.autoReplyQueueRunning = false;
        loadRootComments();
      }
      if (action === "toggle-root" || action === "load-replies") {
        const root = state.roots.find((item) => item.id === target.dataset.rootId);
        if (!root) return;
        if (action === "toggle-root") toggleStore(root);
        if (action === "load-replies") loadReplies(root);
      }
    });

    shell.addEventListener("submit", (event) => {
      const form = event.target.closest(".btr-reply-form");
      if (!form) return;
      event.preventDefault();
      submitReply(form);
    });

    render();
    loadRootComments();
  }

  function init() {
    if (!/^\/video\/BV/.test(location.pathname)) return;
    if (findCommentHost()) setupPanel();
  }

  init();

  const mountObserver = new MutationObserver(() => {
    if (!/^\/video\/BV/.test(location.pathname)) return;
    const currentNativeHost = findCommentHost(false);
    const shell = document.querySelector(".btr-shell");
    if (
      currentNativeHost &&
      !currentNativeHost.dataset.btrNativeComment &&
      !currentNativeHost.closest(".btr-shell") &&
      !currentNativeHost.contains(shell)
    ) {
      currentNativeHost.dataset.btrNativeComment = "true";
      applyNativeVisibility();
    }
    if (!document.querySelector(".btr-shell") && currentNativeHost) setupPanel();
  });
  mountObserver.observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(() => {
    if (/^\/video\/BV/.test(location.pathname) && !document.querySelector(".btr-shell")) {
      setupPanel();
    }
  }, 5000);

  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    state.aid = null;
    state.bvid = null;
    state.roots = [];
    state.replyStores.clear();
    state.autoReplyQueueRunning = false;
    state.nativeVisible = false;
    state.rootCursor = {
      loaded: false,
      loading: false,
      error: "",
      mode: 3,
      page: 0,
      total: 0,
      isEnd: false,
    };
    render();
    init();
  }, 1000);
})();
