#!/usr/bin/env python3
"""Generate DriveIQ PostHog analytics implementation spec PDF."""

from pathlib import Path

from fpdf import FPDF

OUT = (
    Path(__file__).resolve().parents[1]
    / "DriveIQ-PostHog-Analytics-Implementation-Spec-Aug-2026.pdf"
)

BLUE = (45, 125, 246)
DARK = (14, 42, 58)
MUTED = (91, 115, 136)
LIGHT = (244, 247, 250)


class PDF(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*BLUE)
        self.cell(0, 6, "DriveIQ  |  PostHog Analytics Spec", align="L")
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
        self.ln(1.2)

    def bullet(self, text: str, indent: float = 4):
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*DARK)
        x = self.l_margin + indent
        self.set_x(x)
        self.cell(5, 5.5, "-")
        self.multi_cell(self.w - self.r_margin - x - 5, 5.5, text)
        self.set_x(self.l_margin)

    def numbered(self, n: int, text: str):
        self.set_x(self.l_margin)
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
        self.set_fill_color(229, 240, 255)
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


def feature_event_block(pdf: PDF, title: str, events: list[str], files: list[str]) -> None:
    pdf.h3(title)
    pdf.body("Priority events to instrument")
    for e in events:
        pdf.bullet(e)
    pdf.body("Primary hook files")
    for f in files:
        pdf.bullet(f)


def build() -> Path:
    pdf = PDF(orientation="P", unit="mm", format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(16, 16, 16)

    # Cover
    pdf.add_page()
    pdf.ln(26)
    pdf.set_fill_color(*BLUE)
    pdf.rect(16, 40, 8, 28, style="F")
    pdf.set_xy(28, 42)
    pdf.set_font("Helvetica", "B", 28)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 12, "DriveIQ", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(28)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(*BLUE)
    pdf.cell(0, 9, "PostHog Analytics Implementation Spec", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(8)
    pdf.set_x(28)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(
        145,
        6,
        "Technical handoff for instrumentation, event taxonomy, dashboards, privacy guardrails, and rollout QA.",
    )
    pdf.ln(8)
    pdf.set_x(28)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 6, "Company: DriveIQ Technologies Ltd", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(28)
    pdf.cell(0, 6, "Date: August 2026", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(28)
    pdf.cell(0, 6, "Status: Ready for implementation", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(12)
    pdf.set_x(28)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(
        150,
        5.5,
        "This document is built from a full codebase audit. It defines exactly what to track in PostHog, where to instrument it, and how to validate data quality before launch.",
    )

    # Section 1
    pdf.add_page()
    pdf.h1("1. Objectives and success criteria")
    pdf.body(
        "Goal: integrate PostHog so the team can make product and revenue decisions from trustworthy data, not guesswork."
    )
    for b in [
        "Measure full user journey: discovery -> engagement -> routing -> retention -> upgrade.",
        "Track free vs premium behavior with clear funnel breakpoints.",
        "Track system health (provider failures, timeouts, cache behavior) next to product metrics.",
        "Enforce privacy-safe event payloads and avoid accidental PII capture.",
    ]:
        pdf.bullet(b)

    pdf.h3("North-star reporting outputs")
    for b in [
        "Activation: first meaningful action rate within first session.",
        "Engagement: weekly active users and repeat usage by feature cluster.",
        "Conversion: paywall shown -> trial started -> subscription started.",
        "Retention: D1, D7, D30 by acquisition cohort and tier.",
        "Reliability: provider timeout/failure rates correlated with engagement drop.",
    ]:
        pdf.bullet(b)

    pdf.callout(
        "Implementation rule",
        "Every event must answer a business question. If an event does not drive a dashboard, alert, or decision, do not ship it.",
    )

    # Section 2 architecture
    pdf.h2("2. Analytics architecture")
    pdf.body("Recommended design in this repo")
    for n, t in enumerate(
        [
            "Create src/services/analytics.ts wrapper with typed track(name, props), identify(userId), reset(), and page(screen).",
            "Initialize PostHog in app/_layout.tsx only once; set persistence mode and app-level properties.",
            "Call identify/reset from AuthProvider on auth state transitions.",
            "Instrument user actions in app/index.tsx and feature sheets/components.",
            "Instrument system/service metrics in src/services/* provider fetchers and event orchestration.",
            "Add kill switch and sample-rate controls via Remote Config or env flags.",
        ],
        start=1,
    ):
        pdf.numbered(n, t)

    pdf.h3("Core properties on every event")
    for b in [
        "app_version, build_number, platform, os_version",
        "tier (free/pro), auth_state (signed_in/signed_out), session_id",
        "city_scope fixed to London, feature_surface",
        "event_timestamp_utc generated client-side",
    ]:
        pdf.bullet(b)

    # Section 3 taxonomy
    pdf.add_page()
    pdf.h1("3. Event taxonomy and naming")
    pdf.body("Naming convention")
    for b in [
        "User events: feature_action_result (example: route_preview_started, event_saved).",
        "System events: provider_status_metric (example: provider_timeout, events_cache_hit).",
        "Monetization events: paywall_action_step (example: paywall_shown, trial_started).",
        "No ambiguous names like click_1 or button_pressed.",
    ]:
        pdf.bullet(b)

    pdf.h3("Required identity model")
    for b in [
        "Before sign in: anonymous distinct_id from PostHog device identity.",
        "After sign in: identify(firebase_uid) and alias anonymous history.",
        "On sign out: reset identity to avoid cross-user contamination.",
        "Never use raw email as distinct_id.",
    ]:
        pdf.bullet(b)

    pdf.h3("High-value event families")
    for b in [
        "Onboarding: app_opened, splash_completed, product_tour_completed",
        "Discovery: filter_date_changed, filter_category_toggled, event_pin_tapped",
        "Navigation: route_preview_started, navigation_started, navigation_exited",
        "Retention: event_saved, flight_watch_saved, notification_channel_toggled",
        "Monetization: paywall_shown, paywall_dismissed, trial_started, subscription_started",
        "Reliability: provider_timeout, provider_failed, coverage_gap_detected",
    ]:
        pdf.bullet(b)

    # Section 4 feature instrumentation map
    pdf.add_page()
    pdf.h1("4. Feature instrumentation map (code-level)")
    pdf.body("Map and event discovery")
    feature_event_block(
        pdf,
        "Map exploration and event discovery",
        [
            "filter_date_changed (filter_key, result_count)",
            "filter_category_toggled (category, selected)",
            "event_pin_tapped (event_id, source, category)",
            "cluster_tapped (cluster_size)",
            "event_detail_opened and event_detail_closed",
            "layer_toggled (layer, enabled)",
        ],
        [
            "app/index.tsx",
            "src/components/FilterBar.tsx",
            "src/components/CategoryFilterBar.tsx",
            "src/components/EventDetailsSheet.tsx",
            "src/components/LayerControlPanel.tsx",
        ],
    )

    feature_event_block(
        pdf,
        "Save and reminder flows",
        [
            "event_saved / event_unsaved",
            "event_reminder_scheduled",
            "calendar_add_started / calendar_add_success / calendar_add_failed",
            "saved_events_loaded (count)",
        ],
        [
            "app/index.tsx",
            "src/services/savedEvents.ts",
            "src/services/notifications.ts",
            "src/services/calendar.ts",
        ],
    )

    feature_event_block(
        pdf,
        "Routing and navigation",
        [
            "route_preview_started (dest_kind)",
            "route_fetch_success / route_fetch_failed",
            "route_alternative_selected (index)",
            "navigation_started / navigation_exited",
            "navigation_off_route",
            "nav_app_selected (driveiq/google/waze/apple)",
        ],
        [
            "app/index.tsx",
            "src/services/routing.ts",
            "src/components/NavigationAppPicker.tsx",
            "src/components/RouteInfoPanel.tsx",
        ],
    )

    pdf.add_page()
    feature_event_block(
        pdf,
        "Connections and station hubs",
        [
            "connections_panel_opened",
            "station_hub_attempt (station_id, result)",
            "free_station_claimed (station_id)",
            "line_detail_opened (line_id, severity)",
            "station_hub_navigate",
            "paywall_shown (feature=station_hubs)",
        ],
        [
            "app/index.tsx",
            "src/components/ConnectionsPanel.tsx",
            "src/components/StationHubSheet.tsx",
            "src/services/stationAccess.ts",
        ],
    )

    feature_event_block(
        pdf,
        "Airports and flights",
        [
            "airport_pin_tapped (airport_id)",
            "airport_flights_sheet_opened",
            "flights_direction_changed",
            "flights_full_day_toggled",
            "flight_watch_saved / flight_watch_unsaved",
            "flight_watch_limit_hit (tier, limit)",
        ],
        [
            "app/index.tsx",
            "src/components/AirportFlightsSheet.tsx",
            "src/services/savedFlights.ts",
            "src/services/aerodatabox.ts",
        ],
    )

    feature_event_block(
        pdf,
        "AI support and quotas",
        [
            "ai_support_opened",
            "ai_question_asked (answer_type only)",
            "ai_quota_consumed",
            "ai_quota_limit_hit",
            "ai_suggestion_tapped",
            "ai_action_remind and ai_action_calendar",
        ],
        [
            "src/components/AISupportSheet.tsx",
            "src/services/aiQuota.ts",
            "src/services/subscription.ts",
        ],
    )

    # Section 5 auth/paywall/notifications
    pdf.add_page()
    pdf.h1("5. Auth, paywall, and notifications")

    pdf.h3("Auth instrumentation")
    for b in [
        "auth_sheet_opened (mode)",
        "auth_login_attempt/success/failed (error_code only)",
        "auth_signup_attempt/success/failed",
        "auth_reset_requested",
        "auth_logout",
        "account_profile_updated, account_email_updated, account_password_updated",
    ]:
        pdf.bullet(b)
    pdf.body("Hook files: src/components/AuthSheet.tsx, src/providers/AuthProvider.tsx, src/components/AccountSheet.tsx")

    pdf.h3("Paywall and entitlements")
    for b in [
        "Track paywall_shown centrally inside showProPaywall(feature).",
        "Track paywall_dismissed and paywall_cta_tapped from sheet/alert buttons.",
        "When RevenueCat is live, add trial_started, subscription_started, subscription_cancelled.",
        "Keep entitlement source of truth server-side; app only mirrors current tier for UX.",
    ]:
        pdf.bullet(b)

    pdf.h3("Notifications and alert quality")
    for b in [
        "notification_permission_requested/granted/denied",
        "notification_channel_toggled (channel, enabled)",
        "alert_road_incident_sent, alert_line_closure_sent, alert_flight_change_sent",
        "event_reminder_scheduled and event_end_reminder_scheduled",
    ]:
        pdf.bullet(b)
    pdf.body("Hook files: src/services/notifications.ts, src/components/NotificationSettingsPanel.tsx, src/components/NotificationOnboarding.tsx")

    # Section 6 system reliability
    pdf.h2("6. System reliability telemetry")
    pdf.body("Convert existing service logs into PostHog system events")
    for b in [
        "events_fetch_started / events_fetch_complete (total_count, sports_count)",
        "provider_success (provider, count, duration_ms)",
        "provider_failed (provider, error_type)",
        "provider_timeout (provider, timeout_ms)",
        "events_cache_hit/miss/stale, events_cache_written",
        "coverage_gap_detected (venue_labels)",
    ]:
        pdf.bullet(b)
    pdf.body("Primary file: src/services/events.ts plus provider services in src/services/*")

    # Section 7 privacy
    pdf.add_page()
    pdf.h1("7. Privacy, PII, and compliance guardrails")
    pdf.body("Never send these to PostHog")
    for b in [
        "email, password, display name",
        "raw GPS coordinates, exact addresses",
        "chat question text or AI response text",
        "free-text feedback/report notes",
        "notification message body/title",
    ]:
        pdf.bullet(b)

    pdf.body("Allowed identifiers")
    for b in [
        "firebase uid as identify key",
        "opaque event_id, flight_id, line_id, station_id",
        "booleans, buckets, counts, durations",
    ]:
        pdf.bullet(b)

    pdf.callout(
        "Data minimization standard",
        "If a property is not required for a dashboard decision, remove it. Prefer buckets over raw values and IDs over human text.",
    )

    # Section 8 dashboards
    pdf.h2("8. PostHog dashboard pack")
    pdf.h3("Dashboard A - Activation")
    for b in [
        "app_opened -> event_pin_tapped conversion",
        "time_to_first_meaningful_action median",
        "first session save rate (event_saved or flight_watch_saved)",
    ]:
        pdf.bullet(b)

    pdf.h3("Dashboard B - Engagement")
    for b in [
        "WAU/DAU by tier",
        "feature usage mix: map, routing, flights, connections, AI",
        "navigation_started and event_saved trend by week",
    ]:
        pdf.bullet(b)

    pdf.h3("Dashboard C - Monetization")
    for b in [
        "paywall_shown -> paywall_cta_tapped",
        "trial_started -> subscription_started",
        "upgrade trigger attribution by feature",
    ]:
        pdf.bullet(b)

    pdf.h3("Dashboard D - Reliability")
    for b in [
        "provider_failed and provider_timeout by provider",
        "events total vs sports total trend",
        "coverage_gap_detected alerts over time",
    ]:
        pdf.bullet(b)

    # Section 9 rollout and QA
    pdf.add_page()
    pdf.h1("9. Implementation phases and QA gates")

    phases = [
        "Phase 1: Core wrapper + identity + app lifecycle events",
        "Phase 2: Map/routing/save flows + paywall hooks",
        "Phase 3: Flights/connections/AI + quota and gate events",
        "Phase 4: System telemetry + dashboards + data quality alerts",
    ]
    for i, p in enumerate(phases, start=1):
        pdf.numbered(i, p)

    pdf.h3("Pre-release QA checklist")
    qa = [
        "All events visible in PostHog live stream within 5 seconds in debug build",
        "No PII values appear in sampled payload inspection",
        "Anonymous-to-identified merge works after signup/login",
        "Signout resets identity and does not leak previous user timeline",
        "Every paywall surface emits paywall_shown with correct feature property",
        "Provider timeout simulation emits provider_timeout and does not crash app",
        "Dashboards produce stable numbers for 3 consecutive test runs",
    ]
    for q in qa:
        pdf.bullet(q)

    pdf.h3("Operational tracking")
    for b in [
        "Assign one owner per feature area for instrumentation review.",
        "Keep event dictionary in repo and version with code changes.",
        "For every new feature PR, require analytics checklist completion.",
        "Review top 20 events monthly and prune low-value noise.",
    ]:
        pdf.bullet(b)

    pdf.callout(
        "Immediate next step",
        "Implement src/services/analytics.ts and wire the first 20 high-value events (auth, map taps, saves, routing start, paywall shown, provider timeout). Then validate dashboards before expanding scope.",
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    return OUT


if __name__ == "__main__":
    out = build()
    print(out)
