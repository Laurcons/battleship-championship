import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { ApiClient } from './api/client';
import { ApiProvider } from './api/context';
import type { MockControls } from './mock/MockApiClient';
import { MockControlsProvider } from './mock/controls';

export function AppProviders({
  api,
  controls,
  children,
}: {
  api: ApiClient;
  controls?: MockControls;
  children: ReactNode;
}) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 1000 } } }),
  );
  const inner = (
    <ApiProvider client={api}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiProvider>
  );
  return controls ? <MockControlsProvider controls={controls}>{inner}</MockControlsProvider> : inner;
}
