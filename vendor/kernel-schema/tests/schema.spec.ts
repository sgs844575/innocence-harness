import { describe, expect, it } from "vitest";
import {
  defineSchema,
  validateValue,
  type SchemaSpec,
  type StandardResult,
} from "@innocenceharness/kernel-schema";

// 取出 issues 分支（断言本身保证处于该分支）。
function issuesOf(r: StandardResult<unknown>) {
  if ("issues" in r) return r.issues;
  throw new Error(`expected issues, got value: ${JSON.stringify(r.value)}`);
}

describe("kernel-schema validator", () => {
  it("accepts matching primitive types and rejects mismatches", () => {
    expect(validateValue({ type: "string" }, "ok")).toEqual({ value: "ok" });
    expect(validateValue({ type: "number" }, 1.5)).toEqual({ value: 1.5 });
    expect(validateValue({ type: "boolean" }, false)).toEqual({ value: false });
    expect(issuesOf(validateValue({ type: "string" }, 1))[0]).toMatchObject({
      path: "",
      message: expect.stringContaining("string"),
    });
    expect(issuesOf(validateValue({ type: "number" }, "1"))[0].path).toBe("");
    expect(issuesOf(validateValue({ type: "boolean" }, 0)).length).toBe(1);
  });

  it("rejects NaN for number type", () => {
    expect(issuesOf(validateValue({ type: "number" }, NaN))[0].path).toBe("");
  });

  it("checks enum membership", () => {
    const spec: SchemaSpec = { type: "enum", enumValues: ["a", "b"] };
    expect(validateValue(spec, "a")).toEqual({ value: "a" });
    expect(issuesOf(validateValue(spec, "c")).length).toBe(1);
  });

  it("validates nested object/array mixes", () => {
    const spec: SchemaSpec = {
      type: "object",
      properties: {
        name: { spec: { type: "string" }, required: true },
        tags: { spec: { type: "array", items: { type: "string" } } },
        addr: {
          spec: {
            type: "object",
            properties: { city: { spec: { type: "string" }, required: true } },
          },
        },
      },
    };
    const ok = validateValue(spec, { name: "n", tags: ["x"], addr: { city: "c" } });
    expect(ok).toEqual({ value: { name: "n", tags: ["x"], addr: { city: "c" } } });
    const bad = issuesOf(validateValue(spec, { name: 1, tags: ["x", 2], addr: {} }));
    expect(bad.map((i) => i.path)).toEqual(["name", "tags[1]", "addr.city"]);
  });

  it("reports missing required properties", () => {
    const spec: SchemaSpec = {
      type: "object",
      properties: { a: { spec: { type: "string" }, required: true } },
    };
    expect(issuesOf(validateValue(spec, {}))[0].path).toBe("a");
  });

  it("preserves undeclared extra properties (forward compatible)", () => {
    const spec: SchemaSpec = { type: "object", properties: { a: { spec: { type: "string" } } } };
    const r = validateValue(spec, { a: "x", future: 42 });
    expect(r).toEqual({ value: { a: "x", future: 42 } });
  });

  it("fills defaults for missing object properties (shallow per-property)", () => {
    const spec: SchemaSpec = {
      type: "object",
      properties: {
        level: { spec: { type: "string" }, default: "info" },
        n: { spec: { type: "number" } },
      },
    };
    expect(validateValue(spec, {})).toEqual({ value: { level: "info" } });
    // 显式提供时不覆盖
    expect(validateValue(spec, { level: "debug" })).toEqual({ value: { level: "debug" } });
  });

  it("fills defaults inside nested objects", () => {
    const spec: SchemaSpec = {
      type: "object",
      properties: {
        inner: {
          spec: {
            type: "object",
            properties: { x: { spec: { type: "boolean" }, default: true } },
          },
        },
      },
    };
    expect(validateValue(spec, { inner: {} })).toEqual({ value: { inner: { x: true } } });
    // 内层缺整块时不构造对象（required 未声明）
    expect(validateValue(spec, {})).toEqual({ value: {} });
  });

  it("reports paths in a.b[0].c form with empty root", () => {
    const spec: SchemaSpec = {
      type: "object",
      properties: {
        a: {
          spec: {
            type: "object",
            properties: {
              b: {
                spec: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { c: { spec: { type: "number" }, required: true } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const r = issuesOf(validateValue(spec, { a: { b: [{}, { c: 1 }] } }));
    expect(r.map((i) => i.path)).toEqual(["a.b[0].c"]);
  });

  it("defineSchema wraps a ~standard protocol shape", () => {
    const schema = defineSchema<{ name: string }>({
      type: "object",
      properties: { name: { spec: { type: "string" }, required: true } },
    });
    expect(schema["~standard"].version).toBe(1);
    expect(schema.spec).toBeDefined();
    expect(schema["~standard"].validate({ name: "x" })).toEqual({ value: { name: "x" } });
    expect(issuesOf(schema["~standard"].validate({}))[0].path).toBe("name");
  });
});
