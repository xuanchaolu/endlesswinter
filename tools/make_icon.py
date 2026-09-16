#!/usr/bin/env python3
"""无尽冬日 · App 图标生成器（纯标准库：zlib + struct，输出 1024×1024 PNG）
夜空渐变 → 星星 → 雪原 → 发光雪花 → 炉火 → SDF 圆角遮罩（抗锯齿）→ 轮廓高光
"""
import struct, zlib, math, random, sys

S = 1024
CX, CY = S * 0.5, S * 0.60          # 雪花中心
R = S * 0.235                        # 雪花半径
MARGIN = S * 0.10                    # 图标主体边距（macOS 规范约 80% 占比）
RAD = S * 0.185                      # 圆角半径
buf = bytearray(S * S * 4)           # RGBA


# ---------- 圆角矩形 SDF ----------
def sdf_rounded(x, y, margin, radius):
    """到圆角矩形边界的有向距离：负=内部，正=外部"""
    half = (S - 2 * margin) / 2.0
    qx = abs(x - S / 2.0) - (half - radius)
    qy = abs(y - S / 2.0) - (half - radius)
    dx = max(qx, 0.0)
    dy = max(qy, 0.0)
    return math.hypot(dx, dy) + min(max(qx, qy), 0.0) - radius


def px(x, y, rgba):
    """普通混合写入（rgba: r,g,b,a 均为 0-255）"""
    if x < 0 or y < 0 or x >= S or y >= S:
        return
    i = (y * S + x) * 4
    sa = rgba[3] / 255.0
    da = buf[i + 3] / 255.0
    oa = sa + da * (1 - sa)
    if oa <= 0:
        return
    for c in range(3):
        buf[i + c] = int((rgba[c] * sa + buf[i + c] * da * (1 - sa)) / oa)
    buf[i + 3] = int(oa * 255)


def disc(cx, cy, rad, color, alpha=255, soft=1.5):
    """软边圆盘"""
    for yy in range(int(cy - rad - soft), int(cy + rad + soft) + 1):
        for xx in range(int(cx - rad - soft), int(cx + rad + soft) + 1):
            d = math.hypot(xx - cx, yy - cy)
            if d <= rad:
                a = alpha
            elif d <= rad + soft:
                a = int(alpha * (1 - (d - rad) / soft))
            else:
                continue
            px(xx, yy, (*color, a))


def line(x0, y0, x1, y1, w, color, alpha=255):
    """粗线段：沿线打点 + 圆盘"""
    length = max(1.0, math.hypot(x1 - x0, y1 - y0))
    steps = int(length * 2)
    for i in range(steps + 1):
        t = i / steps
        disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, color, alpha)


# ---------- 1. 夜空渐变（先铺满，最终由 SDF 统一裁形） ----------
top = (11, 25, 56)
bot = (30, 69, 119)
for y in range(S):
    for x in range(S):
        t = min(1.0, max(0.0, (y / S) * 0.75 + (x / S) * 0.25))
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        px(x, y, (r, g, b, 255))

# ---------- 2. 星星 ----------
rng = random.Random(20250824)
for _ in range(120):
    sx = rng.uniform(MARGIN + 10, S - MARGIN - 10)
    sy = rng.uniform(MARGIN + 10, S * 0.72)
    sr = rng.uniform(1.0, 3.6)
    salpha = int(rng.uniform(90, 230))
    disc(sx, sy, sr, (235, 242, 255), salpha)

# ---------- 3. 雪原 ----------
disc(S * 0.5, S * 1.18, S * 0.78, (230, 237, 245), 255)
disc(S * 0.36, S * 1.28, S * 0.52, (208, 218, 232), 255)

# ---------- 4. 发光雪花 ----------
glow = (180, 220, 255)
line(CX, CY, CX, CY - R, S * 0.052, glow, 70)      # 光晕底
line(CX, CY, CX, CY + R, S * 0.052, glow, 70)
disc(CX, CY, R * 1.06, (140, 200, 255), 26, soft=S*0.02)
white = (255, 255, 255)
for arm in range(6):
    ang = arm * math.pi / 3
    ex, ey = CX + math.sin(ang) * R, CY - math.cos(ang) * R
    line(CX, CY, ex, ey, S * 0.030, white, 245)
    for frac, blen in ((0.52, 0.30), (0.78, 0.20)):
        bx = CX + math.sin(ang) * R * frac
        by = CY - math.cos(ang) * R * frac
        for sgn in (-1, 1):
            bang = ang + sgn * math.pi / 5.2
            tx = bx + math.sin(bang) * R * blen
            ty = by - math.cos(bang) * R * blen
            line(bx, by, tx, ty, S * 0.022, white, 235)
    disc(ex, ey, S * 0.013, white, 250)
for arm in range(6):                                 # 中心核
    ang = arm * math.pi / 3
    disc(CX + math.cos(ang) * S * 0.033, CY + math.sin(ang) * S * 0.033,
         S * 0.017, white, 250)
disc(CX, CY, S * 0.020, white, 255)

# ---------- 5. 炉火（叠加在雪地上） ----------
fx, fy = S * 0.5, S * 0.315
disc(fx, fy, S * 0.115, (255, 120, 40), 110, soft=S * 0.05)   # 大范围暖光
disc(fx, fy + S * 0.005, S * 0.078, (255, 133, 41), 235, soft=S * 0.012)
disc(fx - S * 0.005, fy + S * 0.012, S * 0.052, (255, 179, 71), 245, soft=S * 0.010)
disc(fx - S * 0.010, fy + S * 0.018, S * 0.031, (255, 226, 138), 255, soft=S * 0.008)
# 火苗尖
for i, (dy, wdt, col) in enumerate([(0.030, 0.030, (255, 170, 60)),
                                    (0.048, 0.019, (255, 200, 100))]):
    disc(fx - S * 0.012 - i * S * 0.002, fy - dy * S, wdt * S, col, 240, soft=S * 0.008)

# ---------- 6. 最终处理：SDF 抗锯齿裁形 + 轮廓高光描边 ----------
INSET = S * 0.008
for yy in range(S):
    for xx in range(S):
        i = (yy * S + xx) * 4
        d = sdf_rounded(xx + 0.5, yy + 0.5, MARGIN, RAD)
        cov = max(0.0, min(1.0, (1.0 - d) / 2.0))   # 边界两侧各 ~1px 的平滑过渡带
        if cov <= 0.0:
            buf[i] = buf[i+1] = buf[i+2] = buf[i+3] = 0
            continue
        # 内描边高光：沿内缩平行轮廓的白色细线
        d2 = sdf_rounded(xx + 0.5, yy + 0.5, MARGIN + INSET, RAD)
        ha = 30 * max(0.0, 1.0 - abs(d2) / 1.8)
        if ha > 0:
            sa = ha / 255.0
            da = buf[i + 3] / 255.0
            oa = sa + da * (1 - sa)
            if oa > 0:
                for c in range(3):
                    buf[i + c] = int((255 * sa + buf[i + c] * da * (1 - sa)) / oa)
                buf[i + 3] = int(oa * 255)
        buf[i + 3] = int(buf[i + 3] * cov)

# ---------- 写 PNG ----------
raw = b"".join(b"\x00" + bytes(buf[y * S * 4:(y + 1) * S * 4]) for y in range(S))


def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(raw, 9))
       + chunk(b"IEND", b""))

out = sys.argv[1] if len(sys.argv) > 1 else "icon_1024.png"
with open(out, "wb") as f:
    f.write(png)
print(f"icon written -> {out}")
