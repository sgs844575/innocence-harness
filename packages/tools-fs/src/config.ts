/**
 * fs 插件工厂配置：宿主按当次 settings 快照装配（经 PluginFactoryContext
 * settings → 组合根工厂入参）；零配置缺省与设置默认值对齐。
 */
export interface FsPluginConfig {
  /**
   * enhancedFindGrep："auto"（默认）探测外部搜索引擎（rg/ugrep），探测或
   * 执行失败回退纯 Node 扫描；"builtin" 恒走内置 Node 扫描，从不探测
   * 外部引擎（不孵化任何搜索进程）。
   */
  searchEngine?: "auto" | "builtin";
}
