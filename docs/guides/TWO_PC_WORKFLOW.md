# Working from the other PC

Use GitHub to transfer source changes. Keep a separate local checkout on each PC; do not use OneDrive, a shared folder or the terminal's installed app directory as the development checkout. Business data stays on its own device and is not synchronized through Git.

## One-time setup on the other PC

Save any uncommitted work from the old clone separately. The repository history was reset once; make a fresh clone and do not merge old history back.

Install Git, the Node version in `.nvmrc`, Python and Visual Studio C++ build tools. Reopen the terminal after installation so its PATH is refreshed. Authenticate GitHub for pushing changes. Then run:

```powershell
git clone https://github.com/nisigma1/MALERA-POS.git
cd MALERA-POS
npm ci
npm run dev:setup
npm run dev:sync
```

Use your own Git author name/email. The setup command changes only this checkout's Git settings; it does not store credentials or change global Git settings.

## Each work session

```powershell
npm run dev:sync
npm run dev
```

Edit on one PC at a time. Before handing work to the other PC, save, test and commit it:

```powershell
npm run format
npm test
npm run test:tooling
npm run build
git add <the-files-you-changed>
git commit -m "Describe the change"
npm run dev:publish
```

On the receiving PC, run `npm run dev:sync` before editing. If dependency manifests changed, run `npm ci` again. `main` feeds the real terminal, so publish only work ready for its delivery checks.

The sync/publish commands refuse unsaved or untracked work and divergent commits. They do not stash, reset, force-push, or automatically resolve conflicts. A clean checkout is updated only by fast-forward. Direct Git commands remain available, so follow the same discipline with them.

## If synchronization stops

GitHub's `main` protection rejects force pushes and branch deletion, including ordinary administrator pushes. Regular forward pushes remain allowed. These safeguards do not automatically merge competing edits.

Do not delete files, force-push, or run a hard reset to make the error disappear. Preserve your work first. If both PCs committed independently, review and reconcile the changes explicitly with the developer/assistant before publishing. If the other PC has unpublished edits, commit and push them there first rather than editing the same files here.

No setup can guarantee zero conflicts when both PCs edit independently. These guards prevent silent overwrites and make conflicting work visible.

## The cafe terminal

Use its installed MALERA POS shortcut for operation. Do development on the other PC with its own test data. Never copy `%APPDATA%\FOX Kafeteri` between active devices or put the live SQLite database in a synced/shared folder.

After a passing `main` build, the terminal checks for downloads every five minutes while signed in. It installs at the next launch while the app is closed, after a verified backup. A failed build leaves the current app in place. See [automatic updates](../release/AUTOMATIC_UPDATES.md).
