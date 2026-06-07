# AutoOps AI - Startup Script (no Docker, no admin required)
$node = "C:\Users\adithya.s\node-portable\node-v22.15.0-win-x64"
$tsx  = "$PSScriptRoot\node_modules\tsx\dist\cli.mjs"
$main = "$PSScriptRoot\src\index.ts"

if (!(Test-Path "$node\node.exe")) {
    Write-Host "Node.js not found at $node" -ForegroundColor Red
    Write-Host "Re-download: Invoke-WebRequest -Uri https://nodejs.org/dist/v22.15.0/node-v22.15.0-win-x64.zip -OutFile node.zip; Expand-Archive node.zip C:\Users\adithya.s\node-portable"
    exit 1
}

$env:PATH = "$node;" + $env:PATH
# Trust corporate CA certificates (fixes SSL inspection proxy in lab)
$env:NODE_EXTRA_CA_CERTS = "$PSScriptRoot\corporate-ca.pem"
Set-Location $PSScriptRoot

Write-Host "Starting AutoOps AI on http://localhost:3000 ..." -ForegroundColor Cyan
& "$node\node.exe" $tsx $main
