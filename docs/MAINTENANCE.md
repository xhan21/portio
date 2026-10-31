# 開発と更新

## 構成

- `src/main.cjs`：ウィンドウ、スペース別セッション、タブ、メニュー、権限、保存と終了。
- `src/core.cjs`：サービス一覧、URL境界、復元データの検証、WebContentsの設定。
- `src/preload.cjs` / `src/ui/`：ローカル画面専用の操作窓口と表示。
- `resources/Portio.svg`：アイコン原本。`npm run icon`で生成物を更新。
- `scripts/package.cjs`：Apple Silicon向けアプリの作成とアドホック署名。

## 引き継ぎで維持する識別子

表示名はPortioですが、0.2.1以前のデータを引き継ぐため以下を維持します。

- Bundle ID：`jp.local.duochromium`
- Electron内部名：`Duo Chromium`（macOSのCookie暗号化用Keychain名に使われる）
- userData：`DuoChromium`
- partition：`persist:duo-personal` / `persist:duo-university`
- IPC名・preload名の`duo`接頭辞

名称整理だけでこれらを変更しないでください。macOSのKeychain許可はOSと利用者が管理します。キーチェーンの書き換えや自動承認は行いません。
Electronの実装根拠：[macOS Keychain identity](https://github.com/electron/electron/blob/v45.2.1/shell/browser/electron_browser_main_parts.cc#L615-L656)。

## Webコンテンツの境界

外部ページはsandbox・contextIsolationを有効にし、Node.jsとpreloadを与えません。ローカルUIのIPCは送信者とフレームを照合します。ポップアップではElectronから渡された`options.webContents`をそのままWebContentsViewに引き継ぎ、親と同じスペースのsessionを使います。これを新規WebContentsに置き換えるとログイン用ポップアップが壊れます。

終了時はページの未保存確認を尊重し、Cookieをフラッシュして終了します。破棄済みビューからwebContentsを読み直さず、管理している参照を先に解放します。

## 更新の手順

1. README・TESTING・未コミットの変更を確認。
2. 必要な変更後、`npm test`と構文確認を実行。ブラウザ処理の変更時は、架空データでスペースの分離・ポップアップ・終了／再起動を確認。
3. `npm run package`で作成し、署名・バージョン・表示を確認。起動中のアプリを直接上書きせず、別の出力先で作成する。
4. 通常終了後、アプリを入れ替える。未保存確認を無視しない。
5. 公開が依頼されている場合のみ、ソースと確認済みの配布物を公開する。公開前に個人データ・Cookie・認証情報・ローカルパスが含まれないことを確認。

公開ZIPはpackager出力フォルダ内のアプリ・Electronライセンス・Chromiumライセンスを含めます。`LICENSE`と`README.md`も同梱します。署名はアドホックであり、公証済みとは記載しません。ブラウザ更新は依頼時に行い、自動更新は実装していません。
