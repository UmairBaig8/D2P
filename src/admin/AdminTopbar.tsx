import { LogOut, ExternalLink, Gavel } from 'lucide-react';
import { withBase } from '@/lib/base';
import { Button } from '@/components/ui/button';

export default function AdminTopbar({ dark, onToggleTheme, onLogout, showLogout = true }: { dark: boolean; onToggleTheme: (dark: boolean) => void; onLogout: () => void; showLogout?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-card/80 backdrop-blur">
      <div className="shell flex h-14 items-center justify-between gap-4">
        <a className="flex items-center gap-2.5" href={withBase('/')} aria-label="D2P home">
          <img className="h-9 w-9 rounded-lg object-cover" src={withBase('/logo-96.png')} alt="D2P logo" />
          <span className="font-display text-xl font-black italic tracking-wide leading-none">
            DPL <span className="text-primary">ADMIN</span>
          </span>
        </a>
        <div className="flex items-center gap-2">
          <a href={withBase('/admin/auction')}>
            <Button variant="outline" size="sm"><Gavel /> AUCTION</Button>
          </a>
          <a href={withBase('/')}>
            <Button variant="ghost" size="sm"><ExternalLink /> VIEW SITE</Button>
          </a>
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
            <button
              type="button"
              aria-label="Light theme"
              onClick={() => onToggleTheme(false)}
              className={`grid size-7 place-items-center rounded-md text-sm leading-none transition-colors ${!dark ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              ☼
            </button>
            <button
              type="button"
              aria-label="Dark theme"
              onClick={() => onToggleTheme(true)}
              className={`grid size-7 place-items-center rounded-md text-sm leading-none transition-colors ${dark ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              ☾
            </button>
          </div>
          {showLogout && (
            <Button variant="outline" size="sm" onClick={onLogout}><LogOut /> SIGN OUT</Button>
          )}
        </div>
      </div>
    </header>
  );
}