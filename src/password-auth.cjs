// Authentication is deliberately per operation, with no remembered approval or
// password fallback. Only the OS Touch ID prompt can return success.
function touchIDAuthenticator({ systemPreferences, dialog, window, platform = process.platform }) {
  let busy = false;
  return async reason => {
    if (busy) return false;
    busy = true;
    try {
      if (platform !== 'darwin' || !systemPreferences.canPromptTouchID()) {
        await dialog.showMessageBox(window(), {
          type: 'info', message: 'Touch IDで本人確認できません',
          detail: '保存したログイン情報の入力・更新・削除にはTouch IDが必要です。MacのTouch ID設定と利用状況を確認してください。認証を省略して入力することはありません。サイトへの手入力は引き続き使えます。',
          buttons: ['閉じる']
        });
        return false;
      }
      await systemPreferences.promptTouchID(reason);
      return true;
    } catch { return false; }
    finally { busy = false; }
  };
}
module.exports = { touchIDAuthenticator };
