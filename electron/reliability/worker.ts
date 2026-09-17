import { probeHealth } from './probe';
const controller = new AbortController();
process.on('message', (value) => {
  if (value === 'cancel') controller.abort();
});
process.once('SIGTERM', () => controller.abort());
void probeHealth(AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]))
  .then((snapshot) => {
    if (controller.signal.aborted) {
      process.exit(1);
      return;
    }
    if (process.send) process.send(snapshot, () => process.exit(0));
    else {
      process.stdout.write(JSON.stringify(snapshot) + '\n');
      process.exit(0);
    }
  })
  .catch(() => process.exit(1));
