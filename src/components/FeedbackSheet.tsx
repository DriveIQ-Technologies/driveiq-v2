import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { showDialog } from '@/services/dialog';
import { colors } from '@/theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SUPPORT_EMAIL = 'feedback@driveiq.app';

type Kind = 'idea' | 'bug' | 'event' | 'other';

const KINDS: { key: Kind; label: string; icon: string }[] = [
  { key: 'idea', label: 'Idea', icon: 'bulb' },
  { key: 'bug', label: 'Something broke', icon: 'bug' },
  { key: 'event', label: 'Missing event', icon: 'calendar' },
  { key: 'other', label: 'Other', icon: 'chatbubble-ellipses' },
];

/**
 * Send feedback. Composes an email to the support address with the chosen
 * category prefilled — no backend required. If no mail client is set up we
 * fall back to a friendly alert with the address.
 */
export function FeedbackSheet({ visible, onClose }: Props) {
  const [kind, setKind] = useState<Kind>('idea');
  const [text, setText] = useState('');

  const reset = () => {
    setKind('idea');
    setText('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSend = async () => {
    const body = text.trim();
    if (!body) {
      showDialog('Add a note', 'Tell us a little about your feedback first.');
      return;
    }
    const subjectLabel = KINDS.find((k) => k.key === kind)?.label ?? 'Feedback';
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      `DriveIQ feedback: ${subjectLabel}`,
    )}&body=${encodeURIComponent(body)}`;
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) throw new Error('no mail client');
      await Linking.openURL(url);
      handleClose();
    } catch {
      showDialog(
        'No mail app found',
        `Please email us directly at ${SUPPORT_EMAIL}.`,
      );
    }
  };

  if (!visible) return null;

  return (
    <SheetOverlay onRequestClose={handleClose} dim={false} visible={visible}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Send feedback</Text>
          <Pressable onPress={handleClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.lead}>
              We read everything. Tell us what's working, what isn't, or an
              event we should add.
            </Text>

            <View style={styles.kindRow}>
              {KINDS.map((k) => {
                const active = kind === k.key;
                return (
                  <Pressable
                    key={k.key}
                    onPress={() => setKind(k.key)}
                    style={[styles.kind, active && styles.kindActive]}
                  >
                    <Ionicons
                      name={k.icon as React.ComponentProps<typeof Ionicons>['name']}
                      size={16}
                      color={active ? colors.textOnPrimary : colors.primary}
                    />
                    <Text style={[styles.kindText, active && styles.kindTextActive]}>
                      {k.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              style={styles.input}
              placeholder="Your feedback…"
              placeholderTextColor={colors.textSecondary}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={1000}
            />
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.sendBtn} onPress={handleSend}>
              <Ionicons name="send" size={17} color={colors.textOnPrimary} />
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SheetOverlay>
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
  body: { padding: 20 },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  kind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  kindActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  kindText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  kindTextActive: { color: colors.textOnPrimary },
  input: {
    minHeight: 160,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: 14,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  sendText: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '800' },
});
