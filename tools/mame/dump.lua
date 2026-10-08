-- MAME autoboot script: records the Burger Time main CPU's state at every
-- frame update (VBLANK start) so tools/compare-mame.mjs can diff the oracle.
--   BTIME_FRAMES  number of frames to record
--   BTIME_OUT     output file (binary records, see below)
--   BTIME_INPUTS  optional input script: lines "frame port field value"
--   BTIME_SNAPS   optional comma-separated frames to save screenshots of
--                 (to MAME's -snapshot_directory)
-- Record: 'FRAM' u32 frame, u16 pc, u8 a x y s p, then RAM $0000-$07FF,
-- palette $0C00-$0C0F, video $1000-$13FF, colour $1400-$17FF.
local frames = tonumber(os.getenv("BTIME_FRAMES") or "600")
local out = assert(io.open(os.getenv("BTIME_OUT"), "wb"))
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local ports = manager.machine.ioport.ports

local script = {}
local inpath = os.getenv("BTIME_INPUTS")
if inpath and inpath ~= "" then
  for line in io.lines(inpath) do
    local f, port, field, value = line:match("^(%d+)%s+(%S+)%s+(.-)%s+(%d+)%s*$")
    if f then
      script[tonumber(f)] = script[tonumber(f)] or {}
      table.insert(script[tonumber(f)], { port, field, tonumber(value) })
    end
  end
end

local snaps = {}
for f in (os.getenv("BTIME_SNAPS") or ""):gmatch("%d+") do snaps[tonumber(f)] = true end

local n = 0

-- kept global: a local subscription is garbage-collected and stops firing
btime_frame_sub = emu.add_machine_frame_notifier(function()
  if n >= frames then return end
  local s = cpu.state
  out:write("FRAM", string.pack("<I4I2BBBBB", n, s["PC"].value, s["A"].value, s["X"].value, s["Y"].value, s["SP"].value & 0xff, s["P"].value))
  out:write(space:read_range(0x0000, 0x07ff, 8))
  out:write(space:read_range(0x0c00, 0x0c0f, 8))
  out:write(space:read_range(0x1000, 0x17ff, 8))
  if snaps[n] then manager.machine.video:snapshot() end
  -- inputs for the next frame
  for _, e in ipairs(script[n] or {}) do
    ports[":" .. e[1]].fields[e[2]]:set_value(e[3])
  end
  n = n + 1
  if n >= frames then out:close(); manager.machine:exit() end
end)
