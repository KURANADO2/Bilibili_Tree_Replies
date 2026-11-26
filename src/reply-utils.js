(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.BtrReplyUtils = api;
  }
})(typeof self !== "undefined" ? self : null, function () {
  "use strict";

  const DEFAULT_MAX_LINE = 6;

  // 接口仅对登录请求下发 reply_control.location，且 2022-07-25 后的评论才有；
  // 缺失/非字符串一律归为空串，渲染层按空串静默不显示
  function normalizeLocation(rawReply) {
    const location = rawReply?.reply_control?.location;
    return typeof location === "string" ? location : "";
  }

  // 长文折叠行数跟随接口 max_line，缺失或非正数回退默认值
  function resolveMaxLine(rawReply) {
    const maxLine = Number(rawReply?.reply_control?.max_line);
    return Number.isFinite(maxLine) && maxLine > 0 ? maxLine : DEFAULT_MAX_LINE;
  }

  // 滚动自动翻页门控：忙、已到底、风控截断、出错任一命中即阻断，
  // 截断与出错态只允许「更多评论」按钮手动重试，避免自动重试风暴
  function canAutoLoadRoots(cursor) {
    if (!cursor) return false;
    return !(cursor.loading || cursor.paging || cursor.isEnd || cursor.truncated || Boolean(cursor.error));
  }

  return {
    normalizeLocation,
    resolveMaxLine,
    canAutoLoadRoots,
  };
});
