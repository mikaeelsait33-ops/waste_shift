import { createLargeDataset } from './large-dataset-fixtures.mjs';

const target = String(process.env.WASTESHIFT_STRESS_TARGET || '').trim().replace(/\/$/, '');
const concurrency = Math.max(1, Math.min(50, Number(process.env.WASTESHIFT_STRESS_CONCURRENCY || 10)));
const requestsPerUser = Math.max(1, Math.min(100, Number(process.env.WASTESHIFT_STRESS_REQUESTS || 10)));
const allowedTargetPattern = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|.*staging.*|.*preview.*)(:\d+)?($|\/)/i;

const dataset = createLargeDataset();
console.log(JSON.stringify({
  mode: target ? 'http' : 'dry-run',
  generated: {
    wasteEntries1000: dataset.wasteItems1000.length,
    wasteEntries5000: dataset.wasteItems5000.length,
    menuItems: dataset.menuItems.length,
    ingredients: dataset.ingredients.length,
    staff: dataset.staff.length,
    inventoryMovements: dataset.inventoryMovements.length,
    invoices: dataset.invoices.length,
  },
}, null, 2));

if (!target) {
  console.log('Dry run only. Set WASTESHIFT_STRESS_TARGET to a local or staging URL to run HTTP stress checks.');
  process.exit(0);
}

if (!allowedTargetPattern.test(target)) {
  console.error('Refusing to stress test this target. Use localhost, 127.0.0.1, or a staging/preview URL.');
  process.exit(1);
}

const urls = [
  '/',
  '/api/database',
];

const runRequest = async (url) => {
  const startedAt = performance.now();
  const response = await fetch(`${target}${url}`, {
    method: 'GET',
    headers: {
      'cache-control': 'no-store',
    },
  });
  const elapsedMs = performance.now() - startedAt;
  await response.arrayBuffer().catch(() => null);

  return {
    url,
    status: response.status,
    ok: response.status < 500,
    elapsedMs,
  };
};

const workers = Array.from({ length: concurrency }, async (_, workerIndex) => {
  const results = [];

  for (let index = 0; index < requestsPerUser; index += 1) {
    const url = urls[(workerIndex + index) % urls.length];
    results.push(await runRequest(url).catch((error) => ({
      url,
      status: 0,
      ok: false,
      elapsedMs: 0,
      error: error?.message || 'Request failed',
    })));
  }

  return results;
});

const results = (await Promise.all(workers)).flat();
const failures = results.filter((result) => !result.ok);
const sortedDurations = results.map((result) => result.elapsedMs).sort((a, b) => a - b);
const percentile = (pct) => sortedDurations[Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * pct))] || 0;

const summary = {
  target,
  concurrency,
  requests: results.length,
  failures: failures.length,
  errorRate: results.length > 0 ? failures.length / results.length : 1,
  p50Ms: Math.round(percentile(0.5)),
  p95Ms: Math.round(percentile(0.95)),
  maxMs: Math.round(sortedDurations.at(-1) || 0),
};

console.log(JSON.stringify(summary, null, 2));

if (summary.errorRate > 0.05 || summary.p95Ms > 3000) {
  console.error('Stress thresholds failed: error rate must be <= 5% and p95 <= 3000ms.');
  process.exit(1);
}
