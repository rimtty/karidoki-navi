"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ParcelCandidateViewModel } from "./view-model";
import {
  loadParcelCandidates,
  type ParcelCandidateDataResult,
  type ParcelViewport,
} from "@/lib/fields/parcel-client";

const VIEWPORT_DEBOUNCE_MS = 350;

type ParcelCandidatesState = {
  candidates: ParcelCandidateViewModel[];
  source: "supabase" | "fixture";
  error: string | null;
  loading: boolean;
};

const initialState: ParcelCandidatesState = {
  candidates: [],
  source: "supabase",
  error: null,
  loading: false,
};

function applyResult(
  current: ParcelCandidatesState,
  result: ParcelCandidateDataResult,
): ParcelCandidatesState {
  if (result.data === null) {
    return {
      ...current,
      source: result.source,
      error: result.error,
      loading: false,
    };
  }
  return {
    candidates: result.data,
    source: result.source,
    error: null,
    loading: false,
  };
}

export function useParcelCandidates(enabled = true) {
  const [state, setState] = useState<ParcelCandidatesState>(initialState);
  const lastViewportRef = useRef<ParcelViewport | null>(null);
  const timerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  const request = useCallback(async (viewport: ParcelViewport) => {
    const requestId = ++requestIdRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    const result = await loadParcelCandidates(viewport);
    if (requestId !== requestIdRef.current) return;
    setState((current) => applyResult(current, result));
  }, []);

  const onViewportChange = useCallback(
    (viewport: ParcelViewport) => {
      if (!enabled) return;
      lastViewportRef.current = viewport;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void request(viewport);
      }, VIEWPORT_DEBOUNCE_MS);
    },
    [enabled, request],
  );

  const retry = useCallback(() => {
    const viewport = lastViewportRef.current;
    if (viewport) void request(viewport);
  }, [request]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      requestIdRef.current += 1;
    },
    [],
  );

  return { ...state, onViewportChange, retry };
}
