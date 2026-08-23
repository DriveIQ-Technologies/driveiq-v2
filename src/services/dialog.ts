/**
 * In-app dialogs.
 *
 * `Alert.alert` is presented by iOS on the root view controller. Any sheet that
 * was a native modal sat *above* that controller, so the alert appeared behind
 * the sheet: invisible, but still blocking every touch. That is what froze the
 * app when tapping notify on a station.
 *
 * These dialogs are rendered by `DialogHost` at the top of the app tree, so
 * they are always visible and always dismissible. The API is imperative so
 * services (paywall, permissions) can call it without hooks.
 */

export type DialogButtonStyle = 'default' | 'cancel' | 'destructive';

export interface DialogButton {
  label: string;
  style?: DialogButtonStyle;
  onPress?: () => void;
}

export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
}

type Listener = (queue: DialogRequest[]) => void;

let queue: DialogRequest[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

function emit(): void {
  const snapshot = queue;
  for (const l of listeners) l(snapshot);
}

export function subscribeDialogs(listener: Listener): () => void {
  listeners.add(listener);
  listener(queue);
  return () => {
    listeners.delete(listener);
  };
}

/** Show a message with one or more actions. Returns the request id. */
export function showDialog(
  title: string,
  message?: string,
  buttons?: DialogButton[],
): number {
  const id = nextId++;
  queue = [
    ...queue,
    {
      id,
      title,
      message,
      buttons: buttons && buttons.length > 0 ? buttons : [{ label: 'OK' }],
    },
  ];
  emit();
  return id;
}

/** Two-button confirm. `onConfirm` runs only on the confirm button. */
export function showConfirm(
  title: string,
  message: string,
  opts: {
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
  },
): number {
  return showDialog(title, message, [
    {
      label: opts.cancelLabel ?? 'Cancel',
      style: 'cancel',
      onPress: opts.onCancel,
    },
    {
      label: opts.confirmLabel ?? 'Confirm',
      style: opts.destructive ? 'destructive' : 'default',
      onPress: opts.onConfirm,
    },
  ]);
}

export function dismissDialog(id: number): void {
  queue = queue.filter((d) => d.id !== id);
  emit();
}

/** Used on hard resets (sign-out, app-level error recovery). */
export function clearDialogs(): void {
  if (queue.length === 0) return;
  queue = [];
  emit();
}
