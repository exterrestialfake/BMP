# 本机依赖来源

本目录保存个人测试包所用二进制的来源和许可文本。制作对外发布包前，仍需复核各构建的第三方依赖许可及随包材料。

| 组件 | 来源 | 版本／文件 | 发布资产 SHA256 |
| --- | --- | --- | --- |
| Node.js | <https://nodejs.org/dist/v24.14.1/> | `node-v24.14.1-win-x64.zip` 中的 `node.exe` | `6e50ce5498c0cebc20fd39ab3ff5df836ed2f8a31aa093cecad8497cff126d70` |
| yt-dlp | <https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19> | `yt-dlp.exe` | `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a` |
| mpv | <https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260926>，构建来源由 <https://mpv.io/installation/> 列出 | `mpv-x86_64-20260926-git-35af06172b.7z` | `a9aaf0cff587473551199a30db717d92c4f75fd06fa64c2e9689800e48f48939` |

Node.js 和 yt-dlp 的发布资产已与各自发布清单核对；mpv 归档已与 GitHub 发布资产 `digest` 核对。`NODE-LICENSE.txt`、`YT-DLP-LICENSE.txt`、`YT-DLP-THIRD-PARTY.txt`、`MPV-*` 文件保存在同目录。mpv Windows 包为其官网列出的第三方构建，不能把它写成 mpv 官方发布的 Windows 二进制。
