# DriveIQ Admin

Team dashboard for DriveIQ: users, waitlist claims, system health and AI usage,
read straight from the app's Firebase project (`driveiq-app`).

Next.js 16 (App Router) · TypeScript · Tailwind · Firebase Admin SDK.

## Pages

| Page | What it shows |
|---|---|
| Overview | Accounts, notifications on, waitlist claimed, AI cost; sign-ups per day; feed alerts |
| Users | Newest 50 accounts, or search by exact email / user ID |
| User detail | Sign-in, waitlist week, AI use, notification settings, watched flights and their live state |
| Waitlist | Every invite code: claimed, running, used, expiring, expired |
| System health | When each feed last updated (airports, rail, roads, events) and whether it's late |
| AI usage | Assistant questions and estimated cost per day; heaviest users |

## Security

- Sign-in with Google or email/password via Firebase Auth, then a 5-day
  `__session` cookie (httpOnly, secure) created server-side.
- Only emails in `ADMIN_EMAILS` get a session; every page and data read checks
  the session again server-side (`src/lib/session.ts`, `src/lib/data.ts`).
- All Firestore access is server-side through the Admin SDK. Nothing in the
  browser can read the database.

## Run locally

```bash
cd admin
npm install
DEMO_DATA=1 npm run dev        # sample data, no login, no production access
```

Against the real project you need Google credentials with read access to
Firestore and Firebase Auth admin, plus the admin list:

```bash
gcloud auth application-default login
ADMIN_EMAILS="you@example.com" npm run dev
```

Then open http://localhost:3000 and sign in with an admin account.

## Deploy (Vercel)

### 1. A read-only service account for the dashboard

Someone with Owner on `driveiq-app` runs this once (Google Cloud Shell works):

```bash
gcloud iam service-accounts create admin-dashboard --project driveiq-app --display-name "DriveIQ admin dashboard"
gcloud projects add-iam-policy-binding driveiq-app --member serviceAccount:admin-dashboard@driveiq-app.iam.gserviceaccount.com --role roles/datastore.viewer
gcloud projects add-iam-policy-binding driveiq-app --member serviceAccount:admin-dashboard@driveiq-app.iam.gserviceaccount.com --role roles/firebaseauth.admin
gcloud iam service-accounts keys create admin-dashboard-key.json --iam-account admin-dashboard@driveiq-app.iam.gserviceaccount.com
```

`datastore.viewer` is read-only Firestore; `firebaseauth.admin` is needed to
create and check sign-in sessions. Never commit the key file; delete it once
it is in Vercel.

### 2. The Vercel project

- vercel.com → Add New → Project → import this GitHub repo.
- **Root Directory: `admin`** (framework is detected as Next.js).
- Environment variables (Production, and Preview if you use previews):
  - `FIREBASE_SERVICE_ACCOUNT` → paste the whole contents of `admin-dashboard-key.json`
  - `ADMIN_EMAILS` → `you@example.com,colleague@example.com`
- Deploy. Functions run in London (`lhr1`, set in `vercel.json`), next to Firestore.

Or from this folder with the CLI: `npx vercel link`, add the two variables with
`npx vercel env add`, then `npx vercel --prod`.

### 3. Allow Google sign-in on the new domain

Firebase console → Authentication → Settings → **Authorized domains** → add
`your-project.vercel.app` (and any custom domain). Preview URLs change per
deploy, so Google sign-in only works on domains listed here; email/password
works everywhere.

## Tests

```bash
npm test          # dashboard rules: costs, feed health, waitlist status
npm run typecheck
```
