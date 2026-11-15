import { device } from "@shared/device";
import type { DisplayDrawParams } from "@busy-app/busy-lib";

/** One display element as DisplayDraw takes it. */
export type Element = DisplayDrawParams["elements"][number];

/** The app's displays: the front one, and the back one for elements with display "back". */
export interface Screen {
  /**
   * Draws a whole frame: only its elements that changed since the last frame are sent, those not in it are cleared.
   * With led, a "#RRGGBBAA" colour, the status LED blinks it as the frame is drawn.
   */
  show(elements: Element[], led?: string): void;
  /** Stops drawing: frames asked for after this are dropped. */
  close(): void;
}

/**
 * Whether two elements have the same fields with the same values; the app's elements hold plain values only. Compared
 * so, not as JSON: a JSON copy of the back display's graph, made for every frame of the fireworks, does not fit the
 * heap.
 */
function same(a: Element, b: Element): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((key) => x[key] === y[key]);
}

/** A picture with nothing in it: what an xpmbitmap is turned into to hide it. */
const NOTHING = ["! XPM2", "1 1 1 1", ". c none", "."].join("\n");

/**
 * The element made invisible, keeping its id and type: the firmware refuses to change the type under an id. Text
 * becomes fully transparent, pictures empty; the app draws no other types.
 */
function hidden(e: Element): Element {
  return e.type === "xpmbitmap" ? { ...e, data: NOTHING } : ({ ...e, color: "#00000000" } as Element);
}

/**
 * Keeps at most one display request in flight: a frame asked for while one is on its way waits, and a newer one
 * replaces it.
 */
export function createScreen(app: string, report: (err: unknown) => void): Screen {
  /** What is on the displays now: element id → the element as sent. */
  let shown = new Map<string, Element>();
  let next: Element[] | null = null;
  /** The colour the LED blinks with the next frame sent: a frame that replaces the one asking for it keeps it. */
  let blink: string | undefined;
  let busy = false;
  let closed = false;

  async function flush(): Promise<void> {
    busy = true;
    while (next && !closed) {
      const elements = next;
      const led = blink;
      next = null;
      blink = undefined;
      const ids = elements.map((e) => e.id);
      const gone = [...shown.keys()].filter((id) => ids.indexOf(id) < 0);
      const changed = elements.filter((e) => {
        const before = shown.get(e.id);
        return before === undefined || !same(before, e);
      });
      try {
        // Drawn before the old ones are cleared: clearing all of them first would close the app's screen for a moment.
        // The old ones are hidden in the same request, so that the new frame never shows over the remains of the last.
        const sent = [...changed, ...gone.map((id) => hidden(shown.get(id) as Element))];
        if (sent.length > 0) {
          await device.DisplayDraw({ application_name: app, priority: 50, elements: sent, led_notification_color: led });
        }
        if (gone.length > 0) await device.DisplayClear({ application_name: app, element_ids: gone });
        shown = new Map(elements.map((e): [string, Element] => [e.id, e]));
      } catch (err) {
        report(err);
      }
    }
    busy = false;
  }

  return {
    show(elements, led) {
      if (closed) return;
      next = elements;
      if (led) blink = led;
      if (!busy) void flush();
    },
    close() {
      closed = true;
    },
  };
}
