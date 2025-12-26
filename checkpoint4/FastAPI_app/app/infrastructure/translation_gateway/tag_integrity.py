from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


# $VAR$, $VALUE|Y$, $NUM|2%$, ...
DOLLAR_VAR_RE = re.compile(r"\$[A-Za-z0-9_\|\.\+\-\%]+\$")
# £icon£
POUND_ICON_RE = re.compile(r"£[^£\s]+£")
# [Root.GetAdj], [This.GetName], [Root.Owner.GetSpecies.GetName], ...
SCRIPT_TAG_RE = re.compile(r"\[[^\]]+\]")
# §Y, §G, ...
COLOR_OPEN_RE = re.compile(r"§[A-Z]")
# §!
COLOR_CLOSE_RE = re.compile(r"§!")


@dataclass
class ColorSpan:
    start: int  # позиция по символам (начало маркера открытия)
    end: int    # позиция по символам (начало маркера закрытия)
    code: str   # буква цвета, например 'Y'


@dataclass
class TagToken:
    start: int
    end: int
    kind: str         # 'color_open', 'color_close', 'dollar', 'pound', 'script'
    payload: str = "" # код цвета / имя переменной / имя иконки / тело скрипта


@dataclass
class TagNode:
    kind: str
    value: Optional[str] = None
    children: List["TagNode"] = field(default_factory=list)


@dataclass
class TagSummary:
    root: TagNode

    n_color_spans: int
    n_color_open: int
    n_color_close: int
    n_dollar_vars: int
    n_pound_icons: int
    n_script_tags: int
    color_spans: List[ColorSpan]

    malformed_colors: bool
    malformed_placeholders: bool
    malformed_icons: bool
    malformed_scripts: bool

    @property
    def malformed_any(self) -> bool:
        """
        Purpose:
            Быстрый флаг "разметка сломана" (компилируемость).

        Input:
            None.

        Output:
            bool — True если есть явные ошибки разметки.

        Side Effects:
            Нет.

        Notes:
            Используется compilability_score().
        """
        return (
            self.malformed_colors
            or self.malformed_placeholders
            or self.malformed_icons
            or self.malformed_scripts
        )


def detect_illegal_nesting(text: str) -> Tuple[bool, bool, bool]:
    """
    Проверяет, есть ли внутри атомарных тегов ($...$, £...£, [....])
    какие-либо другие теги.
    Разрешённые вложения:
      - любые теги внутри цветового тега §X ... §!
    Запрещенные:
      - любой тег внутри $...$
      - любой тег внутри £...£
      - любой тег внутри [....]
    """
    tokens = extract_tag_tokens(text)

    malformed_placeholders = False
    malformed_icons = False
    malformed_scripts = False

    for i, outer in enumerate(tokens):
        if outer.kind not in ("dollar", "pound", "script"):
            continue

        for j, inner in enumerate(tokens):
            if i == j:
                continue

            if outer.start <= inner.start and inner.end <= outer.end:
                if outer.kind == "dollar":
                    malformed_placeholders = True
                elif outer.kind == "pound":
                    malformed_icons = True
                elif outer.kind == "script":
                    malformed_scripts = True

    return malformed_placeholders, malformed_icons, malformed_scripts


def summarize_tags(text: str) -> TagSummary:
    """
    Строит сводку по тегам в строке и проверяет побитость разметки.
    Здесь же строится дерево тегов.
    """
    color_spans, malformed_colors_spans = find_color_spans(text)

    root, malformed_colors_tree = build_tag_tree(text)
    malformed_colors = malformed_colors_spans or malformed_colors_tree

    n_dollar = len(DOLLAR_VAR_RE.findall(text))
    n_pound = len(POUND_ICON_RE.findall(text))
    n_script = len(SCRIPT_TAG_RE.findall(text))

    n_color_open = len(COLOR_OPEN_RE.findall(text))
    n_color_close = len(COLOR_CLOSE_RE.findall(text))

    malformed_placeholders, malformed_icons, malformed_scripts = detect_illegal_nesting(text)

    return TagSummary(
        root=root,
        n_color_spans=len(color_spans),
        n_color_open=n_color_open,
        n_color_close=n_color_close,
        n_dollar_vars=n_dollar,
        n_pound_icons=n_pound,
        n_script_tags=n_script,
        color_spans=color_spans,
        malformed_colors=malformed_colors,
        malformed_placeholders=malformed_placeholders,
        malformed_icons=malformed_icons,
        malformed_scripts=malformed_scripts,
    )


def find_color_spans(text: str) -> Tuple[List[ColorSpan], bool]:
    """
    Находит пары §X ... §! и возвращает список spans.
    malformed=True если есть незакрытые/лишние цветовые теги.
    """
    tokens = extract_tag_tokens(text)
    spans: List[ColorSpan] = []

    stack: List[TagToken] = []
    malformed = False

    for tok in tokens:
        if tok.kind == "color_open":
            stack.append(tok)
        elif tok.kind == "color_close":
            if not stack:
                malformed = True
                continue
            open_tok = stack.pop()
            spans.append(ColorSpan(start=open_tok.start, end=tok.start, code=open_tok.payload))

    if stack:
        malformed = True

    return spans, malformed


def extract_tag_tokens(text: str) -> List[TagToken]:
    """
    Извлекает токены всех типов тегов с позициями в тексте.
    """
    tokens: List[TagToken] = []

    for m in COLOR_OPEN_RE.finditer(text):
        tokens.append(TagToken(start=m.start(), end=m.end(), kind="color_open", payload=m.group()[1]))

    for m in COLOR_CLOSE_RE.finditer(text):
        tokens.append(TagToken(start=m.start(), end=m.end(), kind="color_close"))

    for m in DOLLAR_VAR_RE.finditer(text):
        tokens.append(TagToken(start=m.start(), end=m.end(), kind="dollar", payload=m.group()))

    for m in POUND_ICON_RE.finditer(text):
        tokens.append(TagToken(start=m.start(), end=m.end(), kind="pound", payload=m.group()))

    for m in SCRIPT_TAG_RE.finditer(text):
        tokens.append(TagToken(start=m.start(), end=m.end(), kind="script", payload=m.group()))

    tokens.sort(key=lambda x: x.start)
    return tokens


def build_tag_tree(text: str) -> Tuple[TagNode, bool]:
    """
    Строит дерево вложенности тегов.
    malformed=True если структура цветовых тегов нарушена (лишний §! / незакрытый §X).
    """
    tokens = extract_tag_tokens(text)
    root = TagNode(kind="root")
    stack: List[TagNode] = [root]

    malformed = False

    for tok in tokens:
        if tok.kind == "color_open":
            node = TagNode(kind="color", value=tok.payload)
            stack[-1].children.append(node)
            stack.append(node)
        elif tok.kind == "color_close":
            if len(stack) <= 1:
                malformed = True
            else:
                stack.pop()
        elif tok.kind == "dollar":
            stack[-1].children.append(TagNode(kind="dollar", value=tok.payload))
        elif tok.kind == "pound":
            stack[-1].children.append(TagNode(kind="pound", value=tok.payload))
        elif tok.kind == "script":
            stack[-1].children.append(TagNode(kind="script", value=tok.payload))

    if len(stack) != 1:
        malformed = True

    return root, malformed


def tag_type_recall(ref: TagSummary, cand: TagSummary) -> Dict[str, float]:
    """
    Recall по наличию тегов каждого типа.
    Штрафует за отсутствие тега в кандидате.
    """
    def safe_recall(gold: int, pred: int) -> float:
        if gold == 0:
            return 1.0
        return max(0.0, min(1.0, pred / gold))

    return {
        "color_spans": safe_recall(ref.n_color_spans, cand.n_color_spans),
        "dollar_vars": safe_recall(ref.n_dollar_vars, cand.n_dollar_vars),
        "pound_icons": safe_recall(ref.n_pound_icons, cand.n_pound_icons),
        "script_tags": safe_recall(ref.n_script_tags, cand.n_script_tags),
    }


def weighted_tag_content_score(ref: TagSummary, cand: TagSummary) -> float:
    """
    Оценивает сохранность тегов по типам, с разными весами:
    выделение (цвет) < иконка < подстановка/скрипт.
    """
    recalls = tag_type_recall(ref, cand)

    weights = {
        "color_spans": 1.0,  # выделение
        "pound_icons": 2.0,  # иконки
        "dollar_vars": 3.0,  # подстановки
        "script_tags": 3.0,  # скрипты
    }

    num = 0.0
    den = 0.0
    for t, w in weights.items():
        num += w * recalls[t]
        den += w
    if den == 0:
        return 1.0
    return num / den


def collect_tag_paths(node: TagNode, prefix: Tuple[str, ...], paths: Counter) -> None:
    """
    Собирает пути вида ("color:Y", "dollar:$VAR$") для всех листьев/тегов.
    root сам по себе не учитываем как шаг пути.
    """
    if node.kind == "root":
        cur_prefix = prefix
    else:
        label = f"{node.kind}:{node.value}" if node.value is not None else node.kind
        cur_prefix = prefix + (label,)

    if not node.children:
        if cur_prefix:
            paths[cur_prefix] += 1
    else:
        for ch in node.children:
            collect_tag_paths(ch, cur_prefix, paths)


def tree_structure_score(ref_root: TagNode, cand_root: TagNode) -> float:
    """
    Сравниваем структуры деревьев тегов:
    строим мультисеты путей и считаем recall относительно рефа.
    """
    ref_paths: Counter = Counter()
    cand_paths: Counter = Counter()

    collect_tag_paths(ref_root, tuple(), ref_paths)
    collect_tag_paths(cand_root, tuple(), cand_paths)

    if not ref_paths:
        # В рефе тегов нет – структура не важна
        return 1.0

    intersect = 0
    total = sum(ref_paths.values())
    for p, cnt_ref in ref_paths.items():
        cnt_cand = cand_paths.get(p, 0)
        intersect += min(cnt_ref, cnt_cand)

    return max(0.0, min(1.0, intersect / total))


def tag_structure_score(ref: TagSummary, cand: TagSummary) -> float:
    """
    Структурное сходство дерева тегов:
    учитывает, какие теги вложены в какие цвета и в каком контексте находятся.
    """
    return tree_structure_score(ref.root, cand.root)


def compilability_score(tags: TagSummary) -> float:
    """
    1.0 если нет явных ошибок разметки (по типам тегов),
    0.0 если есть.
    """
    return 0.0 if tags.malformed_any else 1.0


@dataclass(frozen=True)
class TagIntegrityScores:
    """
    Purpose:
        Результат расчёта качества по тегам (без ML/COMET).

    Input:
        ref: str — исходный текст.
        cand: str — результат перевода.

    Output:
        tag_content: float
        tag_struct: float
        tag_score: float
        comp_score: float
        final: float

    Side Effects:
        Нет.
    """
    tag_content: float
    tag_struct: float
    tag_score: float
    comp_score: float
    final: float


def compute_tag_integrity(ref: str, cand: str) -> TagIntegrityScores:
    """
    Purpose:
        Посчитать итоговый скор качества по тегам.

    Input:
        ref: str — исходный текст.
        cand: str — перевод (кандидат).

    Output:
        TagIntegrityScores — набор промежуточных и финальных скоров.

    Side Effects:
        Нет.

    Notes:
        # Качество перевода

        # Теги
        ref_tags = summarize_tags(ref)
        cand_tags = summarize_tags(cand)

        tag_content = weighted_tag_content_score(ref_tags, cand_tags)
        tag_struct = tag_structure_score(ref_tags, cand_tags)

        # Контент тегов важнее структуры, но оба учитываем
        tag_score = 0.6 * tag_content + 0.4 * tag_struct

        # Компилируемость (запустится / не запустится)
        comp_score = compilability_score(cand_tags)

        # Финальный скор
        final = comp_score * tag_score
    """
    ref_tags = summarize_tags(ref)
    cand_tags = summarize_tags(cand)

    tag_content = weighted_tag_content_score(ref_tags, cand_tags)
    tag_struct = tag_structure_score(ref_tags, cand_tags)

    tag_score = 0.6 * tag_content + 0.4 * tag_struct
    comp_score = compilability_score(cand_tags)
    final = comp_score * tag_score

    return TagIntegrityScores(
        tag_content=tag_content,
        tag_struct=tag_struct,
        tag_score=tag_score,
        comp_score=comp_score,
        final=final,
    )