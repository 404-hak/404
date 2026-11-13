"""Ограничение частоты запросов в памяти процесса (docs/audit/01-security.md S6): вход и лаборатория нейросети."""
from __future__ import annotations

import time
from collections import defaultdict, deque


class Limiter:
    """Не больше `limit` событий за `window` секунд на ключ (адрес, логин)."""

    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def _trim(self, key: str, now: float) -> deque[float]:
        q = self.hits[key]
        while q and q[0] <= now - self.window:
            q.popleft()
        return q

    def allow(self, key: str) -> bool:
        """Учесть попытку; False — предел исчерпан."""
        now = time.monotonic()
        q = self._trim(key, now)
        if len(q) >= self.limit:
            return False
        q.append(now)
        if len(self.hits) > 10_000:                    # не копим ключи бесконечно
            for k in [k for k, v in self.hits.items() if not v][:5000]:
                self.hits.pop(k, None)
        return True

    def blocked(self, key: str) -> bool:
        """Предел уже исчерпан (не учитывая новую попытку)."""
        return len(self._trim(key, time.monotonic())) >= self.limit

    def retry_after(self, key: str) -> int:
        q = self.hits.get(key)
        return max(1, int(q[0] + self.window - time.monotonic()) + 1) if q else 1

    def reset(self, key: str) -> None:
        self.hits.pop(key, None)
