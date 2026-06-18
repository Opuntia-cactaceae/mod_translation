import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

/* ------------------------------------------------------------------ */
/*  Cleanup                                                            */
/* ------------------------------------------------------------------ */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockGetProviderModels = vi.fn();
const mockGetProviderModelsForProvider = vi.fn();
const mockCreateProviderModel = vi.fn();
const mockUpdateProviderModel = vi.fn();
const mockDeleteProviderModel = vi.fn();
const mockResetProviderModelDefaults = vi.fn();
const mockGetSettings = vi.fn();
const mockListApiKeys = vi.fn();
const mockGetTranslationOptions = vi.fn();
const mockGetGameOptions = vi.fn();
const mockGetProfiles = vi.fn();
const mockGetExportOptions = vi.fn();
const mockCreateExportPackage = vi.fn();
const mockPreviewImport = vi.fn();
const mockApplyImport = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../App', () => ({
  api: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    listApiKeys: (...args: unknown[]) => mockListApiKeys(...args),
    getTranslationOptions: (...args: unknown[]) => mockGetTranslationOptions(...args),
    getGameOptions: (...args: unknown[]) => mockGetGameOptions(...args),
    getProfiles: (...args: unknown[]) => mockGetProfiles(...args),
    getProviderModels: (...args: unknown[]) => mockGetProviderModels(...args),
    getProviderModelsForProvider: (...args: unknown[]) => mockGetProviderModelsForProvider(...args),
    createProviderModel: (...args: unknown[]) => mockCreateProviderModel(...args),
    updateProviderModel: (...args: unknown[]) => mockUpdateProviderModel(...args),
    deleteProviderModel: (...args: unknown[]) => mockDeleteProviderModel(...args),
    resetProviderModelDefaults: (...args: unknown[]) => mockResetProviderModelDefaults(...args),
    getExportOptions: (...args: unknown[]) => mockGetExportOptions(...args),
    createExportPackage: (...args: unknown[]) => mockCreateExportPackage(...args),
    previewImport: (...args: unknown[]) => mockPreviewImport(...args),
    applyImport: (...args: unknown[]) => mockApplyImport(...args),
  },
  ApiError: class MockApiError extends Error {
    code: string;
    details: Record<string, unknown>;
    recoverable: boolean;
    constructor(err: { code: string; message: string; details?: Record<string, unknown>; recoverable?: boolean }) {
      super(err.message);
      this.code = err.code;
      this.details = err.details ?? {};
      this.recoverable = err.recoverable ?? false;
    }
  },
  useToast: () => ({ showToast: vi.fn() }),
  ToastContext: {
    Provider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Consumer: ({ children }: { children: (value: unknown) => React.ReactNode }) => children({ showToast: vi.fn() }),
  },
}));

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makeProviderModelsResponse() {
  return {
    providers: {
      groq: {
        provider: 'groq',
        links: [{ title: 'Groq Supported Models', url: 'https://console.groq.com/docs/models' }],
        models: [
          { id: 'builtin-1', provider: 'groq', model_id: 'llama-3.3-70b-versatile', display_name: 'Llama 3.3 70B', tags: ['json'], is_enabled: true, is_builtin: true, sort_order: 10, context_window: 131072, max_output_tokens: null, description: null, created_at: null, updated_at: null },
          { id: 'builtin-2', provider: 'groq', model_id: 'llama-3.1-8b-instant', tags: [], is_enabled: false, is_builtin: true, sort_order: 20, context_window: null, max_output_tokens: null, description: null, display_name: null, created_at: null, updated_at: null },
          { id: 'custom-1', provider: 'groq', model_id: 'my-custom-model', display_name: 'My Model', tags: ['custom'], is_enabled: true, is_builtin: false, sort_order: 100, context_window: 4096, max_output_tokens: null, description: 'A custom model', created_at: null, updated_at: null },
        ],
      },
      deepseek: {
        provider: 'deepseek',
        links: [
          { title: 'DeepSeek Models & Pricing', url: 'https://api-docs.deepseek.com/quick_start/pricing' },
        ],
        models: [
          { id: 'ds-1', provider: 'deepseek', model_id: 'deepseek-chat', tags: [], is_enabled: true, is_builtin: true, sort_order: 10, context_window: null, max_output_tokens: null, description: null, display_name: null, created_at: null, updated_at: null },
        ],
      },
    },
  };
}

function makeSettingsResponse() {
  return { settings: { language: { default_src_lang: 'en' }, logging: { log_level: 'info' } } };
}

/* ------------------------------------------------------------------ */
/*  Render helper                                                      */
/* ------------------------------------------------------------------ */

async function renderSettings() {
  mockGetSettings.mockResolvedValue(makeSettingsResponse());
  mockListApiKeys.mockResolvedValue({ keys: [], total: 0 });
  mockGetTranslationOptions.mockResolvedValue({ providers: ['groq', 'deepseek'], prompt_profiles: [], protection_strategies: [], validators: [] });
  mockGetGameOptions.mockResolvedValue({ games: [], generic_file_handlers: [], all_file_handlers: [] });
  mockGetProfiles.mockResolvedValue([]);
  mockGetProviderModels.mockResolvedValue(makeProviderModelsResponse());
  mockGetExportOptions.mockResolvedValue({ rule_sets: [], translation_profiles: [], total: 0 });

  const Settings = (await import('../Settings')).default;
  return render(React.createElement(Settings));
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Settings - Provider Models section', () => {
  it('renders Provider Models section heading', async () => {
    await renderSettings();
    await waitFor(() => {
      expect(screen.getByText('Provider Models')).toBeTruthy();
    });
  });

  it('loads models from API and shows provider tabs', async () => {
    await renderSettings();
    await waitFor(() => {
      expect(screen.getByText('groq')).toBeTruthy();
      expect(screen.getByText('deepseek')).toBeTruthy();
    });
  });

  it('shows builtin badge for builtin models', async () => {
    await renderSettings();
    await waitFor(async () => {
      const badges = screen.getAllByText('builtin');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows model IDs in the list', async () => {
    await renderSettings();
    await waitFor(() => {
      expect(screen.getByText('llama-3.3-70b-versatile')).toBeTruthy();
    });
  });

  it('shows provider links', async () => {
    await renderSettings();
    await waitFor(() => {
      expect(screen.getByText(/Groq Supported Models/)).toBeTruthy();
    });
  });

  it('opens add model form when Add Model is clicked', async () => {
    await renderSettings();
    await waitFor(() => {
      expect(screen.getByText('Add Model')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Add Model'));
    await waitFor(() => {
      expect(screen.getByText(/Model ID/)).toBeTruthy();
      expect(screen.getByPlaceholderText('e.g. my-custom-model')).toBeTruthy();
    });
  });

  it('calls createProviderModel API when creating a model', async () => {
    mockCreateProviderModel.mockResolvedValue({
      id: 'new-id', provider: 'groq', model_id: 'new-test-model', is_enabled: true, is_builtin: false, tags: [], sort_order: 100,
    });
    mockGetProviderModels.mockResolvedValue(makeProviderModelsResponse());

    await renderSettings();
    await waitFor(() => { expect(screen.getByText('Add Model')).toBeTruthy(); });
    fireEvent.click(screen.getByText('Add Model'));

    await waitFor(() => { expect(screen.getByPlaceholderText('e.g. my-custom-model')).toBeTruthy(); });
    fireEvent.change(screen.getByPlaceholderText('e.g. my-custom-model'), { target: { value: 'new-test-model' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(mockCreateProviderModel).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'groq', model_id: 'new-test-model' }),
      );
    });
  });

  it('shows custom model in the list', async () => {
    await renderSettings();
    await waitFor(() => {
      expect(screen.getByText('my-custom-model')).toBeTruthy();
    });
  });

  it('has Delete button for custom models', async () => {
    await renderSettings();
    await waitFor(() => {
      const deleteBtns = screen.getAllByText('Delete');
      expect(deleteBtns.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('switches provider when provider tab is clicked', async () => {
    await renderSettings();
    // Wait for model data to load
    await screen.findByText('my-custom-model');
    // Get all buttons and find the one with text "deepseek"
    const allButtons = document.querySelectorAll('button');
    const deepseekTab = Array.from(allButtons).find(b => b.textContent?.trim() === 'deepseek');
    expect(deepseekTab).toBeTruthy();
    if (deepseekTab) fireEvent.click(deepseekTab);
    await waitFor(() => {
      expect(screen.getByText('deepseek-chat')).toBeTruthy();
    });
  });
});
