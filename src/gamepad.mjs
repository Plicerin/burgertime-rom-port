// Reads the first connected gamepad (standard mapping) as the arcade panel:
// left stick or D-pad for the joystick, A/B/X/Y for pepper, Start to insert a
// coin and start, Back/Select to pause. readGamepad() returns the current
// state; gamepadEdges() reports the Start/Back presses since the last call.

const DEADZONE = 0.45;
let lastStart = false;
let lastBack = false;

export function readGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = [...pads].find((p) => p && p.connected);
  if (!pad) return null;
  const button = (i) => !!pad.buttons[i]?.pressed;
  const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
  return {
    up: button(12) || y < -DEADZONE,
    down: button(13) || y > DEADZONE,
    left: button(14) || x < -DEADZONE,
    right: button(15) || x > DEADZONE,
    pepper: button(0) || button(1) || button(2) || button(3),
    start: button(9),
    back: button(8),
  };
}

// presses of Start and Back since the last call
export function gamepadEdges(state) {
  const start = !!state?.start, back = !!state?.back;
  const edges = { start: start && !lastStart, back: back && !lastBack };
  lastStart = start;
  lastBack = back;
  return edges;
}
