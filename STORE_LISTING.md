# Chrome Web Store Listing Copy

## Title
`Bilibili Tree Replies`

## Short Description
将 B 站视频评论下的多级回复以树形结构展示。

## Long Description
Bilibili Tree Replies 会把 B 站视频页的评论区改造成树形回复视图，帮助你更清楚地看出每条评论和它的多级回复关系。

功能包括：
- 树形展示根评论与多级回复
- 根评论支持 `最热 / 最新` 排序切换
- 支持点赞、点踩和直接回复
- 支持切换回原始评论区
- 自动合并分页回复，尽量保留原评论中的关键信息

适用场景：
- 需要快速浏览视频评论讨论脉络
- 需要查看某条评论下的完整回复链
- 需要在树形视图和原评论区之间切换

## Privacy Policy Notes
This extension only runs on `www.bilibili.com` video pages and communicates with `api.bilibili.com` to read and update comment data for the current video. It does not collect or transmit personal data to third-party services beyond the Bilibili requests required for the extension to work.

## Permissions Summary
- `https://www.bilibili.com/*` for injecting the content script on video pages
- `https://api.bilibili.com/*` for loading and updating comment data
