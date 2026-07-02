import { spawn } from 'node:child_process';
import { createServer } from 'vite';

process.env.VITE_WASTESHIFT_E2E = 'true';

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
  });

  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
  });
});

const server = await createServer({
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});

try {
  await server.listen();
  server.printUrls();
  await run(process.execPath, ['./node_modules/@playwright/test/cli.js', 'test']);
  await run(process.execPath, ['scripts/e2e-smoke.test.mjs']);
} finally {
  await server.close();
}
