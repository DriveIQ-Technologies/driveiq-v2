# DriveIQ — Subscription ("DriveIQ Pro") Setup Guide

Decision summary: **RevenueCat** on top of Apple/Google native in-app subscriptions. It's the industry standard for React Native/Expo apps — one SDK wraps StoreKit (iOS) and Google Play Billing (Android), handles free trials, receipt validation, and gives a dashboard for revenue/churn without building a server. Free until $2.5k/month revenue.

**What's gated behind Pro** (agreed): the AI event agent + the airport live arrivals/departures board. Both get a free trial so users experience them first. Everything else stays free.

---

## 1. What you (client) can set up right now — no dev needed

### A. RevenueCat account (~15 min)
1. Sign up at [app.revenuecat.com](https://app.revenuecat.com) with a company email.
2. Create project "DriveIQ" → add an **iOS app** (bundle id: `com.driveiq.app` — confirm with Donnie) and an **Android app** later.
3. Create an **Entitlement** named exactly `pro` — this is the switch the app checks.
4. Note the **Public API keys** (one per platform) and send them to Donnie.

### B. App Store Connect — the actual products (~30 min)
1. App Store Connect → DriveIQ app → Monetization → Subscriptions.
2. Create a Subscription Group "DriveIQ Pro" with two products:
   - `driveiq_pro_monthly` — suggest £4.99/month
   - `driveiq_pro_annual` — suggest £39.99/year (best value ~33% off)
3. On each product add an **Introductory Offer → Free trial** — suggest 7 days (Apple handles the trial mechanics; card required, auto-converts, user can cancel).
4. Fill in the localisation (display name, description) — required before review.
5. Paid Apps agreement + banking/tax forms must be complete in App Store Connect (Agreements section) or products won't go live.
6. Back in RevenueCat: attach these two product ids to the `pro` entitlement, and create an **Offering** called `default` containing both packages (monthly + annual).

### C. Google Play — when the Android build ships
Same structure: two subscription products with a 7-day free trial, linked in RevenueCat. Needs the app uploaded to a Play track first, so this waits for the Android release.

### D. Sandbox testing (how "creating new users to test" works)
- iOS: App Store Connect → Users and Access → **Sandbox Testers** → create 2–3 test Apple accounts. On a device signed into a sandbox account, purchases are fake (no charge) and trials/renewals run on an accelerated clock (a "month" ≈ 5 minutes), so you can watch the full trial → paid → cancel lifecycle in one sitting.
- RevenueCat's dashboard shows these sandbox purchases live — you'll see the test users appear as customers.

## 2. What the dev side does once you send the keys **[dev, ~2–3 days]**

1. Add `react-native-purchases` (RevenueCat SDK) with the Expo config plugin; new build.
2. Paywall screen in the DriveIQ design language: both plans, trial badge, restore-purchases button (Apple requires it), links to Terms/Privacy (Apple requires both).
3. Gate the two features on the `pro` entitlement: AI agent chat and the flights board (the "DriveIQ Pro — Subscribe" placeholder button already in the airport sheet becomes the real paywall trigger).
4. Wire analytics funnel events (`paywall_shown`, `trial_started`, `subscribe_tap`, `purchase_done`) so conversion is measurable from day one.

## 3. Data tracking / storing / managing — do this in the same sitting

Covered in detail in `DriveIQ-tracking-and-data-setup.md`, but the short answer to "which is best to use": **stay on Firebase** (already integrated for accounts). Concretely:
- **Firebase Analytics + Crashlytics** for usage + crash data **[dev to integrate]** — your part now: nothing, it uses the existing project.
- **Cloud Firestore** (same Firebase project) when we want saved events/preferences synced across devices and tied to accounts — your part now: none; it's a dev task once accounts matter more.
- Your part today from that doc: make the company Google account **Owner** of Firebase project `driveiq-app`, and start the privacy policy.

## 4. Still to plan (design workstream — not blocking the above)
- Onboarding & app tour: the app already has a first-launch tour component; it needs extending to a proper walkthrough (map → filters → pin → save → airports → AI) shown after first sign-up/login, replayable from Help.
- Paywall placement strategy: gate on feature tap (recommended — user sees the value moment) vs. upfront on onboarding. Recommend feature-tap plus one soft mention on the tour's last card.
- Which future features join Pro (e.g. flight delay notifications) — decide before the paywall copy is finalised.

## 5. Order of operations

1. ✅ You: RevenueCat account + App Store Connect products + sandbox testers (today)
2. ✅ You: Firebase ownership + privacy policy started (today)
3. → Send Donnie: RevenueCat public API keys + confirmation products exist
4. → Dev: SDK + paywall + gating build (2–3 days)
5. → Together: sandbox test the full trial lifecycle with test users
6. → Dev: analytics integration so launch metrics exist from day one
