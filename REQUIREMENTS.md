# PC Health — product requirements draft

**Scope amendment, September 16, 2026:** the user now authorizes opt-in local monitoring and alerts, with repairs requiring approval, and requests exploration of server/datacenter use. This supersedes all manual-only/no-monitoring exclusions below, which describe the original baseline. Offline/local processing remains required. The current implementation and explicit limits are in [README.md](README.md); research and the server/recovery extension are in [RELIABILITY_RESEARCH.md](RELIABILITY_RESEARCH.md). No automatic repair execution has been authorized or implemented.

Prepared September 14, 2026. Status: requirements draft incorporating confirmed product choices; detailed implementation scope remains under discussion.

> Planning update, September 15, 2026: [REQUIREMENTS_EXTENSION.md](REQUIREMENTS_EXTENSION.md) proposes symptom-led investigations, practical diagnostic tools, and staged delivery beyond v0.2.0. The user has confirmed expanding diagnosis to relevant software/settings causes alongside hardware. Other new features remain proposals.

## 1. Product promise

PC Health runs on the user's computer, identifies internal components, measures available aging indicators, detects evidence of hardware problems, and explains whether to keep using, monitor, maintain, test, service, or replace a component.

The core experience should answer: **Which part needs attention, what evidence supports that conclusion, how urgent is it, and what should I do next?**

Confirmed direction from the request, attached notes, and follow-up answers:

- An installed application that inspects the user's own computer.
- Component-specific health assessment and replacement recommendations.
- Everyday laptop and desktop owners are the first audience.
- Windows, macOS, and Linux must all be supported at launch, with platform-specific collection.
- Manual scans only. No background monitoring or scheduled scans.
- All processing and diagnostic data stay on the user's computer; the application works offline.
- The first release recommends exact compatible replacement products where compatibility can be verified.
- The first release uses passive checks and guided external tests; built-in intensive/stress tests are deferred.
- The product is being built by a solo developer. Budget and target launch date have not been specified.
- Plain-language explanations; AI-assisted diagnosis is part of the broader concept.

Open decisions: exact supported OS versions/architectures, initial device and parts-catalog coverage, budget/timeline, and whether a conversational local AI model is necessary in the initial release. Everything labeled proposed below is a recommendation rather than an additional confirmed choice.

## 2. What the product can claim

Separate four concepts throughout the interface and data model:

| Concept | Meaning | Example |
| --- | --- | --- |
| Wear | A documented aging or endurance indicator | Manufacturer-reported SSD endurance usage |
| Fault evidence | An observed error or failed diagnostic | Repeated uncorrectable storage errors |
| Operating condition | How the component is behaving now | Sustained thermal throttling |
| Performance suitability | Whether the hardware meets the user's workload | Insufficient RAM capacity for their applications |

Age, heat, slowness, and a crash must not automatically become a replacement recommendation. A performance upgrade is different from replacing a worn or faulty part.

Do not publish universal CPU/GPU/RAM wear percentages, exact failure dates, or a guarantee that passing a scan means future failure is impossible. Numerical failure probabilities require a validated prediction model. Prefer “No issues detected in completed checks” over an unconditional “Healthy.”

For example, NVMe `PercentageUsed` is a manufacturer estimate of endurance consumed. It can exceed 100, and 100 does not itself mean the device has failed. It must not be relabeled as failure probability or precise remaining life. [Microsoft NVMe health documentation](https://learn.microsoft.com/en-us/windows/win32/api/nvme/ns-nvme-nvme_health_info_log)

## 3. Component coverage

This is a proposed capability envelope. Each feature needs validation on actual supported devices; inclusion does not promise universal sensor availability.

| Component | Evidence to collect where available | Permitted assessment and next step | Key limit |
| --- | --- | --- | --- |
| NVMe SSD | Endurance usage, spare capacity, critical warning bits, media errors, temperature, writes, self-test results | Explain endurance consumption; prioritize backup and replacement planning when supported by warning/error evidence | Controller-level data may apply to multiple namespaces; endurance is not a failure countdown |
| SATA SSD | Model-specific SMART attributes, error trends, temperature, self-test history | Wear assessment only with a verified attribute definition for that device family | Attribute meaning and units can vary by vendor |
| HDD | Documented SMART attributes, pending/reallocated/uncorrectable sectors, read errors, self-test outcomes | Assess fault evidence and worsening trends; separate media issues from connection/controller problems | No defensible universal percentage of mechanical life remaining |
| Laptop battery | Full-charge and design capacity, cycles, OEM/OS condition, temperature and charging state where exposed | Describe capacity loss; recommend service based on condition, model guidance, and the user's runtime needs | Charge level differs from capacity retention; software cannot rule out physical damage |
| CPU | Supported temperatures, clocks, load, throttling, hardware error records | Detect thermal or stability problems and recommend targeted investigation | These measurements do not establish a general CPU wear percentage |
| GPU / VRAM | Supported temperatures, throttling, driver resets, vendor errors/ECC where supported, optional test results | Identify graphics-related instability; investigate driver, cooling, power, and hardware causes | Error reporting varies by GPU; a reset alone does not prove GPU failure |
| RAM | Inventory, ECC records where available, bounded memory tests or guided offline tests | Report a memory-subsystem fault and isolate further before naming a DIMM | A test can involve CPU, caches, controller, motherboard, and settings |
| Fans / cooling / liquid-cooling pumps | Exposed RPM, load, temperature, supported control-state information | Investigate inadequate cooling; suggest model-appropriate inspection or service | Zero RPM can be intentional; dust, paste condition, and coolant condition are not directly established by generic telemetry |
| Motherboard / power supply | Available board sensors, supported PSU telemetry, system error patterns | Report supporting evidence and recommend technician diagnosis if the cause remains uncertain | Do not assume ordinary software can measure capacitor wear or identify a faulty PSU from a restart |

Supporting documentation: [Windows battery information](https://learn.microsoft.com/en-us/windows/win32/power/battery-information-str) exposes capacities and cycle information; [Apple battery guidance](https://support.apple.com/en-us/108376) distinguishes reduced capacity from charging behavior; [PassMark's memory troubleshooting](https://www.memtest86.com/troubleshooting.htm) explains why errors do not always identify a defective RAM module; [NVIDIA's telemetry documentation](https://docs.nvidia.com/deploy/nvidia-smi/) describes device-dependent data availability.

External peripherals, displays, network devices, RAID/NAS systems, servers, and fleet management are separate expansion decisions. The first product focuses on internal laptop and desktop components. Unsupported configurations must still be recognized where possible and described honestly.

## 4. User experience requirements

| ID | Requirement |
| --- | --- |
| UX-01 | Installation explains what is collected, what stays local, and which features need extra permissions. Basic scanning must remain usable when elevation is declined. |
| UX-02 | One obvious “Scan computer” action starts the passive scan. Show progress, elapsed time, cancellation, partial results, and reasons for skipped checks. |
| UX-03 | Offer optional symptom intake: freezing, crashes, noise, heat, short battery life, slowness, or no current symptoms; record onset and recent hardware/software changes. |
| UX-04 | The result prioritizes actionable findings, identifies the affected component as precisely as evidence allows, and separates urgency from diagnostic certainty. |
| UX-05 | Every finding provides evidence, explanation, limitations, next action, and what additional test could change the conclusion. Technical details are expandable. |
| UX-06 | Show checks completed and unavailable for each component. “Permission denied,” “Not exposed by this hardware,” “Test not run,” and “Collector failed” are distinct outcomes. |
| UX-07 | Users can see earlier scans and meaningful changes, mark maintenance/replacement, and rescan to check the result. |
| UX-08 | Show findings and changes during user-initiated scans. Display the last scan date prominently; explain that changes between scans are not observed. No background health alerts or automatic scans. |
| UX-09 | Export a human-readable report and structured JSON with date, coverage, evidence, and application/rule versions. Redact identifiers by default and let the user preview exports. |
| UX-10 | Support keyboard navigation, screen readers, readable scaling, and text/icons alongside color. Initial language and localization scope remain open. |

Suggested flow: **Install → Understand access → Scan → Review evidence → Take action → Track changes.**

Avoid a single unexplained “87/100 PC health” score. A critical drive finding must remain prominent even if other components have no detected issues. Prefer a summary such as “1 urgent issue · 2 items to monitor · 3 checks unavailable.”

## 5. Diagnosis and recommendation requirements

| ID | Requirement |
| --- | --- |
| DX-01 | Each conclusion must trace to timestamped measurements, events, or test results and a versioned diagnostic rule. |
| DX-02 | Use model/vendor-specific definitions and operating limits when verified. Do not apply one thermal threshold or SMART attribute interpretation to all hardware. |
| DX-03 | Distinguish one-off events, cumulative historic counts, newly occurring errors, and recurring trends. Handle counter resets and stale data. |
| DX-04 | Consider alternative causes: driver problems, workload, power settings, overclocking/undervolting, memory profiles, cabling, firmware, and cooling. Report when these cannot be checked. |
| DX-05 | Do not require a trend before surfacing a present critical device warning. Conversely, do not turn an isolated ambiguous event into a definitive parts diagnosis. |
| DX-06 | Keep severity, evidence strength, and coverage separate. Use explained qualitative evidence levels until numerical confidence has been calibrated against labeled outcomes. |
| DX-07 | Missing or conflicting evidence must reduce certainty or produce an inconclusive result; it must never become a fabricated zero, a healthy result, or an invented measurement. |
| DX-08 | Recommendations progress through no action, monitor, maintenance, further test, service, planned replacement, or urgent protective action as the evidence warrants. |
| DX-09 | A replacement recommendation must identify the component or serviceable assembly, the reason, urgency, alternatives, and whether additional confirmation is needed. Never guess a specific DIMM or socket. |
| DX-10 | A suspected failing storage device should trigger a data-protection recommendation before optional intensive testing. Do not claim backups exist unless actually verified. |
| DX-11 | Separate “replace because of a fault” from “upgrade to improve performance.” Do not recommend replacing an entire computer when a serviceable component is sufficient. |
| DX-12 | If the root cause cannot be isolated, say so and give a useful diagnostic or service next step. This is a valid product outcome. |

A hardware error source is not necessarily the faulty replaceable component. Windows documents, for example, that a processor machine-check source can report cache, memory, and bus errors as well as processor errors. [Microsoft hardware error sources](https://learn.microsoft.com/en-us/windows-hardware/drivers/whea/hardware-errors-and-error-sources)

### Replacement guidance

The first release must identify what needs service and why and recommend exact compatible replacement products for its supported catalog. An offline compatibility database is therefore a launch dependency. Do not claim universal parts coverage.

Use a locally available, versioned compatibility catalog to verify the relevant constraints: computer/motherboard model, socket or slot, form factor, protocol, capacity limits, memory generation, power/connectors, physical clearance, cooling, and firmware requirements. Unknown constraints must be shown. Confirm whether the part is socketed, soldered, integrated, or serviced only as a larger assembly.

| ID | Exact-product recommendation requirement |
| --- | --- |
| PART-01 | Store manufacturer, exact model/part number, category, specifications, compatibility rules, provenance, catalog version, and last verified date. Separate verified compatibility from inferred or unknown compatibility. |
| PART-02 | Match the complete required constraint set. Examples include M.2 SATA versus NVMe, DDR generation and DIMM versus SO-DIMM, laptop battery model/connector, and model-specific firmware support. A matching brand, socket, or physical connector alone is insufficient. |
| PART-03 | Where chassis dimensions, occupied slots, motherboard revision, or another constraint cannot be collected reliably, ask the user for the specific missing information. Never silently label an unresolved match “compatible.” |
| PART-04 | Display at least one exact verified option for supported replacement cases, with why it fits, any prerequisites, and installation/service requirements. Show alternatives when catalog coverage supports them. |
| PART-05 | If the catalog lacks a verified option, state that limitation, identify the required specification or serviceable assembly when known, and provide a useful verification/service next step. Do not fabricate a product or recommend an unsupported purchase. |
| PART-06 | Ship the initial catalog in the offline bundle. Support signed/versioned offline catalog updates, integrity checks, rollback, and stale-data notices. Local diagnosis must continue to work if no update is available. |
| PART-07 | Test both valid and deceptively similar incompatible matches. Product compatibility, diagnostic certainty, and current retail availability must remain separate claims. |

For a solo developer, the proposed first catalog should cover a declared set of common storage/RAM upgrades and OEM-matched batteries on tested systems, then expand. Approve the actual supported device/category list during feasibility; do not present this suggestion as already confirmed scope. If a CPU, GPU, or motherboard replacement is advised outside catalog coverage, explain the verification gap.

Live price/stock lookup is outside the offline product scope. Any historical price information needs a region, currency, source, and date and must not imply current availability. Include offline service/compatibility summaries where redistribution permits, with optional source links for later reference. Do not invent warranty entitlement or universal compatibility. Commercial incentives must not alter fault severity or replacement decisions.

## 6. Manual scans and history

- **Passive scan:** inventory, exposed device health, existing diagnostic results, relevant error logs, and short sensor sampling. Default mode; no intentional stress workload or configuration changes.
- **Guided diagnostics:** explain why a test is useful, its expected duration, whether it needs a restart, and any workload it creates. Starting a device self-test is an explicit operation, even when it does not write user data.
- **Built-in active tests:** deferred beyond the first release. If introduced later, they must be individually selected, bounded, and cancellable, with preconditions and a watchdog. Do not stress a device when current evidence indicates urgent storage failure, unsafe thermal conditions, or another condition incompatible with testing.
- **Offline/reboot tests:** provide instructions and import or record results where feasible. Distinguish user-entered results from directly collected evidence. Do not pretend an ordinary running application has exhaustively tested all physical memory.
- **Manual operation:** sampling occurs only during an explicit scan or selected test. Stop collection when the session ends; do not install an automatically running monitor or schedule. A user may compare future manual scans with saved results.

Guided external tests must identify their provider, platform requirements, duration/reboot expectations, and whether the tool requires separate installation or internet access. PC Health's passive scan and core report remain fully offline. Recommend offline-capable external options where validated; distinguish instructions for an external tool from tests the application itself ran. Include external tools in an installation bundle only when redistribution is permitted.

History must associate observations with the same physical component, preserve collection time and data freshness, handle sleep/reboots and firmware changes, and start a new baseline after replacement. Device path or drive letter alone is not a stable identity. If identity is ambiguous, ask the user to identify the change rather than merging histories silently.

Trend comparisons should account for load, power mode, charging state, and other recorded context. The first scan can use trustworthy device-maintained history, but it must not invent an application-observed trend. Gaps between scans are unobserved intervals: the app cannot claim it watched conditions continuously or detected a problem when it first occurred.

## 7. Cross-platform support requirements

Use a shared diagnostic engine and explicit operating-system adapters. All three operating systems are launch requirements. Publish a tested support matrix by OS version, architecture, hardware family, and feature. “Cross-platform” does not imply identical telemetry or support for every device.

| Platform | Candidate collection routes to validate | Release requirement |
| --- | --- | --- |
| Windows | Device/storage/battery APIs, CIM/WMI, event logs, approved vendor interfaces | Validate minimum supported versions, standard-user/elevated behavior, and x64/ARM64 scope separately |
| macOS | Supported system inventory, battery/storage interfaces, available logs and sensor access | Validate Apple silicon and any Intel scope separately; use guided Apple Diagnostics when appropriate |
| Linux | sysfs/procfs, hwmon, kernel logs, device utilities and supported vendor interfaces | Name supported distributions, versions, architectures, privileges, and package/dependency expectations |

Linux's hwmon interface explicitly makes most sensor entries optional. The collector must discover capabilities rather than assume every temperature or fan field exists. [Linux hwmon interface](https://docs.kernel.org/hwmon/sysfs-interface.html)

Apple's documented hardware diagnostic flow runs through startup actions and reports reference codes. Treat that as a guided external workflow unless an appropriate supported integration is independently verified. [Apple Diagnostics](https://support.apple.com/en-us/102550)

Detect or clearly limit virtual machines, containers, RAID/storage controllers, unsupported bridges, missing drivers, and blocked permissions. Guest-visible hardware must not be represented as a complete assessment of the host's physical hardware. A fully privileged process still cannot access information the hardware or OS does not expose.

Before implementation commitments, define supported reference machines for each OS and required coverage on those machines. Each launch platform must deliver useful real inventory, applicable validated component checks, recommendations, history, and export—not just install successfully. Missing data must be explicit, and material gaps on a platform must be reviewed before claiming support. Define x64/ARM64, Apple silicon/Intel Mac, and Linux distribution coverage separately.

## 8. AI and system architecture

Proposed boundaries:

```text
Desktop interface
    → Scan coordinator and test policy
    → OS-specific collectors / narrow privileged helper
    → Normalized evidence + local history
    → Versioned diagnostic rules and recommendation policy
    → Offline plain-language report / optional local AI explanation
```

- The local engine produces findings without requiring a language model. AI can explain results, ask follow-up questions, and propose supported next tests.
- Any agentic test selection must go through the same allowlist, prerequisites, permission checks, and resource limits as manually selected tests.
- The model must not invent readings, change rule-derived urgency, claim unavailable checks ran, or execute arbitrary privileged commands.
- Treat logs, device names, imported reports, and retrieved text as untrusted data, including instructions embedded in them.
- Any AI that ships must run locally with no diagnostic-data transmission. Define model disk/RAM/CPU requirements and use a smaller model or rule-based explanations when resources are insufficient. Diagnosis must remain usable if the model fails.
- A complete installer or explicitly identified offline installation bundle must include required runtimes, rules, reference data, and model weights if AI is included. First use must not require a download, cloud login, or online activation to perform diagnostics. Users must be able to install and run on a disconnected computer.
- Verify local model and library redistribution rights. Restrict inference resource use so an already slow or unhealthy computer can still complete diagnostics. Local AI workloads must not contaminate measurements presented as idle conditions.
- Version collectors, schemas, diagnostic rules, reference data, prompts, and models so findings can be reproduced and investigated.

Minimum normalized data contract:

| Record | Required information |
| --- | --- |
| Component | Local ID, type, model/vendor when known, OS identifiers, physical/logical relationship, identity reliability, replaceability if verified |
| Measurement | Metric, raw and normalized values, unit, source, collection time, scope, quality, and availability reason |
| Test | Test/version, prerequisites, consent state, start/end, workload class, completion/abort reason, and result limitations |
| Finding | Category, severity, evidence strength and rationale, component/scope, evidence references, alternatives, rule version, current/historical status |
| Recommendation | Action, urgency, basis, prerequisites, alternatives, service/compatibility information, follow-up check |

Use null plus a reason for missing measurements. Preserve documented sentinel values and units; validate before deriving percentages. For battery capacity retention, only compute `full_charge_capacity / design_capacity × 100` when both values are valid and comparable. Label it an estimate of capacity retention, never a failure probability. Unknown or unsupported cycle counts must not be interpreted as proof of a new battery.

## 9. Privacy, permissions, and reliability

| ID | Requirement |
| --- | --- |
| SYS-01 | Collect hardware and relevant diagnostic information only; avoid personal file contents, credentials, and unrelated logs. Explain sensitive fields such as serial numbers and usernames. |
| SYS-02 | Store history locally with appropriate OS access controls; define retention, storage caps, export, and deletion. No diagnostic uploads, cloud sync, or automatic telemetry/crash-report transmission. Reports leave the app only through an explicit user export. |
| SYS-03 | Keep the interface unprivileged. Use a narrowly scoped helper with authenticated IPC and an explicit operation allowlist when elevation is needed. |
| SYS-04 | Sign/notarize installers where applicable; support verified update packages that can be transferred for offline installation, recovery from failed updates, and review of bundled drivers/utilities and redistribution terms. Never require disabling OS security protections. Test the actual offline installation experience on each supported OS. |
| SYS-05 | Isolate collector crashes and timeouts, bound concurrency, prevent overlapping device tests, and return partial results when a device disappears or collection fails. |
| SYS-06 | For any future built-in active tests, stop conditions must be enforced outside the AI layer. Loss of a required sensor or watchdog must stop the workload. The first release does not control third-party test workloads and must state that boundary. |
| SYS-07 | A scan must not change firmware, voltages, fan curves, drivers, boot settings, or user storage contents. Automated repair is outside the proposed initial scope. |
| SYS-08 | Start privileged collection helpers only for explicit operations where needed, with a documented lifecycle. No background collection or scan scheduling. Uninstall removes helpers; offer an explicit choice about retained history. |
| SYS-09 | Installation, scans, explanations, history, report export, and local licensing if introduced must work without internet access. Run offline acceptance tests with network access blocked and verify no application telemetry or cloud-inference requests occur. |

Provisional engineering targets, to confirm against a named reference hardware set:

- Passive scan p95 completion within 60 seconds, excluding user interaction and separately initiated device tests; display incomplete checks when bounded timeouts expire.
- Outside an active scan/test, no sensor polling or diagnostic workload. Open idle UI averages below 1% of total system CPU over a 30-minute idle run; idle UI/helper memory target below 200 MB, excluding an optional local model. Closing the application stops its workloads.
- Default history storage cap of 250 MB; proposed retention of 30 days of detailed samples and 12 months of summaries, configurable and validated for usefulness.
- UI acknowledges cancellation within one second. Test workloads stop within a documented bound; device self-tests that cannot stop immediately show that limitation rather than claiming cancellation succeeded.
- No intentional disk stress or reboot in passive mode; measure actual overhead, I/O, and battery impact during validation.

These are proposed acceptance budgets, not measured product performance.

## 10. Suggested release sequence

### Feasibility milestone

Build small collection prototypes on representative Windows, macOS, and Linux hardware. Confirm actual SSD/battery access, component identity, telemetry gaps, permission behavior, and safe collection costs. Record supported and unsupported cases before committing to feature parity or prediction claims. All three platforms remain part of the launch milestone.

### First useful release — proposed

Windows, macOS, and Linux at launch for the explicitly supported versions/architectures. Inventory, manual passive scans, applicable SSD/HDD and battery evidence, available thermal/error signals, clear coverage reporting, conservative action recommendations, exact replacement products backed by the supported offline catalog, local history, manual rescans, and report export. Ship useful offline rule-based explanations; local AI is an enhancement if selected. Include guided external/OEM test instructions where useful. No cloud dependency, background monitoring, or built-in intensive tests.

### Subsequent releases

Expand validated hardware coverage and parts catalogs on all three platforms, guided memory and OEM diagnostics, bounded active tests if selected later, symptom-driven investigation, and better cooling/GPU diagnosis. Add each hardware family only with appropriate coverage and diagnostic validation.

### Separate future scope

Population-trained failure prediction, exact remaining-useful-life estimation, parts purchasing, remote repair, technician workflows, business fleets, servers/NAS, and automated configuration changes. None is implied by the first release. Cloud diagnostic processing and background monitoring are excluded by the confirmed product choices; adding them would require a deliberate scope change.

## 11. Validation and release gates

Hardware diversity and diagnosis quality matter more than a large list of sensors. Maintain known-good and known-faulty devices, trusted captured fixtures, and reproducible scenarios across supported vendors/models and platforms. Dangerous failure cases should use existing faulty hardware or replayed evidence; do not intentionally damage devices for testing.

Required scenarios:

| Scenario | Expected behavior |
| --- | --- |
| Administrator access is declined | Basic scan completes; blocked checks and consequences are visible |
| No battery or no readable sensor exists | Not applicable/unavailable; no fabricated healthy score |
| NVMe endurance usage reaches or exceeds 100 | Preserve vendor meaning; no automatic “drive failed” or negative remaining-health value |
| Storage reports a current serious reliability warning | Prompt protective action even on the first scan; do not start optional intensive testing |
| Old error count stays unchanged | Distinguish historic evidence from a new incident |
| A memory test reports errors without reliable DIMM mapping | Report subsystem fault and isolation steps; do not name a particular RAM stick |
| CPU-source hardware error is observed | Interpret event evidence; do not assume the CPU itself needs replacement |
| Battery charge is intentionally limited or capacity data is invalid | Do not infer wear from charge level or divide by invalid capacity |
| Fan reads zero during supported idle-stop behavior | Do not diagnose fan failure solely from RPM |
| A device is replaced, renamed, or disappears | Correctly isolate history or mark identity uncertain; complete remaining scan |
| A collector hangs | Timeout according to policy; preserve partial evidence |
| Local AI cannot run, is wrong, or receives malicious log text | Local findings remain usable and consistent; no unauthorized command or altered severity |
| Report is exported or a scan is closed | Redaction matches the interface; collection stops after the active session |
| First install and first scan occur with networking blocked | All required assets are present and core workflows function without network access |
| Two manual scans are weeks apart | Show observations and their dates; do not claim continuous monitoring or an exact incident time |
| A product looks similar but fails one required compatibility constraint | Reject the match rather than labeling it compatible |
| Catalog is old or lacks a verified product for the detected system | Show the verification gap and next step; do not fabricate a recommendation or imply current stock |
| An external test is only described, not run | Mark it as not run; never treat the instructions as a completed diagnostic |
| A virtual machine is scanned | Coverage explicitly refers to the guest; no invented host assessment |

Before each public release:

- Every supported diagnostic rule has documented prerequisites, applicability, evidence, limits, and meaningful positive/negative cases.
- The test suite includes cases that must produce “inconclusive” rather than replacement advice.
- Measure false replacement recommendations and missed confirmed faults separately by component family. Publish scope and limitations; do not aggregate unlike tasks into one “accuracy” number.
- Have qualified hardware reviewers adjudicate a labeled evaluation set and define numeric quality thresholds before claiming diagnostic accuracy. Recheck rules after source/firmware changes.
- Verify permissions, install/update/uninstall, offline behavior, cancellation, export redaction, accessibility, and performance budgets on the supported matrix.
- Future lifetime/failure predictions require longitudinal outcomes, adequate follow-up, model-family and temporal validation, uncertainty calibration, and evidence of improvement over simpler baselines.

## 12. Decisions still needed

| Decision | Proposed default | Why it matters |
| --- | --- | --- |
| First audience — confirmed | Everyday laptop/desktop owners | Sets explanation depth, workflows, and support needs |
| Launch OS scope — confirmed | Windows, macOS, and Linux at launch | Exact OS versions and architectures still need definition |
| Scan mode — confirmed | Manual scans only | Saved scans support comparisons, with unobserved gaps |
| AI/data boundary — confirmed | Everything local and offline | Any included AI must run on-device |
| Recommendation depth — confirmed | Exact compatible replacement products | Requires a validated offline catalog and explicit coverage limits |
| Test scope — confirmed | Passive checks and guided external tests | Built-in intensive tests are deferred |
| Initial AI interface | Rule-based explanations; optional local conversation | Affects installer size, resource requirements, and offline model packaging |
| Business model | Undecided | Affects licensing/accounts and ongoing support; diagnostic truth must remain independent of sales |
| Team — confirmed | Solo developer | Keep shared logic and bound the initial supported hardware/catalog scope |
| Budget and target date | Not specified | Needed for an achievable delivery estimate and hardware test resources |
| Initial compatibility catalog | Curated supported systems/parts proposed | Sets maintenance workload and the exact products the app can safely recommend |
| Distribution and support | Signed direct installers proposed; support channel undecided | Affects packaging, updates, permissions, and user trust |
| Target regions/languages | Undecided | Affects service links, commercial recommendations, and localization |

Priority for the next discussion: define exact platform versions/architectures, reference machines, initial catalog coverage, and local AI requirements. Budget and timeline can follow when available. Implementation began after this requirements exercise. See README.md for the current development preview, validated behavior, and remaining release work.
