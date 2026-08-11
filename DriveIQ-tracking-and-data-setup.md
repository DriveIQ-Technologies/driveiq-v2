# DriveIQ — Analytics, User Data & Tracking Setup Guide

For the company to own and operate DriveIQ's user data, analytics and API accounts. Written to be actionable by a non-developer with admin access; steps marked **[dev]** need the development side.

---

## 1. What the app collects today (current state)

| Data | Where it lives | Notes |
|---|---|---|
| Account (email + password) | Firebase Authentication, project `driveiq-app` | Only if the user signs up; the app works without an account |
| Location | On the device only | Used to centre the map, show distance and routing. Never uploaded to a server. "While Using the App" permission only — no background tracking |
| Saved events, reports, preferences | On the device only (local storage) | Not synced to any server |
| Feedback | Email to feedback@driveiq.app | Via the user's own mail app |

There is **no analytics SDK installed yet** — no usage tracking, no crash reporting. Section 3 covers adding it.

## 2. Take ownership of the accounts (no dev needed)

1. **Firebase / Google Cloud** — the core. Go to [console.firebase.google.com](https://console.firebase.google.com) → project `driveiq-app` → Project settings → Users and permissions → add the company Google account as **Owner**. Once confirmed, demote/remove personal accounts.
2. **Apple Developer account** — App Store distribution, push certificates. If currently on a personal account, plan a transfer to a company Apple Developer account (needs a D-U-N-S number).
3. **Google Play Console** — same for Android when it ships.
4. **API keys** — the app uses these services; each account should be registered to a company email:
   - TfL Unified API (`EXPO_PUBLIC_TFL_APP_KEY`) — free
   - Google Maps / Directions (`EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY`) — billing account should be the company card
   - Ticketmaster Discovery (`EXPO_PUBLIC_TICKETMASTER_API_KEY`) — free tier
   - football-data.org (`EXPO_PUBLIC_FOOTBALLDATA_API_KEY`) — free tier
   - TheSportsDB (`EXPO_PUBLIC_SPORTSDB_API_KEY`)
   - AeroDataBox flights (`EXPO_PUBLIC_AERODATABOX_API_KEY`) — paid tiers exist; this powers the paywalled flights board, so expect to upgrade as users grow

## 3. Analytics & crash reporting (recommended stack) **[dev]**

Recommended: **Firebase Analytics + Crashlytics** — free, integrates with the Firebase project already in place.

- What you'll get: daily/monthly active users, retention, screen views, custom events (event pin taps, saves, directions started, flights-board opens, subscribe-button taps — the paywall funnel), crash reports by device/OS.
- Setup (roughly a day): register iOS/Android apps in the Firebase console → download `GoogleService-Info.plist` / `google-services.json` → add `@react-native-firebase/app`, `/analytics`, `/crashlytics` with the Expo config plugin → new build.
- Decide the key funnel events up front. Suggested: `event_pin_tap`, `event_saved`, `directions_started`, `airport_pin_tap`, `flights_board_open`, `subscribe_tap`.

## 4. App Store privacy compliance (needed before/at launch)

1. **Privacy policy URL** — required by Apple, Google, and UK GDPR. Must state: what's collected (email if signing up; location processed on-device; analytics events once §3 ships), why, retention, and a contact. Host it on the company site.
2. **Apple App Privacy questionnaire** (App Store Connect) — with the current app + Firebase Analytics, declare: Contact Info (email, linked to user), Location (not linked, app functionality), Identifiers/Usage Data (analytics). Location is not used for tracking across apps.
3. **App Tracking Transparency (the "Ask App Not to Track" popup)** — **not needed**: nothing here tracks users across other companies' apps. Don't add it; it only suppresses conversion.
4. **Location permission popup** — already implemented ("Allow While Using App"). No "Allow all the time" background permission needed; the app never tracks in the background. Note for the team: the stale-location-on-reopen issue was an app bug (fixed 7 July 2026), not a permission issue.
5. **UK GDPR basics** — lawful basis: contract (accounts), legitimate interest (analytics — or consent if you later add ads/marketing). Register with the ICO (small fee), add a data-deletion path (Firebase console can delete a user; a "delete my account" button in-app is required by Apple if you have sign-up — worth scheduling **[dev]**).

## 5. Checklist (in order)

- [ ] Company Google account made Owner of Firebase project `driveiq-app`
- [ ] All six API keys re-registered / billing moved to company accounts
- [ ] Privacy policy drafted and hosted
- [ ] Firebase Analytics + Crashlytics integrated **[dev]** and funnel events agreed
- [ ] App Privacy questionnaire filled in App Store Connect
- [ ] ICO registration
- [ ] In-app account deletion scheduled **[dev]**
