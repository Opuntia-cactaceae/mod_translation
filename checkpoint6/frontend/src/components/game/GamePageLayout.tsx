import type { ReactNode } from 'react';

interface GamePageLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function GamePageLayout({ title, description, children }: GamePageLayoutProps) {
  return (
    <div>
      <div className="page-header">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
