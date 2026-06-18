import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, useToast } from '../App';
import { BUILTIN_RULE_SET_ID } from '../constants';
import type {
  CustomProtectionRuleSchema,
  CreateRuleRequest,
  UpdateRuleRequest,
  PreviewResponse,
  ProtectionProfileSchema,
  LearnedCandidateSchema,
  ProfileCandidatesResponse,
  CreateRulesFromCandidatesRequest,
  CreateRulesFromCandidatesResponse,
  ProtectionRuleSet,
  ProtectionRule,
  CreateRuleSetRequest,
  UpdateRuleSetRequest,
  CreateRuleInSetRequest,
  UpdateRuleInSetRequest,
  ValidateRuleRequest,
  RuleValidationDiagnostic,
  CreatedRuleInfo,
} from '../api/types';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_FORM: CreateRuleRequest = {
  name: '',
  pattern: '',
  rule_kind: 'atomic',
  token_type: 'custom_token',
  description: '',
  enabled: true,
  priority: 100,
  flags: [],
  sample_text: '',
};

const DEFAULT_RULE_IN_SET_FORM: CreateRuleInSetRequest = {
  name: '',
  pattern: '',
  rule_kind: 'atomic',
  description: '',
  enabled: true,
  priority: 100,
  token_type: 'custom_token',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'var(--color-success)',
  medium: 'var(--color-warning)',
  low: 'var(--color-text-muted)',
};

/* —— Rule kind metadata —— */
interface RuleKindInfo {
  label: string;
  shortDescription: string;
  patternHint: string;
  exampleInput: string;
  exampleOutput: string;
}

const RULE_KIND_INFO: Record<string, RuleKindInfo> = {
  atomic: {
    label: 'Atomic',
    shortDescription: 'Protect the whole match as one placeholder. Use for variables, icons, and placeholders like $NAME$, £energy£, §H.',
    patternHint: 'Pattern must match exactly the token to protect. No capture groups required.',
    exampleInput: '$NAME$',
    exampleOutput: '<PH/>',
  },
  boundary: {
    label: 'Boundary',
    shortDescription: 'Protect only opener/closer; inner text remains translatable. Use for simple wrappers like <b>text</b>.',
    patternHint: 'Pattern must have exactly 3 capture groups: (opener)(inner)(closer).\nExample: (<tooltip\\b[^>]*>)(.*?)(</tooltip>)',
    exampleInput: '<b>Hello</b>',
    exampleOutput: '<PH/>Hello<PH/>',
  },
  opaque_container: {
    label: 'Opaque Container',
    shortDescription: 'Protect the whole span; inner text is hidden from translation. Use for code, script, or raw blocks.',
    patternHint: 'Pattern matches the full span. No capture groups required.',
    exampleInput: '<script>code here</script>',
    exampleOutput: '<PH/>',
  },
  structured_container: {
    label: 'Structured Container',
    shortDescription: 'Protect opener/closer and recursively protect tokens inside; inner text remains translatable. Use for markup blocks like <tooltip>Hello $NAME$</tooltip>.',
    patternHint: 'Pattern must have exactly 3 capture groups: (opener)(inner)(closer). Inner content is recursively protected.\nExample: (<tooltip\\b[^>]*>)(.*?)(</tooltip>)',
    exampleInput: '<tooltip>Hello $NAME$</tooltip>',
    exampleOutput: '<PH/>Hello <PH/>',
  },
};

/** Stable color for each rule_kind badge. */
const RULE_KIND_BADGE_COLORS: Record<string, { bg: string; fg: string }> = {
  atomic:            { bg: 'rgba(33, 150, 243, 0.15)', fg: '#2196F3' },
  boundary:          { bg: 'rgba(76, 175, 80, 0.15)',  fg: '#4CAF50' },
  opaque_container:  { bg: 'rgba(156, 39, 176, 0.15)', fg: '#9C27B0' },
  structured_container: { bg: 'rgba(255, 152, 0, 0.15)', fg: '#FF9800' },
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ProtectionRules() {
  // ---- Rule set state ----
  const [ruleSets, setRuleSets] = useState<ProtectionRuleSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [selectedSetDetails, setSelectedSetDetails] = useState<ProtectionRuleSet | null>(null);
  const [expandedBuiltinRules, setExpandedBuiltinRules] = useState<ProtectionRule[] | null>(null);

  // ---- Rule set CRUD ----
  const [showCreateSetForm, setShowCreateSetForm] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [newSetDesc, setNewSetDesc] = useState('');
  const [creatingSet, setCreatingSet] = useState(false);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editSetName, setEditSetName] = useState('');
  const [editSetDesc, setEditSetDesc] = useState('');
  const [editSetEnabled, setEditSetEnabled] = useState(true);
  const [savingSet, setSavingSet] = useState(false);

  // ---- Rule-in-set form ----
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<CreateRuleInSetRequest>({ ...DEFAULT_RULE_IN_SET_FORM });
  const [savingRule, setSavingRule] = useState(false);
  const [ruleFormError, setRuleFormError] = useState<string | null>(null);

  // ---- Validation state ----
  const [validationDiagnostics, setValidationDiagnostics] = useState<RuleValidationDiagnostic[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationSuccess, setValidationSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showComparisonExample, setShowComparisonExample] = useState(false);
  const { showToast } = useToast();

  // Legacy custom rules (for learning pipeline)
  const [rules, setRules] = useState<CustomProtectionRuleSchema[]>([]);

  // Preview state
  const [previewPattern, setPreviewPattern] = useState('');
  const [previewSample, setPreviewSample] = useState('');
  const [previewFlags, setPreviewFlags] = useState<string[]>([]);
  const [previewResult, setPreviewResult] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Learning & Profiles state
  const [profiles, setProfiles] = useState<ProtectionProfileSchema[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [createProfileName, setCreateProfileName] = useState('');
  const [createProfileDesc, setCreateProfileDesc] = useState('');
  const [creatingProfile, setCreatingProfile] = useState(false);

  // Candidate review state
  const [candidates, setCandidates] = useState<LearnedCandidateSchema[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidateStatusFilter, setCandidateStatusFilter] = useState<string | undefined>(undefined);
  const [expandedCandidateExamples, setExpandedCandidateExamples] = useState<Set<string>>(new Set());
  const [candidateActionLoading, setCandidateActionLoading] = useState<string | null>(null);

  // Batch selection & rule creation state
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [showCreateRulesDialog, setShowCreateRulesDialog] = useState(false);
  const [createRulesFromAllAccepted, setCreateRulesFromAllAccepted] = useState(false);
  const [createRulesEnabled, setCreateRulesEnabled] = useState(false);
  const [createRulesLoading, setCreateRulesLoading] = useState(false);
  const [createRulesResult, setCreateRulesResult] = useState<CreateRulesFromCandidatesResponse | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Target Rule Set for promoting candidates
  const [promoteTargetSetId, setPromoteTargetSetId] = useState<string | null>(null);

  // URL query params
  const [searchParams] = useSearchParams();

  // Request sequence counters to discard stale async responses
  const pendingCandidateRequestId = useRef(0);
  const pendingProfileRequestId = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ---- Data loading ----

  const loadRuleSets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getRuleSets();
      setRuleSets(data);
      // Don't auto-select on load — builtin is read-only and shown inline.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load rule sets');
    } finally {
      setLoading(false);
    }
  }, [selectedSetId]);

  useEffect(() => {
    loadRuleSets();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load selected rule set details
  useEffect(() => {
    if (!selectedSetId) {
      setSelectedSetDetails(null);
      return;
    }
    api.getRuleSet(selectedSetId)
      .then(rs => setSelectedSetDetails(rs))
      .catch(() => setSelectedSetDetails(null));
  }, [selectedSetId]);

  // Load legacy rules (for learning pipeline)
  const loadRules = useCallback(async () => {
    try {
      const data = await api.getProtectionRules();
      setRules(data);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // ---- Rule Set CRUD ----

  const handleCreateSet = async () => {
    if (!newSetName.trim()) return;
    setCreatingSet(true);
    try {
      const rs = await api.createRuleSet({ name: newSetName.trim(), description: newSetDesc.trim() });
      setShowCreateSetForm(false);
      setNewSetName('');
      setNewSetDesc('');
      await loadRuleSets();
      setSelectedSetId(rs.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create rule set');
    } finally {
      setCreatingSet(false);
    }
  };

  const openEditSet = (rs: ProtectionRuleSet) => {
    setEditingSetId(rs.id);
    setEditSetName(rs.name);
    setEditSetDesc(rs.description || '');
    setEditSetEnabled(rs.enabled);
  };

  const closeEditSet = () => {
    setEditingSetId(null);
  };

  const handleUpdateSet = async () => {
    if (!editingSetId || !editSetName.trim()) return;
    setSavingSet(true);
    try {
      await api.updateRuleSet(editingSetId, {
        name: editSetName.trim(),
        description: editSetDesc.trim() || undefined,
        enabled: editSetEnabled,
      });
      closeEditSet();
      await loadRuleSets();
      // Refresh details too
      if (selectedSetId === editingSetId) {
        const rs = await api.getRuleSet(editingSetId);
        setSelectedSetDetails(rs);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update rule set');
    } finally {
      setSavingSet(false);
    }
  };

  const handleDeleteSet = async (id: string) => {
    if (!window.confirm('Delete this rule set? This cannot be undone.')) return;
    try {
      await api.deleteRuleSet(id);
      if (selectedSetId === id) {
        setSelectedSetId(null);
        setSelectedSetDetails(null);
      }
      await loadRuleSets();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete rule set');
    }
  };

  // ---- Toggle set enabled ----
  const handleToggleSetEnabled = async (rs: ProtectionRuleSet) => {
    try {
      await api.updateRuleSet(rs.id, { enabled: !rs.enabled });
      await loadRuleSets();
      // Refresh details if selected
      if (selectedSetId === rs.id) {
        const updated = await api.getRuleSet(rs.id);
        setSelectedSetDetails(updated);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to toggle rule set');
    }
  };

  // ---- View builtin rules inline ----

  const handleViewBuiltinRules = async (rs: ProtectionRuleSet) => {
    // Collapse if already expanded
    if (expandedBuiltinRules) {
      setExpandedBuiltinRules(null);
      return;
    }
    try {
      const details = await api.getRuleSet(rs.id);
      setExpandedBuiltinRules(details.rules || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load rules');
    }
  };

  // ---- Rule-in-set CRUD ----

  const openAddRuleForm = () => {
    setEditingRuleId(null);
    setRuleForm({ ...DEFAULT_RULE_IN_SET_FORM });
    setRuleFormError(null);
    setShowRuleForm(true);
  };

  const openEditRuleForm = (rule: ProtectionRule) => {
    setEditingRuleId(rule.id);
    setRuleForm({
      name: rule.name,
      pattern: rule.pattern,
      rule_kind: rule.rule_kind || 'atomic',
      description: rule.description || '',
      enabled: rule.enabled,
      priority: rule.priority,
      token_type: rule.token_type || 'custom_token',
    });
    setRuleFormError(null);
    setShowRuleForm(true);
  };

  const closeRuleForm = () => {
    setShowRuleForm(false);
    setEditingRuleId(null);
    setRuleForm({ ...DEFAULT_RULE_IN_SET_FORM });
    setRuleFormError(null);
    setValidationDiagnostics(null);
    setValidationSuccess(false);
    setFieldErrors({});
  };

  const handleValidateRule = async () => {
    // Clear previous states
    setFieldErrors({});
    setValidationSuccess(false);
    setValidationDiagnostics(null);
    setRuleFormError(null);

    // Client-side field validation
    const errors: Record<string, string> = {};

    if (!ruleForm.name.trim()) {
      errors.name = 'Name is required.';
    }

    if (!ruleForm.pattern.trim()) {
      errors.pattern = 'Regex pattern is required.';
    } else {
      try {
        new RegExp(ruleForm.pattern);
      } catch (e) {
        errors.pattern = `Invalid regex pattern: ${(e as Error).message}`;
      }
    }

    if (!ruleForm.rule_kind) {
      errors.rule_kind = 'Rule kind is required.';
    }

    if (!ruleForm.token_type) {
      errors.token_type = 'Token type is required.';
    }

    if (ruleForm.priority === undefined || ruleForm.priority === null) {
      errors.priority = 'Priority is required.';
    } else if (typeof ruleForm.priority !== 'number' || !Number.isInteger(ruleForm.priority)) {
      errors.priority = 'Priority must be a whole number.';
    } else if (ruleForm.priority < 0) {
      errors.priority = 'Priority must be 0 or greater.';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setRuleFormError('Please fix the errors below before validating.');
      return;
    }

    // Backend validation
    setValidating(true);
    try {
      const body: ValidateRuleRequest = {
        pattern: ruleForm.pattern,
        rule_kind: ruleForm.rule_kind || 'atomic',
        token_type: ruleForm.token_type || 'custom_token',
        flags: ruleForm.flags,
        opener_pattern: ruleForm.opener_pattern,
        closer_pattern: ruleForm.closer_pattern,
      };
      const result = await api.validateProtectionRule(body);
      setValidationDiagnostics(result.diagnostics);

      const hasErrors = result.diagnostics.some(d => d.severity === 'error');
      if (hasErrors) {
        // Map backend errors to field errors when a field is indicated
        const backendErrors: Record<string, string> = {};
        result.diagnostics.forEach(d => {
          if (d.severity === 'error') {
            if (d.field) {
              backendErrors[d.field] = d.message;
            }
          }
        });
        if (Object.keys(backendErrors).length > 0) {
          setFieldErrors(backendErrors);
        }
      } else {
        setValidationSuccess(true);
        showToast('Rule validation passed.');
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Validation request failed';
      setValidationDiagnostics([
        { severity: 'error', code: 'VALIDATION_FAILED', message },
      ]);
      setRuleFormError(`Rule validation failed: ${message}`);
    } finally {
      setValidating(false);
    }
  };

  const handleSaveRule = async () => {
    // Full client-side validation matching handleValidateRule
    setFieldErrors({});
    setValidationSuccess(false);
    setValidationDiagnostics(null);
    setRuleFormError(null);

    const errors: Record<string, string> = {};

    if (!ruleForm.name.trim()) {
      errors.name = 'Name is required.';
    }
    if (!ruleForm.pattern.trim()) {
      errors.pattern = 'Regex pattern is required.';
    } else {
      try {
        new RegExp(ruleForm.pattern);
      } catch (e) {
        errors.pattern = `Invalid regex pattern: ${(e as Error).message}`;
      }
    }
    if (!ruleForm.rule_kind) {
      errors.rule_kind = 'Rule kind is required.';
    }
    if (!ruleForm.token_type) {
      errors.token_type = 'Token type is required.';
    }
    if (ruleForm.priority === undefined || ruleForm.priority === null) {
      errors.priority = 'Priority is required.';
    } else if (typeof ruleForm.priority !== 'number' || !Number.isInteger(ruleForm.priority)) {
      errors.priority = 'Priority must be a whole number.';
    } else if (ruleForm.priority < 0) {
      errors.priority = 'Priority must be 0 or greater.';
    }
    if (!selectedSetId) {
      setRuleFormError('No rule set selected');
      return;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setRuleFormError('Please fix the errors below before saving.');
      return;
    }

    setSavingRule(true);
    setRuleFormError(null);
    try {
      if (editingRuleId) {
        await api.updateRuleInSet(selectedSetId, editingRuleId, ruleForm as UpdateRuleInSetRequest);
      } else {
        await api.addRuleToSet(selectedSetId, ruleForm);
      }
      closeRuleForm();
      // Refresh details
      const rs = await api.getRuleSet(selectedSetId);
      setSelectedSetDetails(rs);
      await loadRuleSets();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save rule';
      setRuleFormError(message);
      // Attempt to parse field-level errors from backend ApiError details
      if (err instanceof ApiError && err.details && typeof err.details === 'object') {
        const backendErrors: Record<string, string> = {};
        for (const [key, value] of Object.entries(err.details)) {
          if (typeof value === 'string') {
            backendErrors[key] = value;
          }
        }
        if (Object.keys(backendErrors).length > 0) {
          setFieldErrors(backendErrors);
        }
      }
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!selectedSetId) return;
    if (!window.confirm('Delete this rule?')) return;
    try {
      await api.deleteRuleFromSet(selectedSetId, ruleId);
      const rs = await api.getRuleSet(selectedSetId);
      setSelectedSetDetails(rs);
      await loadRuleSets();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete rule');
    }
  };

  // ---- Legacy rule toggle (learning pipeline) ----

  const handleToggle = async (rule: CustomProtectionRuleSchema) => {
    try {
      await api.updateProtectionRule(rule.id, { enabled: !rule.enabled });
      await loadRules();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to toggle rule');
    }
  };

  // ---- Preview ----

  const handlePreview = async () => {
    if (!previewPattern.trim()) return;
    setPreviewLoading(true);
    setPreviewResult(null);
    try {
      const result = await api.previewProtectionRule({
        pattern: previewPattern,
        sample_text: previewSample,
        flags: previewFlags.length > 0 ? previewFlags : undefined,
      });
      setPreviewResult(result);
    } catch (err) {
      setPreviewResult({
        matches: [],
        match_count: 0,
        error: err instanceof ApiError ? err.message : 'Preview failed',
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const togglePreviewFlag = (flag: string) => {
    setPreviewFlags(prev =>
      prev.includes(flag) ? prev.filter(f => f !== flag) : [...prev, flag],
    );
  };

  // ---- Profiles ----

  const loadProfiles = useCallback(async () => {
    const requestId = ++pendingProfileRequestId.current;
    setProfilesLoading(true);
    setProfilesError(null);
    try {
      const data = await api.getProtectionProfiles();
      if (requestId !== pendingProfileRequestId.current) return; // stale
      if (!mountedRef.current) return; // unmounted
      setProfiles(data);
      setProfilesError(null);
    } catch (err) {
      if (requestId !== pendingProfileRequestId.current) return; // stale
      if (!mountedRef.current) return; // unmounted
      setProfilesError(err instanceof ApiError ? err.message : 'Failed to load profiles');
    } finally {
      if (requestId === pendingProfileRequestId.current) {
        setProfilesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Auto-select profile from ?profile= query param after profiles load
  useEffect(() => {
    const profileIdFromUrl = searchParams.get('profile');
    if (!profileIdFromUrl || profiles.length === 0) return;

    const match = profiles.find(p => p.id === profileIdFromUrl);
    if (match && match.id !== selectedProfileId) {
      setSelectedProfileId(match.id);
      setCandidates([]);
      setCandidatesError(null);
      setCandidateStatusFilter(undefined);
    }
  }, [searchParams, profiles, selectedProfileId]);

  const handleCreateProfile = async () => {
    const name = createProfileName.trim();
    if (!name) return;
    setCreatingProfile(true);
    try {
      const created = await api.createProtectionProfile({
        name,
        description: createProfileDesc.trim() || undefined,
      });
      setShowCreateProfile(false);
      setCreateProfileName('');
      setCreateProfileDesc('');
      setSelectedProfileId(created.id);
      setCandidates([]);
      setCandidatesError(null);
      await loadProfiles();
    } catch (err) {
      setProfilesError(err instanceof ApiError ? err.message : 'Failed to create profile');
    } finally {
      setCreatingProfile(false);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    if (!window.confirm('Delete this profile and all its learned data?')) return;
    try {
      await api.deleteProtectionProfile(id);
      if (selectedProfileId === id) {
        setSelectedProfileId(null);
        setCandidates([]);
        setCandidatesError(null);
      }
      await loadProfiles();
    } catch (err) {
      setProfilesError(err instanceof ApiError ? err.message : 'Failed to delete profile');
    }
  };

  const handleSelectProfile = (id: string) => {
    setSelectedProfileId(id === selectedProfileId ? null : id);
    setCandidates([]);
    setCandidatesError(null);
    setCandidateStatusFilter(undefined);
  };

  // ---- Candidates ----

  const loadCandidates = async (profileId: string, status?: string) => {
    const requestId = ++pendingCandidateRequestId.current;
    setCandidatesLoading(true);
    setCandidatesError(null);
    try {
      const data = await api.getProfileCandidates(profileId, status);
      if (requestId !== pendingCandidateRequestId.current) return; // stale
      if (!mountedRef.current) return; // unmounted
      setCandidates(data.candidates);
      setSelectedCandidateIds(new Set());
      setCandidatesError(null);
    } catch (err) {
      if (requestId !== pendingCandidateRequestId.current) return; // stale
      if (!mountedRef.current) return; // unmounted
      setCandidatesError(err instanceof ApiError ? err.message : 'Failed to load candidates');
    } finally {
      if (requestId === pendingCandidateRequestId.current) {
        setCandidatesLoading(false);
      }
    }
  };

  useEffect(() => {
    if (selectedProfileId) {
      loadCandidates(selectedProfileId, candidateStatusFilter);
    }
  }, [selectedProfileId, candidateStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCandidateStatusChange = async (candidateId: string, newStatus: 'suggested' | 'accepted' | 'rejected' | 'ignored') => {
    setCandidateActionLoading(candidateId);
    try {
      await api.updateCandidateStatus(selectedProfileId!, candidateId, { status: newStatus });
      await loadCandidates(selectedProfileId!, candidateStatusFilter);
    } catch (err) {
      setCandidatesError(err instanceof ApiError ? err.message : 'Failed to update candidate');
    } finally {
      setCandidateActionLoading(null);
    }
  };

  const handleAcceptCandidate = async (candidate: LearnedCandidateSchema) => {
    await handleCandidateStatusChange(candidate.id, 'accepted');
    setEditingRuleId(null);
    setRuleForm({
      name: `Protect ${candidate.text.slice(0, 20)}`,
      pattern: candidate.suggested_pattern,
      rule_kind: candidate.rule_kind || 'atomic',
      token_type: candidate.token_type || 'custom_token',
      description: `Learned from profile: confidence=${candidate.confidence} (p=${(candidate.max_probability * 100).toFixed(0)}%, occurrences=${candidate.occurrence_count})`,
      enabled: true,
      priority: 100,
    });
    setRuleFormError(null);
    setShowRuleForm(true);
  };

  const toggleExpandCandidateExample = (id: string) => {
    setExpandedCandidateExamples(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ---- Batch Selection & Rule Creation ----

  const toggleCandidateSelection = (id: string) => {
    setSelectedCandidateIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAllCandidates = () => {
    setSelectedCandidateIds(prev => {
      if (prev.size === candidates.length && candidates.length > 0) {
        return new Set();
      }
      return new Set(candidates.map(c => c.id));
    });
  };

  const handleOpenCreateRulesFromSelected = () => {
    setCreateRulesFromAllAccepted(false);
    setCreateRulesEnabled(false);
    setCreateRulesResult(null);
    setPromoteTargetSetId(null);
    setShowCreateRulesDialog(true);
  };

  const handleOpenCreateRulesFromAllAccepted = () => {
    setCreateRulesFromAllAccepted(true);
    setCreateRulesEnabled(false);
    setCreateRulesResult(null);
    setPromoteTargetSetId(null);
    setShowCreateRulesDialog(true);
  };

  const handleConfirmCreateRules = async () => {
    if (!selectedProfileId) return;
    setCreateRulesLoading(true);
    setCreateRulesResult(null);
    try {
      if (promoteTargetSetId) {
        // ── Path A: Promote directly into a ProtectionRuleSet ──
        // Determine which candidates to promote
        let targetCandidates: LearnedCandidateSchema[];
        if (createRulesFromAllAccepted) {
          targetCandidates = candidates.filter(c => c.status === 'accepted');
        } else {
          targetCandidates = candidates.filter(c => selectedCandidateIds.has(c.id));
        }

        if (targetCandidates.length === 0) {
          setCreateRulesResult({ created_count: 0, skipped_count: 0, created_rules: [], skipped_candidates: [] });
          setCreateRulesLoading(false);
          return;
        }

        const createdRules: CreatedRuleInfo[] = [];
        for (const cand of targetCandidates) {
          const pattern = cand.suggested_pattern;
          if (!pattern) continue;
          const ruleName = `Learned: ${cand.text.slice(0, 60)}`;
          const resp = await api.addRuleToSet(promoteTargetSetId, {
            name: ruleName,
            pattern: pattern,
            rule_kind: cand.rule_kind || 'atomic',
            description: `Promoted from learned candidate ${cand.id}`,
            enabled: createRulesEnabled,
            priority: 100,
            token_type: cand.token_type || 'custom_token',
          });
          createdRules.push({
            rule_id: resp.id,
            rule_name: ruleName,
            pattern: pattern,
            candidate_id: cand.id,
          });
        }

        const result: CreateRulesFromCandidatesResponse = {
          created_count: createdRules.length,
          skipped_count: targetCandidates.length - createdRules.length,
          created_rules: createdRules,
          skipped_candidates: [],
        };
        setCreateRulesResult(result);

        setToastMessage(`Created ${result.created_count} rule${result.created_count !== 1 ? 's' : ''} in the selected Rule Set.`);
        await loadRules();
        await loadCandidates(selectedProfileId, candidateStatusFilter);
        setSelectedCandidateIds(new Set());
      } else {
        // ── Path B: Legacy — create CustomProtectionRule (no Rule Set) ──
        const body: CreateRulesFromCandidatesRequest = {
          default_enabled: createRulesEnabled,
          skip_existing: true,
          name_prefix: 'Learned',
          priority_start: 100,
        };
        if (createRulesFromAllAccepted) {
          body.status_filter = 'accepted';
        } else {
          body.candidate_ids = Array.from(selectedCandidateIds);
        }
        const result = await api.createRulesFromCandidates(selectedProfileId, body);
        setCreateRulesResult(result);

        if (result.created_count > 0 || result.skipped_count > 0) {
          setToastMessage(
            `Created ${result.created_count} rule${result.created_count !== 1 ? 's' : ''}` +
            (result.skipped_count > 0
              ? `, skipped ${result.skipped_count} duplicate${result.skipped_count !== 1 ? 's' : ''}.`
              : '.'),
          );
        }
        await loadRules();
        await loadCandidates(selectedProfileId, candidateStatusFilter);
        setSelectedCandidateIds(new Set());
      }
    } catch (err) {
      setCandidatesError(err instanceof ApiError ? err.message : 'Failed to create rules');
    } finally {
      setCreateRulesLoading(false);
    }
  };

  const handleCloseCreateRulesDialog = () => {
    setShowCreateRulesDialog(false);
    setCreateRulesResult(null);
    setCreateRulesLoading(false);
  };

  // ---- Helpers ----

  const isBuiltinSet = (rs: ProtectionRuleSet) => rs.id === BUILTIN_RULE_SET_ID || rs.builtin;
  const isSelectedCustom = selectedSetId && selectedSetDetails && !isBuiltinSet(selectedSetDetails);

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="loading">
        <span className="spinner" /> Loading...
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1>Protection Rule Sets</h1>
        <p>
          Define rule sets used to protect game tokens from translation.
          Matches are replaced with placeholders before the LLM receives them
          and restored after translation.
        </p>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
          <button className="btn btn-sm" style={{ marginLeft: 12 }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* ---------- Rule Sets Section ---------- */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>Rule Sets</span>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreateSetForm(true)}>
            + New Rule Set
          </button>
        </div>

        {/* Create Rule Set form */}
        {showCreateSetForm && (
          <div
            style={{
              padding: '0.75rem',
              background: 'var(--color-surface-2)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--color-border)',
              marginBottom: 12,
            }}
          >
            <div className="form-row" style={{ gap: 8 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Name</label>
                <input
                  className="form-control"
                  value={newSetName}
                  onChange={e => setNewSetName(e.target.value)}
                  placeholder="e.g. My Custom Rules"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Description</label>
                <input
                  className="form-control"
                  value={newSetDesc}
                  onChange={e => setNewSetDesc(e.target.value)}
                  placeholder="Optional description"
                />
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 8 }}>
              <button
                className="btn btn-sm"
                onClick={() => { setShowCreateSetForm(false); setNewSetName(''); setNewSetDesc(''); }}
                disabled={creatingSet}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleCreateSet}
                disabled={creatingSet || !newSetName.trim()}
              >
                {creatingSet ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {ruleSets.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', padding: '1rem 0' }}>
            No rule sets defined. Create one to get started.
          </p>
        ) : (
          /* Rule set cards */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ruleSets.map(rs => (
              <div
                key={rs.id}
                style={{
                  border: selectedSetId === rs.id
                    ? '2px solid var(--color-primary)'
                    : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: '12px 16px',
                  cursor: rs.builtin ? 'default' : 'pointer',
                  background: selectedSetId === rs.id ? 'var(--color-surface-2)' : 'transparent',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onClick={rs.builtin ? undefined : () => setSelectedSetId(rs.id)}
              >
                {/* Edit set form inline */}
                {editingSetId === rs.id ? (
                  <div onClick={e => e.stopPropagation()}>
                    <div className="form-row" style={{ gap: 8, marginBottom: 8 }}>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label style={{ fontSize: 12 }}>Name</label>
                        <input
                          className="form-control"
                          value={editSetName}
                          onChange={e => setEditSetName(e.target.value)}
                        />
                      </div>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label style={{ fontSize: 12 }}>Description</label>
                        <input
                          className="form-control"
                          value={editSetDesc}
                          onChange={e => setEditSetDesc(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="form-group" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="checkbox"
                          checked={editSetEnabled}
                          onChange={e => setEditSetEnabled(e.target.checked)}
                          className="form-checkbox"
                        />
                        Enabled
                      </label>
                    </div>
                    <div className="form-actions">
                      <button className="btn btn-sm" onClick={closeEditSet} disabled={savingSet}>Cancel</button>
                      <button className="btn btn-primary btn-sm" onClick={handleUpdateSet} disabled={savingSet || !editSetName.trim()}>
                        {savingSet ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    {/* Info */}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <strong style={{ fontSize: 15 }}>{rs.name}</strong>
                        {rs.builtin && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                              color: 'var(--color-text-muted)',
                              background: 'var(--color-surface-2)',
                              padding: '1px 8px',
                              borderRadius: 10,
                            }}
                          >
                            Built-in
                          </span>
                        )}
                      </div>
                      {rs.description && (
                        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                          {rs.description}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--color-text-muted)' }}>
                        <span>
                          <strong>{rs.rule_count ?? (rs.rules ? rs.rules.length : 0)}</strong> rule{(rs.rule_count ?? 0) !== 1 ? 's' : ''}
                        </span>
                        <span
                          style={{
                            color: rs.enabled ? 'var(--color-success)' : 'var(--color-text-muted)',
                            cursor: 'pointer',
                          }}
                          onClick={e => { e.stopPropagation(); handleToggleSetEnabled(rs); }}
                        >
                          {rs.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </div>
                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {rs.builtin ? (
                        <button
                          className="btn btn-sm"
                          onClick={e => { e.stopPropagation(); handleViewBuiltinRules(rs); }}
                        >
                          {expandedBuiltinRules ? 'Hide rules' : 'View rules'}
                        </button>
                      ) : (
                        <>
                          <button
                            className="btn btn-sm"
                            onClick={e => { e.stopPropagation(); openEditSet(rs); }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={e => { e.stopPropagation(); handleDeleteSet(rs.id); }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {/* Inline builtin rules table */}
                {rs.builtin && expandedBuiltinRules && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                    {expandedBuiltinRules.length === 0 ? (
                      <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No rules in this set.</p>
                    ) : (
                      <table className="table-wrapper" style={{ width: '100%' }}>
                        <thead>
                          <tr>
                            <th style={{ width: 60 }}>Enabled</th>
                            <th>Name</th>
                            <th>Pattern</th>
                            <th style={{ width: 80 }}>Priority</th>
                            <th style={{ width: 90 }}>Kind</th>
                            <th style={{ width: 100 }}>Token Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expandedBuiltinRules.map(rule => (
                            <tr key={rule.id}>
                              <td style={{ textAlign: 'center' }}>
                                <span style={{ fontSize: 18, color: rule.enabled ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                                  {rule.enabled ? '\u2713' : '\u2715'}
                                </span>
                              </td>
                              <td>
                                <strong>{rule.name}</strong>
                                {rule.description && (
                                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{rule.description}</div>
                                )}
                              </td>
                              <td>
                                <code className="mono" style={{ fontSize: 13, wordBreak: 'break-all' }}>{rule.pattern}</code>
                              </td>
                              <td style={{ textAlign: 'center' }}>{rule.priority}</td>
                              <td>
                                <span style={{
                                  fontSize: 11,
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  background: RULE_KIND_BADGE_COLORS[rule.rule_kind]?.bg ?? 'var(--color-bg-secondary)',
                                  color: RULE_KIND_BADGE_COLORS[rule.rule_kind]?.fg ?? 'var(--color-text-muted)',
                                }}>
                                  {RULE_KIND_INFO[rule.rule_kind]?.label || rule.rule_kind || 'Atomic'}
                                </span>
                              </td>
                              <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{rule.token_type}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- Selected Rule Set Details (custom sets only) ---------- */}
      {selectedSetDetails && !isBuiltinSet(selectedSetDetails) && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>
              {selectedSetDetails.name}
              {isBuiltinSet(selectedSetDetails) && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--color-text-muted)',
                    background: 'var(--color-surface-2)',
                    padding: '2px 8px',
                    borderRadius: 10,
                    verticalAlign: 'middle',
                  }}
                >
                  Built-in
                </span>
              )}
            </span>
            {isSelectedCustom && (
              <button className="btn btn-primary btn-sm" onClick={openAddRuleForm}>
                + New Rule
              </button>
            )}
          </div>

          {isBuiltinSet(selectedSetDetails) && (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 12 }}>
              Read-only. Built-in protection rules for game tokens. Cannot be modified.
            </p>
          )}

          {selectedSetDetails.rules && selectedSetDetails.rules.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', padding: '0.5rem 0' }}>
              {isBuiltinSet(selectedSetDetails)
                ? 'No rules in this set.'
                : 'No rules defined yet. Add a rule to get started.'}
            </p>
          ) : selectedSetDetails.rules ? (
            <table className="table-wrapper" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Enabled</th>
                  <th>Name</th>
                  <th>Pattern</th>
                  <th style={{ width: 80 }}>Priority</th>
                  <th style={{ width: 90 }}>Kind</th>
                  <th style={{ width: 100 }}>Token Type</th>
                  {isSelectedCustom && <th style={{ width: 140 }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {selectedSetDetails.rules.map(rule => (
                  <tr key={rule.id}>
                    <td style={{ textAlign: 'center' }}>
                      <span
                        style={{
                          fontSize: 18,
                          color: rule.enabled
                            ? 'var(--color-success)'
                            : 'var(--color-text-muted)',
                        }}
                      >
                        {rule.enabled ? '\u2713' : '\u2715'}
                      </span>
                    </td>
                    <td>
                      <strong>{rule.name}</strong>
                      {rule.description && (
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {rule.description}
                        </div>
                      )}
                    </td>
                    <td>
                      <code className="mono" style={{ fontSize: 13, wordBreak: 'break-all' }}>
                        {rule.pattern}
                      </code>
                    </td>
                    <td style={{ textAlign: 'center' }}>{rule.priority}</td>
                    <td>
                      <span style={{
                        fontSize: 11,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: RULE_KIND_BADGE_COLORS[rule.rule_kind]?.bg ?? 'var(--color-bg-secondary)',
                        color: RULE_KIND_BADGE_COLORS[rule.rule_kind]?.fg ?? 'var(--color-text-muted)',
                      }}>
                        {RULE_KIND_INFO[rule.rule_kind]?.label || rule.rule_kind || 'Atomic'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{rule.token_type}</td>
                    {isSelectedCustom && (
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-sm"
                            onClick={() => openEditRuleForm(rule)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => handleDeleteRule(rule.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      )}

      {/* Create / Edit Rule Modal (inside a rule set) */}
      {showRuleForm && (
        <div className="modal-overlay" onClick={closeRuleForm}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h2>{editingRuleId ? 'Edit Rule' : 'New Rule'} {selectedSetDetails ? `in "${selectedSetDetails.name}"` : ''}</h2>
            </div>
            <div className="modal-body">
              {ruleFormError && <div className="alert alert-error">{ruleFormError}</div>}
              {validationSuccess && (
                <div className="alert alert-info" style={{ marginBottom: 12, fontSize: 13, padding: '6px 10px' }}>
                  Rule validation passed.
                </div>
              )}

              <div className="form-group">
                <label>Name</label>
                <input
                  className={`form-control${fieldErrors.name ? ' is-invalid' : ''}`}
                  value={ruleForm.name}
                  onChange={e => {
                    setRuleForm(f => ({ ...f, name: e.target.value }));
                    if (validationSuccess) setValidationSuccess(false);
                    if (fieldErrors.name) setFieldErrors(f => { const n = { ...f }; delete n.name; return n; });
                  }}
                  placeholder="e.g. Protect colour codes"
                />
                {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
              </div>

              <div className="form-group">
                <label>Regex Pattern</label>
                <input
                  className={`form-control mono${fieldErrors.pattern ? ' is-invalid' : ''}`}
                  value={ruleForm.pattern}
                  onChange={e => {
                    setRuleForm(f => ({ ...f, pattern: e.target.value }));
                    if (validationSuccess) setValidationSuccess(false);
                    if (fieldErrors.pattern) setFieldErrors(f => { const n = { ...f }; delete n.pattern; return n; });
                  }}
                  placeholder="e.g. §[A-Za-z]"
                />
                {fieldErrors.pattern && <span className="field-error">{fieldErrors.pattern}</span>}
              </div>

              <div className="form-group">
                <label>Description</label>
                <input
                  className="form-control"
                  value={ruleForm.description || ''}
                  onChange={e => setRuleForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>

              {/* ---------- Priority ---------- */}
              <div className="form-group">
                <label>Priority</label>
                <input
                  type="number"
                  className={`form-control mono${fieldErrors.priority ? ' is-invalid' : ''}`}
                  value={ruleForm.priority ?? 100}
                  onChange={e => {
                    const val = e.target.value === '' ? '' : Number(e.target.value);
                    setRuleForm(f => ({ ...f, priority: val as number }));
                    if (validationSuccess) setValidationSuccess(false);
                    if (fieldErrors.priority) setFieldErrors(f => { const n = { ...f }; delete n.priority; return n; });
                  }}
                  min={0}
                  style={{ maxWidth: 120 }}
                  placeholder="100"
                />
                {fieldErrors.priority && <span className="field-error">{fieldErrors.priority}</span>}
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                  Priority determines rule evaluation order. Lower values are evaluated first.<br />
                  Examples: 1 = very high priority, 100 = normal priority, 1000 = low priority.<br />
                  Use lower values for specific rules that should run before generic patterns.
                </div>
              </div>

              {/* ---------- Rule Kind + Token Type ---------- */}
              <div className="form-row" style={{ gap: 12 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Rule Kind</label>
                  <select
                    className={`form-control${fieldErrors.rule_kind ? ' is-invalid' : ''}`}
                    value={ruleForm.rule_kind || 'atomic'}
                    onChange={e => {
                      setRuleForm(f => ({ ...f, rule_kind: e.target.value }));
                      setValidationDiagnostics(null);
                      if (validationSuccess) setValidationSuccess(false);
                      if (fieldErrors.rule_kind) setFieldErrors(f => { const n = { ...f }; delete n.rule_kind; return n; });
                    }}
                  >
                    <option value="atomic">Atomic</option>
                    <option value="boundary">Boundary</option>
                    <option value="opaque_container">Opaque Container</option>
                    <option value="structured_container">Structured Container</option>
                  </select>
                  {fieldErrors.rule_kind && <span className="field-error">{fieldErrors.rule_kind}</span>}
                  {ruleForm.rule_kind && RULE_KIND_INFO[ruleForm.rule_kind] && (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                      {RULE_KIND_INFO[ruleForm.rule_kind].shortDescription}
                    </div>
                  )}
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Token Type</label>
                  <input
                    className={`form-control${fieldErrors.token_type ? ' is-invalid' : ''}`}
                    value={ruleForm.token_type}
                    onChange={e => {
                      setRuleForm(f => ({ ...f, token_type: e.target.value }));
                      if (validationSuccess) setValidationSuccess(false);
                      if (fieldErrors.token_type) setFieldErrors(f => { const n = { ...f }; delete n.token_type; return n; });
                    }}
                    placeholder="custom_token"
                  />
                  {fieldErrors.token_type && <span className="field-error">{fieldErrors.token_type}</span>}
                </div>
              </div>

              {/* Pattern hint */}
              {ruleForm.rule_kind && RULE_KIND_INFO[ruleForm.rule_kind] && (
                <div style={{
                  marginTop: 8, marginBottom: 8,
                  padding: '8px 10px',
                  background: 'var(--color-surface-2, #f5f5f5)',
                  borderRadius: 4,
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-line',
                }}>
                  {RULE_KIND_INFO[ruleForm.rule_kind].patternHint}
                </div>
              )}

              {/* Comparison example */}
              <div style={{ marginBottom: 8 }}>
                <button
                  className="btn btn-sm"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={() => setShowComparisonExample(v => !v)}
                >
                  {showComparisonExample ? 'Hide' : 'Show'} comparison example
                </button>
              </div>
              {showComparisonExample && (
                <div style={{
                  marginBottom: 12,
                  padding: '10px 12px',
                  background: 'var(--color-surface-2, #fafafa)',
                  borderRadius: 4,
                  fontSize: 12,
                  lineHeight: 1.6,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12 }}>How each rule kind processes the same input:</div>
                  <div style={{ marginBottom: 4 }}><em>Input:</em> <code className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>&lt;tooltip&gt;Hello $NAME$&lt;/tooltip&gt;</code></div>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <tbody>
                      {(['boundary', 'structured_container', 'opaque_container'] as const).map(k => (
                        <tr key={k}>
                          <td style={{ padding: '2px 8px 2px 0', whiteSpace: 'nowrap', fontWeight: 500 }}>{RULE_KIND_INFO[k].label}</td>
                          <td style={{ padding: '2px 0' }}>
                            <code className="mono" style={{ fontSize: 12 }}>{RULE_KIND_INFO[k].exampleOutput}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 4, color: 'var(--color-text-muted)', fontSize: 11 }}>
                    Note: boundary does not protect inner tokens; structured recursively protects them; opaque hides everything.
                  </div>
                </div>
              )}

              {/* Validation diagnostics */}
              {validationDiagnostics && validationDiagnostics.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {validationDiagnostics.map((d, i) => (
                    <div
                      key={i}
                      className={`alert ${d.severity === 'error' ? 'alert-error' : d.severity === 'warning' ? 'alert-warning' : 'alert-info'}`}
                      style={{ marginBottom: 4, fontSize: 13, padding: '6px 10px' }}
                    >
                      <strong>[{d.code}]</strong> {d.message}
                      {d.field && <span style={{ marginLeft: 8, opacity: 0.7 }}>(field: {d.field})</span>}
                    </div>
                  ))}
                </div>
              )}

              <div className="form-group" style={{ display: 'flex', gap: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={ruleForm.enabled}
                    onChange={e => setRuleForm(f => ({ ...f, enabled: e.target.checked }))}
                    className="form-checkbox"
                  />
                  Enabled
                </label>
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn"
                onClick={handleValidateRule}
                disabled={validating}
                style={{ marginRight: 'auto' }}
              >
                {validating ? 'Validating...' : 'Validate Rule'}
              </button>
              <button className="btn" onClick={closeRuleForm} disabled={savingRule}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveRule} disabled={savingRule}>
                {savingRule ? 'Saving...' : editingRuleId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Preview / Test Area ---------- */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title">Test Pattern</div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 12 }}>
          Quickly test any regex pattern against sample text without creating a rule.
        </p>

        <div className="form-row" style={{ gap: 12 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Regex Pattern</label>
            <input
              className="form-control mono"
              value={previewPattern}
              onChange={e => setPreviewPattern(e.target.value)}
              placeholder="e.g. \$[A-Za-z_]+\$"
            />
          </div>
          <div className="form-group">
            <label>Flags</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
              {['ignore_case', 'multiline', 'dotall'].map(flag => (
                <label key={flag} style={{ cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={previewFlags.includes(flag)}
                    onChange={() => togglePreviewFlag(flag)}
                  />
                  {flag}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="form-group">
          <label>Sample Text</label>
          <textarea
            className="form-control"
            rows={5}
            value={previewSample}
            onChange={e => setPreviewSample(e.target.value)}
            placeholder="Enter sample text to test the regex against..."
            style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }}
          />
        </div>

        <div className="form-actions">
          <button
            className="btn btn-primary"
            onClick={handlePreview}
            disabled={previewLoading || !previewPattern.trim()}
          >
            {previewLoading ? 'Running...' : 'Run Preview'}
          </button>
        </div>

        {previewResult && (
          <div style={{ marginTop: 16 }}>
            {previewResult.error ? (
              <div className="alert alert-error">{previewResult.error}</div>
            ) : previewResult.match_count === 0 ? (
              <div className="alert alert-info">No matches found.</div>
            ) : (
              <div>
                <div style={{ marginBottom: 8, color: 'var(--color-text-muted)' }}>
                  Found {previewResult.match_count} match{previewResult.match_count !== 1 ? 'es' : ''}:
                </div>
                <table className="table-wrapper" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 50 }}>#</th>
                      <th style={{ width: 80 }}>Start</th>
                      <th style={{ width: 80 }}>End</th>
                      <th>Matched Text</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewResult.matches.slice(0, 50).map(m => (
                      <tr key={m.index}>
                        <td>{m.index + 1}</td>
                        <td className="mono">{m.start}</td>
                        <td className="mono">{m.end}</td>
                        <td>
                          <code
                            className="mono"
                            style={{
                              background: 'var(--color-surface-2)',
                              padding: '2px 6px',
                              borderRadius: 3,
                              fontSize: 13,
                              wordBreak: 'break-all',
                            }}
                          >
                            {m.matched_text.length > 200
                              ? m.matched_text.slice(0, 200) + '...'
                              : m.matched_text}
                          </code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewResult.matches.length > 50 && (
                  <div style={{ marginTop: 8, color: 'var(--color-text-muted)', fontSize: 13 }}>
                    Showing first 50 of {previewResult.matches.length} matches.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------- Learning & Profiles ---------- */}
      <div className="card">
        <div className="card-title">
          <span>Learning &amp; Profiles</span>
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 16 }}>
          Build persistent protection profiles by learning from analysed samples.
          Learned candidates can be reviewed and promoted to active rules.
        </p>

        {profilesError && (
          <div className="alert alert-error" style={{ marginBottom: 12 }}>
            {profilesError}
            <button className="btn btn-sm" style={{ marginLeft: 12 }} onClick={() => setProfilesError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {/* Profiles List */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>Profiles</strong>
            {profilesLoading && <span className="spinner" style={{ width: 14, height: 14 }} />}
            {!showCreateProfile && (
              <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowCreateProfile(true)}>
                + Create Profile
              </button>
            )}
          </div>

          {showCreateProfile && (
            <div style={{ padding: '0.75rem', background: 'var(--color-surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', marginBottom: 8 }}>
              <div className="form-row" style={{ gap: 8 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label style={{ fontSize: 12 }}>Name</label>
                  <input
                    className="form-control"
                    value={createProfileName}
                    onChange={e => setCreateProfileName(e.target.value)}
                    placeholder="e.g. Stellaris UI patterns"
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label style={{ fontSize: 12 }}>Description (optional)</label>
                  <input
                    className="form-control"
                    value={createProfileDesc}
                    onChange={e => setCreateProfileDesc(e.target.value)}
                    placeholder="Brief description"
                  />
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: 8 }}>
                <button className="btn btn-sm" onClick={() => { setShowCreateProfile(false); setCreateProfileName(''); setCreateProfileDesc(''); }}>
                  Cancel
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleCreateProfile} disabled={creatingProfile || !createProfileName.trim()}>
                  {creatingProfile ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          )}

          {profiles.length === 0 && !profilesLoading ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: '8px 0' }}>
              No profiles yet. Create one to start learning.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {profiles.map(p => (
                <div
                  key={p.id}
                  onClick={() => handleSelectProfile(p.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    background: selectedProfileId === p.id ? 'var(--color-surface-2)' : 'transparent',
                    border: selectedProfileId === p.id ? '1px solid var(--color-primary)' : '1px solid transparent',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 14 }}>{p.name}</strong>
                      {p.name.startsWith('_pairs_') && (
                        <span className="badge badge-info" style={{ fontSize: 10, padding: '1px 6px' }}>
                          Pairing
                        </span>
                      )}
                      {p.candidate_count !== undefined && p.candidate_count > 0 && (
                        <span className="badge badge-success" style={{ fontSize: 10, padding: '1px 6px' }}>
                          {p.candidate_count} candidate{p.candidate_count !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {p.description && (
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 12, marginLeft: 8 }}>
                        {p.description}
                      </span>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      Created {new Date(p.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={e => { e.stopPropagation(); handleDeleteProfile(p.id); }}
                    style={{ fontSize: 11, padding: '2px 8px' }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Selected Profile: Candidates */}
        {selectedProfileId && (
          <div>
            {/* Pairing Workspace CTA */}
            <div style={{ marginTop: 16, padding: '0.75rem', background: 'var(--color-surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Pairing Workspace</div>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 12 }}>
                Create source-translated pairs from game files in the Pairing Workspace.
                Use the <strong>Learn from Pairs</strong> feature to generate protection
                candidates automatically from your accepted and manual pairs.
              </p>
              <Link
                to={(() => {
                  const selProfile = profiles.find(p => p.id === selectedProfileId);
                  const projectId = selProfile?.name?.startsWith('_pairs_')
                    ? selProfile.name.slice('_pairs_'.length)
                    : null;
                  return projectId ? `/pairing-projects?project=${projectId}` : '/pairing-projects';
                })()}
                className="btn btn-primary btn-sm"
              >
                Go to Pairing Workspace
              </Link>
            </div>

            {/* Candidate Review */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Candidate Review</div>

              {candidatesError && (
                <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 13 }}>
                  {candidatesError}
                  <button className="btn btn-sm" style={{ marginLeft: 12 }} onClick={() => setCandidatesError(null)}>Dismiss</button>
                </div>
              )}

              {/* Status filter tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                {[undefined, 'suggested', 'accepted', 'rejected', 'ignored'].map(s => (
                  <button
                    key={s || 'all'}
                    className="btn btn-sm"
                    onClick={() => setCandidateStatusFilter(s)}
                    style={{
                      fontSize: 11,
                      padding: '2px 10px',
                      background: candidateStatusFilter === s ? 'var(--color-primary)' : 'var(--color-surface-2)',
                      color: candidateStatusFilter === s ? '#fff' : 'var(--color-text)',
                      border: 'none',
                    }}
                  >
                    {s || 'All'}
                  </button>
                ))}
              </div>

              {/* Bulk actions bar */}
              {!candidatesLoading && candidates.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginBottom: 8,
                    padding: '6px 8px',
                    background: 'var(--color-surface-2)',
                    borderRadius: 'var(--radius)',
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    {selectedCandidateIds.size} selected
                  </span>
                  {selectedCandidateIds.size > 0 && (
                    <button
                      className="btn btn-sm"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={handleOpenCreateRulesFromSelected}
                    >
                      Create Rules from Selected
                    </button>
                  )}
                  <button
                    className="btn btn-sm"
                    style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={handleOpenCreateRulesFromAllAccepted}
                  >
                    Create Rules from All Accepted
                  </button>
                </div>
              )}

              {candidatesLoading ? (
                <div className="loading"><span className="spinner" /> Loading candidates...</div>
              ) : candidates.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                  No candidates yet. Use the Pairing Workspace to learn from file pairs.
                </p>
              ) : (
                <table className="table-wrapper" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          checked={candidates.length > 0 && selectedCandidateIds.size === candidates.length}
                          onChange={toggleSelectAllCandidates}
                          title="Select all"
                          className="form-checkbox"
                        />
                      </th>
                      <th>Candidate</th>
                      <th style={{ width: 50 }}>Occur.</th>
                      <th style={{ width: 50 }}>Samples</th>
                      <th style={{ width: 70 }}>Prob.</th>
                      <th style={{ width: 80 }}>Confidence</th>
                      <th>Kind</th>
                      <th>Type</th>
                      <th style={{ width: 80 }}>Status</th>
                      <th style={{ width: 200 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map(c => (
                      <tr key={c.id}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={selectedCandidateIds.has(c.id)}
                            onChange={() => toggleCandidateSelection(c.id)}
                            className="form-checkbox"
                          />
                        </td>
                        <td>
                          <div>
                            <code className="mono" style={{ background: 'var(--color-surface-2)', padding: '2px 6px', borderRadius: 3, fontSize: 13, wordBreak: 'break-all' }}>
                              {c.text.length > 60 ? c.text.slice(0, 60) + '...' : c.text}
                            </code>
                            <div style={{ marginTop: 4 }}>
                              <button
                                className="btn btn-sm"
                                style={{ fontSize: 11, padding: '1px 6px' }}
                                onClick={() => toggleExpandCandidateExample(c.id)}
                              >
                                {expandedCandidateExamples.has(c.id) ? 'Hide' : 'Show'} pattern
                              </button>
                              {expandedCandidateExamples.has(c.id) && (
                                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
                                  <code className="mono" style={{ fontSize: 11 }}>{c.suggested_pattern}</code>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', fontSize: 13 }}>{c.occurrence_count}</td>
                        <td style={{ textAlign: 'center', fontSize: 13 }}>{c.sample_count}</td>
                        <td className="mono" style={{ fontSize: 13 }}>
                          <span style={{ color: c.max_probability >= 0.7 ? 'var(--color-success)' : c.max_probability >= 0.4 ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
                            {(c.max_probability * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                            background: c.confidence === 'high' ? 'rgba(76, 175, 80, 0.15)' : c.confidence === 'medium' ? 'rgba(255, 193, 7, 0.15)' : 'transparent',
                            color: c.confidence === 'high' ? 'var(--color-success)' : c.confidence === 'medium' ? 'var(--color-warning)' : 'var(--color-text-muted)',
                          }}>
                            {c.confidence}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <span className="badge badge-sm" style={{
                            background: c.rule_kind === 'atomic' ? 'rgba(33, 150, 243, 0.15)' :
                                         c.rule_kind === 'boundary' ? 'rgba(76, 175, 80, 0.15)' :
                                         'rgba(156, 39, 176, 0.15)',
                            color: c.rule_kind === 'atomic' ? '#2196F3' :
                                   c.rule_kind === 'boundary' ? '#4CAF50' :
                                   '#9C27B0',
                            padding: '1px 6px', borderRadius: 3, fontSize: 11,
                          }}>
                            {c.rule_kind || 'atomic'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <code className="mono" style={{ fontSize: 11 }}>
                            {c.token_type || 'custom_token'}
                          </code>
                        </td>
                        <td>
                          <span className={`badge ${
                            c.status === 'accepted' ? 'badge-success' :
                            c.status === 'rejected' ? 'badge-error' :
                            c.status === 'ignored' ? 'badge-muted' :
                            'badge-info'
                          }`} style={{ fontSize: 11 }}>
                            {c.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {c.status !== 'accepted' && (
                              <button
                                className="btn btn-sm"
                                style={{ fontSize: 11, padding: '2px 6px' }}
                                onClick={() => handleAcceptCandidate(c)}
                                disabled={candidateActionLoading === c.id}
                                title="Accept and create rule"
                              >
                                Accept
                              </button>
                            )}
                            {c.status !== 'rejected' && (
                              <button
                                className="btn btn-sm"
                                style={{ fontSize: 11, padding: '2px 6px' }}
                                onClick={() => handleCandidateStatusChange(c.id, 'rejected')}
                                disabled={candidateActionLoading === c.id}
                              >
                                Reject
                              </button>
                            )}
                            {c.status !== 'ignored' && (
                              <button
                                className="btn btn-sm"
                                style={{ fontSize: 11, padding: '2px 6px' }}
                                onClick={() => handleCandidateStatusChange(c.id, 'ignored')}
                                disabled={candidateActionLoading === c.id}
                              >
                                Ignore
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---------- Create Rules from Candidates Confirmation Dialog ---------- */}
      {showCreateRulesDialog && (
        <div className="modal-overlay" onClick={handleCloseCreateRulesDialog}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h2>Create Protection Rules</h2>
            </div>
            <div className="modal-body">
              {createRulesResult ? (
                <div>
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                      Created {createRulesResult.created_count} rule{createRulesResult.created_count !== 1 ? 's' : ''}
                    </span>
                    {createRulesResult.skipped_count > 0 && (
                      <span style={{ color: 'var(--color-warning)', marginLeft: 8, fontWeight: 600 }}>
                        , skipped {createRulesResult.skipped_count} duplicate{createRulesResult.skipped_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {createRulesResult.skipped_candidates.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text-muted)' }}>
                        Skipped candidates:
                      </div>
                      {createRulesResult.skipped_candidates.map(sc => (
                        <div key={sc.candidate_id} style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>
                          <code className="mono" style={{ fontSize: 11 }}>{sc.candidate_id.slice(0, 8)}</code>: {sc.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p style={{ marginBottom: 12 }}>
                    Create protection rules from{' '}
                    <strong>
                      {createRulesFromAllAccepted
                        ? `all accepted candidates (${candidates.filter(c => c.status === 'accepted').length})`
                        : `${selectedCandidateIds.size} selected candidate${selectedCandidateIds.size !== 1 ? 's' : ''}`}
                    </strong>
                    ?
                  </p>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 12 }}>
                    Rules will be named &quot;Learned: &lt;token&gt;&quot; and created from
                    the suggested patterns. Duplicate patterns will be skipped.
                  </p>
                  <div className="form-group" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={createRulesEnabled}
                        onChange={e => setCreateRulesEnabled(e.target.checked)}
                        className="form-checkbox"
                      />
                      Enable created rules
                    </label>
                  </div>

                  {/* Target Rule Set selector */}
                  <div className="form-group" style={{ marginTop: '0.75rem' }}>
                    <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                      Target Rule Set <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional)</span>
                    </label>
                    <select
                      className="form-control"
                      value={promoteTargetSetId || ''}
                      onChange={e => setPromoteTargetSetId(e.target.value || null)}
                    >
                      <option value="">Legacy (standalone rule — not scoped to a Rule Set)</option>
                      {ruleSets.map(rs => (
                        <option key={rs.id} value={rs.id}>{rs.name}</option>
                      ))}
                    </select>
                    {ruleSets.length === 0 && (
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                        No Rule Sets exist. Use the &quot;Protection Rule Sets&quot; section above to create one.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={handleCloseCreateRulesDialog} disabled={createRulesLoading}>
                {createRulesResult ? 'Close' : 'Cancel'}
              </button>
              {!createRulesResult && (
                <button
                  className="btn btn-primary"
                  onClick={handleConfirmCreateRules}
                  disabled={createRulesLoading}
                >
                  {createRulesLoading ? 'Creating...' : 'Create Rules'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------- Toast Notification ---------- */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            padding: '12px 20px',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 10000,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>{toastMessage}</span>
          <button
            className="btn btn-sm"
            onClick={() => setToastMessage(null)}
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
