# B 站音频点播插件：安装与使用

本插件供 Windows 本机的 Codex 使用。你可以在聊天中搜索 B 站视频，选定候选后播放其中的音频；播放时无需打开 B 站网页或客户端。电脑需要有可用的音频输出设备。完整发布包包含 Node.js、yt-dlp 和 mpv，无需分别安装或修改系统 `PATH`；Git 源码仓库不包含这些运行文件。

> 仓库源码包含面板收起／展开、按播放历史顺序前进、播放历史去重及候选封面本地缓存；本机已安装的 0.2.0 及对应 ZIP 仍是上一轮测试版，待审核后重新打包安装。

## 安装

已经在 Codex 插件列表中看到 **0.2.0** 且显示“已安装、已启用”的用户，无需重复安装。旧版用户更新时，覆盖个人插件源目录后重新安装或刷新插件。其他 Windows 电脑按以下步骤操作：

1. 从完整发布 ZIP 解压取得 `bilibili-audio` 文件夹，将其复制到 `%USERPROFILE%\.codex\plugins\bilibili-audio`；请保留其中的 `runtime/`、`vendor/`、`server/`、`panel/` 等子目录。直接下载 Git 源码仓库不能代替发布包。
2. 在 `%USERPROFILE%\.agents\plugins\marketplace.json` 的 `plugins[]` 中登记本插件。如果文件不存在，创建上级文件夹和 JSON 文件，内容如下；如果已有其他插件，只把新条目加入现有的 `plugins[]`，不要覆盖它们。

   ```json
   {
     "name": "personal",
     "interface": { "displayName": "Personal" },
     "plugins": [
       {
         "name": "bilibili-audio",
         "source": { "source": "local", "path": "./.codex/plugins/bilibili-audio" },
         "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
         "category": "Productivity"
       }
     ]
   }
   ```

   `source.path` 相对于用户主目录。
3. 重启 Codex 桌面版，在插件目录中选择个人 marketplace 并安装本插件；也可在终端运行 `codex plugin add bilibili-audio@personal`。安装后确认插件处于启用状态。

Codex 从安装缓存加载插件。更新插件目录后需要重新安装或刷新，勿直接编辑缓存副本。官方本地安装方式见 [OpenAI 插件文档](https://developers.openai.com/plugins/build/plugins)。

## 在聊天中点播

- 说“搜索《十面埋伏》琵琶版”，Codex 会展示带编号的候选视频；说“播放第 2 个”后才开始播放。模糊搜索不会自动选第一条。
- 直接提供 BV 号或 B 站视频链接，也可以指定要播放的视频。
- 候选按编号分段显示标题、UP 主、时长、B 站视频发布日期、BV 号、视频链接和封面。插件将封面暂存于本机后展示，避免聊天直接加载 B 站图片时偶发断图；获取失败时保留文字候选。新搜索会替换旧候选。
- 说“暂停”“继续”“停止播放”“音量调到 40”“现在播放到哪里了”可控制或查询播放；“停止播放”按暂停处理，继续时从原进度播放。
- “上一首”“下一首”沿实际播放历史移动；在历史末尾，“下一首”不可用。再次点播同一个 BV 视频会把它从原位置移到历史末尾，历史中只保留一份。顺序模式在当前视频自然播完后沿同一历史游标前进，到历史末尾就停播；单曲模式循环当前视频。两种模式都关闭时，自然播完即停。
- 首次连接本地播放服务时会出现独立悬浮面板；第一排是单曲循环、顺序播放、偏好查看，第二排是暂停／继续、上一首、下一首，第三排是音量滑槽。可按右上角按钮收起为可拖动的小悬浮球，点击小球再展开；收起不会改变播放。滑槽可拖动，获得焦点后也可用左右方向键逐级调节。偏好功能留待后续版本，当前按钮不可用。

`0.2.0` 版本提供 `search`、`play`、`previous`、`next`、`set_mode`、`set_paused`、`stop`、`set_volume`、`status` 九个工具。搜索和播放面向无需登录的公开视频；B 站访问限制、版权和接口变化可能导致个别视频无法搜索或播放。插件不读取浏览器 Cookie，也不下载音视频内容；仅在本机暂存候选封面。
