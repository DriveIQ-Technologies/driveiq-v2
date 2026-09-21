ERIC

## 1. RELEVANT EXPERIENCE

The closest thing I've built is **DriveIQ** — a live iOS/Android product (currently v5.2.4) with an AI agent at its core. I built and shipped all of it myself: client, backend, AI layer, billing, auth, release pipeline. ~35k lines of TypeScript across the app and the serverless backend.

It is a different surface from Eric (React Native + Firebase rather than React + Supabase), but the problems are the same ones your ad lists, and I've hit them in production:

**Production AI agent with grounding and cost control.** The agent answers live questions from users using Claude. Two things it does that matter for Eric:
- *Model routing.* Cheap model by default, reasoning model only when the question earns it. I found the original router was matching `"plan"` as a substring — so "when does my **plane** land" routed every single ask to the expensive model. Fixed with word-boundary matching. That's the kind of bug AI-generated code produces constantly and only a human review catches.
- *Anti-hallucination by retrieval, not by prompt.* The model is never allowed to invent a real-world fixture from training memory. When a user names something not in the current data slice, the backend searches the verified catalogue and returns those rows. Grounding is enforced in the tool layer, not asked for in the system prompt.
- The prompt and model IDs are versioned and loaded from the database at runtime, so I can change agent behaviour without a deploy.
- Per-user daily spend caps enforced inside a database transaction, so concurrent requests can't race past the limit.

**Rescuing a silent production failure.** Push notifications had never been delivered — not once. The backend was sending APNs device tokens to FCM, FCM rejected every one, and the failure was caught and written to a log line nobody read. Everything looked healthy. I traced it, established the token types were fundamentally incompatible with the SDK the app uses, and moved delivery to Expo Push: request chunking, per-ticket error handling, and automatic pruning of dead tokens so we stop paying to retry them forever. Then wrote tests for it. This is the failure mode I watch for hardest — not the error you can see, the one you can't.

**Idempotency and entitlements.** Waitlist access tokens are single-use, transactionally bound to the first account that redeems them, with expiry windows and a typed status for every outcome (`already_used`, `already_claimed`, `expired`, `already_subscribed`...). Redeeming twice is safe. Redeeming someone else's token is not possible. Paid entitlements via RevenueCat sit on top of the same model.

**The rest of the surface:** Google and Apple OAuth sign-in, third-party ingest pipelines with normalisation and dedupe, GDPR account deletion (full erasure path, not a soft flag), PostHog analytics, ~20 test files covering the logic that would actually hurt if it broke, and a real App Store / Play release cadence.

[LOOM: https://... — record before sending]

## 2. AI DEVELOPMENT

I use Claude Code daily as my main development surface, and the way I use it is the reason I'd be useful to you rather than a risk.

**How I drive it.** I give agents a narrow, well-specified task with the surrounding constraints stated up front — the existing patterns to match, what must not change, what "done" looks like. Vague prompts produce plausible code that quietly breaks an invariant three files away. I also have it read before it writes: understand the existing approach first, then propose, then implement.

**How I review it.** I treat every diff as if it came from a fast, confident junior who has never seen production. The `"plan"` / `"plane"` bug above is a perfect example — code that reads fine, passes tests, and costs money on every request. Other things I check without fail: does this respect tenant boundaries; does it retry safely; does it swallow an error into a log line; does it widen a permission; does it put user data somewhere it shouldn't be.

**Where it genuinely makes me faster:** entering unfamiliar code and mapping it quickly, writing the test suite around a fix, mechanical refactors across many files, debugging raw API behaviour, and writing the boring, careful code (chunking, retries, error branches) that I'd otherwise be tempted to skip.

**Where I don't let it lead:** architecture decisions, security boundaries, anything touching auth, permissions or data isolation, and any decision about whether to keep, harden, refactor or replace. Agents optimise for producing something that looks finished. That judgment stays mine.

For Eric specifically, prompt injection and tool injection are the thing I'd want eyes on early: once an agent reads customer data from a connected CRM or website and then chooses a tool, the data it read is untrusted input that can carry instructions. That boundary needs to be enforced in the tool layer and the permission model — never in the prompt.

## 3. AVAILABILITY

I can start immediately — [DATE].

Over the next two weeks I can commit [X] hours per week, and [X] per week sustained after that, comfortably inside your 15–30 range.

[Timezone / overlap hours — e.g. "I'm UTC+3, with reliable overlap with UK working hours."]

---

**One thing I'd rather say up front than let you discover:** my deepest recent production work is Firebase/Firestore rather than Supabase/Postgres. The TypeScript, serverless functions, OAuth, webhooks, idempotency, agent architecture and security thinking all transfer directly. Postgres and RLS I know [ADJUST TO TRUTH: "and have used on X" / "well enough to be productive in days, not weeks"] — I'd expect to be shipping in your codebase in the first few days, and I'd rather tell you that now than oversell it and waste your time.
