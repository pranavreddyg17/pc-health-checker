// Read-only native telemetry. No SMC writes, privileged helpers or stress tests.
import Foundation
import Darwin
import Metal

func readInteger(_ name: String) -> Int32? {
    var value: Int32 = 0
    var size = MemoryLayout<Int32>.size
    return sysctlbyname(name, &value, &size, nil, 0) == 0 ? value : nil
}

var result: [String: Any] = ["schemaVersion": 1]
let state = ProcessInfo.processInfo.thermalState
let names: [ProcessInfo.ThermalState: String] = [
    .nominal: "nominal", .fair: "fair", .serious: "serious", .critical: "critical"
]
result["thermalState"] = names[state] ?? "unknown"
// Apple kernel pressure levels: 1 normal, 2 warning, 4 critical. Omit on unsupported kernels.
if let pressure = readInteger("kern.memorystatus_vm_pressure_level") {
    result["memoryPressure"] = pressure
}
var swap = xsw_usage()
var swapSize = MemoryLayout<xsw_usage>.size
if sysctlbyname("vm.swapusage", &swap, &swapSize, nil, 0) == 0 {
    result["swapUsedBytes"] = swap.xsu_used
    result["swapTotalBytes"] = swap.xsu_total
}
result["physicalMemoryBytes"] = ProcessInfo.processInfo.physicalMemory
result["uptimeSeconds"] = ProcessInfo.processInfo.systemUptime
result["gpus"] = MTLCopyAllDevices().map { device in
    ["name": device.name, "unifiedMemory": device.hasUnifiedMemory,
     "lowPower": device.isLowPower, "removable": device.isRemovable] as [String: Any]
}
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data([10]))
