import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { Severity } from '@aeroos/contracts';

export interface Toast { id: number; text: string; tone: Severity | '' }

interface UiState {
  live: boolean;
  toasts: Toast[];
  setLive(v: boolean): void;
  toast(text: string, tone?: Severity | ''): void;
}

let seq = 0;

/** Client-only UI state. Server data lives in TanStack Query, never here. */
export const useUi = create<UiState>()(set => ({
  live: false,
  toasts: [],
  setLive: live => set({ live }),
  toast: (text, tone = '') => {
    const id = ++seq;
    set(s => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 5000);
  }
}));

/* One shared 1-second clock: only countdown components subscribe, so nothing else re-renders. */
const listeners = new Set<() => void>();
let now = Date.now();
setInterval(() => {
  now = Date.now();
  listeners.forEach(l => l());
}, 1000);

export function useNow(): number {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => now
  );
}
