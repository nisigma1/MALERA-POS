import { configureCheckout, git, syncCheckout, validateCheckout } from './workspace-git.mjs';

try {
  const root = process.cwd();
  const action = process.argv[2];
  if (action === 'setup') {
    configureCheckout(root);
    console.log(
      'Local Git settings configured: fast-forward pulls, main tracking, safe default push and LF files.',
    );
  } else if (action === 'sync' || action === 'publish') {
    const result = syncCheckout(root);
    if (action === 'publish') {
      git(root, ['push', 'origin', 'main']);
      console.log(
        'Committed changes pushed to main. The desktop receives them only after delivery checks pass.',
      );
    } else {
      console.log(
        `Updated ${result.updatedCommits} commit(s); ${result.ahead} local commit(s) ready to push.`,
      );
    }
  } else if (action === 'status') {
    validateCheckout(root);
    console.log(git(root, ['status', '--short', '--branch']));
    console.log('Run npm run dev:sync to fetch and compare with GitHub.');
  } else throw Error('Expected setup, sync, publish or status.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
