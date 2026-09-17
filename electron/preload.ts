import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, Progress } from '../src/shared/types';

const api: DesktopAPI = {
  reliability: () => ipcRenderer.invoke('reliability:state'),
  checkReliability: () => ipcRenderer.invoke('reliability:check'),
  startReliability: (input) => ipcRenderer.invoke('reliability:start', input),
  stopReliability: () => ipcRenderer.invoke('reliability:stop'),
  acknowledgeHealthAlert: (id) => ipcRenderer.invoke('reliability:ack', id),
  exportReliability: () => ipcRenderer.invoke('reliability:export'),
  onReliability: (callback) => {
    const handler = (_event: unknown, state: import('../src/shared/reliability').MonitorState) =>
      callback(state);
    ipcRenderer.on('reliability:progress', handler);
    return () => ipcRenderer.removeListener('reliability:progress', handler);
  },
  repairCases: () => ipcRenderer.invoke('repair:list'),
  createRepair: (input) => ipcRenderer.invoke('repair:create', input),
  updateRepair: (id, input) => ipcRenderer.invoke('repair:update', id, input),
  removeRepair: (id) => ipcRenderer.invoke('repair:remove', id),
  exportRepair: (id) => ipcRenderer.invoke('repair:export', id),
  investigations: () => ipcRenderer.invoke('cases:list'),
  createInvestigation: (input) => ipcRenderer.invoke('cases:create', input),
  removeInvestigation: (id) => ipcRenderer.invoke('cases:remove', id),
  startObservation: (input) => ipcRenderer.invoke('cases:start', input),
  stopObservation: () => ipcRenderer.invoke('cases:stop'),
  markObservation: () => ipcRenderer.invoke('cases:mark'),
  setObservationOutcome: (caseId, observationId, outcome) =>
    ipcRenderer.invoke('cases:outcome', caseId, observationId, outcome),
  exportInvestigation: (id) => ipcRenderer.invoke('cases:export', id),
  onObservation: (callback) => {
    const handler = (
      _event: unknown,
      value: import('../src/shared/investigations').InvestigationSnapshot,
    ) => callback(value);
    ipcRenderer.on('cases:progress', handler);
    return () => ipcRenderer.removeListener('cases:progress', handler);
  },
  bootstrap: () => ipcRenderer.invoke('health:bootstrap'),
  scan: () => ipcRenderer.invoke('health:scan'),
  cancel: () => ipcRenderer.invoke('health:cancel'),
  deleteHistory: () => ipcRenderer.invoke('health:delete-history'),
  exportReport: (id, format) => ipcRenderer.invoke('health:export', id, format),
  onProgress: (callback) => {
    const handler = (_event: unknown, value: Progress) => callback(value);
    ipcRenderer.on('health:progress', handler);
    return () => ipcRenderer.removeListener('health:progress', handler);
  },
};
contextBridge.exposeInMainWorld('pcHealth', api);
