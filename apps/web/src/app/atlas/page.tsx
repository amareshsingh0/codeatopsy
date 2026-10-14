import { VisualAtlas } from "@/components/VisualAtlas";
export default function AtlasPage() {
  return (
    <main className="shell py-10">
      <div className="workspace-heading atlas-heading">
        <span className="eyebrow">THE VISUAL ATLAS</span>
        <h1>Small steps. Big understanding.</h1>
        <p>
          Explore data, connected structures and the decisions a program makes. Choose a real editable
          program, run it, then replay its captured state in Learn mode.
        </p>
        <p className="coverage-note">
          Cover images are concept illustrations. The playground builds its diagrams from recorded execution
          data. A structure view interprets captured fields; it does not automatically prove an algorithm’s
          meaning.
        </p>
      </div>
      <VisualAtlas />
    </main>
  );
}
