// One WhatsApp connection per machine: two linked-device sockets with the same keys kick each other off.
// The lock file is created complete (pid written first, then hard-linked into place), so nobody ever
// reads an empty lock. Known gap: two processes taking over the same stale lock at the same instant.
import { writeFileSync, linkSync, readFileSync, unlinkSync, existsSync } from 'node:fs'

const isRunning = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    if (err.code === 'ESRCH') return false
    if (err.code === 'EPERM') return true // exists, owned by someone else
    throw err
  }
}

export function acquireLock(path) {
  const mine = `${path}.${process.pid}`
  writeFileSync(mine, String(process.pid), { mode: 0o600 })
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        linkSync(mine, path) // atomic, fails if the lock exists
        return () => {
          if (existsSync(path) && readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path)
        }
      } catch (err) {
        if (err.code !== 'EEXIST') throw err
        const pid = Number(readFileSync(path, 'utf8'))
        if (isRunning(pid)) throw new Error(`WhatsApp lock ${path} is held by running pid ${pid}; another wa command is connected. Wait for it or stop it.`)
        unlinkSync(path) // stale: its process is gone
      }
    }
    throw new Error(`could not acquire ${path}`)
  } finally {
    unlinkSync(mine)
  }
}
