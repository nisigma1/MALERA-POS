import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configureCheckout, git, syncCheckout } from '../scripts/dev/workspace-git.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'malera-sync-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('malera-sync-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const remote = path.join(root, 'remote.git');
  git(root, ['init', '--bare', '--initial-branch=main', remote]);
  const first = path.join(root, 'first'),
    second = path.join(root, 'second');
  git(root, ['clone', remote, first]);
  const identity = (checkout) => {
    git(checkout, ['config', 'user.name', 'Workspace test']);
    git(checkout, ['config', 'user.email', 'workspace@example.invalid']);
  };
  identity(first);
  fs.writeFileSync(path.join(first, '.gitattributes'), '* text=auto eol=lf\n');
  fs.writeFileSync(path.join(first, 'file.txt'), 'initial\n');
  git(first, ['add', '.']);
  git(first, ['commit', '-m', 'initial']);
  git(first, ['push', 'origin', 'main']);
  git(root, ['clone', remote, second]);
  identity(second);
  return { first, second, allowed: new Set([remote]) };
}

test('setup changes only repository-local settings and tracks main', (t) => {
  const { first, allowed } = fixture(t);
  configureCheckout(first, allowed);
  assert.equal(git(first, ['config', '--local', 'pull.ff']), 'only');
  assert.equal(git(first, ['config', '--local', 'push.default']), 'simple');
  assert.equal(git(first, ['rev-parse', '--abbrev-ref', '@{upstream}']), 'origin/main');
});

test('sync refuses unsaved files without changing their contents', (t) => {
  const { second, allowed } = fixture(t);
  fs.writeFileSync(path.join(second, 'file.txt'), 'unsaved work\n');
  assert.throws(() => syncCheckout(second, allowed), /Local changes/);
  assert.equal(fs.readFileSync(path.join(second, 'file.txt'), 'utf8'), 'unsaved work\n');
});

test('sync also refuses untracked work', (t) => {
  const { second, allowed } = fixture(t);
  fs.writeFileSync(path.join(second, 'new-work.txt'), 'keep me\n');
  assert.throws(() => syncCheckout(second, allowed), /untracked/);
  assert.equal(fs.readFileSync(path.join(second, 'new-work.txt'), 'utf8'), 'keep me\n');
});

test('sync preserves local commits that are ready to publish', (t) => {
  const { first, allowed } = fixture(t);
  fs.writeFileSync(path.join(first, 'file.txt'), 'local commit\n');
  git(first, ['commit', '-am', 'local change']);
  const before = git(first, ['rev-parse', 'HEAD']);
  assert.deepEqual(syncCheckout(first, allowed), { ahead: 1, updatedCommits: 0 });
  assert.equal(git(first, ['rev-parse', 'HEAD']), before);
});

test('sync fast-forwards a clean second PC', (t) => {
  const { first, second, allowed } = fixture(t);
  fs.writeFileSync(path.join(first, 'file.txt'), 'from first PC\n');
  git(first, ['commit', '-am', 'first change']);
  git(first, ['push', 'origin', 'main']);
  assert.deepEqual(syncCheckout(second, allowed), { ahead: 0, updatedCommits: 1 });
  assert.equal(fs.readFileSync(path.join(second, 'file.txt'), 'utf8'), 'from first PC\n');
});

test('sync refuses divergent commits and preserves the local commit and file', (t) => {
  const { first, second, allowed } = fixture(t);
  fs.writeFileSync(path.join(first, 'file.txt'), 'first PC\n');
  git(first, ['commit', '-am', 'first change']);
  git(first, ['push', 'origin', 'main']);
  fs.writeFileSync(path.join(second, 'file.txt'), 'second PC\n');
  git(second, ['commit', '-am', 'second change']);
  const before = git(second, ['rev-parse', 'HEAD']);
  assert.throws(() => syncCheckout(second, allowed), /Both this PC and GitHub/);
  assert.equal(git(second, ['rev-parse', 'HEAD']), before);
  assert.equal(fs.readFileSync(path.join(second, 'file.txt'), 'utf8'), 'second PC\n');
});

test('setup refuses another repository before changing its settings', (t) => {
  const { first } = fixture(t);
  assert.throws(() => configureCheckout(first), /not the expected MALERA/);
  assert.equal(
    git(first, ['config', '--local', '--get', 'remote.origin.url']).includes('remote.git'),
    true,
  );
});
