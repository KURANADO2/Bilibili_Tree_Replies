"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeThemeMode,
  nextThemeMode,
  resolveTheme,
  parseCssColor,
  isDarkRgb,
  isPageDark,
} = require("../src/theme.js");

test("normalizeThemeMode 接受三个合法值并原样返回", () => {
  assert.equal(normalizeThemeMode("auto"), "auto");
  assert.equal(normalizeThemeMode("light"), "light");
  assert.equal(normalizeThemeMode("dark"), "dark");
});

test("normalizeThemeMode 把非法值与空值归为 auto", () => {
  assert.equal(normalizeThemeMode(""), "auto");
  assert.equal(normalizeThemeMode(null), "auto");
  assert.equal(normalizeThemeMode(undefined), "auto");
  assert.equal(normalizeThemeMode("midnight"), "auto");
});

test("nextThemeMode 按 自动 → 亮色 → 暗色 → 自动 循环", () => {
  assert.equal(nextThemeMode("auto"), "light");
  assert.equal(nextThemeMode("light"), "dark");
  assert.equal(nextThemeMode("dark"), "auto");
});

test("nextThemeMode 对非法输入先归一再循环", () => {
  assert.equal(nextThemeMode("nonsense"), "light");
});

test("resolveTheme 手动亮色时无视页面暗色状态", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("light", false), "light");
});

test("resolveTheme 手动暗色时无视页面暗色状态", () => {
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("resolveTheme 自动模式跟随页面暗色状态", () => {
  assert.equal(resolveTheme("auto", true), "dark");
  assert.equal(resolveTheme("auto", false), "light");
});

test("parseCssColor 解析 rgb() 格式", () => {
  assert.deepEqual(parseCssColor("rgb(24, 25, 28)"), { r: 24, g: 25, b: 28, a: 1 });
});

test("parseCssColor 解析 rgba() 格式并保留透明度", () => {
  assert.deepEqual(parseCssColor("rgba(255, 255, 255, 0)"), { r: 255, g: 255, b: 255, a: 0 });
  assert.deepEqual(parseCssColor("rgba(16, 16, 16, 0.5)"), { r: 16, g: 16, b: 16, a: 0.5 });
});

test("parseCssColor 解析六位与三位十六进制", () => {
  assert.deepEqual(parseCssColor("#18191c"), { r: 24, g: 25, b: 28, a: 1 });
  assert.deepEqual(parseCssColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
});

test("parseCssColor 对无法解析的输入返回 null", () => {
  assert.equal(parseCssColor("transparent"), null);
  assert.equal(parseCssColor(""), null);
  assert.equal(parseCssColor(null), null);
  assert.equal(parseCssColor("not-a-color"), null);
});

test("isDarkRgb 判定深色与浅色", () => {
  assert.equal(isDarkRgb({ r: 24, g: 25, b: 28 }), true);
  assert.equal(isDarkRgb({ r: 16, g: 16, b: 16 }), true);
  assert.equal(isDarkRgb({ r: 255, g: 255, b: 255 }), false);
  assert.equal(isDarkRgb({ r: 241, g: 242, b: 243 }), false);
});

test("isPageDark 在 Dark Reader 动态模式下判定为暗色", () => {
  assert.equal(isPageDark({ darkReaderMode: "dynamic", sample: "rgb(255, 255, 255)" }), true);
});

test("isPageDark 在 Dark Reader 滤镜模式下不判定为暗色（滤镜已整体反色）", () => {
  assert.equal(isPageDark({ darkReaderMode: "filter", sample: "rgb(255, 255, 255)" }), false);
});

test("isPageDark 依据采样背景色判定暗色", () => {
  assert.equal(isPageDark({ darkReaderMode: null, sample: "rgb(16, 16, 16)" }), true);
  assert.equal(isPageDark({ darkReaderMode: null, sample: "rgb(255, 255, 255)" }), false);
});

test("isPageDark 忽略全透明采样（视为无背景信号）", () => {
  assert.equal(isPageDark({ darkReaderMode: null, sample: "rgba(0, 0, 0, 0)" }), false);
  assert.equal(isPageDark({ darkReaderMode: null, sample: null }), false);
});
