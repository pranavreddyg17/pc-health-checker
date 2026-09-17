# PC Health — requirements extension and development plan

Prepared September 15, 2026. Baseline: development preview v0.2.0.

**Status: proposed extension plan, ready for review and implementation planning. This document does not claim these features already exist.** It extends [REQUIREMENTS.md](REQUIREMENTS.md); confirmed choices in that document continue to apply. [README.md](README.md) describes the implemented app.

Implementation update, September 16: v0.3 adds the first slowness investigation with intake, bounded real recordings, symptom markers, conservative resource-demand leads, user-entered actions/outcomes, comparisons, checkpoint recovery, and case exports. This is the first M1 development increment. Real Windows/Linux observation qualification, the full M0 performance gates, richer flow branching, and subsequent milestones remain open. See README for precise implemented coverage.

Implementation update, v0.4: the user authorized the extension and requested a complete visual redesign and stronger practical utility. A dark diagnostic console now includes seven guided repair flows, separate host/other-device cases, copied scan evidence with sources, test/result interpretations, repair/resolution logs, service reports, keyboard-event checks and static full-screen display patterns. This adds guided increments of M2–M4/M6. It does not complete automated fault isolation, structured OEM result parsing, richer sensors, Windows/Linux real-device qualification or verified replacement catalogs. See README for the implementation limits.

Implementation update, v0.5: the user requested research-backed preservation and server use, then confirmed **opt-in local monitoring and alerts; repairs require approval**. This supersedes the earlier manual-only requirement. A standalone local reliability engine, desktop monitoring, error-counter comparisons, explicit coverage-loss alerts, deeper storage rules and a headless Node collector are implemented. No autonomous repair, cloud inference, fleet control plane or installed daemon is included. See [RELIABILITY_RESEARCH.md](RELIABILITY_RESEARCH.md) for sources, implemented coverage, architecture, staged recovery requirements and qualification gates.

## 1. The product we should build

PC Health should help someone investigate a computer problem, choose a sensible action, and check whether that action helped. Its primary value should be the quality of that investigation and decision.

The present app establishes a useful technical foundation: local collection, conservative findings, explicit missing data, history, export, and a small parts catalog. The everyday user still has to connect those findings to their own problem, decide which test to perform, and judge whether a repair worked. That is the largest product gap.

The expanded promise:

> Tell PC Health what is happening. It gathers the relevant evidence, explains the strongest supported explanation and alternatives, walks you through the next useful check, and helps you decide whether to adjust something, maintain it, repair it, upgrade it, or seek service.

A repair technician’s investigation supplies the organizing method:

1. Establish the symptom, when it happens, and what changed.
2. Check whether data protection or stopping use takes priority.
3. Observe the problem under the conditions that produce it.
4. Separate plausible causes using the least disruptive useful checks.
5. Choose an action supported by the evidence.
6. Repeat the relevant observation and record the outcome.

Every investigation must leave the user with an answer to **“What should I do next, and why?”** An inconclusive diagnosis can still produce a useful next step.

### Existing commitments retained

- Everyday laptop and desktop owners; one solo developer.
- Windows, macOS, and Linux at public launch, with a declared tested support matrix.
- Local processing and storage; core functionality works offline.
- Manual scans and explicitly started diagnostic sessions; the September 16 amendment additionally authorizes opt-in local monitoring and alerts, with repair approval required.
- Passive collection and guided external diagnostics first. Built-in stress tests remain deferred.
- Exact replacement recommendations only within a verified offline compatibility catalog. This remains a launch requirement for declared supported cases.
- No invented component lifespan, unsupported health percentages, or automatic configuration changes.

### Confirmed scope addition and proposed tools

The user confirmed on September 15 that PC Health should investigate **hardware plus relevant software/settings causes**. Include operating-system, application-load, power-setting, and driver-context alternatives when investigating a slow or unstable computer. This expands diagnostic scope; it does not authorize a driver updater, cleaner, antivirus, or automatic repair feature.

Short, user-started recordings of ordinary activity fit the existing manual/passive scope. Interactive peripheral checks are a later proposed extension. Automated repairs and synthetic workloads require a separate scope decision.

## 2. What people should be able to accomplish

| User’s problem                                       | Product outcome                                                                                                                   | Evidence and workflow needed                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| “My computer becomes slow with my normal apps open.” | Understand whether memory pressure, CPU demand, storage delays, power state, or another observed condition is worth investigating | Record the affected workload; show sustained resource pressure and its timing; propose one comparison           |
| “I think I need more RAM.”                           | Decide whether their workload supports that upgrade and whether this computer supports it                                         | Memory-pressure/paging evidence during the problem, workload context, and verified replaceability/compatibility |
| “It gets hot and the fan is loud.”                   | Distinguish demanding work from a possible cooling problem and identify a useful next check                                       | Load, available temperature/throttle indicators, fan context, symptom timing, model-specific limits             |
| “My battery lasts much less than before.”            | Separate reduced capacity from high current demand, charging behavior, or reported sleep drain                                    | Capacity/condition, a selected discharge observation, power source, workload, available retained power reports  |
| “It freezes or restarts.”                            | Build a coherent incident history and choose the next discriminating diagnostic                                                   | User incident time, structured OS events, relevant changes, existing device warnings, external test results     |
| “Is my drive failing, or is it just full?”           | Separate space management, data-protection urgency, and a possible drive fault                                                    | Volume-to-device mapping, free space, documented device health, I/O symptoms, error history                     |
| “A game stutters or the screen glitches.”            | Investigate graphics workload, resets, thermal/power limits, memory pressure, and display-path alternatives                       | A manual reproduction session plus available GPU/OS evidence; no invented expected FPS                          |
| “The computer won’t start normally.”                 | Identify the stage of failure and prepare a useful service description                                                            | Saved offline guide for no power, failed startup checks, no display, or OS boot failure; user observations      |
| “Should I repair this computer or replace it?”       | Compare the affected assembly, serviceability, user-entered quotes, and remaining workload needs                                  | An evidence-linked repair/upgrade worksheet with explicitly unknown costs and compatibility                     |
| “I changed something. Did it help?”                  | Compare matched sessions and preserve what was actually changed                                                                   | Before/after sessions, workload/power context, user-reported symptom outcome, and counter-reset handling        |

The startup guide cannot inspect a powered-off or unbootable host from its installed desktop app. It must be exportable beforehand as a self-contained HTML/print guide for another device. A separate bootable diagnostic environment is future scope. Dell’s support material makes the useful distinction between no power, no POST, no video, and no boot; PC Health should translate those categories into ordinary language. [Dell startup troubleshooting](https://www.dell.com/support/contents/en-us/videos/videoplayer/my-computer-doesnt-start/6079766978001)

## 3. Feature requirements

Priority labels: **P0** delivers the next useful troubleshooting experience; **P1** deepens diagnosis and is needed for the broader launch scope; **P2** expands the toolset after the core investigation works. Priorities order development; they do not remove previously confirmed launch requirements.

### A. Troubleshooting cases and adaptive guidance — P0

| ID      | Requirement                                                                                                                                     | Acceptance criterion                                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CASE-01 | Start from plain-language problems: slow, freezing/restarting, hot/noisy, battery/charging, storage concern, graphics trouble, or general check | A user can start without identifying a component or knowing technical terms                                                                            |
| CASE-02 | Ask short, branching questions about onset, recurrence, workload, AC/battery state, and recent changes                                          | Initial intake normally needs no more than five questions; “I don’t know” is valid; ask later questions only when they affect a decision               |
| CASE-03 | Save an investigation with symptoms, scans, observations, actions, and outcomes                                                                 | The user can resume after closing the app or performing an external/reboot diagnostic                                                                  |
| CASE-04 | Present a small ranked set of supported explanations, evidence for/against each, and the next check that distinguishes them                     | Every explanation references evidence or is explicitly an untested possibility; no unsupported probability percentages                                 |
| CASE-05 | Track progress as useful decisions and completed checks                                                                                         | Skipping a question or declining access never turns a check into a pass                                                                                |
| CASE-06 | Recognize reported physical hazards or serious current drive warnings before selecting tests                                                    | Route to the applicable protective/service guidance; suppress incompatible testing suggestions; do not claim a physical condition was sensor-confirmed |
| CASE-07 | Put recommended actions in a short ordered list                                                                                                 | Default view shows up to three prioritized actions, with why, effort, prerequisites, reversibility, and a follow-up check                              |

Initial troubleshooting flows should use a versioned decision graph and evidence rules. A local conversational interface can later translate questions and explanations, but the core workflow must work without an LLM.

### B. “Record while the problem happens” — P0

A short observation session is the highest-value addition after symptom intake. A static inventory misses the moment when a machine becomes slow.

| ID     | Requirement                                                                                                                          | Acceptance criterion                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OBS-01 | Let the user start a bounded recording while using their normal applications                                                         | Proposed default: three minutes, selectable up to ten; visible countdown, cancel, and no background continuation                                                                                       |
| OBS-02 | Capture timestamped CPU utilization, memory pressure/paging indicators, I/O activity, power source, and supported contextual signals | Availability and units are explicit per metric; absent sensors remain absent                                                                                                                           |
| OBS-03 | Show the apps contributing most resource demand when the OS exposes it                                                               | Use bounded collection; no command lines, document titles, browser URLs, environment variables, or raw process arguments                                                                               |
| OBS-04 | Let the user mark “It is happening now”                                                                                              | Marker appears on the observation timeline and is distinct from a detected event                                                                                                                       |
| OBS-05 | Summarize duration and coincidence of pressure, not just the largest spike                                                           | A single utilization spike does not trigger an upgrade; sampling duration and dropped samples are visible                                                                                              |
| OBS-06 | Compare a baseline and a repeat under similar conditions                                                                             | Record workload label, AC/battery state, relevant power mode where readable, and major configuration differences; mark comparisons as confounded when needed                                           |
| OBS-07 | Bound the app’s own observer effect                                                                                                  | Measure collector/UI overhead on reference machines; identify PC Health’s own process use; exclude initial collector startup from an idle baseline and disable local-model inference during recordings |
| OBS-08 | End observation reliably                                                                                                             | Closing the session, app exit, cancellation, deadline, suspend, or collector failure records the reason and stops owned collection; resuming requires an explicit action                               |

Proposed initial engineering budgets: acknowledge cancellation within one second; stop owned sampler processes within three seconds; sample general resource counters at about one-second intervals and expensive metadata less often; limit one observation to 20 MB and total history to the original proposed 250 MB cap. These are targets to validate, not current performance claims.

### C. Slowness and upgrade investigation — P0

| ID      | Requirement                                                                                           | Acceptance criterion                                                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PERF-01 | Explain observed CPU demand in workload context                                                       | “App X used substantial CPU during the slowdown” is allowed; “your CPU is worn out” is not                                                                  |
| PERF-02 | Evaluate memory pressure using platform-appropriate signals over time                                 | Cached/used RAM or existing swap alone cannot justify buying RAM; high demand must be distinguished from a memory integrity fault                           |
| PERF-03 | Evaluate storage delay with available activity/latency evidence, volume mapping, and pressure context | Do not label a drive faulty from “100% active time”; separate memory-related paging, application demand, low free space, and device-health evidence         |
| PERF-04 | Include readable power/thermal constraints and contextual questions                                   | Low clocks alone do not establish throttling; power saving, idle behavior, and unsupported telemetry are considered                                         |
| PERF-05 | Offer a simple controlled comparison                                                                  | Example: the user saves work, closes one identified app normally, and repeats the session; PC Health does not kill the process                              |
| PERF-06 | Explain whether a potential upgrade addresses the observed limitation                                 | “More RAM may help this workload if the machine supports it” requires sustained relevant evidence; no promised percentage speedup without a validated model |

Windows exposes a performance-counter framework for CPU, memory, disk, and other statistics, making it a collection route to validate. [Microsoft performance counters](https://learn.microsoft.com/en-us/windows/win32/perfctrs/about-performance-counters)

Apple’s memory-pressure explanation incorporates several factors, including swap rate and cached memory; simple RAM occupancy is insufficient. The app must not imitate Apple’s pressure indicator without an appropriate source or label a different derived metric as the same thing. [Apple memory usage guidance](https://support.apple.com/en-asia/guide/activity-monitor/actmntr1004/mac)

Linux PSI provides CPU, memory, and I/O stall information when available, offering evidence of contention beyond utilization. PC Health must detect availability and use read-only sampling rather than install a persistent pressure monitor. [Linux PSI documentation](https://docs.kernel.org/accounting/psi.html)

### D. Storage and data protection advisor — P0/P1

| ID      | Priority | Requirement and acceptance criterion                                                                                                                                                                                              |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DISK-01 | P0       | Map user-visible volumes to physical storage where possible; explain free space separately from hardware condition. Encrypted, pooled, RAID, and ambiguous mappings stay explicit                                                 |
| DISK-02 | P0       | Prioritize current serious storage warnings ahead of optional performance investigations; record whether the user says they have a backup, without calling it verified                                                            |
| DISK-03 | P1       | Add validated Windows raw health access and richer SATA/HDD interpretation. Preserve vendor-specific attribute definitions, units, and source versions                                                                            |
| DISK-04 | P1       | Explain newly increasing errors versus unchanged lifetime counts and device replacements; a reset starts a new baseline or marks comparison uncertain                                                                             |
| DISK-05 | P1       | Guide users to supported OEM/device diagnostics, explain their workload/restart implications, and import or record results. Do not automatically launch self-tests in a passive scan                                              |
| DISK-06 | P1       | Provide a replacement preparation checklist: data protection, encryption recovery information, migration/reinstallation, serviceability, and post-install validation. Never collect recovery keys                                 |
| DISK-07 | P2       | Offer an explicitly selected storage-usage summary or native storage-settings handoff. Directory enumeration needs its own scope disclosure and bounds; no automatic deletion, cleaner score, or personal-file-content inspection |

### E. Battery, charging, and sleep investigation — P1

| ID     | Requirement                                                                                               | Acceptance criterion                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BAT-01 | Separate capacity loss, current discharge demand, charging state, and reported sleep drain                | A charge limit or temporarily paused charging does not become “battery worn out”                                                                              |
| BAT-02 | Offer an optional manual discharge observation during ordinary use                                        | Show the observed interval and power/workload context; do not force full discharge or extrapolate an exact remaining lifetime from a short or unstable sample |
| BAT-03 | Read adapter recognition/wattage and charge-limit state where supported; otherwise ask targeted questions | A reported adapter rating is not proof of delivered power, cable capability, or a faulty charger                                                              |
| BAT-04 | Review retained power/sleep reports where the platform exposes them                                       | No app background monitoring is introduced; show report time, eligible hardware, and coverage gaps                                                            |
| BAT-05 | Connect service advice to the user’s actual runtime needs and the OEM’s condition information             | Distinguish useful planned battery service from an urgent user-reported physical problem; exact battery parts require model/assembly verification             |

Windows SleepStudy applies to supported Modern Standby systems and has specific retention/session limits. Its existence does not imply universal laptop sleep diagnosis or identical capability on the other OSes. [Microsoft SleepStudy](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/modern-standby-sleepstudy)

### F. Heat, fans, and graphics performance — P1

| ID       | Requirement                                                                                                      | Acceptance criterion                                                                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| THERM-01 | Relate exposed temperature and fan readings to load, power mode, and symptom timing                              | Do not use one “bad temperature” threshold across CPUs, GPUs, SSDs, and laptop models                                                                                                                   |
| THERM-02 | Identify documented throttle/thermal-warning states where directly available                                     | Distinguish device-reported state from an inference based on clocks/temperature; label each correctly                                                                                                   |
| THERM-03 | Offer model-appropriate maintenance and service guidance                                                         | Explain ventilation and inspection steps; dust, paste condition, and fan damage remain unverified until inspected. Disassembly instructions require an applicable OEM procedure and suitable user skill |
| GPU-01   | Add supported GPU load, memory-use, reset, and power/thermal-limit context                                       | Supported adapter matrix names vendor and platform restrictions; integrated GPU shared memory is not presented as dedicated VRAM                                                                        |
| GPU-02   | Guide a stutter/artifact investigation through display path, workload, driver context, and hardware alternatives | Without validated frame-time data, do not claim measured FPS or identify the cause from a screenshot description alone                                                                                  |
| GPU-03   | Save before/after graphics investigation sessions                                                                | Record game/workload and relevant user-reported settings; no cross-system performance ranking from unmatched workloads                                                                                  |

Linux hwmon attributes are mostly optional. Sensor discovery and model applicability must be part of the implementation, and writing fan-control or voltage attributes is outside this read-only feature. [Linux hwmon interface](https://docs.kernel.org/hwmon/sysfs-interface.html)

### G. Crashes, memory, and intermittent faults — P1

| ID       | Requirement                                                                                         | Acceptance criterion                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CRASH-01 | Build a bounded, structured incident timeline from supported retained evidence and user markers     | Keep event occurrence, log/report creation time, observation time, and approximate user-entered time separate                            |
| CRASH-02 | Categorize available bugcheck/panic, WHEA, storage, graphics-reset, and out-of-memory evidence      | Correlated events are leads; an event-source component is not automatically the part to replace                                          |
| CRASH-03 | Ask what changed and record a short change log                                                      | Software/driver/firmware updates, peripherals, upgrades, and user-known tuning changes are possible contributors, not established causes |
| CRASH-04 | Recommend the next discriminating check and save its outcome                                        | Unsupported logs lead to specific guided diagnostics or service preparation instead of a dead end                                        |
| RAM-01   | Distinguish insufficient memory capacity from possible memory-subsystem instability                 | High memory use never becomes a failed RAM test                                                                                          |
| RAM-02   | Provide platform/model-appropriate external memory/OEM diagnostic guides and resumable result entry | User-entered codes/results have their own provenance; no specific DIMM is condemned without valid localization evidence                  |
| RAM-03   | Preserve alternative causes after memory errors                                                     | Memory controller, CPU/cache, board, and configuration remain applicable alternatives until isolated                                     |

Windows Event ID 41 indicates an unclean shutdown and can have different causes. It must never independently trigger a PSU replacement recommendation. [Microsoft Event ID 41 guidance](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/event-id-41-restart)

Apple Diagnostics has documented startup procedures and reference codes. The guide must account for model/OS differences and explain any external-tool connectivity or terms requirements; the PC Health app itself remains offline. [Apple Diagnostics](https://support.apple.com/en-gb/102550)

### H. Practical diagnostic toolbox — P1/P2

Each tool has a clear question, instructions, expected duration, completion criteria, and saved result. A tool launcher alone is insufficient.

| Tool                               | Priority                  | User value and boundary                                                                                                                                                                       |
| ---------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guided OEM/boot diagnostic center  | P1                        | Instructions saved before restart, manual reference-code entry, verified code explanations, and a next action. Never treat viewing instructions as executing a test                           |
| Repair journal and comparison      | P0                        | Record what the user changed, repeat the same observation, and show whether the symptom improved, persisted, or was not reproduced                                                            |
| Technician handoff report          | P0                        | One-page symptom/timeline/action summary plus optional evidence appendix; avoid making a technician reconstruct the investigation from raw counters                                           |
| Startup recovery guide             | P1                        | Export a guide that distinguishes failure stages and collects model-specific LED/beep observations; no universal code decoder                                                                 |
| Display inspection                 | P2                        | User-selected static colors/gradients and instructions help describe pixel/artifact issues; no flashing stress pattern and no claim to distinguish panel, cable, and GPU faults automatically |
| Keyboard and pointing-device check | P2                        | Highlight keys/buttons tested inside a dedicated local view; never capture input outside it or save typed content; store only selected results                                                |
| Speaker/channel check              | P2                        | Explicit playback at a user-controlled volume and user-entered channel results; no claim to diagnose an amplifier or port electrically                                                        |
| Camera/microphone check            | P2                        | Optional local preview with OS permissions, no default recording or network transfer; device operation and app permissions remain distinct from physical fault isolation                      |
| USB/device detection comparison    | P2                        | Compare manually captured connected-device states and guide one cable/port substitution; no electrical power-delivery verdict                                                                 |
| Local connectivity triage          | P2, separate scope choice | Adapter/link/context checks can help distinguish a local-device problem from a connection issue. Internet speed tests and remote endpoints are outside the offline core                       |

Full benchmarks, VRAM stress, RAM allocation stress, drive surface scans, battery cycling, automatic filesystem repair, fan control, undervolting, firmware flashing, and registry cleaners are not part of these first extensions.

### I. Repair, upgrade, and compatible-parts advisor — P1

| ID       | Requirement                                                                       | Acceptance criterion                                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PARTX-01 | Establish exact machine/board identity, configuration, and serviceable assemblies | Model name alone is insufficient where revisions or configurations change compatibility; ask for a specific missing identifier                                                                                        |
| PARTX-02 | Show upgrade feasibility and reasons                                              | Distinguish replaceable, integrated, model-specific assembly, verified incompatible, and unknown                                                                                                                      |
| PARTX-03 | Connect a candidate upgrade to the investigation                                  | The recommendation states the observed limitation it may address and what it cannot solve                                                                                                                             |
| PARTX-04 | Verify every required fit constraint before offering an exact compatible part     | A protocol match remains a candidate; missing slot, capacity, clearance, connector, power, firmware, or revision evidence prevents a verified match                                                                   |
| PARTX-05 | Maintain a deliberately small, supported offline catalog first                    | Candidate pilot scope: selected standard storage upgrades, RAM configurations, and model-specific batteries on reference devices; actual covered models must be chosen and verified before release                    |
| PARTX-06 | Add a repair-versus-upgrade worksheet                                             | Use user-entered local quotes/budget, downtime, serviceability, and workload needs. Costs remain unknown until entered or sourced with region/date; no invented resale values or universal age-based replacement rule |
| PARTX-07 | Preserve source, rule/catalog version, and verification date                      | Signed offline catalog updates and rollback retain the original requirements; stale entries disclose the verification gap                                                                                             |

A v0.2 catalog product must not be promoted to a verified fit by a more polished screen. Compatibility evidence is its own engineering workstream.

## 4. The user-facing experience

Proposed home screen actions:

- **Help me solve a problem** — resume or start a symptom-led investigation.
- **Check this computer** — the existing passive baseline scan.
- **Plan an upgrade or repair** — begin with workload/need and serviceability.
- **Diagnostic tools** — guided tests, observation sessions, and later interactive checks.

Secondary areas: **My investigations**, **Hardware details**, and **Settings & privacy**. Hardware inventory remains available as supporting evidence.

The investigation view should show the user’s problem, the strongest supported explanation or current uncertainty, evidence in ordinary language, one prominent next action, and alternatives. Technical measurements, coverage, and source information stay expandable. On return, show “What happened after this step?” with improved / unchanged / worse / could not test.

### Illustrative interaction, not a real diagnosis

**Problem:** “My laptop becomes slow when I open my work apps.”

1. The user selects when it happens and starts a three-minute observation.
2. They mark a slowdown while reproducing ordinary work.
3. The app finds sustained memory-pressure/paging evidence around that marker, with CPU demand insufficient to establish a CPU bottleneck. Missing disk-health data is disclosed separately.
4. The next action is to save work, close one high-demand app normally, and repeat under the same power conditions.
5. If both the symptom and pressure improve, the case records support for a workload/capacity explanation. This does not establish a defective RAM module or prove causation from one comparison.
6. If the user wants more simultaneous applications, the upgrade path checks whether this exact machine supports additional RAM. If integrated, it explains that constraint before suggesting a purchase.

This flow should end usefully even when every physical component has no detected health warning.

## 5. Evidence and execution design

Extend the existing local engine rather than place an unconstrained agent in charge of commands.

| New record               | Required fields / purpose                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Investigation            | Symptom, onset, context, user goals, status, selected flow/version, linked scans, next step                                                |
| Observation session      | Start/end, monotonic sample times, wall-clock anchor, workload/power context, sampler versions, gaps, abort reason, bounded sample storage |
| Evidence item            | Value/unit, source, device/subsystem scope, occurrence/collection times, validity, applicability, provenance, redaction policy             |
| Hypothesis               | Supporting and opposing evidence, untested alternatives, qualitative support, next discriminating check; no uncalibrated probabilities     |
| Diagnostic step/result   | Preconditions, workload class, time expectation, provider, state, user consent when applicable, collected/imported/user-entered provenance |
| Action/outcome           | What changed, who performed it, time, prerequisites, reversibility, linked comparison, user-reported symptom outcome                       |
| Compatibility assessment | Exact system/configuration, required constraints, known/unknown/conflicting facts, supported part/source/version, fit verdict              |

Keep diagnosis severity, evidence strength, coverage, compatibility, and observed performance change as separate fields. Store raw identifiers only when necessary and under the established privacy policy; defaults should prefer local pseudonymous identifiers.

Proposed shared interfaces: discover capabilities, collect a baseline, start/stop a bounded observation, read supported incident summaries, normalize a selected external result, evaluate a diagnostic step, and compare sessions. The renderer submits a known operation ID and validated arguments, never command text.

Privacy additions: top-app names can reveal sensitive usage. Explain collection before observation, allow aggregate-only recording, keep app names out of exports by default, and preview exactly what will be exported. Imported files are user-selected and size-bounded; parse known formats as data, never execute scripts/macros or obey instructions in them. Do not collect full memory dumps in the initial plan.

Persistence must migrate existing v0.1/v0.2 scan history without loss. Detailed samples have bounded retention; investigation summaries and explicitly saved outcomes need a documented retention/deletion policy. Interrupted writes and app crashes must preserve completed evidence.

## 6. Platform feasibility and access

The following are candidate routes to validate, not claims of present integration or uniform availability.

| Capability                    | Windows                                                         | macOS                                                                                | Linux                                       | Delivery condition                                                               |
| ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------- |
| Resource observation          | Performance-counter/process APIs                                | Supported host/process accounting; validate memory-pressure and paging semantics     | procfs and PSI where available              | Standard-user baseline first; app attribution degrades independently             |
| Storage topology and health   | Storage APIs; narrowly scoped raw-health helper if needed       | System storage interfaces and qualified device utilities                             | sysfs/lsblk plus qualified device utilities | Exact physical scope and vendor semantics documented                             |
| Temperature, fans, throttling | Supported OEM/vendor interfaces; any driver separately reviewed | Supported exposed states; model-specific low-level access remains a feasibility risk | hwmon and supported vendor interfaces       | Unsupported hardware gets a guided path, never a fabricated reading              |
| Battery and power             | Battery APIs, power reports where eligible                      | Supported battery/power information                                                  | power_supply and available OS records       | Capacity, charge, drain, and adapter information stay separate                   |
| Incident interpretation       | Structured event fields and retained diagnostic summaries       | Bounded metadata/structured reports where accessible                                 | Journal/kernel records where readable       | Permissions, retention, timestamp precision, and event meanings explicit         |
| GPU observation               | Vendor/OS interfaces with explicit GPU support                  | Validate exposed counters; no assumed vendor parity                                  | Supported DRM/vendor interfaces             | No universal GPU/VRAM coverage claim                                             |
| External diagnostics          | OEM and supported offline tools                                 | Documented Apple Diagnostics workflow                                                | Distribution/hardware-appropriate tools     | Offline instructions available; tool dependencies and result provenance explicit |

Do not implement a permanent privileged daemon to improve a checklist. If an essential feature requires elevation, prototype a short-lived, narrowly scoped helper, define signing/distribution requirements, and offer a useful path when access is declined. Do not depend on disabling operating-system protections or distributing an unreviewed low-level driver.

Name reference hardware before promising coverage: at minimum one representative machine for each launch OS, plus additional systems needed for each advertised hardware family or configuration. One passing machine per OS is a development gate, not adequate proof of general platform support. Virtual machines can test some software behavior but cannot replace physical-device qualification.

## 7. Development sequence for a solo developer

Deliver complete investigations in increments. Avoid building every sensor adapter before testing whether users understand the result. No calendar commitment is made without knowing available reference hardware and development time.

| Milestone                                | Deliverable                                                                                                                                         | Dependencies                                                      | Completion gate                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — prove the next collectors           | Capability prototypes for CPU/memory/I/O observation on three OSes; choose reference machines; record the confirmed hardware-plus-software scope    | Physical test access and supported API review                     | Record actual metrics, meanings, permissions, overhead, and missing coverage for each platform                                                      |
| M1 — first complete troubleshooting flow | “My computer is slow”: intake, bounded observation, evidence-based summary, one guided action, repeat comparison, saved case/report                 | M0 and case/session schema                                        | Users can complete the flow and explain their next step; unavailable data does not block all progress; no replacement advice from utilization alone |
| M2 — practical storage decisions         | Full-versus-failing workflow, topology, richer qualified health access, backup-first decisions, guided result entry                                 | Validated device interfaces and storage fixtures                  | Cases distinguish low space, workload pressure, and real device warnings; serious warnings bypass optional tests                                    |
| M3 — laptop usefulness                   | Battery/charging and heat/noise workflows, power context, supported observations, maintenance/service outcomes                                      | Sensor/power feasibility and model guidance                       | Capacity loss and high demand produce different actions; missing thermal sensors still lead to a useful investigation                               |
| M4 — instability investigation           | Structured incident timeline, supported crash/error interpretation, memory/OEM diagnostic flows, resumable external results, startup recovery guide | Versioned event/code knowledge and fault cases                    | Generic restart logs never identify a PSU or DIMM; users can complete a reboot-test workflow and resume their case                                  |
| M5 — verified repair and upgrade path    | Curated exact-fit catalog, serviceability, quote worksheet, preparation and post-repair checks                                                      | Reference-system compatibility research, signed catalog packaging | Every advertised supported purchase case has verified constraints and at least one exact option; ambiguous cases remain unverified                  |
| M6 — broader everyday toolbox            | Prioritized peripheral checks and expanded model coverage                                                                                           | User feedback and individual scope decisions                      | Each tool produces a saved actionable outcome; permissions and privacy behaviors pass review                                                        |
| Public release qualification             | Qualified installers and offline workflows for Windows/macOS/Linux                                                                                  | Applicable M0–M5 requirements and original release gates          | Supported matrix, real-device diagnosis validation, signing, accessibility, update/recovery, and offline tests pass                                 |

Catalog research should start during M0 because it can delay M5. M6 is not a prerequisite to the first useful public release. Intermediate development previews are not a waiver of the three-OS or supported exact-parts launch commitments.

### Recommended next implementation backlog: M0–M1

1. **Case model and migrations:** add investigations, symptom intake, provenance, and versioned storage migrations; keep old scans readable.
2. **Flow engine:** declarative decision steps with prerequisites, evidence references, skip/inconclusive outcomes, and next-action selection.
3. **Sampler contract:** bounded start/stop lifecycle, time normalization, capability discovery, sample limits, and adapter fixtures.
4. **Platform observation prototypes:** validate CPU, memory/paging, and I/O semantics on all three OSes before enabling interpretations.
5. **Observation screen:** countdown, symptom marker, context, resource timeline, and optional local top-app attribution.
6. **Slowness rules:** supported CPU-demand, memory-pressure, and I/O-pressure explanations; mixed and insufficient evidence handled explicitly.
7. **Action and comparison:** one guided user action, matched repeat, recorded result, and clear confounders.
8. **Case report and validation:** human-readable handoff, redaction preview, end-to-end scenarios, usability check, and measured overhead.

Likely code organization: add focused investigation/observation views beside `src/App.tsx`; extend `src/shared/` with case, evidence, flow, and comparison modules; add samplers beside `electron/collectors/`; extend narrow IPC and versioned persistence. Keep collectors independently testable. Avoid growing the existing single view file into the entire troubleshooting product.

## 8. Acceptance scenarios and measures of usefulness

| Scenario                                                     | Required result                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| High RAM occupancy but no supported pressure/paging evidence | Explain occupancy; do not prescribe a RAM purchase                                   |
| Sustained memory pressure during a user-marked slowdown      | Suggest a workload comparison; separate capacity suitability from physical integrity |
| A short CPU spike when a program opens                       | Describe transient demand; no thermal/failure/replacement conclusion                 |
| A drive is nearly full but health data is absent             | Report space pressure separately and disclose missing health evidence                |
| A drive reports a current serious health warning             | Prioritize data protection; do not propose an intensive test first                   |
| Old storage error count is unchanged                         | Preserve historical status; do not call it a new incident                            |
| Only an unclean-shutdown event is available                  | Keep cause uncertain and recommend a useful discriminating check                     |
| A laptop stops charging at a configured limit                | Investigate charging policy/context; do not infer lost capacity from charge level    |
| Fanless hardware or an unavailable temperature sensor        | Show not applicable/unavailable as appropriate; no cooling-failure accusation        |
| Power source, workload, or settings differ between sessions  | Mark the comparison as confounded; no unqualified improvement percentage             |
| The user cancels, sleeps, exits, or the collector hangs      | Stop owned observation, save partial evidence, and explain the boundary              |
| An external result is typed by the user                      | Preserve its provenance; never label it directly measured by PC Health               |
| A compatible-looking part fails one constraint               | Reject verified compatibility and explain the missing/conflicting requirement        |
| No fault evidence is found but the symptom persists          | Continue to a specific guided test or service handoff, with limits explained         |
| First run occurs with networking blocked                     | Baseline, cases, observations, bundled guidance, rules, history, and exports work    |

Product validation should measure whether people can identify the next action, understand what was actually checked, complete a proposed step, and resume an investigation. Proposed early usability gate: at least four of five representative novice participants can explain the recommended next step and the reason without coaching. This is a small usability screen, not statistical validation of diagnosis accuracy.

Diagnostic validation needs labeled scenarios, known-good and known-faulty evidence, contradictory cases, expert review, and separate counts of false replacement recommendations and missed serious warnings. Define rule-specific release thresholds before public diagnostic-accuracy claims. A zero-false-replacement regression corpus is a release gate, not proof of zero real-world risk. Collect feedback and outcome measures locally unless the user explicitly exports them.

## 9. Decisions and deferred work

The user confirmed hardware plus relevant software/settings diagnosis. The plan includes these as diagnostic context and keeps changes user-driven. The user subsequently authorized implementation. Unfinished items below remain roadmap requirements; implementation status is recorded above and in README.

Before implementation estimates, establish access to Windows and Linux test machines, exact supported OS/architecture targets, and a small initial catalog/reference-device list. These are engineering prerequisites; the user need not design the feature list.

Defer until the core investigations demonstrate value: local conversational AI, built-in benchmarks/stress testing, automated repair, a bootable rescue environment, online price lookup, remote support, fleet management, and broad unverified compatibility catalogs. Any later AI layer must follow the existing offline and constrained-execution requirements.

**Recommended next delivery:** a complete “Why is my computer slow?” investigation with a short manual observation, an evidence-linked next action, and a before/after follow-up. It provides a concrete reason to use PC Health even when the computer has no failing component.
