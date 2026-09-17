// Regenerate the original application icon on macOS: swift scripts/make-icon.swift
import AppKit

let size = 1024
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSGraphicsContext.current?.imageInterpolation = .high
let ink = NSColor(calibratedRed: 0.055, green: 0.043, blue: 0.067, alpha: 1)
let coral = NSColor(calibratedRed: 1, green: 0.392, blue: 0.455, alpha: 1)
let cyan = NSColor(calibratedRed: 0.475, green: 0.894, blue: 0.875, alpha: 1)

ink.setFill()
NSBezierPath(roundedRect: NSRect(x: 64, y: 64, width: 896, height: 896), xRadius: 202, yRadius: 202).fill()

func stroke(_ points: [NSPoint], _ color: NSColor, _ width: CGFloat, closed: Bool = false) {
    let path = NSBezierPath()
    path.lineWidth = width
    path.lineJoinStyle = .miter
    path.lineCapStyle = .square
    path.move(to: points[0])
    for point in points.dropFirst() { path.line(to: point) }
    if closed { path.close() }
    color.setStroke()
    path.stroke()
}

// Clipped coral frame; the cyan die is the same hardware motif used in the app.
stroke([NSPoint(x: 180, y: 180), NSPoint(x: 746, y: 180), NSPoint(x: 844, y: 278), NSPoint(x: 844, y: 844), NSPoint(x: 180, y: 844)], coral, 14, closed: true)
let body = NSRect(x: 338, y: 338, width: 348, height: 348)
coral.setStroke()
let chip = NSBezierPath(rect: body)
chip.lineWidth = 26
chip.stroke()
for coordinate in [390.0, 471.0, 552.0, 633.0] {
    stroke([NSPoint(x: coordinate, y: 698), NSPoint(x: coordinate, y: 758)], coral, 23)
    stroke([NSPoint(x: coordinate, y: 266), NSPoint(x: coordinate, y: 326)], coral, 23)
    stroke([NSPoint(x: 266, y: coordinate), NSPoint(x: 326, y: coordinate)], coral, 23)
    stroke([NSPoint(x: 698, y: coordinate), NSPoint(x: 758, y: coordinate)], coral, 23)
}
NSColor(calibratedRed: 0.082, green: 0.176, blue: 0.192, alpha: 1).setFill()
let die = NSBezierPath(rect: NSRect(x: 420, y: 420, width: 184, height: 184))
die.fill()
cyan.setStroke()
die.lineWidth = 22
die.stroke()

NSGraphicsContext.restoreGraphicsState()
try FileManager.default.createDirectory(atPath: "build", withIntermediateDirectories: true)
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "build/icon.png"))
