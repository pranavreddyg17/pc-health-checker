# PC Health demo

The [30-second video](media/pc-health-demo.mp4) shows version 0.7.0 through the actual desktop interface:

| Time          | View                                        |
| ------------- | ------------------------------------------- |
| 0–5 seconds   | Overview after a real hardware scan         |
| 5–10 seconds  | Detected drive details and health evidence  |
| 10–15 seconds | Thermal reliability evidence and its source |
| 15–20 seconds | Guided battery/charging repair workflow     |
| 20–25 seconds | Keyboard response check                     |
| 25–30 seconds | Local scan records and overview             |

Hardware readings are collected from the recording Mac. The repair case is explicitly illustrative: its external-device label and test notes identify example user reports. No host failure or completed physical repair is implied.

The recorder uses a newly created temporary profile and removes it on exit. It does not load your saved scans, enable continuous monitoring or notifications, or change hardware settings. Only the app viewport is captured; no desktop, other application, microphone or camera is recorded. It runs real passive scans before recording, so a successful run needs readable hardware inventory and a detected drive.

## Reproduce

Install `ffmpeg`, install the project's dependencies, then build:

```sh
npm ci
npm run build
node scripts/record-demo.mjs
```

The current caption renderer uses macOS system fonts, so run the recorder on macOS. `PCHEALTH_TEST_EXECUTABLE` can select a packaged app instead of the source build:

```sh
PCHEALTH_TEST_EXECUTABLE='/absolute/path/to/PC Health.app/Contents/MacOS/PC Health' node scripts/record-demo.mjs
```

Output: `docs/media/pc-health-demo.mp4`, silent H.264 with browser-compatible pixel format and streaming metadata. The six captions are part of the video, not additions to the application UI. Review the output before sharing: real device model names, measurements and timestamps remain visible.

Generate the README poster from the opening scene:

```sh
ffmpeg -y -ss 1 -i docs/media/pc-health-demo.mp4 -frames:v 1 docs/media/demo-poster.png
```
