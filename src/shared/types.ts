import type {
  CaseInput,
  ObservationInput,
  InvestigationSnapshot,
  Observation,
} from './investigations';
export type Platform = 'darwin' | 'win32' | 'linux';
export type ComponentKind = 'storage' | 'battery' | 'cpu' | 'memory' | 'gpu' | 'cooling' | 'system';
export type Availability = 'available' | 'unsupported' | 'permission' | 'error' | 'not-run';
export type Severity = 'info' | 'attention' | 'urgent';
export interface Check {
  id: string;
  label: string;
  status: Availability;
  detail: string;
  source: string;
}
export interface Metric {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  source: string;
}
export interface Component {
  id: string;
  identity: 'stable' | 'session';
  kind: ComponentKind;
  name: string;
  subtitle: string;
  metrics: Metric[];
  checks: Check[];
  serviceability: 'unknown' | 'integrated' | 'replaceable';
}
export interface Finding {
  id: string;
  componentId: string;
  title: string;
  severity: Severity;
  category: 'wear' | 'fault' | 'condition';
  explanation: string;
  action: string;
  evidence: string[];
  limitation: string;
  rule: string;
}
export interface Scan {
  schemaVersion: 1;
  id: string;
  startedAt: string;
  completedAt: string;
  platform: Platform;
  arch: string;
  osVersion: string;
  machine: string;
  appVersion: string;
  ruleVersion: string;
  state: 'complete' | 'cancelled';
  components: Component[];
  findings: Finding[];
}
export interface Progress {
  stage: string;
  completed: number;
  total: number;
}
export interface Bootstrap {
  platform: string;
  version: string;
  scans: Scan[];
  storageWarning?: string;
}
export interface Product {
  id: string;
  name: string;
  partNumber: string;
  kind: 'storage';
  protocol: 'SATA' | 'NVMe';
  formFactor: string;
  capacity: string;
  description: string;
  source: string;
  verifiedAt: string;
  constraints: string[];
}
export interface DesktopAPI {
  recoveryCases(): Promise<import('./recovery').RecoveryCase[]>;
  createRecovery(): Promise<import('./recovery').RecoveryCase[]>;
  recordRecoveryAction(id: string, note: string): Promise<import('./recovery').RecoveryCase[]>;
  removeRecovery(id: string): Promise<import('./recovery').RecoveryCase[]>;
  reliability(): Promise<import('./reliability').MonitorState>;
  checkReliability(): Promise<import('./reliability').MonitorState>;
  startReliability(input: {
    intervalSeconds: number;
    notifications: boolean;
  }): Promise<import('./reliability').MonitorState>;
  stopReliability(): Promise<void>;
  acknowledgeHealthAlert(id: string): Promise<import('./reliability').MonitorState>;
  exportReliability(): Promise<boolean>;
  onReliability(callback: (value: import('./reliability').MonitorState) => void): () => void;
  repairCases(): Promise<import('./repairs').RepairCase[]>;
  createRepair(input: import('./repairs').NewRepair): Promise<import('./repairs').RepairCase[]>;
  updateRepair(
    id: string,
    input: import('./repairs').RepairCommand,
  ): Promise<import('./repairs').RepairCase[]>;
  removeRepair(id: string): Promise<import('./repairs').RepairCase[]>;
  exportRepair(id: string): Promise<boolean>;
  investigations(): Promise<InvestigationSnapshot>;
  createInvestigation(input: CaseInput): Promise<InvestigationSnapshot>;
  removeInvestigation(id: string): Promise<InvestigationSnapshot>;
  startObservation(input: ObservationInput): Promise<InvestigationSnapshot>;
  stopObservation(): Promise<void>;
  markObservation(): Promise<void>;
  setObservationOutcome(
    caseId: string,
    observationId: string,
    outcome: Observation['outcome'],
  ): Promise<InvestigationSnapshot>;
  exportInvestigation(id: string): Promise<boolean>;
  onObservation(callback: (value: InvestigationSnapshot) => void): () => void;
  bootstrap(): Promise<Bootstrap>;
  scan(): Promise<{ scan: Scan; storageWarning?: string }>;
  cancel(): Promise<void>;
  deleteHistory(): Promise<void>;
  exportReport(id: string, format: 'json' | 'html'): Promise<boolean>;
  onProgress(callback: (progress: Progress) => void): () => void;
}
declare global {
  interface Window {
    pcHealth?: DesktopAPI;
  }
}
