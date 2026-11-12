param([string]$RepositoryPath)
$ErrorActionPreference = 'Stop'
if (-not $RepositoryPath) { $RepositoryPath = Read-Host 'Enter the full path to your local dashboard Git repository' }
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath '.git'))) { throw "No Git repository found at $RepositoryPath. Clone it with GitHub Desktop first." }
$branch = (& git -C $RepositoryPath branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'AI-product-detection-cam') { throw "Select AI-product-detection-cam in GitHub Desktop first. Current branch: $branch" }
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'FILE-MAP.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest) {
    $src = Join-Path $PSScriptRoot $entry.source
    $dst = Join-Path $RepositoryPath ($entry.destination.Replace('/', [IO.Path]::DirectorySeparatorChar))
    if (-not (Test-Path -LiteralPath $src)) { throw "Package file missing: $src" }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
}
foreach ($required in @('api/ai-models.js','api/ultralytics/sync.js','lib/ultralytics-sync.js','lib/vercel-direct.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath $required))) { throw "Installation failed: $required" }
}
Write-Host "Installed $($manifest.Count) files into $RepositoryPath on $branch" -ForegroundColor Green
Write-Host 'Return to GitHub Desktop, review changes, Commit, and Push origin.'
