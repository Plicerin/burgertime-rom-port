-- MAME autoboot script: records the Burger Time main CPU's state at every
-- frame update (VBLANK start) so tools/compare-mame.mjs can diff the oracle.
--   BTIME_FRAMES  number of frames to record
--   BTIME_OUT     output file (binary records, see below)
--   BTIME_INPUTS  optional input script: lines "frame port field value"
--   BTIME_SNAPS   optional comma-separated frames to save screenshots of
--                 (to MAME's -snapshot_directory)
--   BTIME_SOUND   optional output file for the sound CPU: per frame 'SFRM'
--                 u32 frame, u16 pc, u8 a x y s p, RAM $0000-$03FF; and each
--                 AY write as 'AYWR' u32 frame, u8 port (1-4: $2000/$4000/
--                 $6000/$8000), u8 value
-- Input script lines "frame POKE addr value" write main CPU RAM directly.
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
    if port == "POKE" then field = tonumber(field) end
    if f then
      script[tonumber(f)] = script[tonumber(f)] or {}
      table.insert(script[tonumber(f)], { port, field, tonumber(value) })
    end
  end
end

local snaps = {}
for f in (os.getenv("BTIME_SNAPS") or ""):gmatch("%d+") do snaps[tonumber(f)] = true end

local sound_out = nil
local sound_path = os.getenv("BTIME_SOUND")
local scpu = manager.machine.devices[":audiocpu"]
local sspace = scpu.spaces["program"]
local n = 0
if sound_path and sound_path ~= "" then
  sound_out = assert(io.open(sound_path, "wb"))
  btime_ay_tap = sspace:install_write_tap(0x2000, 0x9fff, "aywrites", function(offset, data, mask)
    if sound_out and n < frames then sound_out:write("AYWR", string.pack("<I4BB", n, offset >> 13, data & 0xff)) end
  end)
end

-- kept global: a local subscription is garbage-collected and stops firing
btime_frame_sub = emu.add_machine_frame_notifier(function()
  if n >= frames then return end
  local s = cpu.state
  out:write("FRAM", string.pack("<I4I2BBBBB", n, s["PC"].value, s["A"].value, s["X"].value, s["Y"].value, s["SP"].value & 0xff, s["P"].value))
  out:write(space:read_range(0x0000, 0x07ff, 8))
  out:write(space:read_range(0x0c00, 0x0c0f, 8))
  out:write(space:read_range(0x1000, 0x17ff, 8))
  if sound_out then
    local ss = scpu.state
    sound_out:write("SFRM", string.pack("<I4I2BBBBB", n, ss["PC"].value, ss["A"].value, ss["X"].value, ss["Y"].value, ss["SP"].value & 0xff, ss["P"].value))
    sound_out:write(sspace:read_range(0x0000, 0x03ff, 8))
  end
  if snaps[n] then manager.machine.video:snapshot() end
  -- inputs for the next frame
  for _, e in ipairs(script[n] or {}) do
    if e[1] == "POKE" then space:write_u8(e[2], e[3])
    else ports[":" .. e[1]].fields[e[2]]:set_value(e[3]) end
  end
  n = n + 1
  if n >= frames then
    out:close()
    if sound_out then sound_out:close(); sound_out = nil end
    manager.machine:exit()
  end
end)
