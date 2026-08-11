import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  consumeAiQuestion,
  FREE_DAILY_LIMIT,
  getAiQuota,
  type AiQuota,
} from '@/services/aiQuota';
import { showProPaywall } from '@/services/subscription';
import { colors } from '@/theme/colors';
import type { AppEvent } from '@/types/event';
import {
  formatEventDate,
  formatEventEndTime,
  isInRange,
  type DateRange,
} from '@/utils/dateFilters';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Cached events so the assistant can answer "what's on tomorrow" etc. */
  events?: AppEvent[];
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
}

/**
 * DriveIQ AI Support.
 *
 * Conversational helper that guides users around the app. This is the on-device
 * scaffold: it answers the common "how do I…" questions from a local knowledge
 * base so the feature is useful today, with the chat UI ready to swap onto a
 * live model backend later (replace `localAnswer` with a network call).
 */

const SUGGESTIONS = [
  'What events are on tomorrow?',
  'Anything on this weekend?',
  'What do the coloured pins mean?',
  'How do notifications work?',
];

interface Knowledge {
  patterns: string[];
  answer: string;
}

const KB: Knowledge[] = [
  {
    patterns: ['colour', 'color', 'pin', 'dot', 'outline', 'ring', 'mean'],
    answer:
      'Each event pin is a ringed bubble. The ring colour is the category: blue = sports, purple = music, pink = theatre, amber = comedy, red = film, green = family. Sports pins show the sport symbol (⚽ 🏏 🏉 🏇…); everything else shows the DriveIQ mark. A gold ring with a ⭐ is a featured event (e.g. Royal Ascot).',
  },
  {
    patterns: ['save', 'bookmark', 'follow', 'remind', 'reminder'],
    answer:
      'Open any event and tap Save. We’ll remind you one hour before it starts so there’s time to plan your route. Tap Calendar on the same screen to add it to your phone’s calendar with the start and end time.',
  },
  {
    patterns: ['notification', 'alert', 'push', 'ping'],
    answer:
      'DriveIQ can alert you about major road incidents, train/tube line closures, and saved-event reminders. Turn categories on or off — and pick specific train lines — under Menu → Notifications. You’ll be asked for permission the first time.',
  },
  {
    patterns: ['report', 'hazard', 'accident', 'add'],
    answer:
      'Tap the ➕ button on the right of the map, line the map up over the spot, choose what’s happening (hazard, accident, roadworks, closure…), add an optional note, and submit. Your report shows as a coloured pin and clears itself after a while.',
  },
  {
    patterns: ['direction', 'route', 'navigate', 'drive', 'waze', 'maps'],
    answer:
      'Open an event and tap Get directions. You can navigate inside DriveIQ or hand off to Google Maps, Waze or Apple Maps.',
  },
  {
    patterns: ['filter', 'today', 'tomorrow', 'category', 'date'],
    answer:
      'Use the row of date chips (All / Today / Tomorrow / Next 3 Days) and the category chips below it to narrow what’s on the map. The map re-frames to fit what’s showing.',
  },
  {
    patterns: ['missing', 'not show', 'ascot', 'epsom', 'why', 'racing'],
    answer:
      'Most events come from live data feeds. A few big ones (like Royal Ascot) aren’t in those feeds, so we add them by hand — they appear with a gold featured pin. If something major is missing, send feedback and we’ll add it.',
  },
  {
    patterns: ['transit', 'train', 'tube', 'airport', 'connection'],
    answer:
      'The train icon on the right opens live tube/rail/tram status; the plane icon opens London airport rail-link status. Both update through the day.',
  },
];

function localAnswer(input: string): string {
  const q = input.toLowerCase();
  let best: { score: number; answer: string } | null = null;
  for (const k of KB) {
    const score = k.patterns.reduce((n, p) => (q.includes(p) ? n + 1 : n), 0);
    if (score > 0 && (!best || score > best.score)) best = { score, answer: k.answer };
  }
  if (best) return best.answer;
  return "I’m still learning! I can help with pins, saving events, notifications, reporting, directions, filters and live transit. Try one of the suggestions, or send feedback from the menu and the team will follow up.";
}

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
  const today = startOfDay(now);
  if (q.includes('tomorrow')) {
    const t = addDays(today, 1);
    return { label: 'tomorrow', range: { start: t, end: endOfDay(t) } };
  }
  if (q.includes('tonight') || q.includes('today')) {
    return { label: q.includes('tonight') ? 'tonight' : 'today', range: { start: today, end: endOfDay(today) } };
  }
  if (q.includes('weekend')) {
    // Upcoming Saturday + Sunday (or the current one if it's already the weekend).
    const dow = today.getDay();
    const satOffset = dow === 0 ? -1 : 6 - dow; // Sunday counts as part of this weekend
    const sat = addDays(today, Math.max(satOffset, dow === 6 ? 0 : satOffset));
    const start = dow === 0 ? addDays(today, -1) : sat;
    return { label: 'this weekend', range: { start: startOfDay(start), end: endOfDay(addDays(start, 1)) } };
  }
  if (q.includes('this week') || q.includes('week')) {
    const dow = today.getDay();
    const daysToSun = (7 - dow) % 7;
    return { label: 'this week', range: { start: today, end: endOfDay(addDays(today, daysToSun)) } };
  }
  if (q.includes('next 3') || q.includes('next three')) {
    return { label: 'the next 3 days', range: { start: today, end: endOfDay(addDays(today, 2)) } };
  }
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (q.includes(WEEKDAYS[i])) {
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

const typeOf = (e: AppEvent): string =>
  e.subCategory ?? (e.category === 'sports' ? 'Sports' : 'Event');

const shortTitle = (t: string): string => (t.length > 24 ? `${t.slice(0, 22)}…` : t);

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
  const looksLikeEventQ = EVENT_WORDS.some((w) => q.includes(w));
  if (!win && !looksLikeEventQ) return null;
  if (!win && looksLikeEventQ) {
    // Event-ish question with no date → default to the next 3 days.
    const today = startOfDay(new Date());
    return formatAnswer('over the next few days', { start: today, end: endOfDay(addDays(today, 2)) }, events);
  }
  if (win) return formatAnswer(win.label, win.range, events);
  return null;
}

function formatAnswer(
  label: string,
  range: DateRange,
  events: AppEvent[],
): { text: string; offer: AppEvent[] } {
  const matches = events
    .filter((e) => isInRange(e.startsAt, range))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  if (matches.length === 0) {
    return {
      text: `I can’t see anything ${label} in the current list yet. Try the All filter, or check again as the live feeds refresh through the day.`,
      offer: [],
    };
  }

  const shown = matches.slice(0, 6);
  const lines = shown.map(
    (e) => `• ${e.title} · ${typeOf(e)} · ${formatEventDate(e.startsAt)} · ${e.venue}`,
  );
  const more = matches.length > shown.length ? `\n…and ${matches.length - shown.length} more.` : '';
  const head = `Here ${matches.length === 1 ? 'is' : 'are'} ${matches.length} event${
    matches.length === 1 ? '' : 's'
  } ${label}:`;
  const tail = '\n\nWant a reminder or a calendar entry for any of these? Tap a button below.';
  return { text: `${head}\n${lines.join('\n')}${more}${tail}`, offer: shown.slice(0, 3) };
}

export function AISupportSheet({ visible, onClose, events, onSaveEvent, onAddToCalendar }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'bot',
      text: 'Hi! I’m DriveIQ AI Support. Ask me what events are on (try “what’s on tomorrow?”) and I can set reminders or add them to your calendar. I can also help with how anything in the app works.',
    },
  ]);
  const [input, setInput] = useState('');
  // Free plan: FREE_DAILY_LIMIT questions/day; Pro unlimited. Reloaded each
  // open so the counter is always current.
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    getAiQuota().then(setQuota);
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
          pushBot(`Added “${offer[0].title}” to your calendar.`);
        },
      });
    }
    return actions;
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: trimmed };

    // Daily quota gate — free plan only.
    if (quota && !quota.pro && quota.remaining <= 0) {
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: `b-${Date.now()}`,
          role: 'bot',
          text: `You've used all ${FREE_DAILY_LIMIT} free questions for today — they reset at midnight. DriveIQ Pro includes unlimited AI questions.`,
          actions: [
            {
              label: 'See DriveIQ Pro',
              icon: 'star-outline',
              onPress: () => showProPaywall('Unlimited AI questions'),
            },
          ],
        },
      ]);
      setInput('');
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
      return;
    }
    void consumeAiQuestion().then(setQuota);

    const eventResult =
      events && events.length > 0
        ? answerNamedTimeQuery(trimmed, events) ?? answerEventQuery(trimmed, events)
        : null;

    const botMsg: ChatMessage = eventResult
      ? {
          id: `b-${Date.now()}`,
          role: 'bot',
          text: eventResult.text,
          actions: eventResult.offer.length ? buildActions(eventResult.offer) : undefined,
        }
      : { id: `b-${Date.now()}`, role: 'bot', text: localAnswer(trimmed) };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setInput('');
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* Own provider: root insets don't reach a native Modal window. */}
      <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 6 }]}>
          <View style={styles.headerLeft}>
            <View style={styles.botBadge}>
              <Ionicons name="sparkles" size={16} color={colors.textOnPrimary} />
            </View>
            <View>
              <Text style={styles.headerTitle}>DriveIQ AI Support</Text>
              <Text style={styles.headerSub}>
                {quota == null
                  ? 'Here to help you get around'
                  : quota.pro
                    ? 'Pro · unlimited questions'
                    : `${quota.remaining} of ${FREE_DAILY_LIMIT} free questions left today`}
              </Text>
            </View>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
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
            contentContainerStyle={styles.threadContent}
          >
            {messages.map((m) => (
              <View key={m.id} style={styles.msgGroup}>
                <View
                  style={[
                    styles.bubble,
                    m.role === 'user' ? styles.userBubble : styles.botBubble,
                  ]}
                >
                  <Text
                    style={[
                      styles.bubbleText,
                      m.role === 'user' && styles.userBubbleText,
                    ]}
                  >
                    {m.text}
                  </Text>
                </View>
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
                        <Ionicons name={a.icon} size={14} color={colors.primary} />
                        <Text style={styles.actionChipText}>{a.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            ))}

            <View style={styles.suggestionWrap}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} style={styles.suggestion} onPress={() => send(s)}>
                  <Text style={styles.suggestionText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              placeholder="Ask DriveIQ…"
              placeholderTextColor={colors.textSecondary}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => send(input)}
              returnKeyType="send"
            />
            <Pressable
              onPress={() => send(input)}
              style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
              disabled={!input.trim()}
              accessibilityLabel="Send message"
            >
              <Ionicons name="arrow-up" size={20} color={colors.textOnPrimary} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  botBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  headerSub: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  thread: {
    flex: 1,
  },
  threadContent: {
    padding: 16,
    gap: 10,
  },
  msgGroup: {
    width: '100%',
  },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  actionChipText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '700',
  },
  botBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  userBubbleText: {
    color: colors.textOnPrimary,
  },
  suggestionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  suggestion: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  suggestionText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 16,
    fontSize: 14,
    color: colors.textPrimary,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
