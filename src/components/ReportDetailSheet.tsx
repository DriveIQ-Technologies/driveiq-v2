import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SheetOverlay } from '@/components/ui/SheetOverlay';
import { auth } from '@/services/firebase';
import { REPORT_META, type UserReport } from '@/services/reports';
import { colors } from '@/theme/colors';

interface Props {
  report: UserReport | null;
  onClose: () => void;
  onConfirm: (report: UserReport) => Promise<void>;
  onRemove?: (report: UserReport) => void;
}

export function ReportDetailSheet({ report, onClose, onConfirm, onRemove }: Props) {
  const [busy, setBusy] = useState(false);
  if (!report) return null;

  const meta = REPORT_META[report.category] ?? REPORT_META.other;
  const mine = Boolean(report.createdBy && report.createdBy === auth?.currentUser?.uid);
  const when = new Date(report.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const thumbs = async () => {
    if (busy || report.confirmedByMe || mine) return;
    setBusy(true);
    try {
      await onConfirm(report);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetOverlay onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.titleRow}>
          <View style={[styles.icon, { backgroundColor: meta.color }]}>
            <Ionicons
              name={meta.icon as React.ComponentProps<typeof Ionicons>['name']}
              size={18}
              color={colors.textOnPrimary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{meta.label}</Text>
            <Text style={styles.sub}>
              {report.placeLabel ? `${report.placeLabel} · ` : ''}Reported {when}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        {report.note ? <Text style={styles.note}>{report.note}</Text> : null}

        <Pressable
          style={[
            styles.confirmBtn,
            (report.confirmedByMe || mine) && styles.confirmBtnDone,
          ]}
          onPress={() => void thumbs()}
          disabled={busy || report.confirmedByMe || mine}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Ionicons
                name={report.confirmedByMe ? 'thumbs-up' : 'thumbs-up-outline'}
                size={18}
                color={report.confirmedByMe || mine ? colors.success : colors.textPrimary}
              />
              <Text
                style={[
                  styles.confirmText,
                  (report.confirmedByMe || mine) && styles.confirmTextDone,
                ]}
              >
                {mine
                  ? 'Your report'
                  : report.confirmedByMe
                    ? 'You confirmed this'
                    : 'I can see this too'}
              </Text>
              <View style={styles.countPill}>
                <Text style={styles.countText}>{report.confirmCount}</Text>
              </View>
            </>
          )}
        </Pressable>

        {mine && onRemove ? (
          <Pressable style={styles.remove} onPress={() => onRemove(report)}>
            <Text style={styles.removeText}>Remove my report</Text>
          </Pressable>
        ) : null}
      </View>
    </SheetOverlay>
  );
}

const styles = StyleSheet.create({
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
    gap: 12,
    marginBottom: 12,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  sub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  note: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
    marginBottom: 16,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmBtnDone: {
    borderColor: colors.success,
  },
  confirmText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  confirmTextDone: { color: colors.success },
  countPill: {
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  countText: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  remove: { alignSelf: 'center', marginTop: 14, padding: 8 },
  removeText: { fontSize: 14, fontWeight: '600', color: '#DC2626' },
});
