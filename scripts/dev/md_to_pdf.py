#!/usr/bin/env python3
"""Minimal Markdown -> PDF for the handoff doc (no external md lib needed)."""
import re
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Preformatted, ListFlowable, ListItem
)

SRC = sys.argv[1] if len(sys.argv) > 1 else "HANDOFF.md"
OUT = sys.argv[2] if len(sys.argv) > 2 else "HANDOFF.pdf"

styles = getSampleStyleSheet()
styles.add(ParagraphStyle("H1c", parent=styles["Heading1"], fontSize=18,
                          spaceBefore=16, spaceAfter=8, textColor=colors.HexColor("#111827")))
styles.add(ParagraphStyle("H2c", parent=styles["Heading2"], fontSize=14,
                          spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#1f2937")))
styles.add(ParagraphStyle("H3c", parent=styles["Heading3"], fontSize=12,
                          spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#374151")))
styles.add(ParagraphStyle("Body", parent=styles["Normal"], fontSize=9.5,
                          leading=14, spaceAfter=4))
styles.add(ParagraphStyle("CodeBlk", parent=styles["Code"], fontSize=8,
                          leading=10, backColor=colors.HexColor("#f3f4f6"),
                          borderPadding=6, textColor=colors.HexColor("#111827")))
styles.add(ParagraphStyle("Bul", parent=styles["Body"], leftIndent=12))


def inline(text):
    text = (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`(.+?)`", r'<font face="Courier">\1</font>', text)
    return text


def build(md):
    flow = []
    lines = md.splitlines()
    i = 0
    bullets = []

    def flush_bullets():
        nonlocal bullets
        if bullets:
            flow.append(ListFlowable(
                [ListItem(Paragraph(inline(b), styles["Bul"]), leftIndent=10)
                 for b in bullets],
                bulletType="bullet", start="•", leftIndent=14))
            flow.append(Spacer(1, 4))
            bullets = []

    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```"):
            flush_bullets()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            flow.append(Preformatted("\n".join(buf) or " ", styles["CodeBlk"]))
            flow.append(Spacer(1, 6))
            i += 1
            continue
        if line.startswith("### "):
            flush_bullets(); flow.append(Paragraph(inline(line[4:]), styles["H3c"]))
        elif line.startswith("## "):
            flush_bullets(); flow.append(Paragraph(inline(line[3:]), styles["H2c"]))
        elif line.startswith("# "):
            flush_bullets(); flow.append(Paragraph(inline(line[2:]), styles["H1c"]))
        elif re.match(r"^\s*[-*]\s+", line):
            bullets.append(re.sub(r"^\s*[-*]\s+", "", line))
        elif re.match(r"^\s*\d+\.\s+", line):
            flush_bullets()
            flow.append(Paragraph(inline(line.strip()), styles["Bul"]))
        elif line.strip() == "":
            flush_bullets(); flow.append(Spacer(1, 4))
        else:
            flush_bullets(); flow.append(Paragraph(inline(line), styles["Body"]))
        i += 1
    flush_bullets()
    return flow


with open(SRC) as f:
    md = f.read()

doc = SimpleDocTemplate(OUT, pagesize=letter,
                        leftMargin=0.8*inch, rightMargin=0.8*inch,
                        topMargin=0.7*inch, bottomMargin=0.7*inch)
doc.build(build(md))
print(f"Wrote {OUT}")
