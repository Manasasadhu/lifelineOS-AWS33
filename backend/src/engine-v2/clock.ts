/** Sim minutes per real minute once a disaster is running. SIM_SPEED=0 freezes the clock. */
export function simSpeed(): number {
  const n = Number(process.env.SIM_SPEED ?? 1);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** Real seconds until something that is `simMinutes` away in sim time. */
export function realSeconds(simMinutes: number): number {
  const speed = simSpeed();
  return speed > 0 ? Math.round((simMinutes * 60) / speed) : Math.round(simMinutes * 60);
}
