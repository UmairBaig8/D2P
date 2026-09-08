import { StrictMode } from 'react';
import { withBase, applyBaseStyles } from '@/lib/base';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import AnalyticsTracker from '@/components/AnalyticsTracker';
import RegisterPage from '@/pages/RegisterPage';
import ConfirmationPage from '@/pages/ConfirmationPage';
import AuctionPage from '@/pages/AuctionPage';
import TeamsPage from '@/pages/TeamsPage';
import PlayersPage from '@/pages/PlayersPage';
import TeamPage from '@/pages/TeamPage';
import AdminPage from '@/admin/AdminPage';
import AuctionControlRoom from '@/admin/AuctionControlRoom';
import ComingSoonPage from '@/pages/ComingSoonPage';
import './index.css';
import './styles.css';

applyBaseStyles();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AnalyticsTracker />
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/confirmation" element={<ConfirmationPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:code" element={<TeamPage />} />
        <Route path="/players" element={<PlayersPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/auction" element={<AuctionControlRoom />} />
        <Route path="/fixtures" element={<ComingSoonPage eyebrow="DPL 2026 / FIXTURES" title="FIXTURES" copy="The full match schedule with dates, venues, and results will live here." icon="📅" backgroundImage={withBase('/fixtures.png')} />} />
        <Route path="/auction" element={<AuctionPage />} />
        <Route path="/leaderboard" element={<ComingSoonPage eyebrow="DPL 2026 / LEADERBOARD" title="LEADERBOARD" copy="Player rankings, run scorers, and wicket takers will be tracked here." icon="📊" backgroundImage={withBase('/leaderboard.png')} />} />
        <Route path="/gallery" element={<ComingSoonPage eyebrow="DPL 2026 / GALLERY" title="GALLERY" copy="Match photos and moments from the season will be collected here." icon="📸" />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
