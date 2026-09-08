import React from 'react';

interface ShinyBadgeProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'cyan' | 'gold' | 'green' | 'red' | 'purple';
}

export const ShinyBadge: React.FC<ShinyBadgeProps> = ({
  children,
  className = '',
  variant = 'cyan',
}) => {
  return (
    <span className={`shiny-badge shiny-badge--${variant} ${className}`}>
      <span className="shiny-badge-content">{children}</span>
      <span className="shiny-badge-shimmer" />
    </span>
  );
};

export default ShinyBadge;
