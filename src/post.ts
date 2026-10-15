// 画面后期：在模板合成之后、文字叠加层之前，由 fs_final 按 uniform 编号处理（切换不需要重编译着色器）
export interface Post { id: number; name: string; desc: string; swatch: string; warp?: boolean }

export const POSTS: Post[] = [
  { id: 0, name: '原样', desc: '不加后期', swatch: 'linear-gradient(135deg,#fbf9f5,#e2d9cc)' },
  { id: 1, name: '胶片颗粒', desc: '暖调、抬黑、随抖动刷新的颗粒', swatch: 'radial-gradient(circle at 30% 30%,#e9c79a,#7b5a3a)' },
  { id: 2, name: '暗角聚光', desc: '四周压暗，中心微微提亮', swatch: 'radial-gradient(circle,#f6e7c8 20%,#2a2018 90%)' },
  { id: 3, name: '双色调', desc: '墨色 → 投影色 → 纸色三段映射', swatch: 'linear-gradient(135deg,#2a2018,#2f6f78 55%,#ebe3d7)' },
  { id: 4, name: '色调分离', desc: '每通道 4 阶 + 有序抖动', swatch: 'linear-gradient(90deg,#e8962a 33%,#c3262c 33% 66%,#2f6f78 66%)' },
  { id: 5, name: 'CRT 扫描线', desc: '弯曲屏幕、RGB 荧光格、扫描线', swatch: 'repeating-linear-gradient(0deg,#1d2b53 0 2px,#29adff 2px 4px)', warp: true },
  { id: 6, name: '漏光', desc: '橙色与洋红光斑随抖动游移', swatch: 'radial-gradient(circle at 20% 20%,#ff8a2a,#f5d0c0 50%,#e0457a)' },
  { id: 7, name: '纸张折痕', desc: '对折 + 三折的折痕与明暗', swatch: 'linear-gradient(90deg,#efe6d6 49%,#b9ad9b 50%,#f6efe3 51%)' },
  { id: 8, name: '浮雕', desc: '用明度梯度打光，像压在纸上', swatch: 'linear-gradient(135deg,#fff 0%,#b5aa9a 60%,#7d7262)' },
  { id: 9, name: '镜像对称', desc: '左半边镜像到右边', swatch: 'linear-gradient(90deg,#e8962a,#fbeedb 50%,#e8962a)', warp: true },
  { id: 10, name: '万花筒', desc: '六瓣对称，随抖动轻轻转', swatch: 'conic-gradient(#e8962a,#2f6f78,#e8962a,#2f6f78,#e8962a,#2f6f78,#e8962a)', warp: true },
  { id: 11, name: '鱼眼', desc: '中心放大的凸透镜', swatch: 'radial-gradient(circle,#78a7d8 30%,#f4ead6 70%)', warp: true },
  { id: 12, name: '水波纹', desc: '整张画面随抖动起伏', swatch: 'repeating-radial-gradient(circle,#a7c4d6 0 4px,#f2f6f8 4px 8px)', warp: true },
  { id: 13, name: '热成像', desc: '明度映射到红外色带', swatch: 'linear-gradient(90deg,#05002a,#73009a,#f2261a,#ffd833,#fff)' },
  { id: 14, name: '蓝晒', desc: '普鲁士蓝晒图，纸纹保留', swatch: 'linear-gradient(135deg,#0a2b6b,#eef2f6)' },
  { id: 15, name: '褪色宝丽来', desc: '褪色暖调 + 白色相纸边框', swatch: 'linear-gradient(#f7f5ef 0 12%,#c7a98a 12% 78%,#f7f5ef 78%)' },
];
