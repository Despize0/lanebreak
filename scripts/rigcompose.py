"""Assemble rigged units from part images (scripts/rigspec.json) for checking poses, and export
game-ready layers. Usage:
  python3 scripts/rigcompose.py preview <partsdir> <out.png> [unit]   # rest pose + test poses
  python3 scripts/rigcompose.py export <partsdir>                       # assets/rig2 + src/client/rig2data.ts
"""
from PIL import Image, ImageDraw
import numpy as np, json, math, sys, os, cv2

SPEC = json.load(open(os.path.join(os.path.dirname(__file__), "rigspec.json")))
GAME_H = 240  # exported body height in px (sharp at 2-3x device pixel ratio)


def load(d, name, segs=()):
    im = Image.open(f"{d}/{name}.png").convert("RGBA")
    if segs:
        a = np.asarray(im).copy()
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        for x0, y0, x1, y1, half in segs:
            dx, dy = x1 - x0, y1 - y0
            L = math.hypot(dx, dy)
            t = ((xx - x0) * dx + (yy - y0) * dy) / (L * L)
            dist = np.abs((xx - x0) * dy - (yy - y0) * dx) / L
            a[..., 3][(t >= 0) & (t <= 1) & (dist <= half)] = 0
        im = Image.fromarray(a)
    return im


def poly_mask(shape, poly):
    m = np.zeros(shape[:2], np.uint8)
    cv2.fillPoly(m, [np.array(poly, np.int32)], 1)
    return m > 0


def body_img(d, u):
    """The body with erased regions removed, limbs cut out ("cut" parts), and the gap behind
    each cut limb filled in (inpainted) so nothing shows through when the limb moves."""
    s = SPEC[u]
    src = np.asarray(load(d, s["body"])).copy()
    im = src.copy()
    for poly in s.get("erase", []):
        im[..., 3][poly_mask(im.shape, poly)] = 0
    for q in s["parts"]:
        if "cut" not in q:
            continue
        cutm = poly_mask(im.shape, q["cut"])
        im[..., 3][cutm] = 0
        if q.get("fill"):
            hole = poly_mask(im.shape, q["fill"]) & cutm
            rgb = cv2.inpaint(np.ascontiguousarray(src[..., :3]), hole.astype(np.uint8) * 255, 4, cv2.INPAINT_TELEA)
            # darken the filled gap a little: it's in the limb's shadow
            rgb = (rgb.astype(np.float32) * 0.8).astype(np.uint8)
            im[..., :3][hole] = rgb[hole]
            im[..., 3][hole] = 255
    return Image.fromarray(im)


def part_img(d, u, q):
    """(image, pivot in part coords) for a part: a separate painting, or a limb cut from the body."""
    if "cut" in q:
        src = np.asarray(load(d, SPEC[u]["body"])).copy()
        m = poly_mask(src.shape, q["cut"])
        src[..., 3] = np.where(m, src[..., 3], 0)
        ys, xs = np.where(src[..., 3] > 0)
        x0, y0 = xs.min(), ys.min()
        img = Image.fromarray(src[y0:ys.max() + 1, x0:xs.max() + 1])
        return img, [q["at"][0] - x0, q["at"][1] - y0]
    return load(d, q["img"], q.get("eraseSeg", ())), q["pivot"]


def place(canvas, off, part, pivot, at, scale, rot):
    """Paste `part` so that its `pivot` lands on body point `at`, scaled and rotated (radians, clockwise)."""
    w, h = part.size
    p = part.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    pv = (pivot[0] * scale, pivot[1] * scale)
    # rotate around pivot: expand onto a big square centred at the pivot
    R = int(math.hypot(max(pv[0], p.width - pv[0]), max(pv[1], p.height - pv[1]))) + 2
    sq = Image.new("RGBA", (2 * R, 2 * R))
    sq.paste(p, (int(R - pv[0]), int(R - pv[1])), p)
    sq = sq.rotate(-math.degrees(rot), resample=Image.BICUBIC, center=(R, R))
    canvas.alpha_composite(sq, (int(off[0] + at[0] - R), int(off[1] + at[1] - R)))


def compose(d, u, rots=None):
    s = SPEC[u]
    body = body_img(d, u)
    M = 420
    c = Image.new("RGBA", (body.width + 2 * M, body.height + 2 * M))
    off = (M, M)
    parts = sorted(s["parts"], key=lambda q: q["z"])
    for q in [q for q in parts if q["z"] < 0]:
        im, pv = part_img(d, u, q)
        place(c, off, im, pv, q["at"], q.get("scale", 1), q.get("rot", 0) + (rots or {}).get(q["name"], 0))
    c.alpha_composite(body, off)
    for q in [q for q in parts if q["z"] >= 0]:
        im, pv = part_img(d, u, q)
        place(c, off, im, pv, q["at"], q.get("scale", 1), q.get("rot", 0) + (rots or {}).get(q["name"], 0))
    bb = c.getbbox()
    return c.crop(bb)


def preview(d, out, only=None):
    units = [only] if only else list(SPEC)
    TEST = {"ironhide": [{}, {"armL": -0.7, "armR": 0.6}, {"armL": 0.3, "armR": -0.3}],
            "brute": [{}, {"armL": -0.7, "armR": 0.6}, {"armL": 0.35, "armR": -0.3}],
            "sparkcaster": [{}, {"staff": -0.6}, {"staff": 0.5}],
            "bombardier": [{}, {"bomb": -1.2}, {"bomb": 0.7}],
            **{"warden": [{}, {"arm": -1.0}, {"arm": 1.2}], "ranger": [{}, {"bow": -0.5}, {"pull": 0.6}],
            "colossus": [{}, {"armL": -1.8, "armR": 1.8}, {"armL": 0.6}], "skywing": [{}, {"wingL": 0.5, "wingR": -0.4}, {"wingL": -0.4, "wingR": 0.3}]}}
    rows = []
    for u in units:
        ims = [compose(d, u, r) for r in TEST[u]]
        H = 300
        ims = [im.resize((round(im.width * H / im.height), H)) for im in ims]
        rows.append(ims)
    W = max(sum(im.width + 20 for im in r) for r in rows)
    sheet = Image.new("RGBA", (W, 310 * len(rows)), (60, 120, 70, 255))
    for i, r in enumerate(rows):
        x = 0
        for im in r:
            sheet.alpha_composite(im, (x, i * 310))
            x += im.width + 20
    sheet.convert("RGB").save(out)


def export(d):
    os.makedirs("assets/rig2", exist_ok=True)
    data = {}
    for u, s in SPEC.items():
        body = body_img(d, u)
        bb = body.getbbox()
        body = body.crop(bb)
        k = GAME_H / body.height
        bw, bh = round(body.width * k), GAME_H
        body.resize((bw, bh), Image.LANCZOS).save(f"assets/rig2/{u}_body.webp", "WEBP", quality=90, method=6)
        parts = []
        for q in s["parts"]:
            im, pv0 = part_img(d, u, q)
            pk = k * q.get("scale", 1)
            pw, ph = max(1, round(im.width * pk)), max(1, round(im.height * pk))
            im.resize((pw, ph), Image.LANCZOS).save(f"assets/rig2/{u}_{q['name']}.webp", "WEBP", quality=90, method=6)
            parts.append({
                "name": q["name"], "z": q["z"], "rot": q.get("rot", 0),
                "pivot": [round(pv0[0] * pk, 1), round(pv0[1] * pk, 1)],
                "at": [round((q["at"][0] - bb[0]) * k, 1), round((q["at"][1] - bb[1]) * k, 1)],
                "w": pw, "h": ph,
                # pts of a cut limb are given in body coords; separate parts use their own coords
                "pts": {n: [round((v[0] - (q["at"][0] - pv0[0] if "cut" in q else 0)) * pk, 1),
                            round((v[1] - (q["at"][1] - pv0[1] if "cut" in q else 0)) * pk, 1)] for n, v in q.get("pts", {}).items()},
            })
        a = np.asarray(body.resize((bw, bh)))[..., 3].astype(np.float32)
        low = a[int(bh * 0.85):]
        ax = float((low.sum(0) * np.arange(bw)).sum() / max(1.0, low.sum()))
        pts = {n: [round((v[0] - bb[0]) * k, 1), round((v[1] - bb[1]) * k, 1)] for n, v in s.get("points", {}).items()}
        data[u] = {"w": bw, "h": bh, "ax": round(ax, 1), "pts": pts, "parts": sorted(parts, key=lambda p: p["z"])}
    files = sorted(f[:-5] for f in os.listdir("assets/rig2") if f.endswith(".webp"))
    ts = "// Generated by scripts/rigcompose.py export — do not edit by hand.\n"
    ts += "".join(f'import {f} from "../../assets/rig2/{f}.webp";\n' for f in files)
    ts += "\nexport const RIG2_URLS: Record<string, string> = {\n" + "".join(f"  {f},\n" for f in files) + "};\n"
    ts += "\nexport interface Rig2Part { name: string; z: number; rot: number; pivot: [number, number]; at: [number, number]; w: number; h: number; pts: Record<string, [number, number]> }\n"
    ts += "export interface Rig2 { w: number; h: number; ax: number; pts: Record<string, [number, number]>; parts: Rig2Part[] }\n"
    ts += "export const RIG2: Record<string, Rig2> = " + json.dumps(data) + ";\n"
    open("src/client/rig2data.ts", "w").write(ts)
    print(json.dumps({u: (v["w"], v["h"]) for u, v in data.items()}))


if __name__ == "__main__":
    if sys.argv[1] == "preview":
        preview(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
    else:
        export(sys.argv[2])
