import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  render, screen, fireEvent, cleanup, waitFor, act,
} from '@testing-library/react';
import ModelDropdown from '../ModelDropdown';
import type { ProviderGroup, ProviderModelEntry } from '../../../api/types';

// ------------------------------------------------------------------ //
//  Mock the App module to provide a fake api                          //
// ------------------------------------------------------------------ //

const mockModels: ProviderModelEntry[] = [
  {
    id: 'm1',
    provider: 'groq',
    model_id: 'llama-3.3-70b-versatile',
    display_name: 'Llama 3.3 70B',
    is_enabled: true,
    is_builtin: true,
    tags: [],
    sort_order: 100,
  },
  {
    id: 'm2',
    provider: 'groq',
    model_id: 'whisper-large-v3',
    display_name: null,
    is_enabled: true,
    is_builtin: true,
    tags: [],
    sort_order: 200,
  },
];

const mockGroup: ProviderGroup = {
  provider: 'groq',
  links: [],
  models: mockModels,
};

const deepseekGroup: ProviderGroup = {
  provider: 'deepseek',
  links: [],
  models: [
    {
      id: 'd1',
      provider: 'deepseek',
      model_id: 'deepseek-chat',
      display_name: 'DeepSeek Chat',
      is_enabled: true,
      is_builtin: true,
      tags: [],
      sort_order: 100,
    },
  ],
};

const { getProviderModelsForProvider } = vi.hoisted(() => ({
  getProviderModelsForProvider: vi.fn(),
}));

vi.mock('../../../App', () => ({
  api: {
    getProviderModelsForProvider,
  },
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, status: number, message: string) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

function getSelect() {
  return screen.getByRole('combobox');
}

function selectOption(select: HTMLElement, value: string) {
  fireEvent.change(select, { target: { value } });
}

// ------------------------------------------------------------------ //
//  Tests                                                              //
// ------------------------------------------------------------------ //

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  getProviderModelsForProvider.mockResolvedValue(mockGroup);
});

describe('ModelDropdown — selectionMode behavior', () => {
  // ------------------------------------------------------------------ //
  //  1. selecting dropdown model sets mode=saved (default behavior)     //
  // ------------------------------------------------------------------ //
  it('selecting a dropdown model calls onChange with model_id', async () => {
    const onChange = vi.fn();
    render(
      <ModelDropdown provider="groq" value="" onChange={onChange} />,
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    const select = getSelect();
    selectOption(select, 'llama-3.3-70b-versatile');
    expect(onChange).toHaveBeenCalledWith('llama-3.3-70b-versatile');
  });

  // ------------------------------------------------------------------ //
  //  2. entering custom model via Other… sets mode to custom            //
  // ------------------------------------------------------------------ //
  it('choosing Other… reveals custom input and typing calls onChange', async () => {
    const onChange = vi.fn();
    render(
      <ModelDropdown provider="groq" value="" onChange={onChange} />,
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    // Select "Other / Custom…"
    const select = getSelect();
    selectOption(select, '__other__');

    // Custom input should appear
    const customInput = screen.getByPlaceholderText(/enter model id manually/i);
    expect(customInput).toBeTruthy();

    // Type a custom model name
    fireEvent.change(customInput, { target: { value: 'my-custom-model' } });
    expect(onChange).toHaveBeenCalledWith('my-custom-model');
  });

  // ------------------------------------------------------------------ //
  //  3. provider change clears saved model                              //
  // ------------------------------------------------------------------ //
  it('provider change clears model when mode is saved', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModelDropdown provider="groq" value="llama-3.3-70b-versatile" onChange={onChange} />,
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    // Rerender with different provider
    getProviderModelsForProvider.mockResolvedValue({
      provider: 'deepseek',
      links: [],
      models: [
        {
          id: 'd1',
          provider: 'deepseek',
          model_id: 'deepseek-chat',
          display_name: 'DeepSeek Chat',
          is_enabled: true,
          is_builtin: true,
          tags: [],
          sort_order: 100,
        },
      ],
    });

    onChange.mockClear();
    rerender(
      <ModelDropdown provider="deepseek" value="" onChange={onChange} />,
    );

    // onChange should have been called with '' (cleared)
    expect(onChange).toHaveBeenCalledWith('');
  });

  // ------------------------------------------------------------------ //
  //  4. provider change preserves custom model                          //
  // ------------------------------------------------------------------ //
  it('provider change preserves model when mode is custom', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModelDropdown
        provider="groq"
        value="my-custom-model"
        onChange={onChange}
        selectionMode="custom"
        onSelectionModeChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    getProviderModelsForProvider.mockResolvedValue({
      provider: 'deepseek',
      links: [],
      models: [
        {
          id: 'd1',
          provider: 'deepseek',
          model_id: 'deepseek-chat',
          display_name: 'DeepSeek Chat',
          is_enabled: true,
          is_builtin: true,
          tags: [],
          sort_order: 100,
        },
      ],
    });

    onChange.mockClear();
    rerender(
      <ModelDropdown
        provider="deepseek"
        value="my-custom-model"
        onChange={onChange}
        selectionMode="custom"
        onSelectionModeChange={() => {}}
      />,
    );

    // onChange should NOT have been called (custom value preserved)
    expect(onChange).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ //
  //  5. loading unknown model initializes mode=custom                   //
  // ------------------------------------------------------------------ //
  it('loading with unknown model shows custom input and badge', async () => {
    render(
      <ModelDropdown provider="groq" value="unknown-model-xyz" onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    // Should show custom input since value is not in model list
    const customInput = screen.getByPlaceholderText(/enter model id manually/i);
    expect(customInput).toBeTruthy();

    // Should show "CUSTOM MODEL" badge
    expect(screen.getByText('Custom model')).toBeTruthy();
  });

  // ------------------------------------------------------------------ //
  //  6. loading known model initializes mode=saved (no custom input)    //
  // ------------------------------------------------------------------ //
  it('loading with known model does not show custom input', async () => {
    render(
      <ModelDropdown provider="groq" value="llama-3.3-70b-versatile" onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    // Should NOT show custom input since value is in model list
    expect(screen.queryByPlaceholderText(/enter model id manually/i)).toBeNull();
  });

  // ------------------------------------------------------------------ //
  //  7. switching from custom to dropdown switches mode=saved           //
  // ------------------------------------------------------------------ //
  it('selecting a dropdown model after custom input switches to saved', async () => {
    const onChange = vi.fn();
    const onModeChange = vi.fn();
    render(
      <ModelDropdown
        provider="groq"
        value="unknown-model"
        onChange={onChange}
        selectionMode="custom"
        onSelectionModeChange={onModeChange}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    // Select a known model from dropdown
    const select = getSelect();
    selectOption(select, 'llama-3.3-70b-versatile');

    // onChange called with the selected model
    expect(onChange).toHaveBeenCalledWith('llama-3.3-70b-versatile');
    // onSelectionModeChange called with 'saved'
    expect(onModeChange).toHaveBeenCalledWith('saved');
  });

  // ------------------------------------------------------------------ //
  //  8. custom badge/label renders                                      //
  // ------------------------------------------------------------------ //
  it('renders "Custom model" badge when custom mode has value', async () => {
    render(
      <ModelDropdown provider="groq" value="my-custom-model" onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    // The badge should be rendered
    expect(screen.getByText('Custom model')).toBeTruthy();
  });
});

// ------------------------------------------------------------------ //
//  Edge-case tests – hardening                                        //
// ------------------------------------------------------------------ //

const deepseekModel = (id: string, modelId: string) => ({
  id,
  provider: 'deepseek',
  model_id: modelId,
  display_name: null,
  is_enabled: true,
  is_builtin: true,
  tags: [],
  sort_order: 100,
});

describe('ModelDropdown — edge cases', () => {
  // ------------------------------------------------------------------ //
  //  9. saved mode clears exactly once                                  //
  // ------------------------------------------------------------------ //
  it('saved mode clears value exactly once on provider change', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModelDropdown provider="groq" value="llama-3.3-70b-versatile" onChange={onChange} />,
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    getProviderModelsForProvider.mockResolvedValue(deepseekGroup);
    onChange.mockClear();

    rerender(
      <ModelDropdown provider="deepseek" value="" onChange={onChange} />,
    );

    // onChange should be called exactly once with ''
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('');
  });

  // ------------------------------------------------------------------ //
  //  10. custom mode survives multiple provider switches                //
  // ------------------------------------------------------------------ //
  it('custom mode survives multiple provider switches', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModelDropdown
        provider="groq"
        value="my-persistent-model"
        onChange={onChange}
        selectionMode="custom"
        onSelectionModeChange={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    onChange.mockClear();

    // Switch to deepseek
    getProviderModelsForProvider.mockResolvedValue(deepseekGroup);
    rerender(
      <ModelDropdown
        provider="deepseek"
        value="my-persistent-model"
        onChange={onChange}
        selectionMode="custom"
        onSelectionModeChange={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();

    // Switch back to groq
    getProviderModelsForProvider.mockResolvedValue(mockGroup);
    rerender(
      <ModelDropdown
        provider="groq"
        value="my-persistent-model"
        onChange={onChange}
        selectionMode="custom"
        onSelectionModeChange={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();

    // Switch to deepseek again
    getProviderModelsForProvider.mockResolvedValue(deepseekGroup);
    rerender(
      <ModelDropdown
        provider="deepseek"
        value="my-persistent-model"
        onChange={onChange}
        selectionMode="custom"
        onSelectionModeChange={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ //
  //  11. stale response ignored after provider switch                   //
  // ------------------------------------------------------------------ //
  it('ignores stale models response from previous provider', async () => {
    let resolveLateGroq!: (g: ProviderGroup) => void;
    const lateGroqPromise = new Promise<ProviderGroup>(resolve => {
      resolveLateGroq = resolve;
    });

    const fetchCalls: string[] = [];
    getProviderModelsForProvider.mockImplementation((provider: string) => {
      fetchCalls.push(provider);
      if (provider === 'groq') return lateGroqPromise;
      return Promise.resolve(deepseekGroup);
    });

    const onChange = vi.fn();
    const { rerender } = render(
      <ModelDropdown provider="groq" value="" onChange={onChange} />,
    );

    // Wait for groq fetch to be initiated
    await waitFor(() => expect(fetchCalls).toContain('groq'));

    // Switch provider BEFORE groq resolves — this starts a deepseek fetch
    rerender(
      <ModelDropdown provider="deepseek" value="" onChange={onChange} />,
    );

    // Now groq response arrives late (stale)
    await act(async () => {
      resolveLateGroq(mockGroup);
    });

    // Deepseek resolves immediately (Promise.resolve) — wait for it
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    // Dropdown should reflect deepseek models, NOT stale groq models
    const options = screen.getByRole('combobox').querySelectorAll('option');
    const values = Array.from(options).map(o => o.getAttribute('value'));
    expect(values).not.toContain('llama-3.3-70b-versatile');
    expect(values).toContain('deepseek-chat');
  });

  // ------------------------------------------------------------------ //
  //  12. rapid provider switching — final provider's models win         //
  // ------------------------------------------------------------------ //
  it('rapid provider switching keeps final provider models', async () => {
    const altGroup: ProviderGroup = {
      provider: 'alt',
      links: [],
      models: [deepseekModel('a1', 'alt-model')],
    };

    getProviderModelsForProvider.mockImplementation((provider: string) => {
      if (provider === 'groq') return Promise.resolve(mockGroup);
      if (provider === 'deepseek') return Promise.resolve(deepseekGroup);
      return Promise.resolve(altGroup);
    });

    const onChange = vi.fn();
    const { rerender } = render(
      <ModelDropdown provider="groq" value="" onChange={onChange} />,
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    // Rapidly cycle through providers before any response renders
    rerender(<ModelDropdown provider="deepseek" value="" onChange={onChange} />);
    rerender(<ModelDropdown provider="groq" value="" onChange={onChange} />);
    rerender(<ModelDropdown provider="deepseek" value="" onChange={onChange} />);

    // Wait for final provider's models to load
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    const options = screen.getByRole('combobox').querySelectorAll('option');
    const values = Array.from(options).map(o => o.getAttribute('value'));
    // deepseek-chat from the final deepseek provider should be present
    expect(values).toContain('deepseek-chat');
    // groq models should NOT be present (last provider wins)
    expect(values).not.toContain('llama-3.3-70b-versatile');
  });

  // ------------------------------------------------------------------ //
  //  13. loading state preserves correct mode detection                 //
  // ------------------------------------------------------------------ //
  it('loading state preserves correct mode after provider switch', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModelDropdown
        provider="groq"
        value="my-custom-model"
        onChange={onChange}
        selectionMode="custom"
        onSelectionModeChange={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    // Verify custom input is shown before switching
    expect(screen.getByPlaceholderText(/enter model id manually/i)).toBeTruthy();
    expect(screen.getByText('Custom model')).toBeTruthy();

    // Switch provider — loading phase begins
    getProviderModelsForProvider.mockResolvedValue(deepseekGroup);
    rerender(
      <ModelDropdown
        provider="deepseek"
        value="my-custom-model"
        onChange={onChange}
        selectionMode="custom"
        onSelectionModeChange={() => {}}
      />,
    );

    // During loading: should show loading input (no custom badge)
    expect(screen.queryByText('Custom model')).toBeNull();
    expect(screen.getByPlaceholderText('Loading...')).toBeTruthy();

    // After loading completes
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Loading...')).toBeNull();
    });

    // Custom badge should be restored (custom mode preserved)
    expect(screen.getByText('Custom model')).toBeTruthy();
    expect(screen.getByPlaceholderText(/enter model id manually/i)).toBeTruthy();

    // Value must NOT have been cleared
    expect(onChange).not.toHaveBeenCalled();
  });
});
