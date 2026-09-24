"""
Painel de Observabilidade — backend FastAPI (v1)

Responsabilidades desta v1:
- Expor métricas no formato Prometheus em /metrics
- Medir latência de cada requisição HTTP (histograma) e jitter (janela deslizante)
- Agregar, para o frontend, o estado atual (/api/status) e o histórico (/api/series)
  de latência, sensores, disponibilidade e infraestrutura (CPU/RAM da máquina)
"""

import os
import statistics
import time
from collections import defaultdict, deque

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Gauge,
    Histogram,
    generate_latest,
)

app = FastAPI(title="Painel de Observabilidade - API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")

# --- Métricas Prometheus ---------------------------------------------------

REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "Duração das requisições HTTP em segundos",
    ["method", "path"],
)

REQUEST_JITTER = Gauge(
    "http_request_jitter_seconds",
    "Variação (desvio padrão) da latência das últimas N requisições por rota",
    ["path"],
)

JANELA_TAMANHO = 20
_latencias_recentes: dict[str, deque[float]] = defaultdict(
    lambda: deque(maxlen=JANELA_TAMANHO)
)


def _calcular_jitter(path: str, duracao: float) -> None:
    janela = _latencias_recentes[path]
    janela.append(duracao)
    if len(janela) >= 2:
        REQUEST_JITTER.labels(path=path).set(statistics.stdev(janela))


@app.middleware("http")
async def medir_latencia_e_jitter(request: Request, call_next):
    inicio = time.perf_counter()
    response = await call_next(request)
    duracao = time.perf_counter() - inicio

    path = request.url.path
    REQUEST_LATENCY.labels(method=request.method, path=path).observe(duracao)
    _calcular_jitter(path, duracao)

    return response


# --- Endpoints básicos -------------------------------------------------------


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/")
async def root():
    return {"service": "painel-observabilidade-api", "docs": "/docs"}


# --- Consultas ao Prometheus -------------------------------------------------


async def _consultar_prometheus(query: str) -> list[dict]:
    """Consulta instantânea (/api/v1/query). Retorna [] em caso de falha."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.get(
                f"{PROMETHEUS_URL}/api/v1/query", params={"query": query}
            )
            resp.raise_for_status()
            return resp.json().get("data", {}).get("result", [])
        except Exception:
            return []


async def _consultar_valor(query: str) -> float | None:
    """Consulta que espera UM número só (ex.: '% de CPU'). Retorna None se falhar."""
    resultado = await _consultar_prometheus(query)
    if resultado:
        try:
            return round(float(resultado[0]["value"][1]), 1)
        except (KeyError, IndexError, ValueError):
            return None
    return None


async def _consultar_prometheus_range(
    query: str, minutos: int = 15, passo_s: int = 15
) -> list[dict]:
    """Consulta em intervalo (/api/v1/query_range): a série ao longo do tempo."""
    fim = time.time()
    inicio = fim - minutos * 60
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.get(
                f"{PROMETHEUS_URL}/api/v1/query_range",
                params={
                    "query": query,
                    "start": inicio,
                    "end": fim,
                    "step": f"{passo_s}s",
                },
            )
            resp.raise_for_status()
            return resp.json().get("data", {}).get("result", [])
        except Exception:
            return []


def _formatar_series(resultado: list[dict], label: str) -> list[dict]:
    series = []
    for item in resultado:
        nome = item["metric"].get(label, "?")
        pontos = [
            [float(ts), round(float(valor), 2)]
            for ts, valor in item.get("values", [])
        ]
        series.append({"nome": nome, "pontos": pontos})
    return series


# --- PromQL da infraestrutura (CPU/RAM em %) ---------------------------------
# CPU vem como contador (só cresce), então a % se calcula com rate() no tempo.

Q_LINUX_CPU = '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)'
Q_LINUX_RAM = (
    "100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)"
)
Q_WIN_CPU = '100 - (avg(rate(windows_cpu_time_total{mode="idle"}[1m])) * 100)'
Q_WIN_RAM = (
    "100 * (1 - windows_memory_available_bytes / windows_memory_physical_total_bytes)"
)


# --- Estado atual (instantâneo) ----------------------------------------------


@app.get("/api/status")
async def status():
    """
    Estado ATUAL consumido pelo frontend:
    {
      "backend": {...}, "sensores": [...], "servicos_externos": [...],
      "infra": { "linux": {cpu_pct, ram_pct}, "windows": {cpu_pct, ram_pct} }
    }
    """
    backend_status = {
        path: {
            "latencia_media_ms": round(statistics.mean(janela) * 1000, 2),
            "jitter_ms": round(statistics.stdev(janela) * 1000, 2)
            if len(janela) >= 2
            else 0.0,
            "amostras": len(janela),
        }
        for path, janela in _latencias_recentes.items()
        if janela
    }

    # Sensores IoT (leitura atual)
    temp_atual = await _consultar_prometheus("sensor_temperatura_celsius")
    umid_atual = await _consultar_prometheus("sensor_umidade_percent")
    umid_por_sensor = {
        item["metric"].get("sensor"): float(item["value"][1]) for item in umid_atual
    }
    sensores = [
        {
            "sensor": item["metric"].get("sensor"),
            "temperatura_c": round(float(item["value"][1]), 1),
            "umidade_pct": round(
                umid_por_sensor.get(item["metric"].get("sensor"), 0.0), 1
            ),
        }
        for item in temp_atual
    ]

    # Serviços externos (ping/tcp_connect via blackbox)
    probe_success = await _consultar_prometheus("probe_success")
    probe_duration = await _consultar_prometheus("probe_duration_seconds")
    duracao_por_instancia = {
        item["metric"].get("instance"): float(item["value"][1])
        for item in probe_duration
    }
    servicos_externos = [
        {
            "instance": item["metric"].get("instance"),
            "disponivel": bool(int(item["value"][1])),
            "ping_ms": round(
                duracao_por_instancia.get(item["metric"].get("instance"), 0) * 1000, 2
            ),
        }
        for item in probe_success
    ]

    # Infraestrutura (CPU/RAM reais). Fica null enquanto não houver dado
    # (ex.: windows_exporter não instalado, ou < 1 min de coleta pro rate()).
    infra = {
        "linux": {
            "cpu_pct": await _consultar_valor(Q_LINUX_CPU),
            "ram_pct": await _consultar_valor(Q_LINUX_RAM),
        },
        "windows": {
            "cpu_pct": await _consultar_valor(Q_WIN_CPU),
            "ram_pct": await _consultar_valor(Q_WIN_RAM),
        },
    }

    return {
        "backend": backend_status,
        "sensores": sensores,
        "servicos_externos": servicos_externos,
        "infra": infra,
    }


# --- Histórico (séries temporais) --------------------------------------------


@app.get("/api/series")
async def series(minutos: int = 15):
    """Histórico dos últimos N minutos (temperatura e umidade por sensor)."""
    temp = await _consultar_prometheus_range("sensor_temperatura_celsius", minutos)
    umid = await _consultar_prometheus_range("sensor_umidade_percent", minutos)
    return {
        "minutos": minutos,
        "temperatura": _formatar_series(temp, "sensor"),
        "umidade": _formatar_series(umid, "sensor"),
    }
