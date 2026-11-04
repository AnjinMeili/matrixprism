# HUB75 refresh rate: chain length and colour depth

How fast a chain of HUB75 panels can refresh, worked out from the shift
clock, the number of bit planes and the time each plane is lit. It answers
"how many panels can one chain take at this colour depth?" before anything
is wired, whether the chain is driven from GPIO or by a ColorLight
5A-75 receiving card.

**What this is.** Arithmetic from driver timings. The Raspberry Pi 5's
shift times are measured on a bench, and the formula reproduces those
runs; the other timings are published figures. Nothing here has been
checked with a camera. Treat each figure as a ceiling that a real driver
will not quite reach.

## How a HUB75 panel is refreshed

- A panel lights a few rows at a time. A 128×64 panel at 1/32 scan has 32
  row addresses, and each address lights two rows (one in each half of the
  panel, fed by R1G1B1 and R2G2B2), so it takes 32 steps to light the whole
  panel once.
- For each row address, the driver sends the colour as **bit planes**: one
  plane for each bit of colour depth per channel. Each plane is shifted out
  across the whole chain, one pixel per clock, then latched.
- **Binary-coded modulation (BCM):** plane *b* is lit for 2^*b* × the LSB
  time, so the most significant plane is lit longest. The next plane is
  shifted in while the current one is lit.
- So each plane's slot lasts either the time to shift it or the time it has
  to be lit, whichever is longer.
- Parallel chains (`--led-parallel` in `rpi-rgb-led-matrix`) shift at the
  same time on their own data lines, so they do not lower the refresh rate.
  Only the length of one chain does.

## The formula

Shift time for one row of one plane:

```
S = W × t_px + t_latch
```

Refresh rate, over the P planes the driver keeps, b₀ to b₀ + P − 1:

```
f = 1 / ( R × Σ_{b=b₀}^{b₀+P−1} max(S, 2^b × L) )
```

Share of each row's slot that the LEDs are lit:

```
lit = (2^(b₀+P) − 2^b₀) × L / Σ_{b=b₀}^{b₀+P−1} max(S, 2^b × L)
```

Which planes a driver keeps matters below full depth:

- **The lowest P (b₀ = 0):** a driver built for P bits lights planes 0 to
  P − 1. The SmartMatrix figures below use this.
- **The highest P (b₀ = 11 − P):** `rpi-rgb-led-matrix` always builds 11
  planes and `--led-pwm-bits` drops the lowest ones, so at 8 bits it lights
  planes 3 to 10, for 8 × L up to 1024 × L. Its on-time is the same as at
  11 bits less the dropped planes, so its refresh rate rises far less than
  the lowest-P figure suggests.

| Symbol | Meaning | Value used here |
|--------|---------|-----------------|
| W | Chain width in pixels: the pixels in one row along the whole chain | 128 per 128×64 panel chained side by side |
| R | Row addresses (scan): rows ÷ 2 for a panel fed from two halves | 32 for a 64-row panel at 1/32 scan |
| P | Bit planes: bits of colour per channel | 8, 11 or 16 |
| b₀ | Lowest plane the driver keeps | 0, or 11 − P for `rpi-rgb-led-matrix` |
| t_px | Time to shift one pixel | 60.4 ns on a Teensy 4; 50 ns or about 100 ns on a Pi 5 (below) |
| t_latch | Fixed time per shifted row: latch and set-up | 0.5 µs on a Teensy 4; 0 on a Pi 5 (below) |
| L | LSB time: how long the least significant plane is lit | 130 ns or 50 ns (below) |

Two cases follow from it:

- **Shift-bound** (all 2^*b* × L ≤ S): f = 1 / (R × P × S). This is the
  most a chain can do at a given depth, whatever the LSB. It falls as the
  chain gets longer.
- **On-time-bound** (all 2^*b* × L ≥ S): f = 1 / (R × (2^P − 1) × L). Chain
  length drops out. It falls by half for each extra bit of depth.

A real chain sits between the two: the low planes are shift-bound and the
high planes are on-time-bound.

### Where the values come from

- **t_px and t_latch** are from SmartMatrix's Teensy 4 driver
  (`MatrixHardware_Teensy4_ShieldV5.h` at `af288cb`). The pixel clock is
  480 MHz ÷ 26 = 18.46 MHz. The header allows (32 × 26 × 1000 / 480) +
  200 = 1,933 ns per 32 pixels, which is 60.4 ns a pixel. The latch pulse
  is 100 ns, plus up to 400 ns from latch to the first clock, so 0.5 µs.
- **On a Raspberry Pi 5**, t_px is measured: `rpi-rgb-led-matrix` at
  `3da7a3b`, 8 bits, LSB 50 ns, one chain declared 4,096 and then 8,192
  pixels wide, so shifting sets every plane's time. The difference between
  the two refresh rates, over the extra 4,096 pixels, is t_px, and the
  per-row overhead comes out below what the readings resolve, so t_latch
  is 0 here. The formula with these values reproduces both runs to 0.1 Hz.

  | `--led-slowdown-gpio` | 1 | 2 | 3 | 4 |
  |---|---|---|---|---|
  | RIO (the default backend) | 50 ns | 50 ns | 50 ns | 50 ns |
  | PIO (`--led-rp1-pio`) | 102 ns | 147 ns | 232 ns | 298 ns |

  - **RIO** writes two GPIO registers per pixel, data then clock
    (`WriteClockedWord` in `lib/rp1/rp1_rio_backend.cc`), and the slowdown
    only adds a few `nop`s between them, so it shifts at 20 MHz at any
    slowdown.
  - **PIO** clocks at 27 MHz ÷ slowdown, 2 clocks a pixel: 74 ns × slowdown.
    Slowdowns 2 to 4 match that within a few percent. At slowdown 1
    something else sets the pace at about 39 MB/s of frame data, most
    likely the kernel's copy and DMA; that cause is not measured.
- Other Pi models shift at their own rates; put a measured figure in the
  formula. The shift-bound column moves, and the on-time-bound figures do
  not.
- **L** is 130 ns by default in `rpi-rgb-led-matrix`
  (`--led-pwm-lsb-nanoseconds`), and its README's tuning examples go down
  to 50 ns, trading brightness for refresh.

## Two ways drivers choose the LSB

- **Fixed LSB, refresh follows** (`rpi-rgb-led-matrix`): the formula
  above gives the refresh rate. `rpi-rgb-led-matrix` takes at most 11 bit planes
  (`--led-pwm-bits=1..11`, default 11).
- **Fixed refresh, LSB follows** (SmartMatrix): the driver is given a
  refresh rate (240 Hz by default) and shrinks the most significant plane
  until all planes fit in the row's time (`calculateTimerLUT` in
  `MatrixTeensy4Hub75Refresh_Impl.h`). Planes shorter than the shift time
  are padded up to it. Its highest allowed rate is the shift-bound figure.
  At that rate the LSB comes out as S ÷ 2^(P−1), which at 11 or 16 planes
  is a few nanoseconds. That is shorter than one tick of SmartMatrix's own
  timer (it runs at the bus clock ÷ 2), so the lowest planes do not
  get distinct on-times. The "LSB at the ceiling" column shows how short
  the LSB gets.

How short an LSB a panel's driver chip can honour has not been measured
here. Below that, the low planes stop adding real depth.

## Worked example: two 128×64 panels, 11 bits, LSB 130 ns

1. W = 256, so S = 256 × 60.4 ns + 0.5 µs = 15.96 µs.
2. Planes 0 to 6 have on-times of 0.13 to 8.3 µs, all under S, so each
   takes S: 7 × 15.96 = 111.7 µs.
3. Planes 7 to 10 have on-times of 16.6, 33.3, 66.6 and 133.1 µs, all over
   S: 249.6 µs together.
4. One row address takes 111.7 + 249.6 = 361.3 µs, and 32 of them take
   11.56 ms, so **f ≈ 86 Hz**.
5. Lit: 2047 × 0.13 µs = 266.1 µs of 361.3 µs, so **74%** of each row's
   slot.

The shift-bound ceiling for the same chain is 1 / (32 × 11 × 15.96 µs) ≈
178 Hz. At the default LSB, the 11-bit chain is held to about half that by
on-time, not by the clock.

## Tables: 128×64 panels at 1/32 scan

These use SmartMatrix's Teensy 4 timings and the lowest planes (b₀ = 0).
For `rpi-rgb-led-matrix` on a Raspberry Pi 5, see
[the Pi 5 tables](#rpi-rgb-led-matrix-on-a-raspberry-pi-5).

Panels are chained side by side. Stacking them in a chain (for example
128×128 from two) gives the same row width W along the chain, so the same
figures. "Ceiling" is the shift-bound rate. "Lit" is the share of each
row's slot that the LEDs are on. Each row address is itself lit only 1/32
of the time, so the panel's average duty is lit ÷ 32.

### 8 bits per channel (24-bit colour)

| Panels | W | Pixels | Ceiling | LSB at ceiling | Lit at ceiling | LSB 130 ns | Lit | LSB 50 ns | Lit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 128 | 8,192 | 474 Hz | 64.3 ns | 25% | 420 Hz | 45% | 474 Hz | 19% |
| 2 | 256 | 16,384 | 245 Hz | 124.7 ns | 25% | 243 Hz | 26% | 245 Hz | 10% |
| 3 | 384 | 24,576 | 165 Hz | 185.2 ns | 25% | 165 Hz | 17% | 165 Hz | 7% |
| 4 | 512 | 32,768 | 124 Hz | 245.6 ns | 25% | 124 Hz | 13% | 124 Hz | 5% |
| 6 | 768 | 49,152 | 83 Hz | 366.4 ns | 25% | 83 Hz | 9% | 83 Hz | 3% |
| 8 | 1024 | 65,536 | 63 Hz | 487.2 ns | 25% | 63 Hz | 7% | 63 Hz | 3% |

At 8 bits on the lowest planes the clock is the limit: the refresh rate is
close to the ceiling at either LSB. A smaller LSB only dims the panel. A
driver that keeps the highest 8 planes is on-time-bound instead: the same
two panels at 130 ns give 100 Hz, not 243 Hz.

### 11 bits per channel (33-bit colour; `rpi-rgb-led-matrix`'s default)

| Panels | W | Pixels | Ceiling | LSB at ceiling | Lit at ceiling | LSB 130 ns | Lit | LSB 50 ns | Lit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 128 | 8,192 | 345 Hz | 8.0 ns | 18% | 102 Hz | 87% | 201 Hz | 66% |
| 2 | 256 | 16,384 | 178 Hz | 15.6 ns | 18% | 86 Hz | 74% | 142 Hz | 46% |
| 3 | 384 | 24,576 | 120 Hz | 23.1 ns | 18% | 74 Hz | 63% | 108 Hz | 35% |
| 4 | 512 | 32,768 | 90 Hz | 30.7 ns | 18% | 65 Hz | 55% | 85 Hz | 28% |
| 6 | 768 | 49,152 | 61 Hz | 45.8 ns | 18% | 50 Hz | 43% | 60 Hz | 20% |
| 8 | 1024 | 65,536 | 46 Hz | 60.9 ns | 18% | 41 Hz | 35% | 46 Hz | 15% |

At 11 bits, on-time is the limit for short chains. Lowering the LSB to
50 ns buys most of the ceiling back, at the cost of brightness.

### 16 bits per channel (48-bit colour)

| Panels | W | Pixels | Ceiling | LSB at ceiling | Lit at ceiling | LSB 130 ns | Lit | LSB 50 ns | Lit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 128 | 8,192 | 237 Hz | 0.3 ns | 12% | 3.7 Hz | 100% | 9.4 Hz | 98% |
| 2 | 256 | 16,384 | 122 Hz | 0.5 ns | 12% | 3.6 Hz | 99% | 9.2 Hz | 97% |
| 3 | 384 | 24,576 | 82 Hz | 0.7 ns | 12% | 3.6 Hz | 98% | 9.0 Hz | 95% |
| 4 | 512 | 32,768 | 62 Hz | 1.0 ns | 12% | 3.6 Hz | 98% | 8.8 Hz | 93% |
| 6 | 768 | 49,152 | 42 Hz | 1.4 ns | 12% | 3.5 Hz | 96% | 8.5 Hz | 89% |
| 8 | 1024 | 65,536 | 31 Hz | 1.9 ns | 12% | 3.5 Hz | 95% | 8.1 Hz | 85% |

With a fixed LSB, 16 planes at 1/32 scan flicker badly: 2^16 − 1 LSBs per
row, 32 times over. SmartMatrix's 48-bit mode reaches its 240 Hz for one
panel only by making the LSB far shorter than its timer can resolve, so the
lowest planes are not real depth. This doc does not cover what such modes
show in practice.

## rpi-rgb-led-matrix on a Raspberry Pi 5

The library keeps the highest planes (b₀ = 11 − P), and t_px is the
measured figure for each backend: 50 ns on RIO, about 100 ns on PIO at
`--led-slowdown-gpio=1`. Each table is 128×64 panels at 1/32 scan on one
chain; `--led-parallel` chains run alongside at the same rate.

### RIO, 8 bits

| Panels | W | Ceiling | LSB 130 ns | Lit | LSB 50 ns | Lit |
|---|---|---|---|---|---|---|
| 1 | 128 | 610 Hz | 113 Hz | 96% | 257 Hz | 84% |
| 2 | 256 | 305 Hz | 104 Hz | 88% | 203 Hz | 66% |
| 3 | 384 | 203 Hz | 95 Hz | 81% | 163 Hz | 53% |
| 4 | 512 | 153 Hz | 87 Hz | 73% | 136 Hz | 44% |
| 6 | 768 | 102 Hz | 73 Hz | 62% | 98 Hz | 32% |
| 8 | 1024 | 76 Hz | 62 Hz | 52% | 76 Hz | 25% |

### RIO, 11 bits

| Panels | W | Ceiling | LSB 130 ns | Lit | LSB 50 ns | Lit |
|---|---|---|---|---|---|---|
| 1 | 128 | 444 Hz | 105 Hz | 90% | 222 Hz | 73% |
| 2 | 256 | 222 Hz | 92 Hz | 78% | 163 Hz | 53% |
| 3 | 384 | 148 Hz | 81 Hz | 69% | 125 Hz | 41% |
| 4 | 512 | 111 Hz | 71 Hz | 61% | 102 Hz | 33% |
| 6 | 768 | 74 Hz | 57 Hz | 49% | 72 Hz | 24% |
| 8 | 1024 | 55 Hz | 47 Hz | 40% | 55 Hz | 18% |

### PIO at slowdown 1, 8 bits

| Panels | W | Ceiling | LSB 130 ns | Lit | LSB 50 ns | Lit |
|---|---|---|---|---|---|---|
| 1 | 128 | 305 Hz | 104 Hz | 88% | 203 Hz | 66% |
| 2 | 256 | 153 Hz | 87 Hz | 73% | 136 Hz | 44% |
| 3 | 384 | 102 Hz | 73 Hz | 62% | 98 Hz | 32% |
| 4 | 512 | 76 Hz | 62 Hz | 52% | 76 Hz | 25% |
| 6 | 768 | 51 Hz | 47 Hz | 40% | 51 Hz | 17% |
| 8 | 1024 | 38 Hz | 37 Hz | 31% | 38 Hz | 12% |

### PIO at slowdown 1, 11 bits

| Panels | W | Ceiling | LSB 130 ns | Lit | LSB 50 ns | Lit |
|---|---|---|---|---|---|---|
| 1 | 128 | 222 Hz | 92 Hz | 78% | 163 Hz | 53% |
| 2 | 256 | 111 Hz | 71 Hz | 61% | 102 Hz | 33% |
| 3 | 384 | 74 Hz | 57 Hz | 49% | 72 Hz | 24% |
| 4 | 512 | 55 Hz | 47 Hz | 40% | 55 Hz | 18% |
| 6 | 768 | 37 Hz | 35 Hz | 30% | 37 Hz | 12% |
| 8 | 1024 | 28 Hz | 27 Hz | 23% | 28 Hz | 9% |

- **RIO refreshes faster than PIO** at every size: it shifts twice as
  fast at slowdown 1, and its slowdown does not slow it.
- **At 11 bits and the default 130 ns LSB**, on-time sets the rate for
  short chains on either backend: two panels give 92 Hz on RIO and 71 Hz
  on PIO.
- **Below 11 bits the gain is small**, because the dropped planes are the
  shortest ones. Lowering the LSB buys more: two panels at 8 bits go from
  104 Hz to 203 Hz on RIO when the LSB drops from 130 ns to 50 ns.
- **Two readings to compare.** MoonLight's Hub75Pi on the bench, three
  chains of two 128×64 panels at 130 ns, showed "92 fps" in its state at
  11 bits on 2026-11-01, and 101 fps at 8 bits (that run's log is not
  kept). The RIO tables give 92 Hz and 104 Hz for that chain, and the PIO
  tables 71 Hz and 87 Hz. That fits a bench running RIO with its frame
  rate tracking the panel's refresh; neither is confirmed.

## Reading the tables

- **Up to 15k pixels on one chain** is two panels. With SmartMatrix's
  timings at 11 bits that gives 86 Hz at the default LSB or 142 Hz at
  50 ns, and at 8 bits on the lowest planes about 245 Hz. For
  `rpi-rgb-led-matrix` on a Pi 5, see its tables above.
- **Flicker and cameras.** A refresh rate under about 100 Hz may flicker to
  the eye in peripheral vision. A camera can catch the bit planes at much
  higher rates, which is why `rpi-rgb-led-matrix`'s README warns of black
  bars on phone pictures below 300 Hz. To film a panel, set the exposure to
  a whole number of refresh periods.

## ColorLight 5A-75 receiving cards

A ColorLight receiving card refreshes the panels itself. An FPGA on the
card does the bit planes, from frames it is sent over gigabit Ethernet as
raw packets, below IP, such as those MoonLight's PanelCard driver sends.
So the sender's speed does not set the refresh rate. The card's own settings in LEDVision do, and the same
arithmetic applies to the card's shift clock.

### The cards

| Card and sheet | HUB75 ports | Scan | Control area (conventional chips) | 128×64 1/32-scan panels per card |
|---|---|---|---|---|
| 5A-75B, V8.0 (2020) | 8 (J1–J8), with the E line | Up to 1/64 | 256×512 (131,072 pixels); 384×512 with PWM chips | 16 (24 with PWM chips) |
| 5A-75B, V7.1 (2019) | 8, with the E line | Up to 1/64 | 256×256 (65,536 pixels) | 8 |
| 5A-75B, V1.4 (2015) | 8 | 1/16: pin 8 is ground, not E | 256×256 | None at 1/32 scan |
| 5A-75E, V1.0 (2015) | 16 (32 RGB data sets) | 1/16: pin 8 is ground, not E | 128×512 | None at 1/32 scan |
| 5A-75E, later boards (V6.0 to V8.0) | 16 | Not found in a ColorLight sheet | 256×1024, from resellers only | Up to 32, if it has the E line |

- No sheet was found for a plain "5A-75" without a letter.
- To tell a card apart, count the HUB75 headers (8 for a B, 16 for an
  E), read the version printed on the board, and check whether pin 8 of a
  header carries E (it does on the 5A-75B V7.1 and V8.0 sheets).
- Each port carries two RGB groups, the panel's upper and lower halves,
  as HUB75 does. "Panels per port" in the tables below is how many panels
  one port's chain runs through, so W is 128 × that.
- The 5A-75B V8.0 also limits any row or column to 8,192 pixels (4,096 on
  V7.1). The 5A-75B boards V6.1 to V8.2 and the later 5A-75E boards
  carry a Lattice ECP5-25 FPGA, according to the chubby75
  reverse-engineering project.

### How the card refreshes

- **DCLK** is the shift clock: 0.2 to 41.7 MHz on the 2015 sheets.
  ColorLight's site, as quoted on a forum, says full-colour screens
  "generally use 17.9MHz", and that the highest clock a panel takes
  depends on its wiring and driver chips.
  So t_px = 1 / DCLK.
- **Minimum OE** is the shortest on-time, which is the LSB: 8 ns, in 8 ns
  steps (2015 sheets). ColorLight advises against setting it lower.
- **Grey levels:** up to 65,536 (16 bits), after the card's own gamma.
- **Refresh multiplier:** the card splits each source frame into M
  sub-frames, so the visible refresh is the source frame rate × M.
  ColorLight's example is 60 Hz × 32 = 1920 Hz.
- **Brightness efficiency**, shown in LEDVision, is the duty cycle D: the
  share of the time the LEDs are lit. ColorLight suggests keeping it above
  60%.
- LEDVision works these figures out itself. ColorLight does not publish
  how it splits the planes.

### Two ceilings for a card

1. **Visible refresh.** Each sub-frame has to shift every row address at
   least once, so

   ```
   f_visible = M × f_source ≤ 1 / (R × S),   S = W / DCLK
   ```

2. **Full depth in each frame.** A whole grey cycle of P planes, with an
   LSB of at least 8 ns, has to fit in each source frame. That is the
   formula above with t_px = 1 / DCLK and L = 8 ns:

   ```
   f_source ≤ 1 / ( R × Σ_{b=0}^{P−1} max(S, 2^b × 8 ns) )
   ```

   At a 60 Hz source, the card can lengthen the LSB to fill the frame. The
   longest LSB that still fits gives the highest brightness efficiency.

Both ceilings leave out the card's line blanking, which LEDVision sets and
the sheets do not give, so real figures come in lower.

### Tables for a card: 128×64 panels at 1/32 scan

Visible refresh ceiling, the same at any depth:

| Panels per port | W | 17.9 MHz | 25 MHz | 41.7 MHz |
|---|---|---|---|---|
| 1 | 128 | 4,370 Hz | 6,104 Hz | 10,181 Hz |
| 2 | 256 | 2,185 Hz | 3,052 Hz | 5,090 Hz |
| 3 | 384 | 1,457 Hz | 2,035 Hz | 3,394 Hz |
| 4 | 512 | 1,093 Hz | 1,526 Hz | 2,545 Hz |

In the depth tables below, "Full depth" is the highest source frame rate
at which every frame carries all P planes with an 8 ns LSB. "At 60 Hz" is
the highest brightness efficiency with a 60 Hz source.

8 bits per channel:

| Panels per port | W | 17.9 MHz: full depth | At 60 Hz | 25 MHz: full depth | At 60 Hz | 41.7 MHz: full depth | At 60 Hz |
|---|---|---|---|---|---|---|---|
| 1 | 128 | 546 Hz | 98% | 763 Hz | 99% | 1,273 Hz | 99% |
| 2 | 256 | 273 Hz | 94% | 381 Hz | 97% | 636 Hz | 99% |
| 3 | 384 | 182 Hz | 89% | 254 Hz | 94% | 424 Hz | 97% |
| 4 | 512 | 137 Hz | 82% | 191 Hz | 89% | 318 Hz | 95% |

11 bits per channel:

| Panels per port | W | 17.9 MHz: full depth | At 60 Hz | 25 MHz: full depth | At 60 Hz | 41.7 MHz: full depth | At 60 Hz |
|---|---|---|---|---|---|---|---|
| 1 | 128 | 392 Hz | 94% | 526 Hz | 94% | 783 Hz | 97% |
| 2 | 256 | 199 Hz | 85% | 277 Hz | 88% | 449 Hz | 94% |
| 3 | 384 | 132 Hz | 75% | 185 Hz | 82% | 309 Hz | 91% |
| 4 | 512 | 99 Hz | 63% | 139 Hz | 75% | 231 Hz | 88% |

16 bits per channel:

| Panels per port | W | 17.9 MHz: full depth | At 60 Hz | 25 MHz: full depth | At 60 Hz | 41.7 MHz: full depth | At 60 Hz |
|---|---|---|---|---|---|---|---|
| 1 | 128 | 53 Hz | Does not fit | 55 Hz | Does not fit | 57 Hz | Does not fit |
| 2 | 256 | 47 Hz | Does not fit | 50 Hz | Does not fit | 54 Hz | Does not fit |
| 3 | 384 | 42 Hz | Does not fit | 46 Hz | Does not fit | 51 Hz | Does not fit |
| 4 | 512 | 37 Hz | Does not fit | 42 Hz | Does not fit | 49 Hz | Does not fit |

At 1/32 scan, 16 bits does not fit a 60 Hz frame even with no shifting at
all: 65,535 × 8 ns × 32 rows × 60 Hz is 101% of the time. To hold 60 Hz,
the card has to show fewer grey levels on these panels, or the panels need
PWM driver chips, which keep their own grey cycle.

### Against reports from users

Two forum reports from people using 5A-75B cards (sources below) fit
under these ceilings. Neither is a measurement, and neither gives the grey
level set.

- **P5 panels, 1/16 scan, 128 pixels a port, DCLK 8.3 MHz.** LEDVision
  gave 1920 Hz (multiplier 32) at 50% brightness. The visible ceiling for
  that chain is 4,053 Hz. At 16 bits with an 8 ns LSB and a 60 Hz source,
  the duty cycle comes to 65,535 × 8 ns × 16 × 60 = 50.3%, a close
  match. The same user's 192-pixel chain showed 42%, lower than this model
  gives, so the card does something it does not publish.
- **P5 panels, DCLK 17.9 MHz.** Another user found 1920 Hz gave good
  video, and that clocks below 17.9 MHz offered only 960 Hz.

### What it means for 128×64 1/32-scan panels

- **Two panels a port** is the 5A-75B V8.0's load with conventional chips:
  16 panels a card. Twenty panels, 640×256, need two of those cards, or
  one later 5A-75E once its E line is confirmed.
- **1920 Hz** with two panels a port needs a DCLK of at least about
  15.7 MHz, from the visible ceiling. At 17.9 MHz the ceiling is 2,185 Hz,
  so 1920 Hz leaves the card little time for blanking.
- **11 bits** fits a 60 Hz frame at two panels a port with up to 85%
  brightness efficiency at 17.9 MHz. **16 bits** does not fit at all.
- **The source frame rate.** ColorLight's example takes a 60 Hz source.
  MoonLight's PanelCard driver sends at 40 fps by default. How the card's
  refresh behaves at another input rate is not documented, and a camera on
  the panel could measure it.

## Recomputing

For other panels, depths or clocks (paste into Node or a browser console):

```js
// lowPlane: 0 for a driver that keeps the lowest planes, 11 - planes for rpi-rgb-led-matrix.
function hub75Refresh({ width, planes, lsbNs, lowPlane = 0, scanRows = 32, pixelNs = 60.4, latchNs = 500 }) {
  const shiftNs = width * pixelNs + latchNs;
  let rowNs = 0;
  for (let b = lowPlane; b < lowPlane + planes; b++) rowNs += Math.max(shiftNs, 2 ** b * lsbNs);
  return {
    hz: 1e9 / (scanRows * rowNs),
    lit: ((2 ** (lowPlane + planes) - 2 ** lowPlane) * lsbNs) / rowNs,
    ceilingHz: 1e9 / (scanRows * planes * shiftNs),
  };
}

hub75Refresh({ width: 256, planes: 11, lsbNs: 130 }); // { hz: 86.5, lit: 0.74, ceilingHz: 178 }
// rpi-rgb-led-matrix on a Pi 5, RIO, two panels at 8 bits:
hub75Refresh({ width: 256, planes: 8, lsbNs: 130, lowPlane: 3, pixelNs: 50, latchNs: 0 }); // { hz: 103.9, lit: 0.88, ceilingHz: 305 }
```

## Sources

- [SmartMatrix](https://github.com/pixelmatix/SmartMatrix) (Louis Beaudoin,
  Pixelmatix; MIT-style licence) at `af288cb`:
  `src/MatrixHardware_Teensy4_ShieldV5.h` for the pixel clock and latch
  timings, `src/MatrixTeensy4Hub75Refresh_Impl.h` for how it fits planes
  into a fixed refresh rate.
- [rpi-rgb-led-matrix](https://github.com/hzeller/rpi-rgb-led-matrix)
  (Henner Zeller and contributors; GPL-2.0-or-later), in this repository at
  `receiver/matrix`: its README's `--led-pwm-bits`,
  `--led-pwm-lsb-nanoseconds` and refresh tuning notes; at `3da7a3b`,
  `lib/framebuffer.cc` for which planes `--led-pwm-bits` keeps and
  `lib/rp1/` for the Pi 5 backends' clocks.
- The Pi 5 shift times: measured on a Raspberry Pi 5 (kernel 6.18) on
  2026-11-04, with the library's own `--led-show-refresh` reading, as
  described under "Where the values come from".
- ColorLight's specification sheets: [5A-75B V8.0](https://cdn.shopify.com/s/files/1/0333/6047/8343/files/5A-75B-Specification_V8.0.pdf)
  (2020), [5A-75B V7.1](https://cdn.shopify.com/s/files/1/0354/4763/6013/files/5A-75B-Specification_V7.1.pdf)
  (2019), [5A-75B V1.4](https://cdn.shopify.com/s/files/1/0556/0126/6762/files/56949bf6cea82.pdf)
  and [5A-75E V1.0](https://cdn.shopify.com/s/files/1/0556/0126/6762/files/55682c0bdbb93.pdf)
  (2015), copies on resellers' sites. The DCLK range, the 8 ns OE step and
  65,536 grey levels are from the 2015 sheets; the newer sheets give no
  timing figures.
- [Performance settings for an LED receiver card](https://www.colorlitled.com/performance-settings-led-receiver-card/)
  (Colorlit LED): the refresh multiplier, DCLK, minimum OE and brightness
  percentage.
- [chubby75](https://github.com/q3k/chubby75) (q3k and contributors):
  the FPGA, memory and board versions of the 5A-75B and 5A-75E.
- Forum reports of 5A-75B settings: [auschristmaslighting.com, 2020](https://auschristmaslighting.com/threads/problems-with-ray-wu-p5-panels-colorlight-card.12585/)
  and [falconchristmas.com](https://falconchristmas.com/forum/index.php?topic=15249.0).
- 5A-75E load of 256×1024 from a reseller's listing,
  [ledwallcentral.com](https://www.ledwallcentral.com/ColorLight-5A-75E-receiving-card.htm),
  which says its figures may be wrong.
