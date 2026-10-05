/** PNG 头解析(仅取 IHDR 尺寸,零依赖);导入器用,不做像素级处理 */
export function pngSize(buf: Buffer): { width: number; height: number } {
  const PNG_SIGNATURE = 0x89504e47;
  if (buf.length < 24 || buf.readUInt32BE(0) !== PNG_SIGNATURE) {
    throw new Error('不是有效的 PNG 文件');
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('PNG 首块不是 IHDR(非常规 PNG)');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
