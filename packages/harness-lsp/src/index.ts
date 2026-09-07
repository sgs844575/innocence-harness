// 语言服务器能力包入口：LSP 客户端（Content-Length 分帧）、会话管理与
// 诊断投影。宿主（src/main 的 lspService）按 settings 声明装配；本包不
// 感知 Electron/IPC/渲染层。
export * from "./protocol";
export * from "./diagnostics";
export * from "./client";
export * from "./manager";
