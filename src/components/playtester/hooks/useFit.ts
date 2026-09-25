"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * The largest box of a given aspect ratio that fits inside `ref`'s element,
 * kept live with a ResizeObserver. The table is a fixed 16:9 virtual board
 * scaled to whatever room the window leaves it (board/layout.ts stores
 * positions as proportions of it), so this is the one place the window's size
 * matters. Zero until first measured; the caller renders nothing meaningful at
 * zero, so no wrong-sized flash.
 */
export function useFit(ref: RefObject<HTMLElement | null>, aspect: number, enabled = true): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      const width = Math.min(w, h * aspect);
      const next = { width: Math.floor(width), height: Math.floor(width / aspect) };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, aspect, enabled]);
  return size;
}

/**
 * The full size of `ref`'s element, kept live. The table board fills its whole
 * area with this (no fixed shape), so a card can be placed anywhere on the
 * dotted mat. Zero until first measured.
 */
export function useSize(ref: RefObject<HTMLElement | null>, enabled = true): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      if (next.width === 0 || next.height === 0) return;
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return size;
}
