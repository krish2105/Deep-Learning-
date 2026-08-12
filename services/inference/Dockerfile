# Hugging Face Space (Docker SDK). Free CPU tier: 2 vCPU, 16 GB RAM.
# HF Spaces require the app to listen on port 7860.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/tmp/hf \
    TORCH_HOME=/tmp/torch \
    XDG_CACHE_HOME=/tmp/cache

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Spaces run as UID 1000 and only /tmp is writable — torchxrayvision downloads
# its weights at first use, so its cache must live there.
RUN mkdir -p /tmp/hf /tmp/torch /tmp/cache && chmod -R 777 /tmp

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
