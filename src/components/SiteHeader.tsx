import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { withBase } from '@/lib/base';

const navLinks: Array<[string, string, boolean]> = [
  ['/', 'HOME', true],
  ['/teams', 'TEAMS', false],
  ['/players', 'PLAYERS', false],
  ['/auction', 'AUCTION', true],
  ['/fixtures', 'FIXTURES', true],
  ['/leaderboard', 'LEADERBOARD', true],
  ['/register', 'REGISTER', true],
];

type SiteHeaderProps = {
  dark: boolean;
  onToggleTheme: (nextDark: boolean) => void;
  relative?: boolean;
};

export default function SiteHeader({ dark, onToggleTheme, relative }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);

  return (
    <header className={relative ? 'topbar register-topbar' : 'topbar'}>
      <a className="brand" href={withBase('/')} aria-label="D2P home"><img className="brand-mark" src={withBase('/logo-96.png')} alt="D2P logo" width="48" height="48" /><span className="brand-text">DPL <b>2026</b><small>DIGITATE PREMIER LEAGUE</small></span></a>

      <nav className={open ? 'nav open' : 'nav'}>
        {navLinks.map(([to, label, end]) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'active' : undefined} onClick={() => setOpen(false)}>{label}</NavLink>)}
      </nav>

      <div className="topbar-right">
        <button className="nav-toggle" type="button" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '✕' : '☰'}</button>
        {/* <a className="topbar-join" href={withBase("/register")}>JOIN</a> */}
        <div className="theme-switch"><button className={!dark ? 'active' : ''} type="button" aria-label="Light theme" onClick={() => onToggleTheme(false)}>☼</button><button className={dark ? 'active' : ''} type="button" aria-label="Dark theme" onClick={() => onToggleTheme(true)}>☾</button></div>
      </div>
    </header>
  );
}
