from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUTPUT_PATH = r"C:/quake code/apps/quake-desktop/dist/cv-template.pdf"
REGULAR_FONT = "DejaVuSans"
BOLD_FONT = "DejaVuSans-Bold"
ACCENT = colors.HexColor("#111827")
MUTED = colors.HexColor("#6B7280")
LINE = colors.HexColor("#E5E7EB")
TEXT = colors.HexColor("#1F2937")
SOFT = colors.HexColor("#F9FAFB")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont(REGULAR_FONT, r"C:/Windows/Fonts/DejaVuSans.ttf"))
    pdfmetrics.registerFont(TTFont(BOLD_FONT, r"C:/Windows/Fonts/DejaVuSans-Bold.ttf"))


def build_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="Name",
            parent=styles["Title"],
            fontName=BOLD_FONT,
            fontSize=27,
            leading=31,
            textColor=ACCENT,
            alignment=TA_LEFT,
            spaceAfter=2,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Role",
            parent=styles["BodyText"],
            fontName=REGULAR_FONT,
            fontSize=11,
            leading=15,
            textColor=MUTED,
            alignment=TA_LEFT,
            spaceAfter=5,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Contact",
            parent=styles["BodyText"],
            fontName=REGULAR_FONT,
            fontSize=8.8,
            leading=12,
            textColor=MUTED,
            alignment=TA_LEFT,
            spaceAfter=0,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Section",
            parent=styles["Heading2"],
            fontName=BOLD_FONT,
            fontSize=10.2,
            leading=13,
            textColor=ACCENT,
            alignment=TA_LEFT,
            spaceBefore=10,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Body",
            parent=styles["BodyText"],
            fontName=REGULAR_FONT,
            fontSize=9.4,
            leading=13.2,
            textColor=TEXT,
            alignment=TA_LEFT,
            spaceAfter=3,
        )
    )
    styles.add(
        ParagraphStyle(
            name="ItemTitle",
            parent=styles["BodyText"],
            fontName=BOLD_FONT,
            fontSize=10,
            leading=13,
            textColor=ACCENT,
            alignment=TA_LEFT,
            spaceAfter=1,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Meta",
            parent=styles["BodyText"],
            fontName=REGULAR_FONT,
            fontSize=8.2,
            leading=10.8,
            textColor=MUTED,
            alignment=TA_LEFT,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CVBullet",
            parent=styles["BodyText"],
            fontName=REGULAR_FONT,
            fontSize=9.1,
            leading=12.6,
            textColor=TEXT,
            leftIndent=10,
            bulletIndent=0,
            spaceAfter=2,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SkillText",
            parent=styles["BodyText"],
            fontName=REGULAR_FONT,
            fontSize=8.5,
            leading=10.5,
            textColor=ACCENT,
            alignment=TA_LEFT,
        )
    )
    return styles


def hr(width_mm: float):
    line = Table([[""]], colWidths=[width_mm * mm], rowHeights=[0.8])
    line.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), LINE),
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 0),
                ("TOPPADDING", (0, 0), (0, 0), 0),
                ("BOTTOMPADDING", (0, 0), (0, 0), 0),
            ]
        )
    )
    return line


def section_heading(text: str, styles):
    table = Table([[Paragraph(text, styles["Section"])]], colWidths=[174 * mm])
    table.setStyle(
        TableStyle(
            [
                ("LINEBELOW", (0, 0), (0, 0), 0.8, LINE),
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 0),
                ("TOPPADDING", (0, 0), (0, 0), 0),
                ("BOTTOMPADDING", (0, 0), (0, 0), 4),
            ]
        )
    )
    return table


def skill_pill(text: str, styles):
    pill = Table([[Paragraph(text, styles["SkillText"])]])
    pill.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), SOFT),
                ("BOX", (0, 0), (0, 0), 0.6, LINE),
                ("LEFTPADDING", (0, 0), (0, 0), 8),
                ("RIGHTPADDING", (0, 0), (0, 0), 8),
                ("TOPPADDING", (0, 0), (0, 0), 4),
                ("BOTTOMPADDING", (0, 0), (0, 0), 4),
            ]
        )
    )
    return pill


def build_pdf(output_path: str) -> None:
    register_fonts()
    styles = build_styles()

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )

    story = []

    story.append(Paragraph("AD SOYAD", styles["Name"]))
    story.append(Paragraph("Pozisyon / ├£nvan", styles["Role"]))
    story.append(Paragraph("Telefon  ÔÇó  E-posta  ÔÇó  ┼Şehir  ÔÇó  LinkedIn  ÔÇó  GitHub  ÔÇó  Portf├Ây", styles["Contact"]))
    story.append(Spacer(1, 6))
    story.append(hr(174))
    story.append(Spacer(1, 8))

    story.append(section_heading("PROF─░L", styles))
    story.append(Spacer(1, 3))
    story.append(
        Paragraph(
            "Kendinizi k─▒sa ve g├╝├ğl├╝ bir dille anlat─▒n. Hangi alanda uzmanla┼şt─▒─ş─▒n─▒z─▒, hangi teknolojilerle ├ğal─▒┼şt─▒─ş─▒n─▒z─▒ ve ne t├╝r problemleri ├ğ├Âzebildi─şinizi 2-4 c├╝mlede ├Âzetleyin. Bu alan yal─▒n, profesyonel ve g├╝ven veren bir ton ta┼ş─▒mal─▒.",
            styles["Body"],
        )
    )

    story.append(Spacer(1, 5))
    story.append(section_heading("DENEY─░M", styles))
    story.append(Spacer(1, 3))

    story.append(Paragraph("┼Şirket / Kurum Ad─▒ ÔÇö Pozisyon", styles["ItemTitle"]))
    story.append(Paragraph("Ba┼şlang─▒├ğ Tarihi ÔÇô Biti┼ş Tarihi  |  ┼Şehir", styles["Meta"]))
    story.append(Paragraph("ÔÇó Sorumlulu─şunuzu ve ortaya koydu─şunuz etkiyi k─▒sa, net ve m├╝mk├╝nse ├Âl├ğ├╝lebilir bi├ğimde yaz─▒n.", styles["CVBullet"], bulletText="ÔÇó"))
    story.append(Paragraph("ÔÇó Kulland─▒─ş─▒n─▒z teknoloji, geli┼ştirdi─şiniz ├Âzellik veya iyile┼ştirdi─şiniz s├╝reci belirtin.", styles["CVBullet"], bulletText="ÔÇó"))
    story.append(Paragraph("ÔÇó C├╝mleleri k─▒sa tutun; g├╝├ğl├╝ fiiller ve somut katk─▒lar kullan─▒n.", styles["CVBullet"], bulletText="ÔÇó"))
    story.append(Spacer(1, 5))

    story.append(Paragraph("┼Şirket / Kurum Ad─▒ ÔÇö Pozisyon", styles["ItemTitle"]))
    story.append(Paragraph("Ba┼şlang─▒├ğ Tarihi ÔÇô Biti┼ş Tarihi  |  ┼Şehir", styles["Meta"]))
    story.append(Paragraph("ÔÇó Staj, part-time, freelance veya g├Ân├╝ll├╝ ├ğal─▒┼şmalar─▒n─▒z─▒ da ekleyebilirsiniz.", styles["CVBullet"], bulletText="ÔÇó"))
    story.append(Paragraph("ÔÇó Burada yapt─▒─ş─▒n─▒z i┼şin neden ├Ânemli oldu─şunu hissettirin.", styles["CVBullet"], bulletText="ÔÇó"))

    story.append(Spacer(1, 5))
    story.append(section_heading("PROJELER", styles))
    story.append(Spacer(1, 3))

    story.append(Paragraph("Proje Ad─▒", styles["ItemTitle"]))
    story.append(Paragraph("Teknolojiler: React, TypeScript, Node.js, PostgreSQL", styles["Meta"]))
    story.append(Paragraph("ÔÇó Projenin ne yapt─▒─ş─▒n─▒ tek c├╝mlede a├ğ─▒k├ğa anlat─▒n.", styles["CVBullet"], bulletText="ÔÇó"))
    story.append(Paragraph("ÔÇó Kendi rol├╝n├╝z├╝, teknik karar─▒n─▒z─▒ veya ortaya ├ğ─▒kan sonucu yaz─▒n.", styles["CVBullet"], bulletText="ÔÇó"))
    story.append(Paragraph("ÔÇó Varsa GitHub, canl─▒ demo veya ├╝r├╝n linki ekleyin.", styles["CVBullet"], bulletText="ÔÇó"))
    story.append(Spacer(1, 5))

    story.append(Paragraph("Proje Ad─▒", styles["ItemTitle"]))
    story.append(Paragraph("Teknolojiler: Python, FastAPI, Docker, Azure", styles["Meta"]))
    story.append(Paragraph("ÔÇó Ki┼şisel proje, bitirme projesi, hackathon veya open-source ├ğal─▒┼şma olabilir.", styles["CVBullet"], bulletText="ÔÇó"))

    story.append(Spacer(1, 5))
    story.append(section_heading("E─Ş─░T─░M", styles))
    story.append(Spacer(1, 3))

    story.append(Paragraph("├£niversite / Okul Ad─▒ ÔÇö B├Âl├╝m", styles["ItemTitle"]))
    story.append(Paragraph("Ba┼şlang─▒├ğ Y─▒l─▒ ÔÇô Biti┼ş Y─▒l─▒  |  GNO (iste─şe ba─şl─▒)", styles["Meta"]))
    story.append(Paragraph("─░lgili dersler, akademik ba┼şar─▒lar, kul├╝p faaliyetleri veya tez konusu burada belirtilebilir.", styles["Body"]))

    story.append(Spacer(1, 5))
    story.append(section_heading("YETENEKLER", styles))
    story.append(Spacer(1, 5))

    skills = [
        [skill_pill("JavaScript", styles), skill_pill("TypeScript", styles), skill_pill("React", styles), skill_pill("Next.js", styles)],
        [skill_pill("Node.js", styles), skill_pill("Python", styles), skill_pill("SQL", styles), skill_pill("Azure", styles)],
        [skill_pill("Git", styles), skill_pill("Docker", styles), skill_pill("Figma", styles), skill_pill("Linux", styles)],
    ]
    skill_table = Table(skills, colWidths=[41 * mm, 41 * mm, 41 * mm, 41 * mm], hAlign="LEFT")
    skill_table.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(skill_table)

    story.append(Spacer(1, 5))
    story.append(section_heading("SERT─░F─░KALAR / EK B─░LG─░LER", styles))
    story.append(Spacer(1, 3))
    story.append(Paragraph("ÔÇó Sertifika ad─▒ ÔÇö Kurum / Y─▒l", styles["CVBullet"], bulletText="ÔÇó"))
    story.append(Paragraph("ÔÇó Yar─▒┼şmalar, g├Ân├╝ll├╝l├╝k, topluluk ├ğal─▒┼şmalar─▒ veya ├Âd├╝ller", styles["CVBullet"], bulletText="ÔÇó"))
    story.append(Paragraph("ÔÇó Yabanc─▒ dil seviyesi veya ek profesyonel bilgiler", styles["CVBullet"], bulletText="ÔÇó"))

    doc.build(story)


if __name__ == "__main__":
    build_pdf(OUTPUT_PATH)
    print(OUTPUT_PATH)
