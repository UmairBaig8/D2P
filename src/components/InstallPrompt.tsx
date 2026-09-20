import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

type BipEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = 'd2p.install.dismissed';

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BipEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone || dismissed) return;

    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BipEvent); };
    const onInstalled = () => { setDeferred(null); setIosHint(false); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    if (isIOS) setIosHint(true);

    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, [dismissed]);

  const close = () => { localStorage.setItem(DISMISS_KEY, '1'); setDismissed(true); setDeferred(null); setIosHint(false); };

  if (dismissed) return null;
  if (!deferred && !iosHint) return null;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  return (
    <div className="pwa-install" role="dialog" aria-label="Install app">
      <span className="pwa-install-icon">{iosHint ? <Share /> : <Download />}</span>
      <div className="pwa-install-text">
        <b>Install D2P</b>
        <span>{iosHint ? 'Tap Share, then “Add to Home Screen”.' : 'Add it to your home screen for full-screen access.'}</span>
      </div>
      {!iosHint && <button type="button" className="pwa-install-btn" onClick={install}>INSTALL</button>}
      <button type="button" className="pwa-install-close" onClick={close} aria-label="Dismiss"><X /></button>
    </div>
  );
}
