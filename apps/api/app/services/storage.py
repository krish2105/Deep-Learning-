"""Radiograph storage.

Supabase Storage when configured. Otherwise images are kept as data URLs on the
study record so the app is fully usable with zero external provisioning — which
is what lets a grader clone the repo and run it immediately.

Data-URL mode is capped tightly: it is a demo convenience, not a storage layer.
"""

from __future__ import annotations

import base64
import io
import logging

import httpx
from PIL import Image

from ..config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

# Data URLs live inside a JSON column. Keep them small enough that a row stays
# reasonable, and downscale rather than refuse.
DATA_URL_MAX_PX = 768
THUMBNAIL_PX = 256


def _encode(img: Image.Image, max_px: int, quality: int = 82) -> str:
    img = img.copy()
    img.thumbnail((max_px, max_px), Image.LANCZOS)
    buf = io.BytesIO()
    img.convert("L").save(buf, format="WEBP", quality=quality)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


async def store(image_bytes: bytes, study_id: str, filename: str) -> tuple[str, str]:
    """Persist a radiograph. Returns (image_url, thumbnail_url)."""
    img = Image.open(io.BytesIO(image_bytes))

    if not (settings.supabase_url and settings.supabase_service_key):
        return _encode(img, DATA_URL_MAX_PX), _encode(img, THUMBNAIL_PX, 70)

    ext = (filename.rsplit(".", 1)[-1] or "png").lower()[:5]
    path = f"{study_id}.{ext}"
    endpoint = (
        f"{settings.supabase_url.rstrip('/')}"
        f"/storage/v1/object/{settings.supabase_bucket}/{path}"
    )
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {settings.supabase_service_key}",
                    "Content-Type": f"image/{'jpeg' if ext in ('jpg', 'jpeg') else 'png'}",
                    "x-upsert": "true",
                },
                content=image_bytes,
            )
            resp.raise_for_status()
        public = (
            f"{settings.supabase_url.rstrip('/')}"
            f"/storage/v1/object/public/{settings.supabase_bucket}/{path}"
        )
        return public, _encode(img, THUMBNAIL_PX, 70)
    except httpx.HTTPError as exc:
        # Storage failing must not lose the analysis. Fall back to the data URL.
        log.warning("Supabase upload failed (%s); storing inline", exc)
        return _encode(img, DATA_URL_MAX_PX), _encode(img, THUMBNAIL_PX, 70)


def validate(image_bytes: bytes, filename: str) -> None:
    """Reject anything that is not a decodable image, before it reaches a model."""
    size_mb = len(image_bytes) / (1024 * 1024)
    if size_mb > settings.max_upload_mb:
        raise ValueError(
            f"File is {size_mb:.1f} MB. The limit is {settings.max_upload_mb} MB."
        )
    if not image_bytes:
        raise ValueError("The uploaded file is empty.")
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.verify()
    except Exception:
        raise ValueError(
            f"'{filename}' could not be read as an image. "
            "Upload a PNG or JPEG chest radiograph."
        ) from None
