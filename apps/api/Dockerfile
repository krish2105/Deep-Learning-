# Optional container for the orchestrator. Render's native Python runtime is
# simpler and is what render.yaml uses; this exists for local parity and for
# platforms that require an image.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root: the container writes nothing outside /tmp at runtime.
RUN useradd -m -u 1000 sentinel && chown -R sentinel:sentinel /app
USER sentinel

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/api/v1/health')"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
