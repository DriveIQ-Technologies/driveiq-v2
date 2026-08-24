#!/usr/bin/env python3
"""Answers to Part C-E (pages 8-10) of the DriveIQ build-order doc."""

from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).resolve().parents[1] / "DriveIQ-Airport-and-Launch-Answers.pdf"

BLUE = (45, 125, 246)
DARK = (14, 42, 58)
MUTED = (91, 115, 136)
LIGHT = (244, 247, 250)
ACCENT = (232, 163, 23)


class PDF(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*BLUE)
        self.cell(0, 6, "DriveIQ  |  Airport & Launch Answers", align="L")
        self.set_font("Helvetica", "", 9)
        self.set_text_color(*MUTED)
        self.cell(0, 6, "August 2026", align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*BLUE)
        self.set_line_width(0.4)
        self.line(self.l_margin, self.get_y() + 1, self.w - self.r_margin, self.get_y() + 1)
        self.ln(8)

    def footer(self):
        self.set_y(-14)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(
            0,
            8,
            f"Page {self.page_no()}/{{nb}}  -  Confidential - DriveIQ Technologies Ltd",
            align="C",
        )

    def h1(self, text: str):
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 18)
        self.set_text_color(*DARK)
        self.multi_cell(0, 9, text)
        self.ln(2)

    def h2(self, text: str):
        self.ln(3)
        self.set_x(self.l_margin)
        self.set_fill_color(*LIGHT)
        self.set_font("Helvetica", "B", 12)
        self.set_text_color(*BLUE)
        y = self.get_y()
        self.rect(self.l_margin, y, self.epw, 9, style="F")
        self.set_xy(self.l_margin + 2, y + 1.5)
        self.cell(0, 6, text, new_x="LMARGIN", new_y="NEXT")
        self.ln(3)

    def h3(self, text: str):
        self.ln(2)
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*DARK)
        self.multi_cell(0, 6, text)
        self.ln(1)

    def body(self, text: str):
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*DARK)
        self.multi_cell(0, 5.5, text)
        self.ln(1.5)

    def bullet(self, text: str, indent: float = 4):
        self.set_x(self.l_margin + indent)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*DARK)
        self.cell(5, 5.5, "-")
        self.multi_cell(self.epw - indent - 5, 5.5, text)
        self.ln(0.5)

    def note(self, text: str):
        self.set_x(self.l_margin)
        self.set_fill_color(255, 248, 230)
        self.set_draw_color(*ACCENT)
        self.set_line_width(0.3)
        y = self.get_y()
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(*DARK)
        # measure
        self.set_xy(self.l_margin + 3, y + 3)
        w = self.epw - 6
        self.multi_cell(w, 5, text)
        h = self.get_y() - y + 3
        self.rect(self.l_margin, y, self.epw, h, style="D")
        self.set_y(y + h + 3)

    def row(self, left: str, right: str, left_w: float = 48):
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(*DARK)
        x0 = self.l_margin
        y0 = self.get_y()
        self.multi_cell(left_w, 5.5, left)
        y1 = self.get_y()
        self.set_xy(x0 + left_w + 2, y0)
        self.set_font("Helvetica", "", 10)
        self.multi_cell(self.epw - left_w - 2, 5.5, right)
        self.set_y(max(y1, self.get_y()) + 1.5)


def build() -> Path:
    pdf = PDF(format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(18, 18, 18)
    pdf.add_page()

    # Cover block
    pdf.set_fill_color(*BLUE)
    pdf.rect(0, 0, 210, 42, style="F")
    pdf.set_xy(18, 14)
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(0, 8, "DriveIQ - Airport & Launch Answers", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(18)
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, "Responses to Part C, D and E (build-order doc, pages 8-10)", new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(50)
    pdf.set_text_color(*MUTED)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5.5,
        "Prepared for Zakariye / DriveIQ stakeholders. Written in first person from the development side. "
        "Answers are based on the current codebase and live provider wiring as of 24 August 2026.",
    )
    pdf.ln(2)

    # Part C
    pdf.h2("Part C - Airport data: five answers")
    pdf.body(
        "This is expected to be the largest recurring cost. Below is the honest status of what is "
        "in the app today versus what the v2 spec assumes."
    )

    pdf.h3("1. Which provider, and is it free / trial / paid?")
    pdf.body(
        "Arrivals and departures come from AeroDataBox via RapidAPI. The app key is live "
        "(EXPO_PUBLIC_AERODATABOX_API_KEY). Airports covered: Heathrow, Gatwick, Stansted, "
        "Luton and London City."
    )
    pdf.body(
        "I cannot see the RapidAPI billing dashboard from here. Please open RapidAPI -> AeroDataBox -> "
        "Billing / Usage and confirm whether this key is on Basic (free), Pro, Ultra or Mega. "
        "If it is still Basic or a trial that will expire, say so now - that is the launch risk the "
        "doc is asking about."
    )

    pdf.h3("2. What does it cost now, and how is it metered?")
    pdf.body(
        "Metered in API units per request on RapidAPI (FIDS flights-at-airport calls), not per "
        "flight and not a pure flat London fee. Published plan quotas are roughly: Free ~600 units/mo, "
        "Pro ~6,000, Ultra ~60,000, Mega ~600,000. Overage applies above the plan. Exact GBP for this "
        "account must come from your RapidAPI invoice / usage page."
    )

    pdf.h3("3. Cost at the spec's polling intervals?")
    pdf.body(
        "The spec wants: Heathrow + Gatwick every 5 minutes, other airports every 15 minutes, "
        "roughly 05:00-01:00, once for the whole city."
    )
    pdf.bullet("LHR + LGW: ~2 airports × 12 calls/hour × ~20 hours × 30 days ~ 14,400 calls")
    pdf.bullet("STN / LTN / LCY: ~3 × 4/hour × 20 × 30 ~ 7,200")
    pdf.bullet("Total ~ 21,600 FIDS calls/month if all five poll on that cadence")
    pdf.body(
        "That only fits a mid/high RapidAPI tier or a negotiated direct AeroDataBox deal. It does "
        "not fit Free, and Pro alone is tight unless we drop cadence or airports. Once you send the "
        "current plan + usage, I will map this to a hard monthly number."
    )

    pdf.h3("4. Does that figure change at 1k / 5k / 20k users?")
    pdf.note(
        "Honest answer: with the current architecture, YES - and that is wrong versus the doc. "
        "Today each device that opens an airport board (or has a watched flight on the ~3-minute poll) "
        "calls AeroDataBox from the phone. Cost scales with active users. Per-airport polling only "
        "becomes flat when the server layer fetches once, caches in Firestore, and every user reads "
        "the cache. Until that ships, more users = more API spend."
    )

    pdf.h3("5. Cancellations, diversions, actual terminal?")
    pdf.row("Cancellations", "Yes - status + cancelled flag on the board; watched flights can ping on cancel.")
    pdf.row("Terminal", "Yes - we already map terminal when AeroDataBox sends it.")
    pdf.row(
        "Diversions",
        "Partial - not a first-class diverted UI field yet. Status text may mention it; "
        "easy to add if the payload is present.",
    )

    # Part D
    pdf.add_page()
    pdf.h2("Part D - Easy to miss (status)")
    pdf.body(
        "None of these are features. They are the difference between finished and beta. "
        "Current status against each item:"
    )

    items = [
        (
            "Alert dedupe",
            "Partial - we diff against the last snapshot so the same id does not re-ping. "
            "Not yet full same-incident logic (only re-ping if it materially changes).",
        ),
        (
            "Quiet hours (02:00-05:00)",
            "Not built. Default off overnight with an override for night drivers still to do.",
        ),
        (
            "Permission priming",
            "Mostly headed the right way for stations (ask in context of Save/Notify). "
            "Needs a clean pass so we never burn the OS dialog on first launch.",
        ),
        (
            "Quiet-night empty states",
            "Partial - some screens still look thin on a quiet Tuesday. Every empty state "
            "should say what is being watched and when to check back.",
        ),
        (
            "Stale data indicator",
            "Not consistent on every live surface. Last-updated time should appear on roads, "
            "lines, flights and events boards.",
        ),
        (
            "Day-eight waitlist screen",
            "Not built. The seven-day Premium unlock exists when a waitlist email signs in; "
            "the closing conversion screen (specific usage + offer) does not. Priority before "
            "the first waitlister's week runs out.",
        ),
        (
            "In-car readability",
            "Ongoing - not a full audit. Spec: nothing below 16px, 44px tap targets.",
        ),
        (
            "PostHog events",
            "Spec exists; wiring for the new surfaces (corridor tap, three-hour wall, inline "
            "upgrade, second station, signup skip/complete) is incomplete.",
        ),
    ]
    for title, status in items:
        pdf.h3(title)
        pdf.body(status)

    # Part E
    pdf.h2("Part E - Where Premium conversions come from")
    pdf.body(
        "No new product ideas required - these are the conversion moments from the doc. "
        "Status in the app today:"
    )
    pdf.bullet(
        "The three-hour flight wall (task 03) - Free sees ~3 hours / 1 watched flight; "
        "Premium full day. Conversion surface exists; RevenueCat paywall still to wire."
    )
    pdf.bullet(
        "Second station save (task 01) - Free gets one station; further saves show the "
        "upgrade path. Live in the hub flow."
    )
    pdf.bullet(
        "Dim, never hide - pattern used on locked flights/stations; week-ahead events "
        "should get the same treatment consistently."
    )
    pdf.bullet(
        "Day-eight waitlist screen - not built yet (see Part D)."
    )
    pdf.bullet(
        "Referral (give a week / get a week) - post-launch. Spoken alerts stay OUT of launch."
    )

    pdf.h2("What I need from you")
    pdf.bullet(
        "Screenshot or note of the current RapidAPI AeroDataBox plan and this month's unit usage."
    )
    pdf.bullet(
        "RevenueCat tomorrow: pro entitlement, products, public API keys - then I wire SDK, "
        "paywall, waitlist week into RevCat, and upgrade CTAs."
    )
    pdf.bullet(
        "Confirm priority order: I recommend RevCat first for launch gating, then server-side "
        "airport cache so cost stays flat regardless of user count."
    )

    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(
        0,
        5,
        "Related: server push layer (alerts with the app closed) remains a separate 1-2 week "
        "build after local notifications are proven on device. Local notification logic is wired "
        "but has not had a full live channel-by-channel device test yet.",
    )

    pdf.output(OUT)
    return OUT


if __name__ == "__main__":
    path = build()
    print(path)
