# PC Health console interface

Version 0.6 replaces the sidebar dashboard with a hardware console. The visual reference is [Vladimír Vilimovský’s Cyberpunk 2077 UI study](https://www.behance.net/gallery/133185623/Cyberpunk-2077User-Interface-%28Part-2%29). The implementation uses original code-drawn artwork and glyphs; it contains no extracted game assets or logos.

## Visual language

| Role                         | Token       | Color     |
| ---------------------------- | ----------- | --------- |
| Canvas                       | `--bg`      | `#090b10` |
| Panel                        | `--surface` | `#121117` |
| Interface frames             | `--chrome`  | `#ff6474` |
| Readings and evidence links  | `--cyan`    | `#79e4df` |
| Primary action and attention | `--amber`   | `#f3e65a` |
| Main text                    | `--text`    | `#f6e7e7` |
| Supporting text              | `--muted`   | `#c2aeb3` |

Coral is interface chrome. It does not alone mean a fault: warning and urgent states have explicit text and symbols as well as color. Unknown and untested states stay distinct from completed checks. The overview’s counts describe scan coverage, not a fabricated health score.

Rajdhani provides the condensed interface typography. Uppercase is reserved for headings, tabs and short actions; explanatory text remains sentence case. IBM Plex Mono distinguishes measurements, timestamps, sources and compact metadata. No font or asset requests leave the device.

Frames are square, with occasional clipped corners and short edge markers. Original SVG icons use a 24-unit grid, square stroke caps and miter joins. The overview’s board illustration is decorative, not a rendering of the detected motherboard. Status indicators show actual app state. There is no simulated terminal output, random quotation, looping ambient animation or invented activity.

## Navigation and interaction

- **Overview:** host, scan coverage, hardware inventory, findings and next workflows.
- **Reliability:** opt-in monitoring, observations and alerts.
- **Diagnostics:** repair workbench, performance capture and diagnostic tools.
- **Hardware:** components and replacement guide.
- **Records:** scan history. Settings remains a separate labeled icon control.

Contextual navigation shows the tools within each section. Active tabs use an underline and fill as well as color. Buttons, tabs and links retain native keyboard behavior, visible focus outlines and accessible names. Existing dialogs trap focus and make the background inert. Scroll margins account for the sticky navigation and bottom status bar. Layout adapts to the desktop’s 980 × 700 minimum window and smaller browser previews; dense evidence screens can scroll vertically.

## Implementation and licenses

- `src/ConsoleShell.tsx`: primary and secondary navigation, local status rail.
- `src/SystemOverview.tsx`: host profile, component bay and diagnostic queue.
- `src/ui/Glyphs.tsx`: original shared icon set.
- `src/console.css`: console layout and common visual controls; `src/styles.css` retains workflow layouts and base tokens.
- `scripts/make-icon.swift`: original application icon generator.
- [Rajdhani](https://fontsource.org/fonts/rajdhani): Indian Type Foundry, SIL Open Font License 1.1; bundled license in `public/licenses/rajdhani-OFL.txt`.
- [IBM Plex Mono](https://fontsource.org/fonts/ibm-plex-mono): IBM, SIL Open Font License 1.1; bundled license in `public/licenses/ibm-plex-mono-OFL.txt`.

Desktop tests operate on temporary profiles. They cover real passive scans, navigation, saved evidence, exports, dialogs and cancellation. Accessibility audits exercise the overview, component detail, replacement, settings, repair, manual-tool, performance and reliability views. Platform collectors and repair authorization behavior are unchanged by this redesign.
