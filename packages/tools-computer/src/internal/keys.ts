// 按键名 → SendKeys 序列映射（纯 TS，无进程副作用，可独立单测）。
// 语法：单键为命名键或单个字符；组合键用 "+" 连接修饰符（ctrl/alt/shift，
// 顺序任意、大小写不限）与一个主键，如 "ctrl+c"、"ctrl+shift+tab"、"alt+f4"。
// SendKeys 修饰符前缀：ctrl=^、alt=%、shift=+，按固定顺序归一化输出。

const MAX_KEY_LENGTH = 32;

/** 命名键 → SendKeys 记号（匹配大小写不限）。 */
const NAMED_KEYS: Record<string, string> = {
  enter: "{ENTER}",
  esc: "{ESC}",
  tab: "{TAB}",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  home: "{HOME}",
  end: "{END}",
  pgup: "{PGUP}",
  pgdn: "{PGDN}",
  delete: "{DELETE}",
  backspace: "{BACKSPACE}",
  space: " ",
};
for (let n = 1; n <= 12; n++) NAMED_KEYS[`f${n}`] = `{F${n}}`;

/** SendKeys 保留字符：作为普通字符输入时必须用花括号转义。 */
const SENDKEYS_SPECIALS = new Set(["^", "%", "~", "(", ")", "{", "}", "[", "]", "+"]);

/** 修饰符记号 → SendKeys 前缀（归一化输出顺序 ctrl、alt、shift）。 */
const MODIFIER_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["ctrl", "^"],
  ["alt", "%"],
  ["shift", "+"],
];

/** 普通字符 → SendKeys 字面量（保留字符包花括号，如 "{" → "{{}"）。 */
function literalChar(ch: string): string {
  return SENDKEYS_SPECIALS.has(ch) ? `{${ch}}` : ch;
}

/** 截断回显：错误消息携带键名而非任意长回显。 */
function echo(key: string): string {
  return key.length > MAX_KEY_LENGTH ? `${key.slice(0, MAX_KEY_LENGTH)}...` : key;
}

/**
 * 把 `key` 描述映射为 SendKeys 序列。非法输入（空串、超长、未知记号、
 * 多个主键、缺主键）抛 `Error("Unsupported key: ...")`。
 * 单个大写字符原样保留（SendKeys 中大写即 shift+小写）。
 */
export function toSendKeysSequence(key: string): string {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new Error(`Unsupported key: ${echo(key)}`);
  }
  // 整个输入恰为 "+"：分割语法下的主键字面量（SendKeys 转义为 {+}）；
  // 带修饰符的加号组合（如 "ctrl++"）存在分割歧义，明确不支持。
  if (key === "+") return literalChar(key);
  const modifiers = new Set<string>();
  let mainRaw: string | null = null;
  for (const token of key.split("+")) {
    if (token === "") throw new Error(`Unsupported key: ${echo(key)}`);
    const lower = token.toLowerCase();
    if (MODIFIER_PREFIXES.some(([name]) => name === lower)) {
      modifiers.add(lower);
      continue;
    }
    if (mainRaw !== null) throw new Error(`Unsupported key: ${echo(key)}`);
    mainRaw = token;
  }
  if (mainRaw === null) throw new Error(`Unsupported key: ${echo(key)}`);

  const mainLower = mainRaw.toLowerCase();
  const named = NAMED_KEYS[mainLower];
  const sequence =
    named !== undefined ? named : mainRaw.length === 1 ? literalChar(mainRaw) : undefined;
  if (sequence === undefined) throw new Error(`Unsupported key: ${echo(key)}`);

  let prefix = "";
  for (const [name, sign] of MODIFIER_PREFIXES) {
    if (modifiers.has(name)) prefix += sign;
  }
  return prefix + sequence;
}
