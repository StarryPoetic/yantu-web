import { memo } from "react";

/** A local, transparent 24fps sprite extracted from the supplied video. */
export const JellyMascot = memo(function JellyMascot() {
  return <span className="jelly-mascot" aria-hidden="true" />;
});
