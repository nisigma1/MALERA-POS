import fs from 'node:fs';

function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

// Extra launch clicks never wait in a queue. A background downloader may coexist
// with launching the existing app, but another launcher/installer must finish first.
export async function withBrokerLock({ lockFile, stateFile, mode, work, onBusy = () => {} }) {
  let acquired = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = fs.openSync(lockFile, 'wx');
      try {
        fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, mode }));
      } finally {
        fs.closeSync(handle);
      }
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const record = read(lockFile, null);
      const owner = typeof record === 'number' ? { pid: record, mode: 'unknown' } : record;
      let abandonedEmpty = false;
      if (!owner) {
        try {
          abandonedEmpty = Date.now() - fs.statSync(lockFile).mtimeMs > 30000;
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
      }
      if ((owner && !alive(owner.pid)) || abandonedEmpty) {
        // Recheck before reclaiming a stale record, never delete a known live owner.
        const latest = read(lockFile, null);
        if (JSON.stringify(latest) === JSON.stringify(record)) {
          try {
            fs.unlinkSync(lockFile);
          } catch (e) {
            if (e.code !== 'ENOENT') throw e;
          }
          continue;
        }
      }
      await onBusy(owner ?? { mode: 'unknown' });
      return false;
    }
  }
  if (!acquired) return false;
  try {
    // This read belongs inside the critical section. Waiting launchers used to
    // keep the pre-install state and reinstall the same release after it finished.
    await work(read(stateFile, {}));
    return true;
  } finally {
    const owner = read(lockFile, null);
    if (owner?.pid === process.pid) fs.unlinkSync(lockFile);
  }
}
