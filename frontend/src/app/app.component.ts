import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, catchError, interval, of, startWith, switchMap } from 'rxjs';
import {
  Infra,
  SensorAtual,
  SerieTempo,
  ServicoExterno,
  StatusResponse,
  StatusService,
} from './services/status.service';
import {
  GraficoTemporalComponent,
  SerieChart,
} from './components/grafico-temporal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, GraficoTemporalComponent],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {
  status: StatusResponse | null = null;
  erro = false;

  seriesTemperatura: SerieChart[] = [];
  seriesUmidade: SerieChart[] = [];

  private readonly PALETA = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];

  private assinaturaStatus?: Subscription;
  private assinaturaSeries?: Subscription;
  private readonly STATUS_MS = 5000;
  private readonly SERIES_MS = 10000;

  constructor(private statusService: StatusService) {}

  ngOnInit(): void {
    this.assinaturaStatus = interval(this.STATUS_MS)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.statusService.obterStatus().pipe(
            catchError(() => {
              this.erro = true;
              return of(null);
            }),
          ),
        ),
      )
      .subscribe((dados) => {
        if (dados) {
          this.status = dados;
          this.erro = false;
        }
      });

    this.assinaturaSeries = interval(this.SERIES_MS)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.statusService.obterSeries(15).pipe(catchError(() => of(null))),
        ),
      )
      .subscribe((dados) => {
        if (dados) {
          this.seriesTemperatura = this.paraChart(dados.temperatura);
          this.seriesUmidade = this.paraChart(dados.umidade);
        }
      });
  }

  ngOnDestroy(): void {
    this.assinaturaStatus?.unsubscribe();
    this.assinaturaSeries?.unsubscribe();
  }

  private paraChart(series: SerieTempo[]): SerieChart[] {
    return [...series]
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map((s, i) => ({
        nome: s.nome,
        cor: this.PALETA[i % this.PALETA.length],
        pontos: s.pontos.map(([t, v]) => ({ t, v })),
      }));
  }

  get rotasBackend(): [string, StatusResponse['backend'][string]][] {
    return this.status ? Object.entries(this.status.backend) : [];
  }

  get sensores(): SensorAtual[] {
    return this.status?.sensores ?? [];
  }

  get servicosExternos(): ServicoExterno[] {
    return this.status?.servicos_externos ?? [];
  }

  get infra(): Infra | null {
    return this.status?.infra ?? null;
  }
}
