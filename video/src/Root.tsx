import type React from "react";
import { Composition, Series } from "remotion";
import { Hook, hookTimeline } from "./hook/Hook";
import { Demo, demoTimeline } from "./demo/Demo";
import { Outro, outroDuration } from "./demo/Outro";
import { FPS, HEIGHT, WIDTH } from "./theme";

export const Root: React.FC = () => (
  <>
    <Composition id="Hook" component={Hook} durationInFrames={hookTimeline().total} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="Demo" component={Demo} durationInFrames={demoTimeline().total} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="Outro" component={Outro} durationInFrames={outroDuration()} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="Full" component={Full} durationInFrames={fullDuration()} fps={FPS} width={WIDTH} height={HEIGHT} />
  </>
);

const Full: React.FC = () => (
  <Series>
    <Series.Sequence durationInFrames={hookTimeline().total}>
      <Hook />
    </Series.Sequence>
    <Series.Sequence durationInFrames={demoTimeline().total}>
      <Demo />
    </Series.Sequence>
    <Series.Sequence durationInFrames={outroDuration()}>
      <Outro />
    </Series.Sequence>
  </Series>
);

function fullDuration() {
  return hookTimeline().total + demoTimeline().total + outroDuration();
}
