import {
  JsonFileYouTubeOAuthCredentialStore,
  YouTubeCredentialManager,
} from '../src/youtube-credentials.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !['url', 'connect', 'rotate', 'disconnect'].includes(command)) usage();

  const store = new JsonFileYouTubeOAuthCredentialStore(required('VIDEOOS_YOUTUBE_CREDENTIALS_FILE'));
  const manager = new YouTubeCredentialManager({ store });
  const projectId = required('VIDEOOS_PROJECT_ID');
  const accountId = required('VIDEOOS_YOUTUBE_ACCOUNT_ID');

  if (command === 'disconnect') {
    await manager.disconnect({ projectId, accountId });
    process.stdout.write(`Disconnected YouTube account ${accountId} from project ${projectId}.\n`);
    return;
  }

  const clientId = required('VIDEOOS_YOUTUBE_CLIENT_ID');
  const clientSecret = required('VIDEOOS_YOUTUBE_CLIENT_SECRET');

  if (command === 'url') {
    const redirectUri = required('VIDEOOS_YOUTUBE_REDIRECT_URI');
    const state = required('VIDEOOS_YOUTUBE_OAUTH_STATE');
    process.stdout.write(`${manager.authorizationUrl({ clientId, clientSecret, redirectUri, state })}\n`);
    return;
  }

  if (command === 'connect') {
    await manager.connectWithAuthorizationCode({
      projectId,
      accountId,
      clientId,
      clientSecret,
      redirectUri: required('VIDEOOS_YOUTUBE_REDIRECT_URI'),
      code: required('VIDEOOS_YOUTUBE_AUTH_CODE'),
    });
    process.stdout.write(`Connected YouTube account ${accountId} to project ${projectId}.\n`);
    return;
  }

  await manager.rotate({
    projectId,
    accountId,
    clientId,
    clientSecret,
    refreshToken: required('VIDEOOS_YOUTUBE_REFRESH_TOKEN'),
  });
  process.stdout.write(`Rotated YouTube credentials for account ${accountId} in project ${projectId}.\n`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function usage(): never {
  throw new Error('Usage: youtube:credentials <url|connect|rotate|disconnect>');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown YouTube credential command failure';
  process.stderr.write(`YouTube credential command failed: ${message.slice(0, 500)}\n`);
  process.exitCode = 1;
});
