import { describe, expect, test } from "bun:test";
import { WindBed } from "../src/audio/wind";
import type { AudioCore } from "../src/audio/engine";

/** Just enough of the Web Audio API for WindBed to build and tear down its graph. */
function fakeCore(): { core: AudioCore; live: () => number } {
  let live = 0;
  const param = () => ({ value: 0, setTargetAtTime() {} });
  const node = () => ({ connect: (next: unknown) => next });
  const scheduled = () => ({
    ...node(),
    start: () => void live++,
    stop: () => void live--,
  });
  const ctx = {
    currentTime: 0,
    createBufferSource: () => ({ ...scheduled(), buffer: null, loop: false }),
    createBiquadFilter: () => ({ ...node(), type: "", frequency: param(), Q: param() }),
    createOscillator: () => ({ ...scheduled(), frequency: param() }),
    createGain: () => ({ ...node(), gain: param() }),
  };
  const core = { ctx, brown: {}, music: node() } as unknown as AudioCore;
  return { core, live: () => live };
}

describe("wind bed", () => {
  test("builds its noise graph only in moving air, and releases it after the listener leaves", () => {
    const { core, live } = fakeCore();
    const wind = new WindBed(core);
    wind.update(0, 1 / 60);
    expect(wind.active).toBe(false);

    wind.update(0.6, 1 / 60);
    expect(wind.active).toBe(true);
    expect(live()).toBe(2);

    for (let t = 0; t < 1; t += 1 / 60) wind.update(0, 1 / 60);
    expect(wind.active).toBe(true);
    for (let t = 0; t < 6; t += 1 / 60) wind.update(0, 1 / 60);
    expect(wind.active).toBe(false);
    expect(live()).toBe(0);
  });
});
