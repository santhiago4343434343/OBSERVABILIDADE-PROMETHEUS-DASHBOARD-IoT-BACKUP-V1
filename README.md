# Painel de Observabilidade — v1 (IoT + infraestrutura)

Monitora **sensores IoT** (temperatura/umidade), **CPU/memória** da máquina,
**latência/jitter** do backend e a **disponibilidade** do METEORA e do TRIP.

## Serviços (o que cada um faz)

- `sensor/` — exporter IoT em Python (temperatura/umidade simuladas) em `/metrics`.
- `backend/` — FastAPI: mede latência/jitter e agrega tudo pro frontend
  (`/api/status` = estado atual, `/api/series` = histórico).
- `node-exporter` — métricas REAIS da máquina **Linux** (VM do WSL2/Docker): CPU, RAM, disco.
- `windows_exporter` — métricas do **Windows** (o "Gerenciador de Tarefas"). Roda NATIVO
  no Windows (não é container); o painel só o consome.
- `prometheus/` — coleta tudo isso e manda o blackbox checar METEORA/TRIP.
- `blackbox/` + `blackbox-exporter` — `tcp_connect` (IPv4) no METEORA e no TRIP.
- `frontend/` — dashboard Angular 18 + Tailwind v4.

## Métricas da máquina (node_exporter + windows_exporter)

| Fonte | O que mede | Onde roda | Porta |
|---|---|---|---|
| node_exporter   | CPU/RAM/disco do **Linux** (WSL2/Docker) | container (já no compose) | 9100 |
| windows_exporter | CPU/RAM/disco do **Windows** | nativo no Windows (você instala) | 9182 |

**Instalar o windows_exporter (uma vez):** baixe o instalador oficial em
`https://github.com/prometheus-community/windows_exporter/releases` (arquivo `.msi`)
e instale já habilitando os coletores que o painel usa:

```powershell
msiexec /i windows_exporter-X.Y.Z-amd64.msi ENABLED_COLLECTORS="cpu,cs,memory,logical_disk,net,os"
```

Ele vira um serviço do Windows na porta 9182. Teste abrindo `http://localhost:9182/metrics`.
Enquanto não instalar, o card "Windows" fica em branco (`—`) — é esperado.

## Como rodar

```bash
docker compose up --build
```

- **Dashboard:** http://localhost:8080
- Prometheus: http://localhost:9090 → **Status > Targets**
  - `node-exporter` fica "UP" na hora; `windows-exporter` só depois de instalado.
- Backend: http://localhost:8010/health

> As barras de CPU/RAM levam ~1 min pra aparecer: a % é calculada com `rate()` sobre
> a série, então precisa de um pouquinho de histórico.

## O que ainda falta

- **Bloco 2:** alertas automáticos + **GitHub Actions** (CI/CD).
- Depois: Kubernetes/k3s (Projeto 2) e camada de IA.
# OBSERVABILIDADE-ALERT-PROMETHEUS-ALERTMANAGER-V1-BACKUP
