#!/usr/bin/env python3
"""Capture the running system for the submission appendix.

Insurance: the free tier sleeps, and a reviewer who clicks at the wrong moment
should still be able to see what the system looks like working. These are
captures of the real deployed application, not mockups, and each is labelled
with the URL and timestamp it was taken from.

Run:  python scripts/capture_screenshots.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deliverables" / "screenshots"
BASE = "https://sentinel-cxr.vercel.app"

# Desktop viewport, 2x scale so the PDF stays sharp when printed.
VIEWPORT = {"width": 1440, "height": 900}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    shots: list[tuple[str, str]] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=2)

        def shot(name: str, caption: str, full: bool = False) -> None:
            path = OUT / f"{name}.png"
            page.screenshot(path=str(path), full_page=full)
            shots.append((path.name, caption))
            print(f"  {path.name:34s} {path.stat().st_size / 1024:6.0f} KB")

        print("capturing…")

        # ── landing, dark
        page.goto(BASE, wait_until="networkidle", timeout=90_000)
        page.wait_for_timeout(3500)  # let the 3D cloud assemble
        shot("01_landing_dark", "Landing page — the volumetric hero, dark theme")

        page.mouse.wheel(0, 1400)
        page.wait_for_timeout(2000)
        shot("02_landing_scrolled", "Scrolling assembles the thorax and reveals the measured metrics")

        # ── landing, light: the theme is a first-class design, not an inversion
        page.evaluate("document.documentElement.setAttribute('data-theme','light')")
        page.goto(BASE, wait_until="networkidle", timeout=90_000)
        page.evaluate("document.documentElement.setAttribute('data-theme','light')")
        page.wait_for_timeout(3000)
        shot("03_landing_light", "Landing page in light theme")

        # ── console: demo, then each surface
        page.evaluate("document.documentElement.setAttribute('data-theme','dark')")
        page.goto(f"{BASE}/console", wait_until="networkidle", timeout=90_000)
        page.wait_for_timeout(1500)
        shot("04_console_signin", "Console sign-in, with demo access requiring no account")

        try:
            page.click("text=Explore the demo", timeout=15_000)
            # The API may be cold; a free dyno can take up to a minute to wake.
            page.wait_for_timeout(25_000)
            shot("05_console_worklist", "Clinical console — triage-ordered worklist and viewer")

            # The tab row only renders once a study is open, so select the top
            # of the worklist first. Without this every tab click timed out.
            page.click("aside button:has-text('DEMO-')", timeout=15_000)
            page.wait_for_timeout(3500)

            for tab, name, cap in [
                ("Findings", "06_console_findings", "Findings with conformal thresholds marked in place"),
                ("Explainability", "07_console_explainability", "Class activation maps over the radiograph"),
                ("Uncertainty", "08_console_uncertainty", "Epistemic and aleatoric uncertainty, decomposed"),
                ("Similar", "09_console_similar", "Similar-case retrieval over the embedding space"),
                ("Report", "10_console_report", "Drafted report, grounded strictly in model output"),
            ]:
                try:
                    page.click(f"button[role='tab']:has-text('{tab}')", timeout=8000)
                    page.wait_for_timeout(2500)
                    shot(name, cap)
                except Exception as exc:
                    print(f"    skipped {tab}: {str(exc)[:60]}")
        except Exception as exc:
            print(f"    demo unavailable: {str(exc)[:80]}")

        # ── dashboard tabs
        page.goto(f"{BASE}/dashboard", wait_until="networkidle", timeout=90_000)
        page.wait_for_timeout(4000)
        shot("11_dashboard_overview", "Analytics dashboard — abstention rate leads, not volume", full=True)

        for tab, name, cap in [
            ("Model", "12_dashboard_model", "Measured coverage: 9 of 14 labels below the 0.90 target"),
            ("Fairness", "13_dashboard_fairness", "The fairness audit fails its own tolerance at 0.2149"),
            ("Audit", "14_dashboard_audit", "Sortable, searchable, exportable audit record"),
        ]:
            try:
                page.click(f"button[role='tab']:has-text('{tab}')", timeout=8000)
                page.wait_for_timeout(2500)
                shot(name, cap, full=True)
            except Exception as exc:
                print(f"    skipped {tab}: {str(exc)[:60]}")

        browser.close()

    if not shots:
        sys.exit("no screenshots captured")

    # ── assemble into a PDF appendix
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as pdfcanvas

    pdf = ROOT / "deliverables" / "report" / "SENTINEL-CXR_Screenshots.pdf"
    W, H = landscape(A4)
    c = pdfcanvas.Canvas(str(pdf), pagesize=landscape(A4))
    stamp = datetime.now(timezone.utc).strftime("%d %B %Y, %H:%M UTC")

    # cover
    c.setFont("Helvetica-Bold", 26)
    c.drawString(24 * mm, H - 40 * mm, "SENTINEL-CXR")
    c.setFont("Helvetica", 14)
    c.drawString(24 * mm, H - 50 * mm, "Screenshots of the deployed system")
    c.setFont("Helvetica", 10)
    for i, line in enumerate([
        "Final Group Project · Deep Learning (MAIB AI 114) · S P Jain School of Global Management, Dubai",
        "Krishna Mathur AS25DXB018 · Atharva Soundankar AS25DXB020 · Yash Petkar AS25DXB021",
        "",
        f"Captured from {BASE} on {stamp}.",
        "These are the live application, not mockups. The system can be opened directly;",
        "the console's demo requires no account.",
        "",
        "Research prototype. Not a medical device.",
    ]):
        c.drawString(24 * mm, H - 66 * mm - i * 6 * mm, line)
    c.showPage()

    for name, caption in shots:
        img = ImageReader(str(OUT / name))
        iw, ih = img.getSize()
        avail_w, avail_h = W - 24 * mm, H - 34 * mm
        scale = min(avail_w / iw, avail_h / ih)
        w, h = iw * scale, ih * scale
        c.drawImage(img, (W - w) / 2, H - 22 * mm - h, width=w, height=h)
        c.setFont("Helvetica", 9)
        c.drawString(12 * mm, H - 14 * mm, caption)
        c.setFont("Helvetica", 7)
        c.setFillGray(0.45)
        c.drawRightString(W - 12 * mm, 8 * mm, f"{BASE} · {stamp}")
        c.setFillGray(0)
        c.showPage()

    c.save()
    print(f"\nWrote {pdf.relative_to(ROOT)}  ({pdf.stat().st_size / 1e6:.1f} MB, {len(shots) + 1} pages)")


if __name__ == "__main__":
    main()
