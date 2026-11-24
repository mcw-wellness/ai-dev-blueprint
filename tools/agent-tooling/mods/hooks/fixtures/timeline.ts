// Written by skills/progress/scripts/test_plan.py: session_timeline.py's --json for one
// session at 11:00Z. Regenerate with UPDATE_FIXTURE=1 rather than edit it.
import type { Timeline } from '../../types'

export const NOW = 1792926000000
export const SESSION = '2eff9726-4b8c-4b95-9f5d-3a808968d2b9'
export const TIMELINE: Timeline = {
 "sinks": {
  "wall": 180.0,
  "serial": 35.0,
  "classes": [
   {
    "name": "waiting on owner",
    "minutes": 40.0,
    "gaps": []
   },
   {
    "name": "CI and deploy",
    "minutes": 14.0,
    "gaps": [
     {
      "minutes": 14.0,
      "at": "2026-10-25T10:35:00+00:00",
      "summary": "Bash Wait for CI on #12"
     }
    ]
   },
   {
    "name": "subagent work",
    "minutes": 35.0,
    "gaps": [
     {
      "minutes": 30.0,
      "at": "2026-10-25T08:00:00+00:00",
      "summary": "Design cockpit (general-purpose)"
     },
     {
      "minutes": 5.0,
      "at": "2026-10-25T10:31:00+00:00",
      "summary": "View board (general-purpose)"
     }
    ]
   },
   {
    "name": "active work",
    "minutes": 91.0,
    "gaps": []
   }
  ]
 },
 "plan": {
  "steps": [
   {
    "step": {
     "name": "design",
     "after": [],
     "estMinutes": 120,
     "baseMinutes": 120,
     "agents": "Design",
     "marks": [],
     "note": ""
    },
    "state": "done",
    "strands": [
     {
      "name": "Design cockpit",
      "start": 1792915200000.0,
      "end": 1792924200000.0,
      "failed": false
     }
    ],
    "planStart": 1792915200000.0,
    "planEnd": 1792922400000.0,
    "start": 1792915200000.0,
    "end": 1792924200000.0,
    "actualStart": 1792915200000.0,
    "slip": 30.0
   },
   {
    "step": {
     "name": "keys",
     "after": [
      "design"
     ],
     "estMinutes": 60,
     "baseMinutes": 60,
     "agents": "",
     "marks": [
      "you"
     ],
     "note": "create the app"
    },
    "state": "waiting",
    "strands": [],
    "planStart": 1792922400000.0,
    "planEnd": 1792926000000.0,
    "start": 1792924200000.0,
    "end": 1792929600000.0,
    "actualStart": null,
    "slip": 60.0
   },
   {
    "step": {
     "name": "since",
     "after": [
      "design"
     ],
     "estMinutes": 60,
     "baseMinutes": 60,
     "agents": "View since",
     "marks": [],
     "note": ""
    },
    "state": "running",
    "strands": [
     {
      "name": "View since",
      "start": 1792924260000.0,
      "end": null,
      "failed": false
     }
    ],
    "planStart": 1792922400000.0,
    "planEnd": 1792926000000.0,
    "start": 1792924260000.0,
    "end": 1792927860000.0,
    "actualStart": 1792924260000.0,
    "slip": 31.0
   },
   {
    "step": {
     "name": "board",
     "after": [
      "design"
     ],
     "estMinutes": 60,
     "baseMinutes": 60,
     "agents": "View board",
     "marks": [],
     "note": ""
    },
    "state": "done",
    "strands": [
     {
      "name": "View board",
      "start": 1792924260000.0,
      "end": 1792926000000.0,
      "failed": false
     }
    ],
    "planStart": 1792922400000.0,
    "planEnd": 1792926000000.0,
    "start": 1792924260000.0,
    "end": 1792926000000.0,
    "actualStart": 1792924260000.0,
    "slip": 0
   },
   {
    "step": {
     "name": "review",
     "after": [
      "since",
      "keys"
     ],
     "estMinutes": 60,
     "baseMinutes": 60,
     "agents": "",
     "marks": [
      "branch"
     ],
     "note": "one round or two; one round saves 45m"
    },
    "state": "todo",
    "strands": [],
    "planStart": 1792926000000.0,
    "planEnd": 1792929600000.0,
    "start": 1792929600000.0,
    "end": 1792933200000.0,
    "actualStart": null,
    "slip": 60.0
   }
  ],
  "anchor": 1792915200000.0,
  "forecast": 1792933200000.0,
  "baseline": 1792929600000.0,
  "promised": 1792936800000.0,
  "first": 1792931400000.0,
  "earlier": [
   1792931400000.0,
   1792935000000.0
  ],
  "late": false,
  "asks": [
   {
    "what": "create the app",
    "since": 1792924200000.0,
    "blocks": 1
   },
   {
    "what": "pick a palette",
    "blocks": 0
   }
  ],
  "cuts": [
   {
    "text": "Answer keys: unblocks 1 step",
    "saves": null,
    "owner": true,
    "trades": "nothing",
    "basis": "create the app; waiting 30m, the finish moves with each minute"
   },
   {
    "text": "Decide review for the shorter branch",
    "saves": 45.0,
    "trades": "verification",
    "basis": "one round or two; one round saves 45m"
   },
   {
    "text": "Background the serial waits",
    "saves": 23.333333333333332,
    "trades": "nothing",
    "basis": "35m of 3h00m sat on one call, scaled to the 2h00m left"
   }
  ],
  "agents": [
   {
    "name": "Design cockpit",
    "start": 1792915200000.0,
    "end": 1792924200000.0,
    "failed": false
   },
   {
    "name": "View since",
    "start": 1792924260000.0,
    "end": null,
    "failed": false
   },
   {
    "name": "View board",
    "start": 1792924260000.0,
    "end": 1792926000000.0,
    "failed": false
   }
  ],
  "critical": [
   "review",
   "keys",
   "design"
  ],
  "thread": {
   "name": "cockpit",
   "theme": "tooling",
   "state": "running",
   "finish": "2026-10-25T14:00Z, estimate",
   "slip": "",
   "session": "2eff9726-4b8c-4b95-9f5d-3a808968d2b9",
   "failing": [],
   "slipping": "",
   "moves": [
    [
     1792918800.0,
     3600
    ],
    [
     1792922700.0,
     1800
    ]
   ],
   "plan": [
    {
     "name": "design",
     "after": [],
     "estMinutes": 120,
     "baseMinutes": 120,
     "agents": "Design",
     "marks": [],
     "note": ""
    },
    {
     "name": "keys",
     "after": [
      "design"
     ],
     "estMinutes": 60,
     "baseMinutes": 60,
     "agents": "",
     "marks": [
      "you"
     ],
     "note": "create the app"
    },
    {
     "name": "since",
     "after": [
      "design"
     ],
     "estMinutes": 60,
     "baseMinutes": 60,
     "agents": "View since",
     "marks": [],
     "note": ""
    },
    {
     "name": "board",
     "after": [
      "design"
     ],
     "estMinutes": 60,
     "baseMinutes": 60,
     "agents": "View board",
     "marks": [],
     "note": ""
    },
    {
     "name": "review",
     "after": [
      "since",
      "keys"
     ],
     "estMinutes": 60,
     "baseMinutes": 60,
     "agents": "",
     "marks": [
      "branch"
     ],
     "note": "one round or two; one round saves 45m"
    }
   ],
   "finish_at": 1792936800.0
  }
 }
}
