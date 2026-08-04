param(
  [string]$OutputPath = (Join-Path $PSScriptRoot "..\docs\media\social-preview.png")
)

Add-Type -AssemblyName System.Drawing

$width = 1280
$height = 640
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logoPath = Join-Path $root "apps\quake-desktop\resources\quake-code-q.png"
$screenPath = Join-Path $root "docs\media\desktop-files-en.png"

function New-RoundedPath {
  param([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.Rectangle]::new(0, 0, $width, $height),
  [System.Drawing.Color]::FromArgb(255, 7, 9, 13),
  [System.Drawing.Color]::FromArgb(255, 18, 22, 31),
  18
)
$graphics.FillRectangle($background, 0, 0, $width, $height)

$glow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(22, 255, 255, 255))
$graphics.FillEllipse($glow, -120, -300, 680, 680)
$graphics.FillEllipse($glow, 990, 400, 420, 420)

$orbitPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(34, 255, 255, 255), 2)
$graphics.DrawEllipse($orbitPen, -80, 420, 760, 280)
$graphics.DrawEllipse($orbitPen, 950, -140, 470, 290)

$logo = [System.Drawing.Image]::FromFile($logoPath)
$graphics.DrawImage($logo, [System.Drawing.Rectangle]::new(80, 66, 142, 142))

$titleFont = [System.Drawing.Font]::new("Segoe UI", 50, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$subtitleFont = [System.Drawing.Font]::new("Segoe UI", 27, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$metaFont = [System.Drawing.Font]::new("Segoe UI", 15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 248, 249, 251))
$muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 178, 185, 199))
$accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 214, 219, 230))

$graphics.DrawString("QUAKE CODE", $titleFont, $white, 78, 232)
$graphics.DrawString("DESKTOP", $titleFont, $accent, 78, 286)

$subtitleRect = [System.Drawing.RectangleF]::new(82, 365, 480, 82)
$graphics.DrawString("A local-first command center`nfor coding agents.", $subtitleFont, $muted, $subtitleRect)

$pillPath = New-RoundedPath -X 80 -Y 492 -Width 440 -Height 42 -Radius 21
$pillBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(30, 255, 255, 255))
$pillPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(55, 255, 255, 255), 1)
$graphics.FillPath($pillBrush, $pillPath)
$graphics.DrawPath($pillPen, $pillPath)
$graphics.DrawString("LOCAL-FIRST   |   WINDOWS   |   OPEN SOURCE", $metaFont, $white, 102, 502)

$framePath = New-RoundedPath -X 600 -Y 96 -Width 610 -Height 448 -Radius 22
$frameBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 29, 33, 42))
$framePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(80, 255, 255, 255), 1)
$graphics.FillPath($frameBrush, $framePath)
$graphics.DrawPath($framePen, $framePath)

$screen = [System.Drawing.Image]::FromFile($screenPath)
$screenRect = [System.Drawing.Rectangle]::new(616, 112, 578, 416)
$graphics.DrawImage($screen, $screenRect)

$logo.Dispose()
$screen.Dispose()
$background.Dispose()
$glow.Dispose()
$orbitPen.Dispose()
$titleFont.Dispose()
$subtitleFont.Dispose()
$metaFont.Dispose()
$white.Dispose()
$muted.Dispose()
$accent.Dispose()
$pillBrush.Dispose()
$pillPen.Dispose()
$pillPath.Dispose()
$frameBrush.Dispose()
$framePen.Dispose()
$framePath.Dispose()
$graphics.Dispose()

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
  New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

Write-Output "Generated $OutputPath (${width}x${height})"
