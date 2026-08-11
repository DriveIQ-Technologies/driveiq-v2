#!/usr/bin/env python3
"""Generate DriveIQ client update PDF (Aug 2026)."""

from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).resolve().parents[1] / "DriveIQ-Client-Update-Aug-2026.pdf"

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
        self.cell(0, 6, "DriveIQ  |  Product Update", align="L")
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
        self.cell(0, 8, f"Page {self.page_no()}/{{nb}}  -  Confidential - for DriveIQ stakeholders", align="C")

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
        self.set_font("Helvetica", "B", 13)
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
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*DARK)
        x = self.l_margin + indent
        self.set_x(x)
        # bullet
        self.cell(5, 5.5, "-")
        self.multi_cell(self.w - self.r_margin - x - 5, 5.5, text)
        self.set_x(self.l_margin)

    def numbered(self, n: int, text: str):
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*DARK)
        x = self.l_margin + 2
        self.set_x(x)
        self.set_font("Helvetica", "B", 10)
        self.cell(8, 5.5, f"{n}.")
        self.set_font("Helvetica", "", 10)
        self.multi_cell(self.w - self.r_margin - x - 8, 5.5, text)
        self.set_x(self.l_margin)

    def callout(self, title: str, text: str):
        self.ln(2)
        self.set_x(self.l_margin)
        self.set_fill_color(229, 240, 255)  # primarySoft
        self.set_draw_color(*BLUE)
        start_y = self.get_y()
        self.set_xy(self.l_margin + 3, start_y + 3)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(*BLUE)
        self.multi_cell(self.epw - 6, 5, title)
        self.set_x(self.l_margin + 3)
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(*DARK)
        self.multi_cell(self.epw - 6, 5, text)
        end_y = self.get_y() + 2
        self.rect(self.l_margin, start_y, self.epw, end_y - start_y, style="D")
        self.set_y(end_y + 2)
        self.set_x(self.l_margin)


def build() -> Path:
    pdf = PDF(orientation="P", unit="mm", format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(16, 16, 16)

    # ── Cover ──────────────────────────────────────────────────────────
    pdf.add_page()
    pdf.ln(28)
    pdf.set_fill_color(*BLUE)
    pdf.rect(16, 40, 8, 28, style="F")
    pdf.set_xy(28, 42)
    pdf.set_font("Helvetica", "B", 28)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 12, "DriveIQ", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(28)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(*BLUE)
    pdf.cell(0, 9, "Product Update & Walkthrough Guide", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(8)
    pdf.set_x(28)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(140, 6, "Events accuracy - Station hubs - Flights tiers - AI limits - Branded notifications - Key road corridors")
    pdf.ln(10)
    pdf.set_x(28)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 6, "Prepared for: Zakariye / DriveIQ stakeholders", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(28)
    pdf.cell(0, 6, "Date: August 2026", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(28)
    pdf.cell(0, 6, "From: Development", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(16)
    pdf.set_draw_color(*ACCENT)
    pdf.set_line_width(1.2)
    pdf.line(28, pdf.get_y(), 80, pdf.get_y())
    pdf.ln(10)
    pdf.set_x(28)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(
        150,
        5.5,
        "This document summarises the latest product work shipped in development, "
        "and gives a step-by-step walkthrough so you can open the app and verify "
        "every change yourself before a store build.",
    )

    # ── Summary ────────────────────────────────────────────────────────
    pdf.add_page()
    pdf.h1("1. Executive summary")
    pdf.body(
        "I have pushed through the launch-critical and free/Pro work from your brief. "
        "The focus was: correct event times and date filters for launch; visible station "
        "hubs on the map with a free-tier gate; clearer flight save/notify limits; AI "
        "daily limits with a visible counter; and fully branded notifications including "
        "key London road corridors."
    )
    pdf.h3("What changed (at a glance)")
    for item in [
        "Events - wrong end times and wrong-day filter pins fixed (Ticketmaster durations, multi-day rules, UK timezone).",
        "Connections - seven major termini as green map pins; free users get one station; Pro unlocks all.",
        "Flights - free: next 3 hours + 1 watched flight; Pro: full local day + up to 5 watched.",
        "AI Support - free: 5 questions/day with live counter; Pro: unlimited.",
        "Notifications - DriveIQ-branded copy across roads, lines, events, flights; ~25 min 'event ending' ping; key corridor closures always alert.",
        "Roads - M25, M4, M3, M1, M11, M40, A40, A406, A13, A1, A3, A4 and related busy routes covered in the highways feed + alert logic.",
    ]:
        pdf.bullet(item)

    pdf.callout(
        "Agent + AI (your question)",
        "The plan is one DriveIQ Agent with two channels: Chat (reactive) and "
        "Preemptive prompts (proactive notifications). Both share the same context - "
        "saved events, watched flights, free station, prefs, and live data - so they "
        "feel like one helper, not two products. Next step is letting chat also set up "
        "watches/reminders in conversation.",
    )

    # ── Detailed updates ───────────────────────────────────────────────
    pdf.add_page()
    pdf.h1("2. Detailed updates")

    pdf.h2("2.1 Events - accuracy for launch")
    pdf.body(
        "You flagged incorrect end times and wrong events on the map when filtering. "
        "I audited every provider path and fixed the root causes:"
    )
    pdf.bullet(
        "Ticketmaster was using genre names (Rock, Musical, etc.) for duration lookup. "
        "Those keys were missing, so concerts/theatre silently fell back to a 2-hour end. "
        "Duration now uses the correct segment key (Music, Theatre, Film...)."
    )
    pdf.bullet(
        "Date chips treated any end-time overlap as multi-day, so late shows bled onto "
        "Tomorrow and inflated ends could keep yesterday's events on Today. Only genuine "
        "multi-day fixtures (20+ hours) now span day chips."
    )
    pdf.bullet(
        "UK timezone handling fixed for SportsDB and ICS feeds (BST/GMT), so kick-offs "
        "are no longer an hour late in summer."
    )
    pdf.bullet(
        "Cold-launch cache tightened so yesterday's pins do not paint at launch."
    )
    pdf.body("Result: Today / Tomorrow / day filters and 'Ends ...' times should be trustworthy for launch.")

    pdf.h2("2.2 Connections - stations on the map + free/Pro")
    pdf.body(
        "Your proposal (see stations, free access to one, upgrade for the rest) is what I built:"
    )
    pdf.bullet(
        "Paddington, Euston, King's Cross, St Pancras, Waterloo, Liverpool Street and "
        "Victoria appear as green train pins - visually separate from navy airport pins."
    )
    pdf.bullet("Locked hubs show a gold padlock. First open claims the free station; others show the Pro path.")
    pdf.bullet("Hub sheet shows live tube / Elizabeth / Overground / National Rail lines serving that terminus.")
    pdf.bullet("Same gating in the Connections panel list.")

    pdf.h2("2.3 Flights - save / notify tiers")
    pdf.bullet("Flights remain tappable with a detail sheet and Watch for delays.")
    pdf.bullet("Free: next ~3 hours of the board; 1 watched (save/notify) flight.")
    pdf.bullet("Pro: full local day; up to 5 watched flights, with clear limit messaging.")

    pdf.h2("2.4 AI Support - daily quota")
    pdf.bullet("Free: 5 questions per calendar day; header shows 'X of 5 free questions left today'.")
    pdf.bullet("Pro: unlimited.")
    pdf.bullet("Hitting the free limit shows an in-chat upgrade prompt.")

    pdf.h2("2.5 Notifications - branded + roads")
    pdf.bullet(
        "Copy rewritten in DriveIQ voice for roads, lines, saved events and watched flights "
        "(e.g. line down / flight delayed / event ending)."
    )
    pdf.bullet(
        "Saved events now also schedule a ping ~25 minutes before the event ends - "
        "so drivers can leave ahead of the crowd."
    )
    pdf.bullet(
        "Key corridor closures (M25, M23, M20, M11, M40, M4, M3, M2, M1, A1, A2, A3, A4, "
        "A10, A12, A13, A20, A40, A406, A205...) always warrant an alert, even below 'Severe'."
    )
    pdf.bullet("Incident / line / flight poll tightened to ~3 minutes while the app is open.")
    pdf.callout(
        "Note on real-time",
        "Alerts are strong while the app is active. True background push when the app is "
        "closed needs a small server-side push layer - happy to scope that post-launch.",
    )

    # ── Walkthrough ────────────────────────────────────────────────────
    pdf.add_page()
    pdf.h1("3. How to replicate / verify the updates")
    pdf.body(
        "Use this walkthrough on a device or simulator running the latest development build. "
        "Allow notifications when asked. Skip the welcome tour so the map is clear."
    )
    pdf.callout(
        "Optional - Pro preview",
        "To demo Pro behaviour: set EXPO_PUBLIC_PRO_PREVIEW=1 in the environment and reload, "
        "or leave it off to experience free limits first. You can also film free then Pro.",
    )

    pdf.h2("3.1 Events - times & filters")
    for i, step in enumerate(
        [
            "Open the map. Note All / Today / Tomorrow / day chips and counts.",
            "Tap Today - only events that start today should show (a late show tonight should not also appear under Tomorrow).",
            "Tap Tomorrow - yesterday's or tonight's late events should not bleed over.",
            "Open a concert (O2 / Wembley / music). Check Ends is ~3 hours or ~22:45 for big arenas - not a wrong early finish.",
            "Open a theatre / comedy pin - end time should look sensible (~2.5-3h).",
            "If a multi-day fixture exists (e.g. cricket Test), it may appear across those day chips; single-night gigs must not.",
        ],
        start=1,
    ):
        pdf.numbered(i, step)

    pdf.h2("3.2 Connections - map + free station")
    for i, step in enumerate(
        [
            "Pinch out over central London.",
            "Find green train pins for the seven termini - separate from navy plane pins.",
            "Locked hubs show a gold padlock.",
            "Tap a locked station -> 'Choose your free station' (first time) or DriveIQ Pro upsell (after claiming one).",
            "Claim one free station -> padlock clears; open the hub -> live lines + Get directions.",
            "Tap another station -> stays locked / Pro prompt.",
            "Open Connections (train icon) -> same station list with locks + All lines status.",
            "With Pro preview on -> all stations open, no locks.",
        ],
        start=1,
    ):
        pdf.numbered(i, step)

    pdf.add_page()
    pdf.h2("3.3 Flights - 3h / 1 watch vs full day / 5")
    for i, step in enumerate(
        [
            "Tap a plane pin (Heathrow / Gatwick / etc.).",
            "Check rail links at the top, then the flights board.",
            "Free: only the next ~3 hours; banner reflects 3h + 1 watched flight.",
            "Toggle Full day of flights -> Pro paywall if not Pro.",
            "Tap a flight -> Watch for delays.",
            "Try watching a second flight -> free limit alert (1 only).",
            "Pro: full-day toggle works; watch up to 5; 6th is blocked.",
        ],
        start=1,
    ):
        pdf.numbered(i, step)

    pdf.h2("3.4 AI Support - quota counter")
    for i, step in enumerate(
        [
            "Menu -> DriveIQ AI Support.",
            "Header shows 'X of 5 free questions left today' (or Pro - unlimited).",
            "Ask a few questions (e.g. what is on tomorrow?, how do notifications work?).",
            "Watch the counter drop.",
            "After 5 (free) -> next ask gets the limit message + See DriveIQ Pro.",
            "Pro: unlimited; no block.",
        ],
        start=1,
    ):
        pdf.numbered(i, step)

    pdf.h2("3.5 Notifications + roads")
    for i, step in enumerate(
        [
            "Menu -> Notifications. Confirm channels: roads, lines, saved events, watched flights.",
            "Save an event -> reminders schedule for 1 hour before start and ~25 minutes before end (fire only if the event is soon).",
            "Watch a flight with the channel on -> delay/cancel pings on the ~3 min poll while the app is open.",
            "On the map, look for traffic/incident markers on busy corridors (M25, M4, M3, M1, M11, M40, A40, A406, A13...). New key-road closures should notify with branded copy.",
            "Line disruption escalating to severe/closed -> branded 'X is down - take a look'.",
        ],
        start=1,
    ):
        pdf.numbered(i, step)

    pdf.h2("3.6 Suggested screen recording order for review")
    for i, step in enumerate(
        [
            "Wide map: green stations (locks) + plane pins + M25 / major roads visible.",
            "Tap locked station -> free claim / Pro.",
            "Open free station hub -> live lines.",
            "Tap Heathrow -> flights board + watch + free limit.",
            "AI Support header counter.",
            "Notification settings + (if possible) one live road or line ping.",
        ],
        start=1,
    ):
        pdf.numbered(i, step)

    # ── Reset / next ───────────────────────────────────────────────────
    pdf.add_page()
    pdf.h1("4. Reset tips (clean free demo)")
    pdf.body(
        "If you need to re-demo free limits from scratch, clear app data / reinstall, "
        "or remove these local keys:"
    )
    pdf.bullet("driveiq.freeStation.v1 - claimed free station")
    pdf.bullet("driveiq.pro.unlock - soft Pro flag (when not using EXPO_PUBLIC_PRO_PREVIEW)")
    pdf.bullet("driveiq.aiQuota.v1 - AI question counter for today")
    pdf.bullet("driveiq.savedFlights.v1 - watched flights")
    pdf.bullet("driveiq.tour.seen.v1 / driveiq.notif.onboardingSeen.v1 - first-launch flow")

    pdf.h1("5. What's next")
    pdf.bullet("Wire chat and proactive alerts as one Agent (chat can set watches/reminders).")
    pdf.bullet("RevenueCat / real paywall when store products and API keys are ready.")
    pdf.bullet("Optional post-launch: server-side push for true background alerts.")
    pdf.ln(4)
    pdf.body(
        "Happy to jump on a call to walk through any of this before store release, "
        "or to send a short screen recording pack of the steps above."
    )
    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 10)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 5.5, "- End of update -")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    return OUT


if __name__ == "__main__":
    path = build()
    print(path)
