import { QUOTES, code } from './blocks'

// A pull request or issue named as `<repo>#<n>` is a link to it (owner, 2026-10-27: "make them hyperlinks I can click"):
// `owner/repo`, a VVS repository (`trading.executors`, `lighter-rs`), this one, or the short names agents write.
const OWNERS: Record<string, string> = { 'agent-tooling': 'wendelinwemhoener/agent-tooling' }
const SHORT: Record<string, string> = { pe: 'trading.polymarket-executor', te: 'trading.executors' }
const REPO = String.raw`[\w-]+\/[\w.-]+|(?:trading|data|research|infra|tools)\.[\w-]+|\.github-private|lighter-rs|agent-tooling|pe|te`
// A reference and the numbers chained after it: `te#1770-#1774`, `pe#1056/#1062`, `infra.aws#899, #902`.
const REF = new RegExp(String.raw`(?<![\w./@#-])(${REPO})#(\d+)((?:\s?[-–/,]\s?#\d+)*)(?![\w-])`, 'g')
// What keeps its text: a code span, a link or reference link, an autolink or bare URL, and a quoted reply the Reply band
// matches as written.
const KEEP = new RegExp(
  String.raw`(\`+)[\s\S]*?\1|\[[^\]\n]*\](?:\([^)\n]*\)|\[[^\]\n]*\])|<https?:[^>\n]*>|https?:\/\/\S+|${QUOTES.source}`,
  'g',
)

const url = (repo: string, n: string): string => {
  const full = OWNERS[repo] ?? (repo.includes('/') ? repo : `vvs-capital/${SHORT[repo] ?? repo}`)
  // GitHub sends an issue's number on to its pull request.
  return `https://github.com/${full}/issues/${n}`
}

const link = (text: string): string =>
  text.replace(REF, (_, repo: string, n: string, chain: string) => {
    const more = chain.replace(/#(\d+)/g, (_m, k: string) => `[#${k}](${url(repo, k)})`)
    return `[${repo}#${n}](${url(repo, n)})${more}`
  })

/** Markdown with each `<repo>#<n>` outside code, links, quotes and fences made a link to it. */
export function linked(md: string): string {
  const lines = md.split('\n')
  const fenced = code(lines)
  return lines
    .map((line, i) => {
      if (fenced[i]) return line
      let out = '',
        at = 0
      for (const m of line.matchAll(KEEP)) {
        out += link(line.slice(at, m.index)) + m[0]
        at = m.index + m[0].length
      }
      return out + link(line.slice(at))
    })
    .join('\n')
}
