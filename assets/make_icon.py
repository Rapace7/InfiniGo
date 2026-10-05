# -*- coding: utf-8 -*-
"""生成「玄清围弈」的图标（PNG / ICO / SVG 设计稿）。

设计：主题青绿（--accent #2f6f5e）圆角方块 + 淡淡一层的棋盘线 + 一白一黑两枚棋子。
      配色全部取自 renderer/style.css 的 :root，不另发明一套。

★ 为什么用代码画而不是拿 AI 图去缩：图标最小要缩到 16px，画出来的几何图形才扛得住；
  而且 Pillow 不做抗锯齿 —— 所以在 **4 倍尺寸**上画，再 LANCZOS 缩回来。

用法（必须用 default venv 的 python）：
  C:/Users/rapac/.workbuddy/binaries/python/envs/default/Scripts/python.exe assets/make_icon.py
产物：
  assets/icon-512.png / icon-256.png / app.ico（多尺寸）/ icon.svg（设计稿）
  另外写一张多尺寸预览图到 _trash/_icon_preview.png 供人眼验收
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PREVIEW = os.path.join(os.path.dirname(HERE), '_trash', '_icon_preview.png')

S = 512            # 输出尺寸
K = 4              # 超采样倍数
W = S * K          # 实际画布

# ---- 配色（与 renderer/style.css 的 :root 一致）----
ACCENT    = (47, 111, 94)     # --accent  #2f6f5e
ACCENT_DK = (30, 76, 64)      # 渐变深端
LINE_C    = (247, 246, 243)   # 棋盘线（--bg 浅色，半透明）
STONE_W   = (247, 246, 243)   # 白子
STONE_B   = (40, 40, 38)      # 黑子（比 --text 稍深，缩小时轮廓更清楚）

RADIUS = int(W * 0.225)       # 圆角半径
INSET  = W * 0.175            # 棋盘四周留白
CELL   = (W - 2 * INSET) / 4  # 4 格 → 5 条线
LW     = max(2, int(W * 0.0135))          # 线宽
STONE_R = CELL * 0.52                     # 棋子半径（略大于半格，看着饱满）


def hgrad(size, c1, c2):
    """水平渐变（先画 1 像素高的条再拉伸，比逐像素画整张快得多）"""
    bar = Image.new('RGB', (size, 1))
    d = ImageDraw.Draw(bar)
    for x in range(size):
        t = x / (size - 1)
        d.point((x, 0), tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)))
    return bar.resize((size, size), Image.BILINEAR)


def stone(draw, cx, cy, r, fill, edge, edge_w):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=edge, width=edge_w)


def build():
    # ① 底：渐变 + 圆角裁切
    base = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    mask = Image.new('L', (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=RADIUS, fill=255)
    base.paste(hgrad(W, ACCENT, ACCENT_DK).convert('RGBA'), (0, 0), mask)

    # ② 棋盘线（半透明 → 必须画在独立图层上再合成，直接画会覆盖掉底色的 alpha）
    ov = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for i in range(5):
        p = INSET + i * CELL
        od.line([(INSET, p), (W - INSET, p)], fill=LINE_C + (72,), width=LW)
        od.line([(p, INSET), (p, W - INSET)], fill=LINE_C + (72,), width=LW)
    base = Image.alpha_composite(base, ov)

    # ③ 两枚棋子：白子在 (1,1)，黑子在 (3,3)（对角摆，缩到 16px 也能看出「一深一浅」）
    ov = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    ew = max(2, int(W * 0.006))
    w1 = INSET + 1 * CELL
    b3 = INSET + 3 * CELL
    # 落子处的柔和阴影（小尺寸看不出来，大尺寸更好看）
    for (cx, cy) in [(w1, w1), (b3, b3)]:
        od.ellipse([cx - STONE_R * 1.06, cy - STONE_R * 1.06 + ew * 2,
                    cx + STONE_R * 1.06, cy + STONE_R * 1.06 + ew * 2], fill=(0, 0, 0, 46))
    stone(od, w1, w1, STONE_R, STONE_W, (0, 0, 0, 40), ew)
    stone(od, b3, b3, STONE_R, STONE_B, (255, 255, 255, 60), ew)
    base = Image.alpha_composite(base, ov)

    # ④ 缩回目标尺寸
    big = base.resize((S, S), Image.LANCZOS)

    big.save(os.path.join(HERE, 'icon-512.png'), 'PNG', optimize=True)
    big.resize((256, 256), Image.LANCZOS).save(os.path.join(HERE, 'icon-256.png'), 'PNG', optimize=True)
    big.resize((256, 256), Image.LANCZOS).save(
        os.path.join(HERE, 'app.ico'), 'ICO',
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    # ⑤ 矢量设计稿（参数与上面一一对应，将来改图有源可依）
    def f(v):
        return round(v / W * 100, 2)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2f6f5e"/><stop offset="1" stop-color="#1e4c40"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="100" height="100" rx="{f(RADIUS)}" fill="url(#g)"/>
  <g stroke="#f7f6f3" stroke-opacity="0.28" stroke-width="{f(LW)}">
'''
    for i in range(5):
        p = f(INSET + i * CELL)
        svg += f'    <path d="M{f(INSET)} {p} H{f(W - INSET)} M{p} {f(INSET)} V{f(W - INSET)}"/>\n'
    svg += '  </g>\n'
    c1 = f(INSET + CELL)
    c3 = f(INSET + 3 * CELL)
    r = f(STONE_R)
    svg += f'''  <circle cx="{c1}" cy="{c1}" r="{r}" fill="#f7f6f3" stroke="rgba(0,0,0,.16)" stroke-width="0.3"/>
  <circle cx="{c3}" cy="{c3}" r="{r}" fill="#282826" stroke="rgba(255,255,255,.24)" stroke-width="0.3"/>
</svg>
'''
    with open(os.path.join(HERE, 'icon.svg'), 'w', encoding='utf-8') as fh:
        fh.write(svg)

    # ⑥ 预览图（验收必做：确认最小尺寸还能认出是什么）
    sizes = [16, 20, 24, 32, 48, 64, 128]
    pad = 12
    pw = sum(s + pad for s in sizes) + pad
    ph = 128 + pad * 3 + 24
    pv = Image.new('RGB', (pw, ph), (240, 240, 238))
    x = pad
    d = ImageDraw.Draw(pv)
    for s in sizes:
        im = big.resize((s, s), Image.LANCZOS)
        pv.paste(im, (x, pad + (128 - s) // 2), im)
        d.text((x, 128 + pad * 2), str(s), fill=(90, 90, 88))
        x += s + pad
    os.makedirs(os.path.dirname(OUT_PREVIEW), exist_ok=True)
    pv.save(OUT_PREVIEW)
    print('OK  512/256/ico/svg →', HERE)
    print('    预览图 →', OUT_PREVIEW)


if __name__ == '__main__':
    build()
