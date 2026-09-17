import { telemetryCoverage } from '../../src/shared/reliability';
import {
  enrichTrends,
  alertChanges,
  type HealthAlert,
  type HealthSnapshot,
  type MonitorState,
  type ReliabilityData,
} from '../../src/shared/reliability';
import { ReliabilityStore } from './store';
export class ReliabilityService {
  private data: ReliabilityData = { schemaVersion: 1, snapshots: [], alerts: [] };
  private initialized = false;
  private initialization?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private running = false;
  private intervalSeconds = 300;
  private notifications = false;
  private nextAt?: string;
  private warning?: string;
  private failures = 0;
  private mutation = false;
  private suspended = false;
  constructor(
    private store: ReliabilityStore,
    private collect: (signal: AbortSignal) => Promise<HealthSnapshot>,
    private emit: (state: MonitorState) => void = () => {},
    private notify: (alerts: HealthAlert[]) => void = () => {},
    private blocked: () => boolean = () => false,
    private notificationSupport = false,
  ) {}
  private async init() {
    if (!this.initialization)
      this.initialization = this.store
        .load()
        .then((data) => {
          this.data = data;
          this.initialized = true;
        })
        .catch((e) => {
          this.warning = e.message;
        });
    await this.initialization;
  }
  async snapshot(): Promise<MonitorState> {
    await this.init();
    return this.state();
  }
  private state(): MonitorState {
    return {
      ...this.data,
      running: this.running,
      collecting: Boolean(this.controller),
      intervalSeconds: this.intervalSeconds,
      nextAt: this.nextAt,
      notifications: this.notifications,
      notificationSupport: this.notificationSupport,
      warning: this.warning,
    };
  }
  private publish() {
    this.emit(this.state());
  }
  get busy() {
    return Boolean(this.controller);
  }
  async start(input: unknown) {
    await this.init();
    const v = input as any;
    if (!this.initialized) throw Error(this.warning);
    if (!v || ![60, 300, 900].includes(v.intervalSeconds) || typeof v.notifications !== 'boolean')
      throw Error('Choose a supported interval and notification setting.');
    this.suspended = false;
    this.intervalSeconds = v.intervalSeconds;
    this.notifications = v.notifications;
    this.running = true;
    this.failures = 0;
    this.warning = undefined;
    clearTimeout(this.timer);
    this.schedule(0);
    this.publish();
    return this.state();
  }
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.nextAt = undefined;
    this.controller?.abort();
    this.publish();
  }
  pauseForSuspend() {
    this.suspended = true;
    this.controller?.abort();
    if (this.running) {
      clearTimeout(this.timer);
      this.nextAt = undefined;
      this.controller?.abort();
      this.warning =
        'System suspended. Collection resumes after wake while monitoring remains enabled.';
      this.publish();
    }
  }
  resume() {
    this.suspended = false;
    if (this.running) {
      this.warning = undefined;
      this.schedule(this.intervalSeconds * 1000);
      this.publish();
    }
  }
  private schedule(delay: number) {
    clearTimeout(this.timer);
    if (!this.running || this.suspended) return;
    this.nextAt = new Date(Date.now() + delay).toISOString();
    this.timer = setTimeout(() => {
      void this.check(true).catch(() => {
        // An acknowledgment or manual check can briefly hold the operation lock.
        if (this.running) {
          this.schedule(this.intervalSeconds * 1000);
          this.publish();
        }
      });
    }, delay);
  }
  async check(automatic = false): Promise<MonitorState> {
    await this.init();
    if (!this.initialized) throw Error(this.warning);
    if (this.controller || this.mutation)
      throw Error('A reliability operation is already running.');
    if (automatic && (!this.running || this.suspended)) return this.state();
    if (this.blocked()) {
      if (automatic) {
        this.warning = 'Waiting for the current hardware scan or performance recording.';
        this.schedule(this.intervalSeconds * 1000);
        this.publish();
        return this.state();
      }
      throw Error('Finish the hardware scan or performance recording first.');
    }
    this.controller = new AbortController();
    const controller = this.controller;
    this.nextAt = undefined;
    this.publish();
    try {
      let sample = await this.collect(controller.signal);
      if (controller.signal.aborted) return this.state();
      const previous = this.data.snapshots[0];
      // A disappeared source is an explicit coverage gap, never a silent recovery.
      const missing = (previous?.platform === sample.platform ? previous.signals : [])
        .filter(
          (s) =>
            !sample.signals.some((c) => c.id === s.id) &&
            (telemetryCoverage([s]).readable === 1 ||
              s.scope === 'Previously observed source (currently unavailable)'),
        )
        .slice(0, Math.max(0, 768 - sample.signals.length))
        .map((s) => ({
          ...s,
          availability: 'error' as const,
          level: 'unknown' as const,
          scope: 'Previously observed source (currently unavailable)',
          observedAt: sample.at,
          summary:
            'A previously readable source was not returned. Device removal, access changes or collection failure may explain the gap.',
          measurements: [],
          counter: undefined,
          trend: undefined,
        }));
      sample = enrichTrends({ ...sample, signals: [...sample.signals, ...missing] }, previous);
      const changes = alertChanges(sample, previous, this.data.alerts);
      const next: ReliabilityData = {
        schemaVersion: 1,
        snapshots: [sample, ...this.data.snapshots].slice(0, 120),
        alerts: changes.alerts,
      };
      await this.store.save(next);
      this.data = next;
      this.failures = 0;
      this.warning = undefined;
      if (automatic && this.running && this.notifications && changes.notify.length)
        this.notify(changes.notify);
    } catch (e) {
      if (!controller.signal.aborted) {
        this.failures++;
        this.warning = (e as Error).message;
        if (this.failures >= 3 || !this.initialized) {
          this.running = false;
          this.warning += ' Monitoring stopped after repeated collection/storage failures.';
        }
      }
    } finally {
      this.controller = undefined;
      if (this.running) this.schedule(this.intervalSeconds * 1000);
      this.publish();
    }
    return this.state();
  }
  async acknowledge(id: unknown) {
    await this.init();
    if (this.controller || this.mutation) throw Error('Wait for the current operation.');
    if (typeof id !== 'string' || !this.data.alerts.some((a) => a.id === id))
      throw Error('Alert not found.');
    this.mutation = true;
    try {
      const next = {
        ...this.data,
        alerts: this.data.alerts.map((a) =>
          a.id === id ? { ...a, acknowledgedAt: new Date().toISOString() } : a,
        ),
      };
      await this.store.save(next);
      this.data = next;
      this.publish();
      return this.state();
    } finally {
      this.mutation = false;
    }
  }
}
