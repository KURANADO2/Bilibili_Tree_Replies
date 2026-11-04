(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.BtrTheme = api;
    if (typeof root.document !== "undefined") api.start();
  }
})(typeof self !== "undefined" ? self : null, function () {
  "use strict";

  const MODES = ["auto", "light", "dark"];
  const STORAGE_KEY = "btr-theme-mode";
  const MODE_LABELS = {
    auto: "主题：自动",
    light: "主题：亮色",
    dark: "主题：暗色",
  };
  const MODE_TITLES = {
    auto: "自动跟随页面明暗（支持夜间模式插件与 B 站自带夜间），点击切换为常亮",
    light: "常亮模式，点击切换为常暗",
    dark: "常暗模式，点击切换为自动",
  };

  function normalizeThemeMode(value) {
    return MODES.includes(value) ? value : "auto";
  }

  function nextThemeMode(mode) {
    const current = normalizeThemeMode(mode);
    return MODES[(MODES.indexOf(current) + 1) % MODES.length];
  }

  function resolveTheme(mode, pageIsDark) {
    const normalized = normalizeThemeMode(mode);
    if (normalized === "light") return "light";
    if (normalized === "dark") return "dark";
    return pageIsDark ? "dark" : "light";
  }

  function parseCssColor(value) {
    if (typeof value !== "string") return null;
    const text = value.trim().toLowerCase();

    const rgbMatch = text.match(
      /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/
    );
    if (rgbMatch) {
      return {
        r: Number(rgbMatch[1]),
        g: Number(rgbMatch[2]),
        b: Number(rgbMatch[3]),
        a: rgbMatch[4] == null ? 1 : Number(rgbMatch[4]),
      };
    }

    const hexMatch = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3) {
        hex = hex
          .split("")
          .map((digit) => digit + digit)
          .join("");
      }
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }

    return null;
  }

  function isDarkRgb({ r, g, b }) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  }

  function isPageDark({ darkReaderScheme, samples }) {
    if (darkReaderScheme === "dark") return true;
    for (const sample of samples || []) {
      const color = parseCssColor(sample);
      if (!color || color.a <= 0) continue;
      return isDarkRgb(color);
    }
    return false;
  }

  function readMode() {
    try {
      return normalizeThemeMode(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return "auto";
    }
  }

  function writeMode(mode) {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // 存储不可用时仅本次会话生效
    }
  }

  const SAMPLE_ANCHOR_SELECTORS = ["#commentapp", "#app"];
  const MAX_BACKGROUND_WALK = 6;

  function sampleEffectiveBackground(element) {
    let current = element;
    for (let depth = 0; current && depth < MAX_BACKGROUND_WALK; depth += 1) {
      const color = window.getComputedStyle(current).backgroundColor;
      const parsed = parseCssColor(color);
      if (parsed && parsed.a > 0) return color;
      current = current.parentElement;
    }
    return null;
  }

  function collectPageSamples() {
    // 面板挂载在 #commentapp 内，优先取面板所在位置的等效背景，
    // 再取内容容器，最后才是 body：保证「只暗化内容容器」的插件也能命中
    const anchors = [];
    for (const selector of SAMPLE_ANCHOR_SELECTORS) {
      anchors.push(document.querySelector(selector));
    }
    anchors.push(document.body);
    return anchors.filter(Boolean).map(sampleEffectiveBackground);
  }

  function detectPageDark() {
    return isPageDark({
      darkReaderScheme: document.documentElement.getAttribute("data-darkreader-scheme"),
      samples: collectPageSamples(),
    });
  }

  function applyTheme() {
    const shell = document.querySelector(".btr-shell");
    if (!shell) return;

    // 原评论区可见时面板处于隐藏状态，主题无意义；跳过采样，
    // 避免在原生评论的渲染风暴窗口里叠加强制样式重算
    if (shell.classList.contains("btr-shell--native-mode")) return;

    const mode = readMode();
    // 手动模式无需感知页面，跳过采样以避免无谓的强制样式重算
    const pageIsDark = mode === "auto" ? detectPageDark() : false;
    const resolved = resolveTheme(mode, pageIsDark);

    // 幂等写入：值未变化时不碰 DOM，避免搅动页面观察器与夜间插件
    if (shell.getAttribute("data-btr-theme") !== resolved) {
      shell.setAttribute("data-btr-theme", resolved);
    }
    const toggle = shell.querySelector("[data-action='toggle-theme']");
    if (toggle) {
      if (toggle.textContent !== MODE_LABELS[mode]) toggle.textContent = MODE_LABELS[mode];
      if (toggle.title !== MODE_TITLES[mode]) toggle.title = MODE_TITLES[mode];
    }
  }

  function cycleMode() {
    const mode = nextThemeMode(readMode());
    writeMode(mode);
    applyTheme();
  }

  function start() {
    applyTheme();

    // 检测节奏与页面变化解耦：固定间隔采样，强制样式重算频率有上限。
    // 早先版本用 MutationObserver 跟随 html/body 属性变化，页面每变一次属性
    // 就触发一次强制重算与 DOM 写入，在 B 站这类高频变化的页面上放大成主线程饱和
    window.setInterval(() => {
      if (readMode() === "auto") applyTheme();
    }, 2000);
  }

  return {
    normalizeThemeMode,
    nextThemeMode,
    resolveTheme,
    parseCssColor,
    isDarkRgb,
    isPageDark,
    applyTheme,
    cycleMode,
    start,
  };
});
