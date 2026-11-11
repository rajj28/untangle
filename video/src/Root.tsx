import type React from "react";
import { Composition } from "remotion";
import { Hook, hookTimeline } from "./hook/Hook";
import { PayPal, paypalDuration } from "./demo/PayPal";
import { Outro, outroDuration } from "./demo/Outro";
import { Program, program } from "./program/Program";
import { FPS, HEIGHT, WIDTH } from "./theme";

const size = { fps: FPS, width: WIDTH, height: HEIGHT };

export const Root: React.FC = () => (
  <>
    {/* Full: the ~3:30 cut. Short: the Devpost cut, under 3:00. */}
    <Composition id="Full" component={Program} defaultProps={{ cut: "long" as const }} durationInFrames={program("long").total} {...size} />
    <Composition id="Short" component={Program} defaultProps={{ cut: "short" as const }} durationInFrames={program("short").total} {...size} />
    <Composition id="Hook" component={Hook} durationInFrames={hookTimeline().total} {...size} />
    <Composition id="PayPal" component={PayPal} durationInFrames={paypalDuration()} {...size} />
    <Composition id="Outro" component={Outro} durationInFrames={outroDuration()} {...size} />
  </>
);
