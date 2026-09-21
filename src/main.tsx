import { StrictMode, Suspense, lazy } from 'react';
import { applyBaseStyles } from '@/lib/base';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import AnalyticsTracker from '@/components/AnalyticsTracker';
import InstallPrompt from '@/components/InstallPrompt';
import RegisterPage from '@/pages/RegisterPage';
import ConfirmationPage from '@/pages/ConfirmationPage';
import TeamsPage from '@/pages/TeamsPage';
import PlayersPage from '@/pages/PlayersPage';
import TeamPage from '@/pages/TeamPage';
import FixturesPage from '@/pages/FixturesPage';
import LeaderboardPage from '@/pages/LeaderboardPage';
import ScorePage from '@/pages/ScorePage';
import ComingSoonPage from '@/pages/ComingSoonPage';
import './index.css';
import './styles.css';

// Heavy / route-specific bundles are code-split so they don't ship on first load.
const AuctionPage = lazy(() => import('@/pages/AuctionPage'));
const AdminPage = lazy(() => import('@/admin/AdminPage'));
const AuctionControlRoom = lazy(() => import('@/admin/AuctionControlRoom'));

function RouteFallback() {
  return <div className="shell" style={{ paddingTop: 80, textAlign: 'center', color: '#09c9d8' }}>LOADING…</div>;
}

applyBaseStyles();

// Hosts (e.g. GitHub Pages) 301 `/x` -> `/x/`; keep the address bar clean and
// the router consistent by stripping the trailing slash on load.
const base = import.meta.env.BASE_URL;
const initialPath = window.location.pathname;
if (initialPath !== base && initialPath !== '/' && initialPath.endsWith('/')) {
  window.history.replaceState(null, '', `${initialPath.replace(/\/+$/, '')}${window.location.search}${window.location.hash}`);
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* offline/unsupported */ });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AnalyticsTracker />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/confirmation" element={<ConfirmationPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:code" element={<TeamPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/auction" element={<AuctionControlRoom />} />
          <Route path="/fixtures" element={<FixturesPage />} />
          <Route path="/score" element={<ScorePage />} />
          <Route path="/auction" element={<AuctionPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/gallery" element={<ComingSoonPage eyebrow="DPL 2026 / GALLERY" title="GALLERY" copy="Match photos and moments from the season will be collected here." icon="📸" />} />
        </Routes>
      </Suspense>
      <InstallPrompt />
    </BrowserRouter>
  </StrictMode>,
);
