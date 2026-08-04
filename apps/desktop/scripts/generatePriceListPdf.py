"""
Genera LISTA_PRECIOS.pdf — referencia rápida de PLU para la balanza.
Solo PLU + nombre (sin precios). Preferir 1 hoja vertical.
Categorías enteras (no se parten entre hojas si hay 2).

Uso: py -3 scripts/generatePriceListPdf.py
"""
from __future__ import annotations

import json
import sys
from collections import OrderedDict
from pathlib import Path

from reportlab.lib.pagesizes import A4, landscape, portrait
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / "catalog-2026-08.json"
OUT = ROOT.parent.parent.parent / "LISTA_PRECIOS.pdf"

SECTION_ORDER = [
    "Vacuno",
    "Pollo",
    "Cerdo",
    "Embutidos",
    "Otros",
    "Ofertas pack",
    "Ofertas pieza",
]

MAX_PAGES = 2
INNER_GUTTER = 8 * mm


def build_categories(products: list) -> list[tuple[str, list[str]]]:
    """[(section_title, ['1  Asado', ...]), ...]"""
    by_section: OrderedDict[str, list] = OrderedDict((s, []) for s in SECTION_ORDER)
    for p in products:
        by_section.setdefault(p.get("section", "Otros"), []).append(p)

    cats: list[tuple[str, list[str]]] = []
    for sec, items in by_section.items():
        if not items:
            continue
        rows = [f"{p['plu']}  {p['name']}" for p in sorted(items, key=lambda x: x["plu"])]
        cats.append((sec.upper(), rows))
    return cats


def names_fit(
    c: canvas.Canvas,
    rows: list[str],
    col_inner: float,
    row_size: float,
) -> bool:
    if col_inner < 30:
        return False
    for text in rows:
        if c.stringWidth(text, "Helvetica", row_size) > col_inner:
            return False
    return True


def category_height(n_rows: int, cols: int, section_size: float, line_h: float) -> float:
    header = section_size + 6
    rows_per_col = (n_rows + cols - 1) // cols
    return header + rows_per_col * line_h + 3


def pack_cats_to_pages(
    cat_heights: list[float],
    available_h: float,
    max_pages: int,
) -> list[list[int]] | None:
    pages: list[list[int]] = [[]]
    page_h = [0.0]

    for i, h in enumerate(cat_heights):
        if h > available_h + 0.5:
            return None
        if page_h[-1] > 0 and page_h[-1] + h > available_h:
            if len(pages) >= max_pages:
                return None
            pages.append([])
            page_h.append(0.0)
        pages[-1].append(i)
        page_h[-1] += h

    return pages


def try_layout(
    c: canvas.Canvas,
    cats: list[tuple[str, list[str]]],
    page_w: float,
    available_h: float,
    margin_x: float,
    cols: int,
    row_size: float,
) -> list[list[int]] | None:
    section_size = row_size + 1.8
    line_h = row_size * 1.38
    usable = (page_w - 2 * margin_x) - INNER_GUTTER * (cols - 1)
    col_inner = usable / cols

    heights: list[float] = []
    for _title, rows in cats:
        if not names_fit(c, rows, col_inner, row_size):
            return None
        heights.append(category_height(len(rows), cols, section_size, line_h))

    return pack_cats_to_pages(heights, available_h, MAX_PAGES)


def choose_layout(
    c: canvas.Canvas,
    cats: list[tuple[str, list[str]]],
    orientations: list[tuple[str, tuple[float, float]]],
    margin_x: float,
    margin_y: float,
    title_size: float,
    footer_h: float,
) -> tuple[str, tuple[float, float], int, float, list[list[int]]]:
    """Prioriza 1 hoja + tipografía grande; portrait primero."""
    row_sizes = [x / 10 for x in range(180, 99, -2)]  # 18 … 10

    # Primero intentar 1 página con el texto más grande posible
    for pages_limit in (1, MAX_PAGES):
        for orient_name, pagesize in orientations:
            width, height = pagesize
            y_start = height - margin_y - title_size - 3.2 * mm
            available_h = y_start - margin_y - footer_h

            for row_size in row_sizes:
                for cols in (3, 2, 4):
                    assignment = try_layout(
                        c, cats, width, available_h, margin_x, cols, row_size
                    )
                    if assignment is not None and len(assignment) <= pages_limit:
                        return orient_name, pagesize, cols, row_size, assignment

    raise RuntimeError("No se pudo paginar la lista de PLU")


def draw_header(
    c: canvas.Canvas,
    width: float,
    height: float,
    margin_x: float,
    margin_y: float,
    page_num: int,
    total_pages: int,
    title_size: float,
) -> float:
    y_top = height - margin_y
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", title_size)
    title = "Lista de PLU — balanza"
    if total_pages > 1:
        title = f"{title}  ({page_num}/{total_pages})"
    c.drawString(margin_x, y_top - title_size, title)
    c.setFont("Helvetica", 9)
    c.drawRightString(
        width - margin_x,
        y_top - title_size + 1,
        "Solo número PLU + producto",
    )
    return y_top - title_size - 3.2 * mm


def draw_category(
    c: canvas.Canvas,
    title: str,
    rows: list[str],
    x0: float,
    x1: float,
    y: float,
    cols: int,
    row_size: float,
    section_size: float,
    line_h: float,
) -> float:
    c.setFillColorRGB(0.12, 0.12, 0.12)
    c.rect(x0, y - section_size - 1.5, x1 - x0, section_size + 4.5, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", section_size)
    c.drawString(x0 + 2.5, y - section_size + 0.5, title)
    c.setFillColorRGB(0, 0, 0)
    y -= section_size + 5

    if cols <= 1:
        for text in rows:
            c.setFont("Helvetica", row_size)
            c.drawString(x0, y - row_size, text)
            y -= line_h
        return y - 3

    n = len(rows)
    per_col = (n + cols - 1) // cols
    usable = (x1 - x0) - INNER_GUTTER * (cols - 1)
    col_w = usable / cols
    start_y = y
    max_used = 0.0

    for ci in range(cols):
        chunk = rows[ci * per_col : (ci + 1) * per_col]
        if not chunk:
            continue
        cx0 = x0 + ci * (col_w + INNER_GUTTER)
        cy = start_y
        for text in chunk:
            c.setFont("Helvetica", row_size)
            c.drawString(cx0, cy - row_size, text)
            cy -= line_h
        max_used = max(max_used, start_y - cy)

    return start_y - max_used - 3


def main() -> int:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    products = data["products"]
    cats = build_categories(products)

    probe = canvas.Canvas(str(OUT.with_suffix(".tmp.pdf")), pagesize=portrait(A4))
    margin_x = 8 * mm
    margin_y = 7 * mm
    title_size = 16
    footer_h = 6 * mm

    orientations = [
        ("portrait", portrait(A4)),
        ("landscape", landscape(A4)),
    ]

    orient_name, pagesize, cols, row_size, assignment = choose_layout(
        probe, cats, orientations, margin_x, margin_y, title_size, footer_h
    )
    probe.save()
    try:
        OUT.with_suffix(".tmp.pdf").unlink(missing_ok=True)
    except OSError:
        pass

    width, height = pagesize
    section_size = row_size + 1.8
    line_h = row_size * 1.38
    total_pages = len(assignment)

    c = canvas.Canvas(str(OUT), pagesize=pagesize)

    for page_i, cat_indices in enumerate(assignment, start=1):
        if page_i > 1:
            c.showPage()
        y = draw_header(
            c, width, height, margin_x, margin_y, page_i, total_pages, title_size
        )
        x0 = margin_x
        x1 = width - margin_x

        for idx in cat_indices:
            title, rows = cats[idx]
            y = draw_category(
                c, title, rows, x0, x1, y, cols, row_size, section_size, line_h
            )

        c.setFont("Helvetica", 7.5)
        c.setFillColorRGB(0.3, 0.3, 0.3)
        page_cats = ", ".join(cats[i][0].title() for i in cat_indices)
        c.drawCentredString(
            width / 2,
            3.5 * mm,
            f"{len(products)} productos  ·  {orient_name}  ·  pág. {page_i}/{total_pages}  ·  {page_cats}",
        )

    c.save()
    print(f"PDF escrito: {OUT}")
    print(
        f"Layout: {orient_name}, {total_pages} página(s), {cols} col(s), "
        f"texto {row_size:.1f}pt — solo PLU + nombre"
    )
    for page_i, cat_indices in enumerate(assignment, start=1):
        print(f"  Página {page_i}: {', '.join(cats[i][0] for i in cat_indices)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
