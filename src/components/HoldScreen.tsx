import { useEffect, useState } from 'react';

export default function HoldScreen({ eyebrow, bgVar, quotes }: { eyebrow: string; bgVar: string; quotes: string[] }) {
  const [i, setI] = useState(() => Math.floor(Math.random() * quotes.length));
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % quotes.length), 5500);
    return () => window.clearInterval(id);
  }, [quotes.length]);

  return <section className="hold">
    <div className="hold-bg" style={{ backgroundImage: `var(${bgVar}, none)` }} />
    <div className="hold-inner">
      <p className="hold-eyebrow">{eyebrow}</p>
      <h1>ON<br /><span>HOLD.</span></h1>
      <p className="hold-quote" key={i}>“{quotes[i]}”</p>
      <p className="hold-note">Dates are being finalised — this page lights up the moment we&apos;re back. 🏏</p>
    </div>
  </section>;
}
