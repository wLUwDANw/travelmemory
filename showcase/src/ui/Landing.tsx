import { useRef, useState, type DragEvent } from 'react';

export interface DemoTripSummary {
  id: string;
  title: string;
  subtitle: string;
  photoCount: number;
}

interface LandingProps {
  trips: DemoTripSummary[];
  onSelectDemo: (id: string) => void;
  onPickFiles: () => void;
  onDropFiles: (files: File[]) => void;
}

export function Landing({ trips, onSelectDemo, onPickFiles, onDropFiles }: LandingProps) {
  const [showDemos, setShowDemos] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onDropFiles(files);
  };

  return (
    <div
      className={`landing${dragging ? ' drop-active' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="landing-grid" />
      <div className="landing-inner fade-in">
        <div className="landing-kicker">Travelmemory / 旅忆地图</div>
        <h1 className="landing-title">旅忆地图</h1>
        <p className="landing-sub">
          把散落在相册里的照片，还原成一条会生长的旅程轨迹。
          <br />
          拖动时间轴回看任意时刻，镜头会跟着光点一起走。
        </p>

        <div className="landing-actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowDemos((v) => !v)}>
            用演示轨迹开始
          </button>
          <button type="button" className="btn" onClick={onPickFiles}>
            导入我的照片
          </button>
        </div>

        {showDemos ? (
          <div className="landing-demos fade-in">
            {trips.map((trip) => (
              <button
                key={trip.id}
                type="button"
                className="demo-card"
                onClick={() => onSelectDemo(trip.id)}
                style={{ textAlign: 'left' }}
              >
                <div className="demo-card-title">{trip.title}</div>
                <div className="demo-card-meta">
                  {trip.subtitle} · {trip.photoCount} 张
                </div>
              </button>
            ))}
          </div>
        ) : null}

        <div className="drop-hint">也可以直接把照片拖进这个页面</div>
      </div>
      <div className="landing-foot">LOCAL ONLY · 照片不会离开你的电脑</div>
    </div>
  );
}
