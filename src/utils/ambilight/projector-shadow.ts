const WIDTH = 512;
const HEIGHT = 512;

export interface ProjectorScale {
  x: number;
  y: number;
}

export interface ProjectorSize {
  w: number;
  h: number;
}

export interface ProjectorShadowSettings {
  spreadFadeCurve: number;
  spreadFadeStart: number;
  directionTopEnabled: boolean;
  directionRightEnabled: boolean;
  directionBottomEnabled: boolean;
  directionLeftEnabled: boolean;
}

export class ProjectorShadow {
  private cacheKey?: string;
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    const ctx = this.canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Unable to create 2D context for projector shadow');
    this.ctx = ctx;
  }

  rescale(scale: ProjectorScale, projectorSize: ProjectorSize, settings: ProjectorShadowSettings) {
    this.canvas.style.transform = `scale(${scale.x + 0.01}, ${scale.y + 0.01})`;

    const {
      spreadFadeCurve,
      spreadFadeStart,
      directionTopEnabled,
      directionRightEnabled,
      directionBottomEnabled,
      directionLeftEnabled,
    } = settings;

    const cacheKey = JSON.stringify({
      scale,
      projectorSize,
      spreadFadeCurve,
      spreadFadeStart,
      directionTopEnabled,
      directionRightEnabled,
      directionBottomEnabled,
      directionLeftEnabled,
    });

    if (this.canvas.width !== WIDTH || this.canvas.height !== HEIGHT) {
      this.canvas.width = WIDTH;
      this.canvas.height = HEIGHT;
    } else if (this.cacheKey !== cacheKey) {
      this.ctx.clearRect(0, 0, WIDTH, HEIGHT);
    } else {
      return;
    }

    const edge = {
      w: (projectorSize.w * scale.x - projectorSize.w) / 2 / scale.x,
      h: (projectorSize.h * scale.y - projectorSize.h) / 2 / scale.y,
    };
    const video = {
      w: projectorSize.w / scale.x,
      h: projectorSize.h / scale.y,
    };

    const darkest = 1;
    const easing = 16 / (spreadFadeCurve * 0.64);
    const keyframes = this.plotKeyframes(256, easing, darkest);

    let fadeOutFrom = spreadFadeStart / 100;
    const fadeOutMinH = -(video.h / 2 / edge.h);
    const fadeOutMinW = -(video.w / 2 / edge.w);
    fadeOutFrom = Math.max(fadeOutFrom, fadeOutMinH, fadeOutMinW);

    this.drawGradient(video.h, edge.h, keyframes, fadeOutFrom, darkest, false);
    this.drawGradient(video.w, edge.w, keyframes, fadeOutFrom, darkest, true);

    const scaleW = WIDTH / (video.w + edge.w + edge.w);
    const scaleH = HEIGHT / (video.h + edge.h + edge.h);
    this.ctx.fillStyle = '#000000';

    if (!directionTopEnabled) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, 0);
      this.ctx.lineTo(scaleW * edge.w, scaleH * edge.h);
      this.ctx.lineTo(scaleW * (edge.w + video.w / 2), scaleH * (edge.h + video.h / 2));
      this.ctx.lineTo(scaleW * (edge.w + video.w), scaleH * edge.h);
      this.ctx.lineTo(scaleW * (edge.w + video.w + edge.w), 0);
      this.ctx.fill();
    }

    if (!directionRightEnabled) {
      this.ctx.beginPath();
      this.ctx.lineTo(scaleW * (edge.w + video.w + edge.w), 0);
      this.ctx.lineTo(scaleW * (edge.w + video.w), scaleH * edge.h);
      this.ctx.lineTo(scaleW * (edge.w + video.w / 2), scaleH * (edge.h + video.h / 2));
      this.ctx.lineTo(scaleW * (edge.w + video.w), scaleH * (edge.h + video.h));
      this.ctx.lineTo(scaleW * (edge.w + video.w + edge.w), scaleH * (edge.h + video.h + edge.h));
      this.ctx.fill();
    }

    if (!directionBottomEnabled) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, scaleH * (edge.h + video.h + edge.h));
      this.ctx.lineTo(scaleW * edge.w, scaleH * (edge.h + video.h));
      this.ctx.lineTo(scaleW * (edge.w + video.w / 2), scaleH * (edge.h + video.h / 2));
      this.ctx.lineTo(scaleW * (edge.w + video.w), scaleH * (edge.h + video.h));
      this.ctx.lineTo(scaleW * (edge.w + video.w + edge.w), scaleH * (edge.h + video.h + edge.h));
      this.ctx.fill();
    }

    if (!directionLeftEnabled) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, 0);
      this.ctx.lineTo(scaleW * edge.w, scaleH * edge.h);
      this.ctx.lineTo(scaleW * (edge.w + video.w / 2), scaleH * (edge.h + video.h / 2));
      this.ctx.lineTo(scaleW * edge.w, scaleH * (edge.h + video.h));
      this.ctx.lineTo(0, scaleH * (edge.h + video.h + edge.h));
      this.ctx.fill();
    }

    this.cacheKey = cacheKey;
  }

  private plotKeyframes(length: number, powerOf: number, darkest: number) {
    const keyframes: Array<{ p: number; o: number }> = [];
    for (let i = 1; i < length; i += 1) {
      keyframes.push({
        p: i / length,
        o: Math.pow(i / length, powerOf) * darkest,
      });
    }
    return keyframes.map(({ p, o }) => ({
      p: Math.round(p * 10000) / 10000,
      o: Math.round(o * 10000) / 10000,
    }));
  }

  private drawGradient(
    size: number,
    edge: number,
    keyframesInput: Array<{ p: number; o: number }>,
    fadeOutFrom: number,
    darkest: number,
    horizontal: boolean
  ) {
    const keyframes = [...keyframesInput];

    const points = [
      0,
      ...keyframes.map((e) => Math.max(0, edge - edge * e.p - edge * fadeOutFrom * (1 - e.p))),
      edge - edge * fadeOutFrom,
      edge + size + edge * fadeOutFrom,
      ...[...keyframes]
        .reverse()
        .map((e) =>
          Math.min(
            edge + size + edge,
            edge + size + edge * e.p + edge * fadeOutFrom * (1 - e.p)
          )
        ),
      edge + size + edge,
    ];

    const pointMax = points[points.length - 1];

    let gradientStops: Array<[number, string]> = [];
    gradientStops.push([Math.min(1, points[0] / pointMax), `rgba(0,0,0,${darkest})`]);
    for (let i = 0; i < keyframes.length; i += 1) {
      const e = keyframes[i];
      gradientStops.push([
        Math.min(1, points[keyframes.length - i] / pointMax),
        `rgba(0,0,0,${e.o})`,
      ]);
    }
    gradientStops.push([Math.min(1, points[1 + keyframes.length] / pointMax), 'rgba(0,0,0,0)']);
    gradientStops.push([Math.min(1, points[2 + keyframes.length] / pointMax), 'rgba(0,0,0,0)']);
    const reversed = [...keyframes].reverse();
    for (let i = 0; i < reversed.length; i += 1) {
      const e = reversed[i];
      gradientStops.push([
        Math.min(1, points[2 + keyframes.length * 2 - i] / pointMax),
        `rgba(0,0,0,${e.o})`,
      ]);
    }
    gradientStops.push([
      Math.min(1, points[3 + keyframes.length * 2] / pointMax),
      `rgba(0,0,0,${darkest})`,
    ]);

    gradientStops = gradientStops.map(([p, c]) => [Math.round(p * 10000) / 10000, c]);

    const gradient = this.ctx.createLinearGradient(
      0,
      0,
      horizontal ? WIDTH : 0,
      horizontal ? 0 : HEIGHT
    );
    for (const [point, color] of gradientStops) {
      gradient.addColorStop(point, color);
    }

    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

