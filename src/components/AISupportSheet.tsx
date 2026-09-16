import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetOverlay, resetSheetPointers } from '@/components/ui/SheetOverlay';

import {
  applyServerAiQuota,
  consumeAiQuestion,
  getAiQuota,
  type AiQuota,
} from '@/services/aiQuota';
import { track, trackScreen } from '@/services/analytics';
import { askDriveiqAgent, discoveredEventToAppEvent } from '@/services/agent';
import { incrementUsageCounter } from '@/services/usageCounters';
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
import { addDaysYmd, londonDayBounds, londonYmd } from '@/utils/ukTime';
import { turnoutRange, venueProfileFor } from '@/data/venueProfiles';
import { ChatComposer } from '@/components/ai/ChatComposer';
import { EmptyHero, type PromptCard } from '@/components/ai/EmptyHero';
import { EventSectionBlock } from '@/components/ai/EventSectionBlock';
import {
  buildEventSummary,
  cardLimitForQuestion,
  dedupeEvents,
  demandScore as presentationDemandScore,
  eventDisplayEnd,
  eventDisplayStart,
  eventMatchesPlaceHints,
  eventMatchesQuestionName,
  groupEventsByDay,
  placeHintsFromQuestion,
  type EventDaySection,
} from '@/components/ai/eventPresentation';
import { SearchStatus } from '@/components/ai/SearchStatus';
import { showDialog } from '@/services/dialog';
import { reminderChatDialogMessage } from '@/services/eventReminders';
import { SuggestionChips } from '@/components/ai/SuggestionChips';
import { areaLabelFor, getForegroundLocationStatus, requestForegroundLocation } from '@/services/deviceLocation';
import { distanceKm, type LatLng } from '@/utils/distance';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Cached events so the assistant can answer "what's on tomorrow" etc. */
  events?: AppEvent[];
  incidents?: TrafficIncident[];
  lines?: LineStatus[];
  /** Driver GPS — used for "near me" / area answers. */
  userLocation?: LatLng | null;
  /** Persist a fresh GPS fix from the AI location button. */
  onLocationGranted?: (coord: LatLng) => void;
  /** Pin catalogue events the agent found that were missing from the open map. */
  onDiscoveredEvents?: (events: AppEvent[]) => void;
  /** Save + reminder. Return true only after it actually saved. */
  onSaveEvent?: (event: AppEvent) => boolean | Promise<boolean>;
  /** Add to device calendar. Return true only after it actually landed. */
  onAddToCalendar?: (event: AppEvent) => boolean | Promise<boolean>;
}

interface ChatAction {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => boolean | Promise<boolean>;
  doneLabel?: string;
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

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function londonDow(now: Date): number {
  const name = now
    .toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' })
    .toLowerCase();
  const i = WEEKDAYS.indexOf(name);
  return i >= 0 ? i : 0;
}

/** Map a free-text question to a date window + label, or null if none found. */
function resolveWindow(q: string, now: Date = new Date()): { label: string; range: DateRange } | null {
  if (q.includes('tomorrow')) {
    return { label: 'tomorrow', range: rangeFor('tomorrow', now) };
  }
  if (q.includes('tonight') || q.includes('today')) {
    return { label: q.includes('tonight') ? 'tonight' : 'today', range: rangeFor('today', now) };
  }
  if (q.includes('weekend')) {
    const ymd = londonYmd(now);
    const dow = londonDow(now);
    const satYmd = dow === 0 ? addDaysYmd(ymd, -1) : dow === 6 ? ymd : addDaysYmd(ymd, 6 - dow);
    const sunYmd = addDaysYmd(satYmd, 1);
    return {
      label: 'this weekend',
      range: { start: londonDayBounds(satYmd).start, end: londonDayBounds(sunYmd).end },
    };
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
      const delta = (i - londonDow(now) + 7) % 7;
      const ymd = addDaysYmd(londonYmd(now), delta);
      const bounds = londonDayBounds(ymd);
      return {
        label: `on ${WEEKDAYS[i][0].toUpperCase()}${WEEKDAYS[i].slice(1)}`,
        range: { start: bounds.start, end: bounds.end },
      };
    }
  }
  return null;
}

const EVENT_WORDS = ['event', 'events', 'happening', 'on tonight', 'on today',
  'on tomorrow', 'whats on', "what's on", 'what is on', 'show', 'shows', 'gig', 'gigs',
  'concert', 'concerts', 'match', 'matches', 'fixture', 'fixtures', 'anything on', 'look out for'];

const WAITLIST_WEEK_ANSWER =
  'Waitlist Premium is a free 7-day week — nothing to pay during those 7 days. You get full-day flight boards at all five airports, every station hub saved, the full calendar weeks ahead ranked by demand, and unlimited AI questions. Disruption alerts stay on every plan. After day 7 it ends unless you subscribe in the app. Open Menu → DriveIQ Premium anytime to see the full list.';

function looksLikeWaitlistWeekQuestion(q: string): boolean {
  const lower = q.toLowerCase();
  return (
    /\b(waitlist|free week|trial week|premium week)\b/.test(lower) ||
    (/\b(what|whats|what's)\b/.test(lower) &&
      /\b(premium|free|waitlist)\b/.test(lower) &&
      /\b(include|get|unlock|cover|last|long|week|days?)\b/.test(lower))
  );
}

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
  return presentationDemandScore(e);
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
  const lines = top.map((e) => {
    const start = eventDisplayStart(e);
    const end = eventDisplayEnd(e);
    const finish = end ? `, ends ${formatEventEndTime(start, end)}` : '';
    return `• ${e.title} · starts ${formatEventDate(start)}${finish} · ${e.venue}`;
  });
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
    return `• ${e.title} · ${typeOf(e)} · ${formatEventDate(eventDisplayStart(e))} · ${e.venue}${
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

const AGENT_EVENT_LIMIT = 80;

/**
 * Prefer stadium / featured events in the asked window, plus any named
 * club/venue (Brentford, Gtech, Wembley…) even if they are not in the top 24.
 */
function eventsForAgent(question: string, all: AppEvent[]): AppEvent[] {
  const q = question.toLowerCase();
  if (looksLikeEventRefusal(q)) return [];
  const named = all.filter((e) => eventMatchesQuestionName(e, q));
  if (!looksLikeEventQuestion(question) && named.length === 0) return [];

  const places = placeHintsFromQuestion(q);
  const placeFiltered =
    places.length || named.length
      ? all.filter(
          (e) =>
            eventMatchesPlaceHints(e, places) ||
            named.some((n) => n.id === e.id),
        )
      : all;

  const tonightAsk = /\b(today|tonight|now|going on)\b/.test(q);
  const namedAsk = places.length > 0 || named.length > 0;
  const win = resolveWindow(q);
  // Named clubs/venues: search the week on the map, not just tonight/tomorrow.
  const range =
    win?.range ??
    (namedAsk || looksLikeBigQuery(q)
      ? { start: rangeFor('today').start, end: rangeFor('day:6').end }
      : { start: rangeFor('today').start, end: rangeFor('tomorrow').end });

  const inWindow = placeFiltered.filter(
    (e) =>
      isInRange(e.startsAt, range) ||
      (e.realStartAt ? isInRange(e.realStartAt, range) : false),
  );
  // Named matches outside the default window still go through (up to 14 days).
  const namedExtra = namedAsk
    ? named.filter((e) => {
        const t = Date.parse(e.realStartAt || e.startsAt);
        if (!Number.isFinite(t)) return false;
        const horizon = Date.now() + 14 * 24 * 60 * 60 * 1000;
        return t <= horizon;
      })
    : [];
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
  if (tonightAsk && londonHour() >= 21 && places.length === 0 && named.length === 0) {
    const tomorrow = rangeFor('tomorrow');
    nextUp = placeFiltered
      .filter(
        (e) =>
          !windowIds.has(e.id) &&
          (isInRange(e.startsAt, tomorrow) ||
            (e.realStartAt ? isInRange(e.realStartAt, tomorrow) : false)),
      )
      .sort(byDemandThenTime)
      .slice(0, 8);
  }
  const seen = new Set<string>();
  const out: AppEvent[] = [];
  for (const e of dedupeEvents([...namedExtra, ...rankedWindow, ...nextUp])) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
    if (out.length >= AGENT_EVENT_LIMIT) break;
  }
  return out;
}

function looksLikeEmptyAgentReply(text: string): boolean {
  return /don.?t have|not in front of me|premium feature|premium view|as a free user|tonight.?s what i can|none in context/i.test(
    text,
  );
}

function looksLikeTravelQuestion(q: string): boolean {
  return /\b(train|trains|tube|rail|tfl|travel|traffic|road|roads|delay|delays|flight|flights|airport|heathrow|gatwick|stansted|luton|congestion|disruption)\b/i.test(
    q,
  );
}

function looksLikeEventRefusal(q: string): boolean {
  return /don'?t want.{0,40}events?|not (about )?events|no events|besides events|other than events|instead of events/i.test(
    q,
  );
}

function looksLikeEventQuestion(q: string): boolean {
  const lower = q.toLowerCase();
  if (looksLikeEventRefusal(lower)) return false;
  return (
    EVENT_WORDS.some((w) => lower.includes(w)) ||
    looksLikeBigQuery(lower) ||
    resolveWindow(lower) !== null ||
    placeHintsFromQuestion(lower).length > 0
  );
}

function looksLikeNearMeQuestion(q: string): boolean {
  return /\b(near me|nearby|around me|my area|close to me|where i am)\b/i.test(q);
}

function summaryForCards(answer: string, sections: EventDaySection[]): string {
  const cleaned = answer.trim();
  if (!sections.length) return cleaned;
  // Prefer the live agent answer. Only fall back to a catalogue blurb when the
  // model returned nothing useful.
  if (cleaned && !looksLikeEmptyAgentReply(cleaned) && cleaned.length >= 12) {
    return cleaned;
  }
  return buildEventSummary(sections);
}

/** Pick the few cards that belong under this reply — never the whole map. */
function cardsForReply(
  question: string,
  source: AppEvent[],
  answer: string,
): AppEvent[] {
  const places = placeHintsFromQuestion(question);
  const limit = cardLimitForQuestion(question);
  let pool = dedupeEvents(source.filter((e) => eventStatus(e) !== 'finished'));
  if (places.length) {
    const matched = pool.filter((e) => eventMatchesPlaceHints(e, places));
    pool = matched.length ? matched : pool;
  }
  const named = pool.filter((e) => mentionsEvent(answer, e));
  if (named.length > 0) {
    return named
      .sort(byDemandThenTime)
      .slice(0, limit);
  }
  if (looksLikeBigQuery(question.toLowerCase()) || places.length > 0) {
    return [...pool].sort(byDemandThenTime).slice(0, limit);
  }
  return [...pool].sort(byFreshThenDemand).slice(0, limit);
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

/** Chip row that tracks done-state per chip to prevent double-taps. */
function ActionChipRow({ actions, msgId }: { actions: ChatAction[]; msgId: string }) {
  const [done, setDone] = React.useState<Record<number, boolean>>({});
  const [busy, setBusy] = React.useState<number | null>(null);
  return (
    <View style={styles.actionsRow}>
      {actions.map((a, i) => {
        const isDone = !!done[i];
        const isBusy = busy === i;
        return (
          <Pressable
            key={`${msgId}-a-${i}`}
            style={[styles.actionChip, isDone && styles.actionChipDone]}
            onPress={() => {
              if (isDone || busy != null) return;
              setBusy(i);
              void Promise.resolve(a.onPress()).then((ok) => {
                if (ok) setDone((prev) => ({ ...prev, [i]: true }));
                setBusy(null);
              });
            }}
            accessibilityRole="button"
            accessibilityLabel={isDone ? (a.doneLabel ?? a.label) : a.label}
            accessibilityState={{ disabled: isDone || isBusy }}
          >
            <Ionicons
              name={isDone ? 'checkmark-circle' : a.icon}
              size={14}
              color={isDone ? colors.success : colors.textPrimary}
            />
            <Text style={[styles.actionChipText, isDone && styles.actionChipTextDone]}>
              {isDone ? (a.doneLabel ?? 'Done') : isBusy ? 'Working…' : a.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AISupportSheet({
  visible,
  onClose,
  events,
  incidents,
  lines,
  userLocation = null,
  onLocationGranted,
  onDiscoveredEvents,
  onSaveEvent,
  onAddToCalendar,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [composerReset, setComposerReset] = useState(0);
  const [locBusy, setLocBusy] = useState(false);
  const [areaLabel, setAreaLabel] = useState<string | null>(null);
  const isEmpty = messages.length === 0;
  // Free plan: FREE_DAILY_LIMIT questions/day; Premium unlimited. Reloaded each
  // open so the counter is always current.
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    trackScreen('ai_support_sheet');
    getAiQuota().then((q) => {
      setQuota((prev) => {
        if (
          prev &&
          !prev.pro &&
          !q.pro &&
          q.remaining > prev.remaining
        ) {
          return prev;
        }
        return q;
      });
    });
    void syncPremiumEntitlement();
  }, [visible]);

  useEffect(() => {
    if (!visible || !userLocation) {
      setAreaLabel(null);
      return;
    }
    let cancelled = false;
    void areaLabelFor(userLocation).then((label) => {
      if (!cancelled) setAreaLabel(label);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, userLocation?.latitude, userLocation?.longitude]);

  // SafeAreaView's top edge doesn't apply reliably inside a Modal, which left
  // the header (and the close button) jammed under the status bar. Read the
  // inset directly and pad the header so the X is always reachable.
  const insets = useSafeAreaInsets();

  const confirmRemind = async (event: AppEvent, source: 'chat' | 'card'): Promise<boolean> => {
    if (!onSaveEvent) return false;
    const ok = await onSaveEvent(event);
    if (ok) {
      track('ai_event_action_tapped', { action: 'remind', source });
      showDialog('Event saved', reminderChatDialogMessage(event));
    }
    return ok;
  };

  /** Build reminder / calendar chips for the events the answer offered. */
  const buildActions = (offer: AppEvent[]): ChatAction[] => {
    const actions: ChatAction[] = [];
    offer.forEach((e, i) => {
      if (onSaveEvent) {
        actions.push({
          label: i === 0 ? 'Remind me' : `Remind: ${shortTitle(e.title)}`,
          doneLabel: 'Saved',
          icon: 'notifications-outline',
          onPress: () => confirmRemind(e, 'chat'),
        });
      }
    });
    if (offer[0] && onAddToCalendar) {
      actions.push({
        label: 'Add to calendar',
        doneLabel: 'Added',
        icon: 'calendar-outline',
        onPress: async () => {
          const ok = await onAddToCalendar(offer[0]);
          if (ok) track('ai_event_action_tapped', { action: 'calendar', source: 'chat' });
          return ok;
        },
      });
    }
    return actions;
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

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
      const waitlistAnswer = looksLikeWaitlistWeekQuestion(trimmed)
        ? WAITLIST_WEEK_ANSWER
        : null;

      setSending(true);
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: thinkingId, role: 'bot', text: '', isLoading: true },
      ]);
      setComposerReset((n) => n + 1);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

      void (async () => {
        const replaceThinking = (msg: ChatMessage) => {
          setMessages((prev) => prev.filter((m) => m.id !== thinkingId).concat(msg));
        };
        try {
          if (waitlistAnswer) {
            replaceThinking({
              id: `b-${Date.now()}-waitlist`,
              role: 'bot',
              text: waitlistAnswer,
            });
            const pro = await hasProAccess();
            if (!pro) {
              const next = await consumeAiQuestion();
              setQuota(next);
            }
            return;
          }
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

          const wantEvents =
            looksLikeEventQuestion(trimmed) ||
            looksLikeNearMeQuestion(trimmed) ||
            (events ?? []).some((e) => eventMatchesQuestionName(e, trimmed));
          const travelOnly =
            looksLikeTravelQuestion(trimmed) &&
            !wantEvents &&
            !looksLikeNearMeQuestion(trimmed);
          const picked = travelOnly ? [] : eventsForAgent(trimmed, events ?? []);
          let source = picked;
          if (userLocation && (wantEvents || looksLikeNearMeQuestion(trimmed))) {
            const nearby = [...(events ?? [])]
              .filter((e) => eventStatus(e) !== 'finished')
              .map((e) => ({
                e,
                km: distanceKm(userLocation, {
                  latitude: e.latitude,
                  longitude: e.longitude,
                }),
              }))
              .filter((x) => x.km <= 12)
              .sort((a, b) => a.km - b.km)
              .slice(0, 20)
              .map((x) => x.e);
            const seen = new Set(source.map((e) => e.id));
            source = [...source, ...nearby.filter((e) => !seen.has(e.id))];
            if (source.length > AGENT_EVENT_LIMIT) {
              source = source.slice(0, AGENT_EVENT_LIMIT);
            }
          }
          const places = placeHintsFromQuestion(trimmed);
          const clientEvents = source.map((e) => {
            const km =
              userLocation && Number.isFinite(e.latitude) && Number.isFinite(e.longitude)
                ? distanceKm(userLocation, {
                    latitude: e.latitude,
                    longitude: e.longitude,
                  })
                : undefined;
            return {
              title: e.title,
              venue: e.venue,
              kind: typeOf(e),
              startsAt: londonStamp(eventDisplayStart(e)),
              endsAt: londonStamp(eventDisplayEnd(e)),
              doorsAt: e.doorsAt ? londonStamp(e.doorsAt) : undefined,
              turnout: turnoutLabel(e),
              featured: e.source === 'featured',
              copy: e.copyLine?.slice(0, 140),
              status: eventStatus(e),
              latitude: e.latitude,
              longitude: e.longitude,
              kmAway: km != null && Number.isFinite(km) ? Math.round(km * 10) / 10 : undefined,
            };
          });
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

          const res = await askDriveiqAgent(trimmed, history, {
            events: clientEvents,
            roads: clientRoads,
            rails: clientRails,
            premium: pro,
            clockLondon: londonStamp(new Date().toISOString()),
            location: userLocation
              ? {
                  latitude: userLocation.latitude,
                  longitude: userLocation.longitude,
                  label: areaLabel,
                }
              : undefined,
          });
          if (!res.capped) {
            void incrementUsageCounter('aiQuestions');
          }
          if (!pro && res.limit != null && res.remaining != null) {
            await applyServerAiQuota(res.limit, res.remaining);
            setQuota({
              pro: false,
              limit: res.limit,
              remaining: res.remaining,
              used: res.limit - res.remaining,
            });
          } else if (!pro && !res.capped) {
            const next = await consumeAiQuestion();
            setQuota(next);
          } else if (pro) {
            setQuota({ pro: true, used: 0, limit: Infinity, remaining: Infinity });
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
            const discovered = (res.discoveredEvents ?? [])
              .map(discoveredEventToAppEvent)
              .filter((e): e is AppEvent => e != null);
            if (discovered.length) {
              onDiscoveredEvents?.(discovered);
              const seenIds = new Set(source.map((e) => e.id));
              source = [...source, ...discovered.filter((e) => !seenIds.has(e.id))];
            }
            if (
              eventResult &&
              eventResult.offer.length > 0 &&
              looksLikeEmptyAgentReply(answer)
            ) {
              answer = eventResult.text;
            }
            // Only nudge missed big events for broad "what's on" scans — never
            // when the user named venues or asked for a short top-N list.
            const broadScan =
              wantEvents &&
              places.length === 0 &&
              !/\b\d{1,2}\b/.test(trimmed) &&
              !looksLikeBigQuery(trimmed.toLowerCase());
            if (broadScan) {
              const leaders = source
                .filter((e) => e.source === 'featured' || demandScore(e) >= 15000)
                .slice(0, 3);
              if (leaders.length > 0 && !leaders.some((e) => mentionsEvent(answer, e))) {
                const extra = leaders
                  .map((e) => {
                    const crowd = turnoutLabel(e);
                    return `${e.title} at ${e.venue}, ${formatEventDate(eventDisplayStart(e))}${
                      crowd ? `, around ${crowd}` : ''
                    }`;
                  })
                  .join('. ');
                answer = `Biggest on the map: ${extra}.\n\n${answer}`;
              }
            }

            const cardEvents = wantEvents ? cardsForReply(trimmed, source, answer) : [];
            const eventSections =
              cardEvents.length > 0
                ? groupEventsByDay(cardEvents, cardLimitForQuestion(trimmed))
                : undefined;

            replaceThinking({
              id: `b-${Date.now()}-live`,
              role: 'bot',
              text: summaryForCards(answer, eventSections ?? []),
              model: res.model,
              eventSections,
              actions: eventSections?.length
                ? undefined
                : (() => {
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
          if (eventResult && eventResult.offer.length > 0) {
            const localSections = groupEventsByDay(
              cardsForReply(
                trimmed,
                eventResult.offer.filter((e) => eventStatus(e) !== 'finished'),
                eventResult.text,
              ),
              cardLimitForQuestion(trimmed),
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
                  : 'I could not reach the live DriveIQ assistant just now. Check you are online and try again.',
            });
          }
        } finally {
          setSending(false);
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
        }
      })();
  };

  const handleRemind = (event: AppEvent) => confirmRemind(event, 'card');

  const handleCalendar = async (event: AppEvent): Promise<boolean> => {
    if (!onAddToCalendar) return false;
    const ok = await onAddToCalendar(event);
    if (ok) track('ai_event_action_tapped', { action: 'calendar', source: 'card' });
    return ok;
  };

  const quotaLabel =
    quota == null
      ? 'London events · roads · travel'
      : quota.pro
        ? 'Premium · unlimited questions'
        : `${quota.remaining} free question${quota.remaining === 1 ? '' : 's'} left today`;

  const pickPrompt = (prompt: string) => {
    track('ai_suggestion_tapped', { suggestion: prompt });
    setComposerReset((n) => n + 1);
    send(prompt);
  };

  const enableLocationFromChat = async () => {
    if (locBusy) return;
    setLocBusy(true);
    try {
      const prior = await getForegroundLocationStatus();
      const coord = await requestForegroundLocation();
      resetSheetPointers();
      track('location_permission_result', {
        granted: Boolean(coord),
        source: 'ai_chat',
      });
      if (coord) {
        onLocationGranted?.(coord);
        const label = await areaLabelFor(coord);
        setAreaLabel(label);
        showDialog(
          'Location on',
          label
            ? `Using your position near ${label}. Ask what’s on near you.`
            : 'Using your current position. Ask what’s on near you.',
        );
      } else if (prior === 'denied') {
        showDialog(
          'Location is off',
          'Turn on Location for DriveIQ in your phone Settings, then come back and tap Use my location.',
          [{ label: 'Open Settings', onPress: () => { void Linking.openSettings(); } }, { label: 'OK' }],
        );
      } else {
        showDialog(
          'Location not available',
          'Allow location while using DriveIQ to get events and delays around you.',
        );
      }
    } finally {
      setLocBusy(false);
    }
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
          <View style={styles.headerActions}>
            {!isEmpty ? (
              <Pressable
                onPress={() => {
                  setMessages([]);
                  setComposerReset((n) => n + 1);
                  setSending(false);
                  track('ai_chat_reset');
                }}
                hitSlop={10}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Start a new chat"
              >
                <Ionicons name="create-outline" size={20} color={colors.textSecondary} />
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
            keyboardDismissMode="interactive"
          >
            {isEmpty ? (
              <EmptyHero
                cards={PROMPT_CARDS}
                onSelect={pickPrompt}
                subtitle={
                  userLocation
                    ? `Ask about London events, roads, and travel. I’ll use what’s live on your map${
                        areaLabel ? ` near ${areaLabel}` : ''
                      }.`
                    : 'Ask about London events, roads, and travel. Turn on location for what’s on near you.'
                }
              />
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
                          <ActionChipRow actions={m.actions} msgId={m.id} />
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
          {!userLocation ? (
            <Pressable
              onPress={() => void enableLocationFromChat()}
              style={styles.locationBar}
              disabled={locBusy}
              accessibilityRole="button"
              accessibilityLabel="Use my location"
            >
              <Ionicons name="location-outline" size={16} color={colors.primary} />
              <Text style={styles.locationBarText}>
                {locBusy ? 'Asking for location…' : 'Use my location for nearby events'}
              </Text>
            </Pressable>
          ) : null}
          <ChatComposer
            onSend={(text) => send(text)}
            disabled={sending}
            resetToken={composerReset}
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
  },
  locationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  locationBarText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  actionChipDone: {
    opacity: 0.8,
    borderColor: colors.success,
  },
  actionChipTextDone: {
    color: colors.success,
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
