import React, { useEffect, useRef, useState } from 'react';

interface NumberTickerProps {
  value: number;
  direction?: 'up' | 'down';
  delay?: number;
  className?: string;
  formatter?: (val: number) => string;
}

export const NumberTicker: React.FC<NumberTickerProps> = ({
  value,
  className = '',
  formatter = (val: number) => val.toLocaleString('en-IN'),
}) => {
  const [displayValue, setDisplayValue] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    if (start === end) return;

    const startTime = performance.now();
    const duration = 600; // ms

    let rafId: number;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * ease);
      setDisplayValue(current);

      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      } else {
        prevRef.current = end;
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(rafId);
  }, [value]);

  return (
    <span className={`number-ticker ${className}`}>
      {formatter(displayValue)}
    </span>
  );
};

export default NumberTicker;
