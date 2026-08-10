$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "TAXOTE - Configuración de Google Maps" -ForegroundColor Cyan
Write-Host "Necesitas una clave con Places API (New) y Geocoding API habilitadas." -ForegroundColor White
Write-Host "La clave se guardará solamente en D:\Taxote\.env y no dentro del código." -ForegroundColor DarkGray
Write-Host ""

$secureKey = Read-Host "Pega tu clave de Google Maps" -AsSecureString
$credential = [System.Management.Automation.PSCredential]::new("taxote", $secureKey)
$plainKey = $credential.GetNetworkCredential().Password.Trim()

if ($plainKey -notmatch '^AIza[0-9A-Za-z_-]{20,}$') {
  Write-Host "La clave no tiene el formato esperado de Google Maps. No se guardó nada." -ForegroundColor Red
  exit 1
}

$envPath = Join-Path $PSScriptRoot ".env"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($envPath, "GOOGLE_MAPS_API_KEY=$plainKey`r`n", $utf8NoBom)
$plainKey = $null

Write-Host "Google Maps quedó configurado." -ForegroundColor Green
Write-Host "Cierra TAXOTE si está abierto y vuelve a ejecutar INICIAR-TAXOTE.bat." -ForegroundColor Yellow

