import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LOGO_MARK_PATH, SITE_DOMAIN, SITE_NAME } from "@/lib/brand";

// The picture shown when the link is pasted into WhatsApp, X, iMessage or Slack.
export const alt = "Money Autopsy: what actually happened to your money?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fontsDir = join(process.cwd(), "src/assets/fonts");
const semiBold = await readFile(join(fontsDir, "Geist-SemiBold.ttf"));
const regular = await readFile(join(fontsDir, "Geist-Regular.ttf"));

// The image renderer can't read CSS variables, so the palette is mirrored from globals.css (dark mode).
const BG = "#0a0a0a";
const INK = "#f7f7f5";
const MUTED = "#c3c2b7";
const ACCENT = "#34b871";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: BG,
          backgroundImage: "radial-gradient(circle at 92% 0%, rgba(31,157,90,0.55) 0%, rgba(31,157,90,0) 55%)",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="52" height="52" viewBox="6 6 52 52">
            <path d={LOGO_MARK_PATH} fill={ACCENT} />
          </svg>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 600, color: INK }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              maxWidth: 1056,
              fontSize: 80,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: -2,
              color: INK,
            }}
          >
            What actually happened to your money?
          </div>
          <div style={{ display: "flex", fontSize: 34, color: MUTED }}>
            Upload a bank statement. See where it went.
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 32, fontWeight: 600, color: ACCENT }}>{SITE_DOMAIN}</div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: semiBold, weight: 600, style: "normal" },
      ],
    }
  );
}
