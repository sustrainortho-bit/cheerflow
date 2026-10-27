"""CheerFlowのアプリアイコン（PWA・ホーム画面用）を生成する。
使い方: python tools/make_icons.py   → icons/ に PNG を書き出す
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
BG = (18, 16, 23)        # --bg
WHITE = (242, 238, 245)  # --text
PINK = (255, 92, 134)    # --accent
FONT = Path("C:/Windows/Fonts/impact.ttf")


def draw_icon(size, safe_ratio):
    """safe_ratio: 文字を収める領域の割合（maskableアイコンは周囲が切り抜かれるため小さめにする）"""
    scale = 4  # 大きく描いてから縮小し、輪郭をなめらかにする
    s = size * scale
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)
    box = s * safe_ratio
    font = ImageFont.truetype(str(FONT), int(box * 0.62))
    c_w = d.textlength("C", font=font)
    f_w = d.textlength("F", font=font)
    total = c_w + f_w
    x0 = (s - total) / 2
    ascent, descent = font.getmetrics()
    y0 = (s - (ascent + descent)) / 2 - s * 0.02
    d.text((x0, y0), "C", font=font, fill=WHITE)
    d.text((x0 + c_w, y0), "F", font=font, fill=PINK)
    # 床（ステージ）を表す下線
    bar_w = total * 0.92
    bar_h = s * 0.035
    by = y0 + ascent + descent * 0.2
    d.rounded_rectangle([(s - bar_w) / 2, by, (s + bar_w) / 2, by + bar_h], radius=bar_h / 2, fill=PINK)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    draw_icon(192, 0.78).save(OUT / "icon-192.png")
    draw_icon(512, 0.78).save(OUT / "icon-512.png")
    draw_icon(512, 0.62).save(OUT / "icon-maskable-512.png")
    draw_icon(180, 0.78).save(OUT / "apple-touch-icon.png")
    print("wrote", sorted(p.name for p in OUT.glob("*.png")))


if __name__ == "__main__":
    main()
