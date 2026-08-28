// module-details-from-path 无自带类型；此处按实际 API 面声明（仅本仓库用到的部分）。
declare module "module-details-from-path" {
  interface ModuleDetails {
    /** 包名（含 scope）。 */
    name: string;
    /** 包根目录绝对路径。 */
    basedir: string;
    /** 包内文件的相对路径（平台分隔符）。 */
    path: string;
  }
  /** 从 node_modules 形态的文件路径解析包身份；非 node_modules 路径返回 null。 */
  function moduleDetailsFromPath(file: string): ModuleDetails | null | undefined;
  export = moduleDetailsFromPath;
}
