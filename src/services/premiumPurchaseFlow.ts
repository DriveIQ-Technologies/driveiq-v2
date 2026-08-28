import { track } from './analytics';
import { showDialog } from './dialog';

export type PurchaseFlowKind = 'purchase' | 'restore';

export interface PurchaseFlowFailure {
  kind: PurchaseFlowKind;
  cancelled: boolean;
  message: string;
}

/** Turn store / SDK errors into driver-friendly copy. */
export function friendlyPurchaseError(message: string, kind: PurchaseFlowKind): string {
  const m = message.toLowerCase();
  if (m.includes('not available in this build')) {
    return 'Purchases need a development or store build — not Expo Go.';
  }
  if (m.includes('no active premium') || m.includes('no active subscription')) {
    return 'No active Premium subscription was found for this Apple or Google account.';
  }
  if (m.includes('network') || m.includes('internet') || m.includes('connection')) {
    return 'Check your connection and try again.';
  }
  if (m.includes('billing') || m.includes('payment') || m.includes('card')) {
    return kind === 'purchase'
      ? 'Your store could not take payment. Check your payment method in Settings and try again.'
      : 'We could not verify your subscription with the store. Try again in a moment.';
  }
  if (m.includes('already owned') || m.includes('already subscribed')) {
    return 'This account already has Premium. Tap Restore purchases if features have not unlocked yet.';
  }
  return kind === 'purchase'
    ? 'Payment did not go through. You have not been charged.'
    : 'Could not restore purchases right now. Try again in a moment.';
}

export function showPurchaseFailure(
  failure: PurchaseFlowFailure,
  opts?: { onRetry?: () => void },
): void {
  if (failure.cancelled) return;

  track('purchase_flow_failed', {
    kind: failure.kind,
    message: failure.message.slice(0, 120),
  });

  const message = friendlyPurchaseError(failure.message, failure.kind);
  const buttons = opts?.onRetry
    ? [
        { label: 'Not now', style: 'cancel' as const },
        { label: failure.kind === 'purchase' ? 'Try again' : 'Retry restore', onPress: opts.onRetry },
      ]
    : [{ label: 'OK' }];

  showDialog(
    failure.kind === 'purchase' ? 'Payment did not go through' : 'Restore failed',
    message,
    buttons,
  );
}
