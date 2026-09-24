import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';

/** Um ponto no tempo: t = timestamp em segundos, v = valor lido. */
export interface PontoChart {
  t: number;
  v: number;
}

/** Uma linha do gráfico (um sensor), já com a cor definida. */
export interface SerieChart {
  nome: string;
  cor: string;
  pontos: PontoChart[];
}

interface LinhaVM {
  nome: string;
  cor: string;
  d: string; // atributo "d" do <path>
  pts: { x: number; y: number; v: number }[];
  fimX: number;
  fimY: number;
}

interface TickY {
  y: number;
  rotulo: string;
}
interface TickX {
  x: number;
  rotulo: string;
}
interface HoverPonto {
  nome: string;
  cor: string;
  x: number;
  y: number;
  valor: number;
}

/**
 * Gráfico de linha em SVG puro (sem biblioteca externa).
 * Recebe uma ou mais séries temporais e desenha: grade, eixos, linhas (2px),
 * ponto final, legenda, e uma "mira" (crosshair) + tooltip ao passar o mouse.
 *
 * Princípios de dataviz aplicados: linhas finas, grade discreta em tom sobre a
 * superfície, texto em tom neutro (nunca na cor da série), legenda sempre
 * presente pra 2+ séries, e um eixo só.
 */
@Component({
  selector: 'app-grafico-temporal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure class="m-0">
      <figcaption class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm font-medium text-slate-200">{{ titulo }}</span>
        <!-- Legenda: chave de cor + nome (a cor vive no traço, o texto fica neutro) -->
        <span class="flex flex-wrap items-center gap-4">
          <span *ngFor="let l of linhas" class="flex items-center gap-1.5 text-xs text-slate-400">
            <span class="inline-block h-0.5 w-4 rounded-full" [style.background-color]="l.cor"></span>
            {{ l.nome }}
          </span>
        </span>
      </figcaption>

      <div class="relative w-full">
        <svg
          #svg
          viewBox="0 0 720 260"
          class="w-full"
          (mousemove)="aoMover($event, svg)"
          (mouseleave)="aoSair()"
        >
          <!-- Grade horizontal + rótulos do eixo Y -->
          <g>
            <line
              *ngFor="let t of ticksY"
              [attr.x1]="padL"
              [attr.x2]="L - padR"
              [attr.y1]="t.y"
              [attr.y2]="t.y"
              stroke="#1e293b"
              stroke-width="1"
            />
            <text
              *ngFor="let t of ticksY"
              [attr.x]="padL - 8"
              [attr.y]="t.y + 3"
              text-anchor="end"
              font-size="10"
              fill="#64748b"
            >
              {{ t.rotulo }}
            </text>
          </g>

          <!-- Rótulos do eixo X (horários) -->
          <text
            *ngFor="let t of ticksX"
            [attr.x]="t.x"
            [attr.y]="A - 8"
            text-anchor="middle"
            font-size="10"
            fill="#64748b"
          >
            {{ t.rotulo }}
          </text>

          <!-- Mira vertical (crosshair) no ponto sob o mouse -->
          <line
            *ngIf="hoverIdx !== null"
            [attr.x1]="hoverX"
            [attr.x2]="hoverX"
            [attr.y1]="padT"
            [attr.y2]="A - padB"
            stroke="#475569"
            stroke-width="1"
          />

          <!-- Linhas das séries -->
          <path
            *ngFor="let l of linhas"
            [attr.d]="l.d"
            fill="none"
            [attr.stroke]="l.cor"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />

          <!-- Ponto final de cada série (com anel na cor do card) -->
          <circle
            *ngFor="let l of linhas"
            [attr.cx]="l.fimX"
            [attr.cy]="l.fimY"
            r="3.5"
            [attr.fill]="l.cor"
            stroke="#0f172a"
            stroke-width="2"
          />

          <!-- Pontos destacados no hover -->
          <circle
            *ngFor="let h of hoverPontos"
            [attr.cx]="h.x"
            [attr.cy]="h.y"
            r="4"
            [attr.fill]="h.cor"
            stroke="#0f172a"
            stroke-width="2"
          />
        </svg>

        <!-- Tooltip (HTML sobreposto, segue o eixo X) -->
        <div
          *ngIf="hoverIdx !== null"
          class="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-lg"
          [style.left.%]="(hoverX / L) * 100"
        >
          <p class="mb-1 font-medium text-slate-300">{{ hoverRotulo }}</p>
          <p *ngFor="let h of hoverPontos" class="flex items-center gap-1.5 whitespace-nowrap text-slate-200">
            <span class="inline-block h-2 w-2 rounded-full" [style.background-color]="h.cor"></span>
            {{ h.nome }}:
            <span class="font-semibold tabular-nums">{{ h.valor | number: '1.0-1' }}{{ unidade }}</span>
          </p>
        </div>

        <!-- Estado vazio -->
        <div
          *ngIf="!temDados"
          class="absolute inset-0 flex items-center justify-center text-sm text-slate-500"
        >
          Sem dados ainda — aguardando o Prometheus coletar o histórico.
        </div>
      </div>
    </figure>
  `,
})
export class GraficoTemporalComponent implements OnChanges {
  @Input() series: SerieChart[] = [];
  @Input() unidade = '';
  @Input() titulo = '';

  // Dimensões do viewBox (o SVG escala para a largura do container)
  readonly L = 720;
  readonly A = 260;
  readonly padL = 40;
  readonly padR = 16;
  readonly padT = 16;
  readonly padB = 28;

  linhas: LinhaVM[] = [];
  ticksY: TickY[] = [];
  ticksX: TickX[] = [];
  temDados = false;

  // Estado do hover
  private tempos: number[] = [];
  hoverIdx: number | null = null;
  hoverX = 0;
  hoverRotulo = '';
  hoverPontos: HoverPonto[] = [];

  ngOnChanges(): void {
    this.recalcular();
  }

  private recalcular(): void {
    const plotW = this.L - this.padL - this.padR;
    const plotH = this.A - this.padT - this.padB;

    const series = this.series.filter((s) => s.pontos.length > 0);
    this.temDados = series.length > 0;
    this.hoverIdx = null;
    if (!this.temDados) {
      this.linhas = [];
      this.ticksX = [];
      this.ticksY = [];
      return;
    }

    // Eixo X: usa a série mais longa como referência de tempo
    const ref = series.reduce((a, b) => (b.pontos.length > a.pontos.length ? b : a));
    this.tempos = ref.pontos.map((p) => p.t);
    const tMin = this.tempos[0];
    const tMax = this.tempos[this.tempos.length - 1];
    const spanT = Math.max(1, tMax - tMin);

    // Eixo Y: min/max de todos os valores, com uma folga de 15%
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const s of series) {
      for (const p of s.pontos) {
        vMin = Math.min(vMin, p.v);
        vMax = Math.max(vMax, p.v);
      }
    }
    const folga = Math.max(0.5, (vMax - vMin) * 0.15);
    vMin -= folga;
    vMax += folga;
    const spanV = Math.max(0.5, vMax - vMin);

    const escX = (t: number) => this.padL + ((t - tMin) / spanT) * plotW;
    const escY = (v: number) => this.padT + (1 - (v - vMin) / spanV) * plotH;

    // Constrói as linhas (path + pontos precomputados p/ o hover)
    this.linhas = series.map((s) => {
      const pts = s.pontos.map((p) => ({ x: escX(p.t), y: escY(p.v), v: p.v }));
      const d = pts
        .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
        .join(' ');
      const ult = pts[pts.length - 1];
      return { nome: s.nome, cor: s.cor, d, pts, fimX: ult.x, fimY: ult.y };
    });

    // Ticks do eixo Y (5 divisões)
    const nY = 4;
    this.ticksY = Array.from({ length: nY + 1 }, (_, i) => {
      const val = vMin + (spanV * i) / nY;
      return { y: escY(val), rotulo: val.toFixed(0) };
    });

    // Ticks do eixo X (até 5 horários)
    const nX = Math.min(5, this.tempos.length);
    this.ticksX = Array.from({ length: nX }, (_, i) => {
      const idx = Math.round((i * (this.tempos.length - 1)) / Math.max(1, nX - 1));
      const t = this.tempos[idx];
      return { x: escX(t), rotulo: this.hhmm(t) };
    });
  }

  private hhmm(epochS: number): string {
    const d = new Date(epochS * 1000);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  aoMover(ev: MouseEvent, svg: Element): void {
    if (!this.temDados) return;
    const r = svg.getBoundingClientRect();
    const xVB = ((ev.clientX - r.left) / r.width) * this.L;

    // Índice de tempo mais próximo do mouse
    let melhor = 0;
    let dist = Infinity;
    for (let i = 0; i < this.linhas[0].pts.length; i++) {
      const d = Math.abs(this.linhas[0].pts[i].x - xVB);
      if (d < dist) {
        dist = d;
        melhor = i;
      }
    }

    this.hoverIdx = melhor;
    this.hoverX = this.linhas[0].pts[melhor].x;
    this.hoverRotulo = this.hhmm(this.tempos[melhor]);
    this.hoverPontos = this.linhas.map((l) => {
      const p = l.pts[Math.min(melhor, l.pts.length - 1)];
      return { nome: l.nome, cor: l.cor, x: p.x, y: p.y, valor: p.v };
    });
  }

  aoSair(): void {
    this.hoverIdx = null;
    this.hoverPontos = [];
  }
}
