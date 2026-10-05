#Requires -Version 5.1
[CmdletBinding()]
param([switch]$PrepareRuntime)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$build = Join-Path $repo '.build'
$plugin = Join-Path $repo 'plugins/bilibili-audio'
$version = (Get-Content -LiteralPath "$plugin/plugin.json" -Raw | ConvertFrom-Json).version

function Get-VerifiedDownload([string]$Url, [string]$Path, [string]$Hash) {
    if (-not (Test-Path -LiteralPath $Path)) { Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Hash) {
        throw "下载资产哈希不一致：$Url"
    }
}

New-Item -ItemType Directory -Path "$build/tools", "$build/runtime" -Force | Out-Null
if ($PrepareRuntime) {
    # 从原始发布资产准备运行依赖；版本与 THIRD_PARTY_NOTICES.md 一致。
    $nodeZip = "$build/runtime/node-v24.14.1-win-x64.zip"
    Get-VerifiedDownload 'https://nodejs.org/dist/v24.14.1/node-v24.14.1-win-x64.zip' $nodeZip '6e50ce5498c0cebc20fd39ab3ff5df836ed2f8a31aa093cecad8497cff126d70'
    Expand-Archive -LiteralPath $nodeZip -DestinationPath "$build/runtime/node" -Force
    New-Item -ItemType Directory -Path "$plugin/runtime", "$plugin/vendor/yt-dlp", "$plugin/vendor/mpv" -Force | Out-Null
    Copy-Item -LiteralPath "$build/runtime/node/node-v24.14.1-win-x64/node.exe" -Destination "$plugin/runtime/node.exe"
    Get-VerifiedDownload 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe' "$plugin/vendor/yt-dlp/yt-dlp.exe" '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a'
    $mpvArchive = "$build/runtime/mpv.7z"
    Get-VerifiedDownload 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20260926/mpv-x86_64-20260926-git-35af06172b.7z' $mpvArchive 'a9aaf0cff587473551199a30db717d92c4f75fd06fa64c2e9689800e48f48939'
    & "$env:WINDIR/System32/tar.exe" -xf $mpvArchive -C "$plugin/vendor/mpv"
    if ($LASTEXITCODE -ne 0) { throw 'mpv 归档解压失败。需要支持 7z 的 Windows tar。' }
}
foreach ($required in @('runtime/node.exe','vendor/yt-dlp/yt-dlp.exe','vendor/mpv/mpv.exe','vendor/mpv/d3dcompiler_43.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $plugin $required))) { throw "缺少 $required；可运行 Build.ps1 -PrepareRuntime。" }
}

Push-Location "$repo/server"
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败。' }
    & npm.cmd run build -- --metafile=../.build/bundle-meta.json
    if ($LASTEXITCODE -ne 0) { throw 'Server 构建失败。' }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Server 测试失败。' }
} finally { Pop-Location }

$payload = Join-Path $build "payload-$version"
if (Test-Path -LiteralPath $payload) {
    if (-not ([IO.Path]::GetFullPath($payload).StartsWith([IO.Path]::GetFullPath($build) + '\'))) { throw '构建路径越界。' }
    Remove-Item -LiteralPath $payload -Recurse -Force
}
$targetPlugin = "$payload/plugins/bilibili-audio"
New-Item -ItemType Directory -Path $targetPlugin,"$payload/.agents/plugins" -Force | Out-Null
foreach ($part in @('plugin.json','mcp.json','assets','skills','panel','server','runtime')) {
    Copy-Item -LiteralPath (Join-Path $plugin $part) -Destination $targetPlugin -Recurse -Force
}
foreach ($part in @('yt-dlp/yt-dlp.exe')) {
    $destination = Join-Path "$targetPlugin/vendor" $part
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path "$plugin/vendor" $part) -Destination $destination
}
& "$PSScriptRoot/Prepare-Notices.ps1" -Destination "$targetPlugin/THIRD_PARTY_NOTICES.txt" -BundleMetadata "$build/bundle-meta.json"
Copy-Item -LiteralPath "$repo/README.md","$repo/README.en.md","$repo/LICENSE" -Destination $payload
# mpv 二进制由用户安装时直接从上游获取；EXE 仅包含固定版本下载与校验脚本。
Copy-Item -LiteralPath "$PSScriptRoot/Prepare-Mpv.ps1" -Destination $payload
$utf8 = New-Object Text.UTF8Encoding($false)
$marketplace = @{name='bmp-release';interface=@{displayName='Bilibili as Music Player'};plugins=@(@{
    name='bilibili-audio';source=@{source='local';path='./plugins/bilibili-audio'};
    policy=@{installation='AVAILABLE';authentication='ON_INSTALL'};category='Productivity'})}
[IO.File]::WriteAllText("$payload/.agents/plugins/marketplace.json", ($marketplace | ConvertTo-Json -Depth 10), $utf8)
$hashes = @(Get-ChildItem -LiteralPath $payload -Recurse -File -Force | ForEach-Object {
    @{path=$_.FullName.Substring($payload.Length+1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}
})
[IO.File]::WriteAllText("$payload/payload-sha256.json", ($hashes | ConvertTo-Json -Depth 5), $utf8)

$compilerSetup = "$build/tools/innosetup-6.7.3.exe"
Get-VerifiedDownload 'https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe' $compilerSetup '9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732'
$signature = Get-AuthenticodeSignature -LiteralPath $compilerSetup
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Pyrsys') { throw 'Inno Setup 签名无效。' }
$compilerDir = "$build/tools/inno"
if (-not (Test-Path -LiteralPath "$compilerDir/ISCC.exe")) {
    $process = Start-Process -FilePath $compilerSetup -ArgumentList @('/PORTABLE=1','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR="'+$compilerDir+'"')) -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw 'Inno Setup 便携构建工具准备失败。' }
}
& "$compilerDir/ISCC.exe" "/DVersion=$version" "/DPayload=$payload" "$PSScriptRoot/BMP.iss"
if ($LASTEXITCODE -ne 0) { throw 'EXE 编译失败。' }
Get-FileHash -LiteralPath "$repo/release/BMP-Setup-$version-windows-x64.exe" | Format-List
