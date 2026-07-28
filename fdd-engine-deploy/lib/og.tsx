// lib/og.tsx — HOW a preview card looks. (lib/ogCopy.ts decides what it says.)
//
// ONE SHELL FOR EVERY CARD. Eight routes render preview images; if each one
// owned its own layout, the home card and the brand card would drift apart
// within a month and nobody would notice, because nobody looks at an OG image
// after the day they ship it — you only ever see it when someone else shares
// your link. So there is exactly one component, and each route supplies data.
//
// NO CUSTOM FONTS, DELIBERATELY. ImageResponse resolves fonts at render time,
// and a Google Fonts fetch inside a build step is a network dependency on the
// critical path of every deploy: when it fails — and it does — the build fails,
// for a typeface nobody will consciously notice on a 1200x630 image in a chat
// preview. The bundled default is the right trade. The site's display face still
// applies everywhere it matters, on the actual pages.
//
// SATORI IS NOT A BROWSER. It renders a flexbox subset: no CSS classes, no grid,
// no percentage-free layout guesses. Every container below sets display:"flex"
// explicitly, including ones with a single child, because the failure mode when
// you forget is a thrown error at request time on a route nothing tests.

import { ImageResponse } from "next/og";
import { OG_COLORS, OG_SIZE, ogTitleSize, type OgCardSpec, type OgStat } from "./ogCopy";

function Stat({ stat, last }: { stat: OgStat; last: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        backgroundColor: OG_COLORS.panel,
        border: `1px solid ${OG_COLORS.border}`,
        borderRadius: 18,
        padding: "20px 24px",
        marginRight: last ? 0 : 18,
      }}
    >
      <div style={{ display: "flex", fontSize: 38, fontWeight: 800, color: OG_COLORS.text }}>
        {stat.value}
      </div>
      <div style={{ display: "flex", fontSize: 20, color: OG_COLORS.muted, marginTop: 6 }}>
        {stat.label}
      </div>
      {stat.sub ? (
        <div style={{ display: "flex", fontSize: 17, color: OG_COLORS.dim, marginTop: 4 }}>
          {stat.sub}
        </div>
      ) : null}
    </div>
  );
}

function Card({ spec }: { spec: OgCardSpec }) {
  return (
    <div
      style={{
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        display: "flex",
        flexDirection: "column",
        backgroundColor: OG_COLORS.bg,
        color: OG_COLORS.text,
      }}
    >
      {/* Accent rail. Green for a normal card, amber for a retraction — the same
          amber the retraction notice uses, so the card and the page it previews
          read as the same event. */}
      <div style={{ display: "flex", height: 12, backgroundColor: spec.accent }} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          justifyContent: "space-between",
          padding: "50px 64px 46px 64px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 3,
              color: spec.accent,
            }}
          >
            {spec.eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 18,
              fontSize: ogTitleSize(spec.title),
              fontWeight: 800,
              lineHeight: 1.06,
              letterSpacing: -1,
              maxWidth: 1010,
            }}
          >
            {spec.title}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 20,
              fontSize: 27,
              lineHeight: 1.38,
              color: OG_COLORS.muted,
              maxWidth: 980,
            }}
          >
            {spec.blurb}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {spec.stats.length > 0 ? (
            <div style={{ display: "flex", marginBottom: 30 }}>
              {spec.stats.map((s, i) => (
                <Stat key={s.label} stat={s} last={i === spec.stats.length - 1} />
              ))}
            </div>
          ) : null}

          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 800 }}>Franchise</div>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 800, color: OG_COLORS.green }}>
              Edge
            </div>
            <div style={{ display: "flex", flexGrow: 1 }} />
            <div style={{ display: "flex", fontSize: 21, color: OG_COLORS.dim }}>{spec.footer}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The only thing a route file calls. */
export function ogImage(spec: OgCardSpec): ImageResponse {
  return new ImageResponse(<Card spec={spec} />, { ...OG_SIZE });
}
