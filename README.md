# Bilibili Tree Replies

一个 Chrome MV3 扩展，用树形结构展示 B 站视频评论下的多级回复。

## 使用

1. 打开 Chrome 扩展管理页：`chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本目录：`/Users/jing/Downloads/bilibili`
5. 打开 B 站视频页，扩展会自动在原评论区位置展示树形评论

## 实现策略

- 通过 `https://api.bilibili.com/x/web-interface/view` 获取视频 `aid`
- 通过 `x/v2/reply` 按页懒加载根评论
- 通过 `x/v2/reply/reply` 按页加载某条根评论下的回复
- 内容脚本通过扩展后台 service worker 请求 API，避免页面 CORS 限制
- 使用回复结构化字段 `rpid/root/parent` 建树，不依赖页面文案中的 `回复 @用户名`
- 每条根评论维护独立的 `nodeMap` 和 `pendingChildren`，跨分页合并回复
- 首屏根评论会自动加载第一页相关回复，更多分页由用户按需加载
- 缩进最多展示到 4 层，超过后固定缩进并用视觉线条表达层级
- 找到 B 站原评论容器后，默认折叠原评论 DOM，并提供“显示原评论区”兜底开关

## 注意

B 站接口可能调整字段或鉴权策略。如果接口返回风控、未登录或频率限制错误，扩展会在浮层状态区显示对应错误。
