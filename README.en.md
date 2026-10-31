<img src="resources/Portio.png" width="120" alt="Portio icon">

# Portio for Mac

[日本語](README.md) | **English**

**Two workspaces. One place to begin.**

Portio is a small Mac browser with separate personal and university sessions. Switch spaces and open Gmail, Drive, Calendar, Canva or Classroom without preparing another browser window. Its name is an original word inspired by magical travel between places.

## Features

- Separate cookies and website storage for each space.
- Service shortcuts, an address/search field and tabs.
- Restore tabs after restarting; authentication callback URLs are excluded.
- Free to use. Third-party services may have their own fees.

## Use on a Mac

[Latest release and download](https://github.com/xhan21/portio/releases/latest)

The prototype build targets **Apple Silicon (M1 or later)** and was checked on macOS 15.3.2. Intel Macs are untested. Extract `Portio-0.3.0-mac-arm64.zip`, move `Portio.app` to Applications, then sign in separately in each space.

The build is ad-hoc signed, without Apple Developer ID signing or notarization. macOS may prevent a downloaded copy from opening. Check the source and publisher before following the instructions shown in Privacy & Security. You can also build it locally below.

Duo Chromium 0.2.1's settings and website storage are retained. Quit the old app before replacing it. Chrome/Safari sessions are not imported.

## Shortcuts

⌘1 / ⌘2: switch space · ⌘T / ⌘W: new / close tab · ⌘L: address · ⌘R: reload · ⌘Q: quit.

## Limits and privacy

- Built with Electron and Chromium; it is not Google Chrome.
- Google or university SSO may reject embedded browsers. Portio does not bypass those restrictions.
- **No automatic updates.** Install a newer Portio build to receive browser security fixes.
- No extensions, password manager or Chrome sync.
- Spaces separate sign-ins; they do not hide data from another person using the same Mac account.
- Websites communicate directly with their own services. Portio adds no analytics, ads or cloud sync.
- Cookies, website storage and restored tabs live in `~/Library/Application Support/DuoChromium/`. The legacy folder and encryption identity are preserved for continuity. No user profiles are included in the repository or release.

See [validation and known limits](TESTING.md).

## Build from source

Requires macOS, Node.js 22.12+ and npm. The first Electron download requires an internet connection.

```sh
git clone https://github.com/xhan21/portio.git
cd portio
npm ci
node node_modules/electron/install.js
npm test
npm run package
```

Output: `dist/Portio-darwin-arm64/Portio.app`. The build script applies and verifies an ad-hoc signature. Edit `resources/Portio.svg` and run `npm run icon` to regenerate the icon.

[Maintenance](docs/MAINTENANCE.md) · [Changelog](CHANGELOG.md) · [Tools made with Hedwig](https://github.com/xhan21/hedwig-tools/blob/main/README.en.md)

Source and original icon: [MIT](LICENSE). Electron, Chromium and other dependencies retain their own licenses, included with the release ZIP.
