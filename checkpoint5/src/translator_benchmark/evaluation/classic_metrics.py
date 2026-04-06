import logging
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)
#здесь рассчитываем метрики перевода (классические)
#аналогично
try:
    import sacrebleu
    SACREBLEU_AVAILABLE = True
except ImportError:
    SACREBLEU_AVAILABLE = False
    logger.warning(
        "sacrebleu not installed. Classic metrics (BLEU, chrF, TER) will not work. "
        "Install with: pip install sacrebleu"
    )

try:
    from comet import download_model, load_from_checkpoint
    COMET_AVAILABLE = True
except ImportError:
    COMET_AVAILABLE = False
    logger.debug("COMET not installed. COMET metric will be unavailable.")


def compute_corpus_bleu(
    references: List[List[str]],
    hypotheses: List[str]
) -> Dict[str, Any]:
    """
    Считаем скор BLEU по корпусу

    Args:
        references: List of reference translations per hypothesis.
            Each element is list of reference strings (typically 1 reference).
        hypotheses: List of candidate/hypothesis translations.

    Returns:
        Dictionary with BLEU score details:
        - score: BLEU score (float)
        - precisions: list of n-gram precisions
        - bp: brevity penalty
        - ratio: reference/hypothesis length ratio
        - hyp_len: hypothesis length
        - ref_len: reference length
    """
    if not SACREBLEU_AVAILABLE:
        raise ImportError(
            "sacrebleu not installed. Please install with: pip install sacrebleu"
        )

    if not references or not hypotheses:
        raise ValueError("Empty references or hypotheses list")

    refs = list(zip(*references)) if len(references[0]) > 1 else [r[0] for r in references]

    try:
        bleu = sacrebleu.corpus_bleu(hypotheses, [refs] if isinstance(refs[0], str) else refs)

        return {
            "score": bleu.score,
            "precisions": bleu.precisions,
            "bp": bleu.bp,
            "ratio": bleu.ratio,
            "hyp_len": bleu.sys_len,
            "ref_len": bleu.ref_len,
        }
    except Exception as e:
        logger.error(f"Error computing BLEU: {e}")
        raise


def compute_corpus_chrf(
    references: List[List[str]],
    hypotheses: List[str],
    beta: float = 2.0
) -> Dict[str, Any]:
    """
    аналогично считаем chrF

    Args:
        references: List of reference translations per hypothesis.
        hypotheses: List of candidate/hypothesis translations.
        beta: beta parameter for chrF (default 2.0).

    Returns:
        Dictionary with chrF score details:
        - score: chrF score (float)
        - beta: beta parameter used
        - order: character n-gram order (char_order)
        - char_order: character n-gram order
        - word_order: word n-gram order
        - hyp_len: hypothesis length (may be None if not provided by sacrebleu)
        - ref_len: reference length (may be None if not provided by sacrebleu)
    """
    if not SACREBLEU_AVAILABLE:
        raise ImportError(
            "sacrebleu not installed. Please install with: pip install sacrebleu"
        )

    if not references or not hypotheses:
        raise ValueError("Empty references or hypotheses list")

    refs = list(zip(*references)) if len(references[0]) > 1 else [r[0] for r in references]

    try:
        chrf = sacrebleu.corpus_chrf(
            hypotheses,
            [refs] if isinstance(refs[0], str) else refs,
            beta=beta
        )

        return {
            "score": chrf.score,
            "beta": beta,
            "order": getattr(chrf, 'char_order', None),
            "char_order": getattr(chrf, 'char_order', None),
            "word_order": getattr(chrf, 'word_order', None),
            "hyp_len": getattr(chrf, 'sys_len', None),
            "ref_len": getattr(chrf, 'ref_len', None),
        }
    except Exception as e:
        logger.error(f"Error computing chrF: {e}")
        raise


def compute_corpus_ter(
    references: List[List[str]],
    hypotheses: List[str],
    normalized: bool = True,
    no_punct: bool = True
) -> Dict[str, Any]:
    """
    считаем TER (Translation Edit Rate)

    Args:
        references: List of reference translations per hypothesis.
        hypotheses: List of candidate/hypothesis translations.
        normalized: Whether to normalize (default True).
        no_punct: Whether to remove punctuation (default True).

    Returns:
        Dictionary with TER score details:
        - score: TER score (float) - lower is better
        - num_edits: total number of edits
        - ref_length: total reference length
        - avg_edits: average edits per sentence
        - normalized: whether normalized
        - no_punct: whether punctuation removed
    """
    if not SACREBLEU_AVAILABLE:
        raise ImportError(
            "sacrebleu not installed. Please install with: pip install sacrebleu"
        )

    if not references or not hypotheses:
        raise ValueError("Empty references or hypotheses list")

    refs = list(zip(*references)) if len(references[0]) > 1 else [r[0] for r in references]

    try:
        ter = sacrebleu.corpus_ter(
            hypotheses,
            [refs] if isinstance(refs[0], str) else refs,
            normalized=normalized,
            no_punct=no_punct
        )

        return {
            "score": ter.score,
            "num_edits": ter.num_edits,
            "ref_length": ter.ref_length,
            "avg_edits": ter.num_edits / len(hypotheses) if hypotheses else 0,
            "normalized": normalized,
            "no_punct": no_punct,
        }
    except Exception as e:
        logger.error(f"Error computing TER: {e}")
        raise


def compute_classic_metrics(
    references: List[str],
    hypotheses: List[str],
    sources: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    используем что выше: BLEU, chrF, TER.

    Args:
        references: List of reference translations (one per hypothesis).
        hypotheses: List of candidate/hypothesis translations.
        sources: Optional list of source texts (not used for classic metrics,
            kept for API consistency).

    Returns:
        Dictionary with all classic metrics:
        - bleu: BLEU score details
        - chrf: chrF score details
        - ter: TER score details
        - num_scored_rows: number of rows scored
    """
    if not SACREBLEU_AVAILABLE:
        raise ImportError(
            "sacrebleu not installed. Please install with: pip install sacrebleu"
        )

    if len(references) != len(hypotheses):
        raise ValueError(
            f"References count ({len(references)}) != hypotheses count ({len(hypotheses)})"
        )

    valid_pairs = []
    valid_refs = []
    valid_hyps = []

    for ref, hyp in zip(references, hypotheses):
        if ref and hyp and ref.strip() and hyp.strip():
            valid_pairs.append((ref, hyp))
            valid_refs.append(ref)
            valid_hyps.append(hyp)

    num_scored = len(valid_pairs)
    if num_scored == 0:
        logger.warning("No valid reference-hypothesis pairs for classic metrics")
        return {
            "bleu": None,
            "chrf": None,
            "ter": None,
            "num_scored_rows": 0,
        }

    logger.info(f"Computing classic metrics for {num_scored} valid pairs")

    refs_list = [[ref] for ref in valid_refs]

    try:
        bleu = compute_corpus_bleu(refs_list, valid_hyps)
        chrf = compute_corpus_chrf(refs_list, valid_hyps)
        ter = compute_corpus_ter(refs_list, valid_hyps)

        return {
            "bleu": bleu["score"],
            "bleu_details": bleu,
            "chrf": chrf["score"],
            "chrf_details": chrf,
            "ter": ter["score"],
            "ter_details": ter,
            "num_scored_rows": num_scored,
        }
    except Exception as e:
        logger.error(f"Error computing classic metrics: {e}")
        raise


def compute_comet_metric(
    sources: List[str],
    references: List[str],
    hypotheses: List[str],
    model_name: str = "Unbabel/wmt22-comet-da",
    device: Optional[str] = None
) -> Dict[str, Any]:
    """
    считаем COMET

    Args:
        sources: List of source texts.
        references: List of reference translations.
        hypotheses: List of candidate/hypothesis translations.
        model_name: COMET model to use.
        device: Device to run COMET on (e.g., "cuda:0", "cpu").

    Returns:
        Dictionary with COMET score details:
        - score: COMET score (float)
        - model: model name used
        - num_scored: number of rows scored
        - scores: list of per-sentence scores (optional)

    Raises:
        ImportError: If COMET not installed.
        RuntimeError: If COMET computation fails.
    """
    if not COMET_AVAILABLE:
        raise ImportError(
            "COMET not installed. To use COMET, install with: pip install unbabel-comet"
        )

    if len(sources) != len(references) or len(references) != len(hypotheses):
        raise ValueError(
            f"Length mismatch: sources={len(sources)}, references={len(references)}, "
            f"hypotheses={len(hypotheses)}"
        )

    valid_triples = []
    valid_sources = []
    valid_refs = []
    valid_hyps = []

    for src, ref, hyp in zip(sources, references, hypotheses):
        if src and ref and hyp and src.strip() and ref.strip() and hyp.strip():
            valid_triples.append((src, ref, hyp))
            valid_sources.append(src)
            valid_refs.append(ref)
            valid_hyps.append(hyp)

    num_scored = len(valid_triples)
    if num_scored == 0:
        logger.warning("No valid source-reference-hypothesis triples for COMET")
        return {
            "score": None,
            "model": model_name,
            "num_scored": 0,
            "scores": [],
        }

    logger.info(f"Computing COMET metric for {num_scored} valid triples using {model_name}")

    try:
        model = load_from_checkpoint(download_model(model_name))

        data = [
            {"src": src, "ref": ref, "mt": hyp}
            for src, ref, hyp in zip(valid_sources, valid_refs, valid_hyps)
        ]

        if device:
            model.to(device)

        #пупупупупу
        predict_args = {"samples": data, "batch_size": 32}
        if device:
            import inspect

            sig = inspect.signature(model.predict)
            params = sig.parameters

            if 'device' in params:
                predict_args['device'] = device

            elif 'devices' in params:
                predict_args['devices'] = 1

        predictions = model.predict(**predict_args)

        comet_score = predictions["system_score"]
        seg_scores = predictions["seg_scores"] if "seg_scores" in predictions else []

        return {
            "score": comet_score,
            "model": model_name,
            "num_scored": num_scored,
            "scores": seg_scores,
        }
    except Exception as e:
        logger.error(f"Error computing COMET metric: {e}")
        raise RuntimeError(f"COMET computation failed: {e}")


def compute_classic_metrics_with_comet(
    sources: List[str],
    references: List[str],
    hypotheses: List[str],
    with_comet: bool = False,
    comet_model: str = "Unbabel/wmt22-comet-da"
) -> Dict[str, Any]:
    """
    Все метрики по переводам

    Args:
        sources: List of source texts.
        references: List of reference translations.
        hypotheses: List of candidate/hypothesis translations.
        with_comet: Whether to compute COMET metric.
        comet_model: COMET model to use if with_comet=True.

    Returns:
        Dictionary with classic metrics and optional COMET.
        - classic: classic metrics (BLEU, chrF, TER)
        - comet: COMET metric details (if with_comet=True and COMET available)
        - comet_available: boolean indicating if COMET was computed
        - comet_error: error message if COMET failed (optional)
    """
    classic_result = compute_classic_metrics(references, hypotheses, sources)

    result = {
        "classic": classic_result,
        "comet_available": False,
        "comet": None,
    }

    if with_comet:
        if COMET_AVAILABLE:
            try:
                comet_result = compute_comet_metric(
                    sources, references, hypotheses, model_name=comet_model
                )
                result["comet"] = comet_result
                result["comet_available"] = True
            except Exception as e:
                logger.warning(f"COMET computation failed: {e}")
                result["comet_error"] = str(e)
        else:
            logger.warning(
                "COMET requested but not installed. "
                "Install with: pip install unbabel-comet"
            )
            result["comet_error"] = "COMET not installed"

    return result