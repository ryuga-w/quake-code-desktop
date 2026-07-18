from PIL import Image
from pathlib import Path

src = Path(
    r"C:\Users\mustafa\.grok\sessions\C%3A%5Cquake%20code\019efb4c-75e1-75c0-8c0a-5e203f1a3054\assets\image-006d778c-f79c-4bc8-9e3f-7ad78556ea3f.png"
)
out = Path(r"C:\quake code\assets\purple-rail-slide-mockup.svg")
img = Image.open(src).convert("RGB")
w, h = img.size
SCALE = 4
DUR = 2.8
REVEAL = 1.05
TRAVEL = 28


def hexpx(px: tuple[int, int, int]) -> str:
    r, g, b = px
    return f"#{r:02x}{g:02x}{b:02x}"


def is_purple(px: tuple[int, int, int]) -> bool:
    r, g, b = px
    return b > r + 25 and r >= 33 and g >= 48 and b >= 68


BG = {(20, 20, 20), (25, 26, 27)}

pixel_rects: list[tuple[int, int, int, str, bool]] = []
for y in range(h):
    x = 0
    while x < w:
        px = img.getpixel((x, y))
        if px in BG:
            x += 1
            continue
        x0 = x
        color = hexpx(px)
        purple = is_purple(px)
        while x < w:
            px2 = img.getpixel((x, y))
            if px2 in BG or hexpx(px2) != color:
                break
            x += 1
        pixel_rects.append((x0, y, x - x0, color, purple))

H = h * SCALE
W = w * SCALE

scene_lines: list[str] = []
for x0, y, rw, color, purple in pixel_rects:
    fy = y * SCALE
    fx = x0 * SCALE
    fw = rw * SCALE
    delay = round((h - 1 - y) / max(1, h - 1) * REVEAL, 4)
    lift = TRAVEL if purple else max(8, TRAVEL // 2)
    scene_lines.append(
        f"""    <rect x="{fx}" y="{fy}" width="{fw}" height="{SCALE}" fill="{color}" opacity="0">
      <animate attributeName="y" values="{fy + lift};{fy + lift};{fy};{fy}" keyTimes="0;{delay/ DUR:.4f};{(delay + 0.42)/ DUR:.4f};1" dur="{DUR}s" repeatCount="indefinite" calcMode="spline" keySplines="0.22 1 0.36 1; 0 0 1 1; 0 0 1 1"/>
      <animate attributeName="opacity" values="0;0;1;1;1;0" keyTimes="0;{max(0, delay - 0.02)/ DUR:.4f};{delay/ DUR:.4f};{(delay + 0.5)/ DUR:.4f};0.82;1" dur="{DUR}s" repeatCount="indefinite"/>
    </rect>"""
    )

svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <title>Purple rail — colors rise bottom to top (pixel-matched)</title>
  <defs>
    <clipPath id="rise-clip">
      <rect x="0" width="{W}" height="0" y="{H}">
        <animate attributeName="height" values="0;{H};{H};0" keyTimes="0;0.38;0.78;1" dur="{DUR}s" repeatCount="indefinite" calcMode="spline" keySplines="0.22 1 0.36 1; 0 0 1 1; 0.4 0 1 1"/>
        <animate attributeName="y" values="{H};0;0;{H}" keyTimes="0;0.38;0.78;1" dur="{DUR}s" repeatCount="indefinite" calcMode="spline" keySplines="0.22 1 0.36 1; 0 0 1 1; 0.4 0 1 1"/>
      </rect>
    </clipPath>
    <linearGradient id="sweep" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#987ec7" stop-opacity="0"/>
      <stop offset="55%" stop-color="#987ec7" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#c4b5fd" stop-opacity="0.9"/>
    </linearGradient>
  </defs>

  <rect width="{W}" height="{H}" fill="#141414"/>

  <!-- Rising color sweep edge -->
  <rect x="0" width="{W}" height="0" y="{H}" fill="url(#sweep)" opacity="0.65">
    <animate attributeName="height" values="0;72;72;0" keyTimes="0;0.38;0.78;1" dur="{DUR}s" repeatCount="indefinite"/>
    <animate attributeName="y" values="{H};{H - 72};{H - 72};{H}" keyTimes="0;0.38;0.78;1" dur="{DUR}s" repeatCount="indefinite"/>
  </rect>

  <g id="pixel-colors" clip-path="url(#rise-clip)">
{chr(10).join(scene_lines)}
  </g>
</svg>
"""

out.write_text(svg, encoding="utf-8")
print(f"wrote {out} ({len(scene_lines)} rects, rise animation {DUR}s)")