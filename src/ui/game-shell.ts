import type { ArenaMap, ArenaMapSummary } from '../shared/contracts'

export type HudRefs = {
  renderHost: HTMLDivElement
  shell: HTMLDivElement
  intro: HTMLDivElement
  startButton: HTMLButtonElement
  gameOver: HTMLDivElement
  respawnButton: HTMLButtonElement
  mainMenuButton: HTMLButtonElement
  finalScore: HTMLSpanElement
  status: HTMLParagraphElement
  health: HTMLSpanElement
  healthBar: HTMLDivElement
  score: HTMLSpanElement
  targets: HTMLSpanElement
  fps: HTMLSpanElement
  hint: HTMLParagraphElement
  damage: HTMLDivElement
  hitCounter: HTMLDivElement
  minimap: HTMLCanvasElement
}

export function mountGameShell(
  root: HTMLDivElement,
  loadedMap: ArenaMap,
  availableMaps: ArenaMapSummary[],
): HudRefs {
  root.innerHTML = `
    <div class="game-shell">
      <div class="render-host"></div>
      <div class="health-bar-container" aria-hidden="true">
        <div class="health-bar-fill" data-health-bar></div>
      </div>
      <div class="hud-panel hud-top">
        <span class="hud-chip">Health <strong data-health>100</strong></span>
        <span class="hud-chip">Kills <strong data-score>00</strong></span>
        <span class="hud-chip">Targets <strong data-targets>0</strong></span>
        <span class="hud-chip">FPS <strong data-fps>00</strong></span>
      </div>
      <div class="minimap-panel" aria-hidden="true">
        <canvas class="minimap-canvas" data-minimap width="352" height="352"></canvas>
      </div>
      <div class="flashlight-falloff" aria-hidden="true"></div>
      <div class="light-stencil" aria-hidden="true"></div>
      <div class="hit-counter-layer" data-hit-counter aria-hidden="true"></div>
      <div class="crosshair" aria-hidden="true"></div>
      <div class="damage-vignette" aria-hidden="true"></div>
      <div class="game-over-overlay" data-game-over data-hidden="true">
        <h2>SUIT BREACH</h2>
        <p class="game-over-message">VibeQuake systems offline</p>
        <p class="final-score-display">Kills: <strong data-final-score>0</strong></p>
        <button type="button" data-respawn>Reconstruct Suit</button>
        <button type="button" class="secondary-button" data-main-menu>Return to Main Menu</button>
      </div>
      <div class="intro-card" data-intro data-hidden="false">
        <p class="eyebrow">${loadedMap.name}</p>
        <h1>VibeQuake</h1>
        <p class="intro-copy">${loadedMap.description}</p>
        <div class="map-selector">
          <label class="map-selector-label">Select Arena:</label>
          <div class="map-buttons">
            ${availableMaps.map(map => `
              <button type="button" class="map-button ${map.id === loadedMap.id ? 'active' : ''}" data-map-id="${map.id}" data-map-name="${map.name}">
                ${map.name}
              </button>
            `).join('')}
          </div>
          <div class="world-directory" data-world-directory>
            <p class="world-directory-empty">Querying active worlds...</p>
          </div>
        </div>
        <button type="button" data-start>Engage Arena</button>
        <p class="status-line" data-status>Click engage, then clear the sentinels.</p>
        <p class="hint-line" data-hint>WASD strafe  SHIFT push  SPACE hop  MOUSE fire</p>
      </div>
    </div>
  `

  const shell = root.querySelector<HTMLDivElement>('.game-shell')
  const host = root.querySelector<HTMLDivElement>('.render-host')
  const intro = root.querySelector<HTMLDivElement>('[data-intro]')
  const startButton = root.querySelector<HTMLButtonElement>('[data-start]')
  const gameOver = root.querySelector<HTMLDivElement>('[data-game-over]')
  const respawnButton = root.querySelector<HTMLButtonElement>('[data-respawn]')
  const mainMenuButton = root.querySelector<HTMLButtonElement>('[data-main-menu]')
  const finalScore = root.querySelector<HTMLSpanElement>('[data-final-score]')
  const status = root.querySelector<HTMLParagraphElement>('[data-status]')
  const health = root.querySelector<HTMLSpanElement>('[data-health]')
  const healthBar = root.querySelector<HTMLDivElement>('[data-health-bar]')
  const score = root.querySelector<HTMLSpanElement>('[data-score]')
  const targets = root.querySelector<HTMLSpanElement>('[data-targets]')
  const fps = root.querySelector<HTMLSpanElement>('[data-fps]')
  const hint = root.querySelector<HTMLParagraphElement>('[data-hint]')
  const damage = root.querySelector<HTMLDivElement>('.damage-vignette')
  const hitCounter = root.querySelector<HTMLDivElement>('[data-hit-counter]')
  const minimap = root.querySelector<HTMLCanvasElement>('[data-minimap]')

  if (!shell || !host || !intro || !startButton || !gameOver || !respawnButton || !mainMenuButton || !finalScore || !status || !health || !healthBar || !score || !targets || !fps || !hint || !damage || !hitCounter || !minimap) {
    throw new Error('Game UI failed to mount')
  }

  return {
    renderHost: host,
    shell,
    intro,
    startButton,
    gameOver,
    respawnButton,
    mainMenuButton,
    finalScore,
    status,
    health,
    healthBar,
    score,
    targets,
    fps,
    hint,
    damage,
    hitCounter,
    minimap,
  }
}
