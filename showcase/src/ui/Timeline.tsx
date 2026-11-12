import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { photoArcPositions, type Clock, type Journey } from '@travelmemory/trail';

export interface TimelineHandle {
  draw(q: number): void;
}

interface TimelineProps {
  journey: Journey;
  clock: Clock;
  playing: boolean;
  speed: number;
  onSpeedChange: (speed: number) => void;
  onReplay: () => void;
}

const CANVAS_HEIGHT = 68;
const PAD = 56;
const TRACK_Y = 42;
const SPEEDS = [0.5, 1, 2, 4];

export const Timeline = forwardRef<TimelineHandle, TimelineProps>(function Timeline(
  { journey, clock, playing, speed, onSpeedChange, onReplay },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef<{ width: number; gradient: CanvasGradient | null }>({
    width: 0,
    gradient: null,
  });
  const dragRef = useRef<{ dragging: boolean; wasPlaying: boolean }>({
    dragging: false,
    wasPlaying: false,
  });

  /** 每张照片在轨迹上的弧长位置（一次算好，用于竖刻度） */
  const photoS = useMemo(() => photoArcPositions(journey), [journey]);

  const draw = useCallback(
    (q: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(CANVAS_HEIGHT * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(CANVAS_HEIGHT * dpr);
        cacheRef.current.gradient = null;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, CANVAS_HEIGHT);

      const usable = width - PAD * 2;
      if (usable <= 10) return;

      // 轨道底色
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.moveTo(PAD, TRACK_Y);
      ctx.lineTo(PAD + usable, TRACK_Y);
      ctx.stroke();

      // 进度段（青色渐变）
      if (cacheRef.current.gradient === null || cacheRef.current.width !== width) {
        const gradient = ctx.createLinearGradient(PAD, 0, PAD + usable, 0);
        gradient.addColorStop(0, 'rgba(34,211,238,0.35)');
        gradient.addColorStop(0.55, 'rgba(34,211,238,0.85)');
        gradient.addColorStop(1, '#7dd3fc');
        cacheRef.current.gradient = gradient;
        cacheRef.current.width = width;
      }
      if (q > 0.0005) {
        ctx.strokeStyle = cacheRef.current.gradient;
        ctx.beginPath();
        ctx.moveTo(PAD, TRACK_Y);
        ctx.lineTo(PAD + usable * q, TRACK_Y);
        ctx.stroke();
      }
      ctx.restore();

      const total = journey.totalMeters > 0 ? journey.totalMeters : 1;

      // 天分界刻度
      ctx.save();
      ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.textBaseline = 'alphabetic';
      for (let i = 0; i < journey.days.length; i += 1) {
        const day = journey.days[i];
        const x = PAD + usable * Math.min(1, Math.max(0, day.startS / total));
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, TRACK_Y - 6);
        ctx.lineTo(x, TRACK_Y + 6);
        ctx.stroke();
        ctx.fillStyle = 'rgba(124,142,166,0.85)';
        ctx.fillText(day.label, x + 4, TRACK_Y - 11);
      }
      ctx.restore();

      // 照片刻度
      ctx.save();
      for (let i = 0; i < photoS.length; i += 1) {
        const x = PAD + usable * Math.min(1, Math.max(0, photoS[i] / total));
        const passed = photoS[i] <= q * total;
        ctx.strokeStyle = passed ? 'rgba(125,211,252,0.75)' : 'rgba(125,211,252,0.32)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, TRACK_Y - 3.5);
        ctx.lineTo(x, TRACK_Y + 3.5);
        ctx.stroke();
      }
      ctx.restore();

      // 播放头
      const headX = PAD + usable * Math.min(1, Math.max(0, q));
      const radius = dragRef.current.dragging ? 8 : 6;
      ctx.save();
      const glow = ctx.createRadialGradient(headX, TRACK_Y, 0, headX, TRACK_Y, radius * 3.4);
      glow.addColorStop(0, 'rgba(34,211,238,0.45)');
      glow.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(headX, TRACK_Y, radius * 3.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(headX, TRACK_Y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(34,211,238,0.95)';
      ctx.stroke();
      ctx.restore();
    },
    [journey, photoS],
  );

  useImperativeHandle(ref, () => ({ draw }), [draw]);

  const qFromClientX = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const usable = Math.max(1, rect.width - PAD * 2);
    const ratio = (clientX - rect.left - PAD) / usable;
    return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const drag = dragRef.current;
    drag.wasPlaying = clock.playing;
    drag.dragging = true;
    clock.pause();
    clock.seek(qFromClientX(event.clientX));
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!dragRef.current.dragging) return;
    clock.seek(qFromClientX(event.clientX));
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (!drag.dragging) return;
    drag.dragging = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* 指针可能已释放 */
    }
    if (drag.wasPlaying) clock.play();
  };

  return (
    <div className="timeline">
      <button
        type="button"
        className="tl-btn"
        onClick={() => clock.toggle()}
        aria-label={playing ? '暂停' : '播放'}
        title={playing ? '暂停 (Space)' : '播放 (Space)'}
      >
        {playing ? '❚❚' : '▶'}
      </button>

      <div className="tl-track">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        />
      </div>

      <div className="tl-right">
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            className={`speed-btn${speed === value ? ' is-active' : ''}`}
            onClick={() => onSpeedChange(value)}
          >
            {value}x
          </button>
        ))}
        <button type="button" className="replay-btn" onClick={onReplay}>
          重播
        </button>
      </div>
    </div>
  );
});
