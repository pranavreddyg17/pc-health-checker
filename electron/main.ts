import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  type IpcMainInvokeEvent,
  Menu,
  powerMonitor,
  Notification,
} from 'electron';
import path from 'node:path';
import { ReliabilityService } from './reliability/service';
import { ReliabilityStore } from './reliability/store';
import { collectIsolated } from './reliability/isolate';
import { RepairStore } from './repairs';
import { repairReport } from '../src/shared/repairs';
import { writeFile } from 'node:fs/promises';
import { scanComputer } from './scanner';
import { HistoryStore } from './history';
import { InvestigationService, InvestigationStore } from './investigations';
import { investigationReport } from '../src/shared/investigations';
import { htmlReport, redactedReport } from '../src/shared/report';
import type { Scan } from '../src/shared/types';

if (process.env.PCHEALTH_DATA_DIR)
  app.setPath('userData', path.resolve(process.env.PCHEALTH_DATA_DIR));
let window: BrowserWindow | null = null;
let controller: AbortController | null = null;
let current: Scan | undefined;
let history: HistoryStore;
let repairs: RepairStore;
let reliability: ReliabilityService;
let investigations: InvestigationService;
let recordingRequested = false;
// Avoid concurrent app instances racing on the same local history file.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore();
  window?.focus();
});
const devURL =
  !app.isPackaged && process.env.PCHEALTH_DEV_URL === 'http://127.0.0.1:5173'
    ? process.env.PCHEALTH_DEV_URL
    : undefined;
const ownsWindow = (event: IpcMainInvokeEvent) => {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error('Untrusted request.');
};
function installHandlers() {
  ipcMain.handle('reliability:state', (event) => {
    ownsWindow(event);
    return reliability.snapshot();
  });
  ipcMain.handle('reliability:check', (event) => {
    ownsWindow(event);
    return reliability.check();
  });
  ipcMain.handle('reliability:start', (event, input: unknown) => {
    ownsWindow(event);
    return reliability.start(input);
  });
  ipcMain.handle('reliability:stop', (event) => {
    ownsWindow(event);
    reliability.stop();
  });
  ipcMain.handle('reliability:ack', (event, id: unknown) => {
    ownsWindow(event);
    return reliability.acknowledge(id);
  });
  ipcMain.handle('reliability:export', async (event) => {
    ownsWindow(event);
    const data = await reliability.snapshot();
    if (!data.snapshots.length || data.collecting)
      throw new Error('Complete a reliability check first.');
    const result = await dialog.showSaveDialog(window!, {
      title: 'Export reliability evidence',
      defaultPath: 'PC-Health-Reliability.json',
      filters: [{ name: 'JSON evidence', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    // Stable local identities and counter epochs are omitted; labels and source evidence remain.
    const clean = data.snapshots.map(({ id, ...s }) => ({
      ...s,
      signals: s.signals.map(({ id, counter, ...v }) => ({
        ...v,
        counter: counter ? { value: counter.value } : undefined,
      })),
    }));
    await writeFile(
      result.filePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          snapshots: clean,
          alerts: data.alerts.map(({ id, signalId, ...a }) => a),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    return true;
  });
  ipcMain.handle('repair:list', (event) => {
    ownsWindow(event);
    return repairs.load();
  });
  ipcMain.handle('repair:create', async (event, input: unknown) => {
    ownsWindow(event);
    // An unrelated computer's case never inherits the host's hardware evidence.
    const local =
      input && typeof input === 'object' && 'target' in input && input.target === 'this-device';
    return repairs.create(input, local ? (await history.load())[0] : undefined);
  });
  ipcMain.handle('repair:update', async (event, id: unknown, input: unknown) => {
    ownsWindow(event);
    const attach =
      input && typeof input === 'object' && 'kind' in input && input.kind === 'attach-scan';
    return repairs.update(id, input, attach ? (await history.load())[0] : undefined);
  });
  ipcMain.handle('repair:remove', (event, id: unknown) => {
    ownsWindow(event);
    return repairs.remove(id);
  });
  ipcMain.handle('repair:export', async (event, id: unknown) => {
    ownsWindow(event);
    const repair = (await repairs.load()).find((c) => c.id === id);
    if (!repair) throw new Error('Repair case not found.');
    const result = await dialog.showSaveDialog(window!, {
      title: 'Export repair case',
      defaultPath: `PC-Health-Repair-${repair.createdAt.slice(0, 10)}.html`,
      filters: [{ name: 'Readable repair report', extensions: ['html'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, repairReport(repair), { mode: 0o600 });
    return true;
  });
  ipcMain.handle('cases:list', (event) => {
    ownsWindow(event);
    return investigations.snapshot();
  });
  ipcMain.handle('cases:create', (event, input: unknown) => {
    ownsWindow(event);
    return investigations.create(input);
  });
  ipcMain.handle('cases:remove', (event, id: unknown) => {
    ownsWindow(event);
    return investigations.remove(id);
  });
  ipcMain.handle('cases:start', async (event, input: unknown) => {
    ownsWindow(event);
    if (controller || recordingRequested || reliability.busy)
      throw new Error('Finish the current scan or recording first.');
    recordingRequested = true;
    try {
      const latest = (await history.load())[0];
      if (
        latest?.findings.some(
          (f) =>
            f.severity === 'urgent' &&
            latest.components.find((c) => c.id === f.componentId)?.kind === 'storage',
        )
      )
        throw new Error(
          'Protect your data and address the urgent storage finding before reproducing a slowdown. Run a new hardware scan after service.',
        );
      return await investigations.start(input);
    } finally {
      recordingRequested = false;
    }
  });
  ipcMain.handle('cases:stop', (event) => {
    ownsWindow(event);
    investigations.stop();
  });
  ipcMain.handle('cases:mark', (event) => {
    ownsWindow(event);
    investigations.mark();
  });
  ipcMain.handle(
    'cases:outcome',
    (event, caseId: unknown, observationId: unknown, outcome: unknown) => {
      ownsWindow(event);
      return investigations.outcome(caseId, observationId, outcome);
    },
  );
  ipcMain.handle('cases:export', async (event, id: unknown) => {
    ownsWindow(event);
    if (typeof id !== 'string' || investigations.busy)
      throw new Error('Finish recording before exporting.');
    const c = (await investigations.snapshot()).cases.find((c) => c.id === id);
    if (!c) throw new Error('Investigation not found');
    const result = await dialog.showSaveDialog(window!, {
      title: 'Export investigation',
      defaultPath: `PC-Health-Investigation-${c.createdAt.slice(0, 10)}.html`,
      filters: [{ name: 'Readable investigation report', extensions: ['html'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, investigationReport(c), { mode: 0o600 });
    return true;
  });
  ipcMain.handle('health:bootstrap', async (event) => {
    ownsWindow(event);
    try {
      return { platform: process.platform, version: app.getVersion(), scans: await history.load() };
    } catch (error) {
      return {
        platform: process.platform,
        version: app.getVersion(),
        scans: [],
        storageWarning: String((error as Error).message),
      };
    }
  });
  ipcMain.handle('health:scan', async (event) => {
    ownsWindow(event);
    if (controller || recordingRequested || investigations.busy || reliability.busy)
      throw new Error('Finish the current scan or recording first.');
    controller = new AbortController();
    try {
      current = await scanComputer(controller.signal, (progress) => {
        if (window && !window.isDestroyed()) window.webContents.send('health:progress', progress);
      });
      try {
        await history.save(current);
        return { scan: current };
      } catch (error) {
        return { scan: current, storageWarning: (error as Error).message };
      }
    } finally {
      controller = null;
    }
  });
  ipcMain.handle('health:cancel', (event) => {
    ownsWindow(event);
    controller?.abort();
  });
  ipcMain.handle('health:delete-history', async (event) => {
    ownsWindow(event);
    if (controller) throw new Error('Finish or cancel the scan before deleting history.');
    await history.clear();
    current = undefined;
  });
  ipcMain.handle('health:export', async (event, id: unknown, format: unknown) => {
    ownsWindow(event);
    if (typeof id !== 'string' || !['html', 'json'].includes(String(format)))
      throw new Error('Invalid report request.');
    const scan = current?.id === id ? current : (await history.load()).find((s) => s.id === id);
    if (!scan) throw new Error('This scan was not found.');
    const result = await dialog.showSaveDialog(window!, {
      title: 'Export PC Health report',
      defaultPath: `PC-Health-${scan.completedAt.slice(0, 10)}.${format}`,
      filters: [
        {
          name: format === 'html' ? 'Readable report' : 'JSON report',
          extensions: [String(format)],
        },
      ],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(
      result.filePath,
      format === 'html' ? htmlReport(scan) : JSON.stringify(redactedReport(scan), null, 2),
      { mode: 0o600 },
    );
    return true;
  });
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 700,
    title: 'PC Health',
    backgroundColor: '#090b10',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', () => {
    investigations.stop('interrupted');
    reliability.stop();
  });
  window.on('closed', () => {
    reliability.stop();
    investigations.stop('interrupted');
    controller?.abort();
    window = null;
  });
  window.once('ready-to-show', () => window?.show());
  if (devURL) await window.loadURL(devURL);
  else await window.loadFile(path.join(__dirname, '../dist/index.html'));
}
app.whenReady().then(async () => {
  history = new HistoryStore(path.join(app.getPath('userData'), 'history'));
  repairs = new RepairStore(path.join(app.getPath('userData'), 'history'));
  investigations = new InvestigationService(
    new InvestigationStore(path.join(app.getPath('userData'), 'history')),
    (snapshot) => {
      if (window && !window.isDestroyed()) window.webContents.send('cases:progress', snapshot);
    },
  );
  reliability = new ReliabilityService(
    new ReliabilityStore(path.join(app.getPath('userData'), 'history')),
    (signal) => collectIsolated(path.join(__dirname, 'reliability/worker.cjs'), signal),
    (state) => {
      if (window && !window.isDestroyed()) window.webContents.send('reliability:progress', state);
    },
    (alerts) => {
      if (Notification.isSupported()) {
        const severe = alerts.find((a) => a.level === 'critical') ?? alerts[0];
        const notification = new Notification({
          title: `PC Health: ${alerts.length} reliability alert${alerts.length === 1 ? '' : 's'}`,
          body: severe.title,
          silent: true,
        });
        notification.on('click', () => {
          window?.show();
          window?.focus();
        });
        notification.show();
      }
    },
    () => Boolean(controller || recordingRequested || investigations.busy),
    Notification.isSupported(),
  );
  powerMonitor.on('suspend', () => {
    investigations.stop('suspended');
    reliability.pauseForSuspend();
  });
  powerMonitor.on('resume', () => reliability.resume());
  // Static display checks may use user-initiated fullscreen in our own main frame.
  // Automatic fullscreen, keyboard lock, device access and all other permissions stay denied.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(
      Boolean(
        window &&
        contents === window.webContents &&
        permission === 'fullscreen' &&
        details.isMainFrame &&
        details.requestingUrl === contents.getURL(),
      ),
    ),
  );
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    Boolean(
      window &&
      contents === window.webContents &&
      permission === 'fullscreen' &&
      details.isMainFrame &&
      details.requestingUrl === contents.getURL(),
    ),
  );
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const localDev =
      devURL &&
      (details.url.startsWith(`${devURL}/`) || details.url.startsWith('ws://127.0.0.1:5173/'));
    callback({
      cancel:
        !localDev && !details.url.startsWith('file://') && !details.url.startsWith('devtools://'),
    });
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: 'PC Health',
              submenu: [
                { role: 'about' as const },
                { type: 'separator' as const },
                { role: 'quit' as const },
              ],
            },
          ]
        : []),
      { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'selectAll' }] },
      {
        label: 'View',
        submenu: [
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'toggleDevTools' },
        ],
      },
    ]),
  );
  installHandlers();
  await createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) void createWindow();
  });
});
app.on('window-all-closed', () => {
  controller?.abort();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  reliability?.stop();
  controller?.abort();
  investigations?.stop('interrupted');
});
