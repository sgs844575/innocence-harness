// 精简 standard-schema（~standard 协议形状）校验器，供 per-plugin config 块校验。
// 零依赖：协议只是形状约定，此处自实现；validate 为纯函数，无副作用。

export interface SchemaIssue {
  path: string;
  message: string;
}

export type StandardResult<T> = { value: T } | { issues: SchemaIssue[] };

export interface SchemaSpec {
  type: "string" | "number" | "boolean" | "enum" | "object" | "array";
  /** type: "enum" 必填 */
  enumValues?: readonly string[];
  /** type: "object" 的属性表 */
  properties?: Record<string, { spec: SchemaSpec; required?: boolean; default?: unknown }>;
  /** type: "array" 的元素规格 */
  items?: SchemaSpec;
  /** 文档用 */
  description?: string;
}

export function validateValue(spec: SchemaSpec, value: unknown): StandardResult<unknown> {
  const issues: SchemaIssue[] = [];
  const out = validate(spec, value, "", issues);
  if (issues.length > 0) return { issues };
  return { value: out };
}

export function defineSchema<T>(spec: SchemaSpec): {
  spec: SchemaSpec;
  ["~standard"]: { version: 1; validate(value: unknown): StandardResult<T> };
} {
  return {
    spec,
    ["~standard"]: {
      version: 1,
      validate(value: unknown): StandardResult<T> {
        return validateValue(spec, value) as StandardResult<T>;
      },
    },
  };
}

/** 递归校验；返回处理后的值（含默认值填充、额外属性保留）。 */
function validate(spec: SchemaSpec, value: unknown, path: string, issues: SchemaIssue[]): unknown {
  switch (spec.type) {
    case "string":
      if (typeof value !== "string") {
        issues.push(issue(path, `expected string, got ${describe(value)}`));
        return value;
      }
      return value;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        issues.push(issue(path, `expected number, got ${describe(value)}`));
        return value;
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        issues.push(issue(path, `expected boolean, got ${describe(value)}`));
        return value;
      }
      return value;
    case "enum": {
      const allowed = spec.enumValues ?? [];
      if (typeof value !== "string" || !allowed.includes(value)) {
        issues.push(issue(path, `expected one of [${allowed.join(", ")}], got ${describe(value)}`));
        return value;
      }
      return value;
    }
    case "object":
      return validateObject(spec, value, path, issues);
    case "array":
      return validateArray(spec, value, path, issues);
  }
}

function validateObject(
  spec: SchemaSpec,
  value: unknown,
  path: string,
  issues: SchemaIssue[],
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(issue(path, `expected object, got ${describe(value)}`));
    return value;
  }
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...input }; // 未声明属性保留（前向兼容）
  for (const [key, prop] of Object.entries(spec.properties ?? {})) {
    const childPath = path === "" ? key : `${path}.${key}`;
    if (!(key in input)) {
      if (prop.required) {
        issues.push(issue(childPath, "required property is missing"));
      }
      if (prop.default !== undefined) {
        out[key] = prop.default; // 浅合并：仅当属性缺失时填充默认值
      }
      continue;
    }
    out[key] = validate(prop.spec, input[key], childPath, issues);
  }
  return out;
}

function validateArray(
  spec: SchemaSpec,
  value: unknown,
  path: string,
  issues: SchemaIssue[],
): unknown {
  if (!Array.isArray(value)) {
    issues.push(issue(path, `expected array, got ${describe(value)}`));
    return value;
  }
  return value.map((item, i) => validate(spec.items ?? { type: "string" }, item, `${path}[${i}]`, issues));
}

function issue(path: string, message: string): SchemaIssue {
  return { path, message };
}

function describe(value: unknown): string {
  if (typeof value === "string") return `string "${value}"`;
  if (typeof value === "number") return Number.isNaN(value) ? "NaN" : `number ${value}`;
  if (typeof value === "boolean") return `boolean ${value}`;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return `unknown (${typeof value})`;
}
