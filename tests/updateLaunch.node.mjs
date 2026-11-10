import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withBrokerLock } from '../scripts/update/launch-control.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'malera-launch-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('malera-launch-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const lockFile = path.join(root, 'update.lock'),
    stateFile = path.join(root, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ commit: 'old' }));
  return { lockFile, stateFile };
}

test('repeated clicks do not queue or repeat the installer operation', async (t) => {
  const files = fixture(t);
  let finish;
  let installs = 0;
  let duplicates = 0;
  const first = withBrokerLock({
    ...files,
    mode: 'launch',
    work: async () => {
      installs++;
      await new Promise((resolve) => {
        finish = resolve;
      });
      fs.writeFileSync(files.stateFile, JSON.stringify({ commit: 'new' }));
    },
  });
  for (let i = 0; i < 20; i++)
    assert.equal(
      await withBrokerLock({
        ...files,
        mode: 'launch',
        work: () => {
          installs++;
        },
        onBusy: (owner) => {
          assert.equal(owner.mode, 'launch');
          duplicates++;
        },
      }),
      false,
    );
  assert.equal(installs, 1);
  assert.equal(duplicates, 20);
  finish();
  await first;
  await withBrokerLock({
    ...files,
    mode: 'launch',
    work: (state) => {
      assert.equal(state.commit, 'new');
      if (state.commit !== 'new') installs++;
    },
  });
  assert.equal(installs, 1);
  assert.equal(fs.existsSync(files.lockFile), false);
});

test('a background download lets a launch focus/open the current app without installing', async (t) => {
  const files = fixture(t);
  let finish;
  let opened = 0;
  let installs = 0;
  const checking = withBrokerLock({
    ...files,
    mode: 'check',
    work: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await withBrokerLock({
    ...files,
    mode: 'launch',
    work: () => {
      installs++;
    },
    onBusy: (owner) => {
      if (owner.mode === 'check') opened++;
    },
  });
  assert.equal(opened, 1);
  assert.equal(installs, 0);
  finish();
  await checking;
});

test('a failed operation releases its lock without changing installed state', async (t) => {
  const files = fixture(t);
  await assert.rejects(
    withBrokerLock({
      ...files,
      mode: 'launch',
      work: () => {
        throw Error('failed');
      },
    }),
    /failed/,
  );
  assert.equal(fs.existsSync(files.lockFile), false);
  assert.equal(JSON.parse(fs.readFileSync(files.stateFile, 'utf8')).commit, 'old');
});

test('a legacy live-owner lock is respected without waiting or overwriting it', async (t) => {
  const files = fixture(t);
  fs.writeFileSync(files.lockFile, String(process.pid));
  let worked = false;
  assert.equal(
    await withBrokerLock({
      ...files,
      mode: 'launch',
      work: () => {
        worked = true;
      },
    }),
    false,
  );
  assert.equal(worked, false);
  assert.equal(fs.readFileSync(files.lockFile, 'utf8'), String(process.pid));
});

test('an abandoned empty lock can recover without touching application data', async (t) => {
  const files = fixture(t);
  fs.writeFileSync(files.lockFile, '');
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(files.lockFile, past, past);
  let worked = false;
  assert.equal(
    await withBrokerLock({
      ...files,
      mode: 'launch',
      work: () => {
        worked = true;
      },
    }),
    true,
  );
  assert.equal(worked, true);
  assert.equal(fs.existsSync(files.lockFile), false);
});
