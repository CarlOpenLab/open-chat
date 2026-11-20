# Releasing & auto-update（维护者手册）

面向维护者的发布与自动更新配置说明。访客向的内容见 [README](../README.md)。

## 自动更新机制

桌面构建内置 [mygo updater](https://github.com/egoist/mygo/blob/main/docs/updates.md)：启动约 10 秒后检查一次，此后每天一次；有新版本时弹出更新窗口（发布说明 / 安装 / 稍后 / 跳过），下载完成后校验 Ed25519 签名再原地替换，重启即进入新版本。macOS 的菜单栏有「Check for Updates…」，设置 → 偏好里有「检查更新」。

更新只会在**用更新密钥签过名的发布构建**里生效：开发构建、`open-chat serve`、以及包管理器安装的版本不会自动替换自己。

### 一次性配置更新密钥

和 Beacon / Gloss 一样：**公钥提交在配置里，私钥放进 GitHub 仓库的 Actions secrets**（Settings → Secrets and variables → Actions）。本仓库已经生成好一对专用密钥，公钥在 `mygo.config.ts` 的 `updates.publicKey`，只差设置私钥：

```bash
gh secret set MYGO_UPDATER_PRIVATE_KEY --repo CarlOpenLab/open-chat < \
  "$HOME/Library/Application Support/mygo/open-chat-update-keys/mygo-update.key"
```

私钥只放在本地密码管理器和仓库 secret 里，**不要提交进仓库**。以后换密钥时用 `mygo keygen -o <独立目录>` 重新生成（默认目录 `mygo/update-keys` 可能已有其他应用的密钥，`-force` 会覆盖它们），把新的 `.pub` 内容写进 `updates.publicKey`，再更新 secret。本地想做可更新的发布构建时：

```bash
MYGO_UPDATER_PRIVATE_KEY="$(cat "$HOME/Library/Application Support/mygo/open-chat-update-keys/mygo-update.key")" pnpm build
```

### macOS 代码签名（可选）

Gloss 用的是 Apple Development 身份，证书同样放在仓库 secrets 里。它不会让未公证的 App 绕过 Gatekeeper，但让代码签名跨版本稳定，macOS 的「文件与文件夹」授权在自动更新后不用重新给。在 Keychain Access → 我的证书里把 `Apple Development: …` 导出为 `.p12`（只导出这一个身份），然后：

```bash
base64 -i /path/to/apple-development.p12 | \
  gh secret set MACOS_CERTIFICATE --repo CarlOpenLab/open-chat
gh secret set MACOS_CERTIFICATE_PASSWORD --repo CarlOpenLab/open-chat
```

GitHub 的 secret 只能写不能读，所以没法从 Gloss 仓库复制，得用同一个 `.p12` 给本仓库重新设置一次。没设置时 CI 会警告并回退到 ad-hoc 签名，Release 照常发布。

### 发一个版本

1. 改 `package.json` 的 `version`（`mygo.config.ts` 直接读它），在 `CHANGELOG.md` 写 `## X.Y.Z` 段落，提交。
2. 打标签并推送：

   ```bash
   git tag v0.0.3
   git push origin v0.0.3
   ```

`.github/workflows/release.yml` 随后会：

- 校验标签与 `package.json` 版本一致，跑 `pnpm typecheck` 与 `go test ./...`；
- 建一个 draft Release（发布说明取 CHANGELOG 的对应段落）；
- 在 macOS / Windows / Linux runner 上执行 `mygo build -upload`，把 dmg、Windows setup exe、deb / rpm / tar.gz，以及签名更新包、增量包和 `update-<target>.json` 上传到该 Release；
- 全部成功后把 Release 发布为 latest —— 已安装的应用从此刻起就能检查到新版本。

### 落地页（GitHub Pages）

落地页源码在 [`site/`](../site/)，由 `.github/workflows/pages.yml` 在推送 `master` 时自动发布到 <https://carlopenlab.github.io/open-chat/>。改动落地页直接编辑 `site/index.html`（或 `designs/open-chat-landing/` 里的工作副本后同步过来）即可，无需构建步骤。
