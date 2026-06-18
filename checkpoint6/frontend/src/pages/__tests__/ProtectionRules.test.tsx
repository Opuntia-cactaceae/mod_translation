import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ProtectionRules from '../ProtectionRules';
import { api, ApiError } from '../../App';
import { BUILTIN_RULE_SET_ID } from '../../constants';
import type { RuleValidationResponse } from '../../api/types';

// ------------------------------------------------------------------ //
//  Mocks
// ------------------------------------------------------------------ //

vi.mock('../../App', () => ({
  api: {
    getRuleSets: vi.fn(),
    getRuleSet: vi.fn(),
    createRuleSet: vi.fn(),
    updateRuleSet: vi.fn(),
    deleteRuleSet: vi.fn(),
    addRuleToSet: vi.fn(),
    updateRuleInSet: vi.fn(),
    deleteRuleFromSet: vi.fn(),
    getProtectionRules: vi.fn(),
    getProtectionProfiles: vi.fn(),
    updateProtectionRule: vi.fn(),
    deleteProtectionRule: vi.fn(),
    previewProtectionRule: vi.fn(),
    getProfileCandidates: vi.fn(),
    updateCandidateStatus: vi.fn(),
    createRulesFromCandidates: vi.fn(),
    createProtectionProfile: vi.fn(),
    deleteProtectionProfile: vi.fn(),
    validateProtectionRule: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code: string;
    details: Record<string, unknown>;
    constructor(err: { message: string; code: string; details: Record<string, unknown>; recoverable?: boolean }) {
      super(err.message);
      this.name = 'ApiError';
      this.code = err.code;
      this.details = err.details;
    }
  },
  useToast: () => ({ showToast: vi.fn(), toast: null }),
}));

// ------------------------------------------------------------------ //
//  Test data
// ------------------------------------------------------------------ //

const BUILTIN_RULE_SET = {
  id: BUILTIN_RULE_SET_ID,
  name: 'Default Game Localisation Protection',
  description: 'Built-in protection for Stellaris localisation tokens.',
  builtin: true,
  enabled: true,
  rule_count: 8,
  rules: [
    { id: 'r1', name: 'dollar_var', pattern: '\\$[A-Za-z0-9_]+\\$', token_type: 'dollar', rule_kind: 'atomic', enabled: true, priority: 100, description: '' },
    { id: 'r2', name: 'pound_icon', pattern: '£[A-Za-z0-9_]+£', token_type: 'pound', rule_kind: 'atomic', enabled: true, priority: 100, description: '' },
  ],
};

const CUSTOM_RULE_SET = {
  id: 'custom-1',
  name: 'My Custom Set',
  description: 'User-defined rules',
  builtin: false,
  enabled: true,
  rule_count: 2,
  rules: [
    { id: 'cr1', name: 'my_token', pattern: '%[A-Z]+%', token_type: 'custom_token', rule_kind: 'atomic', enabled: true, priority: 100, description: '' },
  ],
};

// ------------------------------------------------------------------ //
//  Helpers
// ------------------------------------------------------------------ //

function mockCleanInstall() {
  vi.mocked(api.getRuleSets).mockResolvedValue([BUILTIN_RULE_SET]);
  vi.mocked(api.getRuleSet).mockResolvedValue(BUILTIN_RULE_SET);
  vi.mocked(api.getProtectionRules).mockResolvedValue([]);
  vi.mocked(api.getProtectionProfiles).mockResolvedValue([]);
}

function mockWithCustomSet() {
  vi.mocked(api.getRuleSets).mockResolvedValue([BUILTIN_RULE_SET, CUSTOM_RULE_SET]);
  vi.mocked(api.getRuleSet).mockImplementation(async (id: string) => {
    if (id === BUILTIN_RULE_SET_ID) return BUILTIN_RULE_SET;
    if (id === 'custom-1') return CUSTOM_RULE_SET;
    throw new Error('not found');
  });
  vi.mocked(api.getProtectionRules).mockResolvedValue([]);
  vi.mocked(api.getProtectionProfiles).mockResolvedValue([]);
}

function mockEmptyInstall() {
  vi.mocked(api.getRuleSets).mockResolvedValue([]);
  vi.mocked(api.getProtectionRules).mockResolvedValue([]);
  vi.mocked(api.getProtectionProfiles).mockResolvedValue([]);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProtectionRules />
    </MemoryRouter>,
  );
}

// ------------------------------------------------------------------ //
//  Tests
// ------------------------------------------------------------------ //

describe('ProtectionRules — rule-set-centric UI', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('clean install shows builtin rule set', async () => {
    mockCleanInstall();
    renderPage();

    await screen.findByText('Default Game Localisation Protection');

    // No "No protection rules defined yet" (old empty state)
    expect(screen.queryByText('No protection rules defined yet')).toBeNull();
    // No "No rule sets defined" — builtin is present
    expect(screen.queryByText('No rule sets defined')).toBeNull();
  });

  it('builtin set has Built-in badge and rule count', async () => {
    mockCleanInstall();
    renderPage();

    await screen.findByText('Default Game Localisation Protection');

    // Badge appears at least once (in the card)
    const badges = screen.getAllByText('Built-in');
    expect(badges.length).toBeGreaterThanOrEqual(1);

    // Rule count shown
    const ruleCount = screen.getByText((content) => content.includes('8'));
    expect(ruleCount).toBeDefined();
  });

  it('builtin set appears in Rule Sets list, not in a separate section', async () => {
    mockCleanInstall();
    renderPage();

    await screen.findByText('Default Game Localisation Protection');

    // Should be inside "Rule Sets" card
    expect(screen.getByText('Rule Sets')).toBeDefined();
    // Should NOT have a separate heading like "Default Protection Rule Set"
    expect(screen.queryByText('Default Protection Rule Set')).toBeNull();
  });

  it('clicking View rules on builtin shows rules inline', async () => {
    mockCleanInstall();
    renderPage();

    await screen.findByText('Default Game Localisation Protection');

    // Rules not visible initially
    expect(screen.queryByText('dollar_var')).toBeNull();

    // Click "View rules"
    fireEvent.click(screen.getByText('View rules'));

    // Rules appear
    await screen.findByText('dollar_var');
    expect(screen.getByText('pound_icon')).toBeDefined();
  });

  it('builtin inline rules table has no edit/delete/add rule buttons', async () => {
    mockCleanInstall();
    renderPage();

    await screen.findByText('Default Game Localisation Protection');

    // Click "View rules" to expand
    fireEvent.click(screen.getByText('View rules'));
    await screen.findByText('dollar_var');

    // No "+ New Rule" anywhere on the page
    expect(screen.queryByText('+ New Rule')).toBeNull();
  });

  it('no global New Rule — primary action is New Rule Set', async () => {
    mockCleanInstall();
    renderPage();

    await screen.findByText('Default Game Localisation Protection');

    // Primary action: "+ New Rule Set"
    expect(screen.getByText('+ New Rule Set')).toBeDefined();
  });

  it('custom set has Edit/Delete, builtin has View rules', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('Default Game Localisation Protection');
    await screen.findByText('My Custom Set');

    // Builtin set has "View rules" button
    expect(screen.getByText('View rules')).toBeDefined();
    // Custom set actions
    expect(screen.getByText('Edit')).toBeDefined();
    expect(screen.getByText('Delete')).toBeDefined();
  });

  it('New Rule button appears when custom set is selected', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');

    // Click on the custom set to select it
    fireEvent.click(screen.getByText('My Custom Set'));

    await screen.findByText('+ New Rule');
  });

  it('creating a custom rule set calls the API', async () => {
    mockCleanInstall();
    vi.mocked(api.createRuleSet).mockResolvedValue(CUSTOM_RULE_SET);
    renderPage();

    await screen.findByText('Default Game Localisation Protection');

    // Open create form
    fireEvent.click(screen.getByText('+ New Rule Set'));

    const nameInput = await screen.findByPlaceholderText('e.g. My Custom Rules');
    await userEvent.type(nameInput, 'Test Set');

    // Submit
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(api.createRuleSet).toHaveBeenCalledWith({
        name: 'Test Set',
        description: '',
      });
    });
  });

  it('adding a rule to a custom set calls the API', async () => {
    mockWithCustomSet();
    renderPage();

    // Select custom set
    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));

    // Open add rule form
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    // Fill form
    await userEvent.type(screen.getByPlaceholderText('e.g. Protect colour codes'), 'Test Pattern');
    await userEvent.type(screen.getByPlaceholderText('e.g. §[A-Za-z]'), 'test_regex');

    // Submit
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(api.addRuleToSet).toHaveBeenCalledWith('custom-1', expect.objectContaining({
        name: 'Test Pattern',
        pattern: 'test_regex',
      }));
    });
  });

  it('deleting a custom rule set calls the API', async () => {
    mockWithCustomSet();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await screen.findByText('My Custom Set');

    // Find and click the Delete button for the custom set
    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(api.deleteRuleSet).toHaveBeenCalledWith('custom-1');
    });
  });

  it('enabled toggle on rule set calls update API', async () => {
    mockCleanInstall();
    renderPage();

    await screen.findByText('Default Game Localisation Protection');

    // The status "Enabled" text in the rule set card acts as a toggle
    const enabledTexts = screen.getAllByText('Enabled');
    fireEvent.click(enabledTexts[0]);

    await waitFor(() => {
      expect(api.updateRuleSet).toHaveBeenCalledWith(BUILTIN_RULE_SET_ID, { enabled: false });
    });
  });

  it('empty install shows empty state message', async () => {
    mockEmptyInstall();
    renderPage();

    await screen.findByText('No rule sets defined. Create one to get started.');

    // Should NOT show "No protection rules defined yet" (old empty state)
    expect(screen.queryByText('No protection rules defined yet')).toBeNull();
  });

  it('read-only message is NOT rendered on page', async () => {
    mockCleanInstall();
    renderPage();

    await screen.findByText('Default Game Localisation Protection');

    // The "Read-only. Built-in protection rules..." text from the old detail block
    // should NOT appear anywhere in the DOM
    const readOnlyTexts = screen.queryByText(/Read-only/);
    expect(readOnlyTexts).toBeNull();
  });

  it('clicking Hide rules collapses builtin rules', async () => {
    mockCleanInstall();
    renderPage();

    await screen.findByText('Default Game Localisation Protection');

    // Expand
    fireEvent.click(screen.getByText('View rules'));
    await screen.findByText('dollar_var');

    // Collapse
    fireEvent.click(screen.getByText('Hide rules'));
    await waitFor(() => {
      expect(screen.queryByText('dollar_var')).toBeNull();
    });
  });

  it('page is titled Protection Rule Sets', async () => {
    mockCleanInstall();
    renderPage();

    await screen.findByText('Protection Rule Sets');
  });

  // ------------------------------------------------------------------ //
  //  Rule kind selector tests
  // ------------------------------------------------------------------ //

  it('rule kind dropdown has all 4 options with labels', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    const select = screen.getByDisplayValue('Atomic') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.text);
    expect(options).toContain('Atomic');
    expect(options).toContain('Boundary');
    expect(options).toContain('Opaque Container');
    expect(options).toContain('Structured Container');
  });

  it('structured_container option is present in dropdown', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    const select = screen.getByDisplayValue('Atomic') as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.value)).toContain('structured_container');
  });

  it('changing rule_kind updates help text', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    // Default is Atomic — shows atomic description
    expect(screen.getByText(/Protect the whole match as one placeholder/)).toBeDefined();

    // Change to boundary
    const select = screen.getByDisplayValue('Atomic') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'boundary' } });

    // Boundary description appears
    expect(screen.getByText(/Protect only opener\/closer/)).toBeDefined();
    // Pattern hint for boundary mentions 3 capture groups
    expect(screen.getByText(/exactly 3 capture groups/)).toBeDefined();

    // Change to structured_container
    fireEvent.change(select, { target: { value: 'structured_container' } });

    // Structured description appears (use getAllByText since both description and pattern hint mention it)
    const structuredMatches = screen.getAllByText(/recursively/);
    expect(structuredMatches.length).toBeGreaterThanOrEqual(1);
    // Pattern hint for structured mentions 3 capture groups
    expect(screen.getByText(/exactly 3 capture groups/)).toBeDefined();

    // Change to opaque_container
    fireEvent.change(select, { target: { value: 'opaque_container' } });

    // Opaque description appears
    expect(screen.getByText(/hidden from translation/)).toBeDefined();
  });

  it('boundary and structured help text mentions 3 capture groups', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    const select = screen.getByDisplayValue('Atomic') as HTMLSelectElement;

    // Boundary pattern hint
    fireEvent.change(select, { target: { value: 'boundary' } });
    expect(screen.getByText(/exactly 3 capture groups/)).toBeDefined();

    // Structured pattern hint
    fireEvent.change(select, { target: { value: 'structured_container' } });
    expect(screen.getByText(/exactly 3 capture groups/)).toBeDefined();
  });

  it('example comparison renders on button click', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    // Initially hidden
    expect(screen.queryByText(/How each rule kind processes/)).toBeNull();

    // Click to show
    fireEvent.click(screen.getByText(/Show comparison example/));

    // Comparison table visible
    expect(screen.getByText(/How each rule kind processes/)).toBeDefined();
    expect(screen.getByText(/boundary does not protect inner tokens/)).toBeDefined();

    // Hide again
    fireEvent.click(screen.getByText(/Hide comparison example/));
    expect(screen.queryByText(/How each rule kind processes/)).toBeNull();
  });

  it('Validate Rule button triggers API call', async () => {
    mockWithCustomSet();
    vi.mocked(api.validateProtectionRule).mockResolvedValue({
      is_valid: true,
      diagnostics: [{ severity: 'info', code: 'VALID', message: 'Rule looks valid.' }],
    });

    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    // Fill in name and pattern (both required for client-side validation)
    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'My Test Rule' } });
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: '<[A-Z]+>' } });

    // Click validate
    fireEvent.click(screen.getByText('Validate Rule'));

    await waitFor(() => {
      expect(api.validateProtectionRule).toHaveBeenCalledWith(expect.objectContaining({
        pattern: '<[A-Z]+>',
        rule_kind: 'atomic',
        token_type: 'custom_token',
      }));
    });

    // Diagnostic shown
    await screen.findByText(/Rule looks valid/);
  });

  it('Validate Rule with empty Name shows inline error', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    // Fill in pattern but NOT name
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: '<[A-Z]+>' } });

    // Click validate
    fireEvent.click(screen.getByText('Validate Rule'));

    // Inline error should appear for Name
    await screen.findByText('Name is required.');
    // Backend should NOT be called
    expect(api.validateProtectionRule).not.toHaveBeenCalled();
  });

  it('Validate Rule with empty Regex Pattern shows inline error', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    // Fill in name but NOT pattern
    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'My Rule' } });

    // Click validate
    fireEvent.click(screen.getByText('Validate Rule'));

    // Inline error should appear for Pattern
    await screen.findByText('Regex pattern is required.');
    // Backend should NOT be called
    expect(api.validateProtectionRule).not.toHaveBeenCalled();
  });

  it('Validate Rule with invalid regex pattern shows inline error without backend call', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    // Fill in name and invalid regex
    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'My Rule' } });
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: '[invalid' } });

    // Click validate
    fireEvent.click(screen.getByText('Validate Rule'));

    // Inline error should appear for invalid regex
    await screen.findByText(/Invalid regex pattern/);
    // Backend should NOT be called
    expect(api.validateProtectionRule).not.toHaveBeenCalled();
  });

  it('button shows Validating... and is disabled during validation', async () => {
    mockWithCustomSet();
    let resolveValidation: (value: RuleValidationResponse) => void;
    const validationPromise = new Promise<RuleValidationResponse>(resolve => { resolveValidation = resolve; });
    vi.mocked(api.validateProtectionRule).mockReturnValue(validationPromise);

    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'My Rule' } });
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: '<[A-Z]+>' } });

    // Click validate
    fireEvent.click(screen.getByText('Validate Rule'));

    // Button text changed to Validating...
    await screen.findByText('Validating...');
    // Button is disabled
    expect(screen.getByText('Validating...')).toHaveProperty('disabled', true);

    // Resolve validation
    resolveValidation!({ is_valid: true, diagnostics: [] });
  });

  it('success feedback shown after successful validation', async () => {
    mockWithCustomSet();
    vi.mocked(api.validateProtectionRule).mockResolvedValue({
      is_valid: true,
      diagnostics: [],
    });

    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'My Rule' } });
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: '<[A-Z]+>' } });

    fireEvent.click(screen.getByText('Validate Rule'));

    // Success message appears
    await screen.findByText('Rule validation passed.');
  });

  it('backend error shows error feedback', async () => {
    mockWithCustomSet();
    vi.mocked(api.validateProtectionRule).mockRejectedValue(new Error('Invalid regex: bad pattern'));

    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'My Rule' } });
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: '<[A-Z]+>' } });

    fireEvent.click(screen.getByText('Validate Rule'));

    // Error message appears
    await screen.findByText(/Rule validation failed/);
  });

  it('changing pattern after success clears success feedback', async () => {
    mockWithCustomSet();
    vi.mocked(api.validateProtectionRule).mockResolvedValue({
      is_valid: true,
      diagnostics: [],
    });

    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'My Rule' } });
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: '<[A-Z]+>' } });

    fireEvent.click(screen.getByText('Validate Rule'));

    // Success message appears
    await screen.findByText('Rule validation passed.');

    // Change pattern
    fireEvent.change(patternInput, { target: { value: '<[B-Z]+>' } });

    // Success message disappears
    await waitFor(() => {
      expect(screen.queryByText('Rule validation passed.')).toBeNull();
    });
  });

  it('accepting candidate preserves rule_kind', async () => {
    mockWithCustomSet();
    // Mock a learned candidate with structured_container kind
    const candidate = {
      id: 'cand-1',
      profile_id: 'prof-1',
      text: 'TOOLTIP_MARKER',
      normalized_text: 'TOOLTIP_MARKER',
      suggested_pattern: '(pattern)(.*?)(pattern)',
      confidence: 'high',
      status: 'suggested' as const,
      occurrence_count: 5,
      sample_count: 3,
      max_probability: 0.9,
      avg_probability: 0.85,
      rule_kind: 'structured_container',
      token_type: 'html_tooltip',
      opener_pattern: '<tooltip>',
      closer_pattern: '</tooltip>',
      supporting_methods: ['shape'],
      features: {},
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    // Mock profile and candidates
    vi.mocked(api.getProtectionProfiles).mockResolvedValue([
      { id: 'prof-1', name: 'Test Profile', description: '', created_at: '', updated_at: '' },
    ]);
    vi.mocked(api.getProfileCandidates).mockResolvedValue({
      candidates: [candidate],
      total_count: 1,
    });
    vi.mocked(api.updateCandidateStatus).mockResolvedValue({
      ...candidate,
      status: 'accepted',
    });

    renderPage();

    // The Learning & Profiles section renders inline.
    // Profiles load automatically, so wait for the profile to appear.
    await screen.findByText('Test Profile');

    // Click on the profile name to select it and trigger candidate loading
    fireEvent.click(screen.getByText('Test Profile'));

    // Wait for candidate to appear
    await screen.findByText('TOOLTIP_MARKER');

    // Click "Accept" to pre-fill the rule form
    const acceptBtn = screen.getByText('Accept');
    fireEvent.click(acceptBtn);

    // The rule form should open with structured_container kind preserved
    await screen.findByText(/New Rule/);

    // The select should show "Structured Container"
    expect(screen.getByDisplayValue('Structured Container')).toBeDefined();
  });

  // ------------------------------------------------------------------ //
  //  Learning Profiles: Create, empty state, error clearing             //
  // ------------------------------------------------------------------ //

  it('creating a profile auto-selects it and triggers candidate load', async () => {
    mockCleanInstall();
    const newProfile = {
      id: 'prof-new',
      name: 'My New Profile',
      description: '',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };
    vi.mocked(api.getProtectionProfiles).mockResolvedValue([newProfile]);
    vi.mocked(api.createProtectionProfile).mockResolvedValue(newProfile);
    vi.mocked(api.getProfileCandidates).mockResolvedValue({ candidates: [], total_count: 0 });

    renderPage();

    await screen.findByText('+ Create Profile');
    fireEvent.click(screen.getByText('+ Create Profile'));

    const nameInput = await screen.findByPlaceholderText('e.g. Stellaris UI patterns');
    await userEvent.type(nameInput, 'My New Profile');
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(api.createProtectionProfile).toHaveBeenCalledWith({
        name: 'My New Profile',
        description: undefined,
      });
      // Candidate view should have loaded for the new profile
      expect(api.getProfileCandidates).toHaveBeenCalledWith('prof-new', undefined);
    });
  });

  it('profile with no candidates shows empty state, not error', async () => {
    mockCleanInstall();
    const profile = {
      id: 'prof-empty',
      name: 'Empty Profile',
      description: '',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };
    vi.mocked(api.getProtectionProfiles).mockResolvedValue([profile]);
    vi.mocked(api.getProfileCandidates).mockResolvedValue({ candidates: [], total_count: 0 });

    renderPage();

    // Wait for profile to render, then select it
    const profileEl = await screen.findByText('Empty Profile');
    fireEvent.click(profileEl);

    // The empty state should appear, not an error
    await screen.findByText('No candidates yet. Use the Pairing Workspace to learn from file pairs.');

    // No error alert
    expect(screen.queryByText(/Failed to load candidates/)).toBeNull();
  });

  it('switching profiles clears stale candidate errors', async () => {
    mockCleanInstall();
    const profileA = {
      id: 'prof-a',
      name: 'Profile A',
      description: '',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };
    const profileB = {
      id: 'prof-b',
      name: 'Profile B',
      description: '',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    vi.mocked(api.getProtectionProfiles).mockResolvedValue([profileA, profileB]);
    // First call fails (for profile A), second succeeds (for profile B)
    vi.mocked(api.getProfileCandidates)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ candidates: [], total_count: 0 });

    renderPage();

    // Click Profile A — will fail
    const profileAEl = await screen.findByText('Profile A');
    fireEvent.click(profileAEl);

    // Wait for error to appear
    await screen.findByText('Failed to load candidates');

    // Click Profile B — should clear the error
    const profileBEl = await screen.findByText('Profile B');
    fireEvent.click(profileBEl);

    // Empty state should appear for Profile B
    await screen.findByText('No candidates yet. Use the Pairing Workspace to learn from file pairs.');

    // Error should be gone
    expect(screen.queryByText('Failed to load candidates')).toBeNull();
  });

  // ------------------------------------------------------------------ //
  //  Pairing Workspace CTA                                              //
  // ------------------------------------------------------------------ //

  it('shows Pairing Workspace CTA when a profile is selected', async () => {
    mockCleanInstall();
    const profile = {
      id: 'prof-cta',
      name: 'CTA Profile',
      description: '',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };
    vi.mocked(api.getProtectionProfiles).mockResolvedValue([profile]);
    vi.mocked(api.getProfileCandidates).mockResolvedValue({ candidates: [], total_count: 0 });

    renderPage();

    const profileEl = await screen.findByText('CTA Profile');
    fireEvent.click(profileEl);

    await screen.findByText('Pairing Workspace');

    const ctaLink = screen.getByText('Go to Pairing Workspace');
    expect(ctaLink).toBeDefined();
    expect(ctaLink.closest('a')?.getAttribute('href')).toBe('/pairing-projects');
  });

  it('convention profile _pairs_<id> links to pairing-projects with project param', async () => {
    mockCleanInstall();
    const profile = {
      id: 'prof-pair',
      name: '_pairs_proj-42',
      description: '',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };
    vi.mocked(api.getProtectionProfiles).mockResolvedValue([profile]);
    vi.mocked(api.getProfileCandidates).mockResolvedValue({ candidates: [], total_count: 0 });

    renderPage();

    const profileEl = await screen.findByText('_pairs_proj-42');
    fireEvent.click(profileEl);

    await screen.findByText('Pairing Workspace');

    const ctaLink = screen.getByText('Go to Pairing Workspace');
    expect(ctaLink.closest('a')?.getAttribute('href')).toBe('/pairing-projects?project=proj-42');
  });

  it('does not show Manual Samples or Files labels', async () => {
    mockCleanInstall();
    renderPage();

    await screen.findByText('Default Game Localisation Protection');

    expect(screen.queryByText('Manual Samples')).toBeNull();
    expect(screen.queryByText('Analyze Samples / Suggestions')).toBeNull();
  });

  // ------------------------------------------------------------------ //
  //  Bug #1: Token Type field can be cleared                           //
  // ------------------------------------------------------------------ //

  it('token type field can be fully cleared (Bug #1)', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    // Token type input has placeholder "custom_token"
    const tokenInput = screen.getByPlaceholderText('custom_token') as HTMLInputElement;

    // Initially it should show 'custom_token' (the default from DEFAULT_RULE_IN_SET_FORM)
    expect(tokenInput.value).toBe('custom_token');

    // Clear the field entirely
    fireEvent.change(tokenInput, { target: { value: '' } });

    // After clearing, the value should be empty string — NOT restored to 'custom_token'
    expect(tokenInput.value).toBe('');

    // Type a new value from scratch
    fireEvent.change(tokenInput, { target: { value: 'my_new_token' } });
    expect(tokenInput.value).toBe('my_new_token');
  });

  // ------------------------------------------------------------------ //
  //  Bug #2: Save validates all fields and shows per-field errors       //
  // ------------------------------------------------------------------ //

  it('save with empty required fields shows all field errors (Bug #2)', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    // Click Create without filling anything (token_type default is 'custom_token'
    // so it won't be empty — clear it first)
    const tokenInput = screen.getByPlaceholderText('custom_token') as HTMLInputElement;
    fireEvent.change(tokenInput, { target: { value: '' } });

    // Click save
    fireEvent.click(screen.getByText('Create'));

    // All required field errors should appear
    await screen.findByText('Name is required.');
    await screen.findByText('Regex pattern is required.');
    await screen.findByText('Token type is required.');

    // Form should still be open (not submitted)
    expect(screen.getByText(/New Rule in "My Custom Set"/)).toBeDefined();

    // Backend should NOT be called
    expect(api.addRuleToSet).not.toHaveBeenCalled();
  });

  it('save with invalid regex pattern shows inline error', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    // Fill valid name and invalid pattern
    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'My Rule' } });
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: '[invalid' } });

    // Click save
    fireEvent.click(screen.getByText('Create'));

    // Pattern error should appear
    await screen.findByText(/Invalid regex pattern/);

    // Backend should NOT be called
    expect(api.addRuleToSet).not.toHaveBeenCalled();
  });

  it('save with empty token type shows field error', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    // Fill valid name and pattern
    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'My Rule' } });
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: '<[A-Z]+>' } });

    // Clear token type
    const tokenInput = screen.getByPlaceholderText('custom_token') as HTMLInputElement;
    fireEvent.change(tokenInput, { target: { value: '' } });

    // Click save
    fireEvent.click(screen.getByText('Create'));

    // Token type error should appear
    await screen.findByText('Token type is required.');

    // Backend should NOT be called
    expect(api.addRuleToSet).not.toHaveBeenCalled();
  });

  it('save error from API shows error message and field errors', async () => {
    mockWithCustomSet();
    vi.mocked(api.addRuleToSet).mockRejectedValue(
      new ApiError({
        message: 'Rule name already exists in this set',
        code: 'RULE_NAME_CONFLICT',
        details: { name: 'A rule with this name already exists.' },
        recoverable: false,
      }),
    );

    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    // Fill valid form
    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'My Rule' } });
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: '<[A-Z]+>' } });

    // Click save
    fireEvent.click(screen.getByText('Create'));

    // Error message should appear
    await screen.findByText('Rule name already exists in this set');

    // Field-level error should appear for name
    await screen.findByText('A rule with this name already exists.');

    // Form should still be open
    expect(screen.getByText(/New Rule in "My Custom Set"/)).toBeDefined();
  });

  // ------------------------------------------------------------------ //
  //  Priority Field Tests                                              //
  // ------------------------------------------------------------------ //

  it('shows Priority field in create rule form', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    // Priority label and input should be visible (label text appears in both table and form, use getAllByText)
    const priorityLabels = screen.getAllByText('Priority');
    expect(priorityLabels.length).toBeGreaterThanOrEqual(1);
    const priorityInput = screen.getByPlaceholderText('100') as HTMLInputElement;
    expect(priorityInput).toBeDefined();
    expect(priorityInput.type).toBe('number');
  });

  it('shows Priority field populated when editing a rule', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));

    // Wait for rules to appear in the selected set details
    await screen.findByText('my_token');

    // Click the rule's Edit button — need to distinguish from the rule set card Edit button
    // The rule set card has one Edit button, and each rule row has one
    const allEditButtons = screen.getAllByText('Edit');
    // Click the LAST Edit button (rules table Edit comes after the card Edit in DOM)
    fireEvent.click(allEditButtons[allEditButtons.length - 1]);

    await screen.findByText(/Edit Rule in "My Custom Set"/);

    // Priority input should show the existing rule's priority value
    const priorityInput = screen.getByPlaceholderText('100') as HTMLInputElement;
    expect(priorityInput).toBeDefined();
    expect(Number(priorityInput.value)).toBe(100);
  });

  it('user can change the priority value', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    const priorityInput = screen.getByPlaceholderText('100') as HTMLInputElement;
    fireEvent.change(priorityInput, { target: { value: '50' } });

    expect(priorityInput.value).toBe('50');
  });

  it('changed priority is included in API payload on save', async () => {
    mockWithCustomSet();
    vi.mocked(api.addRuleToSet).mockResolvedValue({
      id: 'new-rule',
      name: 'Priority Test',
      pattern: 'test_pattern',
      rule_kind: 'atomic',
      token_type: 'custom_token',
      enabled: true,
      priority: 50,
    });

    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    // Fill required fields
    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'Priority Test' } });
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: 'test_pattern' } });

    // Change priority
    const priorityInput = screen.getByPlaceholderText('100') as HTMLInputElement;
    fireEvent.change(priorityInput, { target: { value: '50' } });

    // Submit
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(api.addRuleToSet).toHaveBeenCalledWith('custom-1', expect.objectContaining({
        name: 'Priority Test',
        pattern: 'test_pattern',
        priority: 50,
      }));
    });
  });

  it('invalid priority shows field error on save', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    // Fill required fields
    const nameInput = screen.getByPlaceholderText('e.g. Protect colour codes');
    fireEvent.change(nameInput, { target: { value: 'My Rule' } });
    const patternInput = screen.getByPlaceholderText('e.g. §[A-Za-z]');
    fireEvent.change(patternInput, { target: { value: '<[A-Z]+>' } });

    // Set negative priority
    const priorityInput = screen.getByPlaceholderText('100') as HTMLInputElement;
    fireEvent.change(priorityInput, { target: { value: '-5' } });

    // Click save
    fireEvent.click(screen.getByText('Create'));

    // Priority error should appear
    await screen.findByText('Priority must be 0 or greater.');

    // API should NOT be called
    expect(api.addRuleToSet).not.toHaveBeenCalled();
  });

  it('priority help text is displayed next to the field', async () => {
    mockWithCustomSet();
    renderPage();

    await screen.findByText('My Custom Set');
    fireEvent.click(screen.getByText('My Custom Set'));
    await screen.findByText('+ New Rule');
    fireEvent.click(screen.getByText('+ New Rule'));

    await screen.findByText(/New Rule in "My Custom Set"/);

    // Help text explaining priority should be visible
    expect(screen.getByText(/Priority determines rule evaluation order/)).toBeDefined();
    expect(screen.getByText(/Lower values are evaluated first/)).toBeDefined();
    expect(screen.getByText(/Examples:/)).toBeDefined();
  });
});
