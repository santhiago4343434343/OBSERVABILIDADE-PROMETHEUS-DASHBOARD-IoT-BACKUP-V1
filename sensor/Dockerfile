# Imagem enxuta do Python
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8001

# Exporter do sensor: escuta na porta 8001 (o Prometheus faz scrape em /metrics)
CMD ["uvicorn", "app.sensor:app", "--host", "0.0.0.0", "--port", "8001"]
