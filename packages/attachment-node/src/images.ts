// 图像规范化（规格 §2/§3）：GIF 发送首帧静态图（动画提示）、任意图像最长边
// 超过 2048px 时双线性缩到上限内、统一编码 PNG；缩略图（≤256px）供 UI 预览。
// 解码器 = @napi-rs/canvas（预编译 N-API； loadImage 天然取 GIF 首帧）。
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { MAX_IMAGE_EDGE } from "@innocenceharness/attachment-runtime";

export interface NormalizedImage {
  /** 规范化后字节（需要派生时为 PNG；可直接透传时为 null）。 */
  bytes: Uint8Array | null;
  width: number;
  height: number;
  /** 派生缩略图 PNG（总是生成，UI 预览经济性）。 */
  thumbnail: Uint8Array;
}

function scaleOf(width: number, height: number, maxEdge: number): number {
  const longest = Math.max(width, height);
  return longest > maxEdge ? maxEdge / longest : 1;
}

function drawScaled(image: Image, width: number, height: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  // 双线性采样：Skia drawImage 默认高质量插值。
  ctx.drawImage(image, 0, 0, width, height);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

/**
 * 规范化一张图像：返回模型可见表示字节（null = 原始字节可直接作表示）与
 * 缩略图。解码失败抛错（调用方降级为二进制引用 + 警告）。
 */
export async function normalizeImage(bytes: Uint8Array, opts: { animated: boolean }): Promise<NormalizedImage> {
  const image = await loadImage(Buffer.from(bytes));
  const scale = scaleOf(image.width, image.height, MAX_IMAGE_EDGE);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  // GIF 恒派生首帧 PNG（规范表示静态化）；其余仅在需要缩放时派生。
  const bytesOut = opts.animated || scale < 1 ? drawScaled(image, width, height) : null;
  const thumbScale = scaleOf(image.width, image.height, 256);
  const thumbnail = drawScaled(
    image,
    Math.max(1, Math.round(image.width * thumbScale)),
    Math.max(1, Math.round(image.height * thumbScale)),
  );
  return { bytes: bytesOut, width, height, thumbnail };
}

/** 图像 token 粗估（Anthropic 口径近似：像素数 / 750）。 */
export function estimateImageTokens(width: number, height: number): number {
  return Math.ceil((width * height) / 750);
}
