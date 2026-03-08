import './style.css'
import { startGame } from './game'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root')
}

void startGame(app).catch((error) => {
  app.innerHTML = `<div style="padding:1.5rem;color:#f5efe6;font-family:Georgia, Garamond, serif;">Failed to start PHOTONIC: ${error instanceof Error ? error.message : 'Unknown error'}</div>`
})
