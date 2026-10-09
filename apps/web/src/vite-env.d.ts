/* 构建信息由 vite define 构建期内联(见 vite.config.ts resolveBuildInfo),运行时为常量字面量 */
declare const __BUILD_INFO__: {
  readonly version: string;
  readonly sha: string;
  readonly time: string;
};
