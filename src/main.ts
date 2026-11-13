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

const NETWORKS: Record<Network, { label: string; color: string; load: (handle: string) => Promise<Counts> }> = {
  bluesky: {
    label: "BSKY",
    color: "#1185FEFF",
    load: async (handle) => {
      const body = (await json(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle.replace(/^@/, ""))}`,
      )) as { followersCount: number; followsCount: number; postsCount: number };
      return { followers: body.followersCount, following: body.followsCount, posts: body.postsCount };
    },
  },
  mastodon: {
    label: "MSTDN",
    color: "#8C8DFFFF",
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

/** The network and the metric on the top line, the count large under them; "--" without counts. */
function frame(network: Network, counts: Counts | null, metric: number): Element[] {
  const m = METRICS[metric];
  return [
    {
      type: "text",
      id: "network",
      text: NETWORKS[network].label,
      font: "small",
      color: NETWORKS[network].color,
      x: 0,
      y: -2,
      align: "top_left",
    },
    { type: "text", id: "metric", text: m.label, font: "small", color: SUBTLE_WHITE, x: 72, y: -2, align: "top_right" },
    {
      type: "text",
      id: "count",
      text: counts === null ? "--" : thousands(counts[m.key]),
      font: "large",
      color: WHITE,
      x: 0,
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
