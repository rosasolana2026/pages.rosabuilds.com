#!/usr/bin/env python3
"""
gen-demo-video.py — Generate a 30-second demo video for pages.rosabuilds.com
Uses Pillow for frame rendering + ffmpeg for encoding.
Output: static/demo.mp4
"""
import os, sys, math, subprocess, tempfile, shutil
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Install Pillow: pip install Pillow")

# ---- Config ----
W, H = 1280, 720
FPS = 24
DURATION = 30
TOTAL_FRAMES = FPS * DURATION

# Colors
BG      = (10, 10, 10)
DARK    = (17, 17, 17)
PANEL   = (20, 14, 10)
ROSE    = (155, 48, 96)
ROSE2   = (194, 71, 110)
GREEN   = (40, 200, 64)
TEXT    = (232, 221, 212)
DIM     = (90, 74, 64)
COMMENT = (70, 56, 50)
FLAG    = (126, 200, 227)
STR_    = (184, 224, 160)
KEY     = (240, 198, 116)
PROMPT  = ROSE2
WHITE   = (255, 255, 255)
GREY    = (80, 80, 80)
MED     = (45, 45, 45)

# Font setup — use system monospace
def load_font(size, mono=True):
    candidates_mono = [
        "/System/Library/Fonts/Courier.dfont",
        "/System/Library/Fonts/Monaco.dfont",
        "/Library/Fonts/Courier New.ttf",
        "/usr/share/fonts/truetype/courier-prime/CourierPrime-Regular.ttf",
    ]
    candidates_sans = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    candidates = candidates_mono if mono else candidates_sans
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()

FONT_MONO_SM  = load_font(14, mono=True)
FONT_MONO     = load_font(18, mono=True)
FONT_MONO_LG  = load_font(22, mono=True)
FONT_SANS     = load_font(22, mono=False)
FONT_SANS_LG  = load_font(52, mono=False)
FONT_SANS_MED = load_font(28, mono=False)
FONT_SANS_SM  = load_font(16, mono=False)
FONT_MONO_TINY= load_font(13, mono=True)

# ---- Helpers ----
def ease_in_out(t):
    return t * t * (3 - 2 * t)

def alpha_blend(c1, c2, a):
    """Blend c2 into c1 with alpha a (0..1)"""
    return tuple(int(c1[i] * (1 - a) + c2[i] * a) for i in range(3))

def fade(img, alpha):
    """Fade image to black"""
    overlay = Image.new("RGB", img.size, (0, 0, 0))
    return Image.blend(img, overlay, 1 - alpha)

def draw_text_line(draw, x, y, parts, font=None):
    """Draw multi-colored text. parts = [(color, text), ...]"""
    if font is None:
        font = FONT_MONO
    cx = x
    for color, text in parts:
        draw.text((cx, y), text, font=font, fill=color)
        bbox = font.getbbox(text)
        cx += bbox[2] - bbox[0]
    return cx

def draw_terminal_bar(draw, w, h):
    draw.rectangle([0, 0, w, 38], fill=PANEL)
    draw.line([0, 38, w, 38], fill=(255,255,255,13))
    # Traffic dots
    for i, color in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        cx = 20 + i * 20
        draw.ellipse([cx-5, 19-5, cx+5, 19+5], fill=color)
    # Title
    title = "bash — pages.rosabuilds.com"
    bbox = FONT_MONO_TINY.getbbox(title)
    tw = bbox[2] - bbox[0]
    draw.text(((w - tw) // 2, 13), title, font=FONT_MONO_TINY, fill=DIM)

# ---- Scene definitions (frame ranges) ----
# t = frame / FPS  (seconds)
#
# 0  - 2.5s  : Title card
# 2.5- 12.5s : Terminal typing
# 12.5-17s   : JSON response reveals
# 17 - 25s   : "Browser" shows deployed page
# 25 - 30s   : Final tagline card
#

SCENE_TRANSITIONS = [
    (0,    2.5),   # title
    (2.5,  12.5),  # terminal
    (12.5, 17.0),  # response
    (17.0, 25.0),  # browser
    (25.0, 30.0),  # final
]

TERMINAL_LINES = [
    [(COMMENT, "# Your agent just built something. Deploy it.")],
    [(TEXT, "")],
    [(PROMPT, "$ "), (TEXT, "curl "), (FLAG, "-X POST "), (TEXT, "https://pages.rosabuilds.com/api/upload \\")],
    [(TEXT, "    "), (FLAG, "-H "), (STR_, '"x-api-key: '), (KEY, "$PAGES_API_KEY"), (STR_, '" \\')],
    [(TEXT, "    "), (FLAG, "-H "), (STR_, '"Content-Type: application/json" \\')],
    [(TEXT, "    "), (FLAG, "-d "), (STR_, "'"), (TEXT, "{"), (STR_, '"files"'), (TEXT, ":[{"), (STR_, '"path"'), (TEXT, ":"), (STR_, '"index.html"'), (TEXT, ","), (STR_, '"content"'), (TEXT, ":"), (STR_, '"BASE64"'), (TEXT, "}]}'")],
    [(TEXT, "")],
]

RESPONSE_LINES = [
    [(DIM, "{")],
    [(DIM, "  "), (STR_, '"url"'), (DIM, ": "), (STR_, '"https://a3f9c12e.pages.rosabuilds.com"'), (DIM, ",")],
    [(DIM, "  "), (KEY, '"id"'), (DIM, ": "), (KEY, '"a3f9c12e"')],
    [(DIM, "}")],
]

def render_frame(frame_idx):
    t = frame_idx / FPS
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # ============================
    # SCENE 1: Title card (0–2.5s)
    # ============================
    if t < 2.5:
        # Fade in
        fade_a = min(1.0, t / 0.6)
        # Fade out at end of scene
        if t > 2.0:
            fade_a *= max(0.0, 1.0 - (t - 2.0) / 0.5)

        title = "pages.rosabuilds.com"
        sub   = "Instant hosting for AI agents"
        tb = FONT_SANS_LG.getbbox(title)
        sb = FONT_SANS_SM.getbbox(sub)

        tc = alpha_blend(BG, WHITE, fade_a)
        sc = alpha_blend(BG, DIM, fade_a)

        draw.text(((W - (tb[2]-tb[0])) // 2, H//2 - 48), title, font=FONT_SANS_LG, fill=tc)
        draw.text(((W - (sb[2]-sb[0])) // 2, H//2 + 24), sub, font=FONT_SANS_SM, fill=sc)

        # Rose accent line
        line_w = int((tb[2]-tb[0]) * fade_a)
        lx = (W - (tb[2]-tb[0])) // 2
        if line_w > 0:
            draw.rectangle([lx, H//2 + 60, lx + line_w, H//2 + 64], fill=ROSE)

    # ============================
    # SCENE 2: Terminal typing (2.5–12.5s)
    # ============================
    elif t < 12.5:
        st = t - 2.5  # scene-local time (0..10)

        # Fade in
        fade_a = min(1.0, st / 0.4)
        if t > 12.0:
            fade_a *= max(0.0, 1.0 - (t - 12.0) / 0.5)

        # Draw terminal panel
        draw.rectangle([60, 40, W-60, H-60], fill=DARK)
        draw_terminal_bar(draw, W-120, H-100)  # relative, offset by (60,40)

        # Adjust draw context to terminal
        TX = 60; TY = 40
        draw.rectangle([TX, TY, W-TX, H-TY], fill=DARK)
        # Bar inside terminal
        draw.rectangle([TX, TY, W-TX, TY+38], fill=PANEL)
        draw.line([TX, TY+38, W-TX, TY+38], fill=(50,40,36))
        # Dots
        for i, color in enumerate([(255,95,87),(254,188,46),(40,200,64)]):
            cx = TX + 20 + i * 20
            draw.ellipse([cx-5, TY+19-5, cx+5, TY+19+5], fill=color)
        title = "bash — pages.rosabuilds.com"
        tb2 = FONT_MONO_TINY.getbbox(title)
        draw.text(((W - (tb2[2]-tb2[0])) // 2, TY+13), title, font=FONT_MONO_TINY, fill=DIM)

        LX = TX + 32
        LY = TY + 52
        LH = 28

        # Lines appear one by one
        line_delays = [0.2, 0.5, 0.9, 2.8, 4.8, 6.2, 7.5]

        for i, parts in enumerate(TERMINAL_LINES):
            delay = line_delays[i] if i < len(line_delays) else 0
            if st >= delay:
                line_fade = min(1.0, (st - delay) / 0.25) * fade_a
                cy = LY + i * LH
                cx = LX
                for color, text in parts:
                    blended = alpha_blend(DARK, color, line_fade)
                    if text:
                        draw.text((cx, cy), text, font=FONT_MONO, fill=blended)
                        b = FONT_MONO.getbbox(text)
                        cx += b[2] - b[0]

        # Blinking cursor after last visible line
        last_visible = sum(1 for d in line_delays if st >= d) - 1
        last_visible = max(0, min(last_visible, len(TERMINAL_LINES)-1))
        if int(st * 2) % 2 == 0:
            cy = LY + last_visible * LH
            # estimate x of last line
            cx = LX + 20
            draw.rectangle([cx, cy+2, cx+10, cy+20], fill=ROSE2)

    # ============================
    # SCENE 3: Response (12.5–17s)
    # ============================
    elif t < 17.0:
        st = t - 12.5  # 0..4.5
        fade_a = min(1.0, st / 0.4)
        if t > 16.5:
            fade_a *= max(0.0, 1.0 - (t - 16.5) / 0.5)

        TX = 60; TY = 40
        draw.rectangle([TX, TY, W-TX, H-TY], fill=DARK)
        draw.rectangle([TX, TY, W-TX, TY+38], fill=PANEL)
        for i, color in enumerate([(255,95,87),(254,188,46),(40,200,64)]):
            cx = TX + 20 + i * 20
            draw.ellipse([cx-5, TY+19-5, cx+5, TY+19+5], fill=color)
        title = "bash — pages.rosabuilds.com"
        tb2 = FONT_MONO_TINY.getbbox(title)
        draw.text(((W - (tb2[2]-tb2[0])) // 2, TY+13), title, font=FONT_MONO_TINY, fill=DIM)

        LX = TX + 32; LY = TY + 52; LH = 28
        line_delays_cmd = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        for i, parts in enumerate(TERMINAL_LINES):
            cy = LY + i * LH
            cx = LX
            for color, text in parts:
                if text:
                    draw.text((cx, cy), text, font=FONT_MONO, fill=color)
                    b = FONT_MONO.getbbox(text)
                    cx += b[2] - b[0]

        # Separator line
        sep_y = LY + len(TERMINAL_LINES) * LH + 4
        draw.line([LX, sep_y, W-TX-32, sep_y], fill=(50,40,36))

        # Response lines appear
        resp_delays = [0.3, 0.7, 1.0, 1.3]
        for i, parts in enumerate(RESPONSE_LINES):
            delay = resp_delays[i]
            if st >= delay:
                rf = min(1.0, (st - delay) / 0.3) * fade_a
                cy = sep_y + 8 + i * LH
                cx = LX
                for color, text in parts:
                    blended = alpha_blend(DARK, color, rf)
                    if text:
                        draw.text((cx, cy), text, font=FONT_MONO, fill=blended)
                        b = FONT_MONO.getbbox(text)
                        cx += b[2] - b[0]

    # ============================
    # SCENE 4: Browser (17–25s)
    # ============================
    elif t < 25.0:
        st = t - 17.0  # 0..8
        browser_in = min(1.0, ease_in_out(st / 1.0))
        fade_out = 1.0
        if t > 24.5:
            fade_out = max(0.0, 1.0 - (t - 24.5) / 0.5)

        BRX = 80; BRY = 50; BRW = W-160; BRH = H-100

        # Browser chrome
        draw.rectangle([BRX, BRY, BRX+BRW, BRY+BRH],
                       fill=alpha_blend(BG, (26,26,26), browser_in))
        # Top bar
        draw.rectangle([BRX, BRY, BRX+BRW, BRY+40],
                       fill=alpha_blend(BG, (42,42,42), browser_in))
        # Dots
        for i, color in enumerate([(255,95,87),(254,188,46),(40,200,64)]):
            cx = BRX + 20 + i * 20
            cy = BRY + 20
            fc = alpha_blend(BG, color, browser_in)
            draw.ellipse([cx-5, cy-5, cx+5, cy+5], fill=fc)
        # URL bar
        url_text = "https://a3f9c12e.pages.rosabuilds.com"
        url_fade = min(1.0, max(0.0, (st - 0.5) / 0.5)) * fade_out
        draw.text((BRX+80, BRY+13), url_text, font=FONT_MONO_TINY,
                  fill=alpha_blend(BG, ROSE2, url_fade))

        # Page content
        page_fade = min(1.0, max(0.0, (st - 1.2) / 0.6)) * fade_out

        h1 = "Hello from my agent"
        hb = FONT_SANS_MED.getbbox(h1)
        hw = hb[2]-hb[0]
        draw.text((BRX + (BRW-hw)//2, BRY+BRH//2-40), h1, font=FONT_SANS_MED,
                  fill=alpha_blend(BG, WHITE, page_fade))

        sub = "Deployed in < 1 second · pages.rosabuilds.com"
        sb2 = FONT_SANS_SM.getbbox(sub)
        sw = sb2[2]-sb2[0]
        draw.text((BRX + (BRW-sw)//2, BRY+BRH//2+12), sub, font=FONT_SANS_SM,
                  fill=alpha_blend(BG, GREY, page_fade))

        # Rose accent bar at bottom
        bar_w = int(BRW * min(1.0, max(0.0, (st - 1.8) / 1.0)) * fade_out)
        if bar_w > 0:
            draw.rectangle([BRX, BRY+BRH-5, BRX+bar_w, BRY+BRH], fill=ROSE)

    # ============================
    # SCENE 5: Final card (25–30s)
    # ============================
    else:
        st = t - 25.0  # 0..5
        fade_a = min(1.0, st / 0.5)

        # Rose bar at bottom
        draw.rectangle([0, H-6, W, H], fill=ROSE)

        title = "pages.rosabuilds.com"
        sub   = "Deploy anything. One curl command."
        note  = "Free tier · No credit card"

        tb2 = FONT_SANS_LG.getbbox(title)
        sb2 = FONT_SANS.getbbox(sub)
        nb2 = FONT_SANS_SM.getbbox(note)

        tc = alpha_blend(BG, WHITE, fade_a)
        sc = alpha_blend(BG, GREY, fade_a)
        nc = alpha_blend(BG, (68,68,68), fade_a)

        draw.text(((W-(tb2[2]-tb2[0]))//2, H//2-48), title, font=FONT_SANS_LG, fill=tc)
        draw.text(((W-(sb2[2]-sb2[0]))//2, H//2+20), sub, font=FONT_SANS, fill=sc)
        draw.text(((W-(nb2[2]-nb2[0]))//2, H//2+62), note, font=FONT_SANS_SM, fill=nc)

    return img


def main():
    out_dir = Path("static")
    out_dir.mkdir(exist_ok=True)
    tmp = tempfile.mkdtemp()

    print(f"→ Rendering {TOTAL_FRAMES} frames at {FPS}fps ({DURATION}s)...")
    for i in range(TOTAL_FRAMES):
        img = render_frame(i)
        img.save(f"{tmp}/frame_{i:05d}.png")
        if i % (FPS * 5) == 0:
            print(f"   {i}/{TOTAL_FRAMES} frames ({i//FPS}s)")

    output = "static/demo.mp4"
    print(f"→ Encoding video to {output}...")
    subprocess.run([
        "ffmpeg", "-y",
        "-framerate", str(FPS),
        "-i", f"{tmp}/frame_%05d.png",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output,
    ], check=True, capture_output=True)

    shutil.rmtree(tmp)
    size = os.path.getsize(output) / (1024*1024)
    print(f"✓ Video saved: {output} ({size:.1f} MB)")


if __name__ == "__main__":
    main()
