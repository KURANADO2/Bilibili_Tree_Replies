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

  function isPageDark({ darkReaderMode, sample }) {
    if (darkReaderMode === "dynamic") return true;
    const color = parseCssColor(sample);
    if (!color || color.a <= 0) return false;
    return isDarkRgb(color);
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

  function samplePageBackground() {
    let element = document.body;
    while (element) {
      const color = window.getComputedStyle(element).backgroundColor;
      const parsed = parseCssColor(color);
      if (parsed && parsed.a > 0) return color;
      element = element.parentElement;
    }
    return null;
  }

  function detectPageDark() {
    return isPageDark({
      darkReaderMode: document.documentElement.getAttribute("data-darkreader-mode"),
      sample: samplePageBackground(),
    });
  }

  function applyTheme() {
    const mode = readMode();
    const shell = document.querySelector(".btr-shell");
    if (!shell) return;

    shell.setAttribute("data-btr-theme", resolveTheme(mode, detectPageDark()));
    const toggle = shell.querySelector("[data-action='toggle-theme']");
    if (toggle) {
      toggle.textContent = MODE_LABELS[mode];
      toggle.title = MODE_TITLES[mode];
    }
  }

  function cycleMode() {
    const mode = nextThemeMode(readMode());
    writeMode(mode);
    applyTheme();
  }

  function start() {
    applyTheme();

    // 兜底轮询：夜间插件仅注入样式表而不改属性时，1 秒内也能跟上
    window.setInterval(() => {
      if (readMode() === "auto") applyTheme();
    }, 1000);

    const observer = new MutationObserver(() => applyTheme());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-darkreader-mode"],
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });
    }
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
