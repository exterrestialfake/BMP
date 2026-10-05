#Requires -Version 5.1
[CmdletBinding()]
param([string]$SetupPath)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$version = (Get-Content -LiteralPath "$repo/plugins/bilibili-audio/plugin.json" -Raw | ConvertFrom-Json).version
if (-not $SetupPath) { $SetupPath = "$repo/release/BMP-Setup-$version-windows-x64.exe" }
$SetupPath = [IO.Path]::GetFullPath($SetupPath)
$testRoot = Join-Path $repo ('.build/installer-test-' + [guid]::NewGuid().ToString('N'))
$app = Join-Path $testRoot '安装验收 空格'
$testCodexHome = Join-Path $app '.installer-test-home'
$utf8 = New-Object Text.UTF8Encoding($false)
$cachedArchive = Join-Path $repo '.build/runtime/mpv.7z'
$cachedArchiveArgs = if (Test-Path -LiteralPath $cachedArchive) { @('/MPVARCHIVE="' + $cachedArchive + '"') } else { @() }
New-Item -ItemType Directory -Path $testCodexHome -Force | Out-Null
[IO.File]::WriteAllText("$testCodexHome/config.toml", "# keep this comment`nmodel = `"gpt-6.1-sol`"`n", $utf8)
[IO.File]::WriteAllText("$testCodexHome/user-data.txt", '用户数据应保留', $utf8)

function Run-Setup([string]$Exe, [string[]]$Arguments) {
    $process = Start-Process -FilePath $Exe -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    try {
        if (-not $process.WaitForExit(300000)) { $process.Kill(); throw "验收子进程超时：$Exe" }
        return $process.ExitCode
    } finally { $process.Dispose() }
}
function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    Write-Host "通过：$Message"
}

# 普通安装必须拒绝运行中的 Host；测试模式固定使用独立 CODEX_HOME 与单独卸载登记。
if (Get-Process -Name codex -ErrorAction SilentlyContinue) {
    $guard = Run-Setup $SetupPath @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR="'+$testRoot+'\guard"'),('/LOG="'+$testRoot+'\guard.log"'))
    Assert ($guard -ne 0 -and -not (Test-Path "$testRoot/guard/plugins")) 'Codex 后台运行时在写入程序前拒绝普通安装'
}
$missing = Run-Setup $SetupPath @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/ISOLATED=1',('/CODEXCLI="'+$testRoot+'\missing.exe"'),('/DIR="'+$app+'"'),('/LOG="'+$testRoot+'\missing.log"'))
Assert ($missing -ne 0 -and -not (Test-Path "$app/plugins")) '缺少 CLI 不产生假成功或插件程序'

# 真实安装事务的失败分支：前置命令成功，plugin add 返回失败。
$mockSource = @'
using System;
class FakeCodex {
  static int Main(string[] args) {
    if (args.Length > 1 && args[1] == "add") { Console.Error.WriteLine("expected install failure"); return 2; }
    Console.WriteLine("{\"installed\":[],\"marketplaces\":[]}"); return 0;
  }
}
'@
$mockFile = Join-Path $testRoot 'failing-cli.cs'
[IO.File]::WriteAllText($mockFile, $mockSource, $utf8)
$mockExe = Join-Path $testRoot 'failing-cli.exe'
& "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:exe ("/out:$mockExe") $mockFile
if ($LASTEXITCODE -ne 0) { throw '失败分支验收程序编译失败。' }
$failureApp = "$testRoot/transaction-failure"
$failure = Run-Setup $SetupPath (@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/ISOLATED=1',('/CODEXCLI="'+$mockExe+'"'),('/DIR="'+$failureApp+'"'),('/LOG="'+$testRoot+'\failure.log"')) + $cachedArchiveArgs)
Assert ($failure -eq 10 -and -not (Test-Path "$failureApp/install-state.json")) '登记失败返回专用错误码且不报告已安装'
Assert (-not (Test-Path "$failureApp/.installer-test-home/config.toml")) '登记失败恢复原配置'
$failureRemoval = Run-Setup "$failureApp/uninstall/unins000.exe" @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/ISOLATED=1',('/LOG="'+$testRoot+'\failure-uninstall.log"'))
Assert ($failureRemoval -eq 0 -and -not (Test-Path "$failureApp/plugins/bilibili-audio/runtime/node.exe")) '未完成登记的程序仍可正常卸载'
Assert (-not (Test-Path "$failureApp/plugins/bilibili-audio/vendor/mpv/mpv.exe")) '未完成登记时卸载也清理下载的 mpv'

# 在新的 PowerShell 子作用域注入断网；不修改系统代理或真实下载地址。
& {
    function Invoke-WebRequest { throw '验收注入：网络不可用' }
    $networkFailed = $false
    $networkRoot = Join-Path $testRoot 'network-failure'
    try { & "$repo/installer/Prepare-Mpv.ps1" -Root $networkRoot }
    catch { $networkFailed = $_.Exception.Message -match 'mpv 上游下载失败' }
    Assert $networkFailed '断网产生明确错误，有限重试后结束'
    Assert (-not (Test-Path "$networkRoot/plugins/bilibili-audio/vendor/mpv/mpv.exe") -and
        @((Get-ChildItem -LiteralPath $networkRoot -Directory -Filter '.mpv-download-*')).Count -eq 0) '断网不安装 mpv，并清理临时下载文件'
}

# 真实安装器遇到错误归档必须在插件登记前失败，不能执行归档内文件。
$invalidArchive = Join-Path $testRoot 'invalid-mpv.7z'
[IO.File]::WriteAllText($invalidArchive, 'not the upstream archive', $utf8)
$invalidApp = Join-Path $testRoot 'invalid-archive'
$invalid = Run-Setup $SetupPath @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/ISOLATED=1',('/CODEXCLI="'+$mockExe+'"'),('/MPVARCHIVE="'+$invalidArchive+'"'),('/DIR="'+$invalidApp+'"'),('/LOG="'+$testRoot+'\invalid-archive.log"'))
Assert ($invalid -eq 10 -and -not (Test-Path "$invalidApp/install-state.json") -and
    -not (Test-Path "$invalidApp/plugins/bilibili-audio/vendor/mpv/mpv.exe")) '归档哈希错误返回专用错误码，未加载播放器或登记插件'
Assert (@((Get-ChildItem -LiteralPath $invalidApp -Directory -Filter '.mpv-download-*')).Count -eq 0) '归档校验失败清理临时目录'
$invalidRemoval = Run-Setup "$invalidApp/uninstall/unins000.exe" @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/ISOLATED=1')
Assert ($invalidRemoval -eq 0) '下载校验失败后仍可卸载'

$cli = @(Get-ChildItem "$env:LOCALAPPDATA/OpenAI/Codex/bin" -Directory | Sort-Object LastWriteTime -Descending |
    ForEach-Object { Join-Path $_.FullName 'codex.exe' } | Where-Object { Test-Path -LiteralPath $_ })[0]
if (-not $cli) { throw '验收机需要真实 Codex CLI。' }
$oldHome = $env:CODEX_HOME
try {
    $env:CODEX_HOME = $testCodexHome
    $other = Join-Path $testRoot 'other-repository'
    New-Item -ItemType Directory -Path "$other/.agents/plugins", "$other/plugins/keep-me" -Force | Out-Null
    [IO.File]::WriteAllText("$other/.agents/plugins/marketplace.json", '{"name":"installer-neighbor","plugins":[{"name":"keep-me","source":{"source":"local","path":"./plugins/keep-me"},"category":"Productivity","policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"}}]}', $utf8)
    [IO.File]::WriteAllText("$other/plugins/keep-me/plugin.json", '{"name":"keep-me","version":"1.0.0","description":"Unrelated test plugin"}', $utf8)
    & $cli plugin marketplace add $other --json
    if ($LASTEXITCODE -ne 0) { throw '邻居 marketplace 创建失败。' }
    & $cli plugin add keep-me@installer-neighbor --json
    if ($LASTEXITCODE -ne 0) { throw '邻居插件安装失败。' }
    $neighborFile = "$testCodexHome/plugins/cache/installer-neighbor/keep-me/local/plugin.json"
    $neighborHash = (Get-FileHash -LiteralPath $neighborFile).Hash
    $common = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/ISOLATED=1',('/DIR="'+$app+'"'))
    $exit = Run-Setup $SetupPath ($common + ('/LOG="'+$testRoot+'\install.log"'))
    Assert ($exit -eq 0) '完整 EXE 安装成功（中文与空格路径）'
    $installedPlugin = (Get-Content -LiteralPath "$app/install-state.json" -Raw | ConvertFrom-Json).installedPath
    Assert (Test-Path -LiteralPath "$installedPlugin/runtime/node.exe") 'Codex 安装副本包含随包 Node.js'
    Assert ((Get-Content -LiteralPath "$installedPlugin/plugin.json" -Raw | ConvertFrom-Json).version -eq $version) 'Codex 安装副本版本正确'
    $pluginInterface = (Get-Content -LiteralPath "$installedPlugin/plugin.json" -Raw | ConvertFrom-Json).extensions.'com.openai'.interface
    Assert ($pluginInterface.displayName -eq 'Bilibili as Music Player') 'Codex 安装副本使用统一产品名称'
    foreach ($iconPath in @($pluginInterface.logo, $pluginInterface.composerIcon)) {
        Assert ($iconPath -eq './assets/icon.png' -and
            (Test-Path -LiteralPath (Join-Path $installedPlugin $iconPath)) -and
            (Get-FileHash -LiteralPath (Join-Path $installedPlugin $iconPath)).Hash -eq
                (Get-FileHash -LiteralPath "$repo/plugins/bilibili-audio/assets/icon.png").Hash) 'Codex 安装副本包含清单引用的完整图标'
    }
    Assert ((Get-FileHash -LiteralPath "$app/LICENSE").Hash -eq (Get-FileHash -LiteralPath "$repo/LICENSE").Hash) '安装保留 BMP 源码 MIT 许可证'
    $installedNotices = [IO.File]::ReadAllText("$installedPlugin/THIRD_PARTY_NOTICES.txt")
    foreach ($license in Get-ChildItem -LiteralPath "$repo/plugins/bilibili-audio/licenses" -File -Recurse) {
        Assert ($installedNotices.Contains([IO.File]::ReadAllText($license.FullName))) ("安装保留第三方许可原文：" + $license.Name)
    }
    Assert ($installedNotices.Contains('继续安装表示你同意遵循各组件适用的许可') -and
        $installedNotices.Contains('EULAID:WIN10SDK.RTM.AUG_2018_en-US')) '安装保留接收者条款与完整 Microsoft SDK 许可'
    Assert (-not (Test-Path -LiteralPath "$installedPlugin/licenses")) '安装使用集中声明，不复制重复许可目录'
    Assert ((Get-FileHash -LiteralPath $neighborFile).Hash -eq $neighborHash) '其他插件未改动'
    $installLog = Get-Content -LiteralPath "$testRoot/install.log" -Raw
    Assert ($installLog -match '正在从 mpv 上游下载固定版本' -and $installLog -match '归档和三个运行文件的 SHA256 校验通过') '首次安装真实从上游下载 mpv 并校验'

    # MCP 验收单独的用户管道，不能连接用户正在使用的播放主实例。
    $previousProfile = $env:USERPROFILE
    $previousPlugin = $env:BMP_PLUGIN_ROOT
    try {
        $env:USERPROFILE = $testCodexHome
        $env:BMP_PLUGIN_ROOT = $installedPlugin
        Push-Location "$repo/server"
        try { & node.exe --import tsx --test test/mcp.test.ts; Assert ($LASTEXITCODE -eq 0) '安装副本握手、八工具与非法输入验收' }
        finally { Pop-Location }
    } finally { $env:USERPROFILE=$previousProfile; $env:BMP_PLUGIN_ROOT=$previousPlugin }

    & "$installedPlugin/vendor/yt-dlp/yt-dlp.exe" --version
    Assert ($LASTEXITCODE -eq 0) '随包 yt-dlp 可启动'
    $samplePath = Join-Path $testRoot 'sample.wav'
    $sample = New-Object IO.BinaryWriter([IO.File]::Create($samplePath))
    try {
        $sample.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $sample.Write([uint32]16036)
        $sample.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt ')); $sample.Write([uint32]16)
        $sample.Write([uint16]1); $sample.Write([uint16]1); $sample.Write([uint32]8000)
        $sample.Write([uint32]16000); $sample.Write([uint16]2); $sample.Write([uint16]16)
        $sample.Write([Text.Encoding]::ASCII.GetBytes('data')); $sample.Write([uint32]16000)
        $sample.Write((New-Object byte[] 16000))
    } finally { $sample.Dispose() }
    $decode = Run-Setup "$installedPlugin/vendor/mpv/mpv.exe" @('--no-config','--ao=null','--vo=null','--no-terminal','--idle=no','--frames=1','--',('"'+$samplePath+'"'))
    Assert ($decode -eq 0) '精简 mpv 包可解码音频（无声输出，不影响当前播放）'

    # 模拟旧版本 bundle／清单，再用真实安装器刷新，而非仅核验重复调用。
    $oldManifest = Get-Content -LiteralPath "$app/plugins/bilibili-audio/plugin.json" -Raw | ConvertFrom-Json
    $oldManifest.version = '0.3.4'
    [IO.File]::WriteAllText("$app/plugins/bilibili-audio/plugin.json", ($oldManifest | ConvertTo-Json -Depth 20), $utf8)
    [IO.File]::WriteAllText("$app/plugins/bilibili-audio/server/index.mjs", '// old bundle', $utf8)
    $oldAdded = (& $cli plugin add bilibili-audio@bmp-release --json) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw '旧版本模拟失败。' }
    Assert ((Get-Content -LiteralPath (Join-Path $oldAdded.installedPath 'plugin.json') -Raw | ConvertFrom-Json).version -eq '0.3.4') '验收前缓存确为旧版本'
    # 重装不能复用被篡改的下载文件；校验失败时从正确归档修复。
    [IO.File]::WriteAllText("$app/plugins/bilibili-audio/vendor/mpv/mpv.exe", 'tampered runtime', $utf8)
    $exit = Run-Setup $SetupPath ($common + $cachedArchiveArgs + ('/LOG="'+$testRoot+'\upgrade.log"'))
    Assert ($exit -eq 0 -and (Get-FileHash "$installedPlugin/server/index.mjs").Hash -eq (Get-FileHash "$repo/plugins/bilibili-audio/server/index.mjs").Hash) '升级刷新源码目录与 Codex 缓存'
    Assert ((Get-FileHash -LiteralPath "$installedPlugin/vendor/mpv/mpv.exe").Hash -eq 'DF33D979A67ED25253C2B3B4382904244E6914FB42B2994118FB0694FCFCB384') '升级修复哈希不正确的 mpv，而非复用篡改文件'
    $exit = Run-Setup $SetupPath ($common + ('/LOG="'+$testRoot+'\repeat.log"'))
    Assert ($exit -eq 0) '同版本重复安装成功'
    Assert ((Get-Content -LiteralPath "$testRoot/repeat.log" -Raw) -match '复用已下载的版本') '重复安装复用校验正确的 mpv，无须再次下载'

    $exit = Run-Setup "$app/uninstall/unins000.exe" @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/ISOLATED=1',('/LOG="'+$testRoot+'\uninstall.log"'))
    Assert ($exit -eq 0) '真实 EXE 卸载成功'
    Assert (-not (Test-Path "$app/plugins/bilibili-audio/runtime/node.exe") -and -not (Test-Path "$installedPlugin/runtime/node.exe") -and
        -not (Test-Path (Join-Path $oldAdded.installedPath 'runtime/node.exe'))) '卸载移除程序与各版本 Codex 插件副本'
    Assert (-not (Test-Path "$app/plugins/bilibili-audio/vendor/mpv/mpv.exe") -and
        -not (Test-Path "$app/plugins/bilibili-audio/vendor/mpv/d3dcompiler_43.dll") -and
        -not (Test-Path "$app/plugins/bilibili-audio/vendor/mpv/mpv/fonts.conf")) '卸载移除三个安装时下载的运行文件'
    Assert ((Get-FileHash -LiteralPath $neighborFile).Hash -eq $neighborHash -and (Test-Path "$testCodexHome/user-data.txt")) '卸载保留其他插件与用户数据'
    $config = Get-Content -LiteralPath "$testCodexHome/config.toml" -Raw
    Assert ($config -match 'gpt-6.1-sol' -and $config -match 'keep this comment' -and $config -notmatch 'bmp-release') '卸载保留其他配置且移除 BMP 登记'
    Write-Host "安装验收通过；证据目录：$testRoot"
} finally { $env:CODEX_HOME=$oldHome }
