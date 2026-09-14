# dsh-ag 一键安装：把 ag中转站 插件装进 DSH 桌面版的 profile。
#
# 它只写你自己的用户目录，做四件事：
#   1. 把 dsh-ag\ 复制到 profile 的 node_modules\ 下；
#   2. 把 vendor\dsh-ag-1.0.0.tgz 复制到 profile 的 vendor\ 下；
#   3. 在 profile 的 package.json 里登记依赖，并把插件加进 dsh.profile.bundles；
#   4. profile 里如果有 pnpm-lock.yaml，把它更新到与 package.json 一致，
#      这样 DSH 自带的插件市场之后仍然能正常装卸别的插件。
#
# 它不碰 settings.yaml，也不读不写任何密钥。改动过的文件都会先备份成
# <文件名>.bak-<时间戳>。
#
# 用法：
#   .\install.ps1                        装进默认 profile（desktop）
#   .\install.ps1 -Profile <名字>        装进别的 profile
#   .\install.ps1 -DshHome <目录>        换一个 DSH 主目录（默认 %USERPROFILE%\.dsh）
#   .\install.ps1 -SkipLockFile          不动 pnpm-lock.yaml

[CmdletBinding()]
param(
    [string] $Profile = 'desktop',
    [string] $DshHome,
    [switch] $SkipLockFile
)

$ErrorActionPreference = "Stop"

$pluginName     = 'dsh-ag'
$tarballName    = 'dsh-ag-1.0.0.tgz'
$pluginSpec     = 'file:vendor\dsh-ag-1.0.0.tgz'
$pluginSpecJson = 'file:vendor\\dsh-ag-1.0.0.tgz'
$pluginVersion  = 'file:vendor/dsh-ag-1.0.0.tgz'
$pluginKey      = 'dsh-ag@file:vendor/dsh-ag-1.0.0.tgz'
$stamp          = (Get-Date).ToString('yyyyMMdd-HHmmss')
$utf8           = New-Object System.Text.UTF8Encoding($false)
$lf             = [string][char]10
$crlf           = [string][char]13 + [string][char]10

function Step { param([string] $Text) Write-Host ('==> ' + $Text) -ForegroundColor Cyan }
function Note { param([string] $Text) Write-Host ('    ' + $Text) }
function Good { param([string] $Text) Write-Host ('    ' + $Text) -ForegroundColor Green }
function Stop-With {
    param([string] $Text)
    Write-Host ""
    Write-Host ('安装没有完成：' + $Text) -ForegroundColor Red
    exit 1
}
function Get-Text { param([string] $Path) return [System.IO.File]::ReadAllText($Path, $utf8) }
function Set-Text { param([string] $Path, [string] $Text) [System.IO.File]::WriteAllText($Path, $Text, $utf8) }
function Backup-File {
    param([string] $Path)
    $target = $Path + '.bak-' + $stamp
    Copy-Item -LiteralPath $Path -Destination $target -Force
    Note ('已备份：' + $target)
}
function Get-List {
    param([string] $Text)
    $list = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in ($Text -split $lf)) {
        if ($line.EndsWith([string][char]13)) { $line = $line.Substring(0, $line.Length - 1) }
        $list.Add($line)
    }
    return ,$list
}
function Get-Indent {
    param([string] $Line)
    return ($Line.Length - $Line.TrimStart().Length)
}
function Find-Member {
    param([System.Collections.Generic.List[string]] $Text, [string] $Signature)
    for ($i = 0; $i -lt $Text.Count; $i++) {
        if ($Text[$i].Trim() -eq $Signature) { return $i }
    }
    return -1
}
function Find-End {
    param([System.Collections.Generic.List[string]] $Text, [int] $Open, [string] $Closer)
    $pad = ' ' * (Get-Indent $Text[$Open])
    for ($i = $Open + 1; $i -lt $Text.Count; $i++) {
        if ($Text[$i] -eq ($pad + $Closer) -or $Text[$i] -eq ($pad + $Closer + ',')) { return $i }
    }
    return -1
}

# ---------------------------------------------------------------- 0. 插件文件
Step '检查插件文件'

$sourceRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($sourceRoot)) { $sourceRoot = (Get-Location).Path }
$pluginSource  = Join-Path $sourceRoot $pluginName
$tarballSource = Join-Path (Join-Path $sourceRoot 'vendor') $tarballName

if (-not (Test-Path -LiteralPath (Join-Path $pluginSource 'index.js'))) {
    Stop-With ('没有找到插件目录 ' + $pluginSource + '。请把 install.ps1、dsh-ag、vendor 三样放在同一层（压缩包解压后就是这个结构）。')
}
if (-not (Test-Path -LiteralPath (Join-Path $pluginSource 'cordis.patch.yml'))) {
    Stop-With '插件目录里缺少 cordis.patch.yml，压缩包可能不完整，请重新解压。'
}
if (-not (Test-Path -LiteralPath $tarballSource)) {
    Stop-With ('没有找到安装包 ' + $tarballSource + '。')
}
Note ('插件目录：' + $pluginSource)

# ------------------------------------------------------------------ 1. profile
if ([string]::IsNullOrEmpty($DshHome)) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
$profilesDir  = Join-Path $DshHome 'profiles'
$profileDir   = Join-Path $profilesDir $Profile
$manifestPath = Join-Path $profileDir 'package.json'

Step ('检查 profile：' + $profileDir)

if (-not (Test-Path -LiteralPath $profilesDir)) {
    Stop-With ('没有找到 DSH 主目录 ' + $DshHome + '。请先启动一次 DSH Desktop，让它把自己的目录建好；如果 DSH 装在别的地方，用 -DshHome <目录> 指定。')
}
if (-not (Test-Path -LiteralPath $manifestPath)) {
    $names = @()
    foreach ($item in (Get-ChildItem -LiteralPath $profilesDir -Directory -ErrorAction SilentlyContinue)) { $names += $item.Name }
    $hint = ''
    if ($names.Count -gt 0) { $hint = '这台机器上已有的 profile：' + ($names -join '、') + '。可以用 -Profile <名字> 指定其中一个。' }
    if (Test-Path -LiteralPath $profileDir) {
        Stop-With ('目录 ' + $profileDir + ' 里没有 package.json，这个 profile 可能还没被 DSH 建好。先启动一次 DSH Desktop 再试。' + $hint)
    }
    Stop-With ('没有找到 profile「' + $Profile + '」。' + $hint)
}

# ------------------------------------------------------------- 2. 复制插件本体
Step '复制插件到 node_modules'

$nodeModulesDir = Join-Path $profileDir 'node_modules'
$pluginTarget   = Join-Path $nodeModulesDir $pluginName

if (-not (Test-Path -LiteralPath $nodeModulesDir)) {
    [System.IO.Directory]::CreateDirectory($nodeModulesDir) | Out-Null
    Note ('新建目录：' + $nodeModulesDir)
}
if (Test-Path -LiteralPath $pluginTarget) {
    try {
        [System.IO.Directory]::Delete($pluginTarget, $true)
    } catch {
        Stop-With ('删不掉旧插件目录 ' + $pluginTarget + '。请先退出 DSH Desktop 再运行一次。（' + $_.Exception.Message + '）')
    }
}
Copy-Item -LiteralPath $pluginSource -Destination $pluginTarget -Recurse -Force
Good ('已安装：' + $pluginTarget)

if (-not (Test-Path -LiteralPath (Join-Path $pluginTarget 'index.js'))) {
    Stop-With '复制之后没有看到 index.js，请重新解压压缩包再试。'
}

# --------------------------------------------------------------- 3. 复制安装包
$vendorDir     = Join-Path $profileDir 'vendor'
$tarballTarget = Join-Path $vendorDir $tarballName

if (-not (Test-Path -LiteralPath $vendorDir)) {
    [System.IO.Directory]::CreateDirectory($vendorDir) | Out-Null
    Note ('新建目录：' + $vendorDir)
}
Copy-Item -LiteralPath $tarballSource -Destination $tarballTarget -Force
Good ('已更新：' + $tarballTarget)

# --------------------------------------------------------- 4. 登记 package.json
Step '在 profile 的 package.json 里登记'

$manifest = Get-Text $manifestPath
$nl = $lf
if ($manifest.Contains($crlf)) { $nl = $crlf }
$lines = Get-List $manifest
$manifestChanged = $false

$depOpen = Find-Member $lines '"dependencies": {'
if ($depOpen -lt 0) {
    Stop-With '这个 profile 的 package.json 里没有 dependencies 段，格式和预期不同。请按 INSTALL.zh-CN.md 里的方式 B 手动登记。'
}
$depClose = Find-End $lines $depOpen '}'
if ($depClose -lt 0) {
    Stop-With '这个 profile 的 package.json 格式和预期不同（dependencies 段没有闭合）。请按 INSTALL.zh-CN.md 里的方式 B 手动登记。'
}

$depPresent = $false
for ($i = $depOpen + 1; $i -lt $depClose; $i++) {
    if ($lines[$i].Trim().StartsWith('"' + $pluginName + '":')) { $depPresent = $true; break }
}
if ($depPresent) {
    Note '依赖已经登记过，跳过。'
} else {
    $pad = ' ' * ((Get-Indent $lines[$depOpen]) + 2)
    $insertAt = $depClose
    for ($i = $depOpen + 1; $i -lt $depClose; $i++) {
        $key = $lines[$i].Trim()
        if ($key.StartsWith('"') -and ($key -gt ('"' + $pluginName + '"'))) { $insertAt = $i; break }
    }
    $isLast = ($insertAt -ge $depClose)
    $depLine = $pad + '"' + $pluginName + '": "' + $pluginSpecJson + '"'
    if (-not $isLast) { $depLine = $depLine + ',' }
    # 排在我们前面那一行必须用逗号收尾，否则 JSON 不合法；只有空块的开头例外。
    $before = $lines[$insertAt - 1].TrimEnd()
    if (-not $before.EndsWith('{') -and -not $before.EndsWith(',') -and -not $before.EndsWith('[')) {
        $lines[$insertAt - 1] = $before + ','
    }
    $lines.Insert($insertAt, $depLine)
    $manifestChanged = $true
    Good ('依赖已登记：' + $pluginName)
}

$bundleOpen = Find-Member $lines '"bundles": ['
if ($bundleOpen -lt 0) {
    Stop-With '这个 profile 的 package.json 里没有 dsh.profile.bundles 列表。请按 INSTALL.zh-CN.md 里的方式 B 手动登记。'
}
$bundleClose = Find-End $lines $bundleOpen ']'
if ($bundleClose -lt 0) {
    Stop-With '这个 profile 的 package.json 格式和预期不同（bundles 列表没有闭合）。请按 INSTALL.zh-CN.md 里的方式 B 手动登记。'
}

$bundlePresent = $false
for ($i = $bundleOpen + 1; $i -lt $bundleClose; $i++) {
    if ($lines[$i].Trim() -eq ('"' + $pluginName + '"')) { $bundlePresent = $true; break }
}
if ($bundlePresent) {
    Note 'bundles 列表里已经有它，跳过。'
} else {
    $pad = ' ' * ((Get-Indent $lines[$bundleOpen]) + 2)
    $before = $lines[$bundleClose - 1].TrimEnd()
    if (-not $before.EndsWith('[') -and -not $before.EndsWith(',')) {
        $lines[$bundleClose - 1] = $before + ','
    }
    $lines.Insert($bundleClose, $pad + '"' + $pluginName + '"')
    $manifestChanged = $true
    Good '已加入 dsh.profile.bundles'
}

if ($manifestChanged) {
    $updated = $lines -join $nl
    $parsed = $null
    try { $parsed = ConvertFrom-Json -InputObject $updated } catch {
        Stop-With ('改完之后这份 package.json 不是合法的 JSON，脚本没有写入任何东西。请按 INSTALL.zh-CN.md 里的方式 B 手动登记。（' + $_.Exception.Message + '）')
    }
    if ($null -eq $parsed.dependencies.'dsh-ag') {
        Stop-With '登记之后没有读到依赖，脚本没有写入任何东西。请按 INSTALL.zh-CN.md 里的方式 B 手动登记。'
    }
    if (-not ($parsed.dsh.profile.bundles -contains $pluginName)) {
        Stop-With '登记之后 bundles 列表里没有它，脚本没有写入任何东西。请按 INSTALL.zh-CN.md 里的方式 B 手动登记。'
    }
    Backup-File -Path $manifestPath
    Set-Text -Path $manifestPath -Text $updated
    Good 'package.json 已更新'
} else {
    Note 'package.json 不需要改动。'
}

# ------------------------------------------------------------ 5. 同步锁文件
$lockPath = Join-Path $profileDir 'pnpm-lock.yaml'
if ($SkipLockFile) {
    Step '跳过 pnpm-lock.yaml（你要求不动它）'
} elseif (-not (Test-Path -LiteralPath $lockPath)) {
    Step '没有 pnpm-lock.yaml，跳过'
    Note '这个 profile 不用 pnpm 锁文件，插件已经装好了。'
} else {
    Step '同步 pnpm-lock.yaml'
    $lockText = Get-Text $lockPath
    $sep = [string][char]13 + '?' + [string][char]10
    $anyChar = '[^' + [string][char]10 + ']'

    if (-not $lockText.Contains("lockfileVersion: '9.0'")) {
        Note '这份锁文件的版式不是 9.0，脚本不修改它。插件已经装好，不影响使用。'
    } elseif (-not [regex]::IsMatch($lockText, '(?m)^snapshots:')) {
        Note '这份锁文件没有 snapshots 段，脚本不修改它。插件已经装好，不影响使用。'
    } else {
        $sha = [System.Security.Cryptography.SHA512]::Create()
        try { $hash = $sha.ComputeHash([System.IO.File]::ReadAllBytes($tarballTarget)) } finally { $sha.Dispose() }
        $integrity = 'sha512-' + [System.Convert]::ToBase64String($hash)

        $undici = ""
        $found = [regex]::Match($lockText, '(?m)^  undici@([^ :]+):')
        if ($found.Success) { $undici = $found.Groups[1].Value }

        $oldPackageEntry = '(?m)^  ' + [regex]::Escape($pluginKey) + ':' + $sep + '(?:      ' + $anyChar + '*' + $sep + '|    ' + $anyChar + '*' + $sep + ')+' + $sep + '?'
        $oldImporterEntry = '(?m)^      ' + [regex]::Escape($pluginName) + ':' + $sep + '        specifier: ' + $anyChar + '*' + $sep + '        version: ' + $anyChar + '*' + $sep

        $before = $lockText
        $lockText = [regex]::Replace($lockText, $oldPackageEntry, "")
        $lockText = [regex]::Replace($lockText, $oldImporterEntry, "")
        if ($lockText -ne $before) { Note "已清掉旧的插件记录，重新写入。" }

        $depEntry = '      ' + $pluginName + ':' + $nl + '        specifier: ' + $pluginSpec + $nl + '        version: ' + $pluginVersion

        $packageEntry = '  ' + $pluginKey + ':' + $nl + '    resolution: {integrity: ' + $integrity + ', tarball: ' + $pluginVersion + '}' + $nl + '    version: 1.0.0'

        if ($undici -eq "") {
            $snapshotEntry = '  ' + $pluginKey + ': {}'
        } else {
            $snapshotEntry = '  ' + $pluginKey + ':' + $nl + '    dependencies:' + $nl + '      undici: ' + $undici
        }

        $depAnchor       = [regex]::Match($lockText, '(?m)^    dependencies:' + $sep)
        $packagesAnchor  = [regex]::Match($lockText, '(?m)^packages:' + $sep + $sep)
        $snapshotsAnchor = [regex]::Match($lockText, '(?m)^snapshots:' + $sep + $sep)

        if (-not $depAnchor.Success -or -not $packagesAnchor.Success -or -not $snapshotsAnchor.Success -or $depAnchor.Index -gt $packagesAnchor.Index) {
            Note '这份锁文件的结构和预期不同，脚本不修改它。插件已经装好，不影响使用。'
        } else {
            $at = $depAnchor.Index + $depAnchor.Length
            $lockText = $lockText.Substring(0, $at) + $depEntry + $nl + $lockText.Substring($at)

            $packagesAnchor  = [regex]::Match($lockText, '(?m)^packages:' + $sep + $sep)
            $snapshotsAnchor = [regex]::Match($lockText, '(?m)^snapshots:' + $sep + $sep)
            $at = $packagesAnchor.Index + $packagesAnchor.Length
            $lockText = $lockText.Substring(0, $at) + $packageEntry + $nl + $nl + $lockText.Substring($at)

            $snapshotsAnchor = [regex]::Match($lockText, '(?m)^snapshots:' + $sep + $sep)
            $at = $snapshotsAnchor.Index + $snapshotsAnchor.Length
            $lockText = $lockText.Substring(0, $at) + $snapshotEntry + $nl + $nl + $lockText.Substring($at)

            Backup-File -Path $lockPath
            Set-Text -Path $lockPath -Text $lockText
            if ($undici -eq "") { $undiciNote = "无" } else { $undiciNote = $undici }
            Good ('已写入锁文件记录（undici：' + $undiciNote + '）')
        }
    }
}

# -------------------------------------------------------------------- 完成
Write-Host ""
Write-Host '完成。' -ForegroundColor Green
Write-Host ""
Write-Host '接下来（只需要做一次）：'
Write-Host '  1. 重启 DSH Desktop。'
Write-Host '  2. 打开「设置 → 模型」，找到 ag中转站，点「密钥」，粘贴你自己的 API 密钥并保存。'
Write-Host '  3. 在模型选择器里选 glm-5.3 或 deepseek-v4-flash，直接对话。'
Write-Host ""
Write-Host '没有开关命令：插件在，就能用；在插件面板里关掉它，它写进去的路由和代理会一起撤掉，'
Write-Host '模型也随之从选择器里消失。想随时查看状态，可以在会话里输入 /ag。'
Write-Host ""
