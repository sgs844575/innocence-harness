# kernel-schema — 精简 standard-schema 校验器

`@innocenceharness/kernel-schema` 提供零依赖的 ~standard 协议形状校验器，
供 per-plugin config 块校验（消费方接线见后续任务）。协议只是形状约定，
此处自实现，不引入外部 schema 依赖。

## 公开 API

| 导出 | 说明 |
|---|---|
| `SchemaIssue` | `{ path: string; message: string }` |
| `StandardResult<T>` | `{ value: T } \| { issues: SchemaIssue[] }` |
| `SchemaSpec` | 规格树：`type`（string/number/boolean/enum/object/array）+ `enumValues` / `properties`（含 `required`、`default`）/ `items` / `description` |
| `defineSchema<T>(spec)` | 包装为 `{ spec, "~standard": { version: 1, validate } }` |
| `validateValue(spec, value)` | 核心纯函数：递归校验，返回填充默认值后的值或 issues |

## 关键行为

- 类型检查：typeof 严格；`number` 拒 `NaN`；`enum` 按值集匹配。
- object 逐属性递归：`required` 缺失报 issue；**未声明属性保留**（前向兼容）。
- `default` 填充：仅 object 类型、浅合并逐属性——属性缺失且声明 `default` 时填充；
  显式提供时不覆盖；嵌套 object 内部同样适用；缺失整块子对象时不构造。
- array 逐项递归（`items`）。
- 错误路径 `a.b[0].c` 形式，根为空串。
- `validate` 纯函数零副作用；`defineSchema` 仅包装。

## 测试

```bash
npx vitest run vendor/kernel-schema
```

`tests/schema.spec.ts` 十个用例：类型全覆盖、enum 命中/未命中、嵌套 object/array 混合、
required 缺失、额外属性保留、默认值填充（含嵌套）、NaN 拒绝、路径正确性、
~standard 协议形状。
