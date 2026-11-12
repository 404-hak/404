"""Тесты не трогают рабочую базу: данные — во временной папке, без похода в Open-Meteo."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="404-test-"))
os.environ.setdefault("WEATHER", "0")
