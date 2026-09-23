"use client";

import { useId, useState } from "react";

import { Dialog } from "@/components/Dialog";
import { Button, Field, Input, Select } from "@/components/ui";
import type { GameCommand } from "@/lib/playtest/board/commands";
import type { ZoneId } from "@/lib/playtest/board/types";

/**
 * "Create a token from a concise form" (plan section 3.3). Always issues one
 * `CREATE_TOKEN` command carrying however many freshly-minted ids the count
 * asks for — token identity is decided here, at the UI boundary, the same
 * way the plan asks for every random/generated id to live on the command
 * rather than be invented inside the reducer.
 */
export function TokenForm({ open, onClose, dispatch }: { open: boolean; onClose: () => void; dispatch: (c: GameCommand) => void }) {
  const [name, setName] = useState("");
  const [power, setPower] = useState("");
  const [toughness, setToughness] = useState("");
  const [count, setCount] = useState(1);
  const [zone, setZone] = useState<ZoneId>("battlefield");
  const titleId = useId();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const ids = Array.from({ length: Math.max(1, Math.min(count, 20)) }, () => `token:${crypto.randomUUID()}`);
    dispatch({
      type: "CREATE_TOKEN",
      ids,
      token: { name: name.trim(), power: power.trim() || null, toughness: toughness.trim() || null, imageUri: null },
      zone,
    });
    setName("");
    setPower("");
    setToughness("");
    setCount(1);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} className="m-auto w-[min(28rem,92vw)] rounded-2xl border border-border p-4">
      <form onSubmit={submit} className="space-y-3">
        <h2 id={titleId} className="font-display text-lg font-semibold">
          Create a token
        </h2>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Soldier" required autoFocus />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Power">
            <Input value={power} onChange={(e) => setPower(e.target.value)} placeholder="1" />
          </Field>
          <Field label="Toughness">
            <Input value={toughness} onChange={(e) => setToughness(e.target.value)} placeholder="1" />
          </Field>
          <Field label="Count">
            <Input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 1)}
            />
          </Field>
        </div>
        <Field label="Put it in">
          <Select value={zone} onChange={(e) => setZone(e.target.value as ZoneId)}>
            <option value="battlefield">Battlefield</option>
            <option value="hand">Hand</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Create</Button>
        </div>
      </form>
    </Dialog>
  );
}
