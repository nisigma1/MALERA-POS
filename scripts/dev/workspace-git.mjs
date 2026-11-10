import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const expectedUrls = new Set([
  'https://github.com/nisigma1/MALERA-POS.git',
  'https://github.com/nisigma1/MALERA-POS',
  'git@github.com:nisigma1/MALERA-POS.git',
]);

export function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

export function validateCheckout(root, allowedUrls = expectedUrls) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const canonical = (directory) => {
    const resolved = realpathSync.native(directory);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  if (canonical(top) !== canonical(root))
    throw Error('Run workspace commands from the MALERA repository root.');
  if (!allowedUrls.has(git(root, ['remote', 'get-url', 'origin'])))
    throw Error('origin is not the expected MALERA repository; no settings or files were changed.');
  if (git(root, ['branch', '--show-current']) !== 'main')
    throw Error('Switch to main before using this single-branch workspace helper.');
}

export function configureCheckout(root, allowedUrls = expectedUrls) {
  validateCheckout(root, allowedUrls);
  for (const [key, value] of [
    ['pull.ff', 'only'],
    ['pull.rebase', 'false'],
    ['push.default', 'simple'],
    ['fetch.prune', 'true'],
    ['core.autocrlf', 'false'],
    ['branch.main.remote', 'origin'],
    ['branch.main.merge', 'refs/heads/main'],
  ])
    git(root, ['config', '--local', key, value]);
}

export function syncCheckout(root, allowedUrls = expectedUrls) {
  validateCheckout(root, allowedUrls);
  if (git(root, ['status', '--porcelain']))
    throw Error(
      'Local changes or untracked files exist. Commit them or save them separately first. Nothing was merged or overwritten.',
    );
  git(root, ['fetch', '--prune', 'origin']);
  const [ahead, behind] = git(root, ['rev-list', '--left-right', '--count', 'HEAD...origin/main'])
    .split(/\s+/)
    .map(Number);
  if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind))
    throw Error('Cannot determine checkout synchronization state.');
  if (ahead && behind)
    throw Error(
      'Both this PC and GitHub have new commits. Stop and reconcile them explicitly; do not force-push. No working files were changed.',
    );
  if (behind) git(root, ['merge', '--ff-only', 'origin/main']);
  return { ahead, updatedCommits: behind };
}
