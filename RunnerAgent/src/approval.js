import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

export async function askApproval(message) {
  const rl = readline.createInterface({ input, output })
  try {
    const answer = await rl.question(`${message}\nAprobar? [y/N]: `)
    return ['y', 'yes', 's', 'si', 'sí'].includes(answer.trim().toLowerCase())
  } finally {
    rl.close()
  }
}
