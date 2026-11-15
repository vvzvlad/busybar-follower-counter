import { generateXpm2 } from "@busy-app/busy-lib";
import { device } from "@shared/device";
import manifest from "./appmeta/manifest.json";
import { createScreen, type Element } from "./screen";

/** The name the app draws under; the device clears elements by this id. */
const APP = manifest.id;

const POLL_MS = 10 * 60 * 1000;

const WHITE = "#FFFFFFFF";
const SUBTLE_WHITE = "#FFFFFFA0";

type Network = "bluesky" | "mastodon";

interface Counts {
  followers: number;
  following: number;
  posts: number;
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

/** The network and the handle saved on the app's settings page, or the defaults. */
async function loadSettings(): Promise<{ network: Network; handle: string }> {
  const { values } = await device.AppsSettingsGet({ app_id: APP });
  return {
    network: values.network === "mastodon" ? "mastodon" : "bluesky",
    handle: typeof values.handle === "string" ? values.handle.trim() : "bsky.app",
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

/** The network's logo at the top left, the metric at the top right, the count large right of the logo; "--" without counts. */
function frame(network: Network, counts: Counts | null, metric: number): Element[] {
  const m = METRICS[metric];
  const count = counts === null ? "--" : thousands(counts[m.key]);
  return [
    { type: "xpmbitmap", id: "logo", data: NETWORKS[network].logo, x: 0, y: 0, align: "top_left" },
    { type: "text", id: "metric", text: m.label, font: "small", color: SUBTLE_WHITE, x: 72, y: -2, align: "top_right" },
    {
      type: "text",
      id: "count",
      text: count,
      font: "large",
      color: WHITE,
      // 35,679,260 is 62 px: from x=10 it ends on the last column, next to the logo, whose rows by the digits end at x=9.
      x: Math.min(COUNT_X, 72 - countWidth(count)),
      y: 4,
      align: "top_left",
    },
  ];
}

/**
 * Entry point, called at the end of the file: the device runs this script from top to bottom and starts nothing by itself.
 */
function main(): void {
  let network: Network = "bluesky";
  let handle = "bsky.app";
  let counts: Counts | null = null;
  let metric = 0;
  let loading = false;
  let stopped = false;

  const report = (err: unknown) =>
    console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);
  const screen = createScreen(APP, report);
  const redraw = () => screen.show(frame(network, counts, metric));

  // One request at a time; a failed one shows "--" until the next poll.
  async function poll(): Promise<void> {
    if (loading) return;
    loading = true;
    try {
      counts = await NETWORKS[network].load(handle);
    } catch (err) {
      counts = null;
      report(err);
    }
    loading = false;
    if (!stopped) redraw();
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  void (async () => {
    try {
      ({ network, handle } = await loadSettings());
    } catch (err) {
      report(err);
    }
    if (stopped) return;
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

    // Not detached from inside the handler itself: with nothing else left the unbind stops the app on the spot, while this handler is still running.
    setTimeout(unbind, 0);
  });
}

main();
