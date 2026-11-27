---
name: pdf-reader
description: "Read a local PDF file (lecture notes, papers, slides, scans, forms, CAD drawings and plans) into the conversation: size it up, pull the text, find pages, and render the pages whose equations, figures, tables, signatures, scans or unextractable labels don't survive text extraction, cropping large sheets into readable tiles. Use when the user gives a .pdf path or asks to read, summarize, search, or explain something in a PDF on disk. For a PDF at a URL, use fetch_content instead."
---

# Reading local PDFs

Everything runs on Poppler (`brew install poppler`); the one script is
standard-library Python. Paths below are relative to this skill's directory.

A PDF at a URL is not this skill's job: `fetch_content` fetches and converts it.

## 1. Size it up

```bash
python3 scripts/triage.py <file.pdf>                  # whole document
python3 scripts/triage.py <file.pdf> --pages 10-20    # part of it
```

It prints the page count, the outline (bookmarks with page numbers, when the
PDF has them), and one row per page:

| Column | Meaning |
|---|---|
| `chars` | characters of extractable text |
| `math` | share of math symbols in that text |
| `eqs` | numbered display equations, like `… (3.2)` |
| `figs` | lines that start a caption: `Figure 3`, `Table 2`, … |
| `imgs` | images covering at least 5% of the page (logos don't count) |
| `render` | `yes (scan / images / unreadable text / figure / math)`, or `sparse` for pages with little text |

Then a `Render:` line with the pages to look at as images. The other pages read
fine as text.

The flags are a starting point. **The user's question decides.** "Is it
signed?", "fill in this form", "what does the diagram show", or "check this
table" means rendering those pages even when the row says `-`: signatures,
handwriting and vector drawings are invisible to the script, and tables lose
their columns in text.

Warnings the script may print first:

- **Looks scanned**: pages are images with no text. Render what you need and
  read the images; there is no OCR here.
- **Some text can't be extracted**: the page uses fonts with no Unicode map
  (common in CAD exports). Its labels and headings are visible only in a render,
  and `--find` won't see them.
- **Large pages**: bigger than A3, such as drawings and plans. See
  [Large pages](#large-pages).
- **Most pages have little text**: slides, a form, or near-empty pages. Render
  one `sparse` page to see which before rendering more.

## 2. Get the text

```bash
pdftotext -layout -f 4 -l 7 <file.pdf> -    # pages 4 to 7 to stdout
pdftotext -layout <file.pdf> -              # everything (check the size first)
```

`-layout` keeps columns and display equations on their own lines. Drop it for
flowing prose that you want as plain paragraphs.

## 3. Find something

```bash
python3 scripts/triage.py <file.pdf> --find "theorem 3\.2"      # regex, case-insensitive
python3 scripts/triage.py <file.pdf> --find "f(x) = " --literal
```

Each hit prints as `p<page>: <line>`. Formulas extract oddly (subscripts
flatten, fractions split across lines), so search for the words around a
formula, not the formula.

## 4. Render and look

```bash
out=$(mktemp -d -t pdf-pages)
pdftoppm -png -r 120 -f 4 -l 5 <file.pdf> "$out/p"     # → $out/p-04.png, $out/p-05.png
```

Then `read` each PNG. Pick the resolution for what you need from the page:

| `-r` | Use for |
|---|---|
| 60–75 | layout only: is it signed, which boxes are filled, what kind of page |
| 100–120 | normal text, tables, figures |
| 150 | dense equations, sub/superscripts, small print |

Higher resolutions cost more tokens per page. Images larger than about 1600 px
on the long side get scaled down before you see them, so a higher `-r` on a big
page buys nothing. Render only the pages you need, and delete `$out` when you
are done.

### Large pages

An A1 drawing at 120 dpi is about 3900 × 2800 px. Scaled down to fit, its
dimensions and labels turn into specks. Read it in two passes:

1. **Overview**: `pdftoppm -png -scale-to 1400 -f 2 -l 2 <file.pdf> "$out/p"`
   to see the layout and decide which areas matter.
2. **Detail**: crop tiles at full resolution. The script prints the commands:

   ```bash
   python3 scripts/triage.py <file.pdf> --tiles 2              # 3x2 grid, 150 dpi
   python3 scripts/triage.py <file.pdf> --tiles 2 --grid 4x3   # smaller labels
   ```

   Run the printed lines (they create their own `$out`) and `read` only the
   tiles you need. Tiles overlap by 5%, so a label on a seam shows up whole in
   one of them. Aim for tiles of at most ~1600 px; raise the grid, not the dpi.

## How to read by size

- **Up to ~15 pages**: text for everything, render what `Render:` lists.
- **15–60 pages**: text for everything, render only the flagged pages that
  matter to the question.
- **More than 60 pages**: don't pull the whole text. Use the outline and
  `--find` to locate sections, then text and render just those. Tell the user
  what you covered.

## Math notes and papers

- Text extraction loses the structure of formulas. Before stating or explaining
  a formula, read it from the rendered page.
- Write formulas in LaTeX in your answer, and give the page number (and the
  equation or theorem number) so the user can check.
- A proof often runs onto the next page: render or extract that page too.
- Describe figures and diagrams in words; the user may not have the PDF open.

## When it fails

- `missing Poppler tools`: `brew install poppler`.
- `PDF is encrypted`: ask the user for an unlocked copy. Poppler's tools also
  take `-upw <password>` if they give you one.
- Garbled text everywhere (odd symbols, letters out of order): the PDF uses
  fonts without a usable text mapping that the script didn't catch. Treat it
  like a scan and render.
- Poppler prints `Syntax Error: Unknown character collection …` lines: harmless
  noise from fonts without a Unicode map. The script hides them; the plain
  `pdftotext`/`pdftoppm` commands don't.
