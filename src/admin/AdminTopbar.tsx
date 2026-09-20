import { LogOut, ExternalLink, Gavel, LayoutDashboard } from 'lucide-react';
import { withBase } from '@/lib/base';
import { Button } from '@/components/ui/button';

export default function AdminTopbar({ dark, onToggleTheme, onLogout, showLogout = true, auctionPage = false }: { dark: boolean; onToggleTheme: (dark: boolean) => void; onLogout: () => void; showLogout?: boolean; auctionPage?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-card/80 backdrop-blur">
      <div className={`${auctionPage ? 'w-full px-4 sm:px-6' : 'shell'} flex h-14 items-center justify-between gap-4`}>
        <a className="flex items-center gap-2.5" href={withBase('/')} aria-label="D2P home">
          <img className="h-9 w-9 rounded-lg object-cover" src={withBase('/logo-96.png')} alt="D2P logo" />
          <span className="font-display text-xl font-black italic tracking-wide leading-none">
            DPL <span className="text-primary">ADMIN</span>
          </span>
        </a>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <a href={withBase('/admin/auction')} aria-label="Auction control room">
            <Button variant="outline" size="sm" className={auctionPage ? 'border-primary/60 text-primary' : ''}><Gavel /><span className="hidden sm:inline">AUCTION</span></Button>
          </a>
          <a href={withBase('/admin')} aria-label="Admin console">
            <Button variant="ghost" size="sm"><LayoutDashboard className="sm:hidden" /><span className="hidden text-xs font-black sm:inline">CONSOLE</span></Button>
          </a>
          <a href={withBase('/')} aria-label="View site">
            <Button variant="ghost" size="sm"><ExternalLink /><span className="hidden sm:inline">VIEW SITE</span></Button>
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
            <Button variant="outline" size="sm" onClick={onLogout} aria-label="Sign out"><LogOut /><span className="hidden sm:inline">SIGN OUT</span></Button>
          )}
        </div>
      </div>
    </header>
  );
}