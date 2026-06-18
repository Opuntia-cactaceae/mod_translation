import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import LearnDialog from '../LearnDialog';
import { api } from '../../../App';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

const LEARN_RESULT = {
  profile_id: 'auto-prof-1',
  samples_collected: 42,
  samples_added: 40,
  candidates_new: 10,
  candidates_updated: 3,
  total_candidates: 13,
  files_processed: 8,
  normalized_pairs_used: 0,
  raw_pairs_used: 5,
  error: null,
};

const PROFILES = [
  { id: 'prof-1', name: 'My Protection Profile', description: '', game_id: null, mod_id: null, created_at: '', updated_at: '' },
  { id: 'prof-2', name: 'Stellaris EN', description: '', game_id: null, mod_id: null, created_at: '', updated_at: '' },
];

const LEARN_RESULT_WITH_WARNING = {
  profile_id: 'auto-prof-1',
  samples_collected: 42,
  samples_added: 40,
  candidates_new: 10,
  candidates_updated: 3,
  total_candidates: 13,
  files_processed: 8,
  normalized_pairs_used: 0,
  raw_pairs_used: 5,
  error: 'Some files were skipped due to encoding issues',
};

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../../../App', () => ({
  api: {
    learnFromPairingPairs: vi.fn(),
    getProtectionProfiles: vi.fn().mockResolvedValue([]),
  },
  ApiError: class ApiError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ApiError'; }
  },
  useToast: () => ({ showToast: vi.fn() }),
}));

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

describe('LearnDialog', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  /* ---- Test 1: renders null when open=false ---- */
  it('renders null when open is false', () => {
    const { container } = render(
      <LearnDialog open={false} projectId="proj-1" hasLearnablePairs={true} onClose={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  /* ---- Test 2: renders checkboxes and Learn button ---- */
  it('renders checkboxes and Learn button', async () => {
    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={true} onClose={vi.fn()} />
    );

    // Wait for dialog to render
    await screen.findByText('Learn from Pairs');

    // Checkboxes should be rendered (use getAllByRole since checkboxes are inside nested labels)
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(3);

    // No Translation Profile selector should be present
    expect(screen.queryByLabelText('Translation Profile')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();

    // Learn button should be present
    expect(screen.getByText('Learn')).toBeDefined();
  });

  /* ---- Test 3: learn button calls API with correct options ---- */
  it('calls learnFromPairingPairs with correct options (no profile_id)', async () => {
    vi.mocked(api.learnFromPairingPairs).mockResolvedValue(LEARN_RESULT);

    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={true} manualPairCount={2} acceptedPairCount={1} onClose={vi.fn()} />
    );

    // Wait for dialog to render
    await screen.findByText('Learn');

    // Ensure default states (checkbox 0 = Include manual pairs, 1 = Include accepted pairs, 2 = Use alignment)
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(true);
    expect(checkboxes[2].checked).toBe(false);

    // Click Learn
    fireEvent.click(screen.getByText('Learn'));

    await waitFor(() => {
      expect(api.learnFromPairingPairs).toHaveBeenCalledWith('proj-1', {
        include_accepted_pairs: true,
        include_manual_pairs: true,
        use_alignment: false,
      });
    });

    // Verify payload does NOT contain profile_id
    const payload = vi.mocked(api.learnFromPairingPairs).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload).not.toHaveProperty('profile_id');
  });

  /* ---- Test 4: shows result summary after learning ---- */
  it('shows result summary after learning', async () => {
    vi.mocked(api.learnFromPairingPairs).mockResolvedValue(LEARN_RESULT);

    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={true} manualPairCount={2} acceptedPairCount={1} onClose={vi.fn()} />
    );

    // Wait for dialog to render
    await screen.findByText('Learn');

    // Click Learn
    fireEvent.click(screen.getByText('Learn'));

    // Wait for result summary to appear
    await screen.findByText('Samples collected');

    // Verify summary table values
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('40')).toBeDefined();
    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('13')).toBeDefined();
    expect(screen.getByText('8')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined(); // raw_pairs_used
    expect(screen.getByText('0')).toBeDefined(); // normalized_pairs_used (also matches other 0s)
  });

  it('shows normalized_pairs_used and raw_pairs_used labels in result summary', async () => {
    const resultWithNormalized = {
      ...LEARN_RESULT,
      normalized_pairs_used: 3,
      raw_pairs_used: 2,
    };
    vi.mocked(api.learnFromPairingPairs).mockResolvedValue(resultWithNormalized);

    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={true} manualPairCount={2} acceptedPairCount={1} onClose={vi.fn()} />
    );

    await screen.findByText('Learn');
    fireEvent.click(screen.getByText('Learn'));

    await screen.findByText('Normalised pairs used');
    expect(screen.getByText('Normalised pairs used')).toBeDefined();
    expect(screen.getByText('Raw pairs used')).toBeDefined();
  });

  /* ---- Test 5: shows warning when result contains error field ---- */
  it('shows warning when result error field is set', async () => {
    vi.mocked(api.learnFromPairingPairs).mockResolvedValue(LEARN_RESULT_WITH_WARNING);

    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={true} manualPairCount={2} acceptedPairCount={1} onClose={vi.fn()} />
    );

    await screen.findByText('Learn');
    fireEvent.click(screen.getByText('Learn'));

    // Wait for the warning to appear
    await screen.findByText('Some files were skipped due to encoding issues');
    const alert = screen.getByText('Some files were skipped due to encoding issues');
    expect(alert.className).toContain('alert-warning');
  });

  /* ---- Test 6: close button calls onClose ---- */
  it('calls onClose when close button is clicked', async () => {
    vi.mocked(api.learnFromPairingPairs).mockResolvedValue(LEARN_RESULT);

    const onClose = vi.fn();

    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={true} onClose={onClose} />
    );

    // Wait for dialog to render
    await screen.findByText('Learn from Pairs');

    // Click the Close button in the footer
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /* ---- Test 7: overlay click calls onClose ---- */
  it('calls onClose when overlay is clicked', async () => {
    vi.mocked(api.learnFromPairingPairs).mockResolvedValue(LEARN_RESULT);

    const onClose = vi.fn();

    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={true} onClose={onClose} />
    );

    await screen.findByText('Learn from Pairs');

    // Click on the overlay (the outermost div)
    const overlay = document.querySelector('.modal-overlay');
    expect(overlay).not.toBeNull();

    // Simulate clicking the overlay background
    fireEvent.pointerDown(overlay!);
    // onPointerDown handler checks e.target === e.currentTarget
    // Since we're clicking the overlay directly, this should trigger
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /* ---- Test 8: learn button is disabled while learning ---- */
  it('disables learn button while learning is in progress', async () => {
    vi.mocked(api.learnFromPairingPairs).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={true} manualPairCount={2} acceptedPairCount={1} onClose={vi.fn()} />
    );

    await screen.findByText('Learn');

    // Click Learn
    fireEvent.click(screen.getByText('Learn'));

    // Button text changes to "Learning..."
    const learnBtn = await screen.findByText('Learning...');
    expect(learnBtn).toBeDefined();
    expect((learnBtn as HTMLButtonElement).disabled).toBe(true);
  });

  /* ---- Test 10: shows profile selector when profiles exist ---- */
  it('shows profile selector when api returns profiles', async () => {
    vi.mocked(api.getProtectionProfiles).mockResolvedValue(PROFILES);

    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={true} onClose={vi.fn()} />
    );

    // Wait for profiles to load and selector to appear
    await screen.findByText('Protection Profile');

    // The dropdown should contain the profiles
    expect(screen.getByText('My Protection Profile')).toBeDefined();
    expect(screen.getByText('Stellaris EN')).toBeDefined();
    // "Auto-create new" appears in both the option and summary card
    const autoCreateTexts = screen.getAllByText('Auto-create new');
    expect(autoCreateTexts.length).toBeGreaterThanOrEqual(1);
  });

  /* ---- Test 11: selecting a profile sends profile_id ---- */
  it('sends profile_id when a profile is selected', async () => {
    vi.mocked(api.getProtectionProfiles).mockResolvedValue(PROFILES);
    vi.mocked(api.learnFromPairingPairs).mockResolvedValue(LEARN_RESULT);

    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={true} manualPairCount={2} acceptedPairCount={1} onClose={vi.fn()} />
    );

    // Wait for profile selector to appear
    await screen.findByText('Protection Profile');

    // Select a profile
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'prof-1' } });
    expect(select.value).toBe('prof-1');

    // Click Learn
    fireEvent.click(screen.getByText('Learn'));

    await waitFor(() => {
      expect(api.learnFromPairingPairs).toHaveBeenCalledWith('proj-1', {
        profile_id: 'prof-1',
        include_accepted_pairs: true,
        include_manual_pairs: true,
        use_alignment: false,
      });
    });
  });

  /* ---- Test 12: no profile_id sent when auto-create is selected ---- */
  it('does not send profile_id when auto-create option is selected', async () => {
    vi.mocked(api.getProtectionProfiles).mockResolvedValue(PROFILES);
    vi.mocked(api.learnFromPairingPairs).mockResolvedValue(LEARN_RESULT);

    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={true} manualPairCount={2} acceptedPairCount={1} onClose={vi.fn()} />
    );

    // Wait for profile selector to appear
    await screen.findByText('Protection Profile');

    // Default is Auto-create new (empty value), no need to change

    // Click Learn
    fireEvent.click(screen.getByText('Learn'));

    await waitFor(() => {
      expect(api.learnFromPairingPairs).toHaveBeenCalledWith('proj-1', {
        include_accepted_pairs: true,
        include_manual_pairs: true,
        use_alignment: false,
      });
    });

    // Verify profile_id is NOT in the payload
    const payload = vi.mocked(api.learnFromPairingPairs).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload).not.toHaveProperty('profile_id');
  });

  /* ---- Test 9: learn button is disabled when no learnable pairs ---- */
  it('disables learn button when no learnable pairs', async () => {
    render(
      <LearnDialog open={true} projectId="proj-1" hasLearnablePairs={false} onClose={vi.fn()} />
    );

    await screen.findByText('Learn');

    const learnBtn = screen.getByText('Learn');
    expect((learnBtn as HTMLButtonElement).disabled).toBe(true);

    // Warning about no pairs should be shown
    expect(screen.getByText('No manual or accepted pairs available. Create pairs and accept them to enable learning.')).toBeDefined();
  });

  // ------------------------------------------------------------------ //
  //  Part 3/4: Pair count & eligibility tests                           //
  // ------------------------------------------------------------------ //

  it('shows manual pair count badge when manualPairCount > 0', async () => {
    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={5}
        acceptedPairCount={0}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn from Pairs');

    // Badge should show count
    expect(screen.getByText('5 available')).toBeDefined();

    // No empty-state message when manual pairs are available
    expect(screen.queryByText('No accepted or manual pairs available to learn from.')).toBeNull();
  });

  it('shows accepted pair count badge when acceptedPairCount > 0', async () => {
    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={0}
        acceptedPairCount={3}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn from Pairs');

    expect(screen.getByText('3 available')).toBeDefined();
  });

  it('learn button disabled when both counts are zero (no learnable pairs)', async () => {
    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={false}
        manualPairCount={0}
        acceptedPairCount={0}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn from Pairs');

    // Empty state should appear
    expect(screen.getByText('No learnable pairs')).toBeDefined();

    // Learn button should be disabled
    const learnBtn = screen.getByText('Learn');
    expect((learnBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('learn button disabled when both pair types unchecked', async () => {
    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={5}
        acceptedPairCount={3}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn from Pairs');

    // Uncheck both using getByRole for checkbox elements
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // Include manual pairs
    fireEvent.click(checkboxes[1]); // Include accepted pairs

    // Learn button should be disabled
    const learnBtn = screen.getByText('Learn');
    expect((learnBtn as HTMLButtonElement).disabled).toBe(true);

    // Hint text should appear
    expect(screen.getByText('At least one pair type must be selected.')).toBeDefined();
  });

  it('learn button enabled when manual pairs checked and manualPairCount > 0', async () => {
    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={5}
        acceptedPairCount={0}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn from Pairs');

    const learnBtn = screen.getByText('Learn');
    expect((learnBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('learn button enabled when accepted pairs checked and acceptedPairCount > 0', async () => {
    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={0}
        acceptedPairCount={3}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn from Pairs');

    const learnBtn = screen.getByText('Learn');
    expect((learnBtn as HTMLButtonElement).disabled).toBe(false);
  });

  // ------------------------------------------------------------------ //
  //  Pair type mismatch: selected type has 0 pairs                      //
  // ------------------------------------------------------------------ //

  it('disabled when manual unchecked, accepted selected but acceptedPairCount=0', async () => {
    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={10}
        acceptedPairCount={0}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn from Pairs');

    // Uncheck Include manual pairs (checked by default)
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // toggle manual off

    // Keep accepted checked — but acceptedPairCount is 0
    // So Learn should be disabled
    const learnBtn = screen.getByText('Learn');
    expect((learnBtn as HTMLButtonElement).disabled).toBe(true);

    // A meaningful hint should explain why
    expect(screen.getByText('Accepted pairs selected but none are available.')).toBeDefined();
  });

  it('disabled when accepted unchecked, manual selected but manualPairCount=0', async () => {
    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={0}
        acceptedPairCount={10}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn from Pairs');

    // Uncheck Include accepted pairs (checked by default)
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // toggle accepted off

    // Keep manual checked — but manualPairCount is 0
    const learnBtn = screen.getByText('Learn');
    expect((learnBtn as HTMLButtonElement).disabled).toBe(true);

    expect(screen.getByText('Manual pairs selected but none are available.')).toBeDefined();
  });

  it('enabled when manual unchecked, accepted selected and acceptedPairCount>0', async () => {
    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={10}
        acceptedPairCount={5}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn from Pairs');

    // Uncheck manual, keep accepted
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // toggle manual off

    const learnBtn = screen.getByText('Learn');
    expect((learnBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('enabled when accepted unchecked, manual selected and manualPairCount>0', async () => {
    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={5}
        acceptedPairCount={10}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn from Pairs');

    // Uncheck accepted, keep manual
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // toggle accepted off

    const learnBtn = screen.getByText('Learn');
    expect((learnBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('summary card shows manual and accepted pair counts correctly', async () => {
    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={5}
        acceptedPairCount={3}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn from Pairs');

    // Summary card should contain counts
    expect(screen.getByText(/5 included/)).toBeDefined();
    expect(screen.getByText(/3 included/)).toBeDefined();
  });

  // ------------------------------------------------------------------ //
  //  Convention _pairs_{projectId} profile auto-select                  //
  // ------------------------------------------------------------------ //

  it('auto-selects profile named _pairs_proj-1 when it exists', async () => {
    const pairingProfiles = [
      { id: 'prof-pair', name: '_pairs_proj-1', description: '', game_id: null, mod_id: null, created_at: '', updated_at: '' },
      { id: 'prof-other', name: 'Other Profile', description: '', game_id: null, mod_id: null, created_at: '', updated_at: '' },
    ];
    vi.mocked(api.getProtectionProfiles).mockResolvedValue(pairingProfiles);

    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={2}
        acceptedPairCount={1}
        onClose={vi.fn()}
      />
    );

    // Wait for profile selector
    await screen.findByText('Protection Profile');

    // The select should show the pairing profile name
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('prof-pair');
  });

  // ------------------------------------------------------------------ //
  //  Post-learning: Review Candidates button navigation                 //
  // ------------------------------------------------------------------ //

  it('Review Candidates button navigates to /protection-rules?profile=<id>', async () => {
    mockNavigate.mockClear();

    vi.mocked(api.learnFromPairingPairs).mockResolvedValue(LEARN_RESULT);

    render(
      <LearnDialog
        open={true}
        projectId="proj-1"
        hasLearnablePairs={true}
        manualPairCount={2}
        acceptedPairCount={1}
        onClose={vi.fn()}
      />
    );

    await screen.findByText('Learn');

    // Click Learn to get result
    fireEvent.click(screen.getByText('Learn'));
    await screen.findByText('Samples collected');

    // Click Review Candidates
    fireEvent.click(screen.getByText('Review Candidates'));

    expect(mockNavigate).toHaveBeenCalledWith('/protection-rules?profile=auto-prof-1');
  });
});
