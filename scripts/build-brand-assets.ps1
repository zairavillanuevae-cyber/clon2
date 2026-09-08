param(
  [string]$SourceMark = "scripts\nova-edu-mark-source.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repoRoot $SourceMark
$sourceMarkImage = [System.Drawing.Image]::FromFile($sourcePath)

function New-Canvas([int]$Width, [int]$Height) {
  $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bitmap.SetResolution(96, 96)
  return $bitmap
}

function New-Graphics([System.Drawing.Bitmap]$Bitmap) {
  $graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return $graphics
}

function New-RedMark([System.Drawing.Image]$Image) {
  $bitmap = New-Canvas $Image.Width $Image.Height
  $graphics = New-Graphics $bitmap
  $attributes = New-Object System.Drawing.Imaging.ImageAttributes
  $matrix = New-Object System.Drawing.Imaging.ColorMatrix

  $matrix.Matrix00 = 0.21
  $matrix.Matrix01 = 0.015
  $matrix.Matrix02 = 0.018
  $matrix.Matrix10 = 0.413
  $matrix.Matrix11 = 0.0295
  $matrix.Matrix12 = 0.0354
  $matrix.Matrix20 = 0.077
  $matrix.Matrix21 = 0.0055
  $matrix.Matrix22 = 0.0066
  $matrix.Matrix30 = 0.30
  $matrix.Matrix31 = 0.012
  $matrix.Matrix32 = 0.018
  $matrix.Matrix33 = 1.0
  $matrix.Matrix44 = 1.0

  try {
    $attributes.SetColorMatrix($matrix)
    $destination = New-Object System.Drawing.Rectangle(0, 0, $Image.Width, $Image.Height)
    $graphics.DrawImage(
      $Image,
      $destination,
      0,
      0,
      $Image.Width,
      $Image.Height,
      [System.Drawing.GraphicsUnit]::Pixel,
      $attributes
    )
  } finally {
    $attributes.Dispose()
    $graphics.Dispose()
  }

  return $bitmap
}

function Draw-Mark(
  [System.Drawing.Graphics]$Graphics,
  [System.Drawing.Image]$Image,
  [int]$X,
  [int]$Y,
  [int]$Width,
  [int]$Height
) {
  $scale = [Math]::Min($Width / $Image.Width, $Height / $Image.Height)
  $drawWidth = [int][Math]::Round($Image.Width * $scale)
  $drawHeight = [int][Math]::Round($Image.Height * $scale)
  $drawX = $X + [int](($Width - $drawWidth) / 2)
  $drawY = $Y + [int](($Height - $drawHeight) / 2)
  $Graphics.DrawImage($Image, $drawX, $drawY, $drawWidth, $drawHeight)
}

function Save-Png([System.Drawing.Bitmap]$Bitmap, [string]$RelativePath) {
  $path = Join-Path $repoRoot $RelativePath
  $Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function New-HorizontalLogo([int]$Width, [int]$Height, [string]$RelativePath, [string]$Format) {
  $bitmap = New-Canvas $Width $Height
  $graphics = New-Graphics $bitmap

  try {
    Draw-Mark $graphics $mark 5 5 82 82

    $path = Join-Path $repoRoot $RelativePath
    if ($Format -eq "gif") {
      $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Gif)
    } else {
      $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function New-MarkPng([int]$Width, [int]$Height, [string]$RelativePath) {
  $bitmap = New-Canvas $Width $Height
  $graphics = New-Graphics $bitmap
  try {
    $padding = [int]([Math]::Min($Width, $Height) * 0.06)
    Draw-Mark $graphics $mark $padding $padding ($Width - (2 * $padding)) ($Height - (2 * $padding))
    Save-Png $bitmap $RelativePath
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function New-Favicon([string]$RelativePath) {
  $bitmap = New-Canvas 32 32
  $graphics = New-Graphics $bitmap
  try {
    Draw-Mark $graphics $mark 2 2 28 28
    $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
    $stream = [System.IO.File]::Create((Join-Path $repoRoot $RelativePath))
    try {
      $icon.Save($stream)
    } finally {
      $stream.Dispose()
      $icon.Dispose()
    }
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$mark = New-RedMark $sourceMarkImage
$sourceMarkImage.Dispose()

try {
  New-MarkPng 1024 1024 "public\brand\nova-edu-mark.png"
  New-HorizontalLogo 435 92 "public\SiteAssets\images\logo.png" "png"
  New-HorizontalLogo 438 92 "public\SiteAssets\images\logo-en.png" "png"
  New-HorizontalLogo 518 92 "public\SiteAssets\images\logo.gif" "gif"
  New-MarkPng 1024 1024 "public\internet-banking\nova-edu-mark.png"
  New-Favicon "public\favicon.ico"
  New-Favicon "public\SiteAssets\images\favicon.ico"
} finally {
  $mark.Dispose()
}
