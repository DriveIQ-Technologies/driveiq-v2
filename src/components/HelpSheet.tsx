import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Optional: jump straight into AI support from the Help footer. */
  onOpenAISupport?: () => void;
}

interface QA {
  q: string;
  a: string;
}

const FAQS: QA[] = [
  {
    q: 'What is DriveIQ?',
    a: "DriveIQ shows what's on across London, including sport, music, theatre and more, on one live map alongside real-time road incidents and train, tube and tram status. You can plan around the city as it actually is right now.",
  },
  {
    q: 'What do the coloured pins mean?',
    a: 'Every event is a ringed pin. The ring colour is the category: blue = sports, purple = music, pink = theatre, amber = comedy, red = film, green = family, light blue = other. Sports pins carry the sport symbol (⚽ 🏏 🏉 🏇 🎾 🏀 🏈), and a gold ring with a star marks a featured event like Royal Ascot.',
  },
  {
    q: 'How do I filter what I see?',
    a: 'Use the date chips at the top (All, Today, Tomorrow, Next 3 Days) and the category chips below them. The map automatically re-frames to fit whatever is showing.',
  },
  {
    q: 'How do I save an event?',
    a: "Tap a pin to open the event, then tap Save. We'll remind you one hour before it starts. Tap Calendar to add it to your phone's calendar with the start and end time.",
  },
  {
    q: 'How do notifications work?',
    a: 'DriveIQ can alert you about major road incidents, train/tube line closures, and reminders for events you saved. Every category has its own switch, and you can subscribe to specific train lines, under Menu → Notifications.',
  },
  {
    q: 'How do I report something?',
    a: 'Tap the ➕ button on the right of the map, line the map up over the spot, choose what\'s happening (hazard, accident, roadworks, closure, police, event), add an optional note and submit. Reports show as coloured pins and clear themselves automatically after a while.',
  },
  {
    q: 'How do I get directions?',
    a: 'Open any event or incident and tap Get directions. Navigate inside DriveIQ, or hand off to Google Maps, Waze or Apple Maps.',
  },
  {
    q: "Why isn't a big event showing?",
    a: "Most events come from live data feeds, which don't cover everything. We hand-add major events that the feeds miss (they appear as gold featured pins). If something big is missing, send us feedback and we'll get it on the map.",
  },
  {
    q: 'Where does the live transport status come from?',
    a: 'Train, tube, Overground, Elizabeth line, DLR and tram status come from Transport for London, and airport rail-link status updates through the day. Tap the train and plane buttons on the right of the map.',
  },
];

export function HelpSheet({ visible, onClose, onOpenAISupport }: Props) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* Own provider: root insets don't reach a native Modal window. */}
      <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Help & FAQs</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {FAQS.map((item, i) => {
            const expanded = open === i;
            return (
              <Pressable
                key={item.q}
                style={styles.card}
                onPress={() => setOpen(expanded ? null : i)}
                accessibilityRole="button"
              >
                <View style={styles.qRow}>
                  <Text style={styles.q}>{item.q}</Text>
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.textSecondary}
                  />
                </View>
                {expanded ? <Text style={styles.a}>{item.a}</Text> : null}
              </Pressable>
            );
          })}

          {onOpenAISupport ? (
            <Pressable style={styles.aiCard} onPress={onOpenAISupport}>
              <View style={styles.aiIcon}>
                <Ionicons name="sparkles" size={18} color={colors.textOnPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.aiTitle}>Still stuck?</Text>
                <Text style={styles.aiBody}>
                  Ask DriveIQ AI Support. It can walk you through anything in
                  the app.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  body: { padding: 16, gap: 10 },
  card: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  qRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  q: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  a: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    marginTop: 10,
  },
  aiCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 6,
  },
  aiIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  aiBody: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
});
