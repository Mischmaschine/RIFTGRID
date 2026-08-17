$ErrorActionPreference = 'Stop'
if (-not (Get-Command k3d -ErrorAction SilentlyContinue)) { throw 'k3d is required. Install it from https://k3d.io/' }
k3d cluster create --config "$PSScriptRoot/k3d.yaml"
Write-Host 'RIFTGRID development cluster is ready.'
