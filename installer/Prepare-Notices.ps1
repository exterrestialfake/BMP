#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Destination,
    [Parameter(Mandatory=$true)][string]$BundleMetadata
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$licenseRoot = Join-Path $repo 'plugins/bilibili-audio/licenses'
$utf8 = New-Object Text.UTF8Encoding($false)
$notice = New-Object Text.StringBuilder
[void]$notice.AppendLine('BMP 安装许可与第三方声明')
[void]$notice.AppendLine('')
[void]$notice.AppendLine('继续安装表示你同意遵循各组件适用的许可。BMP 源码使用 MIT；其他开源组件按其各自许可授予权利。Microsoft Windows SDK 条款只适用于安装时从上游取得的 Microsoft DLL，不限制 MIT、GPL 或 LGPL 组件授予的权利。')
[void]$notice.AppendLine('Microsoft 组件只随本程序在 Microsoft Windows 上使用和分发；接收者及后续分发者须遵守下附 SDK 许可中适用的使用、分发、版权保留、免责和其他保护条款。EXE 不含 mpv 二进制、Microsoft DLL 或字体配置；它们在安装时直接从固定上游发布归档获取。')
[void]$notice.AppendLine("`n============================================================")
[void]$notice.AppendLine('BMP 源码许可证：MIT')
[void]$notice.AppendLine("============================================================`n")
[void]$notice.AppendLine([IO.File]::ReadAllText((Join-Path $repo 'LICENSE')))
[void]$notice.AppendLine("`n============================================================")
[void]$notice.AppendLine('第三方组件与源码获取指引')
[void]$notice.AppendLine("============================================================`n")
[void]$notice.AppendLine([IO.File]::ReadAllText((Join-Path $repo 'THIRD_PARTY_NOTICES.md')))

# 保留每份原文，不合并删减法律段落。相同许可证附有不同版权声明时也分别保留。
$licenseFiles = @(Get-ChildItem -LiteralPath $licenseRoot -Recurse -File | Sort-Object FullName)
if (-not $licenseFiles) { throw '缺少随包第三方许可原文。' }
foreach ($file in $licenseFiles) {
    $relative = $file.FullName.Substring($licenseRoot.Length + 1).Replace('\','/')
    [void]$notice.AppendLine("`n============================================================")
    [void]$notice.AppendLine("原始许可文件：$relative")
    [void]$notice.AppendLine("============================================================`n")
    [void]$notice.AppendLine([IO.File]::ReadAllText($file.FullName))
}

# 只纳入实际贡献输出字节的包，而非整个 node_modules 或锁文件。
$metadata = Get-Content -LiteralPath $BundleMetadata -Raw | ConvertFrom-Json
$inputNames = @($metadata.outputs.PSObject.Properties | ForEach-Object {
    $_.Value.inputs.PSObject.Properties | Where-Object { $_.Value.bytesInOutput -gt 0 } | ForEach-Object { $_.Name }
})
if (-not $inputNames) { throw '打包元数据缺少实际输出输入文件，不能生成准确的第三方声明。' }
$packages = @($inputNames | ForEach-Object {
    if ($_ -match '^node_modules/(@[^/]+/[^/]+|[^/]+)/') { $matches[1] }
} | Sort-Object -Unique)
foreach ($package in $packages) {
    $packageRoot = Join-Path "$repo/server/node_modules" $package
    $info = Get-Content -LiteralPath "$packageRoot/package.json" -Raw | ConvertFrom-Json
    $licenseFiles = @(Get-ChildItem -LiteralPath $packageRoot -File |
        Where-Object { $_.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE)' } | Sort-Object Name)
    if (-not $licenseFiles) { throw "实际打包依赖缺少许可文件：$package" }
    [void]$notice.AppendLine("`n============================================================")
    [void]$notice.AppendLine("JavaScript 包：$package $($info.version)")
    [void]$notice.AppendLine("许可标识：$($info.license)")
    $source = $info.repository
    if ($source -isnot [string]) { $source = $info.repository.url }
    [void]$notice.AppendLine("来源：$source")
    foreach ($file in $licenseFiles) {
        [void]$notice.AppendLine("`n原始文件：$($file.Name)`n")
        [void]$notice.AppendLine([IO.File]::ReadAllText($file.FullName))
    }
}
$destinationPath = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path (Split-Path $destinationPath -Parent) -Force | Out-Null
[IO.File]::WriteAllText($destinationPath, $notice.ToString(), $utf8)
Write-Output "已生成第三方声明：$destinationPath；JavaScript 包：$($packages -join ', ')"
