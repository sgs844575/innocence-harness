// 从 assets/ 现成的 PNG 尺寸阶梯（16..512）生成 assets/icon.icns：图标容器
// 格式由 icon 库拼装，仓库本就维护各尺寸源图，这里不做任何图像缩放。
// 产物用于桌面分发的图标资产；缺某个尺寸时跳过该档并在结尾汇总告警。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Icns, IcnsImage, type Format, type OSType } from "@fiahfy/icns";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const assetsDir = path.join(repoRoot, "assets");
const outputPath = path.join(assetsDir, "icon.icns");

/** size → PNG-format osType（取该尺寸的第一个 PNG 档；容器格式表由库提供）。 */
function pngOsTypeBySize(): Map<number, OSType> {
  const bySize = new Map<number, OSType>();
  for (const entry of Icns.supportedIconTypes) {
    if ((entry as { format: Format }).format !== "PNG") continue;
    if (!bySize.has(entry.size)) bySize.set(entry.size, entry.osType);
  }
  return bySize;
}

export function generateIconIcns(assetsDirectory: string = assetsDir, outputFile: string = outputPath): void {
  const osTypeBySize = pngOsTypeBySize();
  const icns = new Icns();
  const skipped: number[] = [];
  for (const size of [...osTypeBySize.keys()].sort((a, b) => a - b)) {
    const source = path.join(assetsDirectory, `icon-${size}.png`);
    const osType = osTypeBySize.get(size)!;
    if (!existsSync(source)) {
      skipped.push(size);
      continue;
    }
    icns.append(IcnsImage.fromPNG(readFileSync(source), osType));
  }
  if (icns.images.length === 0) {
    throw new Error(`no icon-<size>.png sources found under ${assetsDirectory}`);
  }
  writeFileSync(outputFile, icns.data);
  const sizes = icns.images.length;
  const note = skipped.length > 0 ? ` (skipped sizes: ${skipped.join(", ")})` : "";
  console.log(`icon.icns written with ${sizes} size entries${note}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateIconIcns();
}
