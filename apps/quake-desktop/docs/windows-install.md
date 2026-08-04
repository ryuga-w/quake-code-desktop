# Install Quake Code on Windows

## Requirements

- Windows 10 or Windows 11, x64
- Internet access for the model providers you choose
- Development tools required by the projects you open (for example Git, Node.js, Python, .NET, or Java)

The packaged application does not require a separate Node.js installation. Node.js 22+ and npm 10+ are needed only when building from source.

## Install from GitHub Releases

1. Open the [latest release](https://github.com/ryuga-w/quake-code-desktop/releases/latest).
2. Download `Quake-Code-Setup-<version>-x64.exe` and `SHA256SUMS.txt` to the same directory.
3. Verify the installer checksum:

   ```powershell
   Get-FileHash .\Quake-Code-Setup-*-x64.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

4. Confirm that the SHA-256 values match exactly.
5. Run the installer and choose the installation scope and directory.
6. Start **Quake Code** from the desktop or Start menu.
7. Open a workspace, then configure a model provider and permission mode in Settings.

The release may also contain `KUR-QUAKE-CODE.bat`, a repository-generated installation helper. Review scripts before running them and keep all release files together so checksum verification can work.

## Windows SmartScreen

Current community builds are unsigned. Windows may show an **Unknown publisher** or SmartScreen warning. Only continue when the installer came from this repository's Releases page and its SHA-256 checksum matches the published file.

Code-signing and update-feed details are documented in [windows-signing.md](./windows-signing.md).

## Silent installation

From PowerShell in the installer directory:

```powershell
$installer = Get-ChildItem -Path . -Filter 'Quake-Code-Setup-*-x64.exe' | Select-Object -First 1
if (-not $installer) { throw 'Quake Code installer not found.' }
Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait
```

Silent installation uses the installer's default scope and directory. Use the normal installer when you need to choose them interactively.

## Build from source

```powershell
git clone https://github.com/ryuga-w/quake-code-desktop.git
cd quake-code-desktop
npm ci
npm run desktop:package:win
```

The installer and checksum are written to `apps/quake-desktop/release/`.

## Moving to another computer

The installer does not bundle your projects or private provider credentials. Move or clone projects separately, then configure provider access on the new computer. Treat copied `.quake-code` directories as sensitive because they may contain local session or provider data.

## Uninstall

Open **Windows Settings → Apps → Installed apps → Quake Code → Uninstall**. Uninstalling the application does not delete your project files.
