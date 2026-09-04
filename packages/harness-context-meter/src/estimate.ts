/** 估算启发式：CJK 码点 ≈1 token/字，其余 ≈4 字符/token，向上取整。
 *  只决定占比形状；系统性偏差由 calibrate 按真实用量吸收。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let units = 0;
  for (const ch of text) {
    units += isCjk(ch) ? 1 : 0.25;
  }
  return Math.ceil(units);
}

function isCjk(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意
    (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
    (code >= 0x3040 && code <= 0x30ff) || // 假名
    (code >= 0xac00 && code <= 0xd7af)    // 谚文
  );
}
