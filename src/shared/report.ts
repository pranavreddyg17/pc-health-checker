import type { Scan } from './types';
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function htmlReport(scan: Scan): string {
  return `<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>PC Health report</title><style>body{font:15px/1.6 system-ui;max-width:900px;margin:50px auto;padding:0 24px;color:#23382f}h1,h2{line-height:1.2}section{border-top:1px solid #ddd;padding:20px 0}small{color:#58655e}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #eee}article{background:#f4f6f2;padding:16px;margin:12px 0} @media print{body{margin:0}article{break-inside:avoid}}</style><h1>PC Health</h1><p>${escape(scan.machine)} · ${escape(scan.platform)} ${escape(scan.arch)} · ${escape(new Date(scan.completedAt).toLocaleString())}</p><p>Manual, offline scan · ${scan.state === 'cancelled' ? 'Stopped; partial results' : 'Completed'} · App ${escape(scan.appVersion)} / Rules ${escape(scan.ruleVersion)}</p><small>No issues found by a check does not guarantee hardware health. Unavailable and unperformed checks are listed below. Identifiers are omitted from this report.</small><section><h2>Findings</h2>${scan.findings.length ? scan.findings.map((f) => `<article><strong>${escape(f.title)} · ${escape(f.severity)}</strong><p>${escape(f.explanation)}</p><p><b>Next step:</b> ${escape(f.action)}</p><p>${f.evidence.map(escape).join(' · ')}</p><small>${escape(f.limitation)}</small></article>`).join('') : '<p>No actionable findings in the completed checks.</p>'}</section>${scan.components.map((c) => `<section><h2>${escape(c.name)}</h2><p>${escape(c.subtitle)}</p><table><tr><th>Measurement</th><th>Value</th><th>Source</th></tr>${c.metrics.map((m) => `<tr><td>${escape(m.label)}</td><td>${escape(m.value)}${escape(m.unit ?? '')}</td><td>${escape(m.source)}</td></tr>`).join('')}</table>${c.checks.map((k) => `<p><b>${escape(k.label)} · ${escape(k.status)}</b><br>${escape(k.detail)}</p>`).join('')}</section>`).join('')}</html>`;
}
export function redactedReport(scan: Scan): object {
  const map = new Map(scan.components.map((c, i) => [c.id, `component-${i + 1}`]));
  return {
    ...scan,
    id: 'exported-scan',
    components: scan.components.map((c) => ({ ...c, id: map.get(c.id), identity: undefined })),
    findings: scan.findings.map((f, i) => ({
      ...f,
      id: `finding-${i + 1}`,
      componentId: map.get(f.componentId),
    })),
  };
}
