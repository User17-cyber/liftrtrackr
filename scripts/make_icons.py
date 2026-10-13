"""Draw the LiftrTrackr app icon (a plate above a heavy ledger rule) as PNGs, no dependencies.

Usage: python3 -I scripts/make_icons.py <out_dir>
Writes apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png, icon.svg.
"""
import math, os, struct, sys, zlib

BG = (30, 90, 69)        # spinach green, the app's accent
FG = (243, 245, 239)     # off-white
SS = 4                   # supersamples per axis


def shapes(scale):
    """Shapes in unit coordinates, scaled about the centre (maskable icons need a safe zone)."""
    def s(v):
        return 0.5 + (v - 0.5) * scale
    r = scale
    return [
        ("ring", s(0.5), s(0.42), 0.27 * r, 0.06 * r),     # plate rim
        ("ring", s(0.5), s(0.42), 0.165 * r, 0.022 * r),   # plate well
        ("rect", s(0.2), s(0.77), s(0.8), s(0.835)),       # ledger rule
    ]


def covered(x, y, shp):
    for sh in shp:
        if sh[0] == "ring":
            _, cx, cy, rad, w = sh
            d = math.hypot(x - cx, y - cy)
            if rad - w / 2 <= d <= rad + w / 2:
                return True
        else:
            _, x0, y0, x1, y1 = sh
            if x0 <= x <= x1 and y0 <= y <= y1:
                return True
    return False


def render(n, scale):
    shp = shapes(scale)
    rows = []
    for py in range(n):
        row = bytearray([0])  # filter type 0
        for px in range(n):
            hits = sum(covered((px + (i + 0.5) / SS) / n, (py + (j + 0.5) / SS) / n, shp)
                       for i in range(SS) for j in range(SS))
            a = hits / (SS * SS)
            row += bytes(round(BG[k] * (1 - a) + FG[k] * a) for k in range(3))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="rgb(30,90,69)"/>
<circle cx="50" cy="42" r="27" fill="none" stroke="rgb(243,245,239)" stroke-width="6"/>
<circle cx="50" cy="42" r="16.5" fill="none" stroke="rgb(243,245,239)" stroke-width="2.2"/>
<rect x="20" y="77" width="60" height="6.5" fill="rgb(243,245,239)"/>
</svg>
"""


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for name, n, scale in [("apple-touch-icon.png", 180, 1.0), ("icon-192.png", 192, 1.0),
                           ("icon-512.png", 512, 1.0), ("icon-maskable-512.png", 512, 0.78)]:
        with open(os.path.join(out, name), "wb") as f:
            f.write(render(n, scale))
    with open(os.path.join(out, "icon.svg"), "w") as f:
        f.write(SVG)
    print("icons written to", out)


if __name__ == "__main__":
    main()
