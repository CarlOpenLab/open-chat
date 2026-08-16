# @cc-hearts/open-chat

Open Chat 是一个本地 AI CLI 工作区。安装后无需源码仓库即可启动本地网关和 Web 界面。

```bash
npm install -g @cc-hearts/open-chat
open-chat
```

也可以不安装到全局：

```bash
npx @cc-hearts/open-chat --no-open
```

默认监听 `127.0.0.1:8082`，并自动打开浏览器。使用 `open-chat --help` 查看端口、主机和静态目录等选项。

要求 Node.js `>=22.12.0`。本地使用的 Codex、Claude、Pi、OpenCode 等 CLI 需要单独安装并登录。
