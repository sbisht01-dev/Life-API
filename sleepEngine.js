const SLEEP_CONFIG = {
  startHour: 16,
  startMinute: 0,
  endHour: 19,
  endMinute: 0,
  minAnchorHours: 1,
  maxWasoMinutes: 30,
};

function analyzeSleepForDate(events, targetDateStr, customExcludedIds = []) {
  if (!events || events.length === 0) return null;

  const [year, month, day] = targetDateStr.split('-').map(Number);
  const targetDate = new Date(year, month - 1, day);
  const prevDate = new Date(year, month - 1, day - 1);

  const isOvernight = SLEEP_CONFIG.startHour > SLEEP_CONFIG.endHour;
  const startDate = isOvernight ? prevDate : targetDate;
  
  const windowStart = new Date(
    startDate.getFullYear(), startDate.getMonth(), startDate.getDate(),
    SLEEP_CONFIG.startHour, SLEEP_CONFIG.startMinute, 0
  ).getTime();

  let windowEnd = new Date(
    targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(),
    SLEEP_CONFIG.endHour, SLEEP_CONFIG.endMinute, 0
  ).getTime();

  const now = Date.now();
  const isToday = targetDateStr === new Date().toISOString().split('T')[0];
  if (isToday && windowEnd > now) windowEnd = now;

  const sorted = [...events]
    .filter((e) => e.createdAt)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let latestIsUnlocked = false;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const clean = (sorted[i].event || "").replace(/[\[\]]/g, "").trim().toLowerCase();
    if (clean === "device unlocked") {
      latestIsUnlocked = true;
      break;
    } else if (clean === "device locked") {
      latestIsUnlocked = false;
      break;
    }
  }

  const idleChunks = [];
  let pendingLock = null;

  for (const ev of sorted) {
    const time = new Date(ev.createdAt).getTime();
    const clean = (ev.event || "").replace(/[\[\]]/g, "").trim().toLowerCase();

    if (clean === "device locked") {
      pendingLock = time;
    } else if (clean === "device unlocked" && pendingLock) {
      if (pendingLock < windowEnd && time > windowStart) {
        const start = Math.max(pendingLock, windowStart);
        const end = Math.min(time, windowEnd);
        const durationMs = end - start;
        if (durationMs >= 15 * 60 * 1000) {
          idleChunks.push({ id: `${start}-${end}`, start, end, durationMs });
        }
      }
      pendingLock = null;
    }
  }

  if (pendingLock !== null && latestIsUnlocked && pendingLock < windowEnd && pendingLock >= windowStart) {
    const start = Math.max(pendingLock, windowStart);
    const end = Math.min(now, windowEnd);
    if (end - start >= 15 * 60 * 1000) {
      idleChunks.push({ id: `${start}-${end}`, start, end, durationMs: end - start });
    }
  }

  const emptyResult = { hasSleep: false };
  if (idleChunks.length === 0) return emptyResult;

  const eligibleChunks = idleChunks.filter((c) => !customExcludedIds.includes(c.id));
  if (eligibleChunks.length === 0) return emptyResult;

  const sortedByDuration = [...eligibleChunks].sort((a, b) => b.durationMs - a.durationMs);
  const primaryAnchor = sortedByDuration[0];
  if (primaryAnchor.durationMs < SLEEP_CONFIG.minAnchorHours * 60 * 60 * 1000) return emptyResult;

  eligibleChunks.sort((a, b) => a.start - b.start);
  const anchorIdx = eligibleChunks.findIndex((c) => c.id === primaryAnchor.id);
  const stitchedBlocks = [eligibleChunks[anchorIdx]];
  const maxWasoMs = SLEEP_CONFIG.maxWasoMinutes * 60 * 1000;

  for (let i = anchorIdx - 1; i >= 0; i--) {
    const curr = eligibleChunks[i];
    if (stitchedBlocks[0].start - curr.end <= maxWasoMs && curr.durationMs >= 45 * 60 * 1000) {
      stitchedBlocks.unshift(curr);
    } else break;
  }

  for (let i = anchorIdx + 1; i < eligibleChunks.length; i++) {
    const curr = eligibleChunks[i];
    if (curr.start - stitchedBlocks[stitchedBlocks.length - 1].end <= maxWasoMs && curr.durationMs >= 45 * 60 * 1000) {
      stitchedBlocks.push(curr);
    } else break;
  }

  const bedTime = stitchedBlocks[0].start;
  const wakeTime = stitchedBlocks[stitchedBlocks.length - 1].end;
  const timeInBedMs = wakeTime - bedTime;

  let totalAwakeMs = 0;
  for (let i = 0; i < stitchedBlocks.length - 1; i++) {
    totalAwakeMs += (stitchedBlocks[i + 1].start - stitchedBlocks[i].end);
  }

  const actualSleepMs = Math.max(timeInBedMs - totalAwakeMs, 0);
  const efficiency = timeInBedMs > 0 ? Math.round((actualSleepMs / timeInBedMs) * 100) : 0;

  return {
    hasSleep: true,
    bedTime,
    wakeTime,
    timeInBedMs,
    actualSleepMs,
    totalAwakeMs,
    efficiency,
    interruptions: stitchedBlocks.length - 1
  };
}

module.exports = { analyzeSleepForDate, SLEEP_CONFIG };