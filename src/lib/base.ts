export const BASE_PATH = import.meta.env.BASE_URL;

export function withBase(path: string): string {
  return `${BASE_PATH.replace(/\/$/, '')}${path}`;
}

export function resolveAsset(path: string): string {
  const clean = path.replace(/^\/D2P\//, '/');
  return withBase(clean);
}

export function applyBaseStyles() {
  const b = BASE_PATH.replace(/\/$/, '');
  const root = document.documentElement.style;
  root.setProperty('--bg-hero', `url(${b}/bg1-compressed.jpg)`);
  root.setProperty('--bg-register', `url(${b}/registration.png)`);
  root.setProperty('--bg-teams', `url(${b}/teams.png)`);
  root.setProperty('--bg-auction', `url(${b}/auction.png)`);
  root.setProperty('--bg-fixtures', `url(${b}/fixtures.png)`);
  root.setProperty('--bg-leaderboard', `url(${b}/leaderboard.png)`);
}