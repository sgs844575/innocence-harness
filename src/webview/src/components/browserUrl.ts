// 浏览器标签地址栏归一化（纯模块，可单测）：补全协议、只放行 http/https。
/** 归一化地址栏输入：空输入 → null；缺协议补 https://；非 http(s) → null。 */
export function normalizeUrl(raw: string): string | null {
  const input = raw.trim();
  if (input === "") return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
}
