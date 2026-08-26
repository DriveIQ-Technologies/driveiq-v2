import React, { useEffect, useState } from 'react';

import { PremiumPaywallSheet } from '@/components/PremiumPaywallSheet';
import { registerPaywallHost } from '@/services/subscription';

/**
 * Listens for imperative paywall requests from `showPremiumPaywall`.
 */
export function PremiumPaywallHost({ onUnlocked }: { onUnlocked?: () => void }) {
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState<string | undefined>();
  const [source, setSource] = useState<string | undefined>();

  useEffect(() => {
    registerPaywallHost((req) => {
      setFeature(req.feature);
      setSource(req.source);
      setOpen(true);
    });
    return () => registerPaywallHost(null);
  }, []);

  return (
    <PremiumPaywallSheet
      visible={open}
      feature={feature}
      source={source}
      onClose={() => setOpen(false)}
      onUnlocked={onUnlocked}
    />
  );
}
