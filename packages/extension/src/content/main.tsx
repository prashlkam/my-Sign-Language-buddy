import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { OVERLAY_CSS } from './styles';
import { ErrorBoundary } from '../ui/ErrorBoundary';

/**
 * Mounts the overlay into a shadow root.
 *
 * Meet and Zoom both ship aggressive global stylesheets, and both would happily
 * restyle our captions into illegibility on their next deploy. A shadow root
 * makes that impossible in either direction — and caption legibility is the
 * whole product for the person reading them.
 */
const HOST_ID = 'sign-language-buddy-root';

function mount(): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  // The host itself must not participate in the page's layout.
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483600;';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);

  const container = document.createElement('div');
  shadow.appendChild(container);

  createRoot(container).render(
    <StrictMode>
      {/* A crash here must not silently remove the user's captions mid-call. */}
      <ErrorBoundary surface="caption overlay" compact>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
