import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BRAND_LOGO = require('../../assets/driveiq-logo.png');

interface Props {
  visible: boolean;
  onClose: () => void;
  version?: string;
}

export function AboutSheet({
  visible,
  onClose,
  // Read the real app version so About can never drift out of date again
  // (it was hardcoded and stuck on 5.0.2).
  version = Constants.expoConfig?.version ?? 'n/a',
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* A full-screen Modal is its own native window on iOS, so the app-root
          SafeAreaProvider's insets don't reach it — SafeAreaView read a top
          inset of 0 and the header rendered under the status bar (the
          "cropped page" bug). Each modal needs its own provider. */}
      <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>About DriveIQ</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.brandBlock}>
            <View style={styles.logoBadge}>
              <Image
                source={BRAND_LOGO}
                resizeMode="contain"
                style={styles.logo}
                accessibilityIgnoresInvertColors
              />
            </View>
            <Text style={styles.brandName}>DriveIQ</Text>
            <Text style={styles.version}>Version {version}</Text>
          </View>

          <Text style={styles.lead}>
            DriveIQ puts the whole city on one live map. See what's on, including
            sport, music, theatre, comedy, film and family events, next to real-time
            road incidents and London transport status, so you always know
            what's happening and how to get there.
          </Text>

          <Text style={styles.sectionTitle}>What you can do</Text>
          {[
            'Browse live events across London on the map',
            'Filter by day and category',
            'Save events and get a reminder before they start',
            'See major road incidents and live tube, rail and tram status',
            'Report hazards and incidents to others nearby',
            'Get directions in DriveIQ, Google Maps, Waze or Apple Maps',
          ].map((line) => (
            <View key={line} style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
              <Text style={styles.bullet}>{line}</Text>
            </View>
          ))}

          <Text style={styles.legal}>
            Event data is aggregated from third-party providers and Transport
            for London. Times and details can change, so always check with the
            venue or operator before you travel.
          </Text>
          <Text style={styles.copyright}>
            © {new Date().getFullYear()} DriveIQ. All rights reserved.
          </Text>
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
  body: { padding: 20 },
  brandBlock: { alignItems: 'center', marginBottom: 20 },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logo: { width: 40, height: 48 },
  brandName: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  version: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  lead: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
    marginBottom: 22,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 10,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  bullet: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.textPrimary },
  legal: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 22,
    fontStyle: 'italic',
  },
  copyright: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 16,
    textAlign: 'center',
  },
});
