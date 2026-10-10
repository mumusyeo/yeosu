param(
    [string]$Message = 'Update Yeosu travel invitation',
    [switch]$CheckOnly,
    [switch]$NoWait
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repository = 'mumusyeo/yeosu'
$siteUrl = 'https://mumusyeo.github.io/yeosu/'
$originalPath = $env:PATH
Push-Location $PSScriptRoot

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Deployment stopped." }
}

function Find-Node {
    $candidate = Get-Command node -ErrorAction SilentlyContinue
    $paths = @()
    if ($candidate) { $paths += $candidate.Source }
    $paths += (Join-Path $PSScriptRoot '..\.tools\node-v22.20.0-win-x64\node.exe')
    $paths += (Join-Path $PSScriptRoot '.local\node-v22.20.0-win-x64\node.exe')
    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path) {
            $version = & $path --version
            if ($LASTEXITCODE -eq 0 -and [int]($version.TrimStart('v').Split('.')[0]) -ge 22) { return (Resolve-Path -LiteralPath $path).Path }
        }
    }
    Write-Host 'Downloading project-local Node.js 22 (no system installation)...'
    $runtimeDirectory = Join-Path $PSScriptRoot '.local'
    New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
    $archiveName = 'node-v22.20.0-win-x64.zip'
    $archive = Join-Path $runtimeDirectory $archiveName
    $distribution = 'https://nodejs.org/dist/v22.20.0'
    Invoke-WebRequest -UseBasicParsing -Uri "$distribution/$archiveName" -OutFile $archive
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri "$distribution/SHASUMS256.txt").Content
    $checksumLine = ($checksums -split "`n" | Where-Object { $_.Trim().EndsWith("  $archiveName") } | Select-Object -First 1)
    if (-not $checksumLine) { throw 'Node archive checksum is missing.' }
    $expectedHash = ($checksumLine.Trim() -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Node archive checksum mismatch.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $runtimeDirectory -Force
    return (Join-Path $runtimeDirectory 'node-v22.20.0-win-x64\node.exe')
}

function Get-GitHubToken {
    if ($env:GH_TOKEN) { return $env:GH_TOKEN }
    if ($env:GITHUB_TOKEN) { return $env:GITHUB_TOKEN }
    # Capture credentials only in memory. Never echo them, put them in arguments or write them to disk.
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = (Get-Command git -ErrorAction Stop).Source
    $processInfo.Arguments = 'credential fill'
    $processInfo.WorkingDirectory = $PSScriptRoot
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardInput = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $processInfo
    $process.Start() | Out-Null
    $process.StandardInput.Write("protocol=https`nhost=github.com`npath=$repository.git`n`n")
    $process.StandardInput.Close()
    $credential = $process.StandardOutput.ReadToEnd()
    $null = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $credentialExit = $process.ExitCode
    $process.Dispose()
    if ($credentialExit -ne 0 -or $credential -notmatch '(?m)^password=(.+)') {
        throw 'GitHub login is required. Sign in using Git Credential Manager, or set GH_TOKEN with repository and Pages permissions, then run this command again.'
    }
    return $Matches[1].Trim()
}

function Invoke-GitHub {
    param([string]$Path, [string]$Method = 'GET', [object]$Body = $null)
    $parameters = @{Uri="https://api.github.com/repos/$repository$Path"; Method=$Method; Headers=$githubHeaders; TimeoutSec=30}
    if ($null -ne $Body) { $parameters.Body = ($Body | ConvertTo-Json -Depth 6 -Compress); $parameters.ContentType = 'application/json' }
    Invoke-RestMethod @parameters
}

function Push-WithToken {
    # Child-process environment supports env-token users without exposing a token in git command arguments.
    $names = @('GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0')
    $saved = @{}
    foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    if ($saved['GIT_CONFIG_COUNT']) { throw 'A custom GIT_CONFIG_COUNT is already set. Unset it before deployment.' }
    try {
        $env:GIT_CONFIG_COUNT = '1'
        $env:GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader'
        $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("x-access-token:$githubToken"))
        $env:GIT_CONFIG_VALUE_0 = "Authorization: Basic $basic"
        Invoke-Checked 'git' @('push','--set-upstream','origin','main')
    } finally {
        foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    }
}

try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Install Git for Windows before deploying.' }
    $nodePath = Find-Node
    $env:PATH = "$(Split-Path -Parent $nodePath);$originalPath"
    $npmPath = Join-Path (Split-Path -Parent $nodePath) 'npm.cmd'
    Write-Host 'Building and checking the invitation...'
    Invoke-Checked $npmPath @('ci','--ignore-scripts','--no-audit','--no-fund')
    foreach ($script in @('build','check','test','test:db')) { Invoke-Checked $npmPath @('run',$script) }
    if ($CheckOnly) { Write-Host 'All local checks passed. No commit, push or deployment performed.'; return }

    $origin = & git remote get-url origin
    if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^https://github\.com/mumusyeo/yeosu(?:\.git)?/?$') {
        throw 'This folder must be a clone of https://github.com/mumusyeo/yeosu.git with an HTTPS origin.'
    }
    $branch = & git branch --show-current
    if ($branch -ne 'main') { throw 'Switch to the main branch before deploying.' }
    $githubToken = Get-GitHubToken
    $githubHeaders = @{Authorization="Bearer $githubToken"; Accept='application/vnd.github+json'; 'User-Agent'='yeosu-deploy'; 'X-GitHub-Api-Version'='2026-03-10'}
    Invoke-Checked 'git' @('fetch','origin','main')
    & git merge-base --is-ancestor origin/main HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Remote main contains new changes. Commit or stash your changes, run git pull --rebase, then deploy again.' }
    try { $pages = Invoke-GitHub '/pages' } catch {
        if ([int]$_.Exception.Response.StatusCode -ne 404) { throw }
        $pages = Invoke-GitHub '/pages' 'POST' @{build_type='workflow'; source=@{branch='main';path='/docs'}}
        Write-Host 'GitHub Pages enabled.'
    }
    if ($pages.build_type -ne 'workflow') { $null = Invoke-GitHub '/pages' 'PUT' @{build_type='workflow'} }

    Invoke-Checked 'git' @('add','--all','--','.')
    $changes = & git status --porcelain
    $startedAt = [DateTime]::UtcNow.AddSeconds(-10)
    if ($changes) { Invoke-Checked 'git' @('commit','-m',$Message) }
    Push-WithToken
    $sha = (& git rev-parse HEAD).Trim()
    if (-not $changes) { $null = Invoke-GitHub '/actions/workflows/pages.yml/dispatches' 'POST' @{ref='main'} }
    Write-Host "Uploaded $sha. GitHub Actions is deploying $siteUrl"
    if ($NoWait) { Write-Host "Track deployment: https://github.com/$repository/actions"; return }

    $deadline = [DateTime]::UtcNow.AddMinutes(15)
    $previousStatus = ''
    $run = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $runs = Invoke-GitHub "/actions/workflows/pages.yml/runs?head_sha=$sha&per_page=10"
            $run = $runs.workflow_runs | Where-Object { ([DateTimeOffset]$_.created_at).UtcDateTime -ge $startedAt } | Sort-Object id -Descending | Select-Object -First 1
        } catch {
            if ([int]$_.Exception.Response.StatusCode -ne 404) { throw }
        }
        if ($run) {
            $status = "$($run.status) $($run.conclusion)".Trim()
            if ($status -ne $previousStatus) { Write-Host "Deployment: $status ($($run.html_url))"; $previousStatus = $status }
            if ($run.status -eq 'completed') {
                if ($run.conclusion -ne 'success') { throw "Deployment failed: $($run.html_url)" }
                break
            }
        }
        Start-Sleep -Seconds 10
    }
    if (-not $run -or $run.conclusion -ne 'success') { throw "Deployment is still pending. See https://github.com/$repository/actions" }
    $siteReady = $false
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        try {
            foreach ($asset in @('','styles.css','app.js','demo.html')) {
                $response = Invoke-WebRequest -UseBasicParsing -Uri "$siteUrl$asset" -TimeoutSec 20
                if ($response.StatusCode -ne 200) { throw 'Published asset is not ready.' }
            }
            $siteReady = $true; break
        } catch { if ($attempt -lt 11) { Start-Sleep -Seconds 10 } }
    }
    if (-not $siteReady) { throw 'Actions succeeded, but the public URL is not responding yet. Check the Actions link above.' }
    Write-Host "DEPLOYED: $siteUrl"
    Write-Host "DEMO: ${siteUrl}demo.html"
    Write-Host 'For shared votes and expenses, complete the one-time Supabase steps in SETUP.md.'
} finally {
    $env:PATH = $originalPath
    $githubToken = $null
    $githubHeaders = $null
    Pop-Location
}
