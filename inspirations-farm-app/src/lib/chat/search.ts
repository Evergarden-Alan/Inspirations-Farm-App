import type { CorpusEntry } from "@/lib/chat/corpus-cache";

export interface SearchMatch {
  path: string;
  lines: Array<{ no: number; text: string }>;
}

/** 极简 glob：`**` 跨目录、`*` 单段内、`?` 单字符。 */
export function globToRegExp(glob: string): RegExp {
  const src = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${src}$`);
}

/** 语料缓存内全文搜索。默认字面匹配；`re:` 前缀按正则（非法正则抛错，
 *  由工具层转错误文本）。 */
export function searchCorpus(
  entry: CorpusEntry | null,
  query: string,
  opts: { glob?: string; maxFiles?: number } = {}
): { matches: SearchMatch[]; searched: number; total: number } {
  if (!entry) return { matches: [], searched: 0, total: 0 };
  const maxFiles = opts.maxFiles ?? 20;
  const re = query.startsWith("re:")
    ? new RegExp(query.slice(3))
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const glob = opts.glob ? globToRegExp(opts.glob) : null;
  const matches: SearchMatch[] = [];
  let searched = 0;
  for (const [path, content] of entry.files) {
    if (glob && !glob.test(path)) continue;
    if (matches.length >= maxFiles) break;
    searched++;
    const lines = content.split("\n");
    const hits: Array<{ no: number; text: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ no: i + 1, text: lines[i].slice(0, 200) });
        if (hits.length >= 5) break;
      }
    }
    if (hits.length > 0) matches.push({ path, lines: hits });
  }
  return { matches, searched, total: entry.files.size };
}
