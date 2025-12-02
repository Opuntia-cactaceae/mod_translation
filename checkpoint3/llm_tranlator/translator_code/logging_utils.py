# localization_translator/logging_utils.py
import datetime


def write_log(message: str, filename: str = "app.log"):
    """
    Простой логгер в файл с таймстампом.
    """
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"[{timestamp}] {message}\n"
    with open(filename, "a", encoding="utf-8") as log_file:
        log_file.write(log_entry)