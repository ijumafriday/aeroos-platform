import { useEffect, useState } from 'react';
import { discardQueueItem, flushOfflineQueue, listQueue, type OfflineQueueItem } from '../lib/offline';

export function OfflineSync() {
  const [items, setItems] = useState<OfflineQueueItem[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const refresh = () => void listQueue().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    refresh();
    const sync = () => { setOnline(navigator.onLine); if (navigator.onLine) void flushOfflineQueue().finally(refresh); };
    window.addEventListener('online', sync); window.addEventListener('offline', sync); window.addEventListener('aeroos-offline-queue', refresh);
    const timer = window.setInterval(() => { if (navigator.onLine) void flushOfflineQueue().finally(refresh); }, 30_000);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); window.removeEventListener('aeroos-offline-queue', refresh); clearInterval(timer); };
  }, []);
  const blocked = items.filter(i => i.state !== 'PENDING').length;
  if (!items.length && online) return null;
  return <div className={`offline-sync ${online ? 'online' : 'offline'}`} title={items.map(i => `${i.state}: ${i.label}`).join('\n')}>
    <b>{online ? 'SYNC' : 'OFFLINE'}</b> · {items.length} queued{blocked ? ` · ${blocked} need review` : ''}
    {blocked > 0 && <button className="btn sm ghost" onClick={async () => { for (const i of items.filter(x => x.state === 'FAILED')) await discardQueueItem(i.id); refresh(); }}>Clear failed</button>}
  </div>;
}
