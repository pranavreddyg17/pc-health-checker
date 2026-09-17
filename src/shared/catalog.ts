import type { Component, Product } from './types';

export const CATALOG_VERSION = '2026.09.14';
export const products: Product[] = [
  {
    id: 'samsung-870-evo-1tb',
    name: 'Samsung 870 EVO',
    partNumber: 'MZ-77E1T0B/AM',
    kind: 'storage',
    protocol: 'SATA',
    formFactor: '2.5-inch',
    capacity: '1 TB',
    description: 'A SATA solid-state drive for systems with a serviceable 2.5-inch storage bay.',
    source: 'https://www.samsung.com/us/business/support/owners/product/870-evo-series-1tb/',
    verifiedAt: '2026-09-14',
    constraints: [
      'An OEM-approved, replaceable 2.5-inch SATA bay',
      'SATA data and power connections',
      'At least 7 mm drive-height clearance and the correct mounting hardware',
      'OEM/firmware support for a 1 TB SATA drive',
      'A backup and migration/reinstallation plan',
    ],
  },
  {
    id: 'samsung-990-pro-1tb',
    name: 'Samsung 990 PRO',
    partNumber: 'MZ-V9P1T0B/AM',
    kind: 'storage',
    protocol: 'NVMe',
    formFactor: 'M.2 2280',
    capacity: '1 TB',
    description: 'A PCIe 4.0 NVMe drive. M.2 shape alone does not establish compatibility.',
    source:
      'https://download.semiconductor.samsung.com/resources/data-sheet/Samsung_NVMe_SSD_990_PRO_Datasheet_Rev.1.0_10129514051890.pdf',
    verifiedAt: '2026-09-14',
    constraints: [
      'An OEM-approved, replaceable M-key M.2 2280 NVMe slot',
      'PCIe/NVMe support rather than an M.2 SATA-only slot',
      'OEM/firmware support for this drive and 1 TB capacity',
      'Adequate clearance, mounting screw, thermal solution, and power support',
      'A backup and migration/reinstallation plan',
    ],
  },
];

export function candidates(component?: Component): Product[] {
  if (!component || component.kind !== 'storage' || component.serviceability === 'integrated')
    return [];
  const protocol = String(component.metrics.find((m) => m.key === 'protocol')?.value ?? '')
    .trim()
    .toLowerCase();
  return products.filter((p) => protocol === p.protocol.toLowerCase());
}

// Protocol matches are candidates, never a complete OEM compatibility verdict.
export function compatibilityLabel(component?: Component): string {
  return component?.serviceability === 'integrated'
    ? 'OEM service required'
    : 'Compatibility not yet verified';
}
