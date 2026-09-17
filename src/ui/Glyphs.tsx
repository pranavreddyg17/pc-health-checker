import type { SVGProps } from 'react';
type GlyphProps = SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number };
function glyph(paths: string[], name: string) {
  const Icon = ({ size = 24, strokeWidth = 1.5, ...props }: GlyphProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths.map((d, i) => (
        <path d={d} key={i} />
      ))}
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}
// Original, square-ended glyphs share a 24-unit grid. Utility shapes retain familiar meanings.
export const Activity = glyph(['M2 13h5l3-8 4 15 3-7h5'], 'Activity');
export const ArrowRight = glyph(['M3 12h17M14 6l6 6-6 6'], 'ArrowRight');
export const ArrowLeft = glyph(['M21 12H4m6-6-6 6 6 6'], 'ArrowLeft');
export const ArrowDownToLine = glyph(['M12 2v13m-5-5 5 5 5-5M4 17v4h16v-4'], 'ArrowDownToLine');
export const ChevronRight = glyph(['m9 4 8 8-8 8'], 'ChevronRight');
export const Plus = glyph(['M12 4v16M4 12h16'], 'Plus');
export const X = glyph(['m5 5 14 14M5 19 19 5'], 'X');
export const Check = glyph(['m4 12 5 5L20 6'], 'Check');
export const CheckCheck = glyph(['m2 12 5 5L18 6m-6 11L23 6'], 'CheckCheck');
export const Square = glyph(['M5 5h14v14H5z'], 'Square');
export const Play = glyph(['m7 3 14 9-14 9z'], 'Play');
export const LayoutDashboard = glyph(
  ['M3 3h8v8H3zM15 3h6v5h-6zM3 15h8v6H3zM15 12h6v9h-6z'],
  'LayoutDashboard',
);
export const Cpu = glyph(
  [
    'M6 6h12v12H6zM9 9h6v6H9zM8 2v4m4-4v4m4-4v4M8 18v4m4-4v4m4-4v4M2 8h4m-4 4h4m-4 4h4M18 8h4m-4 4h4m-4 4h4',
  ],
  'Cpu',
);
export const MemoryStick = glyph(
  ['M2 6h20v12H2zM5 9h4v5H5zm7 0h4v5h-4zm7 0v5M5 18v3m4-3v3m4-3v3m4-3v3m4-3v3'],
  'MemoryStick',
);
export const HardDrive = glyph(
  ['M5 3h11l4 4v14H4V4zM7 15h10M7 18h2m3 0h5M8 6h6v5H8z'],
  'HardDrive',
);
export const BatteryMedium = glyph(
  ['M2 6h18v12H2zM20 10h2v4h-2M5 9v6m4-6v6m4-6v6'],
  'BatteryMedium',
);
export const Monitor = glyph(['M2 3h20v14H2zM6 21h12m-9-4v4m6-4v4M5 6h6'], 'Monitor');
export const Fan = glyph(
  [
    'm12 2 4 2-2 5-2 3-4-5 1-4zm10 10-2 4-5-2-3-2 5-4 4 1zM12 22l-4-2 2-5 2-3 4 5-1 4zM2 12l2-4 5 2 3 2-5 4-4-1z',
  ],
  'Fan',
);
export const Keyboard = glyph(
  ['M2 5h20v15H2zM5 9h1m3 0h1m3 0h1m3 0h2M5 13h1m3 0h1m3 0h1m3 0h2M6 17h12'],
  'Keyboard',
);
export const Layers3 = glyph(['m12 2 10 5-10 5L2 7zm-9 10 9 5 9-5M3 17l9 5 9-5'], 'Layers3');
export const ShieldCheck = glyph(['M12 2 3 5v9l9 8 9-8V5z', 'm7 11 4 4 6-7'], 'ShieldCheck');
export const Wrench = glyph(['m14 3-3 4v5L3 20l2 2 9-9h5l3-4-5 1-3-3z'], 'Wrench');
export const ScanLine = glyph(
  ['M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M1 12h22M8 7h8v10H8'],
  'ScanLine',
);
export const TriangleAlert = glyph(['M12 2 1 21h22zM12 8v6m0 3v1'], 'TriangleAlert');
export const CircleHelp = glyph(
  ['M7 2h10l5 5v10l-5 5H7l-5-5V7zM8 8l2-2h4l2 2v2l-4 3v1m0 3v1'],
  'CircleHelp',
);
export const Clock3 = glyph(['M7 2h10l5 5v10l-5 5H7l-5-5V7zM12 6v7h5'], 'Clock3');
export const History = glyph(['M3 3v6h6M3 9l4-5h10l4 4v9l-4 4H7l-3-3M12 7v6h5'], 'History');
export const RotateCcw = History;
export const Database = glyph(['m3 5 9-3 9 3-9 3zm0 0v14l9 3 9-3V5M3 12l9 3 9-3'], 'Database');
export const LockKeyhole = glyph(['M4 10h16v12H4zM7 10V4l3-2h4l3 2v6M12 14v4'], 'LockKeyhole');
export const PackageCheck = glyph(
  ['m2 6 10-4 10 4v13l-10 3-10-3zm0 0 10 4 10-4M12 10v12M7 4l10 4', 'm6 14 3 3 4-5'],
  'PackageCheck',
);
export const Settings2 = glyph(
  ['M2 6h5m6 0h9M7 3h6v6H7zM2 18h11m6 0h3M13 15h6v6h-6z'],
  'Settings2',
);
export const Bell = glyph(['M5 17V7l4-4h6l4 4v10l2 2H3zm4 4h6M12 1v2'], 'Bell');
export const ClipboardList = glyph(
  ['M8 3H4v19h16V3h-4M8 1h8v5H8zM8 10h8m-8 4h8m-8 4h5'],
  'ClipboardList',
);
export const Flag = glyph(['M4 22V2h15l-3 5 3 5H4'], 'Flag');
export const FolderOpen = glyph(['M2 18V4h7l3 3h9v4M2 18l3-7h18l-4 9H2z'], 'FolderOpen');
export const Maximize2 = glyph(['M14 2h8v8M22 2l-8 8M2 14v8h8M2 22l8-8'], 'Maximize2');
export const Trash2 = glyph(['M3 5h18M8 5V2h8v3M5 5l1 17h12l1-17M10 9v9m4-9v9'], 'Trash2');
