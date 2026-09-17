# Sharing PC Health 0.7.0

Share these generated files from `release/0.7.0`:

- `PC-Health-0.7.0-mac-universal.dmg` — macOS 13+, Apple silicon and Intel.
- `PC-Health-0.7.0-windows-x64-Setup.exe` — Windows x64 installer.
- ZIP alternatives are available for both platforms. Share the entire archive, not an extracted executable alone; the runtime and diagnostic tools must stay together.
- `SHA256SUMS.txt` records the SHA-256 of each distribution file.

## Install and use

macOS: open the DMG, drag PC Health to Applications, then open the app. It has an ad-hoc integrity signature, but no Developer ID signature or Apple notarization. macOS may block opening a downloaded preview; follow the operating system's per-app review flow if you trust the source. Do not disable Gatekeeper globally.

Windows: run the Setup executable. It defaults to a per-user installation, supports choosing a destination, and preserves application data on uninstall. It has no Authenticode publisher signature; Windows may show an unknown-publisher/SmartScreen warning. Real Windows device qualification is still required before a production release.

Start with **Scan this computer**. On this development Apple M1 host, all 12 automatic scan checks completed, with four external inspections listed separately. Results vary with OEM APIs, drive controllers, driver support, power state and permissions. The app reports missing sources explicitly. Full physical RAM/CPU/VRAM integrity, battery swelling and PSU wear are not established by passive sensor readings.

The macOS and Windows drive readers are included. A denied Windows raw-drive read can require explicitly reopening the app as administrator; PC Health does not elevate itself. Optional Windows fan/voltage/temperature sensors require an already-running LibreHardwareMonitor WMI provider or exposed firmware zones. No sensor kernel driver is installed by PC Health.

**Reliability → Run reliability check** runs one local check. Continuous monitoring and desktop notifications each require opting in and remain off after launch. The monitor stops with the application; no always-on service is installed. No repair command, restart, stress test or firmware update runs automatically.

All diagnostic data stays local. There are no accounts, upload endpoints or cloud AI requirements. Exports contain device/component labels and user-entered notes; review them before sharing.

## Build and validate

```sh
npm ci
npm test
npm run dist:mac  # run on macOS; stages/signs outside cloud-managed Documents folders
npm run dist:win  # Windows x64 NSIS + ZIP; cross-build is supported on this Mac
node scripts/verify-packages.mjs # after both platforms' packages exist locally
PCHEALTH_TEST_EXECUTABLE='/absolute/path/to/PC Health.app/Contents/MacOS/PC Health' node scripts/test-packaged-telemetry.mjs
```

The manual GitHub Actions workflow builds separate Mac and Windows preview artifacts when invoked after the repository is pushed. It does not publish a public release or install an update server.

Tool versions, corresponding source and licenses are bundled with each app in `vendor`. Build-time downloads need internet; installed scans are offline. See [TELEMETRY_COVERAGE.md](TELEMETRY_COVERAGE.md) for implementation scope, primary-source research and device qualification limits.
