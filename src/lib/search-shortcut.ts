/** 判断一次键盘事件是否应该触发全站搜索。 */
export function shouldOpenSearch({
  key,
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  targetTag = '',
  targetEditable = false,
}: {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly targetTag?: string;
  readonly targetEditable?: boolean;
}): boolean {
  if (key !== '/' || ctrlKey || metaKey || altKey || targetEditable) return false;
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag.toUpperCase());
}
