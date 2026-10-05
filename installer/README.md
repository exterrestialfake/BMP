# Windows EXE 构建与验收

这里是安装器源码。普通用户从 GitHub Release 下载 EXE，不需要运行这些脚本。

## 构建

开发机需要 Windows x64、Node.js/npm。首次从源码准备运行依赖：

```powershell
./installer/Build.ps1 -PrepareRuntime
```

已有 `plugins/bilibili-audio/runtime/` 与 `vendor/` 时可直接运行 `Build.ps1`。脚本执行 `npm ci`、类型检查、打包及源码测试；从固定版本的原始发布资产准备运行依赖，并校验 SHA256。Inno Setup 6.7.3 使用固定哈希及 Authenticode 签名核验，以便携模式放在 `.build/tools/`，不全局安装。

输出为 `release/BMP-Setup-<版本>-windows-x64.exe`；构建临时文件在 `.build/`，`dist/` 继续仅存 ZIP。版本来自插件清单，应与 server/package.json、锁文件及 MCP Server 身份一致。EXE 当前未签名。

EXE 随包提供 Node.js 和 yt-dlp，不包含 mpv、Microsoft DLL 或字体配置。安装时由 `Prepare-Mpv.ps1` 直接从固定上游发布归档获取约 33 MB 的 mpv，校验归档及三个运行文件的 SHA256 后才登记插件。重新安装会复用哈希正确的文件；下载或校验失败返回安装错误，可重试或卸载，不登记缺少播放器的插件。开发机的 mpv 只用于源码测试，不进入 EXE。

## 验收

开发机先安装支持 `plugin` 命令的 Codex 桌面版，然后运行：

```powershell
./installer/Test.ps1
```

验收使用真实安装 EXE 和真实 CLI，在 `.build/installer-test-*/` 内创建独立 `CODEX_HOME`、插件和用户数据。覆盖前置拒绝、失败恢复、正常安装、MCP 握手、第三方程序启动、旧版本刷新、重复安装和卸载保留数据；测试不会替换日常插件或结束 Codex。

`/ISOLATED=1` 固定使用安装目录内 `.installer-test-home`，并使用独立的 Windows 卸载登记；只有隔离验收使用。`/CODEXCLI=<exe路径>` 可指定 CLI，验收用它注入安装失败。`/MPVARCHIVE=<7z路径>` 仅在隔离验收中复用固定哈希的本地上游归档或注入校验失败，普通安装忽略该参数并按上游下载流程执行。首次安装验收不传此参数，验证真实下载。普通安装自动寻找桌面版自带 CLI，要求 Codex 后台完全退出。

## 失败与卸载

前置拒绝发生在复制程序之前。插件登记失败返回退出码 `10`，完成页显示失败，恢复原 Codex 配置；已经复制的程序保留，可以重新安装或从 Windows 应用列表卸载。卸载仅移除本插件登记、安装目录内程序和自身 marketplace，保留用户登录、聊天、其他插件及缓存数据。

安装器不提供 Codex 本身。若 Codex CLI 已被移除，先恢复 Codex，才能通过官方命令清理插件配置。旧 personal 安装只在来源与项目早期默认目录完全一致且已启用时迁移；卸载 EXE 版不自动恢复旧版。

构建工具来源：[Inno Setup](https://jrsoftware.org/isdl.php)。插件登记方式：[OpenAI 官方插件文档](https://developers.openai.com/plugins/build/plugins)。

## 第三方材料

仓库根目录 `THIRD_PARTY_NOTICES.md` 是统一入口；`plugins/bilibili-audio/licenses/` 仅保留原始许可。构建调用 `Prepare-Notices.ps1`，按实际 esbuild 输出纳入 JavaScript 包的版本、来源与许可，在插件交付目录生成一份完整的 `THIRD_PARTY_NOTICES.txt`，不复制原始许可目录、日志、API 快照或源码归档。

安装器在许可页面展示同一份集中声明，用户接受后才能继续安装；安装后声明仍保存在插件目录。BMP 的 MIT 与开源组件许可分别适用，Windows SDK 条款仅保护安装时从上游取得的 Microsoft DLL。源码仓库保留微软发布的 SDK 许可原文，构建不另下载许可文件。

源码入口和上游获取方法统一记录在根目录 `THIRD_PARTY_NOTICES.md`。随包依赖的固定下载地址与 SHA256 保存在 `Build.ps1` 中；安装时获取 mpv 的地址与哈希保存在 `Prepare-Mpv.ps1` 中。不另外保存源码副本或维护第三方审阅目录；mpv 由用户直接从上游取得，不能把辅助提供的核心源码链接表述成已核实的完整对应源码清单。
