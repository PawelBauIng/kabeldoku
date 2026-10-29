# Kleiner lokaler Webserver fuer die Kabel-Fotodoku. Nur auf diesem Rechner erreichbar (localhost).
$ErrorActionPreference = 'Stop'
$root = (Split-Path -Parent $MyInvocation.MyCommand.Path).TrimEnd('\') + '\'
$port = 8484
$url = "http://localhost:$port/"
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add($url)
try { $l.Start() } catch { Start-Process $url; exit }
Write-Host ""
Write-Host "  Kabel-Fotodoku laeuft auf $url"
Write-Host "  Dieses Fenster offen lassen. Zum Beenden einfach schliessen."
Write-Host ""
Start-Process $url
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.json'='application/json'; '.webmanifest'='application/manifest+json'; '.png'='image/png'; '.jpg'='image/jpeg';
  '.pdf'='application/pdf'; '.zip'='application/zip'; '.txt'='text/plain; charset=utf-8' }
while ($l.IsListening) {
  $c = $l.GetContext()
  try {
    $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath).TrimStart('/')
    if ($p -eq '') { $p = 'index.html' }
    $f = [IO.Path]::GetFullPath((Join-Path $root $p))
    if (-not $f.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $f -PathType Leaf)) {
      $c.Response.StatusCode = 404; $c.Response.Close(); continue }
    $ct = $mime[[IO.Path]::GetExtension($f).ToLower()]; if (-not $ct) { $ct = 'application/octet-stream' }
    $b = [IO.File]::ReadAllBytes($f)
    $c.Response.ContentType = $ct
    $c.Response.Headers.Add('Cache-Control', 'no-cache')
    $c.Response.ContentLength64 = $b.Length
    $c.Response.OutputStream.Write($b, 0, $b.Length)
    $c.Response.Close()
  } catch { try { $c.Response.StatusCode = 500; $c.Response.Close() } catch {} }
}
