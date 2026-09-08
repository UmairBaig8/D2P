import React from 'react';

interface BorderBeamProps {
  className?: string;
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  borderWidth?: number;
}

export const BorderBeam: React.FC<BorderBeamProps> = ({
  className = '',
  size = 200,
  duration = 8,
  delay = 0,
  colorFrom = '#09c9d8',
  colorTo = '#ffd75e',
  borderWidth = 1.5,
}) => {
  return (
    <div
      aria-hidden="true"
      className={`border-beam-track ${className}`}
      style={
        {
          '--size': `${size}px`,
          '--duration': `${duration}s`,
          '--delay': `${delay}s`,
          '--color-from': colorFrom,
          '--color-to': colorTo,
          '--border-width': `${borderWidth}px`,
        } as React.CSSProperties
      }
    >
      <div className="border-beam-line" />
    </div>
  );
};

export default BorderBeam;
