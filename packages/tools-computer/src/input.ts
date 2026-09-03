// 桌面输入工具四件套：click / type / key / scroll。数字与枚举参数在
// validateArgs 与 execute 双层校验（fail-closed，NaN/Infinity/越界/坏枚举
// 一律抛带参数名的英文 Error）；字符串参数一律经 base64 嵌入 PowerShell。
import type { Tool } from "@innocenceharness/harness-tools";
import { toSendKeysSequence } from "./internal/keys";
import {
  clickScript,
  keyScript,
  runPowerShellScript,
  scrollScript,
  typeTextScript,
} from "./internal/powershell";
import { assertWindowsHost, type ComputerToolDeps } from "./screen";

/** 屏幕坐标上限（原点在主显示器左上角，负坐标明确拒绝）。 */
const MAX_COORD = 100_000;
const TEXT_MIN = 1;
const TEXT_MAX = 2000;
const SCROLL_MIN = 1;
const SCROLL_MAX = 10;
const DEFAULT_SCROLL_AMOUNT = 3;

const MOUSE_BUTTONS = ["left", "right", "middle"] as const;
type MouseButton = (typeof MOUSE_BUTTONS)[number];

function isMouseButton(v: string): v is MouseButton {
  return (MOUSE_BUTTONS as readonly string[]).includes(v);
}

function requireCoord(args: Record<string, unknown>, name: string): number {
  const v = args[name];
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new Error(`Argument "${name}" must be a finite integer screen coordinate.`);
  }
  if (v < 0 || v > MAX_COORD) {
    throw new Error(`Argument "${name}" must be between 0 and ${MAX_COORD}.`);
  }
  return v;
}

interface ClickArgs {
  x: number;
  y: number;
  button: MouseButton;
  double: boolean;
}

function parseClickArgs(args: Record<string, unknown>): ClickArgs {
  const x = requireCoord(args, "x");
  const y = requireCoord(args, "y");
  const button = args.button ?? "left";
  if (typeof button !== "string" || !isMouseButton(button)) {
    throw new Error(`Argument "button" must be one of: left, right, middle.`);
  }
  const double = args.double ?? false;
  if (typeof double !== "boolean") {
    throw new Error(`Argument "double" must be a boolean.`);
  }
  return { x, y, button, double };
}

function requireText(args: Record<string, unknown>): string {
  const v = args.text;
  if (typeof v !== "string") {
    throw new Error(`Argument "text" must be a string.`);
  }
  if (v.length < TEXT_MIN || v.length > TEXT_MAX) {
    throw new Error(`Argument "text" length must be between ${TEXT_MIN} and ${TEXT_MAX} characters.`);
  }
  return v;
}

/** 校验并映射 key 参数（非法记号由 keys.ts 抛 "Unsupported key: ..."）。 */
function requireKeySequence(args: Record<string, unknown>): string {
  const v = args.key;
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Argument "key" must be a non-empty string.`);
  }
  return toSendKeysSequence(v);
}

interface ScrollArgs {
  direction: "up" | "down";
  amount: number;
}

function parseScrollArgs(args: Record<string, unknown>): ScrollArgs {
  const direction = args.direction;
  if (direction !== "up" && direction !== "down") {
    throw new Error(`Argument "direction" must be "up" or "down".`);
  }
  const amount = args.amount ?? DEFAULT_SCROLL_AMOUNT;
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    !Number.isInteger(amount) ||
    amount < SCROLL_MIN ||
    amount > SCROLL_MAX
  ) {
    throw new Error(`Argument "amount" must be an integer between ${SCROLL_MIN} and ${SCROLL_MAX}.`);
  }
  return { direction, amount };
}

/** 只保留显式提供的键，避免 undefined 值进入历史/审计。 */
function pickDefined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
}

/** 点击：移动光标到绝对坐标后按下并抬起（可选双击）。 */
export function createClickTool(deps: ComputerToolDeps): Tool {
  return {
    name: "computer_click",
    description:
      "Move the mouse cursor to an absolute screen position and press a mouse button. " +
      "Coordinates are virtual-screen pixels with the origin at the primary monitor's " +
      "top-left corner. button is left (default), right or middle; double set to true " +
      "performs a double click. Take a screenshot first to locate targets. " +
      "Windows hosts only.",
    readOnly: false,
    sideEffect: "unknown",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number", description: "Target X in pixels (0 .. 100000)" },
        y: { type: "number", description: "Target Y in pixels (0 .. 100000)" },
        button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button, default left" },
        double: { type: "boolean", description: "Perform a double click, default false" },
      },
      required: ["x", "y"],
    },
    validateArgs(args) {
      parseClickArgs(args);
    },
    permissionResource: () => ({ action: "execute", kind: "computer", scope: "input" }),
    persistArgs(args) {
      // 原样保留调用参数（不带解析默认值），供规则匹配与回看。
      return pickDefined({ x: args.x, y: args.y, button: args.button, double: args.double });
    },
    async execute(args, ctx) {
      assertWindowsHost(deps);
      const { x, y, button, double } = parseClickArgs(args);
      await runPowerShellScript(deps.runner, clickScript(x, y, button, double), ctx.signal);
      return {
        content: `Clicked ${button} button at (${x}, ${y})${double ? " (double)" : ""}.`,
      };
    },
  };
}

/** 键入：把 Unicode 文本逐字符注入焦点窗口，换行转为回车键。 */
export function createTypeTool(deps: ComputerToolDeps): Tool {
  return {
    name: "computer_type",
    description:
      "Type text into the currently focused window as individual Unicode keyboard " +
      "events. A newline character in the text presses Enter. The text length must " +
      "be between 1 and 2000 characters. Windows hosts only.",
    readOnly: false,
    sideEffect: "unknown",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to type, 1..2000 characters, \\n presses Enter" },
      },
      required: ["text"],
    },
    validateArgs(args) {
      requireText(args);
    },
    permissionResource: () => ({ action: "execute", kind: "computer", scope: "input" }),
    persistArgs(args) {
      return { text: args.text };
    },
    async execute(args, ctx) {
      assertWindowsHost(deps);
      const text = requireText(args);
      await runPowerShellScript(deps.runner, typeTextScript(text), ctx.signal);
      return { content: `Typed ${text.length} characters.` };
    },
  };
}

/** 按键：命名键/单字符/修饰组合，经 keys.ts 映射为 SendKeys 序列。 */
export function createKeyTool(deps: ComputerToolDeps): Tool {
  return {
    name: "computer_key",
    description:
      "Press a key or key combination in the currently focused window. key accepts " +
      "named keys ('enter', 'esc', 'tab', 'up', 'down', 'left', 'right', 'home', " +
      "'end', 'pgup', 'pgdn', 'delete', 'backspace', 'space', 'f1'..'f12'), a single " +
      "character, or '+'-joined combinations of the modifiers ctrl, alt, shift in " +
      "any order, e.g. 'ctrl+c', 'ctrl+shift+tab', 'alt+f4'. Windows hosts only.",
    readOnly: false,
    sideEffect: "unknown",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Key name, single character, or ctrl/alt/shift combination joined by '+', e.g. 'ctrl+c'",
        },
      },
      required: ["key"],
    },
    validateArgs(args) {
      requireKeySequence(args);
    },
    permissionResource: () => ({ action: "execute", kind: "computer", scope: "input" }),
    persistArgs(args) {
      return { key: args.key };
    },
    async execute(args, ctx) {
      assertWindowsHost(deps);
      const sequence = requireKeySequence(args);
      await runPowerShellScript(deps.runner, keyScript(sequence), ctx.signal);
      return { content: `Pressed key ${String(args.key)}.` };
    },
  };
}

/** 滚轮：在当前光标位置滚动指定方向与格数。 */
export function createScrollTool(deps: ComputerToolDeps): Tool {
  return {
    name: "computer_scroll",
    description:
      "Scroll the mouse wheel at the current cursor position. direction is 'up' or " +
      "'down'; amount is the number of wheel notches between 1 and 10 (default 3). " +
      "Windows hosts only.",
    readOnly: false,
    sideEffect: "unknown",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
        amount: { type: "number", description: "Wheel notches 1..10, default 3" },
      },
      required: ["direction"],
    },
    validateArgs(args) {
      parseScrollArgs(args);
    },
    permissionResource: () => ({ action: "execute", kind: "computer", scope: "input" }),
    persistArgs(args) {
      // 原样保留调用参数（不带解析默认值），供规则匹配与回看。
      return pickDefined({ direction: args.direction, amount: args.amount });
    },
    async execute(args, ctx) {
      assertWindowsHost(deps);
      const { direction, amount } = parseScrollArgs(args);
      await runPowerShellScript(deps.runner, scrollScript(direction, amount), ctx.signal);
      return { content: `Scrolled ${direction} by ${amount}.` };
    },
  };
}
