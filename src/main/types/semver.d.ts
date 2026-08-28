// 本仓库用到的 semver 函数面（该版本未自带类型声明，也未引入社区类型包）。
declare module "semver" {
  /** 语义化版本范围判断；非法版本返回 false。 */
  export function satisfies(version: string, range: string, optionsOrLoose?: boolean | { loose?: boolean }): boolean;
  /** 尽力从任意字符串中提取语义化版本；提取不到返回 null。 */
  export function coerce(version: string | number | null | undefined): { version: string; major: number; minor: number; patch: number } | null;
  /** 三段比较：v1 > v2 返回 1，相等返回 0，否则 -1。 */
  export function compare(v1: string, v2: string): -1 | 0 | 1;
  export function gt(v1: string, v2: string): boolean;
  export function valid(version: string | null | undefined): string | null;
}
