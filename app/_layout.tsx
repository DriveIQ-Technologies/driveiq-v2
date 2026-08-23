import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DialogHost } from '@/components/ui/DialogHost';
import { SheetHost } from '@/components/ui/SheetOverlay';
import { AuthProvider } from '@/providers/AuthProvider';
import { initAnalytics } from '@/services/analytics';
import { colors } from '@/theme/colors';

export default function RootLayout() {
  useEffect(() => {
    initAnalytics();
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
          <DialogHost />
        </View>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
