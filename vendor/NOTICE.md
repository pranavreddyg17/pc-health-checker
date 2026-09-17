# Bundled diagnostic tools

PC Health distributes smartctl 7.5 from the smartmontools project as a separate executable. Copyright the smartmontools developers; distributed under GNU GPL version 2. The complete, unmodified corresponding source archive and GPL license accompany every installer in `vendor/sources`. This is aggregation with the PC Health application; no smartmontools code is linked into PC Health.

macOS: built from the accompanying source with Apple clang, universal arm64/x86_64, deployment target macOS 12.0 (PC Health itself requires macOS 13). Configure/make commands are in `sources/prepare-vendor.mjs`. No source patches are applied. The executable has an ad-hoc signature for local execution, not a Developer ID signature.

Windows: unmodified x64 `bin/smartctl.exe` and `bin/drivedb.h` extracted from the official smartmontools 7.5 Windows installer. Upstream source `INSTALL` describe the MinGW build. The separate `smartd` service, driver installation utility and update scripts are not distributed or run.

Official distributions: https://sourceforge.net/projects/smartmontools/files/smartmontools/7.5/

Pinned SHA-256:

- Source archive: `690b83ca331378da9ea0d9d61008c4b22dde391387b9bbad7f29387f2595f76e`
- Official Windows installer: `896337fcc253220614cf8cdbd5cf2321c5aa326a37a04160a672a281e6104c70`

Installed operation is offline and read-only: fixed `-j -i -H -A -n standby` arguments, no self-test, SMART setting change, firmware update or privilege prompt. Raw device serials used to validate attribution are not retained in reports. Disk controllers, drive power state and OS permissions can still limit collection.

`pchealth-telemetry` is PC Health's own read-only Swift helper. Source: `native/macos-telemetry.swift`; build: `scripts/build-native.mjs`. It uses Foundation, Darwin sysctl and Metal APIs and does not change hardware settings.
