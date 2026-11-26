"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeLocation,
  resolveMaxLine,
  canAutoLoadRoots,
  isStalledPage,
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

test("isStalledPage 零新增且未到底且游标未前进时判停滞", () => {
  assert.equal(isStalledPage({ added: 0, endClaimed: false, offsetChanged: false }), true);
});

test("isStalledPage 有新增/已到底/游标前进均不判停滞", () => {
  assert.equal(isStalledPage({ added: 3, endClaimed: false, offsetChanged: false }), false);
  assert.equal(isStalledPage({ added: 0, endClaimed: true, offsetChanged: false }), false);
  assert.equal(isStalledPage({ added: 0, endClaimed: false, offsetChanged: true }), false);
});
