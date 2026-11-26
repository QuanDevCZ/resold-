# Builds the app icons from the logo (icons/logo-source.jpg) with no installs:
#   powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
# Takes a square around the "OŌS" letters from inside the black area of the source (so the grey
# frame and rounded corners are left out), puts it on a full-bleed black square, crushes JPEG
# noise to pure black, and saves 512 / 192 / 180 px PNGs. Phones round the corners themselves.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$src = [System.Drawing.Image]::FromFile((Join-Path $root "icons\logo-source.jpg"))
# letters sit around (600, 626) in the 1206x1249 source; a 1000px square there stays inside the black
$side = 1000; $cx = 603; $cy = 626
$rect = New-Object System.Drawing.Rectangle ([int]($cx - $side / 2)), ([int]($cy - $side / 2)), $side, $side
$m = New-Object System.Drawing.Imaging.ColorMatrix
$m.Matrix00 = 1.15; $m.Matrix11 = 1.15; $m.Matrix22 = 1.15
$m.Matrix40 = -0.08; $m.Matrix41 = -0.08; $m.Matrix42 = -0.08
$attr = New-Object System.Drawing.Imaging.ImageAttributes
$attr.SetColorMatrix($m)
foreach ($o in @(@{n = "icon-512.png"; s = 512 }, @{n = "icon-192.png"; s = 192 }, @{n = "apple-touch-icon.png"; s = 180 })) {
  $bmp = New-Object System.Drawing.Bitmap $o.s, $o.s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Black)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $dst = New-Object System.Drawing.Rectangle 0, 0, $o.s, $o.s
  $g.DrawImage($src, $dst, $rect.X, $rect.Y, $rect.Width, $rect.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
  $g.Dispose()
  $bmp.Save((Join-Path $root ("icons\" + $o.n)), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "wrote icons\" + $o.n
}
$src.Dispose()

# Small round mark for the top bar and the recap ticket: the "Ō" from icons/mark-source.jpg (1024x1024,
# symbol centred around 515,512), cropped to a square with some air around it, 256 px.
$ms = [System.Drawing.Image]::FromFile((Join-Path $root "icons\mark-source.jpg"))
$mside = 780; $mr = New-Object System.Drawing.Rectangle ([int](515 - $mside / 2)), ([int](512 - $mside / 2)), $mside, $mside
$mb = New-Object System.Drawing.Bitmap 256, 256
$mg = [System.Drawing.Graphics]::FromImage($mb)
$mg.Clear([System.Drawing.Color]::Black)
$mg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$mg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$mg.DrawImage($ms, (New-Object System.Drawing.Rectangle 0, 0, 256, 256), $mr.X, $mr.Y, $mr.Width, $mr.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
$mg.Dispose(); $mb.Save((Join-Path $root "icons\mark.png"), [System.Drawing.Imaging.ImageFormat]::Png); $mb.Dispose(); $ms.Dispose()
"wrote icons\mark.png"
