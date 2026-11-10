import crypto from 'node:crypto';

export const APP_ID = 'com.foxkafeteri.pos';
export function validateDescriptor(value, config) {
  if (!value || value.formatVersion !== 1 || value.repository !== config.repository || value.branch !== config.branch ||
      value.appId !== APP_ID || value.platform !== 'win32' || value.arch !== 'x64' || value.channel !== 'DESKTOP_QA' ||
      !/^[a-f0-9]{40}$/.test(value.commit) || !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/.test(value.version) ||
      value.artifact !== `FOX-Setup-${value.version}-x64.exe` || !Number.isSafeInteger(value.runId) || value.runId < 1 ||
      !Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1 ||
      value.minUpdaterVersion !== 1) throw Error('Invalid desktop update descriptor');
  return value;
}
export function validateAssetUrl(value, repository) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port ||
      !url.pathname.startsWith(`/${repository}/releases/download/`)) throw Error('Untrusted update asset URL');
  return url.href;
}
export function verifyInstaller(bytes, descriptor) {
  if (bytes.length < 1024 || bytes[0] !== 0x4d || bytes[1] !== 0x5a ||
      crypto.createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) throw Error('Installer checksum mismatch');
}
export function selectRelease(releases, state) {
  return releases.filter(r => !r.draft && r.prerelease && /^desktop-[a-f0-9]{40}-\d+-\d+$/.test(r.tag_name) &&
    r.author?.login === 'github-actions[bot]' && Number.isSafeInteger(r.id) && r.id > (state.releaseId ?? 0) &&
    r.assets?.some(a => a.name === 'desktop-update.json')).sort((a,b) => b.id-a.id);
}
