# Studio Companion 1.2

A responsive architecture studio planner with projects, deadlines, tasks, design notes, and local file attachments.

## Welcome, menu, and password

On first launch, create a local username and password (at least 12 characters). Existing projects and attachments in the same browser/app workspace are migrated to encrypted storage. Close older versions before creating the account. The encrypted copy is committed before the old active storage is cleared.

The **Menu** icon at the top right opens the navigation panel. Close it with **×**, Escape, or by choosing a page. It includes backup controls, **Change password**, and **Log out & lock**. The workspace also locks after 10 minutes without activity and starts locked when reopened.

Keep your password safe: this is a local account with **no email password reset**. It is not a cloud account or a multi-user service. Read `SECURITY.md` for the protection model and limits.

## Windows app

Double-click **Studio Companion.exe**. It opens in its own window and needs no local web server, Node.js, or separate .NET installation. This build is for Windows 10/11, 64-bit (x64).

The app uses [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2). It is already available on the computer used to build and test this release. If it is missing on another computer, the app explains how to install it. The executable is an unsigned local build, not a signed Store installer.

The app stores its workspace under `%LOCALAPPDATA%\StudioCompanion\BrowserData`. Updating or moving the EXE keeps that workspace. Web assets are bundled inside the executable and extracted under `%LOCALAPPDATA%\StudioCompanion\App` when it launches.

## Move your existing projects to the app

1. Open the updated website in the same browser and location you used previously.
2. Log in and choose **Menu → Export backup**.
3. Open the Windows app, create your local account, choose **Menu → Import backup**, select the JSON file, enter the password used when it was exported, and confirm.

Backups include projects, tasks, notes, and attachments. Older backups containing only projects are also supported. Import adds copies and keeps existing projects. Browser and desktop workspaces are separate and do not automatically sync.

New backups are encrypted. Changing your workspace password does not change the password on previously exported backups. Keep that original password if you keep those backups. Older unencrypted backups remain readable and can be imported; this update does not change copies already saved on disk. Downloaded original attachments are not encrypted by Studio Companion.

## Add and preview files

Open a project and find **Project files**. Choose **Add files**, select one or more files, or drag files into the drop area. Each attachment may be up to 50 MB. Files are stored locally in IndexedDB, without uploading to a server.

- Images: PNG, JPG/JPEG, GIF, WebP, BMP, and AVIF.
- PDFs: bundled Mozilla PDF.js viewer with page navigation, zoom, and page text.
- Text: TXT, Markdown, CSV, JSON, logs, SVG/XML, HTML, CSS, and JavaScript, shown as plain text. The first 1 MB is previewed.
- Audio/video: browser-supported codecs in MP3, WAV, OGG, M4A, MP4, WebM, and OGV files.
- Other files, including DWG, RVT, SKP, DOCX, and ZIP, can be attached and downloaded. They need their original application to view or edit them.

Use **Download** to save an original attachment. **Remove** asks for confirmation and removes only the app's copy. Deleting a project also removes its attached files.

Browser storage is limited by available device space and browser quotas. Clearing site/app data removes stored projects and files. Keep an exported backup. A backup can include up to 250 MB of attachments; larger collections should also be downloaded separately.

## Website

Run `node serve.cjs` and visit http://127.0.0.1:4173, or host the contents of `dist/` on an HTTPS website. Use the same browser and URL to access the same saved workspace. Secure storage requires a current browser with Web Crypto, IndexedDB, and Web Locks. Use the Windows EXE for the easiest offline setup. Directly opening the HTML file is not the supported setup.

The website works without a build step: all assets are in `dist/`. Optional Google Fonts fall back to system fonts when offline. The Windows app bundles the same website and all PDF preview assets.

## Rebuild

Dependencies are pinned in `package-lock.json` and `desktop/StudioCompanion.csproj`.

```powershell
npm ci
npm run build:pdf
npm run check
npm test
dotnet restore desktop/StudioCompanion.csproj --configfile desktop/NuGet.Config
dotnet publish desktop/StudioCompanion.csproj -c Release --no-restore -o release/windows-x64
```

The desktop build requires the .NET 9 SDK. Output: `release/windows-x64/Studio Companion.exe`.

PDF.js is distributed under Apache-2.0; its license and font/decoder licenses are included in `dist/`. WebView2 SDK terms are included in `desktop/WEBVIEW2-LICENSE.txt`.
