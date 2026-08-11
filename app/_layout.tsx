import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
