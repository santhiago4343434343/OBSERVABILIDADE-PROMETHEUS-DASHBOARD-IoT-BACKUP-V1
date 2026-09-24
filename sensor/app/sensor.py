"""
Sensor IoT simulado — exporter Prometheus.

Simula 2 sensores (temperatura em °C e umidade em %) fazendo um "random walk"
(passeio aleatório) suave, e expõe os valores em /metrics no formato Prometheus.

A sacada de IoT está aqui: o Prometheus faz scrape deste /metrics do MESMO jeito
que faz no backend. A engrenagem (scrape -> série temporal -> gráfico/alerta) é
idêntica; a única diferença é a FONTE do dado — aqui é um sensor, lá era latência
HTTP. Trocar este arquivo por um sensor real (GPIO, MQTT, etc.) não muda o resto.
"""

import asyncio
import random
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, Gauge, generate_latest

# --- Métricas expostas ao Prometheus ---------------------------------------
# O label "sensor" permite ter vários sensores dentro da mesma métrica.
TEMPERATURA = Gauge(
    "sensor_temperatura_celsius",
    "Temperatura lida pelo sensor (graus Celsius)",
    ["sensor"],
)
UMIDADE = Gauge(
    "sensor_umidade_percent",
    "Umidade relativa lida pelo sensor (%)",
    ["sensor"],
)

# Estado interno de cada sensor (o valor atual do random walk)
_SENSORES: dict[str, dict[str, float]] = {
    "sala-servidores": {"temp": 24.0, "umid": 45.0},
    "area-externa": {"temp": 22.0, "umid": 60.0},
}

INTERVALO_LEITURA_S = 2.0


def _passo(valor: float, delta: float, minimo: float, maximo: float) -> float:
    """Random walk: soma uma variação pequena e mantém dentro de [minimo, maximo]."""
    novo = valor + random.uniform(-delta, delta)
    return max(minimo, min(maximo, novo))


def _ler_sensores() -> None:
    """Gera uma nova leitura de cada sensor e atualiza as métricas Prometheus."""
    for nome, estado in _SENSORES.items():
        estado["temp"] = _passo(estado["temp"], 0.4, 18.0, 32.0)
        estado["umid"] = _passo(estado["umid"], 0.8, 30.0, 80.0)
        TEMPERATURA.labels(sensor=nome).set(round(estado["temp"], 2))
        UMIDADE.labels(sensor=nome).set(round(estado["umid"], 2))


async def _loop_leitura() -> None:
    while True:
        _ler_sensores()
        await asyncio.sleep(INTERVALO_LEITURA_S)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _ler_sensores()  # primeira leitura imediata, pra /metrics já vir populado
    tarefa = asyncio.create_task(_loop_leitura())
    yield
    tarefa.cancel()


app = FastAPI(title="Sensor IoT (simulado) - exporter", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
