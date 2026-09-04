import React, { useCallback, useEffect, useState } from 'react';

import { AccountReadySheet } from '@/components/AccountReadySheet';
import { PremiumPaywallSheet } from '@/components/PremiumPaywallSheet';
import { PremiumUnlockedSheet } from '@/components/PremiumUnlockedSheet';
import type { AccountReadyInfo } from '@/data/freeAccountCopy';
import type { PremiumUnlockOutcome } from '@/data/premiumUnlockCopy';
import { registerAccountReadyHost } from '@/services/accountReady';
import {
  registerPremiumUnlockHost,
  registerPaywallHost,
} from '@/services/subscription';
import {
  showPurchaseFailure,
  type PurchaseFlowFailure,
} from '@/services/premiumPurchaseFlow';

/**
 * Paywall + post-purchase walkthrough host.
 * Upgrade CTA → paywall → success walkthrough or failure dialog.
 */
export function PremiumPaywallHost({ onUnlocked }: { onUnlocked?: () => void }) {
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [feature, setFeature] = useState<string | undefined>();
  const [source, setSource] = useState<string | undefined>();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockOutcome, setUnlockOutcome] = useState<PremiumUnlockOutcome | null>(null);
  const [readyOpen, setReadyOpen] = useState(false);
  const [readyInfo, setReadyInfo] = useState<AccountReadyInfo | null>(null);

  const openPaywall = useCallback((req: { feature: string; source?: string }) => {
    setFeature(req.feature);
    setSource(req.source);
    setPaywallOpen(true);
  }, []);

  const showUnlock = useCallback(
    (outcome: PremiumUnlockOutcome) => {
      setUnlockOutcome(outcome);
      setUnlockOpen(true);
      onUnlocked?.();
    },
    [onUnlocked],
  );

  useEffect(() => {
    registerPaywallHost((req) => openPaywall(req));
    registerPremiumUnlockHost(showUnlock);
    registerAccountReadyHost((info) => {
      setReadyInfo(info);
      setReadyOpen(true);
    });
    return () => {
      registerPaywallHost(null);
      registerPremiumUnlockHost(null);
      registerAccountReadyHost(null);
    };
  }, [openPaywall, showUnlock]);

  const handleFailure = (failure: PurchaseFlowFailure) => {
    showPurchaseFailure(failure, {
      onRetry: () => openPaywall({ feature: feature ?? 'DriveIQ Premium', source }),
    });
  };

  return (
    <>
      <PremiumPaywallSheet
        visible={paywallOpen}
        feature={feature}
        source={source}
        onClose={() => setPaywallOpen(false)}
        onUnlocked={onUnlocked}
        onSuccess={showUnlock}
        onFailure={handleFailure}
      />
      <PremiumUnlockedSheet
        visible={unlockOpen}
        outcome={unlockOutcome}
        onClose={() => {
          setUnlockOpen(false);
          setUnlockOutcome(null);
        }}
      />
      <AccountReadySheet
        visible={readyOpen && !unlockOpen}
        info={readyInfo}
        onClose={() => {
          setReadyOpen(false);
          setReadyInfo(null);
        }}
      />
    </>
  );
}
