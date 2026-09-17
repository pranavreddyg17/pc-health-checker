import { scanComputer } from '../electron/scanner';
import { coverage } from '../src/shared/diagnostics';
import { isScan } from '../electron/history';

const scan = await scanComputer(new AbortController().signal, (progress) =>
  process.stdout.write(`${progress.stage}\n`),
);
if (!isScan(scan)) throw new Error('Collector returned an invalid report.');
console.log(
  JSON.stringify(
    {
      platform: scan.platform,
      state: scan.state,
      coverage: coverage(scan.components),
      components: scan.components.map((c) => ({
        kind: c.kind,
        metrics: c.metrics.map((m) => m.key),
        checks: c.checks.map((k) => ({ check: k.id, status: k.status })),
      })),
      findingRules: scan.findings.map((f) => f.rule),
    },
    null,
    2,
  ),
);
