"use client";

/**
 * priceBlockTelemetry.ts
 *
 * Verbatim from claude/price-block-instrumentation-jul30.md rev 2, included
 * here so the glass-mode package compiles and typechecks as one unit.
 *
 * If this file already exists in fdd-engine-deploy/lib/, KEEP THE REPO COPY
 * and delete this one. Do not merge two versions by hand.
 *
 * Five events: price_block_viewed · checkout_clicked · page_scroll_depth ·
 * capital_modified · locked_value_engaged.
 *
 * Adds no props to any component. `brand_slug` is derived from the pathname —
 * do not "simplify" that later by threading a slug prop down from the server
 * component; it reopens a door that took real work to close.
 */

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

/* NOT `import posthog from "posthog-js"`, which is what the bundle shipped.
   posthog-js is not a dependency of this repo and never has been: PostHog is
   loaded by the snippet in app/layout.tsx, and every call site in the codebase
   goes through the typed helper in lib/analytics.ts. Installing the SDK here
   would put a second, un-init()ed PostHog on the same page — and an un-init()ed
   posthog-js does not throw, it queues into a client that never flushes. Five
   silently dropped events on the one page whose entire purpose is to be
   measured is the worst available outcome. One PostHog, one taxonomy. */
import { track } from "./analytics";

type Base = {
  brand_slug: string;
  intent: string | null;
  ref_tag: string | null;
  seconds_on_page: number;
};

export function usePriceBlockTelemetry(refTag: string | null) {
  const pathname = usePathname();

  const priceRef = useRef<HTMLDivElement | null>(null);
  const mountedAt = useRef<number>(0);
  const intent = useRef<string | null>(null);

  const priceFired = useRef(false);
  const priceInView = useRef(false);
  const lockFired = useRef(false);
  const capitalFired = useRef(false);
  const capitalCount = useRef(0);
  const capitalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDepth = useRef(0);
  const sentDepth = useRef(false);

  // read the query string here rather than via useSearchParams():
  // useSearchParams() under an SSG route needs a Suspense boundary and
  // will fail the build, which we would only discover on deploy.
  useEffect(() => {
    mountedAt.current = Date.now();
    intent.current = new URLSearchParams(window.location.search).get("intent");
  }, []);

  const base = useCallback(
    (): Base => ({
      brand_slug: pathname.split("/").filter(Boolean).pop() ?? "unknown",
      intent: intent.current,
      ref_tag: refTag,
      seconds_on_page: mountedAt.current
        ? Math.round((Date.now() - mountedAt.current) / 1000)
        : 0,
    }),
    [pathname, refTag],
  );

  // price_block_viewed — and keep a live in-view flag for locked_value_engaged
  useEffect(() => {
    const el = priceRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          priceInView.current = e.isIntersecting;
          if (e.isIntersecting && !priceFired.current) {
            priceFired.current = true;
            track("price_block_viewed", base());
          }
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [base]);

  // page_scroll_depth — tracked continuously, sent once on hide
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) {
        maxDepth.current = 100;
        return;
      }
      const pct = Math.round((window.scrollY / scrollable) * 100);
      if (pct > maxDepth.current) maxDepth.current = Math.min(pct, 100);
    };

    const flush = () => {
      if (sentDepth.current) return;
      sentDepth.current = true;
      track("page_scroll_depth", {
        ...base(),
        max_depth_pct: maxDepth.current,
        reached_price: priceFired.current,
        reached_lock: lockFired.current,
        modified_capital: capitalFired.current,
      });
    };

    // pagehide is the only event that fires reliably on mobile Safari.
    // visibilitychange covers tab-switch; beforeunload does not fire on iOS.
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, [base]);

  /* The bundle named this `checkout_clicked`. It fires the repo's EXISTING pay
     click instead, with a surface dimension.

     Glass mode's whole claim is a before/after against the teaser it replaces.
     That read is one funnel query only if both pages emit the same conversion
     event — a parallel name makes every conversion query a union, and sooner or
     later somebody writes it without the second leg and reports a cliff that
     isn't there. These two lines mirror components/BrandDetail.tsx:94-97
     exactly; only `source` and `cta_surface` differ. */
  const onCheckoutClick = useCallback(() => {
    const b = base();
    track("upgrade_clicked", {
      source: "glass",
      slug: b.brand_slug,
      ref: b.ref_tag ?? "none",
      cta_surface: "glass",
      intent: b.intent,
      seconds_on_page: b.seconds_on_page,
    });
    // checkout_started alongside it, same as the brand page, so buy-intent is
    // dashboard-visible without waiting on Stripe to call back.
    track("checkout_started", {
      source: "glass",
      slug: b.brand_slug,
      cta_surface: "glass",
      price: 199,
    });
  }, [base]);

  // debounced so dragging a slider is one event, not forty
  const onCapitalChange = useCallback(() => {
    if (capitalTimer.current) clearTimeout(capitalTimer.current);
    capitalTimer.current = setTimeout(() => {
      capitalFired.current = true;
      capitalCount.current += 1;
      track("capital_modified", {
        ...base(),
        change_index: capitalCount.current,
      });
    }, 800);
  }, [base]);

  // attach to each locked element; lockId is a label only, never a value
  const lockedRef = useCallback(
    (lockId: string) => (el: HTMLElement | null) => {
      if (!el || el.dataset.lockBound === "1") return;
      el.dataset.lockBound = "1";

      /* ONE EVENT PER ELEMENT PER TRIGGER.
         The bundle fired unconditionally from all three sources, and the
         IntersectionObserver had no per-element guard at all — dataset.lockBound
         stops re-BINDING, not re-FIRING. A glass page carries ~84 masks, so a
         single scroll down and back up shipped ~170 locked_value_engaged events,
         and the metric collapsed into "how many masks are on the page."

         `trigger` is what makes the event readable. A view is presence; a click
         or a one-second dwell is engagement. Without the dimension you cannot
         tell them apart, and with intersection included the signal has no
         variance to rank locks by. Filter to trigger != "view" for engagement
         and keep the views as the denominator. */
      const seen = new Set<string>();
      const fire = (trigger: "click" | "dwell" | "view") => () => {
        if (seen.has(trigger)) return;
        seen.add(trigger);
        if (trigger !== "view") lockFired.current = true;
        track("locked_value_engaged", {
          ...base(),
          lock_id: lockId,
          trigger,
          price_in_view: priceInView.current,
        });
      };

      let hoverTimer: ReturnType<typeof setTimeout> | null = null;
      el.addEventListener("click", fire("click"));
      el.addEventListener("pointerenter", () => {
        hoverTimer = setTimeout(fire("dwell"), 1000);
      });
      el.addEventListener("pointerleave", () => {
        if (hoverTimer) clearTimeout(hoverTimer);
      });

      const onView = fire("view");
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) if (e.isIntersecting) onView();
        },
        { threshold: 0.5 },
      );
      io.observe(el);
    },
    [base],
  );

  return { priceBlockRef: priceRef, onCheckoutClick, onCapitalChange, lockedRef };
}
