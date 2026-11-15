import { generateXpm2 } from "@busy-app/busy-lib";
import { device } from "@shared/device";
import manifest from "./appmeta/manifest.json";
import { createScreen, type Element } from "./screen";

/** The name the app draws under; the device clears elements by this id. */
const APP = manifest.id;

const POLL_MS = 10 * 60 * 1000;
/** A good poll this many minutes after the last one, more than two polls with room for a late one, follows a gap. */
const GAP_MIN = (POLL_MS * 2.5) / 60000;

/** localStorage key of what the good polls left, Saved as JSON: a failed poll shows its counts dimmed. */
const SAVED_KEY = "saved";
/** The fireworks step of the settings when it is not set. */
const STEP = 100;

const WHITE = "#FFFFFFFF";
const SUBTLE_WHITE = "#FFFFFFA0";

/** "No connection", 5x5, in the bottom left corner of the front, under the logo, while the counts are not from a good poll. */
const NO_LINK = generateXpm2({ palette: { ".": "none", r: "#FF3030" }, grid: ["r...r", ".r.r.", "..r..", ".r.r.", "r...r"] });

/** The colour at 40 % brightness, "#RRGGBBAA" in and out: the counts kept from the last good poll are drawn so. */
function dim(color: string): string {
  let out = "#";
  for (let i = 1; i < 7; i += 2) out += Math.round(parseInt(color.slice(i, i + 2), 16) * 0.4).toString(16).padStart(2, "0");
  return out + color.slice(7);
}

type Network = "bluesky" | "mastodon";

interface Counts {
  followers: number;
  following: number;
  posts: number;
}

/** What localStorage keeps of the good polls. */
interface Saved {
  /** Whose counts they are, "network:handle": a change of the settings starts over. */
  account: string;
  /** The counts of the last good poll. */
  counts: Counts;
  /** When the last good poll was, a unix time in minutes: a good poll long after it follows a gap. */
  polled: number;
  /**
   * A sample at every change of the followers, oldest first: those of the last day, and the one in effect as it began.
   * Each is two numbers in a row, the unix time in minutes and the count: in seconds the time would not fit the
   * engine's small integers, and a pair of its own for each sample would take some 50 bytes of heap more. A gap, when
   * the app was closed or its polls failed, is a sample with the count UNKNOWN: a count unchanged and a count not
   * polled would look the same without it.
   */
  history: number[];
}

/** The count of a history sample from whose time on the count is not known. */
const UNKNOWN = -1;

/** The back display's graph covers a day, a column for every 10 minutes, the newest on the right. */
const DAY_MIN = 24 * 60;
const GRAPH_COLUMNS = 144;
const GRAPH_ROWS = 40;

/**
 * Followers gained since the bar's local midnight: against the count in effect then, the newest sample taken by
 * midnight, or against the first known count after midnight when the count then is unknown or the history starts
 * later; null when no count since midnight is known.
 */
function gainToday(history: number[], followers: number): number | null {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime() / 60000;
  let base = UNKNOWN;
  for (let i = 0; i < history.length; i += 2) {
    if (history[i] <= start || base === UNKNOWN) base = history[i + 1];
    else break;
  }
  return base === UNKNOWN ? null : followers - base;
}

/** The day's gain as the front and back displays write it, "+12 TODAY". Capitals: the tail of a "y" would touch the count. */
function gainText(gain: number): string {
  return `${gain < 0 ? "-" : "+"}${thousands(Math.abs(gain))} TODAY`;
}

/**
 * The followers of the day up to `now`, a unix time in minutes, as a picture: each column holds the count in effect
 * at its end, a bright point on a dim fill, scaled from the day's lowest to its highest known count; a flat day is a
 * line across the middle, a column before the first sample or in a gap is empty. Dimmed when `stale`.
 */
function graph(history: number[], now: number, stale: boolean): string {
  const levels: number[] = [];
  let low = Infinity;
  let high = -Infinity;
  let next = 0;
  let count = UNKNOWN;
  for (let c = 0; c < GRAPH_COLUMNS; c++) {
    const end = now - ((GRAPH_COLUMNS - 1 - c) * DAY_MIN) / GRAPH_COLUMNS;
    for (; next < history.length && history[next] <= end; next += 2) count = history[next + 1];
    levels.push(count);
    if (count !== UNKNOWN) {
      low = Math.min(low, count);
      high = Math.max(high, count);
    }
  }
  for (let c = 0; c < GRAPH_COLUMNS; c++) {
    if (levels[c] < 0) continue;
    levels[c] = high === low ? GRAPH_ROWS >> 1 : Math.round(((levels[c] - low) / (high - low)) * (GRAPH_ROWS - 1));
  }
  // A row is put together from runs of one letter, not letter by letter: each step of that would leave a copy of the
  // row so far for the heap to collect.
  const grid: string[] = [];
  for (let row = GRAPH_ROWS - 1; row >= 0; row--) {
    const runs: string[] = [];
    let run = "";
    let length = 0;
    for (const level of levels) {
      const cell = level < 0 || row > level ? "." : row === level ? "l" : "f";
      if (cell !== run && length > 0) {
        runs.push(run.repeat(length));
        length = 0;
      }
      run = cell;
      length++;
    }
    runs.push(run.repeat(length));
    grid.push(runs.join(""));
  }
  return generateXpm2({
    palette: { ".": "none", l: stale ? "#666666" : "#FFFFFF", f: stale ? "#202020" : "#505050" },
    grid,
  });
}

/** Fireworks over the whole front: shells fly up from the bottom and burst, a frame every FIREWORKS_MS. */
const FIREWORKS_MS = 150;
/** Where each shell bursts, the frame it is launched on, and the letter of its colour: bright sparks, dim ones farther out. */
const SHELLS = [
  { x: 10, y: 5, at: 0, c: "r" },
  { x: 36, y: 4, at: 2, c: "y" },
  { x: 60, y: 6, at: 4, c: "b" },
  { x: 24, y: 8, at: 7, c: "g" },
  { x: 50, y: 9, at: 9, c: "p" },
  { x: 66, y: 4, at: 11, c: "y" },
  { x: 5, y: 8, at: 12, c: "b" },
];
/** Frames a shell flies up for, then frames its sparks fly out for. */
const RISE = 3;
const SPREAD = 6;
const FIREWORKS_FRAMES = SHELLS[SHELLS.length - 1].at + RISE + SPREAD;
const SPARK_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
const FIREWORKS_PALETTE = {
  ".": "none",
  w: "#FFF0C0",
  r: "#FF4040",
  R: "#802020",
  y: "#FFD040",
  Y: "#806820",
  b: "#40A0FF",
  B: "#205080",
  g: "#40FF80",
  G: "#208040",
  p: "#FF60FF",
  P: "#803080",
};
/** The status LED blinks this colour as the fireworks start. */
const FIREWORKS_LED = "#FFD040FF";

/** Frame `step` of the fireworks, 72x16. */
function fireworks(step: number): Element {
  /** The lit pixels of each row, x and colour letter. */
  const lit: [number, string][][] = [];
  for (let y = 0; y < 16; y++) lit.push([]);
  const put = (x: number, y: number, c: string) => {
    if (x >= 0 && x < 72 && y >= 0 && y < 16) lit[y].push([x, c]);
  };
  for (const shell of SHELLS) {
    const age = step - shell.at;
    if (age < 0 || age >= RISE + SPREAD) continue;
    if (age < RISE) {
      // The shell on its way up, from the bottom row to where it bursts: on the display from its first frame.
      put(shell.x, Math.round(shell.y + ((15 - shell.y) * (RISE - age)) / RISE), "w");
      continue;
    }
    // The sparks fly out and sink a little as they go.
    const r = age - RISE + 1;
    for (const [dx, dy] of SPARK_DIRECTIONS) {
      put(Math.round(shell.x + dx * r), Math.round(shell.y + dy * r + (r * r) / 10), r <= 3 ? shell.c : shell.c.toUpperCase());
    }
  }
  // Each row is the gaps and the pixels in it, left to right, not a copy per pixel; of two pixels in one place one shows.
  const grid = lit.map((pixels) => {
    pixels.sort((a, b) => a[0] - b[0]);
    const parts: string[] = [];
    let x = 0;
    pixels.forEach(([at, c], i) => {
      if (pixels[i + 1]?.[0] === at) return;
      parts.push(".".repeat(at - x), c);
      x = at + 1;
    });
    parts.push(".".repeat(72 - x));
    return parts.join("");
  });
  return {
    type: "xpmbitmap",
    id: "fireworks",
    data: generateXpm2({ palette: FIREWORKS_PALETTE, grid }),
    x: 0,
    y: 0,
    align: "top_left",
  };
}

/** What the wheel steps through. */
const METRICS: { key: keyof Counts; label: string }[] = [
  { key: "followers", label: "FOLLOWERS" },
  { key: "following", label: "FOLLOWING" },
  { key: "posts", label: "POSTS" },
];

/** The count starts right of the widest logo, 11 px, and a px of space; a count too wide for that moves left. */
const COUNT_X = 12;

/**
 * The count's width in the large font, as busy-lib measures it: a digit 7 px, a 1 5 px, a comma 3 px. A table of its
 * own: importing textWidth would bundle the glyph maps of the fonts into the heap.
 */
function countWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += ch === "1" ? 5 : ch === "," ? 3 : 7;
  return width;
}

/** Each network's logo at the top left, 9 px high, and how to read its counts. */
const NETWORKS: Record<Network, { logo: string; load: (handle: string) => Promise<Counts> }> = {
  bluesky: {
    // The butterfly in Bluesky's blue.
    logo: generateXpm2({
      palette: { ".": "none", b: "#1185FE" },
      grid: [
        "bb.......bb",
        "bbbb...bbbb",
        "bbbbb.bbbbb",
        "bbbbbbbbbbb",
        ".bbbbbbbbb.",
        "..bbbbbbb..",
        ".bbbbbbbbb.",
        ".bbbb.bbbb.",
        "..bb...bb..",
      ],
    }),
    load: async (handle) => {
      const body = (await json(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle.replace(/^@/, ""))}`,
      )) as { followersCount: number; followsCount: number; postsCount: number };
      return { followers: body.followersCount, following: body.followsCount, posts: body.postsCount };
    },
  },
  mastodon: {
    // The white "m" in the speech bubble, Mastodon's purple shading darker to the bottom.
    logo: generateXpm2({
      palette: { ".": "none", p: "#6364FF", q: "#563ACC", w: "#FFFFFF" },
      grid: [
        ".ppppppp.",
        "ppwwpwwpp",
        "pwppwppwp",
        "pwppwppwp",
        "qwqqwqqwq",
        "qwqqqqqwq",
        "qqqqqqqqq",
        "qqqqqqqq.",
        ".qqqq....",
      ],
    }),
    // "user@instance", asked of the instance itself.
    load: async (handle) => {
      const at = handle.lastIndexOf("@");
      const user = handle.slice(0, at).replace(/^@/, "");
      const instance = handle.slice(at + 1);
      const body = (await json(
        `https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`,
      )) as { followers_count: number; following_count: number; statuses_count: number };
      return { followers: body.followers_count, following: body.following_count, posts: body.statuses_count };
    },
  },
};

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

/** The network, the handle and the fireworks step saved on the app's settings page, or the defaults. */
async function loadSettings(): Promise<{ network: Network; handle: string; step: number }> {
  const { values } = await device.AppsSettingsGet({ app_id: APP });
  return {
    network: values.network === "mastodon" ? "mastodon" : "bluesky",
    handle: typeof values.handle === "string" ? values.handle.trim() : "bsky.app",
    step: typeof values.step === "number" && values.step >= 1 ? Math.floor(values.step) : STEP,
  };
}

/** A whole number with thousands separators: 35652495 → "35,652,495". */
function thousands(value: number): string {
  const digits = String(Math.round(value));
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return out;
}

/**
 * The network's logo at the top left, the metric at the top right, the count large right of the logo; "--" without
 * counts. Followers have the day's gain in the metric's place when it is known: "FOLLOWERS" and "+12 TODAY" do not fit side by side
 * right of the logo, 44 and 36 px of 60. `stale`: the counts are kept from the last good poll, drawn dimmed, with the
 * no-connection picture.
 */
function frame(network: Network, counts: Counts | null, metric: number, gain: number | null, stale: boolean): Element[] {
  const m = METRICS[metric];
  const count = counts === null ? "--" : thousands(counts[m.key]);
  const label = m.key === "followers" && gain !== null ? gainText(gain) : m.label;
  const out: Element[] = [
    { type: "xpmbitmap", id: "logo", data: NETWORKS[network].logo, x: 0, y: 0, align: "top_left" },
    { type: "text", id: "metric", text: label, font: "small", color: stale ? dim(SUBTLE_WHITE) : SUBTLE_WHITE, x: 72, y: -2, align: "top_right" },
    {
      type: "text",
      id: "count",
      text: count,
      font: "large",
      color: stale ? dim(WHITE) : WHITE,
      // 35,679,260 is 62 px: from x=10 it ends on the last column, next to the logo, whose rows by the digits end at x=9.
      x: Math.min(COUNT_X, 72 - countWidth(count)),
      y: 4,
      align: "top_left",
    },
  ];
  // Under the logo, where the count never reaches: it starts at x=10 at the least.
  if (stale) out.push({ type: "xpmbitmap", id: "nolink", data: NO_LINK, x: 0, y: 11, align: "top_left" });
  return out;
}

/**
 * The back display, without the status bar's 12 px on the right: the followers and the day's gain on top, the graph
 * of the day under them; "--" without counts. Dimmed when `stale`.
 */
function back(counts: Counts | null, gain: number | null, picture: string | null, stale: boolean): Element[] {
  const color = stale ? dim(WHITE) : WHITE;
  const count = counts === null ? "--" : thousands(counts.followers);
  const out: Element[] = [
    { type: "text", id: "followers", text: count, font: "extra_large", color, x: 0, y: 0, align: "top_left", display: "back" },
  ];
  // The gain sits on the count's baseline, row 12.
  if (gain !== null) {
    out.push({ type: "text", id: "gain", text: gainText(gain), font: "normal", color, x: 147, y: 3, align: "top_right", display: "back" });
  }
  if (picture !== null) out.push({ type: "xpmbitmap", id: "graph", data: picture, x: 2, y: 28, align: "top_left", display: "back" });
  return out;
}

/**
 * Entry point, called at the end of the file: the device runs this script from top to bottom and starts nothing by itself.
 */
function main(): void {
  let network: Network = "bluesky";
  let handle = "bsky.app";
  let step = STEP;
  let counts: Counts | null = null;
  /** The day's gain of followers and the back display's graph, as of the last poll; null without counts, the gain also when no count since midnight is known. */
  let gain: number | null = null;
  let picture: string | null = null;
  /** The last poll failed: the counts are the ones kept from the last good poll. */
  let stale = false;
  /** What localStorage keeps for this account; null before its first good poll. */
  let saved: Saved | null = null;
  /**
   * The most followers a good poll has seen since the start: none yet, so the first poll after the start sets off no
   * fireworks. A multiple of the step is celebrated once, though the count falls back under it and passes it again.
   */
  let peak: number | null = null;
  /** The frame of the fireworks on the front; null when there are none. */
  let fireworksFrame: number | null = null;
  let fireworksTimer: ReturnType<typeof setInterval> | undefined;
  let metric = 0;
  let loading = false;
  let stopped = false;

  const report = (err: unknown) =>
    console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);
  const screen = createScreen(APP, report);
  const redraw = (led?: string) =>
    screen.show(
      [
        ...(fireworksFrame === null ? frame(network, counts, metric, gain, stale) : [fireworks(fireworksFrame)]),
        ...back(counts, gain, picture, stale),
      ],
      led,
    );

  /**
   * Adds the counts of a good poll to what localStorage keeps. Written at every good poll, though every write rewrites
   * the app's whole store in flash: the time of the last one is what tells a gap from a count that did not change.
   */
  const keep = (got: Counts, now: number) => {
    const history = saved ? saved.history : [];
    // After a gap the count is unknown from when the poll after the last good one was due, until now.
    if (saved && now - saved.polled > GAP_MIN) history.push(saved.polled + POLL_MS / 60000, UNKNOWN);
    if (history.length === 0 || history[history.length - 1] !== got.followers) history.push(now, got.followers);
    // Samples older than a day go, all but the newest of them: it holds the count the day of the graph starts with.
    while (history.length > 2 && history[2] <= now - DAY_MIN) history.splice(0, 2);
    saved = { account: `${network}:${handle}`, counts: got, polled: now, history };
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch (err) {
      report(err);
    }
  };

  /** Fireworks over the front, with their sound and a blink of the LED. */
  const celebrate = () => {
    void device.AudioPlay({ application_name: APP, path: "sounds/fireworks.snd" }).catch(report);
    fireworksFrame = 0;
    redraw(FIREWORKS_LED);
    fireworksTimer = setInterval(() => {
      fireworksFrame = (fireworksFrame as number) + 1;
      if (fireworksFrame >= FIREWORKS_FRAMES) {
        clearInterval(fireworksTimer);
        fireworksFrame = null;
      }
      redraw();
    }, FIREWORKS_MS);
  };

  // One request at a time. Until the next poll a failed one shows the counts of the last good poll, dimmed, with the
  // no-connection picture; "--" with the picture when there has been no good poll yet. A good poll that passes a
  // multiple of the step over the most followers seen so far sets off the fireworks.
  async function poll(): Promise<void> {
    if (loading) return;
    loading = true;
    const now = Math.floor(Date.now() / 60000);
    try {
      counts = await NETWORKS[network].load(handle);
      stale = false;
      keep(counts, now);
    } catch (err) {
      counts = saved ? saved.counts : null;
      stale = true;
      report(err);
    }
    loading = false;
    if (stopped) return;
    // While polls fail after a gap, the count is unknown from when the poll after the last good one was due: the gain
    // and the graph see it so at once, the history kept in localStorage at the next good poll.
    const history =
      saved && stale && now - saved.polled > GAP_MIN
        ? saved.history.concat(saved.polled + POLL_MS / 60000, UNKNOWN)
        : saved?.history;
    gain = history && counts ? gainToday(history, counts.followers) : null;
    picture = history ? graph(history, now, stale) : null;
    let crossed = false;
    if (!stale && counts !== null) {
      crossed = peak !== null && Math.floor(counts.followers / step) > Math.floor(peak / step);
      peak = peak === null ? counts.followers : Math.max(peak, counts.followers);
    }
    // The fireworks start in a run of their own, once this one is over. The graph just made takes most of a second of
    // the bar's time; the emulator lets the requests of a run out at once but holds its timers until the bar would be
    // done with it, so fireworks started here stood on their first frame for a second.
    if (crossed) {
      setTimeout(() => {
        if (!stopped) celebrate();
      }, 0);
    } else {
      redraw();
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  void (async () => {
    try {
      ({ network, handle, step } = await loadSettings());
    } catch (err) {
      report(err);
    }
    if (stopped) return;
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      const got = raw ? (JSON.parse(raw) as Saved) : null;
      if (got && got.account === `${network}:${handle}`) saved = got;
    } catch (err) {
      report(err);
    }
    redraw();
    await poll();
    if (!stopped) timer = setInterval(() => void poll(), POLL_MS);
  })().catch(report);

  const unbind = listen("input", (event) => {
    if (stopped) return;

    // The wheel steps through followers, following and posts.
    if (event.key === "encoder") {
      metric = (metric + event.delta + METRICS.length) % METRICS.length;
      redraw();
      return;
    }

    // Back leaves the app. Once the timer is cleared and the handler detached, nothing keeps it alive and the device takes the screen back.
    if (event.key !== "back" || event.action !== "short") return;

    stopped = true;
    screen.close();
    if (timer !== undefined) clearInterval(timer);
    if (fireworksTimer !== undefined) clearInterval(fireworksTimer);

    // Not detached from inside the handler itself: with nothing else left the unbind stops the app on the spot, while this handler is still running.
    setTimeout(unbind, 0);
  });
}

main();
