<img src="resources/Portio.png" width="120" alt="Portioのアイコン">

# Portio（ポルティオ）

**日本語** | [English](README.en.md)

**個人と大学、ふたつの作業場所をひとつのアプリに。**

アカウントを切り替えるためにブラウザを開き直す手間を減らす、Mac用の小さなブラウザです。
左側で「個人」「大学」を選び、Gmail・Drive・カレンダー・Canva・Classroomを開けます。
Portioは、場所を行き来する魔法をイメージした造語です。

## できること

- **ログインを分ける**：個人・大学それぞれに、Cookieとサイトの保存領域を用意。
- **すぐ始める**：よく使うサービスへの入口と、URL・検索の入力欄。
- **タブを使う**：スペースごとにタブを保存し、再起動時に復元。
- **無料で使う**：Portio自体の利用料や月額料金はありません。各Webサービスの料金は別です。

## Macで使う

[最新版とダウンロード](https://github.com/xhan21/portio/releases/latest)

配布版は **Apple Silicon（M1以降）向けの試作版**です。macOS 15.3.2で確認しています。Intel Macでの動作は未確認です。

1. リリースページの `Portio-0.3.0-mac-arm64.zip` を展開。
2. `Portio.app`を「アプリケーション」フォルダに移動。
3. 起動し、「個人」「大学」で、それぞれ目的のアカウントにログイン。

配布版はアドホック署名で、AppleのDeveloper ID署名・公証はしていません。ダウンロードしたアプリはmacOSに起動を止められる場合があります。信頼する公開元・内容を確認のうえ、必要に応じてmacOSの「プライバシーとセキュリティ」に表示される案内に従ってください。自分のMacでソースから作る手順も下にあります。

旧 **Duo Chromium 0.2.1** の設定・サイトの保存領域をそのまま使用します。更新時は旧版を終了してから入れ替えてください。ChromeやSafariのログイン状態はコピーしません。

## 使い方

| 操作 | ショートカット |
|---|---|
| 個人へ切り替え | ⌘1 |
| 大学へ切り替え | ⌘2 |
| 新しいタブ／タブを閉じる | ⌘T／⌘W |
| URL・検索の入力 | ⌘L |
| 再読み込み | ⌘R |
| 終了 | ⌘Q |

スペースの切り替えは、同じサイト内のGoogleアカウント選択とは別の操作です。最初に適切なスペースを選んでからログインしてください。

## 知っておきたいこと

- Chromiumを含むElectronで動きます。Google Chromeそのものではありません。
- Google・大学のSSOなど、認証方式によって利用できない場合があります。サービス側の埋め込みブラウザ制限を回避する機能はありません。
- ブラウザの**自動更新はありません**。セキュリティ修正を取り込むには、新しいPortioへ更新してください。
- 拡張機能、パスワード管理、Chrome同期は未実装です。
- ふたつのスペースはログインを分けるためのもので、同じMacを使う別の人から情報を隠す機能ではありません。
- [動作確認と未確認の範囲](TESTING.md)を参照してください。

## データの扱い

閲覧したサイトへの通信は、そのサイトに直接送られます。Portio独自の解析・広告・クラウド同期はありません。
ログイン状態、サイトの保存データ、復元用タブはMac内の `~/Library/Application Support/DuoChromium/` に保存します。旧版からの引き継ぎのため、このフォルダ名は維持しています。
ソースコードや配布アプリに、利用者のアカウント・Cookie・閲覧履歴は含めません。

## ソースから作る

macOS、Node.js 22.12以降、npmが必要です。Electronの初回取得にはネット接続が必要です。

```sh
git clone https://github.com/xhan21/portio.git
cd portio
npm ci
node node_modules/electron/install.js
npm test
npm run package
```

作成先は `dist/Portio-darwin-arm64/Portio.app` です。ローカルでもアドホック署名を検証します。
アイコンの原本は `resources/Portio.svg`。変更後は `npm run icon` でPNG・ICNSを再生成できます。

開発・更新の注意点は [MAINTENANCE.md](docs/MAINTENANCE.md)、変更内容は [CHANGELOG.md](CHANGELOG.md) にまとめています。

[Hedwigとつくる道具 — シリーズ紹介](https://github.com/xhan21/hedwig-tools)

ソースコードと独自のアイコンは [MITライセンス](LICENSE)。Electron・Chromium等には、それぞれのライセンスが適用されます。配布ZIPには同梱ライセンスを含めます。
