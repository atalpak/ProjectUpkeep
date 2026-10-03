"use client";

/** Open a disclosure before scrolling to it; a plain fragment only reaches its closed heading. */
export function ProfileSectionJump({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="text-sm text-accent-text underline"
      onClick={() => {
        const section = document.getElementById(id);
        if (!(section instanceof HTMLDetailsElement)) return;
        section.open = true;
        section.scrollIntoView({ block: "start" });
      }}
    >
      {children}
    </button>
  );
}
