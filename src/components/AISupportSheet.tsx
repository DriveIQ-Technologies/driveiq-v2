import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetOverlay } from '@/components/ui/SheetOverlay';

import {
  getAiQuota,
  type AiQuota,
} from '@/services/aiQuota';
import { track, trackScreen } from '@/services/analytics';
import { useAuth } from '@/providers/AuthProvider';
import { askDriveiqAgent } from '@/services/agent';
import { hasProAccess, showProPaywall, syncPremiumEntitlement } from '@/services/subscription';
import { colors } from '@/theme/colors';
import type { AppEvent } from '@/types/event';
import type { TrafficIncident } from '@/services/tflTraffic';
import type { LineStatus } from '@/services/tflLines';
import { incidentRoadLine } from '@/services/roadsCorridors';
import {
  formatEventDate,
  formatEventEndTime,
  isInRange,
  rangeFor,
  type DateRange,
} from '@/utils/dateFilters';
import { turnoutRange, venueProfileFor } from '@/data/venueProfiles';
import { ChatComposer } from '@/components/ai/ChatComposer';
import { EmptyHero, type PromptCard } from '@/components/ai/EmptyHero';
import { EventSectionBlock } from '@/components/ai/EventSectionBlock';
import {
  buildEventSummary,
  groupEventsByDay,
  type EventDaySection,
} from '@/components/ai/eventPresentation';
import { SearchStatus } from '@/components/ai/SearchStatus';
import { SuggestionChips } from '@/components/ai/SuggestionChips';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Cached events so the assistant can answer "what's on tomorrow" etc. */
  events?: AppEvent[];
  incidents?: TrafficIncident[];
  lines?: LineStatus[];
  /** Save + reminder for an event (no-op if not provided). */
  onSaveEvent?: (event: AppEvent) => void;
  /** Add an event to the device calendar (no-op if not provided). */
  onAddToCalendar?: (event: AppEvent) => void;
}

interface ChatAction {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  /** Optional tappable actions rendered under a bot bubble. */
  actions?: ChatAction[];
  model?: 'haiku' | 'sonnet' | null;
  eventSections?: EventDaySection[];
  isLoading?: boolean;
}

/**
 * DriveIQ AI Support.
 *
 * Live answers come from the `askDriveiqAgent` Cloud Function. Local event
 * matching is only used to attach reminder/calendar chips under a live reply.
 */

const SUGGESTIONS = [
  "What's on tonight?",
  'Biggest events this weekend',
  'What events are on tomorrow?',
  'Sports this week',
  'Any road delays near me?',
  'How do notifications work?',
];

const PROMPT_CARDS: PromptCard[] = [
  {
    id: 'tonight',
    label: "What's on tonight?",
    prompt: "What's on tonight?",
    icon: 'moon-outline',
    tint: colors.primary,
  },
  {
    id: 'weekend',
    label: 'Biggest this weekend',
    prompt: 'Biggest events this weekend',
    icon: 'flame-outline',
    tint: colors.accent,
  },
  {
    id: 'sports',
    label: 'Sports this week',
    prompt: 'Sports this week',
    icon: 'football-outline',
    tint: colors.sports,
  },
  {
    id: 'roads',
    label: 'Road & rail delays',
    prompt: 'Any road or tube delays affecting London right now?',
    icon: 'car-outline',
    tint: '#0D9488',
  },
];

// ── Event question handling ────────────────────────────────────────────────
// The assistant can answer natural date questions ("what's on tomorrow",
// "anything this weekend", "events on Saturday") from the cached events list.

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};
const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Map a free-text question to a date window + label, or null if none found. */
function resolveWindow(q: string, now: Date = new Date()): { label: string; range: DateRange } | null {
  if (q.includes('tomorrow')) {
    return { label: 'tomorrow', range: rangeFor('tomorrow', now) };
  }
  if (q.includes('tonight') || q.includes('today')) {
    return { label: q.includes('tonight') ? 'tonight' : 'today', range: rangeFor('today', now) };
  }
  if (q.includes('weekend')) {
    // Upcoming Saturday + Sunday (or the current one if it's already the weekend).
    const today = startOfDay(now);
    const dow = today.getDay();
    const satOffset = dow === 0 ? -1 : 6 - dow; // Sunday counts as part of this weekend
    const sat = addDays(today, Math.max(satOffset, dow === 6 ? 0 : satOffset));
    const start = dow === 0 ? addDays(today, -1) : sat;
    return { label: 'this weekend', range: { start: startOfDay(start), end: endOfDay(addDays(start, 1)) } };
  }
  if (q.includes('this week') || (/\bweek\b/.test(q) && !q.includes('weekend'))) {
    return {
      label: 'this week',
      range: {
        start: rangeFor('today', now).start,
        end: rangeFor('day:6', now).end,
      },
    };
  }
  if (q.includes('next 3') || q.includes('next three')) {
    return { label: 'the next 3 days', range: rangeFor('next3', now) };
  }
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (q.includes(WEEKDAYS[i])) {
      const today = startOfDay(now);
      let delta = (i - today.getDay() + 7) % 7;
      if (delta === 0) delta = 7; // "on Monday" means the next one, not today
      const d = addDays(today, delta);
      return { label: `on ${WEEKDAYS[i][0].toUpperCase()}${WEEKDAYS[i].slice(1)}`, range: { start: d, end: endOfDay(d) } };
    }
  }
  return null;
}

const EVENT_WORDS = ['event', 'events', 'happening', 'going on', 'on tonight', 'on today',
  'on tomorrow', 'whats on', "what's on", 'what is on', 'show', 'shows', 'gig', 'gigs',
  'concert', 'concerts', 'match', 'matches', 'fixture', 'fixtures', 'anything on', 'look out for'];

const BIG_WORDS = [
  'big',
  'biggest',
  'major',
  'huge',
  'busy',
  'busiest',
  'packed',
  'largest',
  'demand',
  'marquee',
  'key event',
  'stadium',
];

function looksLikeBigQuery(q: string): boolean {
  return BIG_WORDS.some((w) => q.includes(w));
}

function turnoutLabel(e: AppEvent): string | undefined {
  if (e.turnoutMin && e.turnoutMax) return `${e.turnoutMin}-${e.turnoutMax}`;
  const cap = venueProfileFor(e.venue)?.capacity;
  if (!cap) return undefined;
  const range = turnoutRange(cap, { low: 0.75, high: 1 });
  return `${range.min}-${range.max}`;
}

/** Featured pins and stadium-scale venues first. Small clubs last. */
function demandScore(e: AppEvent): number {
  const crowd = Math.max(
    e.turnoutMax ?? 0,
    e.turnoutMin ?? 0,
    venueProfileFor(e.venue)?.capacity ?? 0,
  );
  return (e.source === 'featured' ? 1_000_000 : 0) + crowd;
}

const typeOf = (e: AppEvent): string =>
  e.subCategory ?? (e.category === 'sports' ? 'Sports' : 'Event');

const shortTitle = (t: string): string => (t.length > 24 ? `${t.slice(0, 22)}…` : t);

/** Minimal rich-text renderer: supports **bold** spans from the agent. */
function renderRichText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <Text key={`b-${lastIndex}-${match.index}`} style={styles.boldInline}>
        {match[1]}
      </Text>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

// "What time does X start / finish", "when is X", "how long is X" — match a
// named event in the list and report its exact start + end times.
const TIME_INTENT = /\b(what time|when (does|is|are|s)|start time|starts?|finish(es)?|end(s| time)?|how long)\b/;
const TIME_STOPWORDS = new Set([
  'what', 'time', 'when', 'does', 'is', 'are', 'the', 'start', 'starts', 'starting',
  'finish', 'finishes', 'finishing', 'end', 'ends', 'ending', 'how', 'long', 'event',
  'events', 'today', 'tomorrow', 'tonight', 'this', 'that', 'there', 'at', 'on', 'in',
  'for', 'will', 'show', 'shows', 'me', 'of', 'a', 'an', 'and', 'do', 'happening', 'whats',
]);

function answerNamedTimeQuery(
  input: string,
  events: AppEvent[],
): { text: string; offer: AppEvent[] } | null {
  const q = input.toLowerCase();
  if (!TIME_INTENT.test(q)) return null;
  const words = q
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !TIME_STOPWORDS.has(w));
  if (words.length === 0) return null;

  const scored = events
    .map((e) => {
      const t = e.title.toLowerCase();
      const score = words.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0);
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Date(a.e.startsAt).getTime() - new Date(b.e.startsAt).getTime(),
    );
  if (scored.length === 0) return null;

  const top = scored.slice(0, 3).map((x) => x.e);
  const lines = top.map(
    (e) =>
      `• ${e.title} · starts ${formatEventDate(e.startsAt)}, ends ${formatEventEndTime(
        e.startsAt,
        e.endsAt,
      )} · ${e.venue}`,
  );
  const head = top.length === 1 ? 'Here are the times:' : 'Closest matches:';
  return {
    text: `${head}\n${lines.join('\n')}\n\nWant a reminder or a calendar entry? Tap a button below.`,
    offer: top,
  };
}

/** Build the assistant's answer to an event question. `offer` lists events the UI can attach actions to. */
function answerEventQuery(
  input: string,
  events: AppEvent[],
): { text: string; offer: AppEvent[] } | null {
  const q = input.toLowerCase();
  const win = resolveWindow(q);
  const big = looksLikeBigQuery(q);
  const looksLikeEventQ = EVENT_WORDS.some((w) => q.includes(w)) || big;
  if (!win && !looksLikeEventQ) return null;
  if (!win && looksLikeEventQ) {
    const range = big ? {
      start: rangeFor('today').start,
      end: rangeFor('day:6').end,
    } : rangeFor('next3');
    return formatAnswer(big ? 'the biggest this week' : 'over the next few days', range, events, true);
  }
  if (win) return formatAnswer(win.label, win.range, events, true);
  return null;
}

function formatAnswer(
  label: string,
  range: DateRange,
  events: AppEvent[],
  biggestFirst = false,
): { text: string; offer: AppEvent[] } {
  const matches = events.filter(
    (e) =>
      isInRange(e.startsAt, range) ||
      (e.realStartAt ? isInRange(e.realStartAt, range) : false),
  );
  const sorted = [...matches].sort((a, b) => {
    if (label === 'today' || label === 'tonight') return byFreshThenDemand(a, b);
    if (biggestFirst) {
      const d = demandScore(b) - demandScore(a);
      if (d !== 0) return d;
    }
    return Date.parse(a.startsAt) - Date.parse(b.startsAt);
  });

  if (sorted.length === 0) {
    return {
      text: `I can’t see anything ${label} in the current list yet. Try the All filter, or check again as the live feeds refresh through the day.`,
      offer: [],
    };
  }

  const shown = sorted.slice(0, biggestFirst ? 8 : 6);
  const lines = shown.map((e) => {
    const crowd = turnoutLabel(e);
    return `• ${e.title} · ${typeOf(e)} · ${formatEventDate(e.startsAt)} · ${e.venue}${
      crowd ? ` · ~${crowd}` : ''
    }`;
  });
  const more = sorted.length > shown.length ? `\n…and ${sorted.length - shown.length} more.` : '';
  const head = biggestFirst
    ? `Biggest on the map ${label}:`
    : `Here ${sorted.length === 1 ? 'is' : 'are'} ${sorted.length} event${
        sorted.length === 1 ? '' : 's'
      } ${label}:`;
  const tail = '\n\nWant a reminder or a calendar entry for any of these? Tap a button below.';
  const offerPool = sorted.filter((e) => eventStatus(e) !== 'finished');
  return {
    text: `${head}\n${lines.join('\n')}${more}${tail}`,
    offer: (offerPool.length ? offerPool : shown).slice(0, 3),
  };
}

function londonStamp(iso?: string): string {
  if (!iso) return 'n/a';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });
}

function eventStartMs(e: AppEvent): number {
  const t = Date.parse(e.realStartAt || e.startsAt);
  return Number.isFinite(t) ? t : 0;
}

function eventEndMs(e: AppEvent): number {
  const t = Date.parse(e.estimatedFinishAt || e.endsAt || e.realStartAt || e.startsAt);
  return Number.isFinite(t) ? t : eventStartMs(e);
}

function eventStatus(e: AppEvent, now = Date.now()): 'live' | 'upcoming' | 'finished' {
  const start = eventStartMs(e);
  const end = eventEndMs(e);
  if (end < now - 15 * 60 * 1000) return 'finished';
  if (start <= now) return 'live';
  return 'upcoming';
}

function londonHour(now: Date = new Date()): number {
  return Number.parseInt(
    now.toLocaleString('en-GB', {
      hour: '2-digit',
      hour12: false,
      timeZone: 'Europe/London',
    }),
    10,
  );
}

function byDemandThenTime(a: AppEvent, b: AppEvent): number {
  const d = demandScore(b) - demandScore(a);
  if (d !== 0) return d;
  return Date.parse(a.startsAt) - Date.parse(b.startsAt);
}

function byFreshThenDemand(a: AppEvent, b: AppEvent): number {
  const rank = { live: 0, upcoming: 1, finished: 2 };
  const d = rank[eventStatus(a)] - rank[eventStatus(b)];
  if (d !== 0) return d;
  return byDemandThenTime(a, b);
}

/** Prefer stadium / featured events in the asked window so the model sees the big nights. */
function eventsForAgent(question: string, all: AppEvent[]): AppEvent[] {
  const q = question.toLowerCase();
  const tonightAsk = /\b(today|tonight|now|going on)\b/.test(q);
  const win = resolveWindow(q);
  const range =
    win?.range ??
    (looksLikeBigQuery(q)
      ? { start: rangeFor('today').start, end: rangeFor('day:6').end }
      : rangeFor('next3'));
  const inWindow = all.filter(
    (e) =>
      isInRange(e.startsAt, range) ||
      (e.realStartAt ? isInRange(e.realStartAt, range) : false),
  );
  const useful = tonightAsk
    ? inWindow.filter(
        (e) =>
          eventStatus(e) !== 'finished' ||
          e.source === 'featured' ||
          demandScore(e) >= 15000,
      )
    : inWindow;
  const windowIds = new Set(useful.map((e) => e.id));
  const rankedWindow = [...useful].sort(tonightAsk ? byFreshThenDemand : byDemandThenTime);
  let nextUp: AppEvent[] = [];
  if (tonightAsk && londonHour() >= 21) {
    const tomorrow = rangeFor('tomorrow');
    nextUp = all
      .filter(
        (e) =>
          !windowIds.has(e.id) &&
          (isInRange(e.startsAt, tomorrow) ||
            (e.realStartAt ? isInRange(e.realStartAt, tomorrow) : false)),
      )
      .sort(byDemandThenTime)
      .slice(0, 8);
  }
  const rest = all.filter((e) => !windowIds.has(e.id)).sort(byDemandThenTime);
  const seen = new Set<string>();
  const out: AppEvent[] = [];
  for (const e of [...rankedWindow, ...nextUp, ...rest]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
    if (out.length >= 50) break;
  }
  return out;
}

function looksLikeEmptyAgentReply(text: string): boolean {
  return /don.?t have|not in front of me|premium feature|premium view|as a free user|tonight.?s what i can|none in context/i.test(
    text,
  );
}

function looksLikeEventQuestion(q: string): boolean {
  const lower = q.toLowerCase();
  return (
    EVENT_WORDS.some((w) => lower.includes(w)) ||
    looksLikeBigQuery(lower) ||
    resolveWindow(lower) !== null
  );
}

function summaryForCards(answer: string, sections: EventDaySection[]): string {
  if (!sections.length) return answer;
  const first = answer.split(/\n\n/)[0]?.trim() ?? '';
  if (first && first.length <= 220 && !first.startsWith('•')) return first;
  return buildEventSummary(sections);
}

function mentionsEvent(text: string, e: AppEvent): boolean {
  const t = text.toLowerCase();
  const title = e.title.toLowerCase();
  const venue = e.venue.toLowerCase();
  if (title.length >= 6 && t.includes(title.slice(0, 16))) return true;
  const words = title.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const venueHit = venue.length >= 5 && t.includes(venue.slice(0, 14));
  return venueHit && words.some((w) => t.includes(w));
}

export function AISupportSheet({
  visible,
  onClose,
  events,
  incidents,
  lines,
  onSaveEvent,
  onAddToCalendar,
}: Props) {
  const { requireAccount } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const isEmpty = messages.length === 0;
  // Free plan: FREE_DAILY_LIMIT questions/day; Premium unlimited. Reloaded each
  // open so the counter is always current.
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    trackScreen('ai_support_sheet');
    getAiQuota().then(setQuota);
    void syncPremiumEntitlement();
  }, [visible]);
  // SafeAreaView's top edge doesn't apply reliably inside a Modal, which left
  // the header (and the close button) jammed under the status bar. Read the
  // inset directly and pad the header so the X is always reachable.
  const insets = useSafeAreaInsets();

  const pushBot = (text: string) =>
    setMessages((prev) => [...prev, { id: `b-${Date.now()}-${Math.random()}`, role: 'bot', text }]);

  /** Build reminder / calendar chips for the events the answer offered. */
  const buildActions = (offer: AppEvent[]): ChatAction[] => {
    const actions: ChatAction[] = [];
    offer.forEach((e, i) => {
      if (onSaveEvent) {
        actions.push({
          label: i === 0 ? 'Remind me' : `Remind: ${shortTitle(e.title)}`,
          icon: 'notifications-outline',
          onPress: () => {
            onSaveEvent(e);
            track('ai_event_action_tapped', { action: 'remind', source: 'chat' });
            pushBot(`Reminder set for “${e.title}”. I’ll nudge you an hour before it starts.`);
          },
        });
      }
    });
    if (offer[0] && onAddToCalendar) {
      actions.push({
        label: 'Add to calendar',
        icon: 'calendar-outline',
        onPress: () => {
          onAddToCalendar(offer[0]);
          track('ai_event_action_tapped', { action: 'calendar', source: 'chat' });
          pushBot(`Added “${offer[0].title}” to your calendar.`);
        },
      });
    }
    return actions;
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    requireAccount('ai_question', () => {
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: trimmed };
      const thinkingId = `b-${Date.now()}-think`;
      track('ai_question_asked', {
        tier: quota?.pro ? 'premium' : 'free',
        remaining_before: quota?.remaining,
      });

      const eventResult =
        events && events.length > 0
          ? answerNamedTimeQuery(trimmed, events) ?? answerEventQuery(trimmed, events)
          : null;

      setSending(true);
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: thinkingId, role: 'bot', text: '', isLoading: true },
      ]);
      setInput('');
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

      void (async () => {
        const replaceThinking = (msg: ChatMessage) => {
          setMessages((prev) => prev.filter((m) => m.id !== thinkingId).concat(msg));
        };
        try {
          const history = messages
            .filter((m) => !m.id.endsWith('-think') && !m.isLoading)
            .slice(-8)
            .map((m) => ({
              role: m.role === 'bot' ? ('assistant' as const) : ('user' as const),
              text: m.text,
            }))
            .filter((m) => {
              const t = m.text.trim();
              if (!t) return false;
              // Earlier empty-context replies poison the next turn.
              if (m.role === 'assistant' && looksLikeEmptyAgentReply(t)) {
                return false;
              }
              return true;
            });

          const picked = eventsForAgent(trimmed, events ?? []);
          const source =
            picked.length > 0 ? picked : [...(events ?? [])].sort(byDemandThenTime).slice(0, 50);
          const cardEvents = source.filter((e) => eventStatus(e) !== 'finished').slice(0, 24);
          const eventSections =
            looksLikeEventQuestion(trimmed) && cardEvents.length > 0
              ? groupEventsByDay(cardEvents)
              : undefined;
          const clientEvents = source.map((e) => ({
            title: e.title,
            venue: e.venue,
            kind: typeOf(e),
            startsAt: londonStamp(e.realStartAt || e.startsAt),
            endsAt: londonStamp(e.estimatedFinishAt || e.endsAt),
            turnout: turnoutLabel(e),
            featured: e.source === 'featured',
            copy: e.copyLine?.slice(0, 140),
            status: eventStatus(e),
          }));
          const clientRoads = (incidents ?? []).length
            ? (incidents ?? []).slice(0, 20).map((inc) =>
                incidentRoadLine(inc, inc.location || inc.category || 'London'),
              )
            : ['No major road incidents in the current London snapshot.'];
          const disrupted = (lines ?? []).filter((l) => l.severityBucket !== 'good');
          const clientRails = disrupted.length
            ? disrupted
                .slice(0, 20)
                .map((l) =>
                  [l.name, l.statusDescription, l.reason].filter(Boolean).join(' · '),
                )
            : (lines ?? []).length
              ? [
                  'No current tube/rail disruptions in the snapshot.',
                  ...(lines ?? [])
                    .slice(0, 8)
                    .map((l) => `${l.name} · ${l.statusDescription}`),
                ]
              : [];

          const pro = await hasProAccess();
          console.log('[agent] live context', {
            question: trimmed,
            mapEventCount: events?.length ?? 0,
            pickedCount: picked.length,
            sendingCount: clientEvents.length,
            titles: clientEvents.slice(0, 8).map((e) => e.title),
            featuredCount: source.filter((e) => e.source === 'featured').length,
            premium: pro,
          });

          const res = await askDriveiqAgent(trimmed, history, {
            events: clientEvents,
            roads: clientRoads,
            rails: clientRails,
            premium: pro,
            clockLondon: londonStamp(new Date().toISOString()),
          });
          const serverLimit = res.limit;
          const serverRemaining = res.remaining;
          if (serverLimit != null) {
            setQuota((prev) =>
              prev
                ? {
                    ...prev,
                    limit: serverLimit,
                    remaining: serverRemaining ?? prev.remaining,
                    used: serverLimit - (serverRemaining ?? prev.remaining),
                  }
                : prev,
            );
          }

          if (res.capped) {
            track('ai_question_blocked_limit', { tier: 'free' });
            replaceThinking({
              id: `b-${Date.now()}-cap`,
              role: 'bot',
              text: res.answer,
              model: res.model,
              actions: [
                {
                  label: 'See DriveIQ Premium',
                  icon: 'star-outline',
                  onPress: () => showProPaywall('Unlimited AI questions'),
                },
              ],
            });
          } else {
            let answer = res.answer;
            const leaders = source.filter(
              (e) => e.source === 'featured' || demandScore(e) >= 15000,
            ).slice(0, 3);
            if (
              eventResult &&
              eventResult.offer.length > 0 &&
              looksLikeEmptyAgentReply(answer)
            ) {
              console.warn('[agent] overriding refusal with local events', {
                titles: eventResult.offer.map((e) => e.title),
                answerPreview: answer.slice(0, 160),
              });
              answer = eventResult.text;
            } else if (
              leaders.length > 0 &&
              !leaders.some((e) => mentionsEvent(answer, e))
            ) {
              const extra = leaders
                .map((e) => {
                  const crowd = turnoutLabel(e);
                  return `${e.title} at ${e.venue}, ${formatEventDate(e.realStartAt || e.startsAt)}${
                    crowd ? `, around ${crowd}` : ''
                  }`;
                })
                .join('. ');
              console.warn('[agent] prepending missed big events', {
                titles: leaders.map((e) => e.title),
              });
              answer = `Biggest on the map: ${extra}.\n\n${answer}`;
            }
            replaceThinking({
              id: `b-${Date.now()}-live`,
              role: 'bot',
              text: summaryForCards(answer, eventSections ?? []),
              model: res.model,
              eventSections,
              actions: eventSections?.length ? undefined : (() => {
                const named = source.filter(
                  (e) => mentionsEvent(answer, e) && eventStatus(e) !== 'finished',
                );
                const fallback = (eventResult?.offer ?? []).filter(
                  (e) => eventStatus(e) !== 'finished',
                );
                const offer = (named.length ? named : fallback).slice(0, 3);
                return offer.length ? buildActions(offer) : undefined;
              })(),
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('[agent] askDriveiqAgent failed', message, err);
          if (eventResult && eventResult.offer.length > 0) {
            const localSections = groupEventsByDay(
              eventResult.offer.filter((e) => eventStatus(e) !== 'finished'),
            );
            replaceThinking({
              id: `b-${Date.now()}-local`,
              role: 'bot',
              text: summaryForCards(eventResult.text, localSections),
              eventSections: localSections.length ? localSections : undefined,
              actions: localSections.length ? undefined : buildActions(eventResult.offer),
            });
          } else {
            replaceThinking({
              id: `b-${Date.now()}-fallback`,
              role: 'bot',
              text:
                message.toLowerCase().includes('unauth') || message.includes('Sign in required')
                  ? 'Your session expired for AI requests. Please sign out and sign back in, then ask again.'
                  : 'I could not reach the live DriveIQ assistant just now. Make sure you are signed in and online, then try again.',
            });
          }
        } finally {
          setSending(false);
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
        }
      })();
    });
  };

  const handleRemind = (event: AppEvent) => {
    if (!onSaveEvent) return;
    onSaveEvent(event);
    track('ai_event_action_tapped', { action: 'remind', source: 'card' });
    pushBot(`Reminder set for “${event.title}”. I’ll nudge you an hour before it starts.`);
  };

  const handleCalendar = (event: AppEvent) => {
    if (!onAddToCalendar) return;
    onAddToCalendar(event);
    track('ai_event_action_tapped', { action: 'calendar', source: 'card' });
    pushBot(`Added “${event.title}” to your calendar.`);
  };

  const quotaLabel =
    quota == null
      ? 'London events · roads · travel'
      : quota.pro
        ? 'Premium · unlimited questions'
        : `${quota.remaining} free question${quota.remaining === 1 ? '' : 's'} left today`;

  const pickPrompt = (prompt: string) => {
    track('ai_suggestion_tapped', { suggestion: prompt });
    send(prompt);
  };

  if (!visible) return null;

  return (
    <SheetOverlay onRequestClose={onClose} dim={false}>
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
          <View style={styles.headerLeft}>
            <View style={styles.logoMark}>
              <Ionicons name="sparkles" size={16} color={colors.textOnPrimary} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.appTitle}>AI Event Guide</Text>
              <Text style={styles.appSubtitle} numberOfLines={1}>
                {quotaLabel}
              </Text>
            </View>
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.thread}
            contentContainerStyle={[
              styles.threadContent,
              isEmpty && styles.threadContentEmpty,
            ]}
            keyboardShouldPersistTaps="handled"
          >
            {isEmpty ? (
              <EmptyHero cards={PROMPT_CARDS} onSelect={pickPrompt} />
            ) : (
              messages.map((m) => (
                <View
                  key={m.id}
                  style={[
                    styles.msgGroup,
                    m.role === 'user' ? styles.msgGroupUser : styles.msgGroupBot,
                  ]}
                >
                  {m.role === 'bot' ? (
                    <View style={styles.avatar}>
                      <Ionicons name="sparkles" size={12} color={colors.textOnPrimary} />
                    </View>
                  ) : null}
                  <View
                    style={[
                      styles.msgBody,
                      m.role === 'user' ? styles.msgBodyUser : styles.msgBodyBot,
                    ]}
                  >
                    {m.isLoading ? (
                      <SearchStatus />
                    ) : (
                      <>
                        {m.text ? (
                          <View
                            style={[
                              styles.bubble,
                              m.role === 'user' ? styles.userBubble : styles.botBubble,
                              m.eventSections?.length ? styles.summaryBubble : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.bubbleText,
                                m.role === 'user' && styles.userBubbleText,
                                m.eventSections?.length ? styles.summaryText : null,
                              ]}
                            >
                              {renderRichText(m.text)}
                            </Text>
                          </View>
                        ) : null}
                        {m.eventSections?.map((section) => (
                          <EventSectionBlock
                            key={`${m.id}-${section.key}`}
                            section={section}
                            onRemind={onSaveEvent ? handleRemind : undefined}
                            onCalendar={onAddToCalendar ? handleCalendar : undefined}
                          />
                        ))}
                        {m.actions && m.actions.length > 0 ? (
                          <View style={styles.actionsRow}>
                            {m.actions.map((a, i) => (
                              <Pressable
                                key={`${m.id}-a-${i}`}
                                style={styles.actionChip}
                                onPress={a.onPress}
                                accessibilityRole="button"
                                accessibilityLabel={a.label}
                              >
                                <Ionicons name={a.icon} size={14} color={colors.textPrimary} />
                                <Text style={styles.actionChipText}>{a.label}</Text>
                              </Pressable>
                            ))}
                          </View>
                        ) : null}
                      </>
                    )}
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          {!isEmpty ? (
            <SuggestionChips items={SUGGESTIONS.slice(0, 4)} onSelect={pickPrompt} />
          ) : null}
          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={() => send(input)}
            disabled={sending}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SheetOverlay>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  headerCopy: {
    flex: 1,
  },
  logoMark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.textPrimary,
  },
  appSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  thread: {
    flex: 1,
    backgroundColor: colors.background,
  },
  threadContent: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 18,
  },
  threadContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 24,
  },
  msgGroup: {
    flexDirection: 'row',
    width: '100%',
    gap: 8,
  },
  msgGroupUser: {
    justifyContent: 'flex-end',
  },
  msgGroupBot: {
    justifyContent: 'flex-start',
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  msgBody: {
    gap: 8,
  },
  msgBodyBot: {
    flex: 1,
    maxWidth: '88%',
  },
  msgBodyUser: {
    maxWidth: '82%',
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 18,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignSelf: 'flex-start',
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionChipText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  botBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderTopLeftRadius: 6,
  },
  summaryBubble: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
    maxWidth: '100%',
  },
  summaryText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderTopRightRadius: 6,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  boldInline: {
    fontWeight: '700',
  },
  userBubbleText: {
    color: colors.textOnPrimary,
  },
});
