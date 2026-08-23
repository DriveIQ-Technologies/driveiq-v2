import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme/colors';
import { track, trackScreen } from '@/services/analytics';
import {
  DEFAULT_PREFS,
  effectivePrefs,
  ensurePermission,
  loadLineSubscriptions,
  loadPrefs,
  saveLineSubscriptions,
  savePrefs,
  type LineSubscriptions,
  type NotificationChannel,
  type NotificationPrefs,
} from '@/services/notifications';
import { fetchLineStatuses, type LineStatus } from '@/services/tflLines';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface Row {
  key: NotificationChannel;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
}

const ROWS: Row[] = [
  {
    key: 'road-accidents',
    icon: 'car-sport',
    title: 'Road closures and heavy traffic',
    body:
      'Pings when a major road closes, has a serious incident, or has heavy disruption on key corridors.',
  },
  {
    key: 'line-closures',
    icon: 'train',
    title: 'Train & tube disruptions',
    body:
      'Pings when a tube, Overground, Elizabeth line, DLR, tram or National Rail operator moves into Severe or Closed status.',
  },
  {
    key: 'saved-events',
    icon: 'calendar',
    title: 'Saved events',
    body:
      'A heads-up one hour before each event you have saved or followed, so you have time to plan a route.',
  },
  {
    key: 'saved-flights',
    icon: 'airplane',
    title: 'Watched flights',
    body:
      'Pings when a flight you have saved is delayed or cancelled, so you can adjust your airport run.',
  },
];

export function NotificationSettingsPanel({ visible, onClose }: Props) {
  const { hasAccount, requireAccount } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [lines, setLines] = useState<LineStatus[]>([]);
  const [lineSubs, setLineSubs] = useState<LineSubscriptions>({});
  const [linesLoading, setLinesLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    trackScreen('notification_settings', { has_account: hasAccount });
    loadPrefs().then(setPrefs);
    loadLineSubscriptions().then(setLineSubs);
    // Don't ask for the OS permission until there's an account to attach the
    // alerts to — otherwise we burn the one-shot iOS prompt on a session that
    // can't receive anything yet.
    if (hasAccount) ensurePermission();

    // Fetch the live line list so the per-line toggle column always reflects
    // every currently-active TfL line (new operators show up automatically).
    setLinesLoading(true);
    fetchLineStatuses()
      .then(setLines)
      .finally(() => setLinesLoading(false));
  }, [visible, hasAccount]);

  if (!visible) return null;

  // Signed out / anonymous: every switch reads off no matter what storage says.
  const shownPrefs = effectivePrefs(prefs, hasAccount);

  /** Runs after signup: switch the channel on for real and ask for permission. */
  const enableChannelAfterSignup = async (key: NotificationChannel) => {
    const current = await loadPrefs();
    const next = { ...current, [key]: true };
    await savePrefs(next);
    setPrefs(next);
    await ensurePermission();
    track('notification_channel_toggled', {
      channel: key,
      enabled: true,
      after_signup: true,
    });
  };

  /** Runs after signup from the banner: turn the standard set on. */
  const enableDefaultsAfterSignup = async () => {
    const next = { ...DEFAULT_PREFS };
    await savePrefs(next);
    setPrefs(next);
    await ensurePermission();
    track('notification_defaults_enabled', { after_signup: true });
  };

  const promptForAccount = (key?: NotificationChannel) => {
    requireAccount('notify', () => {
      void (key ? enableChannelAfterSignup(key) : enableDefaultsAfterSignup());
    });
  };

  const toggle = (key: NotificationChannel) => {
    if (!hasAccount) {
      promptForAccount(key);
      return;
    }
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    savePrefs(next);
    track('notification_channel_toggled', { channel: key, enabled: next[key] });
  };

  const toggleLine = (lineId: string) => {
    if (!hasAccount) {
      promptForAccount('line-closures');
      return;
    }
    const next: LineSubscriptions = { ...lineSubs };
    next[lineId] = !next[lineId];
    // Drop the key entirely when toggled off so the "empty = all lines"
    // default keeps working once the user clears every line.
    if (!next[lineId]) delete next[lineId];
    setLineSubs(next);
    saveLineSubscriptions(next);
    track('notification_line_toggled', { line_id: lineId, enabled: Boolean(next[lineId]) });
  };

  // True if the user has opted into at least one specific line — drives
  // the "Following all lines by default" hint state.
  const anyLineExplicit = Object.values(lineSubs).some(Boolean);

  return (
    <SheetOverlay onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Ionicons name="notifications" size={22} color={colors.textOnPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Notifications</Text>
            <Text style={styles.subtitle}>
              {hasAccount
                ? 'Choose what DriveIQ should ping you about'
                : 'Create a free account to switch these on'}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 28 }}>
          {!hasAccount ? (
            <View style={styles.gateCard}>
              <View style={styles.gateIcon}>
                <Ionicons name="lock-closed" size={18} color={colors.primaryDark} />
              </View>
              <Text style={styles.gateTitle}>Notifications need an account</Text>
              <Text style={styles.gateBody}>
                Alerts are turned off because there is nowhere to send them yet.
                Create a free account and DriveIQ can ping you about road
                closures, tube and rail disruption, events you save, and flights
                you watch. Tap any switch below to get started.
              </Text>
              <Pressable
                onPress={() => promptForAccount()}
                style={styles.gateBtn}
                accessibilityRole="button"
                accessibilityLabel="Create a free account to turn on notifications"
              >
                <Text style={styles.gateBtnText}>Create free account</Text>
              </Pressable>
            </View>
          ) : null}

          {ROWS.map((row) => (
            <View key={row.key} style={styles.row}>
              <View style={styles.rowIcon}>
                <Ionicons name={row.icon} size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowBody}>{row.body}</Text>
              </View>
              <Switch
                value={shownPrefs[row.key]}
                onValueChange={() => toggle(row.key)}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.surface}
                accessibilityLabel={
                  hasAccount
                    ? row.title
                    : `${row.title}. Create a free account to turn this on.`
                }
              />
            </View>
          ))}

          {/* Per-line subscription list. Only revealed when "Train & tube
              disruptions" is on — otherwise the toggles would do nothing. */}
          {shownPrefs['line-closures'] ? (
            <View style={styles.linesBlock}>
              <Text style={styles.linesHeader}>Subscribed lines</Text>
              <Text style={styles.linesSubheader}>
                {anyLineExplicit
                  ? 'Pings only fire for the lines you’ve toggled on.'
                  : 'Following all lines by default. Toggle individual ones to follow only those.'}
              </Text>

              {linesLoading && lines.length === 0 ? (
                <View style={styles.linesLoading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.linesLoadingText}>Loading lines…</Text>
                </View>
              ) : null}

              {lines.map((l) => {
                const subscribed = anyLineExplicit
                  ? !!lineSubs[l.id]
                  : true;
                return (
                  <View key={`${l.modeName}-${l.id}`} style={styles.lineRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineRowName}>{l.name}</Text>
                      <Text style={styles.lineRowMode}>{l.modeName}</Text>
                    </View>
                    <Switch
                      value={subscribed}
                      onValueChange={() => toggleLine(l.id)}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor={colors.surface}
                    />
                  </View>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </SheetOverlay>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '70%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  body: { marginTop: 14 },
  gateCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.featured,
    marginBottom: 14,
  },
  gateIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  gateTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  gateBody: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  gateBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  gateBtnText: {
    color: colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  rowBody: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 3,
    lineHeight: 17,
  },
  linesBlock: {
    marginTop: 4,
    paddingHorizontal: 4,
  },
  linesHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 4,
  },
  linesSubheader: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 10,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  linesLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  linesLoadingText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  lineRowMode: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    letterSpacing: 0.3,
  },
});
