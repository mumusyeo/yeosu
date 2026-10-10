param([int]$Port = 8765, [switch]$Live, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$previewArguments = @((Join-Path $PSScriptRoot 'scripts\preview-server.py'), '--port', $Port)
if ($Live) { $previewArguments += '--live' }
if ($NoBrowser) { $previewArguments += '--no-browser' }
& python @previewArguments
if ($LASTEXITCODE -ne 0) { throw 'Preview server stopped with an error. See the message above.' }
