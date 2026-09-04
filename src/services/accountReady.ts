import type { AccountReadyInfo } from '@/data/freeAccountCopy';

type ReadyListener = (info: AccountReadyInfo) => void;
let listener: ReadyListener | null = null;

export function registerAccountReadyHost(fn: ReadyListener | null): void {
  listener = fn;
}

export function presentAccountReady(info: AccountReadyInfo): void {
  listener?.(info);
}
