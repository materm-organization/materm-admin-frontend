"use client";

import { useState } from "react";

import { RevisionsTab, type RestoredRevision } from "@/components/global/revisions/revisions-tab";
import { MediaPicker } from "@/components/protected/media/media-picker";
import { CachePurgeSection } from "@/components/protected/system/cache-purge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { assetSnapshot } from "@/components/protected/media/asset-snapshot";
import { getMockDb } from "@/mocks/mock-db";
import type { RevisionEntityId, RevisionResource } from "@/lib/revision-resources";
import type { MediaAssetOption } from "@/types/cms";
import ApiMockingImpl from "@/mocks/api-mocking-impl";

type Preset = { label: string; resource: RevisionResource; id: RevisionEntityId };
const PRESETS: Preset[] = [
  { label: "Media asset #2 (7 versions incl. one from a newer schema)", resource: "media/assets", id: 2 },
  { label: "Menu: main", resource: "menus", id: "main" },
  { label: "Settings: brand", resource: "settings", id: "brand" },
  { label: "Media asset #3 (no history yet)", resource: "media/assets", id: 3 },
];

// Developer playground (English only on purpose: it is not product UI) of T1.3.9: the MediaPicker in both modes,
// the RevisionsTab on three kinds of entity, and the cache purge card - all against the in-memory API of
// `src/mocks/` (installed by `ApiMockingImpl` while this page is open). The library itself is `/admin/media`
// (start the app with `NEXT_PUBLIC_API_MOCKING=true` to click it through without a backend).
export function MediaPlayground() {
  return (
    <ApiMockingImpl>
      <div className="space-y-8 p-4">
        <header>
          <h1 className="text-xl font-semibold">Media picker, revisions and cache purge (playground)</h1>
          <p className="text-sm text-muted-foreground">Everything below reads and writes an in-memory model. &quot;Reset mock data&quot; restores the seed.</p>
        </header>
        <PickerDemo />
        <RevisionsDemo />
        <section aria-labelledby="purge-demo">
          <h2 id="purge-demo" className="mb-2 text-lg font-semibold">Clear the website cache</h2>
          <div className="max-w-xl">
            <CachePurgeSection />
          </div>
        </section>
      </div>
    </ApiMockingImpl>
  );
}

function PickerDemo() {
  const [mode, setMode] = useState<"single" | "multiple" | null>(null);
  const [picked, setPicked] = useState<MediaAssetOption[]>([]);
  return (
    <section aria-labelledby="picker-demo" className="space-y-2">
      <h2 id="picker-demo" className="text-lg font-semibold">MediaPicker</h2>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setMode("single")}>Pick one image</Button>
        <Button type="button" variant="outline" onClick={() => setMode("multiple")}>Pick up to 3 images</Button>
      </div>
      <pre data-testid="picked" className="rounded-md border bg-muted/40 p-2 text-xs">
        {picked.length === 0 ? "nothing picked yet" : JSON.stringify(picked.map((a) => ({ id: a.id, filename: a.filename })), null, 2)}
      </pre>
      <MediaPicker
        open={mode !== null}
        onOpenChange={(open) => (!open ? setMode(null) : undefined)}
        mode={mode ?? "single"}
        max={3}
        accept="image/*"
        selectedIds={picked.map((a) => a.id)}
        onSelect={setPicked}
      />
    </section>
  );
}

function RevisionsDemo() {
  const [preset, setPreset] = useState(0);
  const [canRestore, setCanRestore] = useState(true);
  const [withCurrent, setWithCurrent] = useState(true);
  const [last, setLast] = useState<RestoredRevision | null>(null);
  const p = PRESETS[preset];
  const asset = p.resource === "media/assets" ? getMockDb().assets.find((a) => a.id === p.id) : undefined;
  return (
    <section aria-labelledby="revisions-demo" className="space-y-3">
      <h2 id="revisions-demo" className="text-lg font-semibold">RevisionsTab</h2>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {PRESETS.map((x, i) => (
          <Button key={x.label} type="button" size="sm" variant={i === preset ? "default" : "outline"} onClick={() => { setPreset(i); setLast(null); }}>
            {x.label}
          </Button>
        ))}
        <span className="flex items-center gap-2">
          <Switch id="pg-can" checked={canRestore} onCheckedChange={setCanRestore} />
          <Label htmlFor="pg-can" className="font-normal">canRestore</Label>
        </span>
        <span className="flex items-center gap-2">
          <Switch id="pg-cur" checked={withCurrent} onCheckedChange={setWithCurrent} />
          <Label htmlFor="pg-cur" className="font-normal">pass currentSnapshot (media only)</Label>
        </span>
      </div>
      <RevisionsTab
        key={`${p.resource}/${p.id}`}
        resource={p.resource}
        id={p.id}
        canRestore={canRestore}
        currentSnapshot={withCurrent && asset ? assetSnapshot(asset) : undefined}
        onRestored={(result) => setLast(result)}
      />
      <pre data-testid="restored" className="rounded-md border bg-muted/40 p-2 text-xs">
        {last ? JSON.stringify({ etag: last.etag, restoredFrom: last.restoredFrom }, null, 2) : "no restore yet"}
      </pre>
    </section>
  );
}
