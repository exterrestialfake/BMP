# 第三方软件声明

BMP 使用下列第三方软件。各项目的版权和许可仍由其原作者保留；本文件不改变其授权，也不替代 BMP 自己源码的许可证。

## 运行依赖

公开 EXE 随包提供 Node.js 和 yt-dlp；mpv 及其随附 DLL、字体配置不打入 EXE，而是在安装时直接从下列固定上游 Release 下载，并校验归档 SHA256。下载来源和版本不会随上游最新版本自动变化。

| 项目 | 当前版本／来源 | 许可原文 |
| --- | --- | --- |
| Node.js | [v24.14.1](https://nodejs.org/dist/v24.14.1/)，Windows x64 | [Node.js 与其第三方组件声明](plugins/bilibili-audio/licenses/NODE-LICENSE.txt) |
| yt-dlp | [2026.08.19](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19)，Windows `yt-dlp.exe` | [本体许可](plugins/bilibili-audio/licenses/YT-DLP-LICENSE.txt)、[发布程序附带组件的声明](plugins/bilibili-audio/licenses/YT-DLP-THIRD-PARTY.txt)；本体许可不能代表所有随包依赖 |
| mpv（安装时从上游下载） | [shinchiro 20260926 Windows 构建](https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260926)，mpv 提交 `35af06172be5199212e0406878bd0fde532d080d` | [版权与许可适用说明](plugins/bilibili-audio/licenses/MPV-Copyright.txt)、[GPL](plugins/bilibili-audio/licenses/MPV-LICENSE.GPL.txt)、[LGPL](plugins/bilibili-audio/licenses/MPV-LICENSE.LGPL.txt) |
| FFmpeg（mpv 内部） | 提交 `243dfa399fe6dbe2ffd435cb0477aed6f58f1645` | [许可适用说明](plugins/bilibili-audio/licenses/ffmpeg/LICENSE.md)及同目录许可原文；构建配方启用 GPL 与 version3，不能标为纯 LGPL |
| libplacebo（mpv 内部） | 提交 `c42968d8616a1d1c8ad5f4f1a8d6f5a9cb396e56`；程序版本带 `dirty`，构建配方公开了对第三方目录的替换操作 | [LGPL 原文](plugins/bilibili-audio/licenses/libplacebo/LICENSE) |
| Microsoft `d3dcompiler_43.dll`（安装时随 mpv 从上游取得） | 内部原始名称 `d3dcompiler_47.dll`，版本 `10.0.18362.1`，Microsoft Corporation；与上游打包文件逐字节一致 | [Windows SDK 许可原文](plugins/bilibili-audio/licenses/MICROSOFT-WINDOWS-SDK-LICENSE.txt)、[官方 REDIST 清单](https://learn.microsoft.com/en-us/legal/windows-sdk/redist)；不适用 mpv 的 GPL 声明 |

mpv 上游归档为 `mpv-x86_64-20260926-git-35af06172b.7z`，SHA256 为 `a9aaf0cff587473551199a30db717d92c4f75fd06fa64c2e9689800e48f48939`。该归档由用户安装时从上游取得，BMP 的公开 EXE 不重新分发其中的二进制文件；以下 mpv 相关声明与源码链接用于说明其来源和帮助用户查阅上游材料，没有声称已核实这个第三方构建的全部组件。

### Microsoft DLL 的来源与条款

安装时取得的 DLL 与上游 [mpv-packaging 的固定提交](https://github.com/shinchiro/mpv-packaging/tree/1c534ce8c21fab0be2a394ad73decc15e015693e) 中 `d3dcompiler_43_10.0.18362.1.7z` 内的 x64 DLL 逐字节一致。DLL 文件的 SHA256 为 `4b074a3976399dc735484f5d43d04b519b7bdee8ac719d9ab8ed6bd4e6be0345`；原始名称、版本和 Microsoft 有效签名均已核对。SDK 许可原文来自 [Microsoft 仓库固定提交](https://github.com/microsoft/win32metadata/blob/bd964b20fd0996865afd827ba0d6e712f69712a6/licenses/sdk_license.txt)，保留完整的 `EULAID:WIN10SDK.RTM.AUG_2018_en-US` 版本。

微软的 [REDIST 清单](https://learn.microsoft.com/en-us/legal/windows-sdk/redist)明确列出 Windows SDK 中的 `Redist/D3D/x64/d3dcompiler_47.dll`，允许在遵守 SDK 许可的前提下以未修改的对象代码随传统 Windows 桌面应用分发，不适用于 Universal Windows 应用。其[技术说明](https://learn.microsoft.com/en-us/windows/win32/directx-sdk--august-2009-)也说明可将该 DLL 放在应用程序旁分发。安装器的许可页面展示 SDK 完整原文和按组件适用的接收者条款，用户接受后才能继续安装；安装后保留同一份声明。文件通过哈希校验保留原始内容和版权声明，BMP 的版权声明同时显示在安装器中。SDK 条款仅适用于 Microsoft 组件，不改变 BMP 与其他开源组件的授权。mpv 上游使用的外部文件名不改变 DLL 的授权。

## MCP Server 的 JavaScript 依赖

当前打包结果包含 `@modelcontextprotocol/core` 2.1.0、`@modelcontextprotocol/server` 2.1.0 和 `zod` 4.6.5，均为 MIT。准确范围在构建时从 esbuild 输出中自动取得，并附每个包的版本、来源及完整许可；开发工具不因出现在锁文件中而自动成为随包依赖。

项目来源：[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[Zod](https://github.com/colinhacks/zod)。许可原文保存在这些包的 `LICENSE` 中，由构建脚本加入安装包。

## 安装包中的声明

`installer/Prepare-Notices.ps1` 将 BMP 的 MIT、运行依赖的许可原文与实际打包的 JavaScript 包声明集中生成到插件内的 `THIRD_PARTY_NOTICES.txt`。安装器复用该文件作为许可页面，并在安装后保留。安装包不复制本机审阅日志、API 快照、源码归档或重复的许可目录。原始许可在源码仓库中保留，便于核对和升级。

## 源码获取方式

开源软件的再分发权及义务以各自许可为准；许可本身可以授予分发权，不需要另向每位作者索要授权书。对于 GPL 覆盖的二进制，需要安排符合许可的对应源码获取方式，不能仅凭保留许可证文本宣称已满足全部条件。

| 项目 | 对应源码入口 |
| --- | --- |
| Node.js | [v24.14.1](https://github.com/nodejs/node/tree/v24.14.1) |
| yt-dlp | [2026.08.19](https://github.com/yt-dlp/yt-dlp/tree/2026.08.19)；发布程序内第三方组件的源码获取说明见 `YT-DLP-THIRD-PARTY.txt` |
| mpv | [提交 35af06172be5199212e0406878bd0fde532d080d](https://github.com/mpv-player/mpv/tree/35af06172be5199212e0406878bd0fde532d080d) |
| FFmpeg | [提交 243dfa399fe6dbe2ffd435cb0477aed6f58f1645](https://github.com/FFmpeg/FFmpeg/tree/243dfa399fe6dbe2ffd435cb0477aed6f58f1645) |
| libplacebo | [提交 c42968d8616a1d1c8ad5f4f1a8d6f5a9cb396e56](https://github.com/haasn/libplacebo/tree/c42968d8616a1d1c8ad5f4f1a8d6f5a9cb396e56) |
| Windows 构建脚本 | [提交 05a60b3cfd04e3e3b89918f4a27f3dde2935dff2](https://github.com/shinchiro/mpv-winbuild-cmake/tree/05a60b3cfd04e3e3b89918f4a27f3dde2935dff2) |

mpv 官方的[源码与编译入口](https://mpv.io/installation/)指向源码仓库和构建说明。上述 Windows 构建仓库的 [README](https://github.com/shinchiro/mpv-winbuild-cmake/blob/05a60b3cfd04e3e3b89918f4a27f3dde2935dff2/README.md) 提供环境配置与 CMake 命令；配置完成后，`ninja download` 下载配方中的源码，`ninja mpv` 构建播放器及其依赖。各依赖的上游地址可在同一提交的 [packages](https://github.com/shinchiro/mpv-winbuild-cmake/tree/05a60b3cfd04e3e3b89918f4a27f3dde2935dff2/packages) 中找到。源码可通过 Git 克隆，或使用 GitHub 的源码下载功能取得，无需 BMP 保留本地副本。

这些链接说明已确认的核心组件源码及上游获取方法；上游[构建流程](https://github.com/shinchiro/mpv-winbuild-cmake/blob/05a60b3cfd04e3e3b89918f4a27f3dde2935dff2/.github/workflows/mpv_clang.yml)会更新滚动依赖，现有公开材料不足以确认 20260926 全部依赖的确切版本，因此不能把该表声明为完整对应源码清单。libplacebo 的[构建配方](https://github.com/shinchiro/mpv-winbuild-cmake/blob/05a60b3cfd04e3e3b89918f4a27f3dde2935dff2/packages/libplacebo.cmake)公开了 glad／fast_float 目录替换操作，`dirty` 本身不能证明存在未公开补丁；BMP 已采用安装时从固定上游地址获取 mpv 的方式，不将这个未完成的对应源码核实当作不含 mpv 二进制的公开 EXE 的分发阻塞。

GPLv3 第 6(d) 条允许使用符合条件的第三方源码服务器，不要求把所有源码放进 BMP 的 Git 仓库；对应源码的范围及排除项见第 1 条。[GPLv3 原文](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/COPYING.GPLv3)

BMP 自己的源码采用根目录 [LICENSE](LICENSE) 中的 MIT License，版权署名为 `BMP contributors`。它不替 mpv、FFmpeg、Node.js、yt-dlp 或其他第三方软件重新授权；第三方仍遵循各自的许可。

BMP 以独立子进程启动 mpv，并通过公开的 JSON IPC 发送视频地址、播放命令与状态查询；没有链接 libmpv、复制 mpv 源码或交换其内部数据结构。按 GPL FAQ 关于独立程序与聚合分发的说明，当前 BMP 源码可保持 MIT。以后若复制或链接 GPL 代码形成一个整体程序，必须重新核对整体分发许可，不能沿用这一判断。[GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation)
