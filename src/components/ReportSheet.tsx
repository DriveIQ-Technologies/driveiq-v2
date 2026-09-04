import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { colors } from '@/theme/colors';
import { track, trackScreen } from '@/services/analytics';
import {
  REPORT_META,
  REPORT_ORDER,
  type ReportCategory,
} from '@/services/reports';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Go back to the map to drag the pin. */
  onMovePin?: () => void;
  /** Submit a new report at the pin the parent already placed. */
  onSubmit: (category: ReportCategory, note: string) => void;
}

/**
 * "Report something" sheet. Pick a category, optionally add a note, submit.
 * The report drops at the centre of the current map view, so the user lines
 * up the spot first, then taps the report button.
 */
export function ReportSheet({ visible, onClose, onSubmit, onMovePin }: Props) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState('');

  const reset = () => {
    setCategory(null);
    setNote('');
  };

  const handleClose = () => {
    track('report_sheet_closed');
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!category) return;
    track('report_submit_tapped', { category, has_note: Boolean(note.trim()) });
    onSubmit(category, note.trim());
    reset();
  };

  React.useEffect(() => {
    if (visible) trackScreen('report_sheet');
  }, [visible]);

  if (!visible) return null;

  return (
    <SheetOverlay onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.flexEnd}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.titleRow}>
            <Text style={styles.title}>Report something</Text>
            <Pressable onPress={handleClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>
            Pin is set. Pick what you can see. You can still move the pin if this
            is the wrong spot.
          </Text>

          {onMovePin ? (
            <Pressable style={styles.movePin} onPress={onMovePin} accessibilityRole="button">
              <Ionicons name="move" size={16} color={colors.primary} />
              <Text style={styles.movePinText}>Move pin</Text>
            </Pressable>
          ) : null}

          <View style={styles.grid}>
            {REPORT_ORDER.map((key) => {
              const meta = REPORT_META[key];
              const active = category === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    track('report_category_selected', { category: key });
                    setCategory(key);
                  }}
                  style={[
                    styles.chip,
                    active && { borderColor: meta.color, backgroundColor: colors.primarySoft },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.chipIcon, { backgroundColor: meta.color }]}>
                    <Ionicons
                      name={meta.icon as React.ComponentProps<typeof Ionicons>['name']}
                      size={16}
                      color={colors.textOnPrimary}
                    />
                  </View>
                  <Text style={styles.chipText}>{meta.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Add a note (optional)"
            placeholderTextColor={colors.textSecondary}
            value={note}
            onChangeText={setNote}
            maxLength={140}
            multiline
          />

          <Pressable
            onPress={handleSubmit}
            disabled={!category}
            style={[styles.submit, !category && styles.submitDisabled]}
            accessibilityRole="button"
          >
            <Ionicons name="add-circle" size={18} color={colors.textOnPrimary} />
            <Text style={styles.submitText}>Submit report</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SheetOverlay>
  );
}

const styles = StyleSheet.create({
  flexEnd: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 12,
  },
  movePin: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    marginBottom: 14,
  },
  movePinText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  chipIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 16,
    textAlignVertical: 'top',
  },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  submitDisabled: {
    backgroundColor: colors.textSecondary,
    opacity: 0.5,
  },
  submitText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
});
