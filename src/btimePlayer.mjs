// Playable Burger Time: the translated main and sound programs
// (btimeMachine.mjs) on a canvas at the board's 57.44 Hz, the arcade panel on
// the keyboard, a gamepad or touch buttons, and the AY sound worklet. Mount
// with mountPlayer(root); root holds the canvas and the [data-*] controls.
import { BtimeMachine, BtimeSound } from './btimeMachine.mjs';
import { CYCLES_PER_FRAME } from './btimeBus.mjs';
import { SOUND_CYCLES_PER_FRAME } from './btimeSound.mjs';
import { decodeGfx, renderFrame, toScreenRGBA } from './btimeVideo.mjs';
import { GFX1, GFX2, BG_MAP } from './btimeGfxData.mjs';
import { createAudio } from './btimeAudio.mjs';
import { readGamepad, gamepadEdges } from './gamepad.mjs';

const FRAME_MS = (CYCLES_PER_FRAME / 1.5e6) * 1000; // 17.408 ms
const KEYS = {
  ArrowRight: 'right', KeyD: 'right', ArrowLeft: 'left', KeyA: 'left',
  ArrowDown: 'down', KeyS: 'down', ArrowUp: 'up', KeyW: 'up',
  Space: 'pepper', KeyZ: 'pepper', KeyX: 'pepper',
};
const DIRS = ['right', 'left', 'up', 'down']; // P1 bits 0-3
const COIN_FRAMES = 4;   // how long a coin holds the switch
const START_FRAMES = 4;
// RAM: $1B game in progress, $1D credits
const PLAYING = 0x1b, CREDITS = 0x1d;

export function mountPlayer(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const playButton = root.querySelector('[data-play]');
  const poster = root.querySelector('[data-poster]');
  const hint = root.querySelector('[data-hint]');
  const muteButton = root.querySelector('[data-mute]');
  const pauseButton = root.querySelector('[data-pause]');

  const machine = new BtimeMachine();
  const sound = new BtimeSound();
  const gfx = decodeGfx(GFX1, GFX2);
  const audio = createAudio(new URL('./btimeSound.worklet.js', import.meta.url).href);
  const screen = document.createElement('canvas');
  screen.width = 240;
  screen.height = 240;
  const screenCtx = screen.getContext('2d');
  const image = screenCtx.createImageData(240, 240);
  const pens = new Uint8Array(256 * 256);

  const held = new Set();
  const order = [];       // joystick directions in the order they were pressed
  let started = false, paused = false, muted = false;
  let coinHold = 0, startHold = 0, start2Hold = 0, pendingStart = 0;
  let last = 0, acc = 0, pad = null, lastHint = '';

  const setHint = (text) => { if (hint && text !== lastHint) { hint.textContent = text; lastHint = text; } };
  const silence = () => audio.setSilent(muted || paused || !started);
  const ram = (addr) => machine.bus.ram[addr];

  function press(control) {
    if (DIRS.includes(control)) { const i = order.indexOf(control); if (i >= 0) order.splice(i, 1); order.push(control); }
    held.add(control);
  }
  function release(control) {
    held.delete(control);
    const i = order.indexOf(control);
    if (i >= 0) order.splice(i, 1);
  }

  function insertCoin() { coinHold = COIN_FRAMES; }

  function step() {
    // the panel's 4-way joystick: the most recently pressed direction held
    const on = (c) => held.has(c) || !!pad?.[c];
    let dir = null;
    for (let i = order.length - 1; i >= 0; i -= 1) if (on(order[i])) { dir = order[i]; break; }
    if (!dir) dir = DIRS.find((d) => pad?.[d]) ?? null;
    let p1 = 0xff;
    if (dir) p1 &= ~(1 << DIRS.indexOf(dir));
    if (on('pepper')) p1 &= ~0x10;
    machine.bus.p1 = p1;
    // a Play/Start press: coin first, then the start button once it counts
    if (pendingStart > 0 && (pendingStart -= 1) === 0) startHold = START_FRAMES;
    let system = 0x3f;
    if (startHold > 0) { system &= ~0x01; startHold -= 1; }
    if (start2Hold > 0) { system &= ~0x02; start2Hold -= 1; }
    if (coinHold > 0) { system |= 0x40; coinHold -= 1; }
    machine.setSystem(system);

    machine.runFrame();
    const frameStart = sound.timeline.frame * SOUND_CYCLES_PER_FRAME;
    sound.runFrame(machine.bus.soundCommands);
    audio.pushFrame(sound.bus.writes, frameStart);

    if (started) {
      if (ram(PLAYING)) setHint('Arrows or WASD move and climb; Space, Z or X peppers. P pauses, M mutes.');
      else if (ram(CREDITS)) setHint('Press 1 (or Enter) for one player, 2 for two.');
      else setHint('Press 5 or C to insert a coin, or Enter to play.');
    }
  }

  function draw() {
    renderFrame(machine.bus, gfx, BG_MAP, pens);
    toScreenRGBA(pens, machine.bus.palette, image.data);
    screenCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(screen, 0, 0, canvas.width, canvas.height);
  }

  function frame(t) {
    if (!last) last = t;
    const dt = Math.min(100, t - last);
    last = t;
    pad = readGamepad();
    const edges = gamepadEdges(pad);
    if (edges.start) play();
    if (edges.back && started) togglePause();
    if (!paused && !document.hidden) {
      acc += dt;
      while (acc >= FRAME_MS) { step(); acc -= FRAME_MS; }
    }
    draw();
    requestAnimationFrame(frame);
  }

  // Play / Enter / gamepad Start: a coin (if there is no credit) and 1P start
  async function play() {
    if (!started) {
      started = true;
      if (poster) poster.hidden = true;
      canvas.focus({ preventScroll: true });
    }
    if (paused) togglePause();
    if (!ram(PLAYING)) {
      if (!ram(CREDITS)) { insertCoin(); pendingStart = 30; } else startHold = START_FRAMES;
    }
    silence();
    await audio.start();
    silence();
  }

  function togglePause() {
    paused = !paused;
    if (pauseButton) pauseButton.textContent = paused ? 'Resume' : 'Pause';
    silence();
  }

  function toggleMute() {
    muted = !muted;
    if (muteButton) {
      muteButton.textContent = muted ? 'Sound on' : 'Mute';
      muteButton.setAttribute('aria-pressed', String(muted));
    }
    silence();
  }

  async function wake() {
    if (!started) { started = true; if (poster) poster.hidden = true; }
    await audio.start();
    silence();
  }

  playButton?.addEventListener('click', play);
  pauseButton?.addEventListener('click', () => { if (started) togglePause(); });
  muteButton?.addEventListener('click', toggleMute);
  root.querySelector('[data-coin]')?.addEventListener('click', () => { insertCoin(); wake(); });
  root.querySelector('[data-start1]')?.addEventListener('click', () => { startHold = START_FRAMES; wake(); });
  root.querySelector('[data-start2]')?.addEventListener('click', () => { start2Hold = START_FRAMES; wake(); });

  canvas.addEventListener('keydown', (event) => {
    const control = KEYS[event.code];
    if (control) { event.preventDefault(); press(control); }
    switch (event.code) {
      case 'Enter': event.preventDefault(); play(); break;
      case 'Digit5': case 'KeyC': insertCoin(); wake(); break;
      case 'Digit1': startHold = START_FRAMES; wake(); break;
      case 'Digit2': start2Hold = START_FRAMES; wake(); break;
      case 'KeyP': togglePause(); break;
      case 'KeyM': toggleMute(); break;
      default: break;
    }
  });
  canvas.addEventListener('keyup', (event) => { const control = KEYS[event.code]; if (control) release(control); });
  canvas.addEventListener('blur', () => { held.clear(); order.length = 0; });
  canvas.addEventListener('pointerdown', () => { if (!started) play(); });

  // touch controls: hold to press
  root.querySelectorAll('[data-hold]').forEach((button) => {
    const control = button.dataset.hold;
    const down = (event) => {
      event.preventDefault();
      press(control);
      if (!started) play();
      try { button.setPointerCapture(event.pointerId); } catch { /* finger already lifted: the press still counts */ }
    };
    const up = () => release(control);
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
  });

  document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));

  step();
  draw();
  requestAnimationFrame(frame);

  // dev hook for headless checks: runs frames without the animation loop
  return {
    machine,
    sound,
    step(n = 1) { for (let i = 0; i < n; i += 1) step(); draw(); },
    hold(control, on) { if (on) press(control); else release(control); },
    coin: insertCoin,
    start1: () => { startHold = START_FRAMES; },
    play,
  };
}
