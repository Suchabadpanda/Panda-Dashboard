# Manual alternative to the add-on: copy the dashboard into Home Assistant's www folder from Windows.
# Option A (default): the Samba share add-on  →  \\homeassistant.local\config
# Option B: -Ssh  uses scp via the SSH add-on (OpenSSH client ships with Windows 10/11).
param(
  [string]$Share = '\\homeassistant.local\config',
  [switch]$Ssh,
  [string]$SshHost = 'root@homeassistant.local'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$app = Join-Path $root 'panda_dashboard\www'
$items = @("$app\index.html", "$app\css", "$app\js")
if ((Test-Path "$root\data\energy_monthly.csv") -or (Test-Path "$root\data\config.js")) { $items += "$root\data" }

if ($Ssh) {
  ssh $SshHost 'mkdir -p /config/www/panda-dashboard'
  foreach ($i in $items) { scp -r "$i" "${SshHost}:/config/www/panda-dashboard/" }
} else {
  $dest = Join-Path $Share 'www\panda-dashboard'
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  foreach ($i in $items) { Copy-Item -Recurse -Force "$i" $dest }
}
Write-Host 'Open http://homeassistant.local:8123/local/panda-dashboard/index.html'
