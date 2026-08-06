<#
.SYNOPSIS
    Türkiye gündemini RSS kaynaklarından toplar, rapor dosyasına yazar ve bildirim gösterir.
.DESCRIPTION
    Her gün akşam 20:00'de çalışmak üzere Windows Task Scheduler'a kaydedilir.
    Rapor: %USERPROFILE%\Desktop\GündemRaporu\YYYY-MM-DD-gundem.md
#>

param(
    [switch]$NoNotify
)

# ─── Yapılandırma ────────────────────────────────────────────────
$ReportDir   = "$env:USERPROFILE\Desktop\GündemRaporu"
$DateStr     = Get-Date -Format "yyyy-MM-dd"
$ReportFile  = "$ReportDir\$DateStr-gundem.md"
$MaxItems    = 5  # kaynak başına alınacak haber sayısı

# RSS kaynakları (Türkiye gündem haber siteleri)
$Sources = @(
    @{ Name = "NTV Gündem";    Url = "https://www.ntv.com.tr/gundem.rss" }
    @{ Name = "CNN Türk";      Url = "https://www.cnnturk.com/feed/rss/all/news" }
    @{ Name = "Hürriyet";      Url = "https://www.hurriyet.com.tr/rss/anasayfa" }
    @{ Name = "Sözcü";         Url = "https://www.sozcu.com.tr/rss/gundem.xml" }
    @{ Name = "Google News TR"; Url = "https://news.google.com/rss/search?q=t%C3%BCrkiye+g%C3%BCndem&hl=tr&gl=TR&ceid=TR:tr" }
)

# ─── Yardımcı: RSS çek ve ayrıştır ─────────────────────────────
function Get-RssItems {
    param($Url, $Max = $MaxItems)
    try {
        $xml = [System.Xml.XmlDocument]::new()
        $xml.Load($Url)
        $items = $xml.RSS.Channel.Item | Select-Object -First $Max
        return $items | ForEach-Object {
            $t    = $_.Title -replace '\s+', ' ' -replace '^\s+|\s+$', ''
            $link = $_.Link -replace '\s+', ''
            $desc = if ($_.Description) { $_.Description -replace '<[^>]+>', '' -replace '\s+', ' ' -replace '^\s+|\s+$', '' -replace '^.{100}(.*)$', '…' } else { '' }
            $desc = $desc.Substring(0, [Math]::Min($desc.Length, 120))
            [PSCustomObject]@{ Title = $t; Link = $link; Description = $desc }
        }
    } catch {
        Write-Warning "RSS hatası ($Url): $_"
        return @()
    }
}

# ─── Rapor içeriğini oluştur ────────────────────────────────────
$lines = [System.Collections.ArrayList]::new()
$null = $lines.Add("# 🇹🇷 Türkiye Gündemi – $DateStr")
$null = $lines.Add("")
$null = $lines.Add("> Rapor otomatik oluşturulmuştur · $(Get-Date -Format 'HH:mm')")
$null = $lines.Add("")

$totalSources = 0
$totalItems   = 0

foreach ($src in $Sources) {
    $items = Get-RssItems -Url $src.Url
    if ($items.Count -eq 0) { continue }
    $totalSources++
    $totalItems += $items.Count

    $null = $lines.Add("")
    $null = $lines.Add("## 📰 $($src.Name)")
    $null = $lines.Add("")

    foreach ($item in $items) {
        $title = if ($item.Link) { "[$($item.Title)]($($item.Link))" } else { $item.Title }
        $null = $lines.Add("- $title")
        if ($item.Description) {
            $null = $lines.Add("  > $($item.Description)")
        }
    }
}

# ─── Özet ekle ──────────────────────────────────────────────────
$null = $lines.Add("")
$null = $lines.Add("---")
$null = $lines.Add("*📊 **Özet:** $totalSources kaynaktan $totalItems haber başlığı derlendi.*")
$null = $lines.Add("*⏰ Günlük görev — her akşam 20:00*")
$null = $lines.Add("*📁 $ReportFile*")

# ─── Dosyaya yaz ────────────────────────────────────────────────
if (-not (Test-Path $ReportDir)) { $null = New-Item -ItemType Directory -Path $ReportDir -Force }
$lines -join "`r`n" | Out-File -FilePath $ReportFile -Encoding utf8 -Force

Write-Host "✅ Rapor kaydedildi: $ReportFile"

# ─── Windows Toast Bildirimi ────────────────────────────────────
if (-not $NoNotify) {
    $ToastXml = @"
<toast>
  <visual>
    <binding template="ToastText02">
      <text id="1">🇹🇷 Türkiye Gündemi</text>
      <text id="2">$totalSources kaynaktan $totalItems haber – rapor hazır.</text>
    </binding>
  </visual>
  <actions>
    <action content="Raporu Aç" arguments="$ReportFile" activationType="protocol"/>
  </actions>
</toast>
"@
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $notification = New-Object System.Windows.Forms.NotifyIcon
        $notification.Icon = [System.Drawing.SystemIcons]::Information
        $notification.BalloonTipTitle = "🇹🇷 Türkiye Gündemi"
        $notification.BalloonTipText  = "$totalSources kaynaktan $totalItems haber – rapor hazır. (Masaüstü\GündemRaporu)"
        $notification.Visible = $true
        $notification.ShowBalloonTip(5000)
        Start-Sleep -Seconds 6
        $notification.Dispose()
    } catch {
        Write-Warning "Bildirim gösterilemedi: $_"
    }
}

# ─── Çıktı olarak rapor yolunu döndür ──────────────────────────
return $ReportFile
