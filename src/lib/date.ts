/**
 * 内容日期的唯一格式化入口。
 *
 * frontmatter 中的 `YYYY-MM-DD` 会被解析成 UTC 零点。如果格式化时沿用构建机的
 * 本地时区，美国等负时区会把它显示成前一天。内容日期不是“当地此刻”，所以这里
 * 明确固定为 UTC：同一份内容在作者电脑、CI 和部署平台上必须显示同一天。
 */
export function formatContentDate(
  date: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat('zh-CN', { ...options, timeZone: 'UTC' }).format(date);
}

/** 归档分组也必须使用与显示相同的 UTC 日历。 */
export function contentYear(date: Date): number {
  return date.getUTCFullYear();
}
