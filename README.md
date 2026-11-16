# 暖流 · 现金流

个人现金流追踪 PWA：每天一分钟输入各账户余额，自动加总，看清有多少钱、多少可以用。

- 纯静态文件，无需构建；数据只存在本机（IndexedDB），不联网、不登录。
- 用 GitHub Pages（或任何 HTTPS 静态托管）打开 `index.html`，再从浏览器菜单“添加到主屏幕”安装。
- 本地预览：`python3 -m http.server`，然后打开 http://localhost:8000

| 文件 | 内容 |
|---|---|
| `index.html` / `css/styles.css` | 页面骨架与主题 |
| `js/shared.js` | 数据层与计算（页面和 Service Worker 共用） |
| `js/charts.js` | 环形图、走势图 |
| `js/app.js` | 各页面逻辑 |
| `sw.js` | 离线缓存与提醒通知 |
