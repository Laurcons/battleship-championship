import 'bootswatch/dist/darkly/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AppProviders } from './AppProviders';

// `VITE_API_MODE=http` talks to the real API; the default is the in-browser mock (pnpm dev). The
// mock is loaded on demand, so the real build does not contain it.
async function start() {
  const root = createRoot(document.getElementById('root') as HTMLElement);
  const tree = (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
  if (import.meta.env.VITE_API_MODE === 'http') {
    const { createHttpApiClient } = await import('./api/http');
    root.render(
      <StrictMode>
        <AppProviders api={createHttpApiClient()}>{tree}</AppProviders>
      </StrictMode>,
    );
  } else {
    const { mockApi, mockControls } = await import('./mock/instance');
    root.render(
      <StrictMode>
        <AppProviders api={mockApi} controls={mockControls}>
          {tree}
        </AppProviders>
      </StrictMode>,
    );
  }
}

void start();
