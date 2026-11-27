#!/usr/bin/env python3
"""Size up a PDF before reading it, or find which pages mention something.

    triage.py FILE [--pages SPEC] [--json]      overview + per-page table
    triage.py FILE --find PATTERN [--literal]   matching lines with page numbers
    triage.py FILE --tiles PAGE [--grid 3x2] [--dpi 150]
                                                pdftoppm commands that crop one large
                                                page into overlapping tiles

Stdlib only. Shells out to Poppler (pdfinfo, pdftotext, pdfimages, pdftohtml).
SPEC: "3", "2-5", "1,4,9-12" (1-based). Default: every page.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

TOOLS = ("pdfinfo", "pdftotext", "pdfimages", "pdftohtml", "pdffonts")

# Characters that text extraction tends to keep from typeset math: Greek,
# operators, arrows, super/subscripts, letter-like symbols, math alphanumerics.
MATH_CHARS = re.compile(
    "[\u0370-\u03ff\u2070-\u209f\u2100-\u214f\u2190-\u21ff\u2200-\u22ff"
    "\u2300-\u23ff\u27c0-\u27ef\u2980-\u2aff\U0001d400-\U0001d7ff]"
)
# Below this many characters a page is a figure, a scan, a slide, or nearly blank.
SPARSE_TEXT = 200
# An image counts as content when it covers this share of the page; logos,
# icons and bullets stay below it. A scan covers most of the page.
BIG_IMAGE = 0.05
SCAN_IMAGE = 0.5
# Pages larger than A3 (in square points) hold more detail than one rendered
# image can show: CAD drawings, posters, plans.
A3_AREA = 842 * 1191
# Share of math characters above which extracted text is likely garbled.
MATHY = 0.01
# A numbered display equation in -layout text: content, a wide gap, then "(3)",
# "(2.14)" or "(4a)" at the end of the line. Extraction mangles these the most.
EQUATION_LINE = re.compile(r"\S.*\s{3,}\(\d{1,3}(?:\.\d{1,3})*[a-z]?\)\s*$")
# A caption at the start of a line: vector figures (TikZ, plots) have no image
# objects and often little text, but they are captioned.
CAPTION = re.compile(r"^\s*(?:fig(?:ure|\.)?|table|diagram|abb(?:ildung|\.)|рис(?:унок|\.)?)\s*\d+", re.I)


def run(*cmd: str) -> str:
    done = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if done.returncode != 0:
        sys.exit(f"{cmd[0]} failed: {done.stderr.strip() or 'exit ' + str(done.returncode)}")
    return done.stdout


def parse_pages(spec: str | None, count: int) -> list[int]:
    if not spec or spec == "all":
        return list(range(1, count + 1))
    pages: set[int] = set()
    for part in spec.split(","):
        start, _, end = part.strip().partition("-")
        lo, hi = int(start), int(end or start)
        if lo < 1 or hi > count or lo > hi:
            sys.exit(f"page range {part!r} is outside 1-{count}")
        pages.update(range(lo, hi + 1))
    return sorted(pages)


def doc_info(path: str) -> dict[str, str]:
    info = {}
    for line in run("pdfinfo", path).splitlines():
        key, sep, value = line.partition(":")
        if sep:
            info[key.strip()] = value.strip()
    return info


def page_texts(path: str) -> list[str]:
    # -layout keeps display equations on their own lines with the number at the
    # right margin. pdftotext ends every page with a form feed; drop the empty tail.
    return run("pdftotext", "-layout", "-enc", "UTF-8", path, "-").split("\f")[:-1]


def page_areas(path: str, count: int) -> dict[int, float]:
    """Page area in square points, from pdfinfo's per-page size lines."""
    areas = {}
    for line in run("pdfinfo", "-f", "1", "-l", str(count), path).splitlines():
        m = re.match(r"Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+)", line)
        if m:
            areas[int(m[1])] = float(m[2]) * float(m[3])
    return areas


def unmapped_fonts(path: str, page: int) -> bool:
    """True when the page uses a CID font (Identity-H/V) with no Unicode map.

    Poppler cannot turn such glyphs into text, so the page can show labels and
    headings that extraction drops entirely (CAD exports, some PDF tools).
    Fonts with standard encodings (WinAnsi, MacRoman, ...) extract fine without
    a map, so they don't count.
    """
    lines = run("pdffonts", "-f", str(page), "-l", str(page), path).splitlines()
    if len(lines) < 3:
        return False
    # Columns are fixed-width; their extents come from the dashed rule.
    spans, start = [], None
    for i, ch in enumerate(lines[1] + " "):
        if ch == "-" and start is None:
            start = i
        elif ch != "-" and start is not None:
            spans.append((start, i))
            start = None
    for line in lines[2:]:
        cells = [line[a:b].strip() for a, b in spans]
        if len(cells) >= 6 and cells[2].startswith("Identity") and cells[5] == "no":
            return True
    return False


def image_coverage(path: str, areas: dict[int, float]) -> dict[int, list[float]]:
    """Share of the page each image covers, from its pixel size and resolution."""
    cover: dict[int, list[float]] = {}
    for line in run("pdfimages", "-list", path).splitlines()[2:]:
        cols = line.split()
        # Columns: page num type width height ... x-ppi y-ppi size ratio.
        # Soft masks ("smask") duplicate the image listed before them.
        if len(cols) < 14 or not cols[0].isdigit() or cols[2] != "image":
            continue
        page, width, height, xppi, yppi = int(cols[0]), int(cols[3]), int(cols[4]), int(cols[12]), int(cols[13])
        if xppi and yppi and areas.get(page):
            shown = (width / xppi * 72) * (height / yppi * 72)
            cover.setdefault(page, []).append(min(shown / areas[page], 1.0))
    return cover


def outline(path: str) -> list[tuple[int, int, str]]:
    """(depth, page, title) for each bookmark; empty when the PDF has none."""
    xml = run("pdftohtml", "-xml", "-i", "-q", "-f", "1", "-l", "1", "-stdout", path)
    start, end = xml.find("<outline>"), xml.rfind("</outline>")
    if start < 0 or end < 0:
        return []
    try:
        root = ET.fromstring(xml[start : end + len("</outline>")])
    except ET.ParseError:
        return []
    items: list[tuple[int, int, str]] = []

    def walk(node: ET.Element, depth: int) -> None:
        for child in node:
            if child.tag == "item":
                title = " ".join("".join(child.itertext()).split())
                items.append((depth, int(child.get("page", "0") or 0), title))
            elif child.tag == "outline":
                walk(child, depth + 1)

    walk(root, 0)
    return items


def page_row(number: int, text: str, cover: list[float], unmapped: bool) -> dict:
    chars = len("".join(text.split()))
    math = len(MATH_CHARS.findall(text))
    ratio = math / chars if chars else 0.0
    lines = text.splitlines()
    equations = sum(1 for line in lines if EQUATION_LINE.search(line))
    captions = sum(1 for line in lines if CAPTION.search(line))
    images = sum(1 for c in cover if c >= BIG_IMAGE)
    sparse = chars < SPARSE_TEXT
    reasons = []
    if sparse and any(c >= SCAN_IMAGE for c in cover):
        reasons.append("scan")
    elif images:
        reasons.append("images")
    if unmapped:
        reasons.append("unreadable text")
    if captions:
        reasons.append("figure")
    if ratio >= MATHY or equations:
        reasons.append("math")
    return {"page": number, "chars": chars, "sparse": sparse, "unmapped": unmapped, "math": round(ratio, 3),
            "eqs": equations, "images": images, "captions": captions,
            "render": bool(reasons), "why": ", ".join(reasons)}


def compress(pages: list[int]) -> str:
    """[1,2,3,7,9,10] -> "1-3,7,9-10", ready to pass to pdftoppm/pdftotext ranges."""
    parts, i = [], 0
    while i < len(pages):
        j = i
        while j + 1 < len(pages) and pages[j + 1] == pages[j] + 1:
            j += 1
        parts.append(str(pages[i]) if i == j else f"{pages[i]}-{pages[j]}")
        i = j + 1
    return ",".join(parts)


def triage(path: str, spec: str | None, as_json: bool) -> None:
    info = doc_info(path)
    if info.get("Encrypted", "no").startswith("yes") and "Pages" not in info:
        sys.exit("PDF is encrypted and cannot be opened without a password")
    count = int(info.get("Pages", "0"))
    texts = page_texts(path)
    areas = page_areas(path, count)
    cover = image_coverage(path, areas)
    rows = [page_row(n, texts[n - 1] if n <= len(texts) else "", cover.get(n, []), unmapped_fonts(path, n))
            for n in parse_pages(spec, count)]
    large = [r["page"] for r in rows if areas.get(r["page"], 0) > A3_AREA * 1.05]
    toc = outline(path)
    scanned = bool(rows) and sum("scan" in r["why"] for r in rows) > len(rows) / 2
    # Mostly sparse but not scanned: slides, forms, or near-empty pages. The text
    # cannot tell which; one rendered page can.
    mostly_sparse = (bool(rows) and not scanned and sum(r["sparse"] for r in rows) > len(rows) / 2
                     and not all(r["unmapped"] for r in rows if r["sparse"]))
    render = [r["page"] for r in rows if r["render"]]
    sparse_only = [r["page"] for r in rows if r["sparse"] and not r["render"]]

    if as_json:
        print(json.dumps({"pages": count, "title": info.get("Title", ""),
                          "scanned": scanned, "mostly_sparse": mostly_sparse,
                          "render": compress(render), "sparse": compress(sparse_only),
                          "large": compress(large),
                          "outline": [{"depth": d, "page": p, "title": t} for d, p, t in toc],
                          "rows": rows}, ensure_ascii=False, indent=1))
        return

    title = info.get("Title") or "(no title)"
    print(f"{path}\n{count} pages · {title} · {info.get('Page size', '?')}")
    if scanned:
        print("Looks scanned: pages are images with almost no text. Render the pages you need.")
    if any(r["unmapped"] for r in rows):
        print("Some text can't be extracted (fonts without a Unicode map): read those pages from renders.")
    if large:
        print(f"Large pages ({compress(large)}): render an overview, then crop regions to read small labels.")
    elif mostly_sparse:
        print("Most pages have little text: slides, a form, or near-empty pages. "
              "Render one sparse page to see which before rendering the rest.")
    if toc:
        print("\nOutline:")
        for depth, page, name in toc:
            print(f"  {'  ' * depth}p{page:<4} {name}")
    else:
        print("\nOutline: none (use --find on likely headings instead)")
    print("\npage  chars   math  eqs  figs  imgs  render")
    for r in rows:
        mark = f"yes ({r['why']})" if r["render"] else ("sparse" if r["sparse"] else "-")
        print(f"{r['page']:>4}  {r['chars']:>5}  {r['math']:>5.3f}  {r['eqs']:>3}  {r['captions']:>4}"
              f"  {r['images']:>4}  {mark}")
    print(f"\nRender: {compress(render) or 'none'}")
    if sparse_only:
        print(f"Sparse: {compress(sparse_only)} (little text; render if the text looks incomplete)")
    if len(render) + len(sparse_only) < len(rows):
        print("Text extraction is enough for the remaining pages.")


def find(path: str, pattern: str, literal: bool) -> None:
    regex = re.compile(re.escape(pattern) if literal else pattern, re.IGNORECASE)
    hits = 0
    for number, text in enumerate(page_texts(path), start=1):
        for line in text.splitlines():
            if regex.search(line):
                hits += 1
                print(f"p{number}: {' '.join(line.split())}")
    if not hits:
        print(f"no match for {pattern!r} (math and ligatures can extract oddly; try a shorter pattern)")


def tiles(path: str, page: int, grid: str, dpi: int) -> None:
    count = int(doc_info(path).get("Pages", "0"))
    parse_pages(str(page), count)  # validates the page number
    m = re.match(r"Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)",
                 next(line for line in run("pdfinfo", "-f", str(page), "-l", str(page), path).splitlines()
                      if line.startswith("Page ") and " size:" in line))
    width, height = (round(float(v) / 72 * dpi) for v in (m[1], m[2]))
    cols, rows = (int(v) for v in grid.lower().split("x"))
    # Each tile overlaps its neighbours by 5% so labels on a seam appear whole in one of them.
    tile_w, tile_h = width // cols, height // rows
    pad_w, pad_h = tile_w // 20, tile_h // 20
    print(f"# page {page}: {width}x{height} px at {dpi} dpi, {cols}x{rows} tiles of about "
          f"{tile_w + 2 * pad_w}x{tile_h + 2 * pad_h} px")
    print('out=$(mktemp -d -t pdf-tiles)')
    quoted = "'" + path.replace("'", "'\\''") + "'"
    for r in range(rows):
        for c in range(cols):
            x, y = max(c * tile_w - pad_w, 0), max(r * tile_h - pad_h, 0)
            w, h = min(tile_w + 2 * pad_w, width - x), min(tile_h + 2 * pad_h, height - y)
            print(f'pdftoppm -png -r {dpi} -f {page} -l {page} -x {x} -y {y} -W {w} -H {h} '
                  f'-singlefile {quoted} "$out/r{r + 1}c{c + 1}"')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("file")
    parser.add_argument("--pages", help='e.g. "3", "2-5", "1,4,9-12"')
    parser.add_argument("--json", action="store_true", help="machine-readable triage")
    parser.add_argument("--find", metavar="PATTERN", help="regex to search for (case-insensitive)")
    parser.add_argument("--literal", action="store_true", help="treat --find as plain text")
    parser.add_argument("--tiles", type=int, metavar="PAGE", help="print crop commands for one page")
    parser.add_argument("--grid", default="3x2", help="tile grid as COLSxROWS (default 3x2)")
    parser.add_argument("--dpi", type=int, default=150, help="tile resolution (default 150)")
    args = parser.parse_args()

    missing = [t for t in TOOLS if not shutil.which(t)]
    if missing:
        sys.exit(f"missing Poppler tools ({', '.join(missing)}): brew install poppler")
    if args.tiles:
        tiles(args.file, args.tiles, args.grid, args.dpi)
    elif args.find:
        find(args.file, args.find, args.literal)
    else:
        triage(args.file, args.pages, args.json)


if __name__ == "__main__":
    main()
