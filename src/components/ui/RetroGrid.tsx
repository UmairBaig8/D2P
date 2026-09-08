import React from 'react';

interface RetroGridProps {
  className?: string;
  angle?: number;
}

export const RetroGrid: React.FC<RetroGridProps> = ({ className = '', angle = 65 }) => {
  return (
    <div
      className={`retro-grid-wrap ${className}`}
      style={{ '--grid-angle': `${angle}deg` } as React.CSSProperties}
    >
      <div className="retro-grid-plane">
        <div className="retro-grid-pattern" />
      </div>
      <div className="retro-grid-fade" />
    </div>
  );
};

export default RetroGrid;
