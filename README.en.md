<img src="resources/Portio.png" width="120" alt="Portio icon">

# Portio for Mac

[日本語](README.md) | **English**

**Two workspaces. One place to begin.**

Portio is a small Mac browser with separate personal and university sessions. Switch spaces and open Gmail, Drive, Calendar, Canva or Classroom without preparing another browser window. Its name is an original word inspired by magical travel between places.

## Why I made it

When I asked ChatGPT to operate websites, separate browsers for my personal and university accounts crowded my screen. I also wanted to avoid signing up for another service, so I made Portio to bring both workspaces into one app. Portio itself requires no account registration.

## Features

- Separate cookies and website storage for each space.
- Service shortcuts, an address/search field and tabs. Add your own websites separately in each space.
- Drag tabs to reorder them, preserving the current page and its input. Restore their order and selection after restarting; authentication callback URLs are excluded.
- Free to use. Third-party services may have their own fees.

## Use on a Mac

**This repository currently distributes source code.** A ready-to-install app binary is not published on GitHub. Follow the build instructions below to create `Portio.app` on your own Mac.

The prototype targets **Apple Silicon (M1 or later)** and was checked on macOS 15.3.2. Intel Macs are untested. Move the locally built app to Applications, then sign in separately in each space. The local build is ad-hoc signed, without Apple Developer ID signing or notarization.

Quit Portio before replacing the app when updating. Sign in separately from Chrome or Safari.

## Shortcuts

⌘1 / ⌘2: switch space · ⌘T / ⌘W: new / close tab · ⌘L: address · ⌘R: reload · ⌘Q: quit.

Use **「＋ 追加」** beside 「すぐに開く」 to save a name and an `https://` or `http://` URL. Each space supports up to 20 custom shortcuts. Use **「…」** beside an added item to edit or delete it. Deleting a shortcut keeps its open page intact.

Use **「＋」** immediately after the open tabs to add a new tab. The button remains visible when tabs overflow, and the newly opened tab scrolls into view.

Drag a tab title left or right to change its position.

Notification allow/block choices are remembered separately for each website origin and space. Open **「サイトの通知」** in the sidebar to review or reset a choice. Reload the site after resetting; its next notification request will ask again. If no choice is saved, Portio asks when the site first requests notifications. Camera, microphone and clipboard permissions are valid only until the app exits.

## Limits and privacy

- Built with Electron and Chromium; it is not Google Chrome.
- Google or university SSO may reject embedded browsers. Portio does not bypass those restrictions.
- **No automatic updates.** Install a newer Portio build to receive browser security fixes.
- No extensions, password manager or Chrome sync.
- Spaces separate sign-ins; they do not hide data from another person using the same Mac account.
- Websites communicate directly with their own services. Portio adds no analytics, ads or cloud sync.
- Sign-in sessions, website storage, restored tabs, custom shortcuts and notification choices are saved locally on your Mac. Published source code does not include users' accounts, cookies or browsing history.

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

Source and original icon: [MIT](LICENSE). Electron, Chromium and other dependencies retain their own licenses, included with the generated Mac build.
