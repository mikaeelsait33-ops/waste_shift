import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REQUIRED_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MEASUREMENT_ID',
];

const envText = readFileSync('.env.local', 'utf8');
const localEnv = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separatorIndex = line.indexOf('=');
      return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
    }),
);

const runVercelEnvAdd = (key, value) => new Promise((resolve, reject) => {
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'npx.cmd', '--yes', 'vercel', 'env', 'add', key, 'production', '--yes'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_OPTIONS: '--use-system-ca',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let errorOutput = '';

  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    errorOutput += chunk.toString();
  });
  child.on('error', reject);
  child.on('close', (code) => {
    const combinedOutput = `${output}\n${errorOutput}`;

    if (code === 0 || /already exists|already been added/i.test(combinedOutput)) {
      resolve({ key, ok: true });
      return;
    }

    reject(new Error(`Could not add ${key}: ${combinedOutput.replace(value, '[redacted]').trim()}`));
  });

  child.stdin.write(`${value}\n`);
  child.stdin.end();
});

const main = async () => {
  const missingKeys = REQUIRED_KEYS.filter((key) => !localEnv[key]);

  if (missingKeys.length > 0) {
    throw new Error(`Missing local env values: ${missingKeys.join(', ')}`);
  }

  const syncedKeys = [];

  for (const key of REQUIRED_KEYS) {
    await runVercelEnvAdd(key, localEnv[key]);
    syncedKeys.push(key);
  }

  console.log(JSON.stringify({
    ok: true,
    environment: 'production',
    syncedKeys,
  }, null, 2));
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
