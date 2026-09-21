import { adminBallAdd, adminInningsSetBatter, type WicketType } from './fixtures';

export type QueuedBall = {
  kind: 'ball'; matchNumber: number; innings: number;
  batRuns: number; extra: string | null; isWicket: boolean; wicketType: WicketType | null;
  bowlerId: string | null; fielderId: string | null; fieldingNote: string | null;
};
export type QueuedBatter = { kind: 'batter'; matchNumber: number; innings: number; striker: string; nonStriker: string | null };
export type QueuedAction = QueuedBall | QueuedBatter;

const KEY = 'd2p.score.queue';

export function getQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  } catch {
    return [];
  }
}

function save(queue: QueuedAction[]) {
  localStorage.setItem(KEY, JSON.stringify(queue));
}

export function queueLength(): number {
  return getQueue().length;
}

function enqueue(action: QueuedAction) {
  const q = getQueue();
  q.push(action);
  save(q);
}

function isNetworkError(message: string): boolean {
  return /fetch|network|failed to fetch|timeout|load failed|offline/i.test(message);
}

export async function submitBall(matchNumber: number, innings: number, ball: {
  batRuns: number; extra: string | null; isWicket: boolean; wicketType: WicketType | null;
  bowlerId: string | null; fielderId?: string | null; fieldingNote?: string | null;
}): Promise<{ queued?: boolean; error?: string }> {
  const payload: QueuedBall = {
    kind: 'ball', matchNumber, innings, batRuns: ball.batRuns, extra: ball.extra,
    isWicket: ball.isWicket, wicketType: ball.wicketType, bowlerId: ball.bowlerId,
    fielderId: ball.fielderId ?? null, fieldingNote: ball.fieldingNote ?? null,
  };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueue(payload);
    return { queued: true };
  }
  const { error } = await adminBallAdd(matchNumber, innings, ball);
  if (error) {
    if (isNetworkError(error)) { enqueue(payload); return { queued: true }; }
    return { error };
  }
  return {};
}

export async function submitBatter(matchNumber: number, innings: number, striker: string, nonStriker: string | null): Promise<{ queued?: boolean; error?: string }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueue({ kind: 'batter', matchNumber, innings, striker, nonStriker });
    return { queued: true };
  }
  const { error } = await adminInningsSetBatter(matchNumber, innings, striker, nonStriker);
  if (error) {
    if (isNetworkError(error)) { enqueue({ kind: 'batter', matchNumber, innings, striker, nonStriker }); return { queued: true }; }
    return { error };
  }
  return {};
}

export async function flushQueue(): Promise<{ flushed: number; error?: string }> {
  let flushed = 0;
  let queue = getQueue();
  while (queue.length) {
    const action = queue[0];
    const { error } = action.kind === 'ball'
      ? await adminBallAdd(action.matchNumber, action.innings, {
          batRuns: action.batRuns, extra: action.extra, isWicket: action.isWicket,
          wicketType: action.wicketType, bowlerId: action.bowlerId,
          fielderId: action.fielderId, fieldingNote: action.fieldingNote,
        })
      : await adminInningsSetBatter(action.matchNumber, action.innings, action.striker, action.nonStriker);
    if (error) return { flushed, error };
    queue = queue.slice(1);
    save(queue);
    flushed += 1;
  }
  return { flushed };
}
