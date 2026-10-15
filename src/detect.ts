// 主体识别（MediaPipe Tasks，模型与 wasm 全部本地托管在 /mediapipe/）
//   1. EfficientDet-Lite0 找人物 / 宠物
//   2. BlazeFace 找人脸；街拍里脸很小，就在每个人物框的上半部分放大后再找一次
// 结果是源图 uv 空间里的椭圆焦点，交给 shader 做“焦点少简化、背景多简化”。
import type { Focus, FaceKeys } from './engine';

type Detectors = {
  face: import('@mediapipe/tasks-vision').FaceDetector;
  obj: import('@mediapipe/tasks-vision').ObjectDetector;
};

let loading: Promise<Detectors> | null = null;

function load(): Promise<Detectors> {
  if (!loading) {
    loading = (async () => {
      const { FilesetResolver, FaceDetector, ObjectDetector } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const [face, obj] = await Promise.all([
        FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/mediapipe/blaze_face_short_range.tflite', delegate: 'CPU' },
          runningMode: 'IMAGE', minDetectionConfidence: 0.5,
        }),
        ObjectDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/mediapipe/efficientdet_lite0.tflite', delegate: 'CPU' },
          runningMode: 'IMAGE', scoreThreshold: 0.4, maxResults: 4,
          categoryAllowlist: ['person', 'dog', 'cat', 'bird', 'horse', 'teddy bear'],
        }),
      ]);
      return { face, obj };
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

export function preloadDetectors() { return load().then(() => true, () => false); }

export async function detectSubjects(src: CanvasImageSource, w: number, h: number): Promise<{ foci: Focus[]; keys: FaceKeys[] }> {
  const { face, obj } = await load();
  const s = Math.min(1, 640 / Math.max(w, h));
  const bmp = await createImageBitmap(src as ImageBitmapSource, { resizeWidth: Math.round(w * s), resizeHeight: Math.round(h * s) });
  const W = bmp.width, H = bmp.height;
  const faces: Focus[] = [];
  const keys: FaceKeys[] = [];
  const people: Focus[] = [];

  // kp：关键点（相对裁剪图的 0..1），ox/oy/sw/sh：裁剪图在缩略图里的位置与尺寸
  type Kp = { x: number; y: number }[] | undefined;
  const addFace = (x: number, y: number, fw: number, fh: number, kp: Kp, ox = 0, oy = 0, sw = W, sh = H) => {
    const cx = (x + fw / 2) / W, cy = (y + fh / 2) / H;
    if (faces.some((f) => Math.abs(f.cx - cx) < f.rx && Math.abs(f.cy - cy) < f.ry)) return;
    faces.push({ cx, cy, rx: (fw / W) * 0.85, ry: (fh / H) * 1.05, w: 1, kind: 'face' });
    if (kp && kp.length >= 4) {
      const P = (i: number): [number, number] => [(ox + kp[i].x * sw) / W, (oy + kp[i].y * sh) / H];
      keys.push({ eyeR: P(0), eyeL: P(1), mouth: P(3), size: fw / W });
    }
  };

  for (const d of face.detect(bmp).detections) {
    const b = d.boundingBox!; addFace(b.originX, b.originY, b.width, b.height, d.keypoints);
  }

  for (const d of obj.detect(bmp).detections) {
    const b = d.boundingBox!;
    people.push({ cx: (b.originX + b.width / 2) / W, cy: (b.originY + b.height / 2) / H, rx: (b.width / W) * 0.6, ry: (b.height / H) * 0.56, w: 0.6, kind: 'person' });
    // 小脸：裁出人物框上部放大再检测
    if (d.categories[0]?.categoryName === 'person') {
      const cw = b.width * 1.2, ch = Math.min(b.height * 0.32, b.width * 1.2);
      const cx0 = Math.max(0, b.originX - b.width * 0.1), cy0 = Math.max(0, b.originY - b.height * 0.03);
      const sw = Math.min(cw, W - cx0), sh = Math.min(ch, H - cy0);
      if (sw < 8 || sh < 8) continue;
      const up = 256 / Math.max(sw, sh);
      const crop = await createImageBitmap(bmp, cx0, cy0, sw, sh, { resizeWidth: Math.round(sw * up), resizeHeight: Math.round(sh * up) });
      for (const fd of face.detect(crop).detections) {
        const fb = fd.boundingBox!;
        addFace(cx0 + fb.originX / up, cy0 + fb.originY / up, fb.width / up, fb.height / up, fd.keypoints, cx0, cy0, sw, sh);
      }
      crop.close();
    }
  }
  bmp.close();
  // 人脸优先，最多 4 个
  const foci = [...faces, ...people.sort((a, b) => b.rx * b.ry - a.rx * a.ry)].slice(0, 4);
  return { foci, keys: keys.sort((a, b) => b.size - a.size).slice(0, 2) };
}
