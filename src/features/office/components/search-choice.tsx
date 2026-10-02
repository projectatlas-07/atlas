"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/form-controls";

const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 disabled:bg-slate-100";

export function SearchChoice({ label, options, selectedId, onSelect, placeholder, v2 = false }: Readonly<{
  label: string;
  options: Array<{ id: string; label: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
  placeholder: string;
  v2?: boolean;
}>) {
  const selected = options.find((option) => option.id === selectedId);
  const listboxId = useId();
  const rootRef = useRef<HTMLLabelElement>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("en-IN");
    return options.filter((option) => !normalized
      || option.label.toLocaleLowerCase("en-IN").includes(normalized)).slice(0, 20);
  }, [options, search]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
  }, [open]);

  const control = v2
    ? <Input role="combobox" aria-controls={listboxId} aria-expanded={open} aria-autocomplete="list" value={selected ? selected.label : search} onFocus={() => setOpen(true)} onChange={(event) => { onSelect(""); setSearch(event.target.value); setOpen(true); }} placeholder={placeholder} />
    : <input role="combobox" aria-controls={listboxId} aria-expanded={open} aria-autocomplete="list" value={selected ? selected.label : search} onFocus={() => setOpen(true)} onChange={(event) => { onSelect(""); setSearch(event.target.value); setOpen(true); }} placeholder={placeholder} className={inputClass} />;

  return <label ref={rootRef} className={v2 ? "relative block text-atlas-sm font-atlas-medium text-atlas-text-muted" : "relative text-xs font-medium text-slate-600"}><span className={v2 ? "mb-atlas-1 block" : undefined}>{label}</span>{control}{selected && <button type="button" aria-label={`Clear ${label}`} onClick={() => { onSelect(""); setSearch(""); }} className="absolute right-2 top-7 px-2 text-lg text-slate-500">×</button>}{open && !selected && <div id={listboxId} role="listbox" className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">{matches.map((option) => <button key={option.id} type="button" role="option" aria-selected={false} onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelect(option.id); setSearch(""); setOpen(false); }} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-stone-100">{option.label}</button>)}{matches.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No match. Use Add below.</p>}</div>}</label>;
}
