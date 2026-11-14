# RoleCard Studio -> SillyTavern 实时同步扩展

## 安装方式
1. 将本目录（`sillytavern-rolecard-sync`）复制到 SillyTavern 的 `public/scripts/extensions/third-party/` 目录。
2. 启用扩展后，在浏览器控制台或扩展配置中设置 RoleCard Studio 服务地址与外部 API Token（若 API 模式为 `authenticated`）：

```js
window.RoleCardSync.updateConfig({
  serverUrl: 'http://127.0.0.1:3000',
  apiToken: 'rc_live_xxx',
  autoApply: true,
});
window.RoleCardSync.startStream();
```

## 同步协议说明
- 优先使用 `GET /api/v1/external/sync/stream?since_cursor=<cursor>` 接收 SSE 增量推流。
- 断线后自动降级为 `GET /api/v1/external/sync/events?since_cursor=<cursor>` 轮询，绝不漏事件。
- 当收到 `card.updated`、`card.evolved`、`ripple.approved` 或 `lorebook.updated` 时自动拉取最新 `/api/v1/external/cards/:id/ccv3` 并触发 `window` 自定义事件 `rolecard:synced`。
