# localization_translator/cli.py
from .config import load_config
from .translator_core import Translator
from .cache_utils import load_cache, save_cache
from .db_worker import translate_database


def main():
    cfg = load_config()
    tr = Translator(cfg)
    cache = load_cache(cfg.cache_path)

    try:
        translate_database(cfg, tr, cache)
    except KeyboardInterrupt:
        print(
            "\nОстановлено пользователем. Прогресс сохранён в translated_texts и кэше."
        )
        save_cache(cfg.cache_path, cache)
    except Exception as e:
        print(
            f"\nОшибка: {e}\nПрогресс сохранён в кэше (и в БД на уже обработанных строках)."
        )
        save_cache(cfg.cache_path, cache)
        raise