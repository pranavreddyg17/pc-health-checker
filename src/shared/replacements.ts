import type { Component, Finding, Product } from './types';
import { candidates } from './catalog';

export interface ReplacementAssessment {
  route: 'service' | 'investigate' | 'plan' | 'no-evidence';
  title: string;
  explanation: string;
  nextSteps: string[];
  candidates: Product[];
  evidence: string[];
}

export function assessReplacement(
  component: Component,
  findings: Finding[],
): ReplacementAssessment {
  const relevant = findings.filter((finding) => finding.componentId === component.id);
  const evidence = relevant.flatMap((finding) => finding.evidence);
  if (component.serviceability === 'integrated') {
    return {
      route: 'service',
      title: 'Check the model’s service options',
      explanation:
        'This component may be integrated or use a proprietary service assembly. A standard retail part is not a verified fit.',
      nextSteps: [
        relevant.length
          ? relevant[0].action
          : 'The completed checks do not currently establish a replacement need.',
        'Identify the exact computer model and component assembly in its OEM service documentation.',
        component.kind === 'storage'
          ? 'Back up important data before arranging any storage service.'
          : 'Use the model-specific service procedure; a part number must match the exact model.',
      ],
      candidates: [],
      evidence,
    };
  }
  if (component.kind !== 'storage') {
    return {
      route: relevant.length ? 'investigate' : 'no-evidence',
      title: relevant.length
        ? 'Isolate the cause before choosing a part'
        : 'No replacement need established',
      explanation:
        'This catalog does not contain verified parts for this component. Inventory or a generic system error cannot establish which replaceable part is faulty.',
      nextSteps: [
        relevant.length
          ? relevant[0].action
          : 'If you have symptoms, run the relevant guided diagnostic first.',
        'Confirm the exact component and model-specific service or compatibility requirements.',
      ],
      candidates: [],
      evidence,
    };
  }
  const directDriveEvidence = relevant.some(
    (finding) =>
      ['nvme-endurance-v1', 'smart-failure-v1'].includes(finding.rule) ||
      (finding.rule === 'nvme-warning-v1' && finding.severity === 'urgent'),
  );
  const urgent = relevant.some((finding) => finding.severity === 'urgent');
  return {
    route: directDriveEvidence ? 'plan' : relevant.length ? 'investigate' : 'no-evidence',
    title: urgent
      ? 'Protect your data before choosing a drive'
      : directDriveEvidence
        ? 'Review replacement options with the evidence in hand'
        : relevant.length
          ? 'Investigate the storage problem first'
          : 'No replacement need established',
    explanation: relevant.length
      ? 'The current findings guide urgency. Products below are interface-based candidates, not a complete compatibility verdict.'
      : 'The completed checks do not establish a need to replace this drive. Candidates are shown for reference if you are independently planning an upgrade.',
    nextSteps: [
      urgent
        ? 'Back up important data now; avoid intensive storage tests.'
        : 'Keep a current backup and distinguish a repair need from a performance upgrade.',
      'Confirm that the exact computer has a replaceable drive and the required slot or bay.',
      'Check every fit requirement against the OEM manual before purchase.',
    ],
    candidates: candidates(component),
    evidence,
  };
}
