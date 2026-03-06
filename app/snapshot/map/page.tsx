import { Suspense } from "react";
import { SnapshotMapClient } from "./SnapshotMapClient";

export const dynamic = "force-dynamic";

export default function SnapshotMapPage() {
  return (
    <Suspense fallback={<div id="snapshot-map" style={{ width: 400, height: 300, background: "#eee" }} />}>
      <SnapshotMapClient />
    </Suspense>
  );
}
