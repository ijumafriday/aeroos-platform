import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './app/router';
import { initAuth, loadRuntimeConfig } from './lib/auth';
import { startLive } from './lib/live';
import { ApiRequestError } from './lib/api';
import { useUi } from './lib/store';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: (n, e) => !(e instanceof ApiRequestError && e.status >= 400 && e.status < 500) && n < 2 },
    mutations: { onError: e => useUi.getState().toast((e as Error).message, 'red') }
  }
});

async function boot() {
  root.render(<div className="boot">Signing in to AeroOS…</div>);
  const config = await loadRuntimeConfig();
  const user = await initAuth(config);
  if (!user) return; // redirecting to the identity provider
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');
  void startLive(queryClient);
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>
  );
}

boot().catch(e => root.render(<div className="boot"><div><h2>AeroOS could not start</h2><p>{(e as Error).message}</p></div></div>));
