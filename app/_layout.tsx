import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

void SplashScreen.preventAutoHideAsync();

import { DialogHost } from '@/components/ui/DialogHost';
import { PremiumPaywallHost } from '@/components/PremiumPaywallHost';
import { SheetHost } from '@/components/ui/SheetOverlay';
import { AuthProvider } from '@/providers/AuthProvider';
import { initAnalytics } from '@/services/analytics';
import { configurePurchases, prefetchOfferings } from '@/services/purchases';
import { colors } from '@/theme/colors';

export default function RootLayout() {
  useEffect(() => {
    initAnalytics();
    void configurePurchases().then((ok) => {
      if (ok) void prefetchOfferings();
    });
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        {/* SheetHost then DialogHost — both sit above the navigator so a
            native prompt can never leave an overlay stuck under the map. */}
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="index" />
          </Stack>
          <SheetHost />
          <PremiumPaywallHost />
          <DialogHost />
        </View>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
