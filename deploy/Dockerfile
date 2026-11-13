# Сайт + API одним образом. Сборка из корня репозитория:  docker build -f deploy/Dockerfile -t 404 .
FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY brand ./brand
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
COPY web ./web
# ключ Яндекс Карт вшивается в сборку сайта (JS API); ограничьте его по адресу сайта в кабинете Яндекса
ARG VITE_YANDEX_MAPS_KEY=""
ENV VITE_YANDEX_MAPS_KEY=$VITE_YANDEX_MAPS_KEY
RUN cd web && npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DATA_DIR=/data DEMO=0 SIM_HEARTBEAT=0
WORKDIR /app
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY api/app api/app
COPY --from=web /src/web/dist web/dist
RUN useradd --system --uid 10001 app && mkdir -p /data && chown app /data
USER app
WORKDIR /app/api
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--ws-max-size", "65536", "--proxy-headers", "--forwarded-allow-ips", "*"]
