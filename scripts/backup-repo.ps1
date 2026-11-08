[CmdletBinding()]
param(
    [string]$Destination = $(if ($env:BIZMINDMAKERS_BACKUP_DIR) { $env:BIZMINDMAKERS_BACKUP_DIR } else { (Join-Path (Get-Location) '..\my-chat-app-backups') }),
    [string]$RepositoryUrl = $(if ($env:BIZMINDMAKERS_REPO_URL) { $env:BIZMINDMAKERS_REPO_URL } else { 'https://github.com/drmuhammednajeeb/my-chat-app.git' })
)

$ErrorActionPreference = 'Stop'

function Invoke-Git {
    param([string[]]$GitArgs)
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed (exit $LASTEXITCODE): git $($GitArgs -join ' ')"
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git is required. Install Git for Windows and retry.'
}

$null = New-Item -ItemType Directory -Force -Path $Destination
$Destination = (Resolve-Path $Destination).Path
$MirrorDir = Join-Path $Destination 'my-chat-app.git'
$Timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$BundleFile = Join-Path $Destination "my-chat-app-$Timestamp.bundle"
$SourceArchive = Join-Path $Destination "my-chat-app-source-$Timestamp.zip"
$Manifest = Join-Path $Destination 'backup-manifest.txt'

if (Test-Path $MirrorDir) {
    Invoke-Git @('--git-dir', $MirrorDir, 'rev-parse', '--is-bare-repository') | Out-Null
    Invoke-Git @('--git-dir', $MirrorDir, 'remote', 'set-url', 'origin', $RepositoryUrl)
    Invoke-Git @('--git-dir', $MirrorDir, 'remote', 'update', '--prune')
} else {
    Invoke-Git @('clone', '--mirror', $RepositoryUrl, $MirrorDir)
}

$DefaultBranch = (& git --git-dir=$MirrorDir symbolic-ref --short HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($DefaultBranch)) {
    throw "Could not determine the mirror's default branch."
}
Invoke-Git @('--git-dir', $MirrorDir, 'show-ref', '--verify', '--quiet', "refs/heads/$DefaultBranch")
Invoke-Git @('--git-dir', $MirrorDir, 'bundle', 'create', $BundleFile, '--all')
Invoke-Git @('bundle', 'verify', $BundleFile)
Invoke-Git @('--git-dir', $MirrorDir, 'archive', '--format=zip', "--prefix=my-chat-app-source/", "--output=$SourceArchive", "refs/heads/$DefaultBranch")

@(
    'Project: BizmindMakers Chat Pro'
    "Repository: $RepositoryUrl"
    "Backup UTC: $Timestamp"
    "Default branch: $DefaultBranch"
    'Mirror directory: my-chat-app.git'
    "Git bundle: $(Split-Path -Leaf $BundleFile)"
    "Source archive: $(Split-Path -Leaf $SourceArchive)"
    'Bundle verification: PASS'
) | Set-Content -Path $Manifest -Encoding UTF8

Write-Host ''
Write-Host 'Backup completed successfully.' -ForegroundColor Green
Write-Host "Mirror: $MirrorDir"
Write-Host "Bundle: $BundleFile"
Write-Host "Source archive: $SourceArchive"
Write-Host "Manifest: $Manifest"
Write-Host ''
Write-Warning 'Copy the bundle, archive, and manifest to a second independent location.'
