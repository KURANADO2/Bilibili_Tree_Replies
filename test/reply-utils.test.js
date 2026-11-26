"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeLocation,
  resolveMaxLine,
  canAutoLoadRoots,
} = require("../src/reply-utils.js");

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
