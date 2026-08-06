import { createContext, useContext } from 'react';

/** When true, Layout skips `<html>`/`<head>`/`<body>` (TanStack root owns those). */
export const EmbeddedLayoutContext = createContext(false);

export function useEmbeddedLayout(): boolean {
    return useContext(EmbeddedLayoutContext);
}
