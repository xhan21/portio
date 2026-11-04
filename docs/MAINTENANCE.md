# 開発と更新

## 構成

- `src/main.cjs`：ウィンドウ、スペース別セッション、タブ、メニュー、権限、保存と終了。
- `src/page-view-host.cjs`：選択中のページだけをネイティブのビュー階層に接続。
- `src/ui/tabs.js`：タブIDごとにボタンを保持し、必要な表示だけを更新。
- `src/core.cjs`：サービス一覧、URL境界、復元データの検証、WebContentsの設定。
- `src/notifications.cjs`：通知の選択の保存・検証。`notifications.json`は利用者データなので公開しない。
- `src/passwords.cjs`：MacのsafeStorage非同期APIによる暗号化保存。`passwords.enc.json`は利用者データなので公開しない。
- `src/password-auth.cjs`：OSのTouch IDによる毎回の本人確認。非対応・キャンセル・失敗時は拒否し、成功をキャッシュしない。
- `src/password-controller.cjs` / `src/password-fields.cjs`：信頼済みUI・ネイティブ候補メニュー・入力欄の照合。
- `src/preload.cjs` / `src/ui/`：ローカル画面専用の操作窓口と表示。
- `resources/Portio.svg`：アイコン原本。`npm run icon`で生成物を更新。
- `scripts/package.cjs`：Apple Silicon向けアプリの作成とアドホック署名。

## 保存先と維持する識別子

ログイン状態と設定を更新後も使えるように、以下の識別子を維持します。利用者向けの説明はPortioの名称に統一し、内部名や保存先の詳細はこの節にまとめます。

- Bundle ID：`jp.local.duochromium`
- Electron内部名：`Duo Chromium`（macOSのCookie暗号化用Keychain名に使われる）
- userData：`~/Library/Application Support/DuoChromium/`
- partition：`persist:duo-personal` / `persist:duo-university`
- IPC名・preload名の`duo`接頭辞

名称整理だけでこれらを変更しないでください。macOSのKeychain許可はOSと利用者が管理します。キーチェーンの書き換えや自動承認は行いません。
Electronの実装根拠：[macOS Keychain identity](https://github.com/electron/electron/blob/v45.2.1/shell/browser/electron_browser_main_parts.cc#L615-L656)。

## Webコンテンツの境界

外部ページはsandbox・contextIsolationを有効にし、Node.jsやサイトから呼べるAPIを与えません。隔離されたsandbox preloadはログイン操作の観察だけを行います。ローカルUIのIPCは送信者とフレームを照合します。ポップアップではElectronから渡された`options.webContents`をそのままWebContentsViewに引き継ぎ、親と同じスペースのsessionを使います。これを新規WebContentsに置き換えるとログイン用ポップアップが壊れます。

終了時はページの未保存確認を尊重し、Cookieをフラッシュして終了します。破棄済みビューからwebContentsを読み直さず、管理している参照を先に解放します。

背景タブは非表示にするだけでなく、親ビューから取り外します。WebContentsは破棄せず、入力内容とログイン状態を保持します。設定画面の表示中はページを取り外し、閉じた候補ビューも取り外します。読み込み・タイトル更新でタブボタンを作り直さず、同じIDの要素を更新してください。macOSの操作対象が不要に入れ替わるのを抑えるためです。

## 更新の手順

1. README・TESTING・未コミットの変更を確認。
2. 必要な変更後、`npm test`と構文確認を実行。ブラウザ処理の変更時は、架空データでスペースの分離・ポップアップ・終了／再起動を確認。
3. `npm run package`で作成し、署名・バージョン・表示を確認。起動中のアプリを直接上書きせず、別の出力先で作成する。
4. 通常終了後、アプリを入れ替える。未保存確認を無視しない。
5. 公開が依頼されている場合のみ、ソースと確認済みの配布物を公開する。公開前に個人データ・Cookie・認証情報・ローカルパスが含まれないことを確認。

公開ZIPはpackager出力フォルダ内のアプリ・Electronライセンス・Chromiumライセンスを含めます。`LICENSE`と`README.md`も同梱します。署名はアドホックであり、公証済みとは記載しません。ブラウザ更新は依頼時に行い、自動更新は実装していません。

## 通知の設定

通知のみ、利用者が明示的に選んだ許可・ブロックを保存します。HTTPS（検証用のloopback HTTPを含む）の正規化したoriginとスペースで照合し、異なるoriginの埋め込みには流用しません。既存のカメラ・マイク・クリップボードの一時的な許可やmacOSの設定は変更しません。保存失敗時は許可せず案内し、リセットの失敗時も既存の選択を維持します。

## パスワードの保存と入力

保存は利用者が明示的に確認した場合のみ行い、origin（HTTPSまたは検証用のloopback HTTP）とスペースで分離します。MacのsafeStorage非同期APIを使い、ユーザー名・origin・パスワードを含む全体を暗号化して0600のファイルへ原子的に保存します。暗号化が使えない場合や破損時は保存・入力を行わず、平文に切り替えません。OSのKeychain許可は自動承認しません。

`login-preload.cjs`は隔離されたsandbox内で動き、信頼された入力と送信操作から候補を収集します。サイトへAPIを公開せず、送信専用の固定IPCを使います。受信側は送信元の最上位フレーム・origin・選択タブ・スペース・長さを検証します。保存前の候補はメモリだけに置き、確認後に保存します。ID先行画面の一時候補は同じタブ・originで2分までです。ログイン成功を保証する検出ではありません。

実際のクリック／Tab操作を契機に、isolated world 1004で最上位フレームの入力欄だけを検査します。アカウント候補は別の信頼済みWebContentsViewに表示し、選ばれた一件についてTouch IDが成功した後だけ入力します。本人確認中に操作対象が変わった場合や画面ロック・スリープ・ユーザー切り替えでは、保留中の入力を無効化します。入力前にタブ・スペース・フレーム・ナビゲーション世代・origin・入力欄・フォーム送信先を再照合し、自動送信はしません。外部ページへ保存一覧や操作APIを公開しません。選択・認証した一件のみを入力します。アプリの一般状態にもパスワードを含めず、保存時の下書きだけを信頼済みUIへ一度返します。

Chrome/iCloudとの同期・取り込み、iframe/shadow DOM、独自入力部品、パスキーや確認コードの自動化は対象外です。暗号化ファイルは同じMacアカウントの利用者から情報を隠す機能ではありません。鍵を失うと復号できないため、保存ファイルやKeychain名を安易に移動・変更しないでください。

0.5.1の点検範囲と本人確認の限界は[SECURITY-REVIEW.md](SECURITY-REVIEW.md)に記載しています。アプリ内の認証ゲートを、鍵そのものへのOSの利用者在席制約と混同しないでください。

## アドレス欄の候補

`session.json`にスペースごとの直近200件のURL・タイトルを保存します。認証ページをrestorableで除外し、クエリ・フラグメントを除去します。候補は別の信頼済みViewに表示し、外部ページや検索サービスには渡しません。履歴の消去は対象スペースのみで、Cookieやパスワードは消去しません。
