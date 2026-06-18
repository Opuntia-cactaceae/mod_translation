/* ------------------------------------------------------------------ */
/*  PairLearningPanel — Workspace-aware wrapper around LearnDialog     */
/*                                                                      */
/*  Thin pass-through — just bridges the props.                        */
/* ------------------------------------------------------------------ */

import LearnDialog from '../LearnDialog';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface PairLearningPanelProps {
  open: boolean;
  projectId: string;
  hasLearnablePairs: boolean;
  manualPairCount?: number;
  acceptedPairCount?: number;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PairLearningPanel({
  open,
  projectId,
  hasLearnablePairs,
  manualPairCount = 0,
  acceptedPairCount = 0,
  onClose,
}: PairLearningPanelProps) {
  return (
    <LearnDialog
      open={open}
      projectId={projectId}
      hasLearnablePairs={hasLearnablePairs}
      manualPairCount={manualPairCount}
      acceptedPairCount={acceptedPairCount}
      onClose={onClose}
    />
  );
}
