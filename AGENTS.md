# Portio maintenance

Read README.md, TESTING.md and docs/MAINTENANCE.md before changing this app.
Keep the legacy bundle ID, Electron internal app name, userData path and partition names stable to preserve cookies and settings. Display branding is Portio.
Never commit browser profiles, account information, authentication tokens, browsing history, local paths or screenshots containing real accounts. Use synthetic data for testing and public images.
Do not bypass service authentication restrictions, weaken web security or approve OS permissions automatically.
Run npm test and validate the packaged app/signature before installing. Quit normally and respect unsaved edits. Keep build products and dependencies out of Git.
