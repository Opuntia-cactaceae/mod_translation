/* ------------------------------------------------------------------ */
/*  PairWorkspaceLayout — top pairing area (FILES | PAIR BOARD)         */
/*                                                                      */
/*  Bottom panel is now handled by ProjectWorkspace shell grid.         */
/* ------------------------------------------------------------------ */

import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface PairWorkspaceLayoutProps {
  /** Left column — typically the file tree. */
  leftColumn: ReactNode;
  /** Right column — typically the pair list. */
  centerColumn: ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PairWorkspaceLayout({
  leftColumn,
  centerColumn,
}: PairWorkspaceLayoutProps) {
  return (
    <div className="pair-workspace-layout">
      {/* Top area: two columns */}
      <div className="pair-workspace-layout__top">
        <div className="pair-workspace-layout__column">{leftColumn}</div>
        <div className="pair-workspace-layout__column">{centerColumn}</div>
      </div>
    </div>
  );
}
