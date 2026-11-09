// What `session_timeline.py <session> --json --board -` prints (skills/progress/scripts): the
// prompt hint reads this and computes none of it. Times in the plan and board are epoch milliseconds.

/** One step of a handoff's `## Plan` table, as `board --status` parses it. */
export type Step = {
  name: string
  /** Steps it waits for; none: it starts with the plan. */
  after: string[]
  estMinutes: number
  baseMinutes: number
  /** Prefix of the Agent descriptions that do the step; "" when the lead does it. */
  agents: string
  /** `you` (needs the owner), `branch` (a decision that changes the plan), `done` (a lead step finished). */
  marks: string[]
  /** The decision a `branch` step settles, or the owner's action on a `you` step. */
  note: string
}

/** One live handoff as `board --status` prints it. */
export type Thread = {
  name: string
  theme: string
  state: string
  finish: string
  /** `finish`'s leading UTC time, epoch seconds; null when it has none. */
  finish_at: number | null
  slip: string
  session: string
  /** The handoff's `Next:` line; absent from a board older than it. */
  next?: string
  /** Failures maintenance last recorded, but a slipping finish, which is `slipping`. */
  failing: string[]
  slipping: string
  /** Each counted later move of `Finish:`: [seen at, later by], epoch seconds. */
  moves: [number, number][]
  plan: Step[]
}

/** One agent of the session. */
export type Strand = { name: string; start: number; end: number | null; failed: boolean }

export type StepState = 'done' | 'running' | 'waiting' | 'todo' | 'failed'

/** A step on the clock: its baseline, what happened, then what is expected. */
export type Placed = {
  step: Step
  state: StepState
  strands: Strand[]
  planStart: number
  planEnd: number
  start: number
  end: number
  actualStart: number | null
  /** Minutes its end lies past the baseline's; 0 when that is noise. */
  slip: number
}

/** Something waiting on the owner: a step blocked on them, or a Needs-you item. */
export type Ask = { what: string; since?: number; blocks: number }

/** One way to finish sooner; `saves` minutes, null when the data cannot size it; `owner`: only the owner clears it. */
export type Cut = { text: string; saves: number | null; owner?: true; trades: 'nothing' | 'verification' | 'cost'; basis: string }

/** This session's thread on the clock; without a handoff, each agent is a step. */
export type Plan = {
  thread: Thread | null
  steps: Placed[]
  anchor: number
  forecast: number
  baseline: number
  /** `Finish:`'s time, the first one promised, the ones before the current. */
  promised: number | null
  first: number | null
  earlier: number[]
  late: boolean
  asks: Ask[]
  cuts: Cut[]
  agents: Strand[]
  /** The steps the forecast waits on, last first. */
  critical: string[]
}

/** Where the session's wall time went, in minutes. */
export type Sinks = {
  wall: number
  /** Gaps with one call in flight that nothing overlapped. */
  serial: number
  /** Each class (`waiting on owner`, `CI and deploy`, ..., `active work`), largest gaps first. */
  classes: { name: string; minutes: number; gaps: { minutes: number; at: string; summary: string }[] }[]
}

/** What the timeline prints: where the time went (read by the progress skill) and the plan. */
export type Timeline = {
  sinks: Sinks
  plan: Plan
}

/** A host command's parsed output, or why it could not be read. */
export type Loaded<T> = { value: T } | { error: string }

/** This session's timeline as last read, refreshed each minute. */
export type Snapshot = { timeline: Loaded<Timeline> }

/** One decision of a `🔴 Needs you` block: its number there, its point, the replies offered, the one recommended. */
/** `opens`: the pages and links its text says to open (`` `! open ~/x.html` ``). */
export type Decision = { n: number; title: string; options: string[]; recommended?: string; opens?: string[] }

/**
 * The last final message's decisions, when each was first asked (absent when not seen), its text, the session it is of, and
 * the replies the owner has picked so far, by decision number, sent together once every open decision has one.
 */
export type Asked = {
  decisions: (Decision & { askedAt?: number })[]
  answer: string
  /** The message the decisions come from; `answer` moves on to an explanation, this does not. */
  block: string
  /** The band is put away: hidden, answered, or the owner wrote. */
  dismissed: boolean
  /** The block is answered; its picks stay to show what was sent. */
  sent: boolean
  session: string
  picks: [number, string][]
  /** The band's rows the owner dismissed, by key (`d2`, `draft1`): gone from the band, never sent. */
  dropped: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'agent-tooling': {
      snapshot: Shaped<Snapshot | null>
      /** `/rename <thread>` was offered or the owner renamed the session. */
      named: Shaped<boolean>
      asked: Shaped<Asked | null>
    }
  }
}
