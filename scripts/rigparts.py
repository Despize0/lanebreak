"""Cut moving parts (sword blades, wings) out of the painted unit views for in-game rigging.
Writes assets/rig/<unit>_<view>_<part>.webp; every layer keeps the full view's canvas size so
layers line up. Run: python3 scripts/rigparts.py"""
from PIL import Image
import numpy as np, json

U = "assets/units"
O = "assets/rig"


def load(name):
    return np.asarray(Image.open(f"{U}/{name}.webp").convert("RGBA")).copy()


def save(a, name):
    Image.fromarray(a).save(f"{O}/{name}.webp", "WEBP", quality=90, method=6)


def seg_mask(shape, p0, p1, half, ext0=0.0, ext1=3.0):
    """Pixels within `half` of the segment p0->p1 (extended ext0 before p0, ext1 past p1)."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    p0 = np.array(p0, np.float32); p1 = np.array(p1, np.float32)
    d = p1 - p0; L = float(np.hypot(*d)); u = d / L
    t = (xx - p0[0]) * u[0] + (yy - p0[1]) * u[1]
    perp = np.abs((xx - p0[0]) * u[1] - (yy - p0[1]) * u[0])
    return (t >= -ext0) & (t <= L + ext1) & (perp <= half)


def poly_mask(shape, pts):
    import cv2
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return m.astype(bool)


def split(a, mask):
    part = a.copy(); part[..., 3] = np.where(mask, a[..., 3], 0)
    body = a.copy(); body[..., 3] = np.where(mask, 0, a[..., 3])
    return body, part


rig = {}
# --- Warden: blade from the crossguard (base) to the tip; it swings around the grip
WARDEN = {"front": ((104, 92), (115, 47), (101, 97), 6.5), "back": ((94, 79), (101, 20), (92, 85), 8.5),
          "side": ((80, 71), (95, 17), (77, 78), 9.0)}
for v, (base, tip, grip, half) in WARDEN.items():
    a = load(f"warden_{v}")
    body, blade = split(a, seg_mask(a.shape[:2], base, tip, half, 0, 5))
    save(body, f"warden_{v}_body"); save(blade, f"warden_{v}_blade")
    rig.setdefault("warden", {})[v] = {"grip": grip}

# --- Skywing: wings flap around the shoulders
SKY = {
    "front": [("wingL", [(0, 0), (90, 0), (88, 40), (78, 56), (60, 58), (0, 62)], (82, 52)),
              ("wingR", [(100, 0), (140, 0), (140, 36), (126, 44), (104, 44)], (112, 46))],
    "side": [("wingL", [(0, 0), (90, 0), (88, 40), (78, 56), (60, 58), (0, 62)], (82, 52)),
             ("wingR", [(100, 0), (140, 0), (140, 36), (126, 44), (104, 44)], (112, 46))],
    "back": [("wingL", [(0, 15), (45, 15), (50, 30), (45, 72), (0, 72)], (46, 45)),
             ("wingR", [(60, 0), (125, 0), (125, 30), (95, 32), (62, 30)], (82, 30))],
}
MOUTH = {"front": (125, 96), "side": (125, 96), "back": (96, 96)}
for v, wings in SKY.items():
    a = load(f"skywing_{v}")
    body = a.copy()
    entry = {"mouth": MOUTH[v]}
    for name, pts, pivot in wings:
        m = poly_mask(a.shape[:2], pts)
        body, part = split(body, m)
        save(part, f"skywing_{v}_{name}")
        entry[name] = pivot
    save(body, f"skywing_{v}_body")
    rig.setdefault("skywing", {})[v] = entry
print(json.dumps(rig))
