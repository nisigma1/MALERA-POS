// No passwords/key contents written to generated config or logs. Builder reads CSC_* securely.
export function signingConfiguration(env = process.env, qa = false) {
  if (qa) return { forceCodeSigning: false, win: { signExecutable: false } };
  if (!env.FOX_SIGNING_TIMESTAMP || !env.FOX_SIGNER_SUBJECT)
    throw Error('SIGNING CREDENTIAL REQUIRED: expected signer and provider RFC3161 endpoint');
  const timestamp = new URL(env.FOX_SIGNING_TIMESTAMP);
  if (!['https:', 'http:'].includes(timestamp.protocol) || timestamp.username || timestamp.password)
    throw Error('Invalid signing timestamp endpoint');
  const common = { forceCodeSigning: true };
  if (env.FOX_SIGNING_PROVIDER === 'certificate') {
    if (!env.CSC_LINK && !env.WIN_CSC_LINK && !env.FOX_SIGNING_THUMBPRINT)
      throw Error('SIGNING CREDENTIAL REQUIRED');
    return {
      ...common,
      win: {
        signExecutable: true,
        signExts: ['.dll', '.node'],
        signtoolOptions: {
          signingHashAlgorithms: ['sha256'],
          rfc3161TimeStampServer: env.FOX_SIGNING_TIMESTAMP,
          ...(env.FOX_SIGNING_THUMBPRINT ? { certificateSha1: env.FOX_SIGNING_THUMBPRINT } : {}),
        },
      },
    };
  }
  if (env.FOX_SIGNING_PROVIDER === 'azure') {
    for (const key of ['FOX_AZURE_ENDPOINT', 'FOX_AZURE_ACCOUNT', 'FOX_AZURE_PROFILE'])
      if (!env[key]) throw Error('SIGNING CREDENTIAL REQUIRED');
    return {
      ...common,
      win: {
        signExecutable: true,
        signExts: ['.dll', '.node'],
        azureSignOptions: {
          publisherName: env.FOX_SIGNER_SUBJECT,
          endpoint: env.FOX_AZURE_ENDPOINT,
          codeSigningAccountName: env.FOX_AZURE_ACCOUNT,
          certificateProfileName: env.FOX_AZURE_PROFILE,
          fileDigest: 'SHA256',
          timestampDigest: 'SHA256',
          timestampRfc3161: env.FOX_SIGNING_TIMESTAMP,
        },
      },
    };
  }
  throw Error('SIGNING CREDENTIAL REQUIRED: certificate or azure provider');
}
