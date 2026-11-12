/**
 * 缩略图生成：把任意图片缩到 maxSide 以内的 JPEG dataURL。
 *
 * 说明（相对需求的偏差）：需求提到用 createImageBitmap 的 resizeWidth/resizeHeight 直接缩放，
 * 但那需要先知道原图宽高——而宽高只有解码后才知道，所以实际路径是
 * 「解码一次 → 用 canvas 高质量缩放」。全程串行调用、位图用完立刻 close()，
 * 避免几百张图同时驻留内存。任何失败返回 null（照片退化为渐变卡，不阻断导入）。
 */

/** 顺序执行队列：保证多文件导入时不会一次性把所有位图解码进内存 */
let chain: Promise<unknown> = Promise.resolve();

export function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

function drawOriented(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  drawW: number,
  drawH: number,
  orientation: number,
): void {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  switch (orientation) {
    case 3:
      ctx.translate(cw, ch);
      ctx.rotate(Math.PI);
      break;
    case 6:
      ctx.translate(cw, 0);
      ctx.rotate(Math.PI / 2);
      break;
    case 8:
      ctx.translate(0, ch);
      ctx.rotate(-Math.PI / 2);
      break;
    default:
      break;
  }
  ctx.drawImage(source, 0, 0, drawW, drawH);
}

function renderToDataUrl(
  source: CanvasImageSource,
  width: number,
  height: number,
  orientation: number,
  maxSide: number,
): string | null {
  const swap = orientation === 6 || orientation === 8;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const drawW = Math.max(1, Math.round(width * scale));
  const drawH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = swap ? drawH : drawW;
  canvas.height = swap ? drawW : drawH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  drawOriented(ctx, source, drawW, drawH, orientation);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function loadHtmlImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

/**
 * 生成缩略图 dataURL。orientation 由调用方从 EXIF 传入（默认 1 = 不旋转）。
 * 用 canvas 手动修正方向，而不是依赖浏览器的 imageOrientation 支持。
 */
export async function makeThumb(file: File, maxSide = 480, orientation = 1): Promise<string | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'none' });
        return renderToDataUrl(bitmap, bitmap.width, bitmap.height, orientation, maxSide);
      } finally {
        if (bitmap) bitmap.close();
      }
    }
    const img = await loadHtmlImage(file);
    return renderToDataUrl(img, img.naturalWidth, img.naturalHeight, orientation, maxSide);
  } catch {
    return null;
  }
}
