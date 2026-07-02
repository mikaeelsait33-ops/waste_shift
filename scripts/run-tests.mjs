import { spawn } from 'node:child_process';

const testFiles = [
  'scripts/waste-calculations.test.mjs',
  'scripts/invoice-parsing.test.mjs',
  'scripts/stock-alerts.test.mjs',
  'scripts/foundation.test.mjs',
  'scripts/setup-workflow.test.mjs',
  'scripts/shift-workflow.test.mjs',
  'scripts/ingredient-intelligence.test.mjs',
  'scripts/performance.test.mjs',
  'scripts/auth-permissions.test.mjs',
  'scripts/api-routes.test.mjs',
  'scripts/large-dataset.test.mjs',
];

const runTestFile = (file) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [file], {
    stdio: 'inherit',
    shell: false,
  });

  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`${file} failed with exit code ${code}`));
  });
});

for (const file of testFiles) {
  console.log(`\n> ${file}`);
  await runTestFile(file);
}

console.log('\nAll WasteShift tests passed');
