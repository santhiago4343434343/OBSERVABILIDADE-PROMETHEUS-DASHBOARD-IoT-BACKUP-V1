import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface RotaStatus {
  latencia_media_ms: number;
  jitter_ms: number;
  amostras: number;
}

export interface SensorAtual {
  sensor: string;
  temperatura_c: number;
  umidade_pct: number;
}

export interface ServicoExterno {
  instance: string;
  disponivel: boolean;
  ping_ms: number;
}

// Métricas de uma máquina (CPU/RAM em %). null = ainda sem dado.
export interface MaquinaInfra {
  cpu_pct: number | null;
  ram_pct: number | null;
}

export interface Infra {
  linux: MaquinaInfra;
  windows: MaquinaInfra;
}

export interface StatusResponse {
  backend: Record<string, RotaStatus>;
  sensores: SensorAtual[];
  servicos_externos: ServicoExterno[];
  infra: Infra;
}

export interface SerieTempo {
  nome: string;
  pontos: [number, number][];
}

export interface SeriesResponse {
  minutos: number;
  temperatura: SerieTempo[];
  umidade: SerieTempo[];
}

@Injectable({ providedIn: 'root' })
export class StatusService {
  constructor(private http: HttpClient) {}

  obterStatus(): Observable<StatusResponse> {
    return this.http.get<StatusResponse>('/api/status');
  }

  obterSeries(minutos = 15): Observable<SeriesResponse> {
    const params = new HttpParams().set('minutos', minutos);
    return this.http.get<SeriesResponse>('/api/series', { params });
  }
}
