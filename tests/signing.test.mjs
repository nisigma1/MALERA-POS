import { describe, it, expect } from 'vitest';
import { signingConfiguration } from '../scripts/release/signing-config.mjs';
describe('trusted release signing gates', () => {
  it('missing credential fails official packaging', () => {
    expect(() => signingConfiguration({})).toThrow('SIGNING CREDENTIAL REQUIRED');
  });
  it('QA must be explicit and disables signing rather than falsely claiming trust', () => {
    expect(signingConfiguration({}, true)).toEqual({
      forceCodeSigning: false,
      win: { signExecutable: false },
    });
  });
  it('certificate provider requires trusted credential and uses SHA256/provider RFC3161', () => {
    const env = {
      FOX_SIGNING_PROVIDER: 'certificate',
      FOX_SIGNING_TIMESTAMP: 'https://provider.example/rfc3161',
      FOX_SIGNER_SUBJECT: 'CN=Owner',
      CSC_LINK: 'credential-from-secret',
    };
    const config = signingConfiguration(env);
    expect(config.forceCodeSigning).toBe(true);
    expect(config.win.signtoolOptions.signingHashAlgorithms).toEqual(['sha256']);
    expect(config.win.signtoolOptions.rfc3161TimeStampServer).toBe(env.FOX_SIGNING_TIMESTAMP);
    expect(JSON.stringify(config)).not.toContain(env.CSC_LINK);
  });
  it('Azure provider is explicit, requires profile and SHA256 digests', () => {
    const env = {
      FOX_SIGNING_PROVIDER: 'azure',
      FOX_SIGNING_TIMESTAMP: 'https://provider.example/rfc3161',
      FOX_SIGNER_SUBJECT: 'CN=Owner',
      FOX_AZURE_ENDPOINT: 'https://provider.example',
      FOX_AZURE_ACCOUNT: 'account',
      FOX_AZURE_PROFILE: 'profile',
    };
    expect(signingConfiguration(env).win.azureSignOptions.fileDigest).toBe('SHA256');
    delete env.FOX_AZURE_PROFILE;
    expect(() => signingConfiguration(env)).toThrow('SIGNING CREDENTIAL REQUIRED');
  });
  it('rejects invented protocol and credentials in timestamp URL', () => {
    for (const endpoint of ['file:///signing', 'https://user:password@example.com'])
      expect(() =>
        signingConfiguration({ FOX_SIGNING_TIMESTAMP: endpoint, FOX_SIGNER_SUBJECT: 'CN=Owner' }),
      ).toThrow();
  });
});
