import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const mode = process.argv[2] ?? 'scan',
  root = path.resolve(process.argv[3] ?? '.');
const secret =
  /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-(?:proj-)?[A-Za-z0-9_-]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
if (mode === 'scan') {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  let count = 0;
  for (const name of files) {
    if (
      /\.(?:pfx|p12|pem|key|sqlite(?:-wal|-shm)?|db)$/i.test(name) ||
      /(?:^|\/)\.env(?:\.|$)/.test(name)
    )
      throw Error('Forbidden tracked file');
    const file = path.join(root, name);
    if (
      fs.existsSync(file) &&
      fs.statSync(file).size < 5e6 &&
      secret.test(fs.readFileSync(file, 'utf8'))
    )
      throw Error(`Secret pattern detected in ${name}; value suppressed`);
    count++;
  }
  console.log(JSON.stringify({ passed: true, trackedFiles: count, valuesSuppressed: true }));
} else if (mode === 'sbom') {
  fs.mkdirSync(root, { recursive: true });
  const result = execFileSync(
    process.execPath,
    [
      process.env.npm_execpath ?? 'node_modules/npm/bin/npm-cli.js',
      'sbom',
      '--sbom-format=cyclonedx',
      '--omit=dev',
    ],
    { encoding: 'utf8', maxBuffer: 20e6 },
  );
  const document = JSON.parse(result);
  if (
    document.bomFormat !== 'CycloneDX' ||
    !Array.isArray(document.components) ||
    secret.test(result)
  )
    throw Error('Invalid SBOM');
  const electron = JSON.parse(fs.readFileSync('node_modules/electron/package.json', 'utf8'));
  document.components.push({
    type: 'framework',
    name: 'electron',
    version: electron.version,
    purl: `pkg:npm/electron@${electron.version}`,
    properties: [{ name: 'fox:role', value: 'bundled-runtime' }],
  });
  const recovery = JSON.parse(fs.readFileSync('patches/sqlite-windows-shm-recovery.json', 'utf8'));
  // Signing changes PE bytes. Freeze the shipped (post-signing) native file,
  // while the separate C source hash identifies the exact upstream correction.
  const nativeFile = path.join(
    root,
    'win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node',
  );
  const nativeHash = (await import('node:crypto'))
    .createHash('sha256')
    .update(fs.readFileSync(nativeFile))
    .digest('hex');
  document.components.push({
    type: 'library',
    name: 'sqlite',
    version: recovery.sqliteVersion,
    purl: `pkg:generic/sqlite@${recovery.sqliteVersion}`,
    properties: [
      { name: 'fox:upstream-recovery-fix', value: recovery.upstream },
      { name: 'fox:patched-source-sha256', value: recovery.sourceSha256After },
      { name: 'fox:native-addon-sha256', value: nativeHash },
    ],
  });
  const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  fs.writeFileSync(
    path.join(root, `FOX-${version}-sbom.json`),
    JSON.stringify(document, null, 2) + '\n',
  );
  console.log(JSON.stringify({ sbom: true, components: document.components.length }));
} else throw Error('Invalid supply chain command');
