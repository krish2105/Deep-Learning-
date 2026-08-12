"""Compress captured studies and emit the typed fixtures module."""
import base64, io, json, re
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "web" / "lib" / "demoFixtures.ts"

# Fields the frontend Study type does not carry. Keeping them would make the
# fixtures fail typecheck against the real API contract, which is the point of
# generating them as typed TS rather than raw JSON.
DROP = {"thumbnail_url"}


def shrink(data_url: str, px: int, quality: int) -> str:
    m = re.match(r"data:image/(\w+);base64,(.*)", data_url or "")
    if not m:
        return data_url
    im = Image.open(io.BytesIO(base64.b64decode(m.group(2))))
    im.thumbnail((px, px), Image.LANCZOS)
    buf = io.BytesIO()
    if im.mode == "RGBA":
        im.save(buf, format="WEBP", quality=quality)
    else:
        im.convert("L").save(buf, format="WEBP", quality=quality)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


studies = json.load(open("/tmp/studies_raw.json"))
for s in studies:
    for k in DROP:
        s.pop(k, None)
    if s.get("image_url"):
        s["image_url"] = shrink(s["image_url"], 384, 72)
    s["gradcam"] = {k: shrink(v, 224, 62) for k, v in (s.get("gradcam") or {}).items()}

HEADER = '''/**
 * Offline demo fixtures.
 *
 * These are REAL outputs, captured verbatim from the running pipeline — the
 * conformal thresholds, abstention decision, uncertainty decomposition, triage
 * scores and Grad-CAM overlays here were all computed by the actual system, not
 * written by hand.
 *
 * They exist because the free-tier backend can be asleep (a cold Render dyno
 * takes up to a minute) or misconfigured at the moment a reviewer clicks. A
 * console that showed an error in that window would misrepresent a system that
 * works. When the API is reachable the app always uses it; these are only the
 * fallback, and the interface labels itself OFFLINE DEMO whenever they are in
 * use, so the distinction is never hidden.
 *
 * Regenerate with: ./scripts/capture_fixtures.sh
 */

import type { Study } from "./types";

export const DEMO_STUDIES: Study[] = '''

OUT.write_text(HEADER + json.dumps(studies, indent=0, separators=(",", ":")) + ";\n")
print(f"  {len(studies)} studies, {OUT.stat().st_size // 1024} KB")
